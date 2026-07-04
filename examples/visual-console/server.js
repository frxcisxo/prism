import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ModelShardManager, PrismCRDT } from '../../dist/index.js';
import { VercelEdgeAdapter } from '../../dist/edge.js';
import { InferenceEngine, ResilientInferenceRuntime, ResilientRuntimeMonitor } from '../../dist/inference.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 5177);

const model = {
  id: 'edge-planner-small',
  name: 'Edge Planner Small',
  version: '1.0.0',
  format: 'onnx',
  size: 112,
  capabilities: ['planning', 'routing'],
  quantization: 'int8',
};

const appState = createState();

function createState() {
  const resilience = createResilienceBundle();

  return {
    north: new PrismCRDT({ nodeId: 'north-edge' }),
    south: new PrismCRDT({ nodeId: 'south-edge' }),
    engine: new InferenceEngine({ maxBatchSize: 4, quantization: 'int8' }),
    resilience,
    deployed: false,
    engineLoaded: false,
    resilienceLoaded: false,
    synced: false,
    events: [],
  };
}

function createResilienceBundle() {
  const monitor = new ResilientRuntimeMonitor({ maxEvents: 20 });
  let primaryCalls = 0;
  const resilientModel = {
    id: 'visual-resilient-chat',
    name: 'Visual Resilient Chat',
    version: '1.0.0',
    format: 'remote',
    size: 1,
    capabilities: ['chat', 'resilience'],
  };
  const primary = {
    id: 'visual-primary-runtime',
    supports: candidate => candidate.id === resilientModel.id,
    load: async () => ({ runtime: 'visual-primary-runtime' }),
    infer: async () => {
      primaryCalls += 1;
      throw new Error('visual primary runtime unavailable');
    },
  };
  const fallback = {
    id: 'visual-fallback-runtime',
    supports: candidate => candidate.id === resilientModel.id,
    load: async () => ({ runtime: 'visual-fallback-runtime' }),
    infer: async (_model, _session, input) => ({
      text: `fallback:${input.normalized}`,
      source: 'remote',
      runtime: 'visual-fallback-runtime',
    }),
  };
  const runtime = new ResilientInferenceRuntime({
    primary,
    fallback,
    maxRetries: 0,
    timeoutMs: 100,
    circuitBreaker: {
      failureThreshold: 1,
      recoveryMs: 30_000,
    },
    onEvent: monitor.handleEvent,
  });

  return {
    model: resilientModel,
    monitor,
    engine: new InferenceEngine({ runtimes: [runtime] }),
    getPrimaryCalls: () => primaryCalls,
  };
}

async function resetState() {
  const next = createState();
  Object.assign(appState, next);
  pushEvent('Demo reset');
  return snapshot();
}

async function runScenario(prompt) {
  await ensureNetwork();
  pushEvent('Registered north-edge and south-edge');

  if (!appState.deployed) {
    await appState.north.deployModel(model);
    appState.deployed = true;
    pushEvent('Deployed edge-planner-small on north-edge');
  }

  await ensureInferenceEngine();
  await ensureResilienceEngine();

  if (!appState.synced) {
    appState.south.merge(appState.north);
    appState.synced = true;
    pushEvent('Merged CRDT state into south-edge');
  }

  const inference = await infer(prompt, false);
  const resilience = await exerciseResilience(prompt);
  const sharding = await verifySharding();

  return {
    ...snapshot(),
    inference,
    resilience,
    sharding,
  };
}

async function repeatInference(prompt) {
  if (!appState.synced) {
    return runScenario(prompt);
  }

  const inference = await infer(prompt, true);
  const resilience = await exerciseResilience(prompt);

  return {
    ...snapshot(),
    inference,
    resilience,
  };
}

async function ensureNetwork() {
  if (appState.north.getStats().nodes === 0) {
    await appState.north.registerNode({ gpu: true, wasm: true, quantization: true });
  }

  if (appState.south.getStats().nodes === 0) {
    await appState.south.registerNode({ gpu: false, wasm: true, quantization: true });
  }
}

async function ensureInferenceEngine() {
  if (appState.engineLoaded) {
    return;
  }

  await appState.engine.loadModel(model);
  appState.engineLoaded = true;
  pushEvent('Loaded edge-planner-small into InferenceEngine');
}

async function ensureResilienceEngine() {
  if (appState.resilienceLoaded) {
    return;
  }

  await appState.resilience.engine.loadModel(appState.resilience.model);
  appState.resilienceLoaded = true;
  pushEvent('Loaded resilient runtime pair with fallback');
}

async function infer(prompt, repeated) {
  const input = prompt || 'Plan a safe edge deployment for a retail store.';
  await ensureInferenceEngine();
  const result = await appState.south.infer({
    id: repeated ? 'visual-repeat' : `visual-${Date.now()}`,
    modelId: model.id,
    input,
  });
  const engineResult = await appState.engine.infer(model.id, input, { cache: true });
  const edge = new VercelEdgeAdapter({
    platform: 'vercel',
    region: 'visual-console',
    cacheTtl: 60,
  }, {
    infer: async (_request, context) => ({
      id: result.id,
      modelId: result.modelId,
      output: result.output,
      latency: result.latency,
      edgeId: context.edgeId,
      timestamp: Date.now(),
      cached: result.cached,
    }),
  });
  const edgeResponse = await edge.handleRequest(new Request('https://prism.local/infer', {
    method: 'POST',
    body: JSON.stringify({
      id: result.id,
      modelId: model.id,
      input,
    }),
  }));

  pushEvent(result.cached ? 'Served repeated inference from CRDT cache' : `Routed inference to ${result.edgeId}`);

  return {
    ...result,
    engine: engineResult,
    edgeStatus: edgeResponse.status,
    edgeCacheHeader: edgeResponse.headers.get('cache-control'),
  };
}

async function exerciseResilience(prompt) {
  await ensureResilienceEngine();
  const input = prompt || 'Plan a safe edge deployment for a retail store.';
  const first = await appState.resilience.engine.infer(appState.resilience.model.id, input, { cache: false });
  const second = await appState.resilience.engine.infer(appState.resilience.model.id, `${input} Use fallback.`, { cache: false });
  const alerts = appState.resilience.monitor.evaluateAlerts();
  const alertStates = appState.resilience.monitor.updateAlertStates();
  const summary = appState.resilience.monitor.getAlertSummary();
  const health = appState.resilience.monitor.getHealthCheck();
  const report = appState.resilience.monitor.toJSON();
  const metrics = appState.resilience.monitor.toPrometheusMetrics();

  pushEvent(`${health.status} resilient runtime: ${summary.active} active alert${summary.active === 1 ? '' : 's'}`);

  return {
    first,
    second,
    primaryCalls: appState.resilience.getPrimaryCalls(),
    health,
    report,
    alerts,
    alertStates,
    summary,
    metricsPreview: metrics.split('\n').slice(0, 8).join('\n'),
  };
}

async function verifySharding() {
  const manager = new ModelShardManager();
  const first = new Uint8Array([80, 82, 73]);
  const second = new Uint8Array([83, 77]);
  const manifest = await manager.loadShardedModel('visual-artifact', [
    { index: 0, data: first, expectedSize: first.byteLength },
    { index: 1, data: second, expectedSize: second.byteLength },
  ]);
  const combined = new Uint8Array(await manager.combineShards('visual-artifact'));
  const artifact = new TextDecoder().decode(combined);

  pushEvent(`Verified ${manifest.shardCount} model shards`);

  return {
    artifact,
    manifest,
  };
}

function snapshot() {
  const northStats = appState.north.getStats();
  const southStats = appState.south.getStats();

  return {
    model,
    deployed: appState.deployed,
    synced: appState.synced,
    northStats,
    southStats,
    diagnostics: appState.engine.getDiagnostics(),
    resilience: appState.resilienceLoaded
      ? {
        health: appState.resilience.monitor.getHealthCheck(),
        report: appState.resilience.monitor.toJSON(),
        alertStates: appState.resilience.monitor.getAlertStates(),
        summary: appState.resilience.monitor.getAlertSummary(),
        primaryCalls: appState.resilience.getPrimaryCalls(),
      }
      : null,
    events: appState.events,
  };
}

function pushEvent(message) {
  appState.events.unshift(`${new Date().toLocaleTimeString()} · ${message}`);
  appState.events = appState.events.slice(0, 8);
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(root, safePath);
  const body = await readFile(filePath);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  }[extname(filePath)] || 'application/octet-stream';

  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);

    if (request.method === 'POST' && url.pathname === '/api/scenario') {
      const body = await readJson(request);
      sendJson(response, 200, await runScenario(body.prompt));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/repeat') {
      const body = await readJson(request);
      sendJson(response, 200, await repeatInference(body.prompt));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/reset') {
      sendJson(response, 200, await resetState());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, snapshot());
      return;
    }

    if (request.method === 'GET') {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PRISM visual console: http://127.0.0.1:${port}/`);
});
