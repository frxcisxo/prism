/**
 * Inference module for PRISM
 * Supports: ONNX, TensorFlow Lite, GGLM, WebAssembly
 * Optimizations: Quantization, Batching, Caching, GPU acceleration
 */

import type { InferenceModel } from '../../index';

export type InferenceInput = string | Record<string, any>;
export type InferenceSource = 'cpu' | 'gpu' | 'remote' | 'custom';

export interface InferenceOptions {
  batch?: boolean;
  cache?: boolean;
  useGPU?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface InferenceConfig {
  maxBatchSize?: number;
  cachePath?: string;
  gpuEnabled?: boolean;
  wasmEnabled?: boolean;
  quantization?: 'int8' | 'int4' | 'float16';
  runtimes?: InferenceRuntime[];
}

export type TensorData =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array
  | number[]
  | bigint[];

export interface TensorSpec {
  data: TensorData;
  dims: number[];
  type?: string;
}

export interface OnnxRuntimeWebConfig {
  importOrt?: () => Promise<OnnxRuntimeModule>;
  executionProviders?: string[];
  graphOptimizationLevel?: string;
  wasmPaths?: string;
  readFile?: (path: string) => Promise<Uint8Array>;
  sha256?: (data: Uint8Array) => Promise<string>;
}

export interface HttpInferenceRuntimeConfig {
  endpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  buildRequest?: (
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ) => Record<string, any>;
  parseResponse?: (response: unknown) => string;
}

export interface BatchedInference {
  requests: InferenceInput[];
  batchSize: number;
  startTime: number;
}

export interface InferenceOutput {
  text: string;
  tokens: number;
  modelId: string;
  modelName: string;
  source: InferenceSource;
  cached?: boolean;
  raw?: Record<string, any>;
}

interface CachedEntry {
  output: InferenceOutput;
  timestamp: number;
  hits: number;
}

interface LoadedModel {
  model: InferenceModel;
  format: string;
  loadedAt: number;
  session: Record<string, any>;
  runtime: InferenceRuntime;
}

export interface InferenceRuntime {
  id: string;
  supports(model: InferenceModel): boolean;
  load(model: InferenceModel): Promise<Record<string, any>>;
  unload?(modelId: string, session: Record<string, any>): Promise<void>;
  infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>>;
  batchInfer?(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]>;
}

interface OnnxRuntimeModule {
  env?: {
    wasm?: {
      wasmPaths?: string;
    };
  };
  Tensor: new (type: string, data: TensorData, dims: readonly number[]) => any;
  InferenceSession: {
    create(model: string | ArrayBuffer | Uint8Array, options?: Record<string, any>): Promise<OnnxSession>;
  };
}

interface OnnxSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, any>, outputNames?: string[]): Promise<Record<string, any>>;
  release?(): Promise<void> | void;
}

type ResolvedInferenceConfig = Required<Omit<InferenceConfig, 'cachePath' | 'runtimes'>> & {
  cachePath?: string;
  runtimes: InferenceRuntime[];
};

export class SimulatedInferenceRuntime implements InferenceRuntime {
  id = 'simulated';

  supports(_model: InferenceModel): boolean {
    return true;
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const format = this.detectFormat(model);
    const latency = format === 'gguf' ? 70 : format === 'generic' ? 20 : 50;
    console.debug(`[PRISM] Loading ${format.toUpperCase()} model: ${model.name}`);
    await new Promise(resolve => setTimeout(resolve, latency));

    return {
      format,
      modelId: model.id,
      quantization: model.quantization || null,
      runtime: this.id,
    };
  }

  async infer(
    model: InferenceModel,
    _session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const source: InferenceSource = options.useGPU ? 'gpu' : 'cpu';
    const simulatedLatency = source === 'gpu'
      ? Math.max(3, Math.min(20, model.size / 2e7))
      : Math.max(5, Math.min(50, model.size / 1e7));

    await new Promise(resolve => setTimeout(resolve, simulatedLatency));

    return {
      logits: source === 'gpu' ? [0.1, 0.9] : [0.05, 0.95],
      modelId: model.id,
      modelName: model.name,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 256,
      inputPreview: input.text || input.normalized,
      source,
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    _session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    const batchLatency = Math.max(10, Math.min(60, (model.size / 1e7) * inputs.length));
    await new Promise(resolve => setTimeout(resolve, batchLatency));

    return inputs.map(input => ({
      logits: [0.05, 0.95],
      modelId: model.id,
      modelName: model.name,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 256,
      inputPreview: input.text || input.normalized,
      source: 'cpu',
      runtime: this.id,
    }));
  }

  private detectFormat(model: InferenceModel): string {
    if (model.format) return model.format;
    if (model.id.endsWith('.onnx')) return 'onnx';
    if (model.id.endsWith('.tflite')) return 'tflite';
    if (model.id.endsWith('.gguf')) return 'gguf';
    if (model.id.endsWith('.safetensors')) return 'safetensors';
    return 'generic';
  }
}

export class OnnxRuntimeWebRuntime implements InferenceRuntime {
  id = 'onnxruntime-web';
  private config: OnnxRuntimeWebConfig;

  constructor(config: OnnxRuntimeWebConfig = {}) {
    this.config = config;
  }

  supports(model: InferenceModel): boolean {
    return model.format === 'onnx'
      || model.id.endsWith('.onnx')
      || model.metadata?.runtime === this.id;
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const ort = await this.loadOrt();
    if (this.config.wasmPaths && ort.env?.wasm) {
      ort.env.wasm.wasmPaths = this.config.wasmPaths;
    }

    const modelSource = await this.resolveModelSource(model);
    const session = await ort.InferenceSession.create(modelSource, {
      executionProviders: this.resolveExecutionProviders(model),
      graphOptimizationLevel: model.metadata?.graphOptimizationLevel
        || this.config.graphOptimizationLevel
        || 'all',
    });

    return {
      runtime: this.id,
      session,
      inputNames: session.inputNames,
      outputNames: session.outputNames,
    };
  }

  async unload(_modelId: string, session: Record<string, any>): Promise<void> {
    await (session.session as OnnxSession | undefined)?.release?.();
  }

  async infer(
    model: InferenceModel,
    sessionState: Record<string, any>,
    input: Record<string, any>,
    _options: InferenceOptions
  ): Promise<Record<string, any>> {
    const ort = await this.loadOrt();
    const session = sessionState.session as OnnxSession | undefined;
    if (!session) {
      throw new Error(`ONNX session not loaded for model ${model.id}`);
    }

    const feeds = this.buildFeeds(ort, session, input);
    const outputNames = this.resolveOutputNames(session, input);
    const outputs = await session.run(feeds, outputNames);

    return {
      text: this.outputSummary(outputs),
      outputs,
      outputNames: Object.keys(outputs),
      source: input.source || 'cpu',
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private async loadOrt(): Promise<OnnxRuntimeModule> {
    if (this.config.importOrt) {
      return this.config.importOrt();
    }

    try {
      const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<OnnxRuntimeModule>;
      return await dynamicImport('onnxruntime-web');
    } catch (error) {
      throw new Error(
        `onnxruntime-web is required for OnnxRuntimeWebRuntime. Install it with "npm install onnxruntime-web". Cause: ${error}`
      );
    }
  }

  private async resolveModelSource(model: InferenceModel): Promise<string | ArrayBuffer | Uint8Array> {
    const metadata = model.metadata || {};
    const buffer = metadata.modelBuffer;
    if (buffer) {
      const bytes = this.toUint8Array(buffer);
      await this.verifyModelArtifact(model, bytes);
      return bytes;
    }

    const localPath = metadata.modelPath || metadata.path;
    if (typeof localPath === 'string' && this.shouldVerifyModelArtifact(model)) {
      const bytes = await this.readModelFile(localPath);
      await this.verifyModelArtifact(model, bytes);
      return bytes;
    }

    const source = metadata.modelUrl || metadata.modelPath || metadata.url || metadata.path;
    if (!source) {
      throw new Error(
        `ONNX model ${model.id} requires metadata.modelUrl, metadata.modelPath, metadata.url, metadata.path, or metadata.modelBuffer`
      );
    }
    return source as string | ArrayBuffer | Uint8Array;
  }

  private resolveExecutionProviders(model: InferenceModel): string[] {
    const providers = model.metadata?.executionProviders || this.config.executionProviders;
    if (Array.isArray(providers) && providers.length > 0) {
      return providers;
    }
    return ['wasm'];
  }

  private shouldVerifyModelArtifact(model: InferenceModel): boolean {
    return Boolean(model.metadata?.sha256 || model.metadata?.integrity || model.metadata?.expectedSize);
  }

  private async readModelFile(path: string): Promise<Uint8Array> {
    if (this.config.readFile) {
      return this.config.readFile(path);
    }

    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const fs = await dynamicImport('node:fs/promises');
    return new Uint8Array(await fs.readFile(path));
  }

  private toUint8Array(source: unknown): Uint8Array {
    if (source instanceof Uint8Array) {
      return source;
    }
    if (source instanceof ArrayBuffer) {
      return new Uint8Array(source);
    }
    if (ArrayBuffer.isView(source)) {
      const view = source as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    throw new Error('metadata.modelBuffer must be a Uint8Array, ArrayBuffer, or typed array view');
  }

  private async verifyModelArtifact(model: InferenceModel, bytes: Uint8Array): Promise<void> {
    const expectedSize = model.metadata?.expectedSize;
    if (typeof expectedSize === 'number' && bytes.byteLength !== expectedSize) {
      throw new Error(
        `ONNX model ${model.id} size mismatch: expected ${expectedSize} bytes, received ${bytes.byteLength} bytes`
      );
    }

    const expectedHash = this.normalizeSha256(model.metadata?.sha256 || model.metadata?.integrity);
    if (!expectedHash) {
      return;
    }

    const actualHash = await this.sha256(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(
        `ONNX model ${model.id} SHA-256 mismatch: expected ${expectedHash}, received ${actualHash}`
      );
    }
  }

  private normalizeSha256(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }

    return value.replace(/^sha256-/i, '').toLowerCase();
  }

  private async sha256(bytes: Uint8Array): Promise<string> {
    if (this.config.sha256) {
      return (await this.config.sha256(bytes)).toLowerCase();
    }

    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const stableBytes = new Uint8Array(bytes);
      const hash = await subtle.digest('SHA-256', stableBytes.buffer);
      return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    }

    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const crypto = await dynamicImport('node:crypto');
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  private buildFeeds(
    ort: OnnxRuntimeModule,
    session: OnnxSession,
    input: Record<string, any>
  ): Record<string, any> {
    if (input.feeds && typeof input.feeds === 'object') {
      return input.feeds as Record<string, any>;
    }

    if (input.inputs && typeof input.inputs === 'object') {
      const feeds: Record<string, any> = {};
      for (const [name, value] of Object.entries(input.inputs)) {
        feeds[name] = this.toTensor(ort, value);
      }
      return feeds;
    }

    const tensor = input.tensor || this.extractTensorSpec(input);
    if (tensor) {
      const inputName = input.inputName || session.inputNames[0];
      if (!inputName) {
        throw new Error('ONNX model does not expose an input name');
      }
      return { [inputName]: this.toTensor(ort, tensor) };
    }

    throw new Error(
      'ONNX inference requires tensor input. Pass { feeds }, { inputs }, { tensor }, or { data, dims, type }.'
    );
  }

  private extractTensorSpec(input: Record<string, any>): TensorSpec | undefined {
    if ('data' in input && Array.isArray(input.dims)) {
      return {
        data: input.data as TensorData,
        dims: input.dims as number[],
        type: input.type as string | undefined,
      };
    }
    return undefined;
  }

  private toTensor(ort: OnnxRuntimeModule, value: unknown): any {
    if (this.isOrtTensorLike(value)) {
      return value;
    }

    const spec = value as TensorSpec;
    if (!spec || !('data' in spec) || !Array.isArray(spec.dims)) {
      throw new Error('ONNX tensor spec requires { data, dims, type? }');
    }

    const type = spec.type || this.inferTensorType(spec.data);
    const data = Array.isArray(spec.data)
      ? this.toTypedArray(type, spec.data)
      : spec.data;

    return new ort.Tensor(type, data, spec.dims);
  }

  private isOrtTensorLike(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype !== Object.prototype
      && prototype !== null
      && 'dims' in value
      && 'data' in value
      && 'type' in value;
  }

  private inferTensorType(data: TensorData): string {
    if (data instanceof Float64Array) return 'float64';
    if (data instanceof Int8Array) return 'int8';
    if (data instanceof Uint8Array) return 'uint8';
    if (data instanceof Int16Array) return 'int16';
    if (data instanceof Uint16Array) return 'uint16';
    if (data instanceof Int32Array) return 'int32';
    if (data instanceof Uint32Array) return 'uint32';
    if (typeof BigInt64Array !== 'undefined' && data instanceof BigInt64Array) return 'int64';
    if (typeof BigUint64Array !== 'undefined' && data instanceof BigUint64Array) return 'uint64';
    if (Array.isArray(data) && typeof data[0] === 'bigint') return 'int64';
    return 'float32';
  }

  private toTypedArray(type: string, data: number[] | bigint[]): TensorData {
    switch (type) {
      case 'float64':
        return new Float64Array(data as number[]);
      case 'int8':
        return new Int8Array(data as number[]);
      case 'uint8':
        return new Uint8Array(data as number[]);
      case 'int16':
        return new Int16Array(data as number[]);
      case 'uint16':
        return new Uint16Array(data as number[]);
      case 'int32':
        return new Int32Array(data as number[]);
      case 'uint32':
        return new Uint32Array(data as number[]);
      case 'int64':
        return new BigInt64Array(data as bigint[]);
      case 'uint64':
        return new BigUint64Array(data as bigint[]);
      default:
        return new Float32Array(data as number[]);
    }
  }

  private resolveOutputNames(session: OnnxSession, input: Record<string, any>): string[] | undefined {
    if (Array.isArray(input.outputNames)) {
      return input.outputNames as string[];
    }
    return session.outputNames.length > 0 ? session.outputNames : undefined;
  }

  private outputSummary(outputs: Record<string, any>): string {
    const names = Object.keys(outputs);
    if (names.length === 0) {
      return 'ONNX inference completed with no named outputs';
    }

    const first = outputs[names[0]];
    const dims = Array.isArray(first?.dims) ? first.dims.join('x') : 'unknown';
    return `ONNX inference produced ${names.length} output(s); first=${names[0]} shape=${dims}`;
  }
}

export class HttpInferenceRuntime implements InferenceRuntime {
  id = 'http';

  constructor(private readonly config: HttpInferenceRuntimeConfig = {}) {}

  supports(model: InferenceModel): boolean {
    return model.format === 'http'
      || model.format === 'remote'
      || model.format === 'openai-compatible'
      || model.metadata?.runtime === this.id
      || model.metadata?.runtime === 'openai-compatible'
      || typeof model.metadata?.endpoint === 'string'
      || typeof model.metadata?.apiUrl === 'string';
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const endpoint = this.resolveEndpoint(model);

    return {
      runtime: this.id,
      endpoint,
      headers: this.resolveHeaders(model),
      remoteModel: model.metadata?.remoteModel || model.metadata?.model || model.id,
    };
  }

  async infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const fetcher = this.config.fetch || globalThis.fetch;
    if (!fetcher) {
      throw new Error('fetch is required for HttpInferenceRuntime');
    }

    const endpoint = String(session.endpoint || this.resolveEndpoint(model));
    const body = this.config.buildRequest
      ? this.config.buildRequest(model, input, options)
      : this.buildOpenAICompatibleRequest(model, session, input, options);
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(session.headers as Record<string, string> || {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? this.parseJson(text, endpoint) : {};

    if (!response.ok) {
      throw new Error(`HTTP inference failed for ${model.id}: ${response.status} ${this.errorPreview(payload, text)}`);
    }

    const outputText = this.config.parseResponse
      ? this.config.parseResponse(payload)
      : this.parseOpenAICompatibleResponse(payload);

    return {
      text: outputText,
      response: payload,
      request: body,
      status: response.status,
      source: 'remote',
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private resolveEndpoint(model: InferenceModel): string {
    const endpoint = model.metadata?.endpoint || model.metadata?.apiUrl || this.config.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      throw new Error(`HTTP model ${model.id} requires metadata.endpoint or runtime endpoint`);
    }
    return endpoint;
  }

  private resolveHeaders(model: InferenceModel): Record<string, string> {
    const headers: Record<string, string> = {
      ...(this.config.headers || {}),
      ...(model.metadata?.headers || {}),
    };
    const apiKey = model.metadata?.apiKey || this.config.apiKey;

    if (apiKey && !headers.authorization && !headers.Authorization) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private buildOpenAICompatibleRequest(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Record<string, any> {
    const messages = Array.isArray(input.messages)
      ? input.messages
      : [
          {
            role: 'user',
            content: input.text || input.prompt || input.normalized || JSON.stringify(input),
          },
        ];

    return {
      model: session.remoteModel || model.metadata?.remoteModel || model.id,
      messages,
      temperature: options.temperature ?? model.metadata?.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? model.metadata?.maxTokens ?? 256,
      stream: false,
      ...(model.metadata?.request || {}),
    };
  }

  private parseJson(text: string, endpoint: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`HTTP inference endpoint ${endpoint} returned invalid JSON`);
    }
  }

  private parseOpenAICompatibleResponse(payload: unknown): string {
    const data = payload as Record<string, any>;
    const firstChoice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    const content = firstChoice?.message?.content
      || firstChoice?.delta?.content
      || firstChoice?.text
      || data.output_text
      || data.generated_text
      || data.text
      || data.result;

    if (typeof content !== 'string') {
      throw new Error('HTTP inference response did not include text output');
    }

    return content;
  }

  private errorPreview(payload: unknown, fallback: string): string {
    const data = payload as Record<string, any>;
    const message = data?.error?.message || data?.message || fallback;
    return String(message).slice(0, 240);
  }
}

/**
 * Multi-format model loader
 * Supports ONNX, TensorFlow Lite, GGLM (for LLMs)
 */
export class ModelLoader {
  private loadedModels: Map<string, LoadedModel>;
  private runtimes: InferenceRuntime[];

  constructor(runtimes: InferenceRuntime[] = [new SimulatedInferenceRuntime()]) {
    this.loadedModels = new Map();
    this.runtimes = runtimes;
  }

  async loadModel(model: InferenceModel): Promise<{ modelId: string; status: string; loadTime: number }> {
    if (model.size <= 0) {
      throw new Error('Model size must be positive');
    }

    if (this.loadedModels.has(model.id)) {
      return { modelId: model.id, status: 'already-loaded', loadTime: 0 };
    }

    const startTime = performance.now();
    const format = this.detectFormat(model);
    const runtime = this.selectRuntime(model);

    try {
      const session = await runtime.load(model);

      this.loadedModels.set(model.id, {
        model,
        format,
        loadedAt: Date.now(),
        session: { format, ...session },
        runtime,
      });

      const loadTime = performance.now() - startTime;
      return { modelId: model.id, status: 'loaded', loadTime };
    } catch (error) {
      throw new Error(`Failed to load model ${model.id}: ${error}`);
    }
  }

  private detectFormat(model: InferenceModel): string {
    if (model.format) {
      return model.format;
    }

    if (model.id.endsWith('.onnx')) return 'onnx';
    if (model.id.endsWith('.tflite')) return 'tflite';
    if (model.id.endsWith('.gguf')) return 'gguf';
    if (model.id.endsWith('.safetensors')) return 'safetensors';
    return 'generic';
  }

  private selectRuntime(model: InferenceModel): InferenceRuntime {
    const runtime = this.runtimes.find(candidate => candidate.supports(model));
    if (!runtime) {
      throw new Error(`No inference runtime supports model ${model.id}`);
    }
    return runtime;
  }

  hasModel(modelId: string): boolean {
    return this.loadedModels.has(modelId);
  }

  getModel(modelId: string): InferenceModel | undefined {
    return this.loadedModels.get(modelId)?.model;
  }

  getSession(modelId: string): Record<string, any> | undefined {
    return this.loadedModels.get(modelId)?.session;
  }

  getRuntime(modelId: string): InferenceRuntime | undefined {
    return this.loadedModels.get(modelId)?.runtime;
  }

  listLoaded(): string[] {
    return Array.from(this.loadedModels.keys());
  }

  async unloadModel(modelId: string): Promise<{ modelId: string; status: string }> {
    if (!this.loadedModels.has(modelId)) {
      throw new Error(`Model not loaded: ${modelId}`);
    }

    const loaded = this.loadedModels.get(modelId)!;
    await loaded.runtime.unload?.(modelId, loaded.session);
    this.loadedModels.delete(modelId);
    return { modelId, status: 'unloaded' };
  }
}

/**
 * High-performance inference engine with optimizations
 */
export class InferenceEngine {
  private loader: ModelLoader;
  private config: ResolvedInferenceConfig;
  private cache = new Map<string, CachedEntry>();
  private totalRequests = 0;
  private totalLatency = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: InferenceConfig = {}) {
    this.config = {
      maxBatchSize: 8,
      gpuEnabled: false,
      wasmEnabled: false,
      quantization: 'int8',
      ...config,
      runtimes: config.runtimes?.length ? config.runtimes : [new SimulatedInferenceRuntime()],
    };
    this.loader = new ModelLoader(this.config.runtimes);
  }

  async loadModel(model: InferenceModel): Promise<{ modelId: string; status: string; loadTime: number }> {
    return await this.loader.loadModel(model);
  }

  async unloadModel(modelId: string): Promise<{ modelId: string; status: string }> {
    return this.loader.unloadModel(modelId);
  }

  async infer(
    modelId: string,
    input: InferenceInput,
    options: InferenceOptions = {}
  ): Promise<InferenceOutput> {
    const startTime = performance.now();
    const allowCache = options.cache !== false;
    const cacheKey = this.buildCacheKey(modelId, input, options);

    if (allowCache && this.cache.has(cacheKey)) {
      this.cacheHits++;
      const cached = this.cache.get(cacheKey)!;
      cached.hits += 1;
      return { ...cached.output, cached: true };
    }

    const model = this.loader.getModel(modelId);
    if (!model) {
      throw new Error(`Model not loaded: ${modelId}`);
    }

    const processedInput = this.preprocessInput(input, model);
    const output = await this.compute(model, processedInput, options);
    const inferenceOutput = this.postprocessOutput(output, model, input);

    if (allowCache) {
      this.cache.set(cacheKey, { output: inferenceOutput, timestamp: Date.now(), hits: 1 });
      this.cacheMisses++;
    }

    const latency = performance.now() - startTime;
    this.totalRequests++;
    this.totalLatency += latency;
    console.debug(`[PRISM] Inference latency: ${latency.toFixed(2)}ms`);
    return inferenceOutput;
  }

  async batchInfer(
    modelId: string,
    inputs: InferenceInput[],
    options: InferenceOptions = {}
  ): Promise<Array<InferenceOutput>> {
    const startTime = performance.now();
    const model = this.loader.getModel(modelId);
    if (!model) {
      throw new Error(`Model not loaded: ${modelId}`);
    }

    const batchSize = this.config.maxBatchSize;
    const results: InferenceOutput[] = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const processedBatch = batch.map(input => this.preprocessInput(input, model));
      const batchResults = await this.computeBatch(model, processedBatch, options);

      batchResults.forEach((output, index) => {
        const inferenceOutput = this.postprocessOutput(output, model, batch[index]);
        results.push(inferenceOutput);
      });
    }

    const latency = performance.now() - startTime;
    const throughput = inputs.length / (latency / 1000 || 1);
    console.debug(`[PRISM] Batch inference: ${inputs.length} items in ${latency.toFixed(2)}ms (${throughput.toFixed(0)} items/sec)`);
    return results;
  }

  getStats(): {
    loadedModels: number;
    totalRequests: number;
    averageLatency: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  } {
    return {
      loadedModels: this.loader.listLoaded().length,
      totalRequests: this.totalRequests,
      averageLatency: this.totalRequests > 0 ? this.totalLatency / this.totalRequests : 0,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  listLoadedModels(): string[] {
    return this.loader.listLoaded();
  }

  private buildCacheKey(
    modelId: string,
    input: InferenceInput,
    options: Record<string, any>
  ): string {
    return `${modelId}:${JSON.stringify(input)}:${JSON.stringify({
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 256,
    })}`;
  }

  private preprocessInput(
    input: InferenceInput,
    _model: InferenceModel
  ): Record<string, any> {
    if (typeof input === 'string') {
      return {
        text: input,
        normalized: input.trim().replace(/\s+/g, ' '),
        length: input.length,
      };
    }

    return {
      ...input,
      normalized: JSON.stringify(input),
    };
  }

  private async compute(
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const runtime = this.loader.getRuntime(model.id);
    const session = this.loader.getSession(model.id);

    if (!runtime || !session) {
      throw new Error(`Model runtime not loaded: ${model.id}`);
    }

    return runtime.infer(model, session, input, this.resolveExecutionOptions(options));
  }

  private async computeBatch(
    model: InferenceModel,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    const runtime = this.loader.getRuntime(model.id);
    const session = this.loader.getSession(model.id);

    if (!runtime || !session) {
      throw new Error(`Model runtime not loaded: ${model.id}`);
    }

    const executionOptions = this.resolveExecutionOptions(options);
    if (runtime.batchInfer) {
      return runtime.batchInfer(model, session, inputs, executionOptions);
    }

    return Promise.all(
      inputs.map(input => runtime.infer(model, session, input, executionOptions))
    );
  }

  private postprocessOutput(
    output: Record<string, any>,
    model: InferenceModel,
    originalInput: string | Record<string, any>
  ): InferenceOutput {
    const tokens = this.estimateTokenCount(originalInput);
    const text = this.generateTextResponse(model, originalInput, output);

    return {
      text,
      tokens,
      modelId: model.id,
      modelName: model.name,
      source: output.source || 'cpu',
      ...(output.runtime && output.runtime !== 'simulated' ? { raw: output } : {}),
    };
  }

  private estimateTokenCount(input: InferenceInput): number {
    if (typeof input === 'string') {
      return Math.max(1, Math.min(256, Math.floor(input.length / 4)));
    }

    return Math.max(1, Math.min(256, Math.floor(JSON.stringify(input).length / 4)));
  }

  private generateTextResponse(
    model: InferenceModel,
    input: InferenceInput,
    output: Record<string, any>
  ): string {
    if (typeof output.text === 'string') {
      return output.text;
    }

    const preview = typeof input === 'string' ? input : JSON.stringify(input);
    const shortInput = preview.length > 120 ? preview.slice(0, 120) + '...' : preview;
    const style = model.name.toLowerCase().includes('llama')
      ? 'Llama-style'
      : model.name.toLowerCase().includes('qwen')
      ? 'Qwen-style'
      : 'PRISM-style';

    return `${style} response for ${shortInput}`;
  }

  private resolveExecutionOptions(options: InferenceOptions): InferenceOptions {
    return {
      ...options,
      useGPU: Boolean(this.config.gpuEnabled && options.useGPU && this.hasWebGPU()),
    };
  }

  private hasWebGPU(): boolean {
    return typeof globalThis !== 'undefined' && 'navigator' in globalThis && typeof (globalThis as any).navigator?.gpu !== 'undefined';
  }
}

/**
 * Quantization utilities for smaller models
 */
export class QuantizationUtils {
  static quantizeInt8(weights: Float32Array): Int8Array {
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const scale = max === min ? 1 : 255.0 / (max - min);

    return new Int8Array(
      Array.from(weights).map(w => Math.round((w - min) * scale - 128))
    );
  }

  static dequantizeInt8(
    weights: Int8Array,
    min: number,
    max: number
  ): Float32Array {
    const scale = max === min ? 1 : (max - min) / 255.0;
    return new Float32Array(
      Array.from(weights).map(w => (w + 128) * scale + min)
    );
  }

  static estimateSize(original: number, quantization: string): number {
    switch (quantization) {
      case 'int8':
        return Math.round(original * 0.25);
      case 'int4':
        return Math.round(original * 0.125);
      case 'float16':
        return Math.round(original * 0.5);
      default:
        return original;
    }
  }
}
