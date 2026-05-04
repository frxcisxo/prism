/**
 * Edge deployment module for PRISM
 * Deploy to: Vercel Edge Functions, Cloudflare Workers, Netlify Edge
 */

import type { InferenceRequest, InferenceResult } from '../../index';

export interface EdgeConfig {
  platform: 'vercel' | 'cloudflare' | 'netlify' | 'deno-deploy';
  region?: string;
  cacheTtl?: number;
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

/**
 * Vercel Edge Functions adapter
 * Ultra-low latency with Vercel's global network
 */
export class VercelEdgeAdapter {
  constructor(private config: EdgeConfig) {}

  /**
   * Handle request at edge
   * Returns in <10ms from nearest location
   */
  async handleRequest(
    request: Request
  ): Promise<Response> {
    const startTime = performance.now();

    try {
      const body = await request.json() as InferenceRequest;
      
      // Validate
      if (!body.id || !body.modelId || !body.input) {
        return this.errorResponse('INVALID_REQUEST', 'Missing required fields', startTime);
      }

      // Check cache (Vercel KV)
      // In production: const cached = await kv.get(cacheKey);
      // For now, simulate:
      const cached = null;

      if (cached) {
        const latency = performance.now() - startTime;
        return this.jsonResponse(
          {
            success: true,
            data: cached,
            latency,
            cached: true,
          },
          200,
          { 'cache-control': 'public, max-age=3600' }
        );
      }

      // Route to inference
      const result: InferenceResult = {
        id: body.id,
        modelId: body.modelId,
        output: `Edge inference at ${this.config.region}`,
        latency: performance.now() - startTime,
        edgeId: 'vercel-edge',
        timestamp: Date.now(),
      };

      // Cache result
      // In production: await kv.set(cacheKey, result, { ex: this.config.cacheTtl || 3600 });

      return this.jsonResponse(
        {
          success: true,
          data: result,
          latency: result.latency,
          cached: false,
        },
        200,
        { 'cache-control': `public, max-age=${this.config.cacheTtl || 3600}` }
      );
    } catch (error) {
      return this.errorResponse('INFERENCE_ERROR', String(error), startTime);
    }
  }

  private jsonResponse(
    data: any,
    status: number,
    headers?: Record<string, string>
  ): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json',
        'x-edge-location': 'vercel',
        ...headers,
      },
    });
  }

  private errorResponse(code: string, message: string, startTime: number): Response {
    return this.jsonResponse(
      {
        success: false,
        error: { code, message },
        latency: performance.now() - startTime,
        cached: false,
      },
      500
    );
  }
}

/**
 * Cloudflare Workers adapter
 * Ultra-fast with Wasm support
 */
export class CloudflareEdgeAdapter {
  constructor(private config: EdgeConfig) {}

  async handleRequest(
    request: Request
  ): Promise<Response> {
    const startTime = performance.now();

    try {
      const body = await request.json() as InferenceRequest;

      // Use Cloudflare KV for caching
      // Try to get from cache
      // const cached = await env.PRISM_CACHE.get(cacheKey);
      
      const result: InferenceResult = {
        id: body.id,
        modelId: body.modelId,
        output: `Cloudflare edge inference`,
        latency: performance.now() - startTime,
        edgeId: 'cloudflare-worker',
        timestamp: Date.now(),
      };

      // Set cache
      // await env.PRISM_CACHE.put(cacheKey, JSON.stringify(result), {
      //   expirationTtl: this.config.cacheTtl || 3600,
      // });

      return new Response(
        JSON.stringify({
          success: true,
          data: result,
          latency: result.latency,
          cached: false,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-edge-location': 'cloudflare',
            'cache-control': `public, max-age=${this.config.cacheTtl || 3600}`,
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INFERENCE_ERROR',
            message: String(error),
          },
          latency: performance.now() - startTime,
          cached: false,
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
  }
}

/**
 * Netlify Edge Functions adapter
 */
export class NetlifyEdgeAdapter {
  async handleRequest(
    request: Request
  ): Promise<Response> {
    const startTime = performance.now();

    try {
      const body = await request.json() as InferenceRequest;

      const result: InferenceResult = {
        id: body.id,
        modelId: body.modelId,
        output: `Netlify edge inference`,
        latency: performance.now() - startTime,
        edgeId: 'netlify-edge',
        timestamp: Date.now(),
      };

      return new Response(
        JSON.stringify({
          success: true,
          data: result,
          latency: result.latency,
          cached: false,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-edge-location': 'netlify',
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INFERENCE_ERROR',
            message: String(error),
          },
          latency: performance.now() - startTime,
          cached: false,
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
  }
}

/**
 * Deno Deploy adapter
 * Native TypeScript, security-first
 */
export class DenoDeployAdapter {
  async handleRequest(request: Request): Promise<Response> {
    const startTime = performance.now();

    try {
      const body = await request.json() as InferenceRequest;

      const result: InferenceResult = {
        id: body.id,
        modelId: body.modelId,
        output: `Deno Deploy edge inference`,
        latency: performance.now() - startTime,
        edgeId: 'deno-deploy',
        timestamp: Date.now(),
      };

      return new Response(
        JSON.stringify({
          success: true,
          data: result,
          latency: result.latency,
          cached: false,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-edge-location': 'deno-deploy',
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INFERENCE_ERROR',
            message: String(error),
          },
          latency: performance.now() - startTime,
          cached: false,
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }
  }
}

/**
 * Factory for creating edge adapters
 */
export function createEdgeAdapter(config: EdgeConfig) {
  switch (config.platform) {
    case 'vercel':
      return new VercelEdgeAdapter(config);
    case 'cloudflare':
      return new CloudflareEdgeAdapter(config);
    case 'netlify':
      return new NetlifyEdgeAdapter();
    case 'deno-deploy':
      return new DenoDeployAdapter();
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
