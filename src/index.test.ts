import { describe, it, expect, vi, beforeEach } from 'vitest';
import Prism, { InferenceRequest, InferenceResult } from './index';

describe('Prism', () => {
  let prism: Prism;

  beforeEach(() => {
    prism = new Prism({ nodeId: 'test-node' });
  });

  describe('constructor', () => {
    it('should create a Prism instance with default config', () => {
      const p = new Prism({ nodeId: 'default-node' });
      expect(p).toBeInstanceOf(Prism);
    });

    it('should create a Prism instance with custom config', () => {
      const p = new Prism({ nodeId: 'custom-node', region: 'us-east-1' });
      expect(p).toBeInstanceOf(Prism);
    });
  });

  describe('registerNode', () => {
    it('should register a node successfully', async () => {
      const result = await prism.registerNode({
        gpu: true,
        wasm: true,
        quantization: true,
      });

      expect(result).toEqual({
        nodeId: 'test-node',
        status: 'registered',
        capabilities: {
          gpu: true,
          wasm: true,
          quantization: true,
        },
      });
    });

    it('should handle registration with minimal capabilities', async () => {
      const result = await prism.registerNode({
        gpu: false,
        wasm: false,
        quantization: false,
      });

      expect(result.capabilities).toEqual({
        gpu: false,
        wasm: false,
        quantization: false,
      });
    });
  });

  describe('deployModel', () => {
    it('should deploy a model successfully', async () => {
      const modelConfig = {
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4' as const,
        maxTokens: 1024,
      };

      const result = await prism.deployModel(modelConfig);

      expect(result).toEqual({
        modelId: 'test-model',
        status: 'deployed',
        nodeId: 'test-node',
        deploymentTime: expect.any(Number),
      });
    });

    it('should reject deployment with invalid size', async () => {
      const modelConfig = {
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: -1,
        quantization: 'int4' as const,
        maxTokens: 1024,
      };

      await expect(prism.deployModel(modelConfig)).rejects.toThrow();
    });
  });

  describe('infer', () => {
    beforeEach(async () => {
      // Register and deploy a model for testing
      await prism.registerNode({ gpu: false, wasm: true, quantization: true });
      await prism.deployModel({
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4',
        maxTokens: 1024,
      });
    });

    it('should perform inference successfully', async () => {
      const request: InferenceRequest = {
        id: 'test-req-1',
        modelId: 'test-model',
        input: 'What is AI?',
        priority: 'normal',
      };

      const result = await prism.infer(request);

      expect(result).toEqual({
        id: 'test-req-1',
        modelId: 'test-model',
        output: expect.any(Object),
        latency: expect.any(Number),
        edgeId: expect.any(String),
        timestamp: expect.any(Number),
        cached: false,
      });
    });

    it('should handle different input types', async () => {
      const request: InferenceRequest = {
        id: 'test-req-2',
        modelId: 'test-model',
        input: { text: 'Test input', context: 'Additional context' },
        priority: 'high',
      };

      const result = await prism.infer(request);
      expect(result.id).toBe('test-req-2');
      expect(result.modelId).toBe('test-model');
    });

    it('should reject inference with invalid model ID', async () => {
      const request: InferenceRequest = {
        id: 'test-req-3',
        modelId: 'non-existent-model',
        input: 'Test input',
        priority: 'normal',
      };

      await expect(prism.infer(request)).rejects.toThrow('Model not deployed');
    });

    it('should handle cached results', async () => {
      const request: InferenceRequest = {
        id: 'test-req-4',
        modelId: 'test-model',
        input: 'Cache test',
        priority: 'normal',
      };

      // First call
      const result1 = await prism.infer(request);
      expect(result1.cached).toBe(false);

      // Second call with same input should be cached
      const result2 = await prism.infer(request);
      expect(result2.cached).toBe(true);
      expect(result2.output).toBe(result1.output);
    });
  });

  describe('getStats', () => {
    it('should return node statistics', () => {
      const stats = prism.getStats();

      expect(stats).toEqual({
        nodeId: 'test-node',
        totalRequests: 0,
        averageLatency: 0,
        uptime: expect.any(Number),
        models: [],
      });
    });
  });
});