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
    ready: 'GET /ready';
    metrics: 'GET /metrics';
  };
}

export interface PrismEdgeGatewayReadiness {
  ok: boolean;
  ready: boolean;
  service: string;
  initialized: boolean;
  platform: EdgePlatform;
  modelId: string;
  checks: {
    initialized: {
      ok: boolean;
      message?: string;
    };
    modelDeployed: {
      ok: boolean;
      message?: string;
    };
    capacity: {
      ok: boolean;
      message?: string;
    };
  };
  stats: ReturnType<PrismCRDT['getStats']>;
}

export interface PrismEdgeGatewayRoutes {
  health?: string;
  ready?: string;
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

export type PrismEdgeGatewayRouteName = 'health' | 'ready' | 'infer' | 'openapi' | 'metrics';
export type PrismEdgeGatewayObservedRouteName = PrismEdgeGatewayRouteName | 'preflight' | 'notFound';

export interface PrismEdgeGatewayRouteMetrics {
  requests: number;
  latencyMs: number;
  averageLatencyMs: number;
  latencyBucketsMs: Record<string, number>;
  status: Record<string, number>;
}

export interface PrismEdgeGatewayMetricsSnapshot {
  generatedAt: number;
  service: string;
  totals: {
    requests: number;
    unauthorized: number;
    rateLimited: number;
    overloaded: number;
    errors: number;
    latencyMs: number;
    averageLatencyMs: number;
  };
  concurrency: {
    activeInference: number;
    maxConcurrentInference?: number;
  };
  routes: Record<PrismEdgeGatewayObservedRouteName, PrismEdgeGatewayRouteMetrics>;
}

export interface PrismEdgeGatewayMetricsConfig {
  prometheus?: boolean;
  latencyBucketsMs?: number[];
}

export type PrismEdgeGatewayOperationalStatus = 'healthy' | 'degraded' | 'unavailable';

export interface PrismEdgeGatewayOperationalThresholds {
  errorRate?: number;
  rateLimitedRate?: number;
  overloadedRate?: number;
  inferP95LatencyMs?: number;
}

export interface PrismEdgeGatewayOperationalCheck {
  ok: boolean;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface PrismEdgeGatewayOperationalReport {
  generatedAt: number;
  service: string;
  status: PrismEdgeGatewayOperationalStatus;
  summary: string;
  readiness: PrismEdgeGatewayReadiness;
  thresholds: Required<PrismEdgeGatewayOperationalThresholds>;
  traffic: {
    requests: number;
    errorRate: number;
    rateLimitedRate: number;
    overloadedRate: number;
    averageLatencyMs: number;
    inferRequests: number;
    inferAverageLatencyMs: number;
    inferP95LatencyMs?: number;
  };
  checks: {
    readiness: PrismEdgeGatewayOperationalCheck;
    errors: PrismEdgeGatewayOperationalCheck;
    rateLimit: PrismEdgeGatewayOperationalCheck;
    overload: PrismEdgeGatewayOperationalCheck;
    latency: PrismEdgeGatewayOperationalCheck;
  };
}

export interface PrismEdgeGatewayTraceConfig {
  header?: string;
  generateId?: (request: Request) => string;
}

export interface PrismEdgeGatewayRequestEvent {
  type: 'request';
  service: string;
  route: PrismEdgeGatewayObservedRouteName;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  requestId?: string;
  unauthorized: boolean;
  rateLimited: boolean;
  overloaded: boolean;
  timestamp: number;
}

export type PrismEdgeGatewayEvent = PrismEdgeGatewayRequestEvent;

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

export interface PrismEdgeGatewayOverloadConfig {
  maxConcurrentInference: number;
  retryAfterMs?: number;
}

export interface PrismEdgeGatewayIdempotencyConfig {
  header?: string;
  ttlMs?: number;
  key?: (request: Request) => string | undefined;
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
  overload?: PrismEdgeGatewayOverloadConfig | false;
  idempotency?: PrismEdgeGatewayIdempotencyConfig | false;
  metrics?: PrismEdgeGatewayMetricsConfig | false;
  operational?: PrismEdgeGatewayOperationalThresholds;
  trace?: PrismEdgeGatewayTraceConfig | false;
  onEvent?: (event: PrismEdgeGatewayEvent) => void | Promise<void>;
  infer?: EdgeInferenceHandler;
  enrichOutput?: (
    result: InferenceResult,
    request: InferenceRequest,
    context: EdgeRequestContext
  ) => InferenceResult | Promise<InferenceResult>;
}

interface PrismEdgeGatewayStoredResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  expiresAt: number;
}

interface PrismEdgeGatewayIdempotencyEntry {
  expiresAt: number;
  pending?: Promise<PrismEdgeGatewayStoredResponse>;
  response?: PrismEdgeGatewayStoredResponse;
}

export class PrismEdgeGateway {
  private readonly prism: PrismCRDT;
  private readonly capabilities: EdgeNode['capabilities'];
  private readonly cache: EdgeCache;
  private readonly rateLimitEntries = new Map<string, { count: number; resetAt: number }>();
  private readonly idempotencyEntries = new Map<string, PrismEdgeGatewayIdempotencyEntry>();
  private readonly metrics: PrismEdgeGatewayMetricsSnapshot;
  private activeInference = 0;
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
    const requestId = this.resolveRequestId(request);
    const url = new URL(request.url);
    const routes = this.resolveRoutes();

    if (request.method === 'OPTIONS') {
      return this.recordResponse(request, 'preflight', startedAt, this.jsonResponse({ ok: true }), requestId);
    }

    if (
      request.method === 'GET'
      && (url.pathname === routes.health || (routes.rootHealth && url.pathname === '/'))
    ) {
      const unauthorized = await this.unauthorizedResponse(request, 'health');
      if (unauthorized) {
        return this.recordResponse(request, 'health', startedAt, unauthorized, requestId);
      }

      const limited = this.rateLimitResponse(request, 'health');
      if (limited) {
        return this.recordResponse(request, 'health', startedAt, limited, requestId);
      }

      return this.recordResponse(request, 'health', startedAt, this.jsonResponse(await this.health()), requestId);
    }

    if (request.method === 'GET' && url.pathname === routes.ready) {
      const unauthorized = await this.unauthorizedResponse(request, 'ready');
      if (unauthorized) {
        return this.recordResponse(request, 'ready', startedAt, unauthorized, requestId);
      }

      const limited = this.rateLimitResponse(request, 'ready');
      if (limited) {
        return this.recordResponse(request, 'ready', startedAt, limited, requestId);
      }

      const readiness = await this.readiness();
      return this.recordResponse(
        request,
        'ready',
        startedAt,
        this.jsonResponse(readiness, readiness.ready ? 200 : 503),
        requestId
      );
    }

    if (this.config.openapi !== false && request.method === 'GET' && url.pathname === routes.openapi) {
      const unauthorized = await this.unauthorizedResponse(request, 'openapi');
      if (unauthorized) {
        return this.recordResponse(request, 'openapi', startedAt, unauthorized, requestId);
      }

      const limited = this.rateLimitResponse(request, 'openapi');
      if (limited) {
        return this.recordResponse(request, 'openapi', startedAt, limited, requestId);
      }

      return this.recordResponse(request, 'openapi', startedAt, this.jsonResponse(this.getOpenAPISpec()), requestId);
    }

    if (this.metricsEnabled() && request.method === 'GET' && url.pathname === routes.metrics) {
      const unauthorized = await this.unauthorizedResponse(request, 'metrics');
      if (unauthorized) {
        return this.recordResponse(request, 'metrics', startedAt, unauthorized, requestId);
      }

      const limited = this.rateLimitResponse(request, 'metrics');
      if (limited) {
        return this.recordResponse(request, 'metrics', startedAt, limited, requestId);
      }

      return this.recordResponse(request, 'metrics', startedAt, this.metricsResponse(), requestId);
    }

    if (request.method === 'POST' && url.pathname === routes.infer) {
      const unauthorized = await this.unauthorizedResponse(request, 'infer');
      if (unauthorized) {
        return this.recordResponse(request, 'infer', startedAt, unauthorized, requestId);
      }

      const limited = this.rateLimitResponse(request, 'infer');
      if (limited) {
        return this.recordResponse(request, 'infer', startedAt, limited, requestId);
      }

      return this.recordResponse(request, 'infer', startedAt, await this.handleIdempotentInference(request), requestId);
    }

    return this.recordResponse(request, 'notFound', startedAt, this.jsonResponse({
      error: 'Not found',
      endpoints: this.routeList(routes),
    }, 404), requestId);
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
        ready: 'GET /ready',
        metrics: 'GET /metrics',
      },
    };
  }

  async readiness(): Promise<PrismEdgeGatewayReadiness> {
    try {
      await this.initialize();
    } catch (error) {
      return this.readinessPayload(false, {
        initialized: {
          ok: false,
          message: error instanceof Error ? error.message : 'Gateway initialization failed',
        },
        modelDeployed: {
          ok: false,
          message: 'Model deployment could not be verified',
        },
        capacity: this.capacityCheck(),
      });
    }

    const modelDeployed = await this.prism.isModelDeployed(this.config.model.id);
    const capacity = this.capacityCheck();
    const ready = this.initialized && modelDeployed && capacity.ok;

    return this.readinessPayload(ready, {
      initialized: {
        ok: this.initialized,
        ...(this.initialized ? {} : { message: 'Gateway has not completed initialization' }),
      },
      modelDeployed: {
        ok: modelDeployed,
        ...(modelDeployed ? {} : { message: `Model ${this.config.model.id} is not deployed on this CRDT node` }),
      },
      capacity,
    });
  }

  getPrism(): PrismCRDT {
    return this.prism;
  }

  getMetricsSnapshot(): PrismEdgeGatewayMetricsSnapshot {
    this.refreshConcurrencyMetrics();
    return this.cloneMetricsSnapshot();
  }

  async getOperationalReport(): Promise<PrismEdgeGatewayOperationalReport> {
    const readiness = await this.readiness();
    const snapshot = this.getMetricsSnapshot();
    const thresholds = this.operationalThresholds();
    const totalRequests = snapshot.totals.requests;
    const infer = snapshot.routes.infer;
    const traffic = {
      requests: totalRequests,
      errorRate: this.rate(snapshot.totals.errors, totalRequests),
      rateLimitedRate: this.rate(snapshot.totals.rateLimited, totalRequests),
      overloadedRate: this.rate(snapshot.totals.overloaded, totalRequests),
      averageLatencyMs: snapshot.totals.averageLatencyMs,
      inferRequests: infer.requests,
      inferAverageLatencyMs: infer.averageLatencyMs,
      ...(infer.requests > 0 ? { inferP95LatencyMs: this.percentileFromBuckets(infer, 0.95) } : {}),
    };
    const checks = {
      readiness: this.operationalCheck(
        readiness.ready,
        readiness.ready ? 'Gateway is ready for inference traffic' : 'Gateway readiness checks are failing',
        'fail'
      ),
      errors: this.operationalCheck(
        traffic.errorRate <= thresholds.errorRate,
        `Gateway error rate is ${(traffic.errorRate * 100).toFixed(2)}%`,
        'fail'
      ),
      rateLimit: this.operationalCheck(
        traffic.rateLimitedRate <= thresholds.rateLimitedRate,
        `Gateway rate-limited rate is ${(traffic.rateLimitedRate * 100).toFixed(2)}%`,
        'warn'
      ),
      overload: this.operationalCheck(
        traffic.overloadedRate <= thresholds.overloadedRate,
        `Gateway overload rejection rate is ${(traffic.overloadedRate * 100).toFixed(2)}%`,
        'warn'
      ),
      latency: this.operationalCheck(
        traffic.inferP95LatencyMs === undefined || traffic.inferP95LatencyMs <= thresholds.inferP95LatencyMs,
        traffic.inferP95LatencyMs === undefined
          ? 'Gateway has no inference latency samples yet'
          : `Gateway infer p95 latency is ${traffic.inferP95LatencyMs}ms`,
        'warn'
      ),
    };
    const status = this.operationalStatus(checks);

    return {
      generatedAt: Date.now(),
      service: snapshot.service,
      status,
      summary: this.operationalSummary(status),
      readiness,
      thresholds,
      traffic,
      checks,
    };
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
      '# HELP prism_edge_gateway_overloaded_total Total PRISM edge gateway requests rejected by concurrency overload protection.',
      '# TYPE prism_edge_gateway_overloaded_total counter',
      `prism_edge_gateway_overloaded_total ${snapshot.totals.overloaded}`,
      '# HELP prism_edge_gateway_active_inference Current active PRISM edge inference requests.',
      '# TYPE prism_edge_gateway_active_inference gauge',
      `prism_edge_gateway_active_inference ${snapshot.concurrency.activeInference}`,
      '# HELP prism_edge_gateway_max_concurrent_inference Configured PRISM edge inference concurrency limit, or 0 when disabled.',
      '# TYPE prism_edge_gateway_max_concurrent_inference gauge',
      `prism_edge_gateway_max_concurrent_inference ${snapshot.concurrency.maxConcurrentInference ?? 0}`,
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

    lines.push(
      '# HELP prism_edge_gateway_request_duration_ms PRISM edge gateway request duration histogram in milliseconds by route.',
      '# TYPE prism_edge_gateway_request_duration_ms histogram',
    );

    for (const [route, metrics] of Object.entries(snapshot.routes)) {
      for (const [bucket, count] of Object.entries(metrics.latencyBucketsMs)) {
        lines.push(`prism_edge_gateway_request_duration_ms_bucket{route="${this.metricLabel(route)}",le="${this.metricLabel(bucket)}"} ${count}`);
      }

      lines.push(
        `prism_edge_gateway_request_duration_ms_bucket{route="${this.metricLabel(route)}",le="+Inf"} ${metrics.requests}`,
        `prism_edge_gateway_request_duration_ms_sum{route="${this.metricLabel(route)}"} ${metrics.latencyMs}`,
        `prism_edge_gateway_request_duration_ms_count{route="${this.metricLabel(route)}"} ${metrics.requests}`
      );
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
        [routes.ready]: {
          get: {
            summary: 'Read PRISM edge gateway readiness',
            operationId: 'getPrismEdgeReadiness',
            ...(this.openapiSecurity('ready')),
            responses: {
              '200': {
                description: 'Gateway is initialized and ready to receive inference traffic',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/PrismEdgeGatewayReadiness' },
                  },
                },
              },
              '503': {
                description: 'Gateway is alive but not ready for inference traffic',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/PrismEdgeGatewayReadiness' },
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
              '503': {
                description: 'Gateway is overloaded or temporarily unavailable',
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
          PrismEdgeGatewayReadiness: {
            type: 'object',
            required: ['ok', 'ready', 'service', 'initialized', 'platform', 'modelId', 'checks', 'stats'],
            properties: {
              ok: { type: 'boolean' },
              ready: { type: 'boolean' },
              service: { type: 'string' },
              initialized: { type: 'boolean' },
              platform: { type: 'string' },
              modelId: { type: 'string' },
              checks: {
                type: 'object',
                required: ['initialized', 'modelDeployed', 'capacity'],
                properties: {
                  initialized: { $ref: '#/components/schemas/ReadinessCheck' },
                  modelDeployed: { $ref: '#/components/schemas/ReadinessCheck' },
                  capacity: { $ref: '#/components/schemas/ReadinessCheck' },
                },
              },
              stats: { type: 'object', additionalProperties: true },
            },
          },
          ReadinessCheck: {
            type: 'object',
            required: ['ok'],
            properties: {
              ok: { type: 'boolean' },
              message: { type: 'string' },
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
      ready: this.config.routes?.ready ?? '/ready',
      infer: this.config.routes?.infer ?? '/infer',
      openapi: this.config.routes?.openapi ?? '/openapi.json',
      metrics: this.config.routes?.metrics ?? '/metrics',
      rootHealth: this.config.routes?.rootHealth ?? true,
    };
  }

  private routeList(routes: Required<PrismEdgeGatewayRoutes>): string[] {
    const endpoints = [`GET ${routes.health}`, `GET ${routes.ready}`, `POST ${routes.infer}`];

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

  private readinessPayload(
    ready: boolean,
    checks: PrismEdgeGatewayReadiness['checks']
  ): PrismEdgeGatewayReadiness {
    return {
      ok: ready,
      ready,
      service: this.config.serviceName ?? 'prism-edge-gateway',
      initialized: this.initialized,
      platform: this.config.platform,
      modelId: this.config.model.id,
      checks,
      stats: this.prism.getStats(),
    };
  }

  private overloadedResponse(): Response | undefined {
    const overload = this.resolveOverloadConfig();

    if (!overload || this.activeInference < overload.maxConcurrentInference) {
      return undefined;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((overload.retryAfterMs ?? 1_000) / 1000));

    return this.jsonResponse({
      success: false,
      error: {
        code: 'OVERLOADED',
        message: 'PRISM edge gateway is at inference concurrency capacity',
      },
      latency: 0,
      cached: false,
    }, 503, {
      'retry-after': String(retryAfterSeconds),
      'x-prism-overloaded': '1',
      'x-prism-active-inference': String(this.activeInference),
      'x-prism-max-concurrent-inference': String(overload.maxConcurrentInference),
    });
  }

  private async handleIdempotentInference(request: Request): Promise<Response> {
    const key = this.resolveIdempotencyKey(request);

    if (!key) {
      const overloaded = this.overloadedResponse();
      if (overloaded) {
        return overloaded;
      }

      this.activeInference += 1;
      try {
        return this.withCors(await this.handleInferenceRequest(request));
      } finally {
        this.activeInference = Math.max(0, this.activeInference - 1);
      }
    }

    this.pruneIdempotencyEntries();

    const existing = this.idempotencyEntries.get(key);

    if (existing?.response && existing.response.expiresAt > Date.now()) {
      return this.restoreIdempotencyResponse(existing.response, 'hit');
    }

    if (existing?.pending && existing.expiresAt > Date.now()) {
      const stored = await existing.pending;
      return this.restoreIdempotencyResponse(stored, 'replayed');
    }

    const overloaded = this.overloadedResponse();
    if (overloaded) {
      return overloaded;
    }

    const ttlMs = this.resolveIdempotencyTtlMs();
    const expiresAt = Date.now() + ttlMs;
    const pending = this.executeAndStoreIdempotencyResponse(request, expiresAt);
    this.idempotencyEntries.set(key, {
      expiresAt,
      pending,
    });

    try {
      const stored = await pending;
      this.idempotencyEntries.set(key, {
        expiresAt: stored.expiresAt,
        response: stored,
      });
      return this.restoreIdempotencyResponse(stored, 'created');
    } catch (error) {
      this.idempotencyEntries.delete(key);
      throw error;
    }
  }

  private async executeAndStoreIdempotencyResponse(
    request: Request,
    expiresAt: number
  ): Promise<PrismEdgeGatewayStoredResponse> {
    this.activeInference += 1;

    try {
      return await this.captureIdempotencyResponse(
        this.withCors(await this.handleInferenceRequest(request)),
        expiresAt
      );
    } finally {
      this.activeInference = Math.max(0, this.activeInference - 1);
    }
  }

  private async captureIdempotencyResponse(
    response: Response,
    expiresAt: number
  ): Promise<PrismEdgeGatewayStoredResponse> {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
      body: await response.text(),
      expiresAt,
    };
  }

  private restoreIdempotencyResponse(
    stored: PrismEdgeGatewayStoredResponse,
    status: 'created' | 'hit' | 'replayed'
  ): Response {
    const headers = new Headers(stored.headers);
    headers.set('x-prism-idempotency', status);

    return new Response(stored.body, {
      status: stored.status,
      statusText: stored.statusText,
      headers,
    });
  }

  private resolveIdempotencyKey(request: Request): string | undefined {
    const idempotency = this.config.idempotency;

    if (!idempotency) {
      return undefined;
    }

    const key = idempotency.key?.(request)
      ?? request.headers.get(this.idempotencyHeaderName())
      ?? undefined;

    return key?.trim() || undefined;
  }

  private idempotencyHeaderName(): string {
    return this.config.idempotency && this.config.idempotency.header
      ? this.config.idempotency.header.toLowerCase()
      : 'idempotency-key';
  }

  private resolveIdempotencyTtlMs(): number {
    const ttlMs = this.config.idempotency && this.config.idempotency.ttlMs !== undefined
      ? this.config.idempotency.ttlMs
      : 60_000;

    return Math.max(1, ttlMs);
  }

  private pruneIdempotencyEntries(): void {
    const now = Date.now();

    for (const [key, entry] of this.idempotencyEntries.entries()) {
      if (entry.expiresAt <= now) {
        this.idempotencyEntries.delete(key);
      }
    }
  }

  private capacityCheck(): PrismEdgeGatewayReadiness['checks']['capacity'] {
    const overload = this.resolveOverloadConfig();

    if (!overload) {
      return { ok: true };
    }

    const ok = this.activeInference < overload.maxConcurrentInference;
    return {
      ok,
      ...(ok ? {} : {
        message: `Inference concurrency is saturated at ${this.activeInference}/${overload.maxConcurrentInference}`,
      }),
    };
  }

  private resolveOverloadConfig(): PrismEdgeGatewayOverloadConfig | undefined {
    if (!this.config.overload) {
      return undefined;
    }

    const maxConcurrentInference = Math.floor(this.config.overload.maxConcurrentInference);

    if (!Number.isFinite(maxConcurrentInference) || maxConcurrentInference <= 0) {
      return undefined;
    }

    return {
      maxConcurrentInference,
      retryAfterMs: this.config.overload.retryAfterMs,
    };
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
        overloaded: 0,
        errors: 0,
        latencyMs: 0,
        averageLatencyMs: 0,
      },
      concurrency: {
        activeInference: 0,
        ...(this.resolveOverloadConfig()?.maxConcurrentInference
          ? { maxConcurrentInference: this.resolveOverloadConfig()?.maxConcurrentInference }
          : {}),
      },
      routes: {
        health: this.emptyRouteMetrics(),
        ready: this.emptyRouteMetrics(),
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
      latencyBucketsMs: Object.fromEntries(
        this.latencyBucketsMs().map(bucket => [String(bucket), 0])
      ),
      status: {},
    };
  }

  private recordResponse(
    request: Request,
    route: PrismEdgeGatewayObservedRouteName,
    startedAt: number,
    response: Response,
    requestId?: string
  ): Response {
    const elapsed = Math.max(0, this.now() - startedAt);
    const tracedResponse = this.withTrace(response, requestId);
    const status = String(tracedResponse.status);
    const routeMetrics = this.metrics.routes[route];

    this.metrics.generatedAt = Date.now();
    this.metrics.totals.requests += 1;
    this.metrics.totals.latencyMs += elapsed;
    this.metrics.totals.averageLatencyMs = this.average(
      this.metrics.totals.latencyMs,
      this.metrics.totals.requests
    );

    if (tracedResponse.status === 401) {
      this.metrics.totals.unauthorized += 1;
    }

    if (tracedResponse.status === 429) {
      this.metrics.totals.rateLimited += 1;
    }

    if (tracedResponse.headers.get('x-prism-overloaded') === '1') {
      this.metrics.totals.overloaded += 1;
    }

    if (tracedResponse.status >= 500) {
      this.metrics.totals.errors += 1;
    }

    this.refreshConcurrencyMetrics();

    routeMetrics.requests += 1;
    routeMetrics.latencyMs += elapsed;
    routeMetrics.averageLatencyMs = this.average(routeMetrics.latencyMs, routeMetrics.requests);
    this.recordLatencyBucket(routeMetrics, elapsed);
    routeMetrics.status[status] = (routeMetrics.status[status] ?? 0) + 1;

    this.emitEvent({
      type: 'request',
      service: this.config.serviceName ?? 'prism-edge-gateway',
      route,
      method: request.method,
      path: new URL(request.url).pathname,
      status: tracedResponse.status,
      latencyMs: elapsed,
      requestId,
      unauthorized: tracedResponse.status === 401,
      rateLimited: tracedResponse.status === 429,
      overloaded: tracedResponse.headers.get('x-prism-overloaded') === '1',
      timestamp: Date.now(),
    });

    return tracedResponse;
  }

  private emitEvent(event: PrismEdgeGatewayEvent): void {
    if (!this.config.onEvent) {
      return;
    }

    try {
      void Promise.resolve(this.config.onEvent(event)).catch(() => undefined);
    } catch (_error) {
      // Observability hooks must not break edge traffic.
    }
  }

  private cloneMetricsSnapshot(): PrismEdgeGatewayMetricsSnapshot {
    return {
      generatedAt: this.metrics.generatedAt,
      service: this.metrics.service,
      totals: { ...this.metrics.totals },
      concurrency: { ...this.metrics.concurrency },
      routes: Object.fromEntries(
        Object.entries(this.metrics.routes).map(([route, metrics]) => [
          route,
          {
            requests: metrics.requests,
            latencyMs: metrics.latencyMs,
            averageLatencyMs: metrics.averageLatencyMs,
            latencyBucketsMs: { ...metrics.latencyBucketsMs },
            status: { ...metrics.status },
          },
        ])
      ) as Record<PrismEdgeGatewayObservedRouteName, PrismEdgeGatewayRouteMetrics>,
    };
  }

  private refreshConcurrencyMetrics(): void {
    const maxConcurrentInference = this.resolveOverloadConfig()?.maxConcurrentInference;

    this.metrics.concurrency = {
      activeInference: this.activeInference,
      ...(maxConcurrentInference ? { maxConcurrentInference } : {}),
    };
  }

  private average(total: number, samples: number): number {
    return samples === 0 ? 0 : total / samples;
  }

  private latencyBucketsMs(): number[] {
    const configured = this.config.metrics === false
      ? undefined
      : this.config.metrics?.latencyBucketsMs;
    const buckets = configured && configured.length > 0
      ? configured
      : [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

    return Array.from(new Set(
      buckets
        .filter(bucket => Number.isFinite(bucket) && bucket > 0)
        .map(bucket => Number(bucket))
        .sort((first, second) => first - second)
    ));
  }

  private recordLatencyBucket(metrics: PrismEdgeGatewayRouteMetrics, latencyMs: number): void {
    for (const bucket of this.latencyBucketsMs()) {
      if (latencyMs <= bucket) {
        const key = String(bucket);
        metrics.latencyBucketsMs[key] = (metrics.latencyBucketsMs[key] ?? 0) + 1;
      }
    }
  }

  private operationalThresholds(): Required<PrismEdgeGatewayOperationalThresholds> {
    const thresholds = this.config.operational ?? {};

    return {
      errorRate: thresholds.errorRate ?? 0.05,
      rateLimitedRate: thresholds.rateLimitedRate ?? 0.1,
      overloadedRate: thresholds.overloadedRate ?? 0.05,
      inferP95LatencyMs: thresholds.inferP95LatencyMs ?? 1_000,
    };
  }

  private operationalCheck(
    ok: boolean,
    message: string,
    failureStatus: 'warn' | 'fail'
  ): PrismEdgeGatewayOperationalCheck {
    return {
      ok,
      status: ok ? 'pass' : failureStatus,
      message,
    };
  }

  private operationalStatus(
    checks: PrismEdgeGatewayOperationalReport['checks']
  ): PrismEdgeGatewayOperationalStatus {
    const values = Object.values(checks);

    if (values.some(check => check.status === 'fail')) {
      return 'unavailable';
    }

    if (values.some(check => check.status === 'warn')) {
      return 'degraded';
    }

    return 'healthy';
  }

  private operationalSummary(status: PrismEdgeGatewayOperationalStatus): string {
    if (status === 'healthy') {
      return 'PRISM edge gateway is healthy';
    }

    if (status === 'degraded') {
      return 'PRISM edge gateway is serving traffic with warning conditions';
    }

    return 'PRISM edge gateway is not ready to serve inference traffic';
  }

  private rate(count: number, total: number): number {
    return total === 0 ? 0 : count / total;
  }

  private percentileFromBuckets(
    metrics: PrismEdgeGatewayRouteMetrics,
    percentile: number
  ): number | undefined {
    if (metrics.requests <= 0) {
      return undefined;
    }

    const target = Math.max(1, Math.ceil(metrics.requests * percentile));

    for (const bucket of this.latencyBucketsMs()) {
      const count = metrics.latencyBucketsMs[String(bucket)] ?? 0;

      if (count >= target) {
        return bucket;
      }
    }

    return undefined;
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private metricLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }

  private resolveRequestId(request: Request): string | undefined {
    if (this.config.trace === false) {
      return undefined;
    }

    const header = this.traceHeaderName();
    const provided = request.headers.get(header);

    if (provided && provided.trim().length > 0) {
      return provided.trim();
    }

    return this.config.trace?.generateId?.(request) ?? this.generateRequestId();
  }

  private generateRequestId(): string {
    const cryptoApi = globalThis.crypto;

    if (cryptoApi?.randomUUID) {
      return cryptoApi.randomUUID();
    }

    return `prism-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private traceHeaderName(): string {
    return this.config.trace && this.config.trace.header
      ? this.config.trace.header.toLowerCase()
      : 'x-prism-request-id';
  }

  private withTrace(response: Response, requestId?: string): Response {
    if (!requestId) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set(this.traceHeaderName(), requestId);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
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
    const defaultHeaders = [
      'content-type',
      'authorization',
      ...(this.config.trace === false ? [] : [this.traceHeaderName()]),
    ];

    return {
      'access-control-allow-origin': cors.origin ?? '*',
      'access-control-allow-methods': (cors.methods ?? ['GET', 'POST', 'OPTIONS']).join(','),
      'access-control-allow-headers': (cors.headers ?? defaultHeaders).join(','),
    };
  }
}
