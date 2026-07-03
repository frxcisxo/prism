#!/usr/bin/env node

/**
 * PRISM vertical slice demo.
 *
 * Run:
 *   npm run build
 *   node demo.js
 */

import { PrismCRDT } from './dist/index.js';

const model = {
  id: 'edge-planner-small',
  name: 'PRISM Edge Planner Small',
  version: '0.1.0',
  size: 32_000_000,
  format: 'onnx',
  capabilities: ['planning', 'summarization'],
  quantization: 'int8',
};

async function main() {
  console.log('PRISM vertical slice demo\n');

  const north = new PrismCRDT({ nodeId: 'north-edge' });
  const south = new PrismCRDT({ nodeId: 'south-edge' });

  await north.registerNode({ gpu: true, wasm: true, quantization: true });
  await south.registerNode({ gpu: false, wasm: true, quantization: true });

  await north.deployModel(model);
  console.log('1. north-edge deployed model:', model.id);
  console.log('2. south-edge sees model before sync:', await south.isModelDeployed(model.id));

  south.merge(north);
  console.log('3. south-edge sees model after CRDT merge:', await south.isModelDeployed(model.id));

  const prompt = 'Plan a resilient edge AI workflow for a mobile clinic.';
  const first = await south.infer({
    id: 'demo-request-1',
    modelId: model.id,
    input: prompt,
  });

  const second = await south.infer({
    id: 'demo-request-2',
    modelId: model.id,
    input: prompt,
  });

  north.merge(south);

  console.log('4. first inference:', {
    edgeId: first.edgeId,
    cached: first.cached,
    latencyMs: Number(first.latency.toFixed(2)),
  });
  console.log('5. repeated inference:', {
    requestId: second.id,
    cached: second.cached,
    latencyMs: Number(second.latency.toFixed(2)),
  });
  console.log('6. converged stats:', {
    north: north.getStats().inference,
    south: south.getStats().inference,
  });

  console.log('\nDemo complete: deploy, sync, route, cache, and converge all worked.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
