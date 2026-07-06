import { PrismCRDT } from '../../application/prism-crdt';
import type { EdgeNode, InferenceModel, InferenceRequest, InferenceResult } from '../../index';
import {
  createEdgeAdapter,
  MemoryEdgeCache,
  type EdgeAdapterDependencies,
  type EdgeCache,
  type EdgeConfig,
  type EdgeInferenceHandler,
  type EdgePlatform,
  type EdgeRequestContext,
} from './edge';

export interface PrismEdgeGatewayHealth {
  ok: boolean;
  service: string;
  initialized: boolean;
  platform: EdgePlatform;
  model: InferenceModel;
  stats: ReturnType<PrismCRDT['getStats']>;
  endpoints: {
    infer: 'POST /infer';
    health: 'GET /health';
  };
}

export interface PrismEdgeGatewayRoutes {
  health?: string;
  infer?: string;
  rootHealth?: boolean;
}

export interface PrismEdgeGatewayCorsConfig {
  origin?: string;
  methods?: string[];
  headers?: string[];
}

export interface PrismEdgeGatewayConfig {
  nodeId: string;
  model: InferenceModel;
  platform: EdgePlatform;
  region?: string;
  cacheTtl?: number;
  edgeId?: string;
  serviceName?: string;
  prism?: PrismCRDT;
  cache?: EdgeCache;
  capabilities?: EdgeNode['capabilities'];
  edgeConfig?: EdgeConfig | ((request: Request) => EdgeConfig);
  routes?: PrismEdgeGatewayRoutes;
  cors?: boolean | PrismEdgeGatewayCorsConfig;
  infer?: EdgeInferenceHandler;
  enrichOutput?: (
    result: InferenceResult,
    request: InferenceRequest,
    context: EdgeRequestContext
  ) => InferenceResult | Promise<InferenceResult>;
}

export class PrismEdgeGateway {
  private readonly prism: PrismCRDT;
  private readonly capabilities: EdgeNode['capabilities'];
  private readonly cache: EdgeCache;
  private initialized = false;
  private initializePromise?: Promise<void>;

  constructor(private readonly config: PrismEdgeGatewayConfig) {
    this.prism = config.prism ?? new PrismCRDT({ nodeId: config.nodeId, region: config.region });
    this.cache = config.cache ?? new MemoryEdgeCache();
    this.capabilities = config.capabilities ?? {
      gpu: false,
      wasm: true,
      quantization: true,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializePromise) {
      this.initializePromise = this.initializeOnce();
    }

    await this.initializePromise;
  }

  async handleInferenceRequest(request: Request): Promise<Response> {
    const adapter = createEdgeAdapter(this.resolveEdgeConfig(request), {
      cache: this.cache,
      infer: this.config.infer ?? this.inferWithPrism,
    } satisfies EdgeAdapterDependencies);

    return adapter.handleRequest(request);
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const routes = this.resolveRoutes();

    if (request.method === 'OPTIONS') {
      return this.jsonResponse({ ok: true });
    }

    if (
      request.method === 'GET'
      && (url.pathname === routes.health || (routes.rootHealth && url.pathname === '/'))
    ) {
      return this.jsonResponse(await this.health());
    }

    if (request.method === 'POST' && url.pathname === routes.infer) {
      return this.withCors(await this.handleInferenceRequest(request));
    }

    return this.jsonResponse({
      error: 'Not found',
      endpoints: [`GET ${routes.health}`, `POST ${routes.infer}`],
    }, 404);
  }

  async health(): Promise<PrismEdgeGatewayHealth> {
    await this.initialize();

    return {
      ok: true,
      service: this.config.serviceName ?? 'prism-edge-gateway',
      initialized: this.initialized,
      platform: this.config.platform,
      model: this.config.model,
      stats: this.prism.getStats(),
      endpoints: {
        infer: 'POST /infer',
        health: 'GET /health',
      },
    };
  }

  getPrism(): PrismCRDT {
    return this.prism;
  }

  private async initializeOnce(): Promise<void> {
    await this.prism.registerNode(this.capabilities);

    if (!(await this.prism.isModelDeployed(this.config.model.id))) {
      await this.prism.deployModel(this.config.model);
    }

    this.initialized = true;
  }

  private inferWithPrism = async (
    request: InferenceRequest,
    context: EdgeRequestContext
  ): Promise<InferenceResult> => {
    await this.initialize();

    const result = await this.prism.infer({
      ...request,
      edgeId: request.edgeId ?? context.edgeId,
    });

    if (!this.config.enrichOutput) {
      return result;
    }

    return this.config.enrichOutput(result, request, context);
  };

  private resolveEdgeConfig(request: Request): EdgeConfig {
    if (typeof this.config.edgeConfig === 'function') {
      return this.config.edgeConfig(request);
    }

    if (this.config.edgeConfig) {
      return this.config.edgeConfig;
    }

    return {
      platform: this.config.platform,
      region: this.config.region,
      cacheTtl: this.config.cacheTtl,
      edgeId: this.config.edgeId,
    };
  }

  private resolveRoutes(): Required<PrismEdgeGatewayRoutes> {
    return {
      health: this.config.routes?.health ?? '/health',
      infer: this.config.routes?.infer ?? '/infer',
      rootHealth: this.config.routes?.rootHealth ?? true,
    };
  }

  private jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...this.corsHeaders(),
      },
    });
  }

  private withCors(response: Response): Response {
    const headers = new Headers(response.headers);

    for (const [key, value] of Object.entries(this.corsHeaders())) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private corsHeaders(): Record<string, string> {
    if (!this.config.cors) {
      return {};
    }

    const cors = this.config.cors === true ? {} : this.config.cors;

    return {
      'access-control-allow-origin': cors.origin ?? '*',
      'access-control-allow-methods': (cors.methods ?? ['GET', 'POST', 'OPTIONS']).join(','),
      'access-control-allow-headers': (cors.headers ?? ['content-type', 'authorization']).join(','),
    };
  }
}
