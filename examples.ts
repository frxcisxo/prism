/**
 * PRISM - Example Usage
 * Real-world scenarios for edge AI inference
 */

// ============================================================================
// Example 1: Basic Edge Inference
// ============================================================================

import Prism from '@frxncisxo/prism';

async function basicInference() {
  const prism = new Prism({ nodeId: 'edge-1' });

  // Register with network
  await prism.registerNode({
    gpu: false,
    wasm: true,
    quantization: true,
  });

  // Deploy a lightweight LLM
  await prism.deployModel({
    id: 'llama-3.1-8b-q4',
    name: 'Llama 3.1 8B (4-bit quantized)',
    version: '1.0.0',
    size: 2_000_000_000, // 2GB after quantization
    quantization: 'int4',
    maxTokens: 2048,
  });

  // Run inference
  const result = await prism.infer({
    id: 'req-001',
    modelId: 'llama-3.1-8b-q4',
    input: 'What is edge computing?',
    priority: 'normal',
  });

  console.log('Result:', result);
  // Result: {
  //   id: 'req-001',
  //   modelId: 'llama-3.1-8b-q4',
  //   output: 'Edge computing is...',
  //   latency: 45,
  //   edgeId: 'edge-1',
  //   timestamp: 1713888000000,
  //   cached: false
  // }
}

// ============================================================================
// Example 2: Offline-First (PWA, Mobile)
// ============================================================================

async function offlineFirst() {
  const prism = new Prism({ nodeId: 'mobile-device' });
  await prism.registerNode({ gpu: false, wasm: true, quantization: true });

  await prism.deployModel({
    id: 'qwen-7b-q8',
    name: 'Qwen 2.5 7B (8-bit)',
    version: '1.0.0',
    size: 3_500_000_000,
    quantization: 'int8',
  });

  // Listen for network changes
  window.addEventListener('online', async () => {
    console.log('Back online! Syncing...');
    await prism.reconnect();
  });

  window.addEventListener('offline', () => {
    console.log('Lost connection. Requests will queue.');
    prism.setOffline();
  });

  // User makes requests (works offline or online)
  try {
    const result = await prism.infer({
      id: 'req-mobile-001',
      modelId: 'qwen-7b-q8',
      input: 'Translate "hello world" to Spanish',
    });
    console.log(result.output); // "hola mundo"
  } catch (e) {
    if (e.message.includes('OFFLINE')) {
      console.log('Request queued, will sync when back online');
    }
  }
}

// ============================================================================
// Example 3: Vercel Edge Function (Real-time API)
// ============================================================================

// api/ai.ts
import { VercelEdgeAdapter } from '@frxncisxo/prism/edge';

export const config = { runtime: 'edge' };

const adapter = new VercelEdgeAdapter({
  platform: 'vercel',
  region: 'us-east-1',
  cacheTtl: 3600,
});

export default async (request: Request) => {
  return await adapter.handleRequest(request, process.env);
};

// Usage from frontend:
async function callEdgeAI() {
  const response = await fetch('/api/ai', {
    method: 'POST',
    body: JSON.stringify({
      id: 'req-web-001',
      modelId: 'llama-3.1-8b-q4',
      input: 'Summarize the benefits of edge computing',
    }),
  });

  const data = await response.json();
  console.log(`Response in ${data.latency}ms from ${data.data.edgeId}`);
  // Response in 12ms from vercel-edge
}

// ============================================================================
// Example 4: Batch Processing (High Throughput)
// ============================================================================

import { InferenceEngine } from '@frxncisxo/prism/inference';

async function batchProcessing() {
  const engine = new InferenceEngine({
    maxBatchSize: 32,
    quantization: 'int8',
    gpuEnabled: true,
  });

  await engine.loadModel({
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 16_000_000_000,
  });

  // Process 100 requests at once
  const prompts = Array(100)
    .fill(0)
    .map((_, i) => `Question ${i + 1}: What is AI?`);

  const startTime = performance.now();
  const results = await engine.inferBatch('llama-3.1-8b', prompts);
  const elapsed = performance.now() - startTime;

  console.log(`Processed ${results.length} items in ${elapsed.toFixed(0)}ms`);
  console.log(`Throughput: ${(results.length / (elapsed / 1000)).toFixed(0)} items/sec`);
  // Processed 100 items in 250ms
  // Throughput: 400 items/sec
}

// ============================================================================
// Example 5: Multi-Node Network (Distributed Inference)
// ============================================================================

async function multiNodeNetwork() {
  // Node 1: US East (GPU enabled)
  const edgeUS = new Prism({ nodeId: 'us-east-gpu' });
  await edgeUS.registerNode({ gpu: true, wasm: true, quantization: true });

  // Node 2: EU West (CPU only)
  const edgeEU = new Prism({ nodeId: 'eu-west-cpu' });
  await edgeEU.registerNode({ gpu: false, wasm: true, quantization: true });

  // Both deploy models
  const llama = {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    version: '1.0.0',
    size: 3_600_000_000,
    quantization: 'int4',
  };

  await edgeUS.deployModel(llama);
  await edgeEU.deployModel(llama);

  // PRISM automatically routes to best node:
  // - GPU available? Use GPU node
  // - User in EU? Use nearest node
  // - High load? Use least-loaded node

  const result = await edgeUS.infer({
    id: 'req-distributed',
    modelId: 'llama-3.1-8b',
    input: 'Process this important request',
    // Will automatically select best node
  });

  console.log(`Processed on ${result.edgeId} in ${result.latency}ms`);
}

// ============================================================================
// Example 6: Computer Vision (Mobile + Edge)
// ============================================================================

async function computerVision() {
  const prism = new Prism({ nodeId: 'mobile-camera' });
  await prism.registerNode({
    gpu: true, // Mobile GPU (Apple Neural Engine, Qualcomm Hexagon)
    wasm: true,
    quantization: true,
  });

  // Deploy vision model (Qwen 2.5-VL, Llava, etc)
  await prism.deployModel({
    id: 'qwen-vl-7b-q8',
    name: 'Qwen 2.5-VL 7B (Vision-Language)',
    version: '1.0.0',
    size: 3_500_000_000,
    quantization: 'int8',
  });

  // Process camera frame
  const canvas = document.getElementById('camera') as HTMLCanvasElement;
  const imageData = canvas.toDataURL('image/jpeg');

  const result = await prism.infer({
    id: 'req-vision-001',
    modelId: 'qwen-vl-7b-q8',
    input: {
      image: imageData,
      question: 'What objects are in this image?',
    },
  });

  console.log('Objects detected:', result.output);
  // Works entirely on-device, no cloud needed
  // Privacy: images never leave the device
}

// ============================================================================
// Example 7: Monitoring & Analytics
// ============================================================================

async function monitoring() {
  const prism = new Prism({ nodeId: 'monitor-node' });
  await prism.registerNode({ gpu: false, wasm: true, quantization: true });

  // Every 10 seconds, log network stats
  setInterval(() => {
    const stats = prism.getStats();
    console.log('Network Stats:', {
      activeNodes: stats.nodes,
      deployedModels: stats.models,
      cachedResults: stats.cacheSize,
      pendingSyncs: stats.pendingSync,
      queuedOfflineRequests: stats.queuedRequests,
    });

    // List nodes
    prism.listNodes().forEach(node => {
      console.log(`${node.name}: ${node.status} (load: ${node.loadScore}%)`);
    });

    // List models
    prism.listModels().forEach(model => {
      const sizeMB = (model.size / 1e6).toFixed(1);
      console.log(`${model.name}: ${sizeMB}MB (${model.quantization})`);
    });
  }, 10000);
}

// ============================================================================
// Example 8: Error Handling & Resilience
// ============================================================================

async function resilience() {
  const prism = new Prism({ nodeId: 'resilient-node' });

  // Listen for errors
  prism.on('inference:error', ({ request, error }) => {
    console.error(`Inference failed for ${request.id}:`, error);
    // Fallback: use simpler model, or cloud API
  });

  prism.on('node:offline', () => {
    console.warn('Node went offline, queueing requests');
    // Show offline indicator in UI
  });

  prism.on('node:online', async () => {
    console.log('Node back online, syncing...');
    // Hide offline indicator, show sync progress
  });

  prism.on('sync:event', (event) => {
    console.debug('Sync event:', event.type, event.version);
  });

  // Request with timeout
  try {
    const result = await prism.infer({
      id: 'req-timeout',
      modelId: 'llama-3.1-8b',
      input: 'Quick response needed',
      timeout: 5000, // 5 second timeout
    });
  } catch (error) {
    console.error('Request timed out, using fallback');
    // Use cached result or simpler model
  }
}

console.log('PRISM Examples loaded. Run any function to see it in action!');
