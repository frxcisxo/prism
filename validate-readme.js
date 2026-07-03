#!/usr/bin/env node

/**
 * PRISM smoke validation.
 *
 * This script validates the public package surface after `npm run build`.
 */

import { AdaptiveBatcher, ModelShardManager, PrismCRDT, StreamingInference } from './dist/index.js';
import { InferenceEngine, OnnxRuntimeWebRuntime } from './dist/inference.js';
import { CloudflareEdgeAdapter, CloudflareKVEdgeCache, VercelEdgeAdapter } from './dist/edge.js';
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
  const engine = new InferenceEngine({ maxBatchSize: 4, quantization: 'int8' });
  await engine.loadModel(model);

  const single = await engine.infer(model.id, 'Validate inference engine.');
  const batch = await engine.batchInfer(model.id, ['one', 'two', 'three']);

  if (!single.text || batch.length !== 3) {
    throw new Error('Inference engine returned unexpected output');
  }

  console.log('OK InferenceEngine infer/batchInfer');
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

  console.log('OK edge adapters infer/cache/security headers');
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
