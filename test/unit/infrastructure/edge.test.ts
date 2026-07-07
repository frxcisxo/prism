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
      });
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

    it('should serve health, inference, OpenAPI, CORS preflight, and not-found through the HTTP router', async () => {
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
      const openapi = await gateway.handleRequest(new Request('https://edge.test/openapi.json'));
      const preflight = await gateway.handleRequest(new Request('https://edge.test/infer', {
        method: 'OPTIONS',
      }));
      const inference = await gateway.handleRequest(inferenceRequest('router-1', 'Route through router.'));
      const notFound = await gateway.handleRequest(new Request('https://edge.test/missing'));
      const healthBody = await health.json();
      const openapiBody = await openapi.json();
      const preflightBody = await preflight.json();
      const inferenceBody = await inference.json();
      const notFoundBody = await notFound.json();

      expect(health.status).toBe(200);
      expect(healthBody.ok).toBe(true);
      expect(openapi.status).toBe(200);
      expect(openapiBody.openapi).toBe('3.1.0');
      expect(openapiBody.info.title).toBe('Router Gateway API');
      expect(openapiBody.paths['/health'].get.operationId).toBe('getPrismEdgeHealth');
      expect(openapiBody.paths['/infer'].post.operationId).toBe('runPrismEdgeInference');
      expect(openapiBody.components.schemas.InferenceRequest.properties.modelId.const).toBe(model.id);
      expect(preflight.status).toBe(200);
      expect(preflightBody.ok).toBe(true);
      expect(inference.status).toBe(200);
      expect(inferenceBody.success).toBe(true);
      expect(notFound.status).toBe(404);
      expect(notFoundBody.endpoints).toEqual(['GET /health', 'POST /infer', 'GET /openapi.json']);
      expect(inference.headers.get('access-control-allow-origin')).toBe('*');
      expect(health.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS');
    });

    it('should support custom HTTP router paths', async () => {
      const gateway = new PrismEdgeGateway({
        nodeId: 'custom-router-gateway-node',
        platform: 'vercel',
        model,
        routes: {
          health: '/api/ready',
          infer: '/api/prism',
          openapi: '/api/openapi.json',
          rootHealth: false,
        },
      });

      const root = await gateway.handleRequest(new Request('https://edge.test/'));
      const health = await gateway.handleRequest(new Request('https://edge.test/api/ready'));
      const openapi = await gateway.handleRequest(new Request('https://edge.test/api/openapi.json'));
      const inference = await gateway.handleRequest(new Request('https://edge.test/api/prism', {
        method: 'POST',
        body: JSON.stringify({ id: 'custom-route-1', modelId: model.id, input: 'Use custom route.' }),
      }));
      const rootBody = await root.json();
      const healthBody = await health.json();
      const openapiBody = await openapi.json();
      const inferenceBody = await inference.json();

      expect(root.status).toBe(404);
      expect(rootBody.endpoints).toEqual(['GET /api/ready', 'POST /api/prism', 'GET /api/openapi.json']);
      expect(healthBody.ok).toBe(true);
      expect(openapiBody.paths['/api/ready']).toBeDefined();
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
      expect(body.endpoints).toEqual(['GET /health', 'POST /infer']);
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
          infer: '/api/infer',
          openapi: '/api/openapi.json',
        },
      });
      const requests: Request[] = [];
      const client = new PrismEdgeClient({
        baseUrl: 'https://edge.test',
        routes: {
          health: '/api/health',
          infer: '/api/infer',
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

    it('should read health and OpenAPI from a PRISM edge gateway', async () => {
      const { client, requests } = createClientHarness();

      const health = await client.health();
      const openapi = await client.openapi();

      expect(health.ok).toBe(true);
      expect(health.model.id).toBe(model.id);
      expect(openapi.openapi).toBe('3.1.0');
      expect(openapi.paths['/api/infer'].post.operationId).toBe('runPrismEdgeInference');
      expect(requests[0].headers.get('authorization')).toBe('Bearer test-token');
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
  });
});
