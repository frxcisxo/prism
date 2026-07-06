import worker from './worker.mjs';

const kvStore = new Map();
const env = {
  PRISM_REGION: 'iad',
  PRISM_CACHE_TTL: '300',
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

async function postInfer(id, input) {
  const response = await worker.fetch(request('/infer', {
    method: 'POST',
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
  body: JSON.stringify({ id: 'bad-request' }),
}), env);
const invalidBody = await invalid.json();
assert(invalid.status === 400, 'invalid request did not return HTTP 400');
assert(invalidBody.error.code === 'INVALID_REQUEST', 'invalid request did not expose validation code');
console.log('OK invalid inference request is rejected safely');

console.log('\nAll Cloudflare Worker checks passed.');
