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

function envNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envList(value, fallback) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(',')
    .map(route => route.trim())
    .filter(Boolean);
}

function createCache(env = {}) {
  return env.PRISM_CACHE
    ? new CloudflareKVEdgeCache(env.PRISM_CACHE, { readCacheTtl: 60 })
    : localCache;
}

function createAuth(env = {}) {
  if (!env.PRISM_EDGE_TOKEN) {
    return undefined;
  }

  return {
    bearerToken: String(env.PRISM_EDGE_TOKEN),
    protectedRoutes: envList(env.PRISM_PROTECTED_ROUTES, ['infer', 'metrics', 'status']),
  };
}

function createRateLimit(env = {}) {
  if (!env.PRISM_RATE_LIMIT) {
    return undefined;
  }

  return {
    limit: envNumber(env.PRISM_RATE_LIMIT, 120),
    windowMs: envNumber(env.PRISM_RATE_WINDOW_MS, 60_000),
    routes: envList(env.PRISM_RATE_LIMIT_ROUTES, ['infer']),
  };
}

function createOverloadProtection(env = {}) {
  if (!env.PRISM_MAX_CONCURRENT_INFERENCE) {
    return undefined;
  }

  return {
    maxConcurrentInference: envNumber(env.PRISM_MAX_CONCURRENT_INFERENCE, 8),
    retryAfterMs: envNumber(env.PRISM_OVERLOAD_RETRY_AFTER_MS, 1_000),
  };
}

function createIdempotency(env = {}) {
  if (!env.PRISM_IDEMPOTENCY) {
    return undefined;
  }

  return {
    header: env.PRISM_IDEMPOTENCY_HEADER || 'idempotency-key',
    ttlMs: envNumber(env.PRISM_IDEMPOTENCY_TTL_MS, 60_000),
  };
}

function createAdapter(request, env = {}) {
  const colo = request.cf?.colo || env.PRISM_REGION || 'local-dev';
  const cacheTtl = envNumber(env.PRISM_CACHE_TTL, 120);
  const key = [
    colo,
    env.PRISM_CACHE ? 'kv' : 'memory',
    cacheTtl,
    env.PRISM_EDGE_TOKEN ? 'auth' : 'public',
    env.PRISM_PROTECTED_ROUTES || 'default-protected',
    env.PRISM_RATE_LIMIT || 'unlimited',
    env.PRISM_RATE_WINDOW_MS || 'default-window',
    env.PRISM_RATE_LIMIT_ROUTES || 'default-rate-routes',
    env.PRISM_MAX_CONCURRENT_INFERENCE || 'unbounded',
    env.PRISM_OVERLOAD_RETRY_AFTER_MS || 'default-overload-retry',
    env.PRISM_IDEMPOTENCY ? 'idempotent' : 'non-idempotent',
    env.PRISM_IDEMPOTENCY_HEADER || 'default-idempotency-header',
    env.PRISM_IDEMPOTENCY_TTL_MS || 'default-idempotency-ttl',
  ].join(':');

  if (gateways.has(key)) {
    return gateways.get(key);
  }

  const edgeId = `cloudflare-${String(colo).toLowerCase()}`;

  const gateway = new PrismEdgeGateway({
    nodeId: 'cloudflare-prism-edge',
    serviceName: 'prism-cloudflare-worker',
    platform: 'cloudflare',
    region: colo,
    edgeId,
    cacheTtl,
    model,
    cache: createCache(env),
    cors: true,
    auth: createAuth(env),
    rateLimit: createRateLimit(env),
    overload: createOverloadProtection(env),
    idempotency: createIdempotency(env),
    edgeConfig: {
      platform: 'cloudflare',
      region: colo,
      edgeId,
      cacheTtl,
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
