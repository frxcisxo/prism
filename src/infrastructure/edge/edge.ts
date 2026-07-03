/**
 * Edge deployment module for PRISM
 * Deploy to: Vercel Edge Functions, Cloudflare Workers, Netlify Edge
 */

import type { InferenceRequest, InferenceResult } from '../../index';

export type EdgePlatform = 'vercel' | 'cloudflare' | 'netlify' | 'deno-deploy';

export interface EdgeConfig {
  platform: EdgePlatform;
  region?: string;
  cacheTtl?: number;
  edgeId?: string;
}

export interface EdgeResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  latency: number;
  cached: boolean;
}

export interface EdgeRequestContext {
  platform: EdgePlatform;
  edgeId: string;
  region?: string;
  cacheKey: string;
  request: Request;
}

export interface EdgeCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export type EdgeInferenceHandler = (
  request: InferenceRequest,
  context: EdgeRequestContext
) => Promise<InferenceResult>;

export interface EdgeAdapterDependencies {
  cache?: EdgeCache;
  infer?: EdgeInferenceHandler;
}

class MemoryEdgeCache implements EdgeCache {
  private entries = new Map<string, { expiresAt: number; value: unknown }>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      return;
    }

    this.entries.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      value,
    });
  }
}

abstract class BaseEdgeAdapter {
  protected readonly cache: EdgeCache;
  protected readonly infer: EdgeInferenceHandler;

  constructor(
    protected readonly config: EdgeConfig,
    dependencies: EdgeAdapterDependencies = {}
  ) {
    this.cache = dependencies.cache ?? new MemoryEdgeCache();
    this.infer = dependencies.infer ?? this.defaultInfer.bind(this);
  }

  async handleRequest(request: Request): Promise<Response> {
    const startTime = performance.now();

    try {
      const body = await request.json() as Partial<InferenceRequest>;
      const validationError = this.validateRequest(body);

      if (validationError) {
        return this.errorResponse('INVALID_REQUEST', validationError, startTime, 400);
      }

      const inferenceRequest = body as InferenceRequest;
      const cacheKey = await this.createCacheKey(inferenceRequest);
      const cached = await this.cache.get<InferenceResult>(cacheKey);

      if (cached) {
        return this.successResponse(cached, startTime, true);
      }

      const context: EdgeRequestContext = {
        platform: this.config.platform,
        edgeId: this.edgeId,
        region: this.config.region,
        cacheKey,
        request,
      };
      const result = await this.infer(inferenceRequest, context);
      const ttl = this.config.cacheTtl ?? 3600;

      await this.cache.set(cacheKey, result, ttl);

      return this.successResponse(result, startTime, false);
    } catch (error) {
      return this.errorResponse('INFERENCE_ERROR', this.safeErrorMessage(error), startTime, 500);
    }
  }

  protected abstract get edgeLocation(): string;
  protected abstract get edgeId(): string;

  protected async defaultInfer(
    request: InferenceRequest,
    context: EdgeRequestContext
  ): Promise<InferenceResult> {
    return {
      id: request.id,
      modelId: request.modelId,
      output: `${this.edgeLocation} inference${context.region ? ` at ${context.region}` : ''}`,
      latency: 0,
      edgeId: context.edgeId,
      timestamp: Date.now(),
      cached: false,
    } as InferenceResult;
  }

  private validateRequest(body: Partial<InferenceRequest>): string | undefined {
    if (!body || typeof body !== 'object') {
      return 'Request body must be a JSON object';
    }

    if (typeof body.id !== 'string' || body.id.trim().length === 0) {
      return 'Missing required field: id';
    }

    if (typeof body.modelId !== 'string' || body.modelId.trim().length === 0) {
      return 'Missing required field: modelId';
    }

    if (body.input === undefined || body.input === null) {
      return 'Missing required field: input';
    }

    return undefined;
  }

  private async createCacheKey(request: InferenceRequest): Promise<string> {
    const material = JSON.stringify({
      modelId: request.modelId,
      input: request.input,
      options: request.options,
      edgeId: request.edgeId,
    });
    const bytes = new TextEncoder().encode(material);

    if (!globalThis.crypto?.subtle) {
      throw new Error('Web Crypto SHA-256 is required to build secure edge cache keys');
    }

    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);

    return `prism:${request.modelId}:${Array.from(new Uint8Array(hash))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  private successResponse(
    result: InferenceResult,
    startTime: number,
    cached: boolean
  ): Response {
    const latency = performance.now() - startTime;

    return this.jsonResponse(
      {
        success: true,
        data: {
          ...result,
          cached,
          latency: cached ? latency : result.latency || latency,
        },
        latency,
        cached,
      },
      200
    );
  }

  private jsonResponse(data: EdgeResponse<InferenceResult>, status: number): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-edge-location': this.edgeLocation,
      },
    });
  }

  private errorResponse(
    code: string,
    message: string,
    startTime: number,
    status: number
  ): Response {
    return this.jsonResponse(
      {
        success: false,
        error: { code, message },
        latency: performance.now() - startTime,
        cached: false,
      },
      status
    );
  }

  private safeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Vercel Edge Functions adapter
 * Ultra-low latency with Vercel's global network
 */
export class VercelEdgeAdapter extends BaseEdgeAdapter {
  constructor(config: EdgeConfig, dependencies?: EdgeAdapterDependencies) {
    super(config, dependencies);
  }

  protected get edgeLocation(): string {
    return 'vercel';
  }

  protected get edgeId(): string {
    return this.config.edgeId ?? 'vercel-edge';
  }
}

/**
 * Cloudflare Workers adapter
 * Ultra-fast with Wasm support
 */
export class CloudflareEdgeAdapter extends BaseEdgeAdapter {
  constructor(config: EdgeConfig, dependencies?: EdgeAdapterDependencies) {
    super(config, dependencies);
  }

  protected get edgeLocation(): string {
    return 'cloudflare';
  }

  protected get edgeId(): string {
    return this.config.edgeId ?? 'cloudflare-worker';
  }
}

/**
 * Netlify Edge Functions adapter
 */
export class NetlifyEdgeAdapter extends BaseEdgeAdapter {
  constructor(config: Partial<EdgeConfig> = {}, dependencies?: EdgeAdapterDependencies) {
    super({ ...config, platform: 'netlify' }, dependencies);
  }

  protected get edgeLocation(): string {
    return 'netlify';
  }

  protected get edgeId(): string {
    return this.config.edgeId ?? 'netlify-edge';
  }
}

/**
 * Deno Deploy adapter
 * Native TypeScript, security-first
 */
export class DenoDeployAdapter extends BaseEdgeAdapter {
  constructor(config: Partial<EdgeConfig> = {}, dependencies?: EdgeAdapterDependencies) {
    super({ ...config, platform: 'deno-deploy' }, dependencies);
  }

  protected get edgeLocation(): string {
    return 'deno-deploy';
  }

  protected get edgeId(): string {
    return this.config.edgeId ?? 'deno-deploy';
  }
}

/**
 * Factory for creating edge adapters
 */
export function createEdgeAdapter(
  config: EdgeConfig,
  dependencies?: EdgeAdapterDependencies
) {
  switch (config.platform) {
    case 'vercel':
      return new VercelEdgeAdapter(config, dependencies);
    case 'cloudflare':
      return new CloudflareEdgeAdapter(config, dependencies);
    case 'netlify':
      return new NetlifyEdgeAdapter(config, dependencies);
    case 'deno-deploy':
      return new DenoDeployAdapter(config, dependencies);
    default:
      throw new Error(`Unknown edge platform: ${config.platform}`);
  }
}

export default {
  VercelEdgeAdapter,
  CloudflareEdgeAdapter,
  NetlifyEdgeAdapter,
  DenoDeployAdapter,
  createEdgeAdapter,
};
