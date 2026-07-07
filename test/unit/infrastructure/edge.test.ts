import { describe, it, expect, vi } from 'vitest';
import {
  VercelEdgeAdapter,
  CloudflareEdgeAdapter,
  NetlifyEdgeAdapter,
  DenoDeployAdapter,
  CloudflareKVEdgeCache,
  DenoKVEdgeCache,
  MemoryEdgeCache,
  NetlifyBlobsEdgeCache,
  RedisEdgeCache,
  createEdgeAdapter,
  EdgeConfig,
  EdgeInferenceHandler,
} from '../../../src/infrastructure/edge/edge';
import { PrismEdgeClient, PrismEdgeClientError } from '../../../src/infrastructure/edge/client';
import { PrismEdgeGateway } from '../../../src/infrastructure/edge/gateway';

describe('Edge Adapters', () => {
  const mockRequest = {
    json: vi.fn().mockResolvedValue({
      id: 'test-req',
      modelId: 'test-model',
      input: 'Test input',
    }),
  } as unknown as Request;

  describe('VercelEdgeAdapter', () => {
    const config: EdgeConfig = {
      platform: 'vercel',
      region: 'us-east-1',
      cacheTtl: 3600,
    };

    it('should handle requests successfully', async () => {
      const adapter = new VercelEdgeAdapter(config);

      const response = await adapter.handleRequest(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'test-req',
        modelId: 'test-model',
        output: expect.stringContaining('vercel inference at us-east-1'),
        latency: expect.any(Number),
        edgeId: 'vercel-edge',
        timestamp: expect.any(Number),
        cached: false,
      });
      expect(result.cached).toBe(false);
      expect(result.latency).toBeGreaterThan(0);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('should handle invalid requests', async () => {
      const invalidRequest = {
        json: vi.fn().mockResolvedValue({
          // Missing required fields
        }),
      } as unknown as Request;

      const adapter = new VercelEdgeAdapter(config);
      const response = await adapter.handleRequest(invalidRequest);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('INVALID_REQUEST');
    });

    it('should use an injected inference handler', async () => {
      const infer = vi.fn<EdgeInferenceHandler>().mockResolvedValue({
        id: 'test-req',
        modelId: 'test-model',
        output: { label: 'real-runtime' },
        latency: 7,
        edgeId: 'custom-edge',
        timestamp: 123,
      });
      const adapter = new VercelEdgeAdapter(config, { infer });

      const response = await adapter.handleRequest(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.data.output).toEqual({ label: 'real-runtime' });
      expect(result.data.edgeId).toBe('custom-edge');
      expect(infer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'test-req', modelId: 'test-model' }),
        expect.objectContaining({
          platform: 'vercel',
          edgeId: 'vercel-edge',
          region: 'us-east-1',
          cacheKey: expect.stringMatching(/^prism:test-model:/),
        })
      );
    });

    it('should serve repeated requests from edge cache', async () => {
      const infer = vi.fn<EdgeInferenceHandler>().mockResolvedValue({
        id: 'test-req',
        modelId: 'test-model',
        output: 'cached output',
        latency: 5,
        edgeId: 'vercel-edge',
        timestamp: 123,
      });
      const adapter = new VercelEdgeAdapter(config, { infer });

      const first = await adapter.handleRequest(mockRequest);
      const second = await adapter.handleRequest(mockRequest);
      const firstJson = await first.json();
      const secondJson = await second.json();

      expect(firstJson.cached).toBe(false);
      expect(secondJson.cached).toBe(true);
      expect(secondJson.data.cached).toBe(true);
      expect(secondJson.data.output).toBe('cached output');
      expect(infer).toHaveBeenCalledTimes(1);
    });
  });

  describe('CloudflareEdgeAdapter', () => {
    const config: EdgeConfig = {
      platform: 'cloudflare',
      cacheTtl: 3600,
    };

    it('should handle requests successfully', async () => {
      const adapter = new CloudflareEdgeAdapter(config);

      const response = await adapter.handleRequest(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.data.output).toBe('cloudflare inference');
      expect(result.data.edgeId).toBe('cloudflare-worker');
    });
  });

  describe('NetlifyEdgeAdapter', () => {
    it('should handle requests successfully', async () => {
      const adapter = new NetlifyEdgeAdapter();

      const response = await adapter.handleRequest(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.data.output).toBe('netlify inference');
      expect(result.data.edgeId).toBe('netlify-edge');
    });
  });

  describe('DenoDeployAdapter', () => {
    it('should handle requests successfully', async () => {
      const adapter = new DenoDeployAdapter();

      const response = await adapter.handleRequest(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.data.output).toBe('deno-deploy inference');
      expect(result.data.edgeId).toBe('deno-deploy');
    });
  });

  describe('createEdgeAdapter', () => {
    it('should create Vercel adapter', () => {
      const config: EdgeConfig = { platform: 'vercel' };
      const adapter = createEdgeAdapter(config);
      expect(adapter).toBeInstanceOf(VercelEdgeAdapter);
    });

    it('should create Cloudflare adapter', () => {
      const config: EdgeConfig = { platform: 'cloudflare' };
      const adapter = createEdgeAdapter(config);
      expect(adapter).toBeInstanceOf(CloudflareEdgeAdapter);
    });

    it('should create Netlify adapter', () => {
      const config: EdgeConfig = { platform: 'netlify' };
      const adapter = createEdgeAdapter(config);
      expect(adapter).toBeInstanceOf(NetlifyEdgeAdapter);
    });

    it('should create Deno Deploy adapter', () => {
      const config: EdgeConfig = { platform: 'deno-deploy' };
      const adapter = createEdgeAdapter(config);
      expect(adapter).toBeInstanceOf(DenoDeployAdapter);
    });

    it('should throw error for unknown platform', () => {
      const config = { platform: 'unknown' } as any;
      expect(() => createEdgeAdapter(config)).toThrow('Unknown edge platform: unknown');
    });
  });

  describe('Edge cache adapters', () => {
    it('should cache values in memory with TTL', async () => {
      const cache = new MemoryEdgeCache();

      await cache.set('key', { value: 42 }, 60);

      await expect(cache.get('key')).resolves.toEqual({ value: 42 });
    });

    it('should map Cloudflare KV to JSON get and expirationTtl', async () => {
      const namespace = {
        get: vi.fn().mockResolvedValue({ value: 'cached' }),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const cache = new CloudflareKVEdgeCache(namespace);

      await expect(cache.get('cf-key')).resolves.toEqual({ value: 'cached' });
      await cache.set('cf-key', { value: 'fresh' }, 120);

      expect(namespace.get).toHaveBeenCalledWith('cf-key', { type: 'json' });
      expect(namespace.put).toHaveBeenCalledWith(
        'cf-key',
        JSON.stringify({ value: 'fresh' }),
        { expirationTtl: 120 }
      );
    });

    it('should map Redis-compatible stores to ex TTL', async () => {
      const store = {
        get: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
        set: vi.fn().mockResolvedValue('OK'),
      };
      const cache = new RedisEdgeCache(store);

      await expect(cache.get('redis-key')).resolves.toEqual({ ok: true });
      await cache.set('redis-key', { ok: true }, 45);

      expect(store.set).toHaveBeenCalledWith('redis-key', { ok: true }, { ex: 45 });
    });

    it('should map Deno KV stores to prefixed keys and expireIn milliseconds', async () => {
      const store = {
        get: vi.fn().mockResolvedValue({ value: { deno: true } }),
        set: vi.fn().mockResolvedValue({ ok: true }),
      };
      const cache = new DenoKVEdgeCache(store, ['custom', 'prefix']);

      await expect(cache.get('deno-key')).resolves.toEqual({ deno: true });
      await cache.set('deno-key', { deno: true }, 7);

      expect(store.get).toHaveBeenCalledWith(['custom', 'prefix', 'deno-key']);
      expect(store.set).toHaveBeenCalledWith(
        ['custom', 'prefix', 'deno-key'],
        { deno: true },
        { expireIn: 7000 }
      );
    });

    it('should map Netlify Blobs to an expiring JSON envelope', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const store = {
        get: vi.fn().mockResolvedValue({ value: { blob: true }, expiresAt: now + 1000 }),
        setJSON: vi.fn().mockResolvedValue(undefined),
      };
      const cache = new NetlifyBlobsEdgeCache(store);

      await expect(cache.get('blob-key')).resolves.toEqual({ blob: true });
      await cache.set('blob-key', { blob: true }, 5);

      expect(store.get).toHaveBeenCalledWith('blob-key', { type: 'json' });
      expect(store.setJSON).toHaveBeenCalledWith('blob-key', {
        value: { blob: true },
        expiresAt: now + 5000,
      });
      vi.restoreAllMocks();
    });
  });

  describe('PrismEdgeGateway', () => {
    const model = {
      id: 'gateway-model',
      name: 'Gateway Model',
      version: '1.0.0',
      format: 'remote' as const,
      size: 1,
      capabilities: ['triage'],
    };

    function inferenceRequest(id: string, input: string) {
      return new Request('https://edge.test/infer', {
        method: 'POST',
        body: JSON.stringify({ id, modelId: model.id, input }),
      });
    }

    it('should initialize PRISM and expose a health contract', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'gateway-node',
        platform: 'cloudflare',
        region: 'iad',
        model,
      });

      const health = await gateway.health();

      expect(health.ok).toBe(true);
      expect(health.initialized).toBe(true);
      expect(health.platform).toBe('cloudflare');
      expect(health.model.id).toBe(model.id);
      expect(health.stats.models).toBe(1);
      expect(health.stats.nodes).toBe(1);
      expect(health.endpoints).toEqual({
        infer: 'POST /infer',
        health: 'GET /health',
        ready: 'GET /ready',
        status: 'GET /status',
        metrics: 'GET /metrics',
      });
    });

    it('should expose readiness for deployment traffic gates', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'ready-gateway-node',
        platform: 'cloudflare',
        region: 'iad',
        model,
      });

      const response = await gateway.handleRequest(new Request('https://edge.test/ready'));
      const body = await response.json();
      const snapshot = gateway.getMetricsSnapshot();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        ready: true,
        initialized: true,
        platform: 'cloudflare',
        modelId: model.id,
        checks: {
          initialized: { ok: true },
          modelDeployed: { ok: true },
        },
      });
      expect(body.stats.models).toBe(1);
      expect(snapshot.routes.ready.status['200']).toBe(1);
    });

    it('should route inference through PRISM and the selected edge adapter', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'gateway-node',
        platform: 'cloudflare',
        edgeId: 'cloudflare-iad',
        region: 'iad',
        cacheTtl: 60,
        model,
        enrichOutput: (result, _request, context) => ({
          ...result,
          output: {
            ...result.output,
            region: context.region,
            cacheKey: context.cacheKey,
          },
        }),
      });

      const first = await gateway.handleInferenceRequest(inferenceRequest('req-1', 'Classify shelf alert.'));
      const repeat = await gateway.handleInferenceRequest(inferenceRequest('req-2', 'Classify shelf alert.'));
      const firstJson = await first.json();
      const repeatJson = await repeat.json();

      expect(first.status).toBe(200);
      expect(firstJson.success).toBe(true);
      expect(firstJson.cached).toBe(false);
      expect(firstJson.data.edgeId).toBe('cloudflare-iad');
      expect(firstJson.data.output.region).toBe('iad');
      expect(firstJson.data.output.cacheKey).toMatch(/^prism:gateway-model:/);
      expect(repeatJson.cached).toBe(true);
      expect(repeatJson.data.cached).toBe(true);
    });

    it('should resolve dynamic edge config from each request', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'dynamic-gateway-node',
        platform: 'cloudflare',
        model,
        edgeConfig: request => {
          const region = request.headers.get('cf-colo') ?? 'unknown';

          return {
            platform: 'cloudflare',
            region,
            edgeId: `cloudflare-${region}`,
            cacheTtl: 60,
          };
        },
      });
      const response = await gateway.handleInferenceRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'cf-colo': 'dfw' },
        body: JSON.stringify({ id: 'dynamic-1', modelId: model.id, input: 'Route dynamically.' }),
      }));
      const body = await response.json();

      expect(body.data.edgeId).toBe('cloudflare-dfw');
    });

    it('should serve health, readiness, inference, OpenAPI, CORS preflight, and not-found through the HTTP router', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'router-gateway-node',
        platform: 'cloudflare',
        region: 'iad',
        model,
        cors: true,
        openapi: {
          title: 'Router Gateway API',
          version: '2026.7.6',
        },
      });

      const health = await gateway.handleRequest(new Request('https://edge.test/health'));
      const ready = await gateway.handleRequest(new Request('https://edge.test/ready'));
      const status = await gateway.handleRequest(new Request('https://edge.test/status'));
      const openapi = await gateway.handleRequest(new Request('https://edge.test/openapi.json'));
      const preflight = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'OPTIONS',
      }));
      const inference = await gateway.handleRequest(inferenceRequest('router-1', 'Route through router.'));
      const notFound = await gateway.handleRequest(new Request('https://edge.test/missing'));
      const healthBody = await health.json();
      const readyBody = await ready.json();
      const statusBody = await status.json();
      const openapiBody = await openapi.json();
      const preflightBody = await preflight.json();
      const inferenceBody = await inference.json();
      const notFoundBody = await notFound.json();

      expect(health.status).toBe(200);
      expect(healthBody.ok).toBe(true);
      expect(ready.status).toBe(200);
      expect(readyBody.ready).toBe(true);
      expect(status.status).toBe(200);
      expect(statusBody.status).toBe('healthy');
      expect(statusBody.checks.readiness.status).toBe('pass');
      expect(openapi.status).toBe(200);
      expect(openapiBody.openapi).toBe('3.1.0');
      expect(openapiBody.info.title).toBe('Router Gateway API');
      expect(openapiBody.paths['/health'].get.operationId).toBe('getPrismEdgeHealth');
      expect(openapiBody.paths['/ready'].get.operationId).toBe('getPrismEdgeReadiness');
      expect(openapiBody.paths['/status'].get.operationId).toBe('getPrismEdgeStatus');
      expect(openapiBody.paths['/infer'].post.operationId).toBe('runPrismEdgeInference');
      expect(openapiBody.components.schemas.PrismEdgeGatewayOperationalReport).toBeDefined();
      expect(openapiBody.components.schemas.InferenceRequest.properties.modelId.const).toBe(model.id);
      expect(preflight.status).toBe(200);
      expect(preflightBody.ok).toBe(true);
      expect(inference.status).toBe(200);
      expect(inferenceBody.success).toBe(true);
      expect(notFound.status).toBe(404);
      expect(notFoundBody.endpoints).toEqual(['GET /health', 'GET /ready', 'GET /status', 'POST /infer', 'GET /openapi.json', 'GET /metrics']);
      expect(inference.headers.get('access-control-allow-origin')).toBe('*');
      expect(health.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS');
      expect(health.headers.get('x-prism-request-id')).toBeTruthy();
      expect(preflight.headers.get('access-control-allow-headers')).toContain('x-prism-request-id');
    });

    it('should preserve or customize gateway request trace headers', async () => {
      const defaultGateway = new PrismEdgeGateway({
        nodeId: 'trace-gateway-node',
        platform: 'cloudflare',
        model,
      });
      const customGateway = new PrismEdgeGateway({
        nodeId: 'custom-trace-gateway-node',
        platform: 'cloudflare',
        model,
        trace: {
          header: 'x-correlation-id',
          generateId: () => 'generated-correlation-id',
        },
      });

      const preserved = await defaultGateway.handleRequest(new Request('https://edge.test/health', {
        headers: { 'x-prism-request-id': 'external-trace-1' },
      }));
      const generated = await customGateway.handleRequest(new Request('https://edge.test/health'));

      expect(preserved.headers.get('x-prism-request-id')).toBe('external-trace-1');
      expect(generated.headers.get('x-correlation-id')).toBe('generated-correlation-id');
    });

    it('should allow disabling gateway request trace headers', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'disabled-trace-gateway-node',
        platform: 'cloudflare',
        model,
        cors: true,
        trace: false,
      });

      const health = await gateway.handleRequest(new Request('https://edge.test/health'));
      const preflight = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'OPTIONS',
      }));

      expect(health.headers.has('x-prism-request-id')).toBe(false);
      expect(preflight.headers.get('access-control-allow-headers')).not.toContain('x-prism-request-id');
    });

    it('should emit typed gateway request events with trace and latency data', async () => {
      const events: unknown[] = [];
      const gateway = new PrismEdgeGateway({
        nodeId: 'event-gateway-node',
        serviceName: 'event-gateway',
        platform: 'cloudflare',
        model,
        onEvent: event => {
          events.push(event);
        },
      });

      const response = await gateway.handleRequest(new Request('https://edge.test/health', {
        headers: { 'x-prism-request-id': 'event-trace-id' },
      }));

      expect(response.status).toBe(200);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'request',
        service: 'event-gateway',
        route: 'health',
        method: 'GET',
        path: '/health',
        status: 200,
        requestId: 'event-trace-id',
        unauthorized: false,
        rateLimited: false,
      });
      expect((events[0] as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);
      expect((events[0] as { timestamp: number }).timestamp).toBeGreaterThan(0);
    });

    it('should emit unauthorized and rate-limited gateway request events', async () => {
      const events: Array<{ route?: string; status?: number; unauthorized?: boolean; rateLimited?: boolean }> = [];
      const gateway = new PrismEdgeGateway({
        nodeId: 'event-security-gateway-node',
        platform: 'cloudflare',
        model,
        auth: {
          bearerToken: 'event-token',
        },
        rateLimit: {
          limit: 1,
          windowMs: 60_000,
        },
        onEvent: event => {
          events.push(event);
        },
      });

      await gateway.handleRequest(inferenceRequest('event-denied', 'No token.'));
      await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: {
          authorization: 'Bearer event-token',
          'cf-connecting-ip': '203.0.113.77',
        },
        body: JSON.stringify({ id: 'event-first', modelId: model.id, input: 'Allowed.' }),
      }));
      await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: {
          authorization: 'Bearer event-token',
          'cf-connecting-ip': '203.0.113.77',
        },
        body: JSON.stringify({ id: 'event-limited', modelId: model.id, input: 'Limited.' }),
      }));

      expect(events.map(event => event.status)).toEqual([401, 200, 429]);
      expect(events[0]).toMatchObject({ route: 'infer', unauthorized: true, rateLimited: false });
      expect(events[2]).toMatchObject({ route: 'infer', unauthorized: false, rateLimited: true });
    });

    it('should not fail gateway traffic when event handlers throw', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'throwing-event-gateway-node',
        platform: 'cloudflare',
        model,
        onEvent: () => {
          throw new Error('event sink unavailable');
        },
      });

      const response = await gateway.handleRequest(new Request('https://edge.test/health'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it('should support custom HTTP router paths', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'custom-router-gateway-node',
        platform: 'vercel',
        model,
        routes: {
          health: '/api/ready',
          ready: '/api/traffic-ready',
          status: '/api/status',
          infer: '/api/prism',
          openapi: '/api/openapi.json',
          rootHealth: false,
        },
      });

      const root = await gateway.handleRequest(new Request('https://edge.test/'));
      const health = await gateway.handleRequest(new Request('https://edge.test/api/ready'));
      const ready = await gateway.handleRequest(new Request('https://edge.test/api/traffic-ready'));
      const status = await gateway.handleRequest(new Request('https://edge.test/api/status'));
      const openapi = await gateway.handleRequest(new Request('https://edge.test/api/openapi.json'));
      const inference = await gateway.handleRequest(new Request('https://edge.test/api/prism', {
        method: 'POST',
        body: JSON.stringify({ id: 'custom-route-1', modelId: model.id, input: 'Use custom route.' }),
      }));
      const rootBody = await root.json();
      const healthBody = await health.json();
      const readyBody = await ready.json();
      const statusBody = await status.json();
      const openapiBody = await openapi.json();
      const inferenceBody = await inference.json();

      expect(root.status).toBe(404);
      expect(rootBody.endpoints).toEqual(['GET /api/ready', 'GET /api/traffic-ready', 'GET /api/status', 'POST /api/prism', 'GET /api/openapi.json', 'GET /metrics']);
      expect(healthBody.ok).toBe(true);
      expect(readyBody.ready).toBe(true);
      expect(statusBody.status).toBe('healthy');
      expect(openapiBody.paths['/api/ready']).toBeDefined();
      expect(openapiBody.paths['/api/traffic-ready']).toBeDefined();
      expect(openapiBody.paths['/api/status']).toBeDefined();
      expect(openapiBody.paths['/api/prism']).toBeDefined();
      expect(inference.status).toBe(200);
      expect(inferenceBody.success).toBe(true);
    });

    it('should allow disabling the OpenAPI route', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'no-openapi-gateway-node',
        platform: 'netlify',
        model,
        openapi: false,
      });

      const response = await gateway.handleRequest(new Request('https://edge.test/openapi.json'));
      const body = await response.json();
      const spec = gateway.getOpenAPISpec();

      expect(response.status).toBe(404);
      expect(body.endpoints).toEqual(['GET /health', 'GET /ready', 'GET /status', 'POST /infer', 'GET /metrics']);
      expect(spec.paths['/openapi.json']).toBeUndefined();
    });

    it('should protect inference with bearer auth while leaving health public by default', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'auth-gateway-node',
        platform: 'cloudflare',
        edgeId: 'auth-edge',
        model,
        auth: {
          bearerToken: 'secret-token',
        },
      });

      const health = await gateway.handleRequest(new Request('https://edge.test/health'));
      const denied = await gateway.handleRequest(inferenceRequest('auth-denied', 'No token.'));
      const allowed = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: JSON.stringify({ id: 'auth-allowed', modelId: model.id, input: 'With token.' }),
      }));
      const openapi = gateway.getOpenAPISpec();
      const deniedBody = await denied.json();
      const allowedBody = await allowed.json();

      expect(health.status).toBe(200);
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toBe('Bearer realm="prism-edge"');
      expect(deniedBody.error.code).toBe('UNAUTHORIZED');
      expect(allowed.status).toBe(200);
      expect(allowedBody.success).toBe(true);
      expect(openapi.components.securitySchemes?.bearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
      });
      expect(openapi.paths['/infer'].post.security).toEqual([{ bearerAuth: [] }]);
      expect(openapi.paths['/health'].get.security).toBeUndefined();
    });

    it('should allow protecting the metrics route with bearer auth', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'auth-metrics-gateway-node',
        platform: 'cloudflare',
        model,
        auth: {
          bearerToken: 'metrics-secret',
          protectedRoutes: ['infer', 'metrics'],
        },
      });

      const denied = await gateway.handleRequest(new Request('https://edge.test/metrics'));
      const allowed = await gateway.handleRequest(new Request('https://edge.test/metrics', {
        headers: { authorization: 'Bearer metrics-secret' },
      }));
      const openapi = gateway.getOpenAPISpec();

      expect(denied.status).toBe(401);
      expect(allowed.status).toBe(200);
      expect(openapi.paths['/metrics'].get.security).toEqual([{ bearerAuth: [] }]);
    });

    it('should allow protecting the operational status route with bearer auth', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'auth-status-gateway-node',
        platform: 'cloudflare',
        model,
        auth: {
          bearerToken: 'status-secret',
          protectedRoutes: ['status'],
        },
      });

      const denied = await gateway.handleRequest(new Request('https://edge.test/status'));
      const allowed = await gateway.handleRequest(new Request('https://edge.test/status', {
        headers: { authorization: 'Bearer status-secret' },
      }));
      const body = await allowed.json();
      const openapi = gateway.getOpenAPISpec();

      expect(denied.status).toBe(401);
      expect(allowed.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(openapi.paths['/status'].get.security).toEqual([{ bearerAuth: [] }]);
    });

    it('should allow protecting readiness with bearer auth', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'auth-ready-gateway-node',
        platform: 'cloudflare',
        model,
        auth: {
          bearerToken: 'ready-secret',
          protectedRoutes: ['ready'],
        },
      });

      const denied = await gateway.handleRequest(new Request('https://edge.test/ready'));
      const allowed = await gateway.handleRequest(new Request('https://edge.test/ready', {
        headers: { authorization: 'Bearer ready-secret' },
      }));
      const openapi = gateway.getOpenAPISpec();

      expect(denied.status).toBe(401);
      expect(allowed.status).toBe(200);
      expect(openapi.paths['/ready'].get.security).toEqual([{ bearerAuth: [] }]);
    });

    it('should rate limit inference by client key with retry headers', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'rate-limit-gateway-node',
        platform: 'cloudflare',
        edgeId: 'rate-limit-edge',
        model,
        rateLimit: {
          limit: 1,
          windowMs: 60_000,
        },
        metrics: {
          latencyBucketsMs: [1, 10, 100],
        },
      });
      const first = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.10' },
        body: JSON.stringify({ id: 'rate-1', modelId: model.id, input: 'First request.' }),
      }));
      const limited = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.10' },
        body: JSON.stringify({ id: 'rate-2', modelId: model.id, input: 'Second request.' }),
      }));
      const otherClient = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.11' },
        body: JSON.stringify({ id: 'rate-3', modelId: model.id, input: 'Other client.' }),
      }));
      const limitedBody = await limited.json();

      expect(first.status).toBe(200);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBeTruthy();
      expect(limited.headers.get('x-ratelimit-limit')).toBe('1');
      expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
      expect(limitedBody.error.code).toBe('RATE_LIMITED');
      expect(otherClient.status).toBe(200);
    });

    it('should reject inference overload with retry guidance and operational metrics', async () => {
      let releaseFirst: (() => void) | undefined;
      const events: Array<{ overloaded: boolean; status: number }> = [];
      const gateway = new PrismEdgeGateway({
        nodeId: 'overload-gateway-node',
        platform: 'cloudflare',
        edgeId: 'overload-edge',
        model,
        overload: {
          maxConcurrentInference: 1,
          retryAfterMs: 2_500,
        },
        infer: request => new Promise<void>(resolve => {
          releaseFirst = resolve;
        }).then(() => ({
          id: request.id,
          modelId: request.modelId,
          output: { text: 'released' },
          latency: 1,
          edgeId: 'overload-edge',
          timestamp: Date.now(),
        })),
        onEvent: event => {
          events.push({ overloaded: event.overloaded, status: event.status });
        },
      });

      const first = gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        body: JSON.stringify({ id: 'overload-first', modelId: model.id, input: 'Hold slot.' }),
      }));
      for (let attempt = 0; attempt < 10 && !releaseFirst; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(releaseFirst).toBeDefined();
      const readinessWhileBusy = await gateway.handleRequest(new Request('https://edge.test/ready'));
      const overloaded = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        body: JSON.stringify({ id: 'overload-second', modelId: model.id, input: 'Should be rejected.' }),
      }));
      const overloadedBody = await overloaded.json();
      const busyBody = await readinessWhileBusy.json();

      releaseFirst?.();
      const firstResponse = await first;
      const snapshot = gateway.getMetricsSnapshot();
      const metricsText = gateway.toPrometheusMetrics();

      expect(readinessWhileBusy.status).toBe(503);
      expect(busyBody.checks.capacity.ok).toBe(false);
      expect(overloaded.status).toBe(503);
      expect(overloaded.headers.get('retry-after')).toBe('3');
      expect(overloaded.headers.get('x-prism-overloaded')).toBe('1');
      expect(overloaded.headers.get('x-prism-active-inference')).toBe('1');
      expect(overloaded.headers.get('x-prism-max-concurrent-inference')).toBe('1');
      expect(overloadedBody.error.code).toBe('OVERLOADED');
      expect(firstResponse.status).toBe(200);
      expect(snapshot.totals.overloaded).toBe(1);
      expect(snapshot.concurrency.activeInference).toBe(0);
      expect(snapshot.concurrency.maxConcurrentInference).toBe(1);
      expect(snapshot.routes.infer.status['503']).toBe(1);
      expect(events).toContainEqual({ overloaded: true, status: 503 });
      expect(metricsText).toContain('prism_edge_gateway_overloaded_total 1');
      expect(metricsText).toContain('prism_edge_gateway_max_concurrent_inference 1');
    });

    it('should deduplicate idempotent inference retries without consuming extra concurrency', async () => {
      let releaseFirst: (() => void) | undefined;
      const infer = vi.fn<EdgeInferenceHandler>(request => new Promise<void>(resolve => {
        releaseFirst = resolve;
      }).then(() => ({
        id: request.id,
        modelId: request.modelId,
        output: { text: 'idempotent result' },
        latency: 1,
        edgeId: 'idempotent-edge',
        timestamp: Date.now(),
      })));
      const gateway = new PrismEdgeGateway({
        nodeId: 'idempotency-gateway-node',
        platform: 'cloudflare',
        edgeId: 'idempotent-edge',
        model,
        overload: {
          maxConcurrentInference: 1,
        },
        idempotency: {
          ttlMs: 60_000,
        },
        infer,
      });
      const request = (id: string) => new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'idempotency-key': 'dedupe-1' },
        body: JSON.stringify({ id, modelId: model.id, input: 'Deduplicate this work.' }),
      });

      const first = gateway.handleRequest(request('idempotent-first'));
      for (let attempt = 0; attempt < 10 && !releaseFirst; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(releaseFirst).toBeDefined();
      const replayed = gateway.handleRequest(request('idempotent-replayed'));

      releaseFirst?.();
      const firstResponse = await first;
      const replayedResponse = await replayed;
      const hitResponse = await gateway.handleRequest(request('idempotent-hit'));
      const firstBody = await firstResponse.json();
      const replayedBody = await replayedResponse.json();
      const hitBody = await hitResponse.json();

      expect(firstResponse.status).toBe(200);
      expect(replayedResponse.status).toBe(200);
      expect(hitResponse.status).toBe(200);
      expect(firstResponse.headers.get('x-prism-idempotency')).toBe('created');
      expect(replayedResponse.headers.get('x-prism-idempotency')).toBe('replayed');
      expect(hitResponse.headers.get('x-prism-idempotency')).toBe('hit');
      expect(firstBody.data.id).toBe('idempotent-first');
      expect(replayedBody.data.id).toBe('idempotent-first');
      expect(hitBody.data.id).toBe('idempotent-first');
      expect(infer).toHaveBeenCalledTimes(1);
    });

    it('should expose gateway traffic metrics as snapshots and Prometheus text', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'metrics-gateway-node',
        platform: 'cloudflare',
        edgeId: 'metrics-edge',
        model,
        auth: {
          bearerToken: 'metrics-token',
        },
        rateLimit: {
          limit: 1,
          windowMs: 60_000,
        },
      });

      const health = await gateway.handleRequest(new Request('https://edge.test/health'));
      const denied = await gateway.handleRequest(inferenceRequest('metrics-denied', 'No token.'));
      const allowed = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: {
          authorization: 'Bearer metrics-token',
          'cf-connecting-ip': '203.0.113.20',
        },
        body: JSON.stringify({ id: 'metrics-allowed', modelId: model.id, input: 'Count this.' }),
      }));
      const limited = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: {
          authorization: 'Bearer metrics-token',
          'cf-connecting-ip': '203.0.113.20',
        },
        body: JSON.stringify({ id: 'metrics-limited', modelId: model.id, input: 'Limit this.' }),
      }));
      const metricsResponse = await gateway.handleRequest(new Request('https://edge.test/metrics'));
      const metricsText = await metricsResponse.text();
      const snapshot = gateway.getMetricsSnapshot();

      expect(health.status).toBe(200);
      expect(denied.status).toBe(401);
      expect(allowed.status).toBe(200);
      expect(limited.status).toBe(429);
      expect(metricsResponse.status).toBe(200);
      expect(metricsResponse.headers.get('content-type')).toContain('text/plain');
      expect(snapshot.totals.requests).toBe(5);
      expect(snapshot.totals.unauthorized).toBe(1);
      expect(snapshot.totals.rateLimited).toBe(1);
      expect(snapshot.routes.health.status['200']).toBe(1);
      expect(snapshot.routes.health.latencyBucketsMs['100']).toBe(1);
      expect(snapshot.routes.infer.status['401']).toBe(1);
      expect(snapshot.routes.infer.status['200']).toBe(1);
      expect(snapshot.routes.infer.status['429']).toBe(1);
      expect(snapshot.routes.metrics.status['200']).toBe(1);
      expect(metricsText).toContain('# HELP prism_edge_gateway_requests_total Total PRISM edge gateway requests.');
      expect(metricsText).toContain('prism_edge_gateway_requests_total 4');
      expect(metricsText).toContain('prism_edge_gateway_route_requests_total{route="infer",status="429"} 1');
      expect(metricsText).toContain('prism_edge_gateway_unauthorized_total 1');
      expect(metricsText).toContain('prism_edge_gateway_rate_limited_total 1');
      expect(metricsText).toContain('# TYPE prism_edge_gateway_request_duration_ms histogram');
      expect(metricsText).toContain('prism_edge_gateway_request_duration_ms_bucket{route="health",le="100"} 1');
      expect(metricsText).toContain('prism_edge_gateway_request_duration_ms_bucket{route="infer",le="+Inf"} 3');
      expect(metricsText).toContain('prism_edge_gateway_request_duration_ms_count{route="metrics"} 0');
    });

    it('should summarize gateway operational status from readiness and metrics', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'operational-report-gateway-node',
        platform: 'cloudflare',
        edgeId: 'operational-report-edge',
        model,
        rateLimit: {
          limit: 1,
          windowMs: 60_000,
        },
        metrics: {
          latencyBucketsMs: [1, 100, 1_000],
        },
        operational: {
          rateLimitedRate: 0.01,
          inferP95LatencyMs: 1_000,
        },
      });

      await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.90' },
        body: JSON.stringify({ id: 'operational-1', modelId: model.id, input: 'First request.' }),
      }));
      await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.90' },
        body: JSON.stringify({ id: 'operational-2', modelId: model.id, input: 'Limited request.' }),
      }));

      const report = await gateway.getOperationalReport();

      expect(report.status).toBe('degraded');
      expect(report.readiness.ready).toBe(true);
      expect(report.traffic.requests).toBe(2);
      expect(report.traffic.rateLimitedRate).toBe(0.5);
      expect(report.traffic.inferRequests).toBe(2);
      expect(report.traffic.inferP95LatencyMs).toBe(100);
      expect(report.checks.readiness.status).toBe('pass');
      expect(report.checks.rateLimit.status).toBe('warn');
      expect(report.summary).toContain('warning');
    });

    it('should support custom and disabled metrics routes', async () => {
      const customGateway = new PrismEdgeGateway({
        nodeId: 'custom-metrics-gateway-node',
        platform: 'cloudflare',
        model,
        routes: {
          metrics: '/api/metrics',
        },
      });
      const disabledGateway = new PrismEdgeGateway({
        nodeId: 'disabled-metrics-gateway-node',
        platform: 'cloudflare',
        model,
        metrics: false,
      });

      const customMetrics = await customGateway.handleRequest(new Request('https://edge.test/api/metrics'));
      const customOpenAPI = customGateway.getOpenAPISpec();
      const disabledMetrics = await disabledGateway.handleRequest(new Request('https://edge.test/metrics'));
      const disabledOpenAPI = disabledGateway.getOpenAPISpec();

      expect(customMetrics.status).toBe(200);
      expect(customOpenAPI.paths['/api/metrics'].get.operationId).toBe('getPrismEdgeMetrics');
      expect(disabledMetrics.status).toBe(404);
      expect(disabledOpenAPI.paths['/metrics']).toBeUndefined();
    });

    it('should support custom rate limit keys and routes', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'custom-rate-limit-gateway-node',
        platform: 'cloudflare',
        model,
        rateLimit: {
          limit: 1,
          windowMs: 60_000,
          routes: ['health'],
          key: request => request.headers.get('x-tenant-id') ?? 'default',
        },
      });
      const first = await gateway.handleRequest(new Request('https://edge.test/health', {
        headers: { 'x-tenant-id': 'tenant-a' },
      }));
      const limited = await gateway.handleRequest(new Request('https://edge.test/health', {
        headers: { 'x-tenant-id': 'tenant-a' },
      }));
      const otherTenant = await gateway.handleRequest(new Request('https://edge.test/health', {
        headers: { 'x-tenant-id': 'tenant-b' },
      }));
      const infer = await gateway.handleRequest(inferenceRequest('custom-rate-infer', 'Infer remains unlimited.'));

      expect(first.status).toBe(200);
      expect(limited.status).toBe(429);
      expect(otherTenant.status).toBe(200);
      expect(infer.status).toBe(200);
    });
  });

  describe('PrismEdgeClient', () => {
    const model = {
      id: 'client-model',
      name: 'Client Model',
      version: '1.0.0',
      format: 'remote' as const,
      size: 1,
      capabilities: ['client-test'],
    };

    function createClientHarness() {
      const gateway = new PrismEdgeGateway({
        nodeId: 'client-gateway-node',
        platform: 'cloudflare',
        edgeId: 'client-edge',
        region: 'iad',
        model,
        routes: {
          health: '/api/health',
          ready: '/api/ready',
          status: '/api/status',
          infer: '/api/infer',
          metrics: '/api/metrics',
          openapi: '/api/openapi.json',
        },
      });
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        routes: {
          health: '/api/health',
          ready: '/api/ready',
          status: '/api/status',
          infer: '/api/infer',
          metrics: '/api/metrics',
          openapi: '/api/openapi.json',
        },
        headers: () => ({ authorization: 'Bearer test-token' }),
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return gateway.handleRequest(request);
        },
      });

      return { client, requests };
    }

    function createProtectedClientHarness(token?: string) {
      const gateway = new PrismEdgeGateway({
        nodeId: 'protected-client-gateway-node',
        platform: 'cloudflare',
        edgeId: 'protected-client-edge',
        model,
        auth: {
          bearerToken: 'client-token',
        },
      });
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        ...(token ? { bearerToken: token } : {}),
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return gateway.handleRequest(request);
        },
      });

      return { client, requests };
    }

    it('should read health, readiness, operational status, and OpenAPI from a PRISM edge gateway', async () => {
      const { client, requests } = createClientHarness();

      const health = await client.health();
      const ready = await client.ready();
      const status = await client.status();
      const openapi = await client.openapi();
      const metrics = await client.metrics();

      expect(health.ok).toBe(true);
      expect(ready.ready).toBe(true);
      expect(ready.checks.modelDeployed.ok).toBe(true);
      expect(status.status).toBe('healthy');
      expect(status.traffic.requests).toBeGreaterThanOrEqual(2);
      expect(health.model.id).toBe(model.id);
      expect(openapi.openapi).toBe('3.1.0');
      expect(openapi.paths['/api/infer'].post.operationId).toBe('runPrismEdgeInference');
      expect(openapi.paths['/api/ready'].get.operationId).toBe('getPrismEdgeReadiness');
      expect(openapi.paths['/api/status'].get.operationId).toBe('getPrismEdgeStatus');
      expect(metrics).toContain('prism_edge_gateway_requests_total');
      expect(requests[0].headers.get('authorization')).toBe('Bearer test-token');
    });

    it('should wait until readiness recovers from temporary 503 responses', async () => {
      const responses = [
        new Response(JSON.stringify({
          ok: false,
          ready: false,
          service: 'wait-gateway',
          initialized: true,
          platform: 'cloudflare',
          modelId: model.id,
          checks: {
            initialized: { ok: true },
            modelDeployed: { ok: true },
            capacity: { ok: false, message: 'Inference concurrency is saturated at 1/1' },
          },
          stats: {},
        }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
        new Response(JSON.stringify({
          ok: true,
          ready: true,
          service: 'wait-gateway',
          initialized: true,
          platform: 'cloudflare',
          modelId: model.id,
          checks: {
            initialized: { ok: true },
            modelDeployed: { ok: true },
            capacity: { ok: true },
          },
          stats: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ];
      const delays: number[] = [];
      const fetchImpl = vi.fn().mockImplementation(async () => responses.shift()!);
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        fetch: fetchImpl,
        sleep: async ms => {
          delays.push(ms);
        },
      });

      const readiness = await client.waitUntilReady({
        timeoutMs: 1_000,
        intervalMs: 25,
      });

      expect(readiness.ready).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(delays).toEqual([25]);
    });

    it('should time out while waiting for readiness', async () => {
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        fetch: async () => new Response(JSON.stringify({
          ok: false,
          ready: false,
          service: 'wait-timeout-gateway',
          initialized: true,
          platform: 'cloudflare',
          modelId: model.id,
          checks: {
            initialized: { ok: true },
            modelDeployed: { ok: true },
            capacity: { ok: false },
          },
          stats: {},
        }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      });

      await expect(client.waitUntilReady({
        timeoutMs: 0,
        intervalMs: 0,
      })).rejects.toMatchObject({
        name: 'PrismEdgeClientError',
        code: 'READY_TIMEOUT',
      } satisfies Partial<PrismEdgeClientError>);
    });

    it('should run inference and return the unwrapped inference result', async () => {
      const { client } = createClientHarness();

      const result = await client.infer({
        id: 'client-1',
        modelId: model.id,
        input: 'Call the gateway through the client.',
      });

      expect(result.id).toBe('client-1');
      expect(result.modelId).toBe(model.id);
      expect(result.edgeId).toBe('client-edge');
      expect(result.output.text).toContain('Call the gateway through the client.');
    });

    it('should return the full inference envelope for operational clients', async () => {
      const { client } = createClientHarness();

      const first = await client.inferEnvelope({
        id: 'client-envelope-1',
        modelId: model.id,
        input: 'Return the full envelope.',
      });
      const repeat = await client.inferEnvelope({
        id: 'client-envelope-2',
        modelId: model.id,
        input: 'Return the full envelope.',
      });

      expect(first.success).toBe(true);
      expect(first.cached).toBe(false);
      expect(first.latency).toBeGreaterThanOrEqual(0);
      expect(first.requestId).toBeTruthy();
      expect(first.data?.edgeId).toBe('client-edge');
      expect(repeat.success).toBe(true);
      expect(repeat.cached).toBe(true);
      expect(repeat.data?.cached).toBe(true);
    });

    it('should throw a structured client error for invalid gateway responses', async () => {
      const { client } = createClientHarness();

      await expect(client.infer({
        id: 'client-invalid',
        modelId: '',
        input: 'Invalid request.',
      })).rejects.toMatchObject({
        name: 'PrismEdgeClientError',
        status: 400,
        code: 'INVALID_REQUEST',
        requestId: expect.any(String),
      } satisfies Partial<PrismEdgeClientError>);
    });

    it('should send bearerToken and surface unauthorized responses', async () => {
      const allowed = createProtectedClientHarness('client-token');
      const denied = createProtectedClientHarness();

      const result = await allowed.client.infer({
        id: 'client-auth',
        modelId: model.id,
        input: 'Authorized client call.',
      });

      expect(result.edgeId).toBe('protected-client-edge');
      expect(allowed.requests[0].headers.get('authorization')).toBe('Bearer client-token');
      await expect(denied.client.infer({
        id: 'client-auth-denied',
        modelId: model.id,
        input: 'Unauthorized client call.',
      })).rejects.toMatchObject({
        name: 'PrismEdgeClientError',
        status: 401,
        code: 'UNAUTHORIZED',
      } satisfies Partial<PrismEdgeClientError>);
    });

    it('should send configurable trace headers to the gateway', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'client-trace-gateway-node',
        platform: 'cloudflare',
        model,
      });
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        trace: {
          requestId: 'client-trace-id',
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return gateway.handleRequest(request);
        },
      });

      const health = await client.health();

      expect(health.ok).toBe(true);
      expect(requests[0].headers.get('x-prism-request-id')).toBe('client-trace-id');
    });

    it('should preserve custom headers over generated client trace headers', async () => {
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        headers: { 'x-correlation-id': 'manual-correlation-id' },
        trace: {
          header: 'x-correlation-id',
          requestId: 'generated-correlation-id',
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      });

      await client.health();

      expect(requests[0].headers.get('x-correlation-id')).toBe('manual-correlation-id');
    });

    it('should reuse one trace id across retries for the same logical request', async () => {
      const requests: Request[] = [];
      const responses = [
        new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Try again' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ];
      let generated = 0;
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        trace: {
          requestId: () => `retry-trace-${++generated}`,
        },
        retry: {
          retries: 1,
          backoffMs: 0,
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return responses.shift()!;
        },
      });

      await client.health();

      expect(generated).toBe(1);
      expect(requests).toHaveLength(2);
      expect(requests[0].headers.get('x-prism-request-id')).toBe('retry-trace-1');
      expect(requests[1].headers.get('x-prism-request-id')).toBe('retry-trace-1');
    });

    it('should attach idempotency keys to inference calls when configured', async () => {
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        idempotency: {},
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return new Response(JSON.stringify({
            success: true,
            latency: 1,
            cached: false,
            data: {
              id: 'idempotent-client',
              modelId: model.id,
              output: { text: 'Idempotent client.' },
              latency: 1,
              edgeId: 'idempotent-client-edge',
              timestamp: Date.now(),
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      });

      await client.infer({
        id: 'idempotent-client',
        modelId: model.id,
        input: 'Send idempotency header.',
      });

      expect(requests[0].headers.get('idempotency-key')).toBe('idempotent-client');
    });

    it('should preserve manual idempotency headers over generated keys', async () => {
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        headers: { 'idempotency-key': 'manual-idempotency-key' },
        idempotency: {
          key: 'generated-idempotency-key',
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return new Response(JSON.stringify({
            success: true,
            latency: 1,
            cached: false,
            data: {
              id: 'manual-idempotency-client',
              modelId: model.id,
              output: { text: 'Manual idempotency.' },
              latency: 1,
              edgeId: 'manual-idempotency-edge',
              timestamp: Date.now(),
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      });

      await client.infer({
        id: 'manual-idempotency-client',
        modelId: model.id,
        input: 'Keep manual idempotency header.',
      });

      expect(requests[0].headers.get('idempotency-key')).toBe('manual-idempotency-key');
    });

    it('should retry transient HTTP responses before returning success', async () => {
      const responses = [
        new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Try again' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
        new Response(JSON.stringify({
          success: true,
          latency: 1,
          cached: false,
          data: {
            id: 'retry-client',
            modelId: model.id,
            output: { text: 'Recovered after retry.' },
            latency: 1,
            edgeId: 'retry-edge',
            timestamp: Date.now(),
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ];
      const delays: number[] = [];
      const fetchImpl = vi.fn().mockImplementation(async () => responses.shift()!);
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        fetch: fetchImpl,
        retry: {
          retries: 1,
          backoffMs: 25,
        },
        sleep: async ms => {
          delays.push(ms);
        },
      });

      const result = await client.infer({
        id: 'retry-client',
        modelId: model.id,
        input: 'Retry transient failure.',
      });

      expect(result.edgeId).toBe('retry-edge');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(delays).toEqual([25]);
    });

    it('should cap Retry-After delays for rate-limited responses', async () => {
      const responses = [
        new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down' } }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '60',
          },
        }),
        new Response(JSON.stringify({
          success: true,
          latency: 1,
          cached: false,
          data: {
            id: 'retry-after-client',
            modelId: model.id,
            output: { text: 'Recovered after retry-after.' },
            latency: 1,
            edgeId: 'retry-after-edge',
            timestamp: Date.now(),
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ];
      const delays: number[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        fetch: vi.fn().mockImplementation(async () => responses.shift()!),
        retry: {
          retries: 1,
          maxRetryAfterMs: 100,
        },
        sleep: async ms => {
          delays.push(ms);
        },
      });

      const result = await client.infer({
        id: 'retry-after-client',
        modelId: model.id,
        input: 'Retry after rate limit.',
      });

      expect(result.edgeId).toBe('retry-after-edge');
      expect(delays).toEqual([100]);
    });

    it('should retry network errors and expose structured failure after exhaustion', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('connection reset'));
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        fetch: fetchImpl,
        retry: {
          retries: 2,
          backoffMs: 0,
        },
      });

      await expect(client.health()).rejects.toMatchObject({
        name: 'PrismEdgeClientError',
        status: 0,
        code: 'NETWORK_ERROR',
      } satisfies Partial<PrismEdgeClientError>);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('should surface request timeouts as structured client errors', async () => {
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        timeoutMs: 1,
        fetch: async (_input, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
      });

      await expect(client.health()).rejects.toMatchObject({
        name: 'PrismEdgeClientError',
        status: 0,
        code: 'TIMEOUT',
      } satisfies Partial<PrismEdgeClientError>);
    });
  });
});
