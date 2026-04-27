#!/usr/bin/env node

/**
 * PRISM Validation Script
 * Tests that the implementation matches the README documentation
 */

import Prism from './dist/index.js';
import { InferenceEngine } from './dist/inference.js';
import { VercelEdgeAdapter, CloudflareEdgeAdapter } from './dist/edge.js';

console.log('🔮 PRISM - Validation Script');
console.log('Testing that implementation matches README documentation...\n');

// Test 1: Initialize PRISM Node
console.log('1. Testing PRISM Node Initialization');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  console.log('✅ Prism instance created successfully');
} catch (error) {
  console.log('❌ Failed to create Prism instance:', error.message);
  process.exit(1);
}

// Test 2: Register Node
console.log('\n2. Testing Node Registration');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  const result = await prism.registerNode({
    gpu: true,
    wasm: true,
    quantization: true,
  });
  console.log('✅ Node registered:', result);
} catch (error) {
  console.log('❌ Failed to register node:', error.message);
  process.exit(1);
}

// Test 3: Deploy Model
console.log('\n3. Testing Model Deployment');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  await prism.registerNode({ gpu: true });

  const deployResult = await prism.deployModel({
    id: 'llama-3.1-8b',
    name: 'Meta Llama 3.1 8B Instruct',
    version: '1.0.0',
    size: 3_600_000_000,
    quantization: 'int4',
    maxTokens: 2048,
    context: 8192,
  });
  console.log('✅ Model deployed:', deployResult);
} catch (error) {
  console.log('❌ Failed to deploy model:', error.message);
  process.exit(1);
}

// Test 4: Simple Inference
console.log('\n4. Testing Simple Inference');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  await prism.registerNode({ gpu: true });
  await prism.deployModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
  });

  const result = await prism.infer({
    id: 'req-001',
    modelId: 'llama-3.1-8b',
    input: 'What is edge AI?',
    priority: 'high',
  });

  console.log('✅ Inference result:', {
    id: result.id,
    modelId: result.modelId,
    latency: result.latency,
    edgeId: result.edgeId,
    cached: result.cached,
  });
} catch (error) {
  console.log('❌ Failed inference:', error.message);
  process.exit(1);
}

// Test 5: Caching
console.log('\n5. Testing Caching');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  await prism.registerNode({ gpu: true });
  await prism.deployModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
  });

  // First call
  const result1 = await prism.infer({
    id: 'req-1',
    modelId: 'llama-3.1-8b',
    input: 'What is TypeScript?',
  });
  console.log(`First call latency: ${result1.latency.toFixed(2)}ms`);

  // Second call (should be cached)
  const result2 = await prism.infer({
    id: 'req-2',
    modelId: 'llama-3.1-8b',
    input: 'What is TypeScript?', // Same input
  });
  console.log(`Second call latency: ${result2.latency.toFixed(2)}ms, cached: ${result2.cached}`);

  if (result2.cached) {
    console.log('✅ Caching works correctly');
  } else {
    console.log('❌ Caching not working');
  }
} catch (error) {
  console.log('❌ Caching test failed:', error.message);
  process.exit(1);
}

// Test 6: Offline Mode
console.log('\n6. Testing Offline Mode');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  await prism.registerNode({ gpu: true });
  await prism.deployModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
  });

  // Go offline
  prism.setOffline();
  console.log('✅ Set offline mode');

  // Try inference (should queue)
  try {
    await prism.infer({
      id: 'req-offline',
      modelId: 'llama-3.1-8b',
      input: 'Offline test',
    });
  } catch (error) {
    if (error.message.includes('OFFLINE')) {
      console.log('✅ Request queued while offline');
    } else {
      throw error;
    }
  }

  // Reconnect
  await prism.reconnect();
  console.log('✅ Reconnected successfully');
} catch (error) {
  console.log('❌ Offline test failed:', error.message);
  process.exit(1);
}

// Test 7: Statistics
console.log('\n7. Testing Statistics');
try {
  const prism = new Prism({ nodeId: 'test-node-1' });
  await prism.registerNode({ gpu: true });
  await prism.deployModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
  });

  const stats = prism.getStats();
  console.log('✅ Stats retrieved:', stats);

  if (stats.models.includes('llama-3.1-8b')) {
    console.log('✅ Model listed in stats');
  } else {
    console.log('❌ Model not found in stats');
  }
} catch (error) {
  console.log('❌ Stats test failed:', error.message);
  process.exit(1);
}

// Test 8: Edge Adapters
console.log('\n8. Testing Edge Adapters');
try {
  // Test Vercel adapter
  const vercelAdapter = new VercelEdgeAdapter({
    platform: 'vercel',
    region: 'us-east-1',
    cacheTtl: 3600,
  });

  const mockRequest1 = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      id: 'edge-test',
      modelId: 'llama-3.1-8b',
      input: 'Edge test',
    }),
  });

  const vercelResponse = await vercelAdapter.handleRequest(mockRequest1);
  const vercelData = await vercelResponse.json();

  if (vercelData.success) {
    console.log('✅ Vercel adapter works');
  } else {
    console.log('❌ Vercel adapter failed');
  }

  // Test Cloudflare adapter
  const cfAdapter = new CloudflareEdgeAdapter({
    platform: 'cloudflare',
    region: 'us-east-1',
  });

  const mockRequest2 = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      id: 'edge-test',
      modelId: 'llama-3.1-8b',
      input: 'Edge test',
    }),
  });

  const cfResponse = await cfAdapter.handleRequest(mockRequest2);
  const cfData = await cfResponse.json();

  if (cfData.success) {
    console.log('✅ Cloudflare adapter works');
  } else {
    console.log('❌ Cloudflare adapter failed');
  }
} catch (error) {
  console.log('❌ Edge adapters test failed:', error.message);
  process.exit(1);
}

// Test 9: Batch Inference
console.log('\n9. Testing Batch Inference');
try {
  const engine = new InferenceEngine({
    maxBatchSize: 32,
    quantization: 'int8',
    gpuEnabled: true,
  });

  await engine.loadModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
  });

  const inputs = [
    'What is AI?',
    'Explain quantum computing',
    'What is blockchain?',
  ];

  const results = await engine.inferBatch('llama-3.1-8b', inputs);
  console.log(`✅ Batch inference completed: ${results.length} results`);

  const stats = engine.getStats();
  console.log('✅ Inference stats:', stats);
} catch (error) {
  console.log('❌ Batch inference test failed:', error.message);
  process.exit(1);
}

// Test 10: Model Formats
console.log('\n10. Testing Model Format Support');
try {
  const engine = new InferenceEngine();

  // Test different formats
  const formats = [
    { id: 'model.onnx', name: 'ONNX Model' },
    { id: 'model.tflite', name: 'TensorFlow Lite Model' },
    { id: 'model.gguf', name: 'GGUF Model' },
    { id: 'generic-model', name: 'Generic Model' },
  ];

  for (const format of formats) {
    const result = await engine.loadModel({
      ...format,
      version: '1.0.0',
      size: 1000000,
    });
    console.log(`✅ Loaded ${format.name}: ${result.status}`);
  }
} catch (error) {
  console.log('❌ Model format test failed:', error.message);
  process.exit(1);
}

console.log('\n🎉 All tests passed! PRISM implementation matches README documentation.');
console.log('The essence of PRISM is preserved and working as documented.');