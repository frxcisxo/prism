import { PrismCRDT } from '../../dist/index.js';
import {
  CloudflareEdgeAdapter,
  CloudflareKVEdgeCache,
  MemoryEdgeCache,
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

const prism = new PrismCRDT({ nodeId: 'cloudflare-prism-edge' });
const localCache = new MemoryEdgeCache();

let ready = false;
let readyPromise;

async function ensurePrismNetwork() {
  if (ready) {
    return;
  }

  if (!readyPromise) {
    readyPromise = (async () => {
      await prism.registerNode({ gpu: false, wasm: true, quantization: true });

      if (!(await prism.isModelDeployed(model.id))) {
        await prism.deployModel(model);
      }

      ready = true;
    })();
  }

  await readyPromise;
}

function createCache(env = {}) {
  return env.PRISM_CACHE
    ? new CloudflareKVEdgeCache(env.PRISM_CACHE, { readCacheTtl: 60 })
    : localCache;
}

function createAdapter(request, env = {}) {
  const colo = request.cf?.colo || env.PRISM_REGION || 'local-dev';

  return new CloudflareEdgeAdapter({
    platform: 'cloudflare',
    region: colo,
    edgeId: `cloudflare-${String(colo).toLowerCase()}`,
    cacheTtl: Number(env.PRISM_CACHE_TTL || 120),
  }, {
    cache: createCache(env),
    infer: async (inferenceRequest, context) => {
      await ensurePrismNetwork();

      const result = await prism.infer({
        ...inferenceRequest,
        edgeId: context.edgeId,
      });

      return {
        ...result,
        output: {
          ...result.output,
          prism: {
            platform: context.platform,
            region: context.region,
            cacheKey: context.cacheKey,
          },
        },
      };
    },
  });
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

async function health() {
  await ensurePrismNetwork();

  return {
    ok: true,
    service: 'prism-cloudflare-worker',
    model,
    stats: prism.getStats(),
    endpoints: {
      infer: 'POST /infer',
      health: 'GET /health',
    },
  };
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json(await health());
    }

    if (request.method === 'POST' && url.pathname === '/infer') {
      return withCors(await createAdapter(request, env).handleRequest(request));
    }

    return json({
      error: 'Not found',
      endpoints: ['GET /health', 'POST /infer'],
    }, 404);
  },
};
