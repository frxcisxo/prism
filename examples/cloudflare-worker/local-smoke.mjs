import worker from './worker.mjs';

const kvStore = new Map();
const env = {
  PRISM_REGION: 'iad',
  PRISM_CACHE_TTL: '300',
  PRISM_EDGE_TOKEN: 'local-worker-token',
  PRISM_RATE_LIMIT: '3',
  PRISM_RATE_WINDOW_MS: '60000',
  PRISM_MAX_CONCURRENT_INFERENCE: '2',
  PRISM_OVERLOAD_RETRY_AFTER_MS: '2500',
  PRISM_IDEMPOTENCY: '1',
  PRISM_IDEMPOTENCY_TTL_MS: '60000',
  PRISM_CACHE: {
    async get(key, options) {
      const entry = kvStore.get(key);

      if (!entry || entry.expiresAt <= Date.now()) {
        return null;
      }

      return options?.type === 'json' ? JSON.parse(entry.value) : entry.value;
    },
    async put(key, value, options = {}) {
      kvStore.set(key, {
        value,
        expiresAt: Date.now() + (options.expirationTtl || 60) * 1000,
      });
    },
  },
};

function request(path, init = {}) {
  return new Request(`https://prism-worker.local${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function postInfer(id, input, headers = { authorization: 'Bearer local-worker-token' }) {
  const response = await worker.fetch(request('/infer', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      modelId: 'edge-triage-small',
      input,
      options: { priority: 'high' },
    }),
  }), env);

  return {
    status: response.status,
    body: await response.json(),
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('PRISM Cloudflare Worker smoke validation\n');

const health = await worker.fetch(request('/health'), env).then(response => response.json());
assert(health.ok === true, 'health endpoint did not report ok');
assert(health.stats.models === 1, 'health endpoint did not initialize the PRISM model registry');
console.log('OK health endpoint initializes PRISM');

const readyResponse = await worker.fetch(request('/ready'), env);
const ready = await readyResponse.json();
assert(readyResponse.status === 200, 'readiness endpoint did not return HTTP 200');
assert(ready.ready === true, 'readiness endpoint did not report ready');
assert(ready.checks.modelDeployed.ok === true, 'readiness endpoint did not verify deployed model');
console.log('OK readiness endpoint verifies deployable traffic state');

const openapi = await worker.fetch(request('/openapi.json'), env).then(response => response.json());
assert(openapi.openapi === '3.1.0', 'OpenAPI endpoint did not return an OpenAPI 3.1 document');
assert(openapi.paths['/ready'].get.operationId === 'getPrismEdgeReadiness', 'OpenAPI endpoint did not describe readiness route');
assert(openapi.paths['/infer'].post.operationId === 'runPrismEdgeInference', 'OpenAPI endpoint did not describe inference route');
assert(openapi.paths['/infer'].post.security?.[0]?.bearerAuth, 'OpenAPI endpoint did not mark inference as bearer-protected');
assert(openapi.paths['/metrics'].get.security?.[0]?.bearerAuth, 'OpenAPI endpoint did not mark metrics as bearer-protected');
assert(openapi.components.schemas.InferenceRequest.properties.modelId.const === 'edge-triage-small', 'OpenAPI endpoint did not bind the gateway model id');
console.log('OK OpenAPI endpoint describes the Worker contract');

const deniedInference = await postInfer('cfw-denied', 'Missing token.', {});
assert(deniedInference.status === 401, 'protected inference did not reject a missing bearer token');
console.log('OK protected inference rejects missing bearer token');

const first = await postInfer('cfw-1', 'Prioritize an urgent store shelf anomaly at the edge.');
assert(first.status === 200, 'first inference did not return HTTP 200');
assert(first.body.success === true, 'first inference did not return an edge success envelope');
assert(first.body.cached === false, 'first inference should be an edge cache miss');
assert(first.body.data.output.prism.region === 'iad', 'first inference did not preserve Cloudflare region metadata');
console.log('OK first inference routes through Cloudflare adapter and PRISM');

const repeat = await postInfer('cfw-2', 'Prioritize an urgent store shelf anomaly at the edge.');
assert(repeat.status === 200, 'repeat inference did not return HTTP 200');
assert(repeat.body.cached === true, 'repeat inference should hit the Cloudflare KV edge cache');
assert(repeat.body.data.cached === true, 'repeat inference data did not mark cached result');
console.log('OK repeat inference hits Cloudflare KV cache');

const invalid = await worker.fetch(request('/infer', {
  method: 'POST',
  headers: { authorization: 'Bearer local-worker-token' },
  body: JSON.stringify({ id: 'bad-request' }),
}), env);
const invalidBody = await invalid.json();
assert(invalid.status === 400, 'invalid request did not return HTTP 400');
assert(invalidBody.error.code === 'INVALID_REQUEST', 'invalid request did not expose validation code');
console.log('OK invalid inference request is rejected safely');

const limited = await postInfer('cfw-limited', 'This call should exceed the local smoke rate limit.');
assert(limited.status === 429, 'rate-limited inference did not return HTTP 429');
assert(limited.body.error.code === 'RATE_LIMITED', 'rate-limited inference did not expose RATE_LIMITED code');
console.log('OK rate limit rejects excess inference traffic');

const deniedMetrics = await worker.fetch(request('/metrics'), env);
assert(deniedMetrics.status === 401, 'protected metrics did not reject a missing bearer token');
const metrics = await worker.fetch(request('/metrics', {
  headers: { authorization: 'Bearer local-worker-token' },
}), env).then(response => response.text());
assert(metrics.includes('prism_edge_gateway_requests_total'), 'metrics endpoint did not expose gateway request counter');
assert(metrics.includes('prism_edge_gateway_unauthorized_total 2'), 'metrics endpoint did not count unauthorized inference and metrics calls');
assert(metrics.includes('prism_edge_gateway_rate_limited_total 1'), 'metrics endpoint did not count rate-limited inference');
assert(metrics.includes('prism_edge_gateway_max_concurrent_inference 2'), 'metrics endpoint did not expose overload concurrency limit');
console.log('OK protected metrics expose operational counters');

console.log('\nAll Cloudflare Worker checks passed.');
