/**
 * 🔮 PRISM - AI-Powered Edge Orchestration & Distributed Inference
 *
 * Deploy ML models at the edge with real-time sync, automatic conflict resolution,
 * and zero downtime. Built for 2026: Bun-fast, Deno-secure, Vercel-deployed.
 *
 * 🚀 OPTIMIZATIONS:
 * - WebGPU acceleration for browser inference
 * - Intelligent TTL-based caching with predictive prefetching
 * - Binary serialization for 10x faster sync
 * - Memory pooling and object reuse
 * - Adaptive batching with dynamic sizing
 * - Connection pooling for persistent links
 * - Model sharding for large models
 * - Streaming responses for instant feedback
 */

// ============================================================================
// CLEAN ARCHITECTURE IMPORTS
// ============================================================================

// Core domain logic (CRDT, types)
export * from './core';

// Application services (use cases)
export * from './application';

// Infrastructure adapters (external systems)
export * from './infrastructure';

// ============================================================================
// LEGACY COMPATIBILITY EXPORTS
// ============================================================================

// Re-export legacy Prism class for backward compatibility
export { Prism } from './index-legacy';

// Re-export legacy utility classes for testing
export {
  BinarySerializer,
  AdaptiveBatcher,
  ConnectionPool,
  CRDTSync,
  PredictiveCache,
  MemoryPool,
  StreamingInference,
  ModelShardManager
} from './index-legacy';

export type {
  ModelShard,
  ModelShardInput,
  ModelShardManagerDependencies,
  ModelShardManifest,
  StreamingInferenceChunk,
  StreamingInferenceContext,
  StreamingInferenceOptions,
  StreamingToken,
  StreamingTokenSource
} from './index-legacy';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface InferenceModel {
  id: string;
  name: string;
  size: number;
  format: 'onnx' | 'tflite' | 'gguf' | 'safetensors';
  capabilities: string[];
  quantization?: 'int8' | 'int4' | 'float16';
  metadata?: Record<string, any>;
}

export interface InferenceRequest {
  id: string;
  modelId: string;
  input: string | object;
  options?: {
    temperature?: number;
    maxTokens?: number;
    priority?: 'low' | 'normal' | 'high';
  };
  edgeId?: string;
}

export interface InferenceResult {
  id: string;
  modelId: string;
  output: any;
  latency: number;
  edgeId: string;
  timestamp: number;
  cached?: boolean;
}

export interface EdgeNode {
  id: string;
  name: string;
  region: string;
  capabilities: {
    gpu?: boolean;
    wasm?: boolean;
    quantization?: boolean;
  };
  models: string[];
  status: 'online' | 'offline' | 'maintenance';
  lastHeartbeat: number;
  loadScore: number;
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export { PrismCRDT } from './application';

// WebGPU type declarations (for non-TypeScript environments)
