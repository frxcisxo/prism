/**
 * PRISM Advanced Optimizations Examples
 * 🚀 Demonstrating cutting-edge performance features for 2026
 */

import Prism, { StreamingInference, ModelShardManager } from './src/index.js';
import { InferenceEngine } from './src/inference.js';

// ============================================================================
// 🚀 Example 1: Predictive Caching & Memory Pooling
// ============================================================================

async function predictiveCachingExample() {
  console.log('🔮 Predictive Caching & Memory Pooling');

  const prism = new Prism({
    nodeId: 'optimized-node-1',
    cacheSize: 200 * 1024 * 1024 // 200MB intelligent cache
  });

  await prism.registerNode({
    gpu: true,
    wasm: true,
    quantization: true,
  });

  await prism.deployModel({
    id: 'llama-3.1-8b',
    name: 'Meta Llama 3.1 8B Instruct',
    version: '1.0.0',
    size: 3_600_000_000,
    quantization: 'int4',
  });

  // Simulate repeated queries (common in chat apps)
  const queries = [
    'What is AI?',
    'What is AI?', // Repeated - should be instant
    'Explain machine learning',
    'What is AI?', // Repeated again - predictive cache
    'What is deep learning?',
  ];

  console.log('Processing queries with predictive caching...');

  for (const query of queries) {
    const start = performance.now();
    const result = await prism.infer({
      id: `req-${Math.random()}`,
      modelId: 'llama-3.1-8b',
      input: query,
    });
    const latency = performance.now() - start;

    console.log(`${query.slice(0, 20)}...: ${latency.toFixed(2)}ms ${result.cached ? '(cached)' : ''}`);
  }

  // Check cache efficiency
  const stats = prism.getStats();
  console.log(`📊 Cache utilization: ${stats.cacheStats.utilization.toFixed(1)}%`);
  console.log(`📊 Cache entries: ${stats.cacheStats.entries}`);
}

// ============================================================================
// 🌊 Example 2: Streaming Inference (Real-time Feedback)
// ============================================================================

async function streamingInferenceExample() {
  console.log('\n🌊 Streaming Inference Example');

  const prism = new Prism({ nodeId: 'streaming-node' });
  await prism.registerNode({ gpu: true });

  const streamer = new StreamingInference(prism);

  const request = {
    id: 'stream-req-1',
    modelId: 'llama-3.1-8b',
    input: 'Write a haiku about artificial intelligence',
  };

  console.log('Streaming response:');
  let tokenCount = 0;

  for await (const partial of streamer.streamInfer(request)) {
    if (partial.output && typeof partial.output === 'string') {
      const newTokens = partial.output.split(' ').length - tokenCount;
      if (newTokens > 0) {
        process.stdout.write(`${partial.output.slice(-10)} `);
        tokenCount = partial.output.split(' ').length;
      }
    }
  }
  console.log('\n✅ Streaming complete');
}

// ============================================================================
// 🔀 Example 3: Model Sharding (Large Models)
// ============================================================================

async function modelShardingExample() {
  console.log('\n🔀 Model Sharding for Large Models');

  const shardManager = new ModelShardManager();

  // Simulate loading a 70B parameter model in shards
  const shardUrls = [
    'https://cdn.prism.ai/llama-70b-shard-0.bin',
    'https://cdn.prism.ai/llama-70b-shard-1.bin',
    'https://cdn.prism.ai/llama-70b-shard-2.bin',
    'https://cdn.prism.ai/llama-70b-shard-3.bin',
  ];

  console.log('Loading sharded 70B model...');
  await shardManager.loadShardedModel('llama-70b-sharded', shardUrls);

  // Access individual shards for distributed inference
  for (let i = 0; i < shardUrls.length; i++) {
    const shard = shardManager.getShard('llama-70b-sharded', i);
    console.log(`Shard ${i}: ${shard?.loaded ? '✅ loaded' : '❌ failed'}`);
  }

  // Combine shards when needed for single-GPU inference
  const combinedModel = await shardManager.combineShards('llama-70b-sharded');
  console.log(`Combined model: ${(combinedModel.byteLength / 1024 / 1024 / 1024).toFixed(1)}GB`);
}

// ============================================================================
// 📈 Example 4: Adaptive Batching (Dynamic Throughput)
// ============================================================================

async function adaptiveBatchingExample() {
  console.log('\n📈 Adaptive Batching Example');

  const engine = new InferenceEngine({
    maxBatchSize: 32,
    gpuEnabled: true,
  });

  await engine.loadModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
  });

  // Simulate varying load patterns
  const loadPatterns = [
    { requests: 10, description: 'Light load' },
    { requests: 50, description: 'Medium load' },
    { requests: 100, description: 'High load' },
    { requests: 10, description: 'Back to light' },
  ];

  for (const pattern of loadPatterns) {
    const inputs = Array.from({ length: pattern.requests }, (_, i) =>
      `Request ${i}: Analyze this text for sentiment`
    );

    const startTime = performance.now();
    const results = await engine.inferBatch('llama-3.1-8b', inputs);
    const totalTime = performance.now() - startTime;

    const throughput = pattern.requests / (totalTime / 1000);
    const avgLatency = totalTime / pattern.requests;

    console.log(`${pattern.description}: ${throughput.toFixed(1)} req/sec, ${avgLatency.toFixed(2)}ms avg latency`);
  }
}

// ============================================================================
// 🚀 Example 5: Binary Serialization (Network Efficiency)
// ============================================================================

async function binarySerializationExample() {
  console.log('\n🚀 Binary Serialization Performance');

  const prism = new Prism({ nodeId: 'binary-test-node' });

  // Create large inference result with embeddings
  const largeResult = {
    id: 'perf-test-result',
    modelId: 'llama-3.1-8b',
    output: {
      text: 'A'.repeat(5000), // 5KB text response
      tokens: 1024,
      confidence: 0.92,
      embeddings: Array.from({ length: 2048 }, () => Math.random()), // 2K embeddings
      metadata: {
        model: 'llama-3.1-8b',
        quantization: 'int4',
        timestamp: Date.now(),
        processingTime: 45.2,
      }
    },
    latency: 45.2,
    edgeId: 'gpu-node-1',
    timestamp: Date.now(),
  };

  // Benchmark JSON vs Binary serialization
  const iterations = 1000;

  // JSON serialization
  console.log('Benchmarking serialization methods...');
  let jsonTime = 0, jsonSize = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const serialized = JSON.stringify(largeResult);
    jsonTime += performance.now() - start;
    if (i === 0) jsonSize = new Blob([serialized]).size;
  }

  // Binary serialization
  let binaryTime = 0, binarySize = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const serialized = prism['binarySerializer'].serialize(largeResult);
    binaryTime += performance.now() - start;
    if (i === 0) binarySize = serialized.length;
  }

  console.log('📊 Serialization Performance (1000 iterations):');
  console.log(`JSON: ${(jsonTime / iterations).toFixed(3)}ms avg, ${jsonSize} bytes`);
  console.log(`Binary: ${(binaryTime / iterations).toFixed(3)}ms avg, ${binarySize} bytes`);
  console.log(`🚀 Speed improvement: ${(jsonTime / binaryTime).toFixed(1)}x faster`);
  console.log(`💾 Size reduction: ${(((jsonSize - binarySize) / jsonSize) * 100).toFixed(1)}% smaller`);
}

// ============================================================================
// 🎯 Example 6: Combined Optimizations (Production Scenario)
// ============================================================================

async function productionScenario() {
  console.log('\n🎯 Production Scenario - All Optimizations Combined');

  // Initialize with all optimizations
  const prism = new Prism({
    nodeId: 'production-edge-1',
    cacheSize: 500 * 1024 * 1024 // 500MB cache
  });

  await prism.registerNode({
    gpu: true,
    wasm: true,
    quantization: true,
  });

  // Deploy multiple models
  const models = [
    { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', size: 3_600_000_000 },
    { id: 'qwen-7b', name: 'Qwen 2.5 7B', size: 3_200_000_000 },
    { id: 'mistral-7b', name: 'Mistral 7B', size: 3_000_000_000 },
  ];

  for (const model of models) {
    await prism.deployModel({
      id: model.id,
      name: model.name,
      version: '1.0.0',
      size: model.size,
      quantization: 'int4',
    });
  }

  // Simulate production workload
  const workload = [
    // Chat messages (frequent, similar)
    ...Array.from({ length: 20 }, (_, i) => `User question ${i}: How does AI work?`),

    // Code generation (variable)
    ...Array.from({ length: 10 }, (_, i) => `Write a function to ${['sort an array', 'parse JSON', 'handle errors'][i % 3]}`),

    // Analysis tasks (complex)
    ...Array.from({ length: 5 }, (_, i) => `Analyze the following code for ${['performance', 'security', 'maintainability'][i % 3]} issues`),
  ];

  console.log(`Processing ${workload.length} production requests...`);

  const startTime = performance.now();
  const results = [];

  for (const input of workload) {
    const result = await prism.infer({
      id: `prod-req-${Math.random()}`,
      modelId: 'llama-3.1-8b',
      input,
      priority: 'normal',
    });
    results.push(result);
  }

  const totalTime = performance.now() - startTime;
  const cachedCount = results.filter(r => r.cached).length;

  console.log(`✅ Completed ${results.length} requests in ${totalTime.toFixed(2)}ms`);
  console.log(`📊 Average latency: ${(totalTime / results.length).toFixed(2)}ms`);
  console.log(`📊 Cache hit rate: ${((cachedCount / results.length) * 100).toFixed(1)}%`);
  console.log(`🚀 Throughput: ${(results.length / (totalTime / 1000)).toFixed(1)} req/sec`);

  // Final optimization stats
  const finalStats = prism.getStats();
  console.log('\n📈 Final Optimization Metrics:');
  console.log(`Cache: ${finalStats.cacheStats.utilization.toFixed(1)}% utilized (${finalStats.cacheStats.entries} entries)`);
  console.log(`Adaptive batching: ${finalStats.adaptiveBatchSize} optimal size`);
  console.log(`Connection pooling: ${finalStats.connectionPoolSize} active connections`);
}

// ============================================================================
// 🎉 Run All Examples
// ============================================================================

async function runAllOptimizationExamples() {
  console.log('🚀 PRISM Advanced Optimizations Showcase\n');

  try {
    await predictiveCachingExample();
    await streamingInferenceExample();
    await modelShardingExample();
    await adaptiveBatchingExample();
    await binarySerializationExample();
    await productionScenario();

    console.log('\n🎉 All optimization examples completed successfully!');
    console.log('🚀 PRISM is now optimized for maximum performance in 2026!');
  } catch (error) {
    console.error('❌ Optimization example failed:', error);
    console.error(error);
  }
}

// Export for individual testing
export {
  predictiveCachingExample,
  streamingInferenceExample,
  modelShardingExample,
  adaptiveBatchingExample,
  binarySerializationExample,
  productionScenario,
  runAllOptimizationExamples,
};

// Run all examples if called directly
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('optimizations.ts')) {
  runAllOptimizationExamples();
}