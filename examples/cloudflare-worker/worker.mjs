import {
  CloudflareKVEdgeCache,
  MemoryEdgeCache,
  PrismEdgeGateway,
} from '../../dist/edge.js';

const model = {
  id: 'edge-triage-small',
  name: 'Edge Triage Small',
  version: '1.0.0',
  format: 'remote',
  size: 1,
  capabilities: ['classification', 'routing', 'fallback-planning'],
  quantization: 'int8',
};

const localCache = new MemoryEdgeCache();
const gateways = new Map();

function createCache(env = {}) {
  return env.PRISM_CACHE
    ? new CloudflareKVEdgeCache(env.PRISM_CACHE, { readCacheTtl: 60 })
    : localCache;
}

function createAdapter(request, env = {}) {
  const colo = request.cf?.colo || env.PRISM_REGION || 'local-dev';
  const key = `${colo}:${env.PRISM_CACHE ? 'kv' : 'memory'}:${env.PRISM_CACHE_TTL || 120}`;

  if (gateways.has(key)) {
    return gateways.get(key);
  }

  const gateway = new PrismEdgeGateway({
    nodeId: 'cloudflare-prism-edge',
    serviceName: 'prism-cloudflare-worker',
    platform: 'cloudflare',
    region: colo,
    edgeId: `cloudflare-${String(colo).toLowerCase()}`,
    cacheTtl: Number(env.PRISM_CACHE_TTL || 120),
    model,
    cache: createCache(env),
    edgeConfig: {
      platform: 'cloudflare',
      region: colo,
      edgeId: `cloudflare-${String(colo).toLowerCase()}`,
      cacheTtl: Number(env.PRISM_CACHE_TTL || 120),
    },
    enrichOutput: (result, _inferenceRequest, context) => ({
        ...result,
        output: {
          ...result.output,
          prism: {
            platform: context.platform,
            region: context.region,
            cacheKey: context.cacheKey,
          },
        },
      }),
  });

  gateways.set(key, gateway);
  return gateway;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  };
}

function withCors(response) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function health(request, env) {
  return createAdapter(request, env).health();
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json(await health(request, env));
    }

    if (request.method === 'POST' && url.pathname === '/infer') {
      return withCors(await createAdapter(request, env).handleInferenceRequest(request));
    }

    return json({
      error: 'Not found',
      endpoints: ['GET /health', 'POST /infer'],
    }, 404);
  },
};
