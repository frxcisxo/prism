import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  ModelLoader,
  CloudflareWorkersAIRuntime,
  HttpInferenceRuntime,
  InferenceEngine,
  OllamaRuntime,
  OnnxRuntimeWebRuntime,
  type InferenceConfig,
  type InferenceRuntime
} from '../../../src/infrastructure/inference/inference';

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

    it('should use a custom runtime through the runtime abstraction', async () => {
      const runtime: InferenceRuntime = {
        id: 'custom-test-runtime',
        supports: vi.fn((model) => model.format === 'onnx'),
        load: vi.fn(async (model) => ({ runtime: 'custom-test-runtime', modelId: model.id })),
        infer: vi.fn(async (_model, session, input) => ({
          text: `custom:${session.modelId}:${input.normalized}`,
          source: 'custom',
        })),
      };

      const customEngine = new InferenceEngine({ runtimes: [runtime] });
      await customEngine.loadModel({
        id: 'custom-model',
        name: 'Custom Model',
        version: '1.0.0',
        format: 'onnx',
        size: 1000000,
        capabilities: ['custom'],
      });

      const result = await customEngine.infer('custom-model', 'Hello runtime');

      expect(runtime.supports).toHaveBeenCalled();
      expect(runtime.load).toHaveBeenCalled();
      expect(runtime.infer).toHaveBeenCalled();
      expect(result).toMatchObject({
        text: 'custom:custom-model:Hello runtime',
        source: 'custom',
        modelId: 'custom-model',
      });
    });

    it('should reject a model when no runtime supports it', async () => {
      const runtime: InferenceRuntime = {
        id: 'unsupported-runtime',
        supports: () => false,
        load: async () => ({}),
        infer: async () => ({ text: 'never', source: 'custom' }),
      };

      const customEngine = new InferenceEngine({ runtimes: [runtime] });

      await expect(customEngine.loadModel({
        id: 'unsupported-model',
        name: 'Unsupported Model',
        version: '1.0.0',
        format: 'gguf',
        size: 1000000,
        capabilities: [],
      })).rejects.toThrow('No inference runtime supports model unsupported-model');
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
        modelId: 'test-model',
        modelName: 'Test Model',
        source: expect.stringMatching(/cpu|gpu/),
      });
    });

    it('should perform inference with object input', async () => {
      const input = { text: 'Test input', context: 'Additional context' };
      const result = await engine.infer('test-model', input);

      expect(result).toEqual({
        text: expect.any(String),
        tokens: expect.any(Number),
        modelId: 'test-model',
        modelName: 'Test Model',
        source: expect.stringMatching(/cpu|gpu/),
      });
    });

    it('should use cache when enabled', async () => {
      const input = 'Cache test input';

      // First call
      const result1 = await engine.infer('test-model', input, { cache: true });
      expect(result1).toBeDefined();

      // Second call should use cache
      const result2 = await engine.infer('test-model', input, { cache: true });
      // Ignore the 'cached' property for deep equality
      const { cached: _c1, ...r1 } = result1;
      const { cached: _c2, ...r2 } = result2;
      expect(r2).toEqual(r1);
      expect(result2.cached).toBe(true);
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
        expect(result).toMatchObject({
          text: expect.any(String),
          tokens: expect.any(Number),
          modelId: 'test-model',
          modelName: 'Test Model',
          source: expect.stringMatching(/cpu|gpu/),
        });
      });
    });

    it('should fall back to per-item runtime inference when batchInfer is not implemented', async () => {
      const runtime: InferenceRuntime = {
        id: 'single-only-runtime',
        supports: () => true,
        load: async (model) => ({ modelId: model.id }),
        infer: vi.fn(async (_model, _session, input) => ({
          text: `single:${input.normalized}`,
          source: 'custom',
        })),
      };

      const customEngine = new InferenceEngine({ maxBatchSize: 2, runtimes: [runtime] });
      await customEngine.loadModel({
        id: 'single-only-model',
        name: 'Single Only Model',
        version: '1.0.0',
        format: 'onnx',
        size: 1000000,
        capabilities: [],
      });

      const results = await customEngine.batchInfer('single-only-model', ['a', 'b', 'c']);

      expect(runtime.infer).toHaveBeenCalledTimes(3);
      expect(results.map(result => result.text)).toEqual(['single:a', 'single:b', 'single:c']);
    });

    it('should handle empty batch', async () => {
      const results = await engine.batchInfer('test-model', []);
      expect(results).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return engine statistics', () => {
      const stats = engine.getStats();
      expect(stats).toMatchObject({
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

describe('OnnxRuntimeWebRuntime', () => {
  const addOneSha256 = 'b7d06325e6a907bdad72053370bc5d3501f599c89eb7e0c9577e556527e83eef';

  function createMockOrt() {
    const run = vi.fn(async () => ({
      logits: {
        type: 'float32',
        data: new Float32Array([0.1, 0.9]),
        dims: [1, 2],
      },
    }));
    const release = vi.fn();
    const session = {
      inputNames: ['input_ids'],
      outputNames: ['logits'],
      run,
      release,
    };
    const Tensor = vi.fn(function Tensor(this: any, type: string, data: any, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    });
    const create = vi.fn(async () => session);

    return {
      ort: {
        env: { wasm: {} },
        Tensor,
        InferenceSession: { create },
      },
      session,
      create,
      Tensor,
      run,
      release,
    };
  }

  it('should support ONNX models without becoming the default runtime', () => {
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => createMockOrt().ort });

    expect(runtime.supports({
      id: 'model.onnx',
      name: 'ONNX Model',
      version: '1.0.0',
      format: 'onnx',
      size: 1000,
      capabilities: [],
    })).toBe(true);

    expect(runtime.supports({
      id: 'model.gguf',
      name: 'GGUF Model',
      version: '1.0.0',
      format: 'gguf',
      size: 1000,
      capabilities: [],
    })).toBe(false);
  });

  it('should load and run an ONNX model through the runtime interface', async () => {
    const mock = createMockOrt();
    const runtime = new OnnxRuntimeWebRuntime({
      importOrt: async () => mock.ort,
      executionProviders: ['wasm'],
      wasmPaths: '/wasm/',
    });
    const model = {
      id: 'classifier',
      name: 'Classifier',
      version: '1.0.0',
      format: 'onnx' as const,
      size: 1000,
      capabilities: ['classification'],
      metadata: { modelUrl: '/models/classifier.onnx' },
    };

    const session = await runtime.load(model);
    const output = await runtime.infer(model, session, {
      data: [1, 2, 3],
      dims: [1, 3],
      type: 'float32',
    }, {});

    expect(mock.ort.env.wasm.wasmPaths).toBe('/wasm/');
    expect(mock.create).toHaveBeenCalledWith('/models/classifier.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    expect(mock.Tensor).toHaveBeenCalledWith('float32', expect.any(Float32Array), [1, 3]);
    expect(mock.run).toHaveBeenCalledWith({
      input_ids: expect.objectContaining({ type: 'float32', dims: [1, 3] }),
    }, ['logits']);
    expect(output).toMatchObject({
      source: 'cpu',
      runtime: 'onnxruntime-web',
      outputNames: ['logits'],
    });
    expect(output.text).toContain('ONNX inference produced 1 output');
  });

  it('should verify modelBuffer SHA-256 and size before loading', async () => {
    const mock = createMockOrt();
    const bytes = new Uint8Array(await readFile('test/fixtures/onnx/add-one.onnx'));
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => mock.ort });

    await runtime.load({
      id: 'buffer-verified.onnx',
      name: 'Buffer Verified',
      version: '1.0.0',
      format: 'onnx',
      size: bytes.byteLength,
      capabilities: [],
      metadata: {
        modelBuffer: bytes,
        sha256: addOneSha256,
        expectedSize: bytes.byteLength,
      },
    });

    expect(mock.create).toHaveBeenCalledWith(bytes, expect.any(Object));
  });

  it('should reject model artifacts with a SHA-256 mismatch', async () => {
    const mock = createMockOrt();
    const bytes = new Uint8Array(await readFile('test/fixtures/onnx/add-one.onnx'));
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => mock.ort });

    await expect(runtime.load({
      id: 'tampered.onnx',
      name: 'Tampered',
      version: '1.0.0',
      format: 'onnx',
      size: bytes.byteLength,
      capabilities: [],
      metadata: {
        modelBuffer: bytes,
        sha256: '0'.repeat(64),
      },
    })).rejects.toThrow('SHA-256 mismatch');
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('should reject model artifacts with a size mismatch', async () => {
    const mock = createMockOrt();
    const bytes = new Uint8Array(await readFile('test/fixtures/onnx/add-one.onnx'));
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => mock.ort });

    await expect(runtime.load({
      id: 'wrong-size.onnx',
      name: 'Wrong Size',
      version: '1.0.0',
      format: 'onnx',
      size: bytes.byteLength,
      capabilities: [],
      metadata: {
        modelBuffer: bytes,
        expectedSize: bytes.byteLength + 1,
      },
    })).rejects.toThrow('size mismatch');
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('should accept prebuilt feeds and release ONNX sessions', async () => {
    const mock = createMockOrt();
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => mock.ort });
    const model = {
      id: 'prebuilt.onnx',
      name: 'Prebuilt',
      version: '1.0.0',
      format: 'onnx' as const,
      size: 1000,
      capabilities: [],
      metadata: { modelBuffer: new Uint8Array([1, 2, 3]) },
    };

    const session = await runtime.load(model);
    const feed = { type: 'float32', data: new Float32Array([1]), dims: [1] };
    await runtime.infer(model, session, { feeds: { input_ids: feed } }, {});
    await runtime.unload?.(model.id, session);

    expect(mock.run).toHaveBeenCalledWith({ input_ids: feed }, ['logits']);
    expect(mock.release).toHaveBeenCalled();
  });

  it('should fail clearly when ONNX model source metadata is missing', async () => {
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => createMockOrt().ort });

    await expect(runtime.load({
      id: 'missing-source.onnx',
      name: 'Missing Source',
      version: '1.0.0',
      format: 'onnx',
      size: 1000,
      capabilities: [],
    })).rejects.toThrow('requires metadata.modelUrl');
  });

  it('should fail clearly when tensor input is missing', async () => {
    const mock = createMockOrt();
    const runtime = new OnnxRuntimeWebRuntime({ importOrt: async () => mock.ort });
    const model = {
      id: 'tensor-required.onnx',
      name: 'Tensor Required',
      version: '1.0.0',
      format: 'onnx' as const,
      size: 1000,
      capabilities: [],
      metadata: { modelUrl: '/models/tensor-required.onnx' },
    };

    const session = await runtime.load(model);

    await expect(runtime.infer(model, session, { text: 'not enough' }, {}))
      .rejects.toThrow('ONNX inference requires tensor input');
  });

  it('should execute a real ONNX fixture through InferenceEngine', async () => {
    const engine = new InferenceEngine({
      runtimes: [new OnnxRuntimeWebRuntime({
        importOrt: () => import('onnxruntime-web') as any,
        readFile: async (path) => new Uint8Array(await readFile(path)),
      })],
    });

    await engine.loadModel({
      id: 'add-one-real',
      name: 'Add One Real ONNX',
      version: '1.0.0',
      format: 'onnx',
      size: 112,
      capabilities: ['numeric'],
      metadata: {
        modelPath: 'test/fixtures/onnx/add-one.onnx',
        executionProviders: ['wasm'],
        sha256: addOneSha256,
        expectedSize: 112,
      },
    });

    const result = await engine.infer('add-one-real', {
      inputName: 'X',
      data: [41],
      dims: [1],
      type: 'float32',
    }, { cache: false });

    const output = result.raw?.outputs?.Y;

    expect(result.text).toContain('ONNX inference produced 1 output');
    expect(output?.dims).toEqual([1]);
    expect(Array.from(output?.data || [])).toEqual([42]);
  });
});

describe('HttpInferenceRuntime', () => {
  const remoteModel = {
    id: 'remote-chat',
    name: 'Remote Chat',
    version: '1.0.0',
    format: 'openai-compatible' as const,
    size: 1,
    capabilities: ['chat'],
    metadata: {
      remoteModel: 'llama-edge',
    },
  };

  it('should support HTTP and OpenAI-compatible remote models', () => {
    const runtime = new HttpInferenceRuntime();

    expect(runtime.supports(remoteModel)).toBe(true);
    expect(runtime.supports({
      id: 'metadata-runtime',
      name: 'Metadata Runtime',
      version: '1.0.0',
      format: 'onnx',
      size: 1,
      capabilities: [],
      metadata: { runtime: 'http', endpoint: 'https://ai.example/v1/chat/completions' },
    })).toBe(true);
    expect(runtime.supports({
      id: 'local.gguf',
      name: 'Local GGUF',
      version: '1.0.0',
      format: 'gguf',
      size: 1,
      capabilities: [],
    })).toBe(false);
  });

  it('should send OpenAI-compatible requests with auth headers and parse chat responses', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        { message: { content: 'hello from the remote edge' } },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const runtime = new HttpInferenceRuntime({
      endpoint: 'https://ai.example/v1/chat/completions',
      apiKey: 'test-secret',
      fetch: fetcher,
    });

    const session = await runtime.load(remoteModel);
    const output = await runtime.infer(remoteModel, session, {
      text: 'Hi PRISM',
      normalized: 'Hi PRISM',
    }, {
      temperature: 0.2,
      maxTokens: 32,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(url).toBe('https://ai.example/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-secret',
      },
    });
    expect(body).toEqual({
      model: 'llama-edge',
      messages: [{ role: 'user', content: 'Hi PRISM' }],
      temperature: 0.2,
      max_tokens: 32,
      stream: false,
    });
    expect(output).toMatchObject({
      text: 'hello from the remote edge',
      source: 'remote',
      runtime: 'http',
      status: 200,
    });
  });

  it('should support custom request builders and response parsers', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({
        result: { text: `custom:${body.prompt}` },
      }), { status: 200 });
    });
    const runtime = new HttpInferenceRuntime({
      endpoint: 'https://ai.example/custom',
      fetch: fetcher,
      buildRequest: (_model, input) => ({ prompt: input.normalized }),
      parseResponse: (payload) => (payload as any).result.text,
    });

    const session = await runtime.load({
      ...remoteModel,
      format: 'remote',
      metadata: {},
    });
    const output = await runtime.infer(remoteModel, session, {
      normalized: 'custom prompt',
    }, {});

    expect(output.text).toBe('custom:custom prompt');
  });

  it('should reject non-OK responses with status and provider error message', async () => {
    const runtime = new HttpInferenceRuntime({
      endpoint: 'https://ai.example/v1/chat/completions',
      fetch: async () => new Response(JSON.stringify({
        error: { message: 'model unavailable' },
      }), { status: 503 }),
    });
    const session = await runtime.load(remoteModel);

    await expect(runtime.infer(remoteModel, session, { text: 'Hello' }, {}))
      .rejects.toThrow('HTTP inference failed for remote-chat: 503 model unavailable');
  });

  it('should fan out batch inference through the HTTP runtime', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: `remote:${body.messages[0].content}` } }],
      }), { status: 200 });
    });
    const runtime = new HttpInferenceRuntime({
      endpoint: 'https://ai.example/v1/chat/completions',
      fetch: fetcher,
    });
    const session = await runtime.load(remoteModel);

    const results = await runtime.batchInfer(remoteModel, session, [
      { normalized: 'one' },
      { normalized: 'two' },
    ], {});

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results.map(result => result.text)).toEqual(['remote:one', 'remote:two']);
  });

  it('should work through InferenceEngine and expose raw provider payloads', async () => {
    const engine = new InferenceEngine({
      runtimes: [
        new HttpInferenceRuntime({
          endpoint: 'https://ai.example/v1/chat/completions',
          fetch: async () => new Response(JSON.stringify({
            choices: [{ text: 'engine remote result' }],
          }), { status: 200 }),
        }),
      ],
    });

    await engine.loadModel(remoteModel);
    const result = await engine.infer('remote-chat', 'Run through engine', { cache: false });

    expect(result).toMatchObject({
      text: 'engine remote result',
      source: 'remote',
      modelId: 'remote-chat',
      raw: {
        runtime: 'http',
        status: 200,
      },
    });
  });
});

describe('CloudflareWorkersAIRuntime', () => {
  const workersModel = {
    id: 'cf-chat',
    name: 'Cloudflare Chat',
    version: '1.0.0',
    format: 'remote' as const,
    size: 1,
    capabilities: ['chat'],
    metadata: {
      runtime: 'cloudflare-workers-ai',
      remoteModel: '@cf/meta/llama-3.1-8b-instruct',
    },
  };

  it('should support Cloudflare Workers AI models without hijacking generic remote models', () => {
    const runtime = new CloudflareWorkersAIRuntime();

    expect(runtime.supports(workersModel)).toBe(true);
    expect(runtime.supports({
      id: '@cf/meta/llama-3.1-8b-instruct',
      name: 'Implicit Workers AI',
      version: '1.0.0',
      format: 'remote',
      size: 1,
      capabilities: [],
    })).toBe(true);
    expect(runtime.supports({
      id: 'remote-chat',
      name: 'Remote Chat',
      version: '1.0.0',
      format: 'remote',
      size: 1,
      capabilities: [],
      metadata: { remoteModel: 'openai/gpt-4.1-mini' },
    })).toBe(false);
  });

  it('should run inference through the native Workers AI binding', async () => {
    const ai = {
      run: vi.fn(async () => ({
        response: 'workers binding result',
      })),
    };
    const runtime = new CloudflareWorkersAIRuntime({
      ai,
      gatewayId: 'default',
    });

    const session = await runtime.load(workersModel);
    const output = await runtime.infer(workersModel, session, {
      text: 'Hello edge',
    }, {
      temperature: 0.3,
      maxTokens: 64,
    });

    expect(ai.run).toHaveBeenCalledWith('@cf/meta/llama-3.1-8b-instruct', {
      prompt: 'Hello edge',
      temperature: 0.3,
      max_tokens: 64,
    }, {
      gateway: { id: 'default' },
    });
    expect(output).toMatchObject({
      text: 'workers binding result',
      source: 'remote',
      runtime: 'cloudflare-workers-ai',
      mode: 'binding',
    });
  });

  it('should run inference through the Cloudflare REST API with bearer auth', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      result: {
        response: 'workers rest result',
      },
    }), { status: 200 }));
    const runtime = new CloudflareWorkersAIRuntime({
      accountId: 'account-123',
      apiToken: 'cf-token',
      gatewayId: 'gateway-a',
      fetch: fetcher,
    });

    const session = await runtime.load(workersModel);
    const output = await runtime.infer(workersModel, session, {
      messages: [{ role: 'user', content: 'Hello from REST' }],
    }, {});

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account-123/ai/run/@cf/meta/llama-3.1-8b-instruct');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer cf-token',
        'content-type': 'application/json',
        'cf-aig-gateway-id': 'gateway-a',
      },
    });
    expect(body).toEqual({
      messages: [{ role: 'user', content: 'Hello from REST' }],
    });
    expect(output.text).toBe('workers rest result');
  });

  it('should support custom Workers AI request builders and response parsers', async () => {
    const runtime = new CloudflareWorkersAIRuntime({
      ai: {
        run: async (_model, payload) => ({ output: { value: `custom:${payload.input}` } }),
      },
      buildInput: (_model, input) => ({ input: input.normalized }),
      parseResponse: (payload) => (payload as any).output.value,
    });

    const session = await runtime.load(workersModel);
    const output = await runtime.infer(workersModel, session, {
      normalized: 'custom input',
    }, {});

    expect(output.text).toBe('custom:custom input');
  });

  it('should reject REST mode without Cloudflare credentials', async () => {
    const runtime = new CloudflareWorkersAIRuntime();
    const session = await runtime.load(workersModel);

    await expect(runtime.infer(workersModel, session, { text: 'Hello' }, {}))
      .rejects.toThrow('requires metadata.accountId or runtime accountId');
  });

  it('should fan out batch inference through Workers AI', async () => {
    const ai = {
      run: vi.fn(async (_model, payload) => ({ response: `cf:${payload.prompt}` })),
    };
    const runtime = new CloudflareWorkersAIRuntime({ ai });
    const session = await runtime.load(workersModel);

    const results = await runtime.batchInfer(workersModel, session, [
      { normalized: 'one' },
      { normalized: 'two' },
    ], {});

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(results.map(result => result.text)).toEqual(['cf:one', 'cf:two']);
  });
});

describe('OllamaRuntime', () => {
  const ollamaModel = {
    id: 'local-chat',
    name: 'Local Chat',
    version: '1.0.0',
    format: 'ollama' as const,
    size: 1,
    capabilities: ['chat'],
    metadata: {
      model: 'llama3.2',
    },
  };

  it('should support explicit Ollama models without hijacking generic remote models', () => {
    const runtime = new OllamaRuntime();

    expect(runtime.supports(ollamaModel)).toBe(true);
    expect(runtime.supports({
      id: 'metadata-ollama',
      name: 'Metadata Ollama',
      version: '1.0.0',
      format: 'remote',
      size: 1,
      capabilities: [],
      metadata: { runtime: 'ollama', model: 'qwen3' },
    })).toBe(true);
    expect(runtime.supports({
      id: 'remote-chat',
      name: 'Remote Chat',
      version: '1.0.0',
      format: 'remote',
      size: 1,
      capabilities: [],
    })).toBe(false);
  });

  it('should call the local Ollama chat endpoint by default', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      message: { role: 'assistant', content: 'local ollama result' },
      done: true,
    }), { status: 200 }));
    const runtime = new OllamaRuntime({ fetch: fetcher });

    const session = await runtime.load(ollamaModel);
    const output = await runtime.infer(ollamaModel, session, {
      text: 'Hello local model',
    }, {
      temperature: 0.1,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(url).toBe('http://localhost:11434/api/chat');
    expect(body).toEqual({
      model: 'llama3.2',
      stream: false,
      options: { temperature: 0.1 },
      messages: [{ role: 'user', content: 'Hello local model' }],
    });
    expect(output).toMatchObject({
      text: 'local ollama result',
      source: 'remote',
      runtime: 'ollama',
      endpoint: 'chat',
    });
  });

  it('should call the generate endpoint when configured', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      response: 'generated text',
      done: true,
    }), { status: 200 }));
    const runtime = new OllamaRuntime({
      host: 'https://ollama.example',
      apiKey: 'cloud-key',
      endpoint: 'generate',
      fetch: fetcher,
    });

    const session = await runtime.load(ollamaModel);
    const output = await runtime.infer(ollamaModel, session, {
      normalized: 'Generate this',
    }, {});
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(url).toBe('https://ollama.example/api/generate');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer cloud-key',
      },
    });
    expect(body).toEqual({
      model: 'llama3.2',
      stream: false,
      prompt: 'Generate this',
    });
    expect(output.text).toBe('generated text');
  });

  it('should support custom request builders and response parsers', async () => {
    const runtime = new OllamaRuntime({
      fetch: async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body));
        return new Response(JSON.stringify({
          result: { text: `custom:${body.input}` },
        }), { status: 200 });
      },
      buildRequest: (_model, input) => ({ input: input.normalized, stream: false }),
      parseResponse: (payload) => (payload as any).result.text,
    });

    const session = await runtime.load(ollamaModel);
    const output = await runtime.infer(ollamaModel, session, {
      normalized: 'custom prompt',
    }, {});

    expect(output.text).toBe('custom:custom prompt');
  });

  it('should reject Ollama API errors with status and message', async () => {
    const runtime = new OllamaRuntime({
      fetch: async () => new Response(JSON.stringify({
        error: 'model not found',
      }), { status: 404 }),
    });
    const session = await runtime.load(ollamaModel);

    await expect(runtime.infer(ollamaModel, session, { text: 'Hello' }, {}))
      .rejects.toThrow('Ollama inference failed for local-chat: 404 model not found');
  });

  it('should work through InferenceEngine and expose raw Ollama payloads', async () => {
    const engine = new InferenceEngine({
      runtimes: [
        new OllamaRuntime({
          fetch: async () => new Response(JSON.stringify({
            message: { content: 'engine ollama result' },
            total_duration: 10,
          }), { status: 200 }),
        }),
      ],
    });

    await engine.loadModel(ollamaModel);
    const result = await engine.infer('local-chat', 'Run through engine', { cache: false });

    expect(result).toMatchObject({
      text: 'engine ollama result',
      source: 'remote',
      modelId: 'local-chat',
      raw: {
        runtime: 'ollama',
        status: 200,
      },
    });
  });
});
