import type { InferenceRequest, InferenceResult } from '../../index';
import type { EdgeResponse } from './edge';
import type {
  PrismEdgeGatewayHealth,
  PrismEdgeGatewayOpenAPISpec,
} from './gateway';

export interface PrismEdgeClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
  bearerToken?: string | (() => string | Promise<string>);
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  timeoutMs?: number;
  retry?: PrismEdgeClientRetryConfig | false;
  trace?: PrismEdgeClientTraceConfig | false;
  sleep?: (ms: number) => Promise<void>;
  routes?: {
    health?: string;
    infer?: string;
    metrics?: string;
    openapi?: string;
  };
}

export interface PrismEdgeClientRetryConfig {
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  maxRetryAfterMs?: number;
  respectRetryAfter?: boolean;
  statuses?: number[];
}

export interface PrismEdgeClientTraceConfig {
  header?: string;
  requestId?: string | (() => string | Promise<string>);
}

export type PrismEdgeInferenceEnvelope = EdgeResponse<InferenceResult>;

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

  async metrics(): Promise<string> {
    return this.requestText(this.route('metrics'), { method: 'GET' });
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    const envelope = await this.inferEnvelope(request);

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

  async inferEnvelope(request: InferenceRequest): Promise<PrismEdgeInferenceEnvelope> {
    return this.requestJson<PrismEdgeInferenceEnvelope>(this.route('infer'), {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>(path, { method: 'GET' });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(path, init);
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

  private async requestText(path: string, init: RequestInit): Promise<string> {
    const response = await this.request(path, init);
    const text = await response.text();

    if (!response.ok) {
      throw new PrismEdgeClientError(
        `PRISM edge request failed with HTTP ${response.status}`,
        response.status,
        undefined,
        text
      );
    }

    return text;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const retry = this.resolveRetryConfig();
    const traceId = await this.resolveTraceId();
    let lastError: unknown;

    for (let attempt = 0; attempt <= retry.retries; attempt += 1) {
      try {
        const response = await this.requestOnce(path, init, traceId);

        if (!this.shouldRetryStatus(response.status, retry) || attempt === retry.retries) {
          return response;
        }

        await this.sleep(this.retryDelay(attempt, retry, response));
      } catch (error) {
        lastError = error;

        if (error instanceof PrismEdgeClientError) {
          if (error.code === 'TIMEOUT' && attempt < retry.retries) {
            await this.sleep(this.retryDelay(attempt, retry));
            continue;
          }

          throw error;
        }

        if (attempt === retry.retries) {
          throw new PrismEdgeClientError(
            error instanceof Error ? error.message : 'PRISM edge network request failed',
            0,
            'NETWORK_ERROR',
            error
          );
        }

        await this.sleep(this.retryDelay(attempt, retry));
      }
    }

    throw new PrismEdgeClientError(
      lastError instanceof Error ? lastError.message : 'PRISM edge request failed',
      0,
      'NETWORK_ERROR',
      lastError
    );
  }

  private async requestOnce(path: string, init: RequestInit, traceId?: string): Promise<Response> {
    const headers = new Headers(await this.resolveHeaders(traceId));

    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const controller = this.config.timeoutMs && this.config.timeoutMs > 0
      ? new AbortController()
      : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.config.timeoutMs)
      : undefined;

    try {
      return await this.fetchImpl(this.url(path), {
        ...init,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new PrismEdgeClientError(
          `PRISM edge request timed out after ${this.config.timeoutMs}ms`,
          0,
          'TIMEOUT',
          error
        );
      }

      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private resolveRetryConfig(): Required<PrismEdgeClientRetryConfig> {
    const retry = this.config.retry === false ? {} : this.config.retry ?? {};

    return {
      retries: Math.max(0, retry.retries ?? 0),
      backoffMs: Math.max(0, retry.backoffMs ?? 250),
      maxBackoffMs: Math.max(0, retry.maxBackoffMs ?? 2_000),
      maxRetryAfterMs: Math.max(0, retry.maxRetryAfterMs ?? 2_000),
      respectRetryAfter: retry.respectRetryAfter ?? true,
      statuses: retry.statuses ?? [408, 425, 429, 500, 502, 503, 504],
    };
  }

  private shouldRetryStatus(status: number, retry: Required<PrismEdgeClientRetryConfig>): boolean {
    return retry.retries > 0 && retry.statuses.includes(status);
  }

  private retryDelay(
    attempt: number,
    retry: Required<PrismEdgeClientRetryConfig>,
    response?: Response
  ): number {
    const retryAfter = response && retry.respectRetryAfter
      ? this.retryAfterMs(response.headers.get('retry-after'))
      : undefined;

    if (retryAfter !== undefined) {
      return Math.min(retryAfter, retry.maxRetryAfterMs);
    }

    return Math.min(retry.backoffMs * (2 ** attempt), retry.maxBackoffMs);
  }

  private retryAfterMs(value: string | null): number | undefined {
    if (!value) {
      return undefined;
    }

    const seconds = Number(value);

    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const date = Date.parse(value);

    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    if (this.config.sleep) {
      await this.config.sleep(ms);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, ms));
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

  private async resolveHeaders(traceId?: string): Promise<HeadersInit> {
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

    const traceHeader = this.traceHeaderName();

    if (traceId && !headers.has(traceHeader)) {
      headers.set(traceHeader, traceId);
    }

    return headers;
  }

  private async resolveTraceId(): Promise<string | undefined> {
    if (this.config.trace === false || !this.config.trace) {
      return undefined;
    }

    const configured = this.config.trace.requestId;

    if (typeof configured === 'function') {
      const requestId = await configured();
      return requestId.trim() || undefined;
    }

    if (typeof configured === 'string') {
      return configured.trim() || undefined;
    }

    return this.generateRequestId();
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

  private route(name: 'health' | 'infer' | 'metrics' | 'openapi'): string {
    const defaults = {
      health: '/health',
      infer: '/infer',
      metrics: '/metrics',
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
