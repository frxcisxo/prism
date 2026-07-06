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
    cors: true,
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

export default {
  async fetch(request, env = {}) {
    return createAdapter(request, env).handleRequest(request);
  },
};
