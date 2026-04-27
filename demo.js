#!/usr/bin/env node

/**
 * PRISM Demo Script
 * Demonstrates the AI-powered edge orchestration library
 */

import Prism from './dist/index.mjs';

async function main() {
  console.log('🚀 PRISM - AI-Powered Edge Orchestration Demo\n');

  // Create a new Prism instance
  const prism = new Prism({ nodeId: 'demo-node' });
  console.log('✅ Created Prism instance');

  // Register a node with capabilities
  const nodeResult = await prism.registerNode({
    gpu: true,
    wasm: true,
    quantization: true,
  });
  console.log('✅ Registered node:', nodeResult);

  // Deploy a model
  const modelResult = await prism.deployModel({
    id: 'llama-3.1-8b-demo',
    name: 'Llama 3.1 8B Demo',
    version: '1.0.0',
    size: 4_000_000_000, // 4GB
    quantization: 'int4',
    maxTokens: 2048,
  });
  console.log('✅ Deployed model:', modelResult);

  // Perform inference
  const inferenceResult = await prism.infer({
    id: 'demo-req-1',
    modelId: 'llama-3.1-8b-demo',
    input: 'What is edge computing?',
    priority: 'normal',
  });
  console.log('✅ Inference result:', inferenceResult);

  // Test caching
  const cachedResult = await prism.infer({
    id: 'demo-req-2',
    modelId: 'llama-3.1-8b-demo',
    input: 'What is edge computing?',
    priority: 'normal',
  });
  console.log('✅ Cached result:', cachedResult.cached ? 'HIT' : 'MISS');

  // Get stats
  const stats = prism.getStats();
  console.log('✅ Node stats:', stats);

  console.log('\n🎉 PRISM demo completed successfully!');
}

main().catch(console.error);