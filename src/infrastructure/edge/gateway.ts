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
  openapi?: string;
  rootHealth?: boolean;
}

export interface PrismEdgeGatewayCorsConfig {
  origin?: string;
  methods?: string[];
  headers?: string[];
}

export interface PrismEdgeGatewayOpenAPIInfo {
  title?: string;
  version?: string;
  description?: string;
}

export interface PrismEdgeGatewayOpenAPISpec {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
  };
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
  };
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
  openapi?: PrismEdgeGatewayOpenAPIInfo | false;
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

    if (this.config.openapi !== false && request.method === 'GET' && url.pathname === routes.openapi) {
      return this.jsonResponse(this.getOpenAPISpec());
    }

    if (request.method === 'POST' && url.pathname === routes.infer) {
      return this.withCors(await this.handleInferenceRequest(request));
    }

    return this.jsonResponse({
      error: 'Not found',
      endpoints: this.routeList(routes),
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

  getOpenAPISpec(): PrismEdgeGatewayOpenAPISpec {
    const routes = this.resolveRoutes();
    const info = this.config.openapi === false ? {} : this.config.openapi ?? {};

    return {
      openapi: '3.1.0',
      info: {
        title: info.title ?? `${this.config.serviceName ?? 'PRISM Edge Gateway'} API`,
        version: info.version ?? this.modelVersion(),
        description: info.description ?? `PRISM edge gateway for ${this.config.model.name}`,
      },
      paths: {
        [routes.health]: {
          get: {
            summary: 'Read PRISM edge gateway health',
            operationId: 'getPrismEdgeHealth',
            responses: {
              '200': {
                description: 'Gateway health, model, endpoints, and CRDT stats',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/PrismEdgeGatewayHealth' },
                  },
                },
              },
            },
          },
        },
        [routes.infer]: {
          post: {
            summary: 'Run PRISM edge inference',
            operationId: 'runPrismEdgeInference',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/InferenceRequest' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Inference result envelope',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/EdgeResponse' },
                  },
                },
              },
              '400': {
                description: 'Invalid inference request',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/EdgeErrorResponse' },
                  },
                },
              },
            },
          },
        },
        ...(this.config.openapi === false ? {} : {
          [routes.openapi]: {
            get: {
              summary: 'Read this OpenAPI document',
              operationId: 'getPrismEdgeOpenAPI',
              responses: {
                '200': {
                  description: 'OpenAPI 3.1 document for this gateway',
                },
              },
            },
          },
        }),
      },
      components: {
        schemas: {
          InferenceRequest: {
            type: 'object',
            required: ['id', 'modelId', 'input'],
            properties: {
              id: { type: 'string' },
              modelId: { type: 'string', const: this.config.model.id },
              input: {
                oneOf: [
                  { type: 'string' },
                  { type: 'object', additionalProperties: true },
                ],
              },
              options: {
                type: 'object',
                properties: {
                  temperature: { type: 'number' },
                  maxTokens: { type: 'number' },
                  priority: { type: 'string', enum: ['low', 'normal', 'high'] },
                },
              },
              edgeId: { type: 'string' },
            },
          },
          EdgeResponse: {
            type: 'object',
            required: ['success', 'latency', 'cached'],
            properties: {
              success: { type: 'boolean' },
              data: { $ref: '#/components/schemas/InferenceResult' },
              latency: { type: 'number' },
              cached: { type: 'boolean' },
            },
          },
          EdgeErrorResponse: {
            type: 'object',
            required: ['success', 'error', 'latency', 'cached'],
            properties: {
              success: { type: 'boolean', const: false },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
              latency: { type: 'number' },
              cached: { type: 'boolean', const: false },
            },
          },
          InferenceResult: {
            type: 'object',
            required: ['id', 'modelId', 'output', 'latency', 'edgeId', 'timestamp'],
            properties: {
              id: { type: 'string' },
              modelId: { type: 'string' },
              output: {},
              latency: { type: 'number' },
              edgeId: { type: 'string' },
              timestamp: { type: 'number' },
              cached: { type: 'boolean' },
            },
          },
          PrismEdgeGatewayHealth: {
            type: 'object',
            required: ['ok', 'service', 'initialized', 'platform', 'model', 'stats', 'endpoints'],
            properties: {
              ok: { type: 'boolean' },
              service: { type: 'string' },
              initialized: { type: 'boolean' },
              platform: { type: 'string' },
              model: { type: 'object', additionalProperties: true },
              stats: { type: 'object', additionalProperties: true },
              endpoints: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    };
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
      openapi: this.config.routes?.openapi ?? '/openapi.json',
      rootHealth: this.config.routes?.rootHealth ?? true,
    };
  }

  private routeList(routes: Required<PrismEdgeGatewayRoutes>): string[] {
    const endpoints = [`GET ${routes.health}`, `POST ${routes.infer}`];

    if (this.config.openapi !== false) {
      endpoints.push(`GET ${routes.openapi}`);
    }

    return endpoints;
  }

  private modelVersion(): string {
    const version = this.config.model.metadata?.version;
    return typeof version === 'string' && version.length > 0 ? version : '1.0.0';
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
