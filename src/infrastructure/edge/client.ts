import type { InferenceRequest, InferenceResult } from '../../index';
import type { EdgeResponse } from './edge';
import type { PrismEdgeGatewayHealth, PrismEdgeGatewayOpenAPISpec } from './gateway';

export interface PrismEdgeClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
  bearerToken?: string | (() => string | Promise<string>);
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  routes?: {
    health?: string;
    infer?: string;
    openapi?: string;
  };
}

export class PrismEdgeClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly response?: unknown
  ) {
    super(message);
    this.name = 'PrismEdgeClientError';
  }
}

export class PrismEdgeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: URL;

  constructor(private readonly config: PrismEdgeClientConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch is required for PrismEdgeClient');
    }

    this.baseUrl = new URL(config.baseUrl);
  }

  async health(): Promise<PrismEdgeGatewayHealth> {
    return this.getJson<PrismEdgeGatewayHealth>(this.route('health'));
  }

  async openapi(): Promise<PrismEdgeGatewayOpenAPISpec> {
    return this.getJson<PrismEdgeGatewayOpenAPISpec>(this.route('openapi'));
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    const envelope = await this.requestJson<EdgeResponse<InferenceResult>>(this.route('infer'), {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!envelope.success || !envelope.data) {
      throw new PrismEdgeClientError(
        envelope.error?.message ?? 'PRISM edge inference failed',
        200,
        envelope.error?.code,
        envelope
      );
    }

    return envelope.data;
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>(path, { method: 'GET' });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(await this.resolveHeaders());

    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await this.fetchImpl(this.url(path), {
      ...init,
      headers,
    });
    const payload = await this.readJson(response);

    if (!response.ok) {
      const error = this.edgeError(payload);
      throw new PrismEdgeClientError(
        error?.message ?? `PRISM edge request failed with HTTP ${response.status}`,
        response.status,
        error?.code,
        payload
      );
    }

    return payload as T;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();

    if (text.length === 0) {
      return undefined;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      throw new PrismEdgeClientError(
        'PRISM edge response was not valid JSON',
        response.status,
        'INVALID_JSON',
        text
      );
    }
  }

  private async resolveHeaders(): Promise<HeadersInit> {
    const resolvedHeaders = typeof this.config.headers === 'function'
      ? this.config.headers()
      : this.config.headers ?? {};
    const headers = new Headers(await resolvedHeaders);
    const token = typeof this.config.bearerToken === 'function'
      ? await this.config.bearerToken()
      : this.config.bearerToken;

    if (token && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`);
    }

    return headers;
  }

  private route(name: 'health' | 'infer' | 'openapi'): string {
    const defaults = {
      health: '/health',
      infer: '/infer',
      openapi: '/openapi.json',
    };

    return this.config.routes?.[name] ?? defaults[name];
  }

  private url(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  private edgeError(payload: unknown): { code?: string; message?: string } | undefined {
    if (!payload || typeof payload !== 'object' || !('error' in payload)) {
      return undefined;
    }

    const error = (payload as { error?: unknown }).error;
    return error && typeof error === 'object' ? error as { code?: string; message?: string } : undefined;
  }
}
