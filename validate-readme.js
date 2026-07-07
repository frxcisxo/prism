#!/usr/bin/env node

/**
 * PRISM smoke validation.
 *
 * This script validates the public package surface after `npm run build`.
 */

import {
  AdaptiveBatcher,
  EdgePlacementPlanner,
  ModelShardManager,
  PrismCRDT,
  StreamingInference,
  decryptModelArtifact,
  encryptModelArtifact,
  signModelManifest,
  verifySignedModelManifest,
} from './dist/index.js';
import {
  CloudflareWorkersAIRuntime,
  HttpInferenceRuntime,
  InferenceEngine,
  OllamaRuntime,
  OnnxRuntimeWebRuntime,
  ResilientInferenceRuntime,
  ResilientRuntimeMonitor,
} from './dist/inference.js';
import { CloudflareEdgeAdapter, CloudflareKVEdgeCache, PrismEdgeClient, PrismEdgeGateway, VercelEdgeAdapter } from './dist/edge.js';
import { readFile } from 'node:fs/promises';

const addOneSha256 = 'b7d06325e6a907bdad72053370bc5d3501f599c89eb7e0c9577e556527e83eef';

const model = {
  id: 'validation-model',
  name: 'Validation Model',
  version: '1.0.0',
  format: 'onnx',
  size: 1_000_000,
  capabilities: ['validation'],
  quantization: 'int8',
};

function fail(label, error) {
  console.error(`FAIL ${label}:`, error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log('PRISM smoke validation\n');

try {
  const a = new PrismCRDT({ nodeId: 'validation-a' });
  const b = new PrismCRDT({ nodeId: 'validation-b' });

  await a.registerNode({ gpu: true, wasm: true, quantization: true });
  await b.registerNode({ gpu: false, wasm: true, quantization: true });
  await a.deployModel(model);
  b.merge(a);

  const first = await b.infer({
    id: 'validation-1',
    modelId: model.id,
    input: 'Validate CRDT cache and routing.',
  });
  const second = await b.infer({
    id: 'validation-2',
    modelId: model.id,
    input: 'Validate CRDT cache and routing.',
  });

  if (first.cached !== false || second.cached !== true) {
    throw new Error('CRDT cache did not report expected miss/hit sequence');
  }

  console.log('OK PrismCRDT deploy/merge/infer/cache');
} catch (error) {
  fail('PrismCRDT', error);
}

try {
  const planner = new EdgePlacementPlanner();
  const plan = planner.plan([
    {
      id: 'edge-a',
      name: 'Edge A',
      region: 'us-east',
      capabilities: { gpu: true, wasm: true, quantization: true },
      models: ['validation-model'],
      status: 'online',
      lastHeartbeat: Date.now(),
      loadScore: 1,
    },
    {
      id: 'edge-b',
      name: 'Edge B',
      region: 'eu-west',
      capabilities: { gpu: false, wasm: true, quantization: true },
      models: ['validation-model'],
      status: 'online',
      lastHeartbeat: Date.now(),
      loadScore: 0,
    },
  ], model, {
    modelId: 'validation-model',
    preferredRegion: 'us-east',
    requireWasm: true,
  });

  if (plan.selectedNodeId !== 'edge-a' || !plan.scores[0].reasons.includes('preferred-region')) {
    throw new Error('Edge placement planner returned unexpected plan');
  }

  console.log('OK edge placement planner');
} catch (error) {
  fail('edge placement planner', error);
}

try {
  const engine = new InferenceEngine({ maxBatchSize: 4, quantization: 'int8' });
  await engine.loadModel(model);

  const single = await engine.infer(model.id, 'Validate inference engine.');
  const batch = await engine.batchInfer(model.id, ['one', 'two', 'three']);
  const diagnostics = engine.getDiagnostics();

  if (!single.text || batch.length !== 3) {
    throw new Error('Inference engine returned unexpected output');
  }
  if (diagnostics.status !== 'ready' || diagnostics.models[0]?.runtime !== 'simulated') {
    throw new Error('Inference diagnostics did not report the loaded simulated runtime');
  }

  console.log('OK InferenceEngine infer/batchInfer/diagnostics');
} catch (error) {
  fail('InferenceEngine', error);
}

try {
  const runtime = new OnnxRuntimeWebRuntime({
    importOrt: () => import('onnxruntime-web'),
    readFile: async (path) => new Uint8Array(await readFile(path)),
  });
  const engine = new InferenceEngine({ runtimes: [runtime] });
  await engine.loadModel({
    id: 'validation-onnx',
    name: 'Validation ONNX',
    version: '1.0.0',
    format: 'onnx',
    size: 112,
    capabilities: ['validation'],
    metadata: {
      modelPath: 'test/fixtures/onnx/add-one.onnx',
      executionProviders: ['wasm'],
      sha256: addOneSha256,
      expectedSize: 112,
    },
  });
  const result = await engine.infer('validation-onnx', {
    inputName: 'X',
    data: [41],
    dims: [1],
    type: 'float32',
  }, {
    cache: false,
  });

  const output = result.raw?.outputs?.Y;
  if (!result.text.includes('ONNX inference produced') || Array.from(output?.data || [])[0] !== 42) {
    throw new Error('ONNX runtime smoke check returned unexpected output');
  }

  console.log('OK optional ONNX runtime real fixture');
} catch (error) {
  fail('optional ONNX runtime', error);
}

try {
  let calls = 0;
  const runtime = new HttpInferenceRuntime({
    endpoint: 'https://example.test/v1/chat/completions',
    apiKey: 'validation-key',
    fetch: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init.body));
      const headers = init.headers || {};

      if (headers.authorization !== 'Bearer validation-key') {
        throw new Error('HTTP runtime did not attach bearer auth');
      }
      if (body.model !== 'validation-remote-model' || body.stream !== false) {
        throw new Error('HTTP runtime sent an unexpected OpenAI-compatible request');
      }

      return new Response(JSON.stringify({
        choices: [
          { message: { content: `remote:${body.messages[0].content}` } },
        ],
      }), { status: 200 });
    },
  });
  const engine = new InferenceEngine({ runtimes: [runtime] });
  await engine.loadModel({
    id: 'validation-remote',
    name: 'Validation Remote Gateway',
    version: '1.0.0',
    format: 'openai-compatible',
    size: 1,
    capabilities: ['chat'],
    metadata: {
      remoteModel: 'validation-remote-model',
    },
  });
  const result = await engine.infer('validation-remote', 'Validate HTTP runtime.', {
    cache: false,
    maxTokens: 16,
  });
  const diagnostics = engine.getDiagnostics();

  if (calls !== 1 || result.text !== 'remote:Validate HTTP runtime.' || result.source !== 'remote') {
    throw new Error('HTTP runtime smoke check returned unexpected output');
  }
  if (diagnostics.models[0]?.session.headers.authorization !== '[redacted]') {
    throw new Error('Inference diagnostics leaked HTTP authorization header');
  }

  console.log('OK HTTP/OpenAI-compatible inference runtime');
} catch (error) {
  fail('HTTP/OpenAI-compatible inference runtime', error);
}

try {
  let primaryCalls = 0;
  const primary = {
    id: 'validation-primary-runtime',
    supports: () => true,
    load: async () => ({ runtime: 'validation-primary-runtime' }),
    infer: async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) {
        throw new Error('transient validation failure');
      }
      return {
        text: 'resilient:ok',
        source: 'remote',
        runtime: 'validation-primary-runtime',
      };
    },
  };
  const runtime = new ResilientInferenceRuntime({
    primary,
    maxRetries: 1,
    timeoutMs: 100,
  });
  const engine = new InferenceEngine({ runtimes: [runtime] });

  await engine.loadModel({
    id: 'validation-resilient',
    name: 'Validation Resilient Runtime',
    version: '1.0.0',
    format: 'remote',
    size: 1,
    capabilities: ['validation'],
  });

  const result = await engine.infer('validation-resilient', 'Validate resilient runtime.', {
    cache: false,
  });

  if (
    primaryCalls !== 2
    || result.text !== 'resilient:ok'
    || result.raw?.runtime !== 'resilient'
    || result.raw?.innerRuntime !== 'validation-primary-runtime'
    || result.raw?.attempts !== 2
    || result.raw?.circuitBreaker?.state !== 'closed'
  ) {
    throw new Error('Resilient runtime smoke check returned unexpected output');
  }

  let failingPrimaryCalls = 0;
  let now = 1_000;
  const resilientMonitor = new ResilientRuntimeMonitor({
    maxEvents: 10,
    now: () => now,
  });
  const circuitRuntime = new ResilientInferenceRuntime({
    primary: {
      id: 'validation-failing-primary',
      supports: () => true,
      load: async () => ({ runtime: 'validation-failing-primary' }),
      infer: async () => {
        failingPrimaryCalls += 1;
        throw new Error('validation primary down');
      },
    },
    fallback: {
      id: 'validation-fallback-runtime',
      supports: () => true,
      load: async () => ({ runtime: 'validation-fallback-runtime' }),
      infer: async () => ({
        text: 'resilient:fallback',
        source: 'remote',
      }),
    },
    maxRetries: 0,
    timeoutMs: 100,
    circuitBreaker: {
      failureThreshold: 1,
      recoveryMs: 1_000,
      now: () => now,
    },
    onEvent: resilientMonitor.handleEvent,
  });
  const circuitEngine = new InferenceEngine({ runtimes: [circuitRuntime] });
  await circuitEngine.loadModel({
    id: 'validation-resilient-circuit',
    name: 'Validation Resilient Circuit',
    version: '1.0.0',
    format: 'remote',
    size: 1,
    capabilities: ['validation'],
  });

  const opened = await circuitEngine.infer('validation-resilient-circuit', 'Open circuit.', {
    cache: false,
  });
  const skipped = await circuitEngine.infer('validation-resilient-circuit', 'Skip primary.', {
    cache: false,
  });
  const resilientSnapshot = resilientMonitor.getSnapshot();
  const resilientHealth = resilientMonitor.getHealthCheck();
  const resilientReport = resilientMonitor.toJSON();
  const resilientMetrics = resilientMonitor.toPrometheusMetrics();
  const resilientAlerts = resilientMonitor.evaluateAlerts();
  const resilientAlertStates = resilientMonitor.updateAlertStates();
  const resilientAlertSummary = resilientMonitor.getAlertSummary();

  if (
    failingPrimaryCalls !== 1
    || opened.text !== 'resilient:fallback'
    || opened.raw?.circuitBreaker?.state !== 'open'
    || skipped.raw?.innerRuntime !== 'validation-fallback-runtime'
    || skipped.raw?.errors?.[0] !== 'Primary runtime circuit is open'
    || resilientSnapshot.health !== 'degraded'
    || resilientSnapshot.totals.events !== 5
    || resilientSnapshot.totals.circuitOpened !== 1
    || resilientSnapshot.totals.primarySkipped !== 1
    || resilientSnapshot.runtimes['validation-fallback-runtime']?.events !== 2
    || resilientHealth.statusCode !== 206
    || resilientHealth.ok !== false
    || resilientReport.status !== 'degraded'
    || resilientReport.recentEvents.length !== 5
    || !resilientMetrics.includes('prism_resilient_runtime_health_status{status="degraded"} 1')
    || !resilientMetrics.includes('prism_resilient_runtime_runtime_events_total{runtime="validation-fallback-runtime"} 2')
    || resilientAlerts[0]?.id !== 'resilient-runtime-circuit-open'
    || resilientAlerts[0]?.severity !== 'warning'
    || resilientAlertStates[0]?.status !== 'active'
    || resilientAlertStates[0]?.occurrences !== 1
    || resilientAlertSummary.active !== 1
    || resilientAlertSummary.highestSeverity !== 'warning'
  ) {
    throw new Error('Resilient runtime circuit breaker smoke check returned unexpected output');
  }

  console.log('OK resilient inference runtime');
} catch (error) {
  fail('resilient inference runtime', error);
}

try {
  let calls = 0;
  const runtime = new CloudflareWorkersAIRuntime({
    ai: {
      run: async (remoteModel, input, options) => {
        calls += 1;
        if (remoteModel !== '@cf/meta/llama-3.1-8b-instruct') {
          throw new Error('Workers AI runtime selected the wrong remote model');
        }
        if (input.prompt !== 'Validate Workers AI runtime.' || options.gateway.id !== 'validation-gateway') {
          throw new Error('Workers AI runtime sent an unexpected binding request');
        }
        return {
          response: `cf:${input.prompt}`,
        };
      },
    },
    gatewayId: 'validation-gateway',
  });
  const engine = new InferenceEngine({ runtimes: [runtime] });
  await engine.loadModel({
    id: 'validation-workers-ai',
    name: 'Validation Workers AI',
    version: '1.0.0',
    format: 'remote',
    size: 1,
    capabilities: ['chat'],
    metadata: {
      runtime: 'cloudflare-workers-ai',
      remoteModel: '@cf/meta/llama-3.1-8b-instruct',
    },
  });
  const result = await engine.infer('validation-workers-ai', 'Validate Workers AI runtime.', {
    cache: false,
  });

  if (calls !== 1 || result.text !== 'cf:Validate Workers AI runtime.' || result.raw?.mode !== 'binding') {
    throw new Error('Workers AI runtime smoke check returned unexpected output');
  }

  console.log('OK Cloudflare Workers AI runtime');
} catch (error) {
  fail('Cloudflare Workers AI runtime', error);
}

try {
  let calls = 0;
  const runtime = new OllamaRuntime({
    fetch: async (url, init) => {
      calls += 1;
      const body = JSON.parse(String(init.body));

      if (url !== 'http://localhost:11434/api/chat') {
        throw new Error('Ollama runtime called the wrong endpoint');
      }
      if (body.model !== 'llama3.2' || body.messages[0].content !== 'Validate Ollama runtime.') {
        throw new Error('Ollama runtime sent an unexpected chat request');
      }

      return new Response(JSON.stringify({
        message: {
          role: 'assistant',
          content: `ollama:${body.messages[0].content}`,
        },
        done: true,
      }), { status: 200 });
    },
  });
  const engine = new InferenceEngine({ runtimes: [runtime] });
  await engine.loadModel({
    id: 'validation-ollama',
    name: 'Validation Ollama',
    version: '1.0.0',
    format: 'ollama',
    size: 1,
    capabilities: ['chat'],
    metadata: {
      model: 'llama3.2',
    },
  });
  const result = await engine.infer('validation-ollama', 'Validate Ollama runtime.', {
    cache: false,
  });

  if (calls !== 1 || result.text !== 'ollama:Validate Ollama runtime.' || result.raw?.runtime !== 'ollama') {
    throw new Error('Ollama runtime smoke check returned unexpected output');
  }

  console.log('OK Ollama local runtime');
} catch (error) {
  fail('Ollama local runtime', error);
}

try {
  let inferenceCalls = 0;
  const kvNamespace = {
    store: new Map(),
    async get(key) {
      const raw = this.store.get(key);
      return raw ? JSON.parse(raw.value) : null;
    },
    async put(key, value, options) {
      this.store.set(key, { value, options });
    },
  };
  const vercel = new VercelEdgeAdapter({
    platform: 'vercel',
    region: 'validation',
    cacheTtl: 60,
  }, {
    infer: async (request, context) => {
      inferenceCalls += 1;

      return {
        id: request.id,
        modelId: request.modelId,
        output: {
          handler: 'injected',
          edgeId: context.edgeId,
        },
        latency: 3,
        edgeId: context.edgeId,
        timestamp: Date.now(),
      };
    },
  });
  const cloudflare = new CloudflareEdgeAdapter({
    platform: 'cloudflare',
    region: 'validation',
    cacheTtl: 60,
  }, {
    cache: new CloudflareKVEdgeCache(kvNamespace),
  });

  for (const adapter of [vercel, cloudflare]) {
    const response = await adapter.handleRequest(new Request('https://prism.local', {
      method: 'POST',
      body: JSON.stringify({
        id: 'edge-validation',
        modelId: model.id,
        input: 'Validate edge adapter.',
      }),
    }));
    const body = await response.json();
    if (!body.success) {
      throw new Error('Edge adapter returned unsuccessful response');
    }
    if (response.headers.get('cache-control') !== 'no-store') {
      throw new Error('Edge adapter did not protect HTTP cache headers');
    }
  }

  const cachedResponse = await vercel.handleRequest(new Request('https://prism.local', {
    method: 'POST',
    body: JSON.stringify({
      id: 'edge-validation',
      modelId: model.id,
      input: 'Validate edge adapter.',
    }),
  }));
  const cachedBody = await cachedResponse.json();

  if (inferenceCalls !== 1 || cachedBody.cached !== true || cachedBody.data.output.handler !== 'injected') {
    throw new Error('Edge adapter did not use injected handler/cache as expected');
  }

  const storedKvEntries = Array.from(kvNamespace.store.values());
  if (storedKvEntries.length !== 1 || storedKvEntries[0].options.expirationTtl !== 60) {
    throw new Error('Cloudflare KV cache adapter did not persist with expirationTtl');
  }

  const gatewayEvents = [];
  const gateway = new PrismEdgeGateway({
    nodeId: 'validation-gateway',
    platform: 'cloudflare',
    region: 'validation',
    edgeId: 'cloudflare-validation',
    cacheTtl: 60,
    model: {
      ...model,
      id: 'validation-gateway-model',
      format: 'remote',
      size: 1,
    },
    enrichOutput: (result, _request, context) => ({
      ...result,
      output: {
        ...result.output,
        region: context.region,
      },
    }),
    onEvent: event => {
      gatewayEvents.push(event);
    },
  });
  const health = await gateway.health();
  const firstGatewayResponse = await gateway.handleInferenceRequest(new Request('https://prism.local/infer', {
    method: 'POST',
    body: JSON.stringify({
      id: 'gateway-validation-1',
      modelId: 'validation-gateway-model',
      input: 'Validate PrismEdgeGateway.',
    }),
  }));
  const repeatGatewayResponse = await gateway.handleInferenceRequest(new Request('https://prism.local/infer', {
    method: 'POST',
    body: JSON.stringify({
      id: 'gateway-validation-2',
      modelId: 'validation-gateway-model',
      input: 'Validate PrismEdgeGateway.',
    }),
  }));
  const firstGatewayBody = await firstGatewayResponse.json();
  const repeatGatewayBody = await repeatGatewayResponse.json();
  const routerHealthResponse = await gateway.handleRequest(new Request('https://prism.local/health', {
    headers: { 'x-prism-request-id': 'validation-trace-id' },
  }));
  const routerHealthBody = await routerHealthResponse.json();
  const readinessResponse = await gateway.handleRequest(new Request('https://prism.local/ready'));
  const readinessBody = await readinessResponse.json();
  const openapiResponse = await gateway.handleRequest(new Request('https://prism.local/openapi.json'));
  const openapiBody = await openapiResponse.json();
  let clientTraceHeader;
  const client = new PrismEdgeClient({
    baseUrl: 'https://prism.local',
    trace: {
      requestId: 'validation-client-trace-id',
    },
    fetch: (input, init) => {
      const request = new Request(input, init);
      clientTraceHeader = request.headers.get('x-prism-request-id');
      return gateway.handleRequest(request);
    },
  });
  const clientHealth = await client.health();
  const clientReadiness = await client.ready();
  const clientWaitReadiness = await client.waitUntilReady({
    timeoutMs: 1_000,
    intervalMs: 0,
  });
  const clientOpenAPI = await client.openapi();
  const clientMetrics = await client.metrics();
  const clientEnvelope = await client.inferEnvelope({
    id: 'gateway-client-envelope-validation',
    modelId: 'validation-gateway-model',
    input: 'Validate PrismEdgeClient envelope.',
  });
  const clientInference = await client.infer({
    id: 'gateway-client-validation',
    modelId: 'validation-gateway-model',
    input: 'Validate PrismEdgeClient.',
  });
  const gatewayMetricsSnapshot = gateway.getMetricsSnapshot();
  const protectedGateway = new PrismEdgeGateway({
    nodeId: 'validation-protected-gateway',
    platform: 'cloudflare',
    edgeId: 'protected-validation',
    model: {
      ...model,
      id: 'validation-protected-model',
      format: 'remote',
      size: 1,
    },
    auth: {
      bearerToken: 'validation-token',
    },
    rateLimit: {
      limit: 1,
      windowMs: 60_000,
      key: request => request.headers.get('authorization') ?? 'anonymous',
    },
  });
  const protectedClient = new PrismEdgeClient({
    baseUrl: 'https://protected.prism.local',
    bearerToken: 'validation-token',
    fetch: (input, init) => protectedGateway.handleRequest(new Request(input, init)),
  });
  let transientFailures = 0;
  const resilientClient = new PrismEdgeClient({
    baseUrl: 'https://resilient.prism.local',
    retry: {
      retries: 1,
      backoffMs: 0,
    },
    fetch: (input, init) => {
      if (transientFailures === 0) {
        transientFailures += 1;
        return Promise.resolve(new Response(JSON.stringify({
          success: false,
          error: { code: 'TRANSIENT', message: 'Transient edge failure' },
          latency: 0,
          cached: false,
        }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }));
      }

      return gateway.handleRequest(new Request(input, init));
    },
  });
  const deniedProtectedResponse = await protectedGateway.handleRequest(new Request('https://protected.prism.local/infer', {
    method: 'POST',
    body: JSON.stringify({
      id: 'protected-denied',
      modelId: 'validation-protected-model',
      input: 'Missing token.',
    }),
  }));
  const protectedInference = await protectedClient.infer({
    id: 'protected-allowed',
    modelId: 'validation-protected-model',
    input: 'Authorized PrismEdgeClient.',
  });
  const resilientInference = await resilientClient.infer({
    id: 'resilient-client-validation',
    modelId: 'validation-gateway-model',
    input: 'Validate PrismEdgeClient retry.',
  });
  let rateLimited = false;
  try {
    await protectedClient.infer({
      id: 'protected-limited',
      modelId: 'validation-protected-model',
      input: 'Rate limited PrismEdgeClient.',
    });
  } catch (error) {
    rateLimited = error?.status === 429 && error?.code === 'RATE_LIMITED';
  }
  const protectedSpec = protectedGateway.getOpenAPISpec();
  const protectedMetrics = protectedGateway.toPrometheusMetrics();
  let releaseOverload;
  const overloadGateway = new PrismEdgeGateway({
    nodeId: 'validation-overload-gateway',
    platform: 'cloudflare',
    edgeId: 'overload-validation',
    model: {
      ...model,
      id: 'validation-overload-model',
      format: 'remote',
      size: 1,
    },
    overload: {
      maxConcurrentInference: 1,
      retryAfterMs: 2_000,
    },
    infer: request => new Promise(resolve => {
      releaseOverload = resolve;
    }).then(() => ({
      id: request.id,
      modelId: request.modelId,
      output: { text: 'overload slot released' },
      latency: 1,
      edgeId: 'overload-validation',
      timestamp: Date.now(),
    })),
  });
  const busyInference = overloadGateway.handleRequest(new Request('https://overload.prism.local/infer', {
    method: 'POST',
    body: JSON.stringify({
      id: 'overload-busy',
      modelId: 'validation-overload-model',
      input: 'Occupy overload slot.',
    }),
  }));
  for (let attempt = 0; attempt < 10 && !releaseOverload; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!releaseOverload) {
    throw new Error('Overload validation did not acquire the first inference slot');
  }
  const overloadedResponse = await overloadGateway.handleRequest(new Request('https://overload.prism.local/infer', {
    method: 'POST',
    body: JSON.stringify({
      id: 'overload-rejected',
      modelId: 'validation-overload-model',
      input: 'Should be rejected while saturated.',
    }),
  }));
  const overloadedBody = await overloadedResponse.json();
  releaseOverload();
  await busyInference;
  const overloadMetrics = overloadGateway.toPrometheusMetrics();
  let idempotentCalls = 0;
  const idempotentGateway = new PrismEdgeGateway({
    nodeId: 'validation-idempotent-gateway',
    platform: 'cloudflare',
    edgeId: 'idempotent-validation',
    model: {
      ...model,
      id: 'validation-idempotent-model',
      format: 'remote',
      size: 1,
    },
    idempotency: {
      ttlMs: 60_000,
    },
    infer: request => {
      idempotentCalls += 1;
      return Promise.resolve({
        id: request.id,
        modelId: request.modelId,
        output: { text: 'idempotent output' },
        latency: 1,
        edgeId: 'idempotent-validation',
        timestamp: Date.now(),
      });
    },
  });
  const idempotentRequest = id => new Request('https://idempotent.prism.local/infer', {
    method: 'POST',
    headers: { 'idempotency-key': 'validation-idempotency-key' },
    body: JSON.stringify({
      id,
      modelId: 'validation-idempotent-model',
      input: 'Deduplicate validation request.',
    }),
  });
  const idempotentFirst = await idempotentGateway.handleRequest(idempotentRequest('idempotent-first'));
  const idempotentHit = await idempotentGateway.handleRequest(idempotentRequest('idempotent-second'));
  const idempotentHitBody = await idempotentHit.json();

  if (
    !health.ok
    || !routerHealthBody.ok
    || readinessResponse.status !== 200
    || readinessBody.ready !== true
    || readinessBody.checks.modelDeployed.ok !== true
    || routerHealthResponse.headers.get('x-prism-request-id') !== 'validation-trace-id'
    || clientTraceHeader !== 'validation-client-trace-id'
    || !gatewayEvents.some(event => event.route === 'health' && event.requestId === 'validation-trace-id')
    || !gatewayEvents.some(event => event.route === 'infer' && event.status === 200)
    || !clientHealth.ok
    || clientReadiness.ready !== true
    || clientWaitReadiness.ready !== true
    || clientEnvelope.success !== true
    || clientEnvelope.cached !== false
    || clientEnvelope.requestId !== 'validation-client-trace-id'
    || clientEnvelope.data.edgeId !== 'cloudflare-validation'
    || openapiBody.openapi !== '3.1.0'
    || clientOpenAPI.openapi !== '3.1.0'
    || !openapiBody.paths['/infer']?.post
    || !openapiBody.paths['/ready']?.get
    || !openapiBody.paths['/metrics']?.get
    || !clientMetrics.includes('prism_edge_gateway_requests_total')
    || gatewayMetricsSnapshot.routes.infer.status['200'] < 2
    || openapiBody.components.schemas.InferenceRequest.properties.modelId.const !== 'validation-gateway-model'
    || health.stats.models !== 1
    || firstGatewayBody.data.edgeId !== 'cloudflare-validation'
    || clientInference.edgeId !== 'cloudflare-validation'
    || deniedProtectedResponse.status !== 401
    || protectedInference.edgeId !== 'protected-validation'
    || resilientInference.edgeId !== 'cloudflare-validation'
    || transientFailures !== 1
    || !rateLimited
    || !protectedSpec.paths['/infer']?.post
    || !protectedSpec.paths['/metrics']?.get
    || !protectedSpec.components.securitySchemes?.bearerAuth
    || !protectedMetrics.includes('prism_edge_gateway_rate_limited_total 1')
    || overloadedResponse.status !== 503
    || overloadedBody.error?.code !== 'OVERLOADED'
    || overloadedResponse.headers.get('retry-after') !== '2'
    || !overloadMetrics.includes('prism_edge_gateway_overloaded_total 1')
    || idempotentCalls !== 1
    || idempotentFirst.headers.get('x-prism-idempotency') !== 'created'
    || idempotentHit.headers.get('x-prism-idempotency') !== 'hit'
    || idempotentHitBody.data.id !== 'idempotent-first'
    || firstGatewayBody.data.output.region !== 'validation'
    || repeatGatewayBody.cached !== true
  ) {
    throw new Error('PrismEdgeGateway smoke check returned unexpected output');
  }

  console.log('OK edge adapters, PrismEdgeGateway, and PrismEdgeClient infer/cache/security/metrics headers');
} catch (error) {
  fail('edge adapters', error);
}

try {
  const manager = new ModelShardManager();
  const first = new Uint8Array([1, 2, 3]);
  const second = new Uint8Array([4, 5]);
  const manifest = await manager.loadShardedModel('validation-sharded-model', [
    { index: 0, data: first, expectedSize: first.byteLength },
    { index: 1, data: second, expectedSize: second.byteLength },
  ]);
  const combined = new Uint8Array(await manager.combineShards('validation-sharded-model'));

  if (manifest.shardCount !== 2 || manifest.totalSize !== 5 || combined.join(',') !== '1,2,3,4,5') {
    throw new Error('Model sharding smoke check returned unexpected bytes');
  }

  console.log('OK verified model sharding');
} catch (error) {
  fail('model sharding', error);
}

try {
  const signed = await signModelManifest({
    modelId: 'validation-sharded-model',
    sha256: '1'.repeat(64),
    shardCount: 2,
  }, 'validation-signing-secret', {
    keyId: 'validation-key',
    signedAt: '2026-07-03T00:00:00.000Z',
  });
  const verified = await verifySignedModelManifest(signed, 'validation-signing-secret', 'validation-key');
  const tampered = await verifySignedModelManifest({
    ...signed,
    sha256: '0'.repeat(64),
  }, 'validation-signing-secret', 'validation-key');

  if (!verified.valid || tampered.valid || tampered.reason !== 'signature-mismatch') {
    throw new Error('Model manifest signing smoke check returned unexpected verification result');
  }

  console.log('OK signed model manifests');
} catch (error) {
  fail('signed model manifests', error);
}

try {
  const encrypted = await encryptModelArtifact(new Uint8Array([80, 82, 73, 83, 77]), 'validation-artifact-secret', {
    iterations: 1_000,
    additionalData: {
      modelId: 'validation-sharded-model',
      sha256: '1'.repeat(64),
    },
  });
  const decrypted = await decryptModelArtifact(encrypted, 'validation-artifact-secret', {
    additionalData: {
      modelId: 'validation-sharded-model',
      sha256: '1'.repeat(64),
    },
  });

  if (new TextDecoder().decode(decrypted) !== 'PRISM' || encrypted.algorithm !== 'AES-256-GCM') {
    throw new Error('Model artifact encryption smoke check returned unexpected output');
  }

  console.log('OK encrypted model artifacts');
} catch (error) {
  fail('encrypted model artifacts', error);
}

try {
  const streamer = new StreamingInference(undefined, {
    edgeId: 'validation-stream',
    source: async function* () {
      yield 'PRISM';
      yield ' streams';
      yield { delta: ' tokens', cached: false };
    },
  });
  const chunks = [];

  for await (const chunk of streamer.streamInfer({
    id: 'stream-validation',
    modelId: model.id,
    input: 'Validate streaming.',
  })) {
    chunks.push(chunk);
  }

  const final = chunks[chunks.length - 1];
  if (!final.done || final.output !== 'PRISM streams tokens' || chunks.some((chunk, index) => chunk.sequence !== index)) {
    throw new Error('Streaming inference smoke check returned unexpected chunks');
  }

  console.log('OK pluggable streaming inference');
} catch (error) {
  fail('streaming inference', error);
}

try {
  const batcher = new AdaptiveBatcher({
    initialBatchSize: 8,
    targetLatencyMs: 35,
  });
  batcher.recordResult({ latencyMs: 12, queueDepth: 64, success: true });
  batcher.recordResult({ latencyMs: 16, queueDepth: 64, success: true });
  batcher.recordResult({ latencyMs: 18, queueDepth: 64, success: true });
  const metrics = batcher.getMetrics();

  if (metrics.samples !== 3 || metrics.queuePressure <= 0 || metrics.optimalBatchSize <= 8) {
    throw new Error('Adaptive batching smoke check returned unexpected metrics');
  }

  console.log('OK adaptive batching policy');
} catch (error) {
  fail('adaptive batching', error);
}

console.log('\nAll smoke checks passed.');
