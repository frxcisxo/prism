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
    metrics: 'GET /metrics';
  };
}

export interface PrismEdgeGatewayRoutes {
  health?: string;
  infer?: string;
  openapi?: string;
  metrics?: string;
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
    securitySchemes?: Record<string, unknown>;
  };
}

export type PrismEdgeGatewayRouteName = 'health' | 'infer' | 'openapi' | 'metrics';
export type PrismEdgeGatewayObservedRouteName = PrismEdgeGatewayRouteName | 'preflight' | 'notFound';

export interface PrismEdgeGatewayRouteMetrics {
  requests: number;
  latencyMs: number;
  averageLatencyMs: number;
  status: Record<string, number>;
}

export interface PrismEdgeGatewayMetricsSnapshot {
  generatedAt: number;
  service: string;
  totals: {
    requests: number;
    unauthorized: number;
    rateLimited: number;
    errors: number;
    latencyMs: number;
    averageLatencyMs: number;
  };
  routes: Record<PrismEdgeGatewayObservedRouteName, PrismEdgeGatewayRouteMetrics>;
}

export interface PrismEdgeGatewayMetricsConfig {
  prometheus?: boolean;
}

export interface PrismEdgeGatewayAuthConfig {
  bearerToken?: string | string[];
  authorize?: (
    request: Request,
    route: PrismEdgeGatewayRouteName
  ) => boolean | Promise<boolean>;
  protectedRoutes?: PrismEdgeGatewayRouteName[];
  realm?: string;
}

export interface PrismEdgeGatewayRateLimitConfig {
  limit: number;
  windowMs: number;
  routes?: PrismEdgeGatewayRouteName[];
  key?: (request: Request, route: PrismEdgeGatewayRouteName) => string;
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
  auth?: PrismEdgeGatewayAuthConfig;
  rateLimit?: PrismEdgeGatewayRateLimitConfig;
  metrics?: PrismEdgeGatewayMetricsConfig | false;
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
  private readonly rateLimitEntries = new Map<string, { count: number; resetAt: number }>();
  private readonly metrics: PrismEdgeGatewayMetricsSnapshot;
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
    this.metrics = this.createEmptyMetricsSnapshot();
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
    const startedAt = this.now();
    const url = new URL(request.url);
    const routes = this.resolveRoutes();

    if (request.method === 'OPTIONS') {
      return this.recordResponse('preflight', startedAt, this.jsonResponse({ ok: true }));
    }

    if (
      request.method === 'GET'
      && (url.pathname === routes.health || (routes.rootHealth && url.pathname === '/'))
    ) {
      const unauthorized = await this.unauthorizedResponse(request, 'health');
      if (unauthorized) {
        return this.recordResponse('health', startedAt, unauthorized);
      }

      const limited = this.rateLimitResponse(request, 'health');
      if (limited) {
        return this.recordResponse('health', startedAt, limited);
      }

      return this.recordResponse('health', startedAt, this.jsonResponse(await this.health()));
    }

    if (this.config.openapi !== false && request.method === 'GET' && url.pathname === routes.openapi) {
      const unauthorized = await this.unauthorizedResponse(request, 'openapi');
      if (unauthorized) {
        return this.recordResponse('openapi', startedAt, unauthorized);
      }

      const limited = this.rateLimitResponse(request, 'openapi');
      if (limited) {
        return this.recordResponse('openapi', startedAt, limited);
      }

      return this.recordResponse('openapi', startedAt, this.jsonResponse(this.getOpenAPISpec()));
    }

    if (this.metricsEnabled() && request.method === 'GET' && url.pathname === routes.metrics) {
      const unauthorized = await this.unauthorizedResponse(request, 'metrics');
      if (unauthorized) {
        return this.recordResponse('metrics', startedAt, unauthorized);
      }

      const limited = this.rateLimitResponse(request, 'metrics');
      if (limited) {
        return this.recordResponse('metrics', startedAt, limited);
      }

      return this.recordResponse('metrics', startedAt, this.metricsResponse());
    }

    if (request.method === 'POST' && url.pathname === routes.infer) {
      const unauthorized = await this.unauthorizedResponse(request, 'infer');
      if (unauthorized) {
        return this.recordResponse('infer', startedAt, unauthorized);
      }

      const limited = this.rateLimitResponse(request, 'infer');
      if (limited) {
        return this.recordResponse('infer', startedAt, limited);
      }

      return this.recordResponse('infer', startedAt, this.withCors(await this.handleInferenceRequest(request)));
    }

    return this.recordResponse('notFound', startedAt, this.jsonResponse({
      error: 'Not found',
      endpoints: this.routeList(routes),
    }, 404));
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
        metrics: 'GET /metrics',
      },
    };
  }

  getPrism(): PrismCRDT {
    return this.prism;
  }

  getMetricsSnapshot(): PrismEdgeGatewayMetricsSnapshot {
    return this.cloneMetricsSnapshot();
  }

  toPrometheusMetrics(): string {
    const snapshot = this.getMetricsSnapshot();
    const lines = [
      '# HELP prism_edge_gateway_requests_total Total PRISM edge gateway requests.',
      '# TYPE prism_edge_gateway_requests_total counter',
      `prism_edge_gateway_requests_total ${snapshot.totals.requests}`,
      '# HELP prism_edge_gateway_route_requests_total Total PRISM edge gateway requests by route and status.',
      '# TYPE prism_edge_gateway_route_requests_total counter',
    ];

    for (const [route, metrics] of Object.entries(snapshot.routes)) {
      for (const [status, count] of Object.entries(metrics.status)) {
        lines.push(`prism_edge_gateway_route_requests_total{route="${this.metricLabel(route)}",status="${this.metricLabel(status)}"} ${count}`);
      }
    }

    lines.push(
      '# HELP prism_edge_gateway_unauthorized_total Total unauthorized PRISM edge gateway requests.',
      '# TYPE prism_edge_gateway_unauthorized_total counter',
      `prism_edge_gateway_unauthorized_total ${snapshot.totals.unauthorized}`,
      '# HELP prism_edge_gateway_rate_limited_total Total rate-limited PRISM edge gateway requests.',
      '# TYPE prism_edge_gateway_rate_limited_total counter',
      `prism_edge_gateway_rate_limited_total ${snapshot.totals.rateLimited}`,
      '# HELP prism_edge_gateway_errors_total Total PRISM edge gateway 5xx responses.',
      '# TYPE prism_edge_gateway_errors_total counter',
      `prism_edge_gateway_errors_total ${snapshot.totals.errors}`,
      '# HELP prism_edge_gateway_latency_ms_sum Total PRISM edge gateway latency in milliseconds by route.',
      '# TYPE prism_edge_gateway_latency_ms_sum counter',
    );

    for (const [route, metrics] of Object.entries(snapshot.routes)) {
      lines.push(`prism_edge_gateway_latency_ms_sum{route="${this.metricLabel(route)}"} ${metrics.latencyMs}`);
    }

    lines.push(
      '# HELP prism_edge_gateway_latency_ms_count Total PRISM edge gateway latency samples by route.',
      '# TYPE prism_edge_gateway_latency_ms_count counter',
    );

    for (const [route, metrics] of Object.entries(snapshot.routes)) {
      lines.push(`prism_edge_gateway_latency_ms_count{route="${this.metricLabel(route)}"} ${metrics.requests}`);
    }

    return `${lines.join('\n')}\n`;
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
            ...(this.openapiSecurity('health')),
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
            ...(this.openapiSecurity('infer')),
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
              '401': {
                description: 'Unauthorized request',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/EdgeErrorResponse' },
                  },
                },
              },
              '429': {
                description: 'Rate limit exceeded',
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
              ...(this.openapiSecurity('openapi')),
              responses: {
                '200': {
                  description: 'OpenAPI 3.1 document for this gateway',
                },
              },
            },
          },
        }),
        ...(this.metricsEnabled() ? {
          [routes.metrics]: {
            get: {
              summary: 'Read PRISM edge gateway Prometheus metrics',
              operationId: 'getPrismEdgeMetrics',
              ...(this.openapiSecurity('metrics')),
              responses: {
                '200': {
                  description: 'Prometheus text exposition for gateway traffic, auth, rate limits, and latency',
                  content: {
                    'text/plain': {
                      schema: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        } : {}),
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
        ...(this.config.auth ? {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
            },
          },
        } : {}),
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
      metrics: this.config.routes?.metrics ?? '/metrics',
      rootHealth: this.config.routes?.rootHealth ?? true,
    };
  }

  private routeList(routes: Required<PrismEdgeGatewayRoutes>): string[] {
    const endpoints = [`GET ${routes.health}`, `POST ${routes.infer}`];

    if (this.config.openapi !== false) {
      endpoints.push(`GET ${routes.openapi}`);
    }

    if (this.metricsEnabled()) {
      endpoints.push(`GET ${routes.metrics}`);
    }

    return endpoints;
  }

  private modelVersion(): string {
    const version = this.config.model.metadata?.version;
    return typeof version === 'string' && version.length > 0 ? version : '1.0.0';
  }

  private async unauthorizedResponse(
    request: Request,
    route: PrismEdgeGatewayRouteName
  ): Promise<Response | undefined> {
    if (!(await this.isAuthorized(request, route))) {
      return this.jsonResponse({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
        latency: 0,
        cached: false,
      }, 401, {
        'www-authenticate': `Bearer realm="${this.config.auth?.realm ?? 'prism-edge'}"`,
      });
    }

    return undefined;
  }

  private async isAuthorized(request: Request, route: PrismEdgeGatewayRouteName): Promise<boolean> {
    const auth = this.config.auth;

    if (!auth || !this.isProtectedRoute(route)) {
      return true;
    }

    if (auth.authorize && await auth.authorize(request, route)) {
      return true;
    }

    if (!auth.bearerToken) {
      return false;
    }

    const header = request.headers.get('authorization') ?? '';
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return false;
    }

    const allowed = Array.isArray(auth.bearerToken) ? auth.bearerToken : [auth.bearerToken];
    return allowed.includes(token);
  }

  private isProtectedRoute(route: PrismEdgeGatewayRouteName): boolean {
    if (!this.config.auth) {
      return false;
    }

    return (this.config.auth.protectedRoutes ?? ['infer']).includes(route);
  }

  private openapiSecurity(route: PrismEdgeGatewayRouteName): Record<string, unknown> {
    return this.isProtectedRoute(route)
      ? { security: [{ bearerAuth: [] }] }
      : {};
  }

  private rateLimitResponse(
    request: Request,
    route: PrismEdgeGatewayRouteName
  ): Response | undefined {
    const rateLimit = this.config.rateLimit;

    if (!rateLimit || !(rateLimit.routes ?? ['infer']).includes(route)) {
      return undefined;
    }

    const now = Date.now();
    const key = `${route}:${rateLimit.key?.(request, route) ?? this.defaultRateLimitKey(request)}`;
    const current = this.rateLimitEntries.get(key);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + rateLimit.windowMs };

    if (entry.count >= rateLimit.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

      return this.jsonResponse({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
        },
        latency: 0,
        cached: false,
      }, 429, {
        'retry-after': String(retryAfterSeconds),
        'x-ratelimit-limit': String(rateLimit.limit),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(entry.resetAt),
      });
    }

    entry.count += 1;
    this.rateLimitEntries.set(key, entry);

    return undefined;
  }

  private defaultRateLimitKey(request: Request): string {
    return request.headers.get('cf-connecting-ip')
      ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('authorization')
      ?? 'anonymous';
  }

  private jsonResponse(
    body: unknown,
    status = 200,
    extraHeaders: Record<string, string> = {}
  ): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...this.corsHeaders(),
        ...extraHeaders,
      },
    });
  }

  private metricsResponse(): Response {
    return new Response(this.toPrometheusMetrics(), {
      status: 200,
      headers: {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
        ...this.corsHeaders(),
      },
    });
  }

  private metricsEnabled(): boolean {
    return this.config.metrics !== false && this.config.metrics?.prometheus !== false;
  }

  private createEmptyMetricsSnapshot(): PrismEdgeGatewayMetricsSnapshot {
    return {
      generatedAt: Date.now(),
      service: this.config.serviceName ?? 'prism-edge-gateway',
      totals: {
        requests: 0,
        unauthorized: 0,
        rateLimited: 0,
        errors: 0,
        latencyMs: 0,
        averageLatencyMs: 0,
      },
      routes: {
        health: this.emptyRouteMetrics(),
        infer: this.emptyRouteMetrics(),
        openapi: this.emptyRouteMetrics(),
        metrics: this.emptyRouteMetrics(),
        preflight: this.emptyRouteMetrics(),
        notFound: this.emptyRouteMetrics(),
      },
    };
  }

  private emptyRouteMetrics(): PrismEdgeGatewayRouteMetrics {
    return {
      requests: 0,
      latencyMs: 0,
      averageLatencyMs: 0,
      status: {},
    };
  }

  private recordResponse(
    route: PrismEdgeGatewayObservedRouteName,
    startedAt: number,
    response: Response
  ): Response {
    const elapsed = Math.max(0, this.now() - startedAt);
    const status = String(response.status);
    const routeMetrics = this.metrics.routes[route];

    this.metrics.generatedAt = Date.now();
    this.metrics.totals.requests += 1;
    this.metrics.totals.latencyMs += elapsed;
    this.metrics.totals.averageLatencyMs = this.average(
      this.metrics.totals.latencyMs,
      this.metrics.totals.requests
    );

    if (response.status === 401) {
      this.metrics.totals.unauthorized += 1;
    }

    if (response.status === 429) {
      this.metrics.totals.rateLimited += 1;
    }

    if (response.status >= 500) {
      this.metrics.totals.errors += 1;
    }

    routeMetrics.requests += 1;
    routeMetrics.latencyMs += elapsed;
    routeMetrics.averageLatencyMs = this.average(routeMetrics.latencyMs, routeMetrics.requests);
    routeMetrics.status[status] = (routeMetrics.status[status] ?? 0) + 1;

    return response;
  }

  private cloneMetricsSnapshot(): PrismEdgeGatewayMetricsSnapshot {
    return {
      generatedAt: this.metrics.generatedAt,
      service: this.metrics.service,
      totals: { ...this.metrics.totals },
      routes: Object.fromEntries(
        Object.entries(this.metrics.routes).map(([route, metrics]) => [
          route,
          {
            requests: metrics.requests,
            latencyMs: metrics.latencyMs,
            averageLatencyMs: metrics.averageLatencyMs,
            status: { ...metrics.status },
          },
        ])
      ) as Record<PrismEdgeGatewayObservedRouteName, PrismEdgeGatewayRouteMetrics>,
    };
  }

  private average(total: number, samples: number): number {
    return samples === 0 ? 0 : total / samples;
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private metricLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
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
