import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelLoader, InferenceEngine, InferenceConfig } from './inference';

describe('ModelLoader', () => {
  let loader: ModelLoader;

  beforeEach(() => {
    loader = new ModelLoader();
  });

  describe('constructor', () => {
    it('should create a ModelLoader instance', () => {
      expect(loader).toBeInstanceOf(ModelLoader);
    });
  });

  describe('loadModel', () => {
    it('should load a model successfully', async () => {
      const modelConfig = {
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4' as const,
        maxTokens: 1024,
      };

      const result = await loader.loadModel(modelConfig);

      expect(result).toEqual({
        modelId: 'test-model',
        status: 'loaded',
        loadTime: expect.any(Number),
      });
    });

    it('should reject loading with invalid size', async () => {
      const modelConfig = {
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: -1,
        quantization: 'int4' as const,
        maxTokens: 1024,
      };

      await expect(loader.loadModel(modelConfig)).rejects.toThrow();
    });
  });

  describe('unloadModel', () => {
    it('should unload a loaded model', async () => {
      // Load a model first
      await loader.loadModel({
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4',
        maxTokens: 1024,
      });

      const result = await loader.unloadModel('test-model');
      expect(result).toEqual({
        modelId: 'test-model',
        status: 'unloaded',
      });
    });

    it('should throw error for unloading non-existent model', async () => {
      await expect(loader.unloadModel('non-existent')).rejects.toThrow('Model not loaded');
    });
  });

  describe('getLoadedModels', () => {
    it('should return empty array initially', () => {
      const models = loader.listLoaded();
      expect(models).toEqual([]);
    });

    it('should return loaded models', async () => {
      await loader.loadModel({
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4',
        maxTokens: 1024,
      });

      const models = loader.listLoaded();
      expect(models).toEqual(['test-model']);
    });
  });
});

describe('InferenceEngine', () => {
  let engine: InferenceEngine;

  beforeEach(() => {
    engine = new InferenceEngine();
  });

  describe('constructor', () => {
    it('should create an InferenceEngine instance', () => {
      expect(engine).toBeInstanceOf(InferenceEngine);
    });

    it('should create with custom config', () => {
      const config: InferenceConfig = { maxBatchSize: 16 };
      const customEngine = new InferenceEngine(config);
      expect(customEngine).toBeInstanceOf(InferenceEngine);
    });
  });

  describe('loadModel', () => {
    it('should load a model', async () => {
      const modelConfig = {
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4' as const,
        maxTokens: 1024,
      };

      const result = await engine.loadModel(modelConfig);
      expect(result.status).toBe('loaded');
    });
  });

  describe('infer', () => {
    beforeEach(async () => {
      // Load a model for testing
      await engine.loadModel({
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4',
        maxTokens: 1024,
      });
    });

    it('should perform inference with string input', async () => {
      const result = await engine.infer('test-model', 'Test input');

      expect(result).toEqual({
        text: expect.any(String),
        tokens: expect.any(Number),
      });
    });

    it('should perform inference with object input', async () => {
      const input = { text: 'Test input', context: 'Additional context' };
      const result = await engine.infer('test-model', input);

      expect(result).toEqual({
        text: expect.any(String),
        tokens: expect.any(Number),
      });
    });

    it('should use cache when enabled', async () => {
      const input = 'Cache test input';

      // First call
      const result1 = await engine.infer('test-model', input, { cache: true });
      expect(result1).toBeDefined();

      // Second call should use cache
      const result2 = await engine.infer('test-model', input, { cache: true });
      expect(result2).toEqual(result1);
    });

    it('should skip cache when disabled', async () => {
      const input = 'No cache test';

      const result1 = await engine.infer('test-model', input, { cache: false });
      const result2 = await engine.infer('test-model', input, { cache: false });

      // Both should be valid results
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('should throw error for unloaded model', async () => {
      await expect(engine.infer('non-existent', 'test')).rejects.toThrow('Model not loaded');
    });
  });

  describe('batchInfer', () => {
    beforeEach(async () => {
      await engine.loadModel({
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4',
        maxTokens: 1024,
      });
    });

    it('should perform batch inference', async () => {
      const inputs = ['Input 1', 'Input 2', 'Input 3'];

      const results = await engine.batchInfer('test-model', inputs);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toEqual({
          text: expect.any(String),
          tokens: expect.any(Number),
        });
      });
    });

    it('should handle empty batch', async () => {
      const results = await engine.batchInfer('test-model', []);
      expect(results).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return engine statistics', () => {
      const stats = engine.getStats();

      expect(stats).toEqual({
        loadedModels: 0,
        totalRequests: 0,
        averageLatency: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
    });

    it('should return updated stats after operations', async () => {
      await engine.loadModel({
        id: 'test-model',
        name: 'Test Model',
        version: '1.0.0',
        size: 1000000,
        quantization: 'int4',
        maxTokens: 1024,
      });

      await engine.infer('test-model', 'test input');

      const stats = engine.getStats();
      expect(stats.loadedModels).toBe(1);
      expect(stats.totalRequests).toBe(1);
      expect(stats.averageLatency).toBeGreaterThan(0);
    });
  });
});