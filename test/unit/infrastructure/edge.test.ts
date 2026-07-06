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
  });
});
