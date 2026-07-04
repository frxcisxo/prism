/**
 * Inference module for PRISM
 * Supports: ONNX, TensorFlow Lite, GGLM, WebAssembly
 * Optimizations: Quantization, Batching, Caching, GPU acceleration
 */

import type { InferenceModel } from '../../index';

export type InferenceInput = string | Record<string, any>;
export type InferenceSource = 'cpu' | 'gpu' | 'remote' | 'custom';

export interface InferenceOptions {
  batch?: boolean;
  cache?: boolean;
  useGPU?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface InferenceConfig {
  maxBatchSize?: number;
  cachePath?: string;
  gpuEnabled?: boolean;
  wasmEnabled?: boolean;
  quantization?: 'int8' | 'int4' | 'float16';
  runtimes?: InferenceRuntime[];
}

export type TensorData =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array
  | number[]
  | bigint[];

export interface TensorSpec {
  data: TensorData;
  dims: number[];
  type?: string;
}

export interface OnnxRuntimeWebConfig {
  importOrt?: () => Promise<OnnxRuntimeModule>;
  executionProviders?: string[];
  graphOptimizationLevel?: string;
  wasmPaths?: string;
  readFile?: (path: string) => Promise<Uint8Array>;
  sha256?: (data: Uint8Array) => Promise<string>;
}

export interface HttpInferenceRuntimeConfig {
  endpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  buildRequest?: (
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ) => Record<string, any>;
  parseResponse?: (response: unknown) => string;
}

export interface CloudflareWorkersAIBinding {
  run(
    model: string,
    input: Record<string, any>,
    options?: Record<string, any>
  ): Promise<unknown>;
}

export interface CloudflareWorkersAIConfig {
  ai?: CloudflareWorkersAIBinding;
  accountId?: string;
  apiToken?: string;
  gatewayId?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  buildInput?: (
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ) => Record<string, any>;
  parseResponse?: (response: unknown) => string;
}

export interface OllamaRuntimeConfig {
  host?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  endpoint?: 'chat' | 'generate';
  fetch?: typeof fetch;
  buildRequest?: (
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ) => Record<string, any>;
  parseResponse?: (response: unknown) => string;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface ResilientCircuitBreakerConfig {
  failureThreshold?: number;
  recoveryMs?: number;
  halfOpenMaxCalls?: number;
  now?: () => number;
}

export interface ResilientCircuitBreakerStatus {
  enabled: boolean;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAt?: number;
  nextRetryAt?: number;
}

export type ResilientRuntimeEventType =
  | 'primary-success'
  | 'primary-failure'
  | 'fallback-success'
  | 'fallback-failure'
  | 'retry'
  | 'circuit-opened'
  | 'circuit-half-open'
  | 'circuit-closed'
  | 'primary-skipped';

export interface ResilientRuntimeEvent {
  type: ResilientRuntimeEventType;
  modelId: string;
  runtime: string;
  timestamp: number;
  attempt?: number;
  error?: string;
  fallbackUsed?: boolean;
  circuitBreaker: ResilientCircuitBreakerStatus;
}

export interface ResilientRuntimeMonitorConfig {
  maxEvents?: number;
  now?: () => number;
}

export interface ResilientRuntimeMonitorEntity {
  events: number;
  lastEventAt: number;
  lastEventType: ResilientRuntimeEventType;
}

export interface ResilientRuntimeMonitorSnapshot {
  generatedAt: number;
  health: 'healthy' | 'degraded' | 'recovering' | 'unavailable';
  totals: {
    events: number;
    retries: number;
    primaryFailures: number;
    fallbackSuccesses: number;
    fallbackFailures: number;
    circuitOpened: number;
    primarySkipped: number;
  };
  circuitBreaker?: ResilientCircuitBreakerStatus;
  models: Record<string, ResilientRuntimeMonitorEntity>;
  runtimes: Record<string, ResilientRuntimeMonitorEntity>;
  recentEvents: ResilientRuntimeEvent[];
}

export interface ResilientRuntimeHealthCheck {
  ok: boolean;
  status: ResilientRuntimeMonitorSnapshot['health'];
  statusCode: 200 | 206 | 503;
  generatedAt: number;
  summary: string;
  totals: ResilientRuntimeMonitorSnapshot['totals'];
  circuitBreaker?: ResilientCircuitBreakerStatus;
}

export interface ResilientRuntimeMonitorReport extends ResilientRuntimeHealthCheck {
  models: ResilientRuntimeMonitorSnapshot['models'];
  runtimes: ResilientRuntimeMonitorSnapshot['runtimes'];
  recentEvents: ResilientRuntimeEvent[];
}

export type ResilientRuntimeAlertSeverity = 'info' | 'warning' | 'critical';

export interface ResilientRuntimeAlertRule {
  id: string;
  severity: ResilientRuntimeAlertSeverity;
  when: (snapshot: ResilientRuntimeMonitorSnapshot) => boolean;
  message: string | ((snapshot: ResilientRuntimeMonitorSnapshot) => string);
}

export interface ResilientRuntimeAlert {
  id: string;
  severity: ResilientRuntimeAlertSeverity;
  message: string;
  generatedAt: number;
  health: ResilientRuntimeMonitorSnapshot['health'];
}

export interface ResilientRuntimeAlertState {
  id: string;
  severity: ResilientRuntimeAlertSeverity;
  message: string;
  status: 'active' | 'resolved';
  health: ResilientRuntimeMonitorSnapshot['health'];
  activeSince: number;
  lastSeenAt: number;
  occurrences: number;
  resolvedAt?: number;
}

export interface ResilientRuntimeAlertSummary {
  generatedAt: number;
  active: number;
  resolved: number;
  total: number;
  highestSeverity?: ResilientRuntimeAlertSeverity;
  activeBySeverity: Record<ResilientRuntimeAlertSeverity, number>;
  resolvedBySeverity: Record<ResilientRuntimeAlertSeverity, number>;
  lastActiveAt?: number;
  lastResolvedAt?: number;
}

export interface ResilientInferenceRuntimeConfig {
  primary: InferenceRuntime;
  fallback?: InferenceRuntime;
  maxRetries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  circuitBreaker?: ResilientCircuitBreakerConfig | false;
  onEvent?: (event: ResilientRuntimeEvent) => void;
}

export interface BatchedInference {
  requests: InferenceInput[];
  batchSize: number;
  startTime: number;
}

export interface InferenceOutput {
  text: string;
  tokens: number;
  modelId: string;
  modelName: string;
  source: InferenceSource;
  cached?: boolean;
  raw?: Record<string, any>;
}

interface CachedEntry {
  output: InferenceOutput;
  timestamp: number;
  hits: number;
}

interface LoadedModel {
  model: InferenceModel;
  format: string;
  loadedAt: number;
  session: Record<string, any>;
  runtime: InferenceRuntime;
}

export interface LoadedModelDiagnostic {
  modelId: string;
  modelName: string;
  format: string;
  runtime: string;
  loadedAt: number;
  ageMs: number;
  source: InferenceSource | 'unknown';
  capabilities: string[];
  session: Record<string, any>;
}

export interface RuntimeDiagnostic {
  runtime: string;
  loadedModels: number;
  modelIds: string[];
  formats: string[];
  sources: Array<InferenceSource | 'unknown'>;
}

export interface InferenceEngineDiagnostics {
  status: 'ready' | 'idle';
  generatedAt: number;
  stats: ReturnType<InferenceEngine['getStats']>;
  cache: {
    entries: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  models: LoadedModelDiagnostic[];
  runtimes: RuntimeDiagnostic[];
}

export interface InferenceRuntime {
  id: string;
  supports(model: InferenceModel): boolean;
  load(model: InferenceModel): Promise<Record<string, any>>;
  unload?(modelId: string, session: Record<string, any>): Promise<void>;
  infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>>;
  batchInfer?(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]>;
}

interface ResilientRuntimeSession {
  runtime: string;
  primary?: Record<string, any>;
  fallback?: Record<string, any>;
  primaryRuntime: string;
  fallbackRuntime?: string;
  fallbackLoadError?: string;
}

interface OnnxRuntimeModule {
  env?: {
    wasm?: {
      wasmPaths?: string;
    };
  };
  Tensor: new (type: string, data: TensorData, dims: readonly number[]) => any;
  InferenceSession: {
    create(model: string | ArrayBuffer | Uint8Array, options?: Record<string, any>): Promise<OnnxSession>;
  };
}

interface OnnxSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, any>, outputNames?: string[]): Promise<Record<string, any>>;
  release?(): Promise<void> | void;
}

type ResolvedInferenceConfig = Required<Omit<InferenceConfig, 'cachePath' | 'runtimes'>> & {
  cachePath?: string;
  runtimes: InferenceRuntime[];
};

export class SimulatedInferenceRuntime implements InferenceRuntime {
  id = 'simulated';

  supports(_model: InferenceModel): boolean {
    return true;
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const format = this.detectFormat(model);
    const latency = format === 'gguf' ? 70 : format === 'generic' ? 20 : 50;
    console.debug(`[PRISM] Loading ${format.toUpperCase()} model: ${model.name}`);
    await new Promise(resolve => setTimeout(resolve, latency));

    return {
      format,
      modelId: model.id,
      quantization: model.quantization || null,
      runtime: this.id,
    };
  }

  async infer(
    model: InferenceModel,
    _session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const source: InferenceSource = options.useGPU ? 'gpu' : 'cpu';
    const simulatedLatency = source === 'gpu'
      ? Math.max(3, Math.min(20, model.size / 2e7))
      : Math.max(5, Math.min(50, model.size / 1e7));

    await new Promise(resolve => setTimeout(resolve, simulatedLatency));

    return {
      logits: source === 'gpu' ? [0.1, 0.9] : [0.05, 0.95],
      modelId: model.id,
      modelName: model.name,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 256,
      inputPreview: input.text || input.normalized,
      source,
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    _session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    const batchLatency = Math.max(10, Math.min(60, (model.size / 1e7) * inputs.length));
    await new Promise(resolve => setTimeout(resolve, batchLatency));

    return inputs.map(input => ({
      logits: [0.05, 0.95],
      modelId: model.id,
      modelName: model.name,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 256,
      inputPreview: input.text || input.normalized,
      source: 'cpu',
      runtime: this.id,
    }));
  }

  private detectFormat(model: InferenceModel): string {
    if (model.format) return model.format;
    if (model.id.endsWith('.onnx')) return 'onnx';
    if (model.id.endsWith('.tflite')) return 'tflite';
    if (model.id.endsWith('.gguf')) return 'gguf';
    if (model.id.endsWith('.safetensors')) return 'safetensors';
    return 'generic';
  }
}

export class ResilientRuntimeMonitor {
  private events: ResilientRuntimeEvent[] = [];
  private alertStates = new Map<string, ResilientRuntimeAlertState>();
  private maxEvents: number;
  private now: () => number;

  constructor(config: ResilientRuntimeMonitorConfig = {}) {
    this.maxEvents = config.maxEvents ?? 100;
    this.now = config.now || (() => Date.now());
  }

  handleEvent = (event: ResilientRuntimeEvent): void => {
    this.record(event);
  };

  record(event: ResilientRuntimeEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  reset(): void {
    this.events = [];
    this.alertStates.clear();
  }

  getSnapshot(): ResilientRuntimeMonitorSnapshot {
    const totals = {
      events: this.events.length,
      retries: this.count('retry'),
      primaryFailures: this.count('primary-failure'),
      fallbackSuccesses: this.count('fallback-success'),
      fallbackFailures: this.count('fallback-failure'),
      circuitOpened: this.count('circuit-opened'),
      primarySkipped: this.count('primary-skipped'),
    };
    const circuitBreaker = this.events[this.events.length - 1]?.circuitBreaker;

    return {
      generatedAt: this.now(),
      health: this.determineHealth(circuitBreaker),
      totals,
      circuitBreaker,
      models: this.groupBy('modelId'),
      runtimes: this.groupBy('runtime'),
      recentEvents: [...this.events],
    };
  }

  getHealthCheck(): ResilientRuntimeHealthCheck {
    const snapshot = this.getSnapshot();
    const statusCode = this.statusCodeFor(snapshot.health);
    return {
      ok: snapshot.health === 'healthy' || snapshot.health === 'recovering',
      status: snapshot.health,
      statusCode,
      generatedAt: snapshot.generatedAt,
      summary: this.summaryFor(snapshot),
      totals: snapshot.totals,
      circuitBreaker: snapshot.circuitBreaker,
    };
  }

  toJSON(): ResilientRuntimeMonitorReport {
    const snapshot = this.getSnapshot();
    return {
      ...this.getHealthCheck(),
      models: snapshot.models,
      runtimes: snapshot.runtimes,
      recentEvents: snapshot.recentEvents,
    };
  }

  toPrometheusMetrics(prefix = 'prism_resilient_runtime'): string {
    const snapshot = this.getSnapshot();
    const health = this.getHealthCheck();
    const lines: string[] = [
      `# HELP ${prefix}_health_status Runtime health status as labeled gauges.`,
      `# TYPE ${prefix}_health_status gauge`,
      ...(['healthy', 'degraded', 'recovering', 'unavailable'] as const).map(status =>
        `${prefix}_health_status{status="${status}"} ${snapshot.health === status ? 1 : 0}`
      ),
      `# HELP ${prefix}_health_ok Whether resilient inference is healthy enough to serve traffic.`,
      `# TYPE ${prefix}_health_ok gauge`,
      `${prefix}_health_ok ${health.ok ? 1 : 0}`,
      `# HELP ${prefix}_events_total Total events retained in the monitor window.`,
      `# TYPE ${prefix}_events_total counter`,
      `${prefix}_events_total ${snapshot.totals.events}`,
      `# HELP ${prefix}_retries_total Total retry events retained in the monitor window.`,
      `# TYPE ${prefix}_retries_total counter`,
      `${prefix}_retries_total ${snapshot.totals.retries}`,
      `# HELP ${prefix}_primary_failures_total Total primary runtime failures retained in the monitor window.`,
      `# TYPE ${prefix}_primary_failures_total counter`,
      `${prefix}_primary_failures_total ${snapshot.totals.primaryFailures}`,
      `# HELP ${prefix}_fallback_successes_total Total fallback successes retained in the monitor window.`,
      `# TYPE ${prefix}_fallback_successes_total counter`,
      `${prefix}_fallback_successes_total ${snapshot.totals.fallbackSuccesses}`,
      `# HELP ${prefix}_fallback_failures_total Total fallback failures retained in the monitor window.`,
      `# TYPE ${prefix}_fallback_failures_total counter`,
      `${prefix}_fallback_failures_total ${snapshot.totals.fallbackFailures}`,
      `# HELP ${prefix}_circuit_opened_total Total circuit-open events retained in the monitor window.`,
      `# TYPE ${prefix}_circuit_opened_total counter`,
      `${prefix}_circuit_opened_total ${snapshot.totals.circuitOpened}`,
      `# HELP ${prefix}_primary_skipped_total Total primary-skipped events retained in the monitor window.`,
      `# TYPE ${prefix}_primary_skipped_total counter`,
      `${prefix}_primary_skipped_total ${snapshot.totals.primarySkipped}`,
    ];

    if (snapshot.circuitBreaker) {
      lines.push(
        `# HELP ${prefix}_circuit_breaker_state Circuit breaker state as labeled gauges.`,
        `# TYPE ${prefix}_circuit_breaker_state gauge`,
        ...(['closed', 'open', 'half-open'] as const).map(state =>
          `${prefix}_circuit_breaker_state{state="${state}"} ${snapshot.circuitBreaker?.state === state ? 1 : 0}`
        ),
        `# HELP ${prefix}_circuit_breaker_consecutive_failures Current consecutive primary runtime failures.`,
        `# TYPE ${prefix}_circuit_breaker_consecutive_failures gauge`,
        `${prefix}_circuit_breaker_consecutive_failures ${snapshot.circuitBreaker.consecutiveFailures}`
      );
    }

    for (const [modelId, entity] of Object.entries(snapshot.models)) {
      lines.push(`${prefix}_model_events_total{model_id="${this.escapeLabel(modelId)}"} ${entity.events}`);
    }

    for (const [runtime, entity] of Object.entries(snapshot.runtimes)) {
      lines.push(`${prefix}_runtime_events_total{runtime="${this.escapeLabel(runtime)}"} ${entity.events}`);
    }

    return `${lines.join('\n')}\n`;
  }

  evaluateAlerts(rules: ResilientRuntimeAlertRule[] = this.defaultAlertRules()): ResilientRuntimeAlert[] {
    const snapshot = this.getSnapshot();
    return rules
      .filter(rule => rule.when(snapshot))
      .map(rule => ({
        id: rule.id,
        severity: rule.severity,
        message: typeof rule.message === 'function' ? rule.message(snapshot) : rule.message,
        generatedAt: snapshot.generatedAt,
        health: snapshot.health,
      }));
  }

  updateAlertStates(rules: ResilientRuntimeAlertRule[] = this.defaultAlertRules()): ResilientRuntimeAlertState[] {
    const alerts = this.evaluateAlerts(rules);
    const activeIds = new Set(alerts.map(alert => alert.id));
    const generatedAt = this.getSnapshot().generatedAt;

    for (const alert of alerts) {
      const existing = this.alertStates.get(alert.id);
      this.alertStates.set(alert.id, {
        id: alert.id,
        severity: alert.severity,
        message: alert.message,
        status: 'active',
        health: alert.health,
        activeSince: existing?.status === 'active' ? existing.activeSince : alert.generatedAt,
        lastSeenAt: alert.generatedAt,
        occurrences: existing?.status === 'active' ? existing.occurrences + 1 : 1,
      });
    }

    for (const [id, state] of this.alertStates.entries()) {
      if (state.status === 'active' && !activeIds.has(id)) {
        this.alertStates.set(id, {
          ...state,
          status: 'resolved',
          lastSeenAt: generatedAt,
          resolvedAt: generatedAt,
        });
      }
    }

    return this.getAlertStates();
  }

  getAlertStates(): ResilientRuntimeAlertState[] {
    return [...this.alertStates.values()];
  }

  getAlertSummary(): ResilientRuntimeAlertSummary {
    const states = this.getAlertStates();
    const activeStates = states.filter(state => state.status === 'active');
    const resolvedStates = states.filter(state => state.status === 'resolved');

    return {
      generatedAt: this.now(),
      active: activeStates.length,
      resolved: resolvedStates.length,
      total: states.length,
      highestSeverity: this.highestSeverity(activeStates),
      activeBySeverity: this.countStatesBySeverity(activeStates),
      resolvedBySeverity: this.countStatesBySeverity(resolvedStates),
      lastActiveAt: this.latest(activeStates.map(state => state.lastSeenAt)),
      lastResolvedAt: this.latest(resolvedStates.map(state => state.resolvedAt).filter((value): value is number => value !== undefined)),
    };
  }

  private count(type: ResilientRuntimeEventType): number {
    return this.events.filter(event => event.type === type).length;
  }

  private determineHealth(circuitBreaker?: ResilientCircuitBreakerStatus): ResilientRuntimeMonitorSnapshot['health'] {
    const lastEvent = this.events[this.events.length - 1];
    if (!lastEvent) {
      return 'healthy';
    }
    if (lastEvent.type === 'fallback-failure') {
      return 'unavailable';
    }
    if (circuitBreaker?.state === 'half-open') {
      return 'recovering';
    }
    if (circuitBreaker?.state === 'open' || lastEvent.type === 'fallback-success' || lastEvent.type === 'primary-skipped') {
      return 'degraded';
    }
    return 'healthy';
  }

  private statusCodeFor(health: ResilientRuntimeMonitorSnapshot['health']): 200 | 206 | 503 {
    if (health === 'healthy' || health === 'recovering') {
      return 200;
    }
    if (health === 'degraded') {
      return 206;
    }
    return 503;
  }

  private summaryFor(snapshot: ResilientRuntimeMonitorSnapshot): string {
    if (snapshot.health === 'healthy') {
      return 'Resilient inference runtime is healthy';
    }
    if (snapshot.health === 'recovering') {
      return 'Primary runtime is probing recovery';
    }
    if (snapshot.health === 'degraded') {
      return 'Primary runtime is degraded; fallback path is active';
    }
    return 'Resilient inference runtime is unavailable';
  }

  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  private defaultAlertRules(): ResilientRuntimeAlertRule[] {
    return [
      {
        id: 'resilient-runtime-unavailable',
        severity: 'critical',
        when: snapshot => snapshot.health === 'unavailable',
        message: 'Resilient runtime is unavailable; primary and fallback paths need attention',
      },
      {
        id: 'resilient-runtime-circuit-open',
        severity: 'warning',
        when: snapshot => snapshot.circuitBreaker?.state === 'open',
        message: snapshot => `Primary runtime circuit is open after ${snapshot.circuitBreaker?.consecutiveFailures ?? 0} consecutive failure(s)`,
      },
      {
        id: 'resilient-runtime-recovering',
        severity: 'info',
        when: snapshot => snapshot.health === 'recovering',
        message: 'Primary runtime is probing recovery',
      },
    ];
  }

  private countStatesBySeverity(states: ResilientRuntimeAlertState[]): Record<ResilientRuntimeAlertSeverity, number> {
    return states.reduce<Record<ResilientRuntimeAlertSeverity, number>>((counts, state) => {
      counts[state.severity] += 1;
      return counts;
    }, { info: 0, warning: 0, critical: 0 });
  }

  private highestSeverity(states: ResilientRuntimeAlertState[]): ResilientRuntimeAlertSeverity | undefined {
    if (states.some(state => state.severity === 'critical')) {
      return 'critical';
    }
    if (states.some(state => state.severity === 'warning')) {
      return 'warning';
    }
    if (states.some(state => state.severity === 'info')) {
      return 'info';
    }
    return undefined;
  }

  private latest(values: number[]): number | undefined {
    return values.length > 0 ? Math.max(...values) : undefined;
  }

  private groupBy(key: 'modelId' | 'runtime'): Record<string, ResilientRuntimeMonitorEntity> {
    return this.events.reduce<Record<string, ResilientRuntimeMonitorEntity>>((groups, event) => {
      const value = event[key];
      if (!value) {
        return groups;
      }
      const existing = groups[value] || {
        events: 0,
        lastEventAt: event.timestamp,
        lastEventType: event.type,
      };
      existing.events += 1;
      existing.lastEventAt = event.timestamp;
      existing.lastEventType = event.type;
      groups[value] = existing;
      return groups;
    }, {});
  }
}

export class ResilientInferenceRuntime implements InferenceRuntime {
  id = 'resilient';
  private primary: InferenceRuntime;
  private fallback?: InferenceRuntime;
  private maxRetries: number;
  private timeoutMs: number;
  private retryDelayMs: number;
  private shouldRetry: (error: unknown, attempt: number) => boolean;
  private circuitBreakerEnabled: boolean;
  private failureThreshold: number;
  private recoveryMs: number;
  private halfOpenMaxCalls: number;
  private now: () => number;
  private circuitState: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt?: number;
  private halfOpenCalls = 0;
  private onEvent?: (event: ResilientRuntimeEvent) => void;

  constructor(config: ResilientInferenceRuntimeConfig) {
    this.primary = config.primary;
    this.fallback = config.fallback;
    this.maxRetries = config.maxRetries ?? 1;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.retryDelayMs = config.retryDelayMs ?? 0;
    this.shouldRetry = config.shouldRetry || (() => true);
    const circuitBreaker = config.circuitBreaker;
    this.circuitBreakerEnabled = circuitBreaker !== false;
    this.failureThreshold = circuitBreaker && circuitBreaker.failureThreshold
      ? circuitBreaker.failureThreshold
      : 3;
    this.recoveryMs = circuitBreaker && circuitBreaker.recoveryMs !== undefined
      ? circuitBreaker.recoveryMs
      : 30_000;
    this.halfOpenMaxCalls = circuitBreaker && circuitBreaker.halfOpenMaxCalls
      ? circuitBreaker.halfOpenMaxCalls
      : 1;
    this.now = circuitBreaker && circuitBreaker.now ? circuitBreaker.now : () => Date.now();
    this.onEvent = config.onEvent;
  }

  supports(model: InferenceModel): boolean {
    return this.primary.supports(model) || Boolean(this.fallback?.supports(model));
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    let primarySession: Record<string, any> | undefined;
    let fallbackSession: Record<string, any> | undefined;
    let primaryError: unknown;
    let fallbackLoadError: string | undefined;

    if (this.primary.supports(model)) {
      try {
        primarySession = await this.executeWithRetry(
          () => this.primary.load(model),
          `load:${this.primary.id}`
        );
      } catch (error) {
        primaryError = error;
      }
    }

    if (this.fallback?.supports(model)) {
      try {
        fallbackSession = await this.withTimeout(
          this.fallback.load(model),
          `load:${this.fallback.id}`
        );
      } catch (error) {
        fallbackLoadError = this.errorMessage(error);
      }
    }

    if (!primarySession && !fallbackSession) {
      throw new Error(
        `Resilient runtime could not load model ${model.id}: ${this.errorMessage(primaryError || fallbackLoadError || 'unsupported')}`
      );
    }

    return {
      runtime: this.id,
      primary: primarySession,
      fallback: fallbackSession,
      primaryRuntime: this.primary.id,
      fallbackRuntime: this.fallback?.id,
      fallbackLoadError,
    } satisfies ResilientRuntimeSession;
  }

  async unload(modelId: string, session: Record<string, any>): Promise<void> {
    const resilientSession = session as ResilientRuntimeSession;
    await Promise.all([
      resilientSession.primary
        ? this.primary.unload?.(modelId, resilientSession.primary)
        : Promise.resolve(),
      resilientSession.fallback && this.fallback
        ? this.fallback.unload?.(modelId, resilientSession.fallback)
        : Promise.resolve(),
    ]);
  }

  async infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const resilientSession = session as ResilientRuntimeSession;
    const errors: string[] = [];

    if (resilientSession.primary && this.canUsePrimary(model.id)) {
      try {
        const output = await this.executeWithRetry(
          () => this.primary.infer(model, resilientSession.primary!, input, options),
          `infer:${this.primary.id}`,
          model.id,
          this.primary.id,
          errors
        );
        this.recordPrimarySuccess(model.id);
        this.emitEvent('primary-success', model.id, this.primary.id, {
          fallbackUsed: false,
        });
        return this.decorate(output, false, this.primary.id, errors);
      } catch (error) {
        this.recordPrimaryFailure(model.id, this.errorMessage(error));
        // Fall through to the fallback runtime with the retry history captured by executeWithRetry.
      }
    } else if (resilientSession.primary && this.circuitBreakerEnabled) {
      errors.push(`Primary runtime circuit is ${this.getCircuitBreakerStatus().state}`);
      this.emitEvent('primary-skipped', model.id, this.primary.id, {
        error: errors[errors.length - 1],
      });
    }

    if (this.fallback && resilientSession.fallback) {
      try {
        const output = await this.withTimeout(
          this.fallback.infer(model, resilientSession.fallback, input, options),
          `infer:${this.fallback.id}`
        );
        this.emitEvent('fallback-success', model.id, this.fallback.id, {
          fallbackUsed: true,
        });
        return this.decorate(output, true, this.fallback.id, errors);
      } catch (error) {
        errors.push(this.errorMessage(error));
        this.emitEvent('fallback-failure', model.id, this.fallback.id, {
          error: this.errorMessage(error),
          fallbackUsed: true,
        });
      }
    }

    throw new Error(`Resilient inference failed for ${model.id}: ${errors.join(' | ') || 'no runtime available'}`);
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    label: string,
    modelId?: string,
    runtime?: string,
    errors: string[] = []
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.withTimeout(operation(), label);
      } catch (error) {
        lastError = error;
        errors.push(this.errorMessage(error));
        if (attempt >= this.maxRetries || !this.shouldRetry(error, attempt + 1)) {
          break;
        }
        if (modelId && runtime) {
          this.emitEvent('retry', modelId, runtime, {
            attempt: attempt + 2,
            error: this.errorMessage(error),
          });
        }
        await this.delay(this.retryDelayMs);
      }
    }

    throw lastError;
  }

  private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    if (this.timeoutMs <= 0) {
      return promise;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`Runtime operation timed out after ${this.timeoutMs}ms (${label})`));
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private decorate(
    output: Record<string, any>,
    fallbackUsed: boolean,
    runtime: string,
    errors: string[]
  ): Record<string, any> {
    return {
      ...output,
      runtime: this.id,
      innerRuntime: runtime,
      fallbackUsed,
      attempts: errors.length + 1,
      circuitBreaker: this.getCircuitBreakerStatus(),
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  getCircuitBreakerStatus(): ResilientCircuitBreakerStatus {
    const nextRetryAt = this.openedAt !== undefined ? this.openedAt + this.recoveryMs : undefined;
    return {
      enabled: this.circuitBreakerEnabled,
      state: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      nextRetryAt,
    };
  }

  private canUsePrimary(modelId: string): boolean {
    if (!this.circuitBreakerEnabled) {
      return true;
    }

    if (this.circuitState === 'open') {
      const openedAt = this.openedAt ?? this.now();
      if (this.now() - openedAt >= this.recoveryMs) {
        this.circuitState = 'half-open';
        this.halfOpenCalls = 0;
        this.emitEvent('circuit-half-open', modelId, this.primary.id);
      } else {
        return false;
      }
    }

    if (this.circuitState === 'half-open') {
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        return false;
      }
      this.halfOpenCalls += 1;
    }

    return true;
  }

  private recordPrimarySuccess(modelId: string): void {
    if (!this.circuitBreakerEnabled) {
      return;
    }
    const previousState = this.circuitState;
    this.circuitState = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = undefined;
    this.halfOpenCalls = 0;
    if (previousState !== 'closed') {
      this.emitEvent('circuit-closed', modelId, this.primary.id);
    }
  }

  private recordPrimaryFailure(modelId: string, error: string): void {
    this.emitEvent('primary-failure', modelId, this.primary.id, {
      error,
      fallbackUsed: Boolean(this.fallback),
    });

    if (!this.circuitBreakerEnabled) {
      return;
    }

    this.consecutiveFailures += 1;
    if (this.circuitState === 'half-open' || this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = 'open';
      this.openedAt = this.now();
      this.halfOpenCalls = 0;
      this.emitEvent('circuit-opened', modelId, this.primary.id, {
        error,
      });
    }
  }

  private emitEvent(
    type: ResilientRuntimeEventType,
    modelId: string,
    runtime: string,
    details: Partial<Omit<ResilientRuntimeEvent, 'type' | 'modelId' | 'runtime' | 'timestamp' | 'circuitBreaker'>> = {}
  ): void {
    this.onEvent?.({
      type,
      modelId,
      runtime,
      timestamp: this.now(),
      circuitBreaker: this.getCircuitBreakerStatus(),
      ...details,
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export class OnnxRuntimeWebRuntime implements InferenceRuntime {
  id = 'onnxruntime-web';
  private config: OnnxRuntimeWebConfig;

  constructor(config: OnnxRuntimeWebConfig = {}) {
    this.config = config;
  }

  supports(model: InferenceModel): boolean {
    return model.format === 'onnx'
      || model.id.endsWith('.onnx')
      || model.metadata?.runtime === this.id;
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const ort = await this.loadOrt();
    if (this.config.wasmPaths && ort.env?.wasm) {
      ort.env.wasm.wasmPaths = this.config.wasmPaths;
    }

    const modelSource = await this.resolveModelSource(model);
    const session = await ort.InferenceSession.create(modelSource, {
      executionProviders: this.resolveExecutionProviders(model),
      graphOptimizationLevel: model.metadata?.graphOptimizationLevel
        || this.config.graphOptimizationLevel
        || 'all',
    });

    return {
      runtime: this.id,
      session,
      inputNames: session.inputNames,
      outputNames: session.outputNames,
    };
  }

  async unload(_modelId: string, session: Record<string, any>): Promise<void> {
    await (session.session as OnnxSession | undefined)?.release?.();
  }

  async infer(
    model: InferenceModel,
    sessionState: Record<string, any>,
    input: Record<string, any>,
    _options: InferenceOptions
  ): Promise<Record<string, any>> {
    const ort = await this.loadOrt();
    const session = sessionState.session as OnnxSession | undefined;
    if (!session) {
      throw new Error(`ONNX session not loaded for model ${model.id}`);
    }

    const feeds = this.buildFeeds(ort, session, input);
    const outputNames = this.resolveOutputNames(session, input);
    const outputs = await session.run(feeds, outputNames);

    return {
      text: this.outputSummary(outputs),
      outputs,
      outputNames: Object.keys(outputs),
      source: input.source || 'cpu',
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private async loadOrt(): Promise<OnnxRuntimeModule> {
    if (this.config.importOrt) {
      return this.config.importOrt();
    }

    try {
      const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<OnnxRuntimeModule>;
      return await dynamicImport('onnxruntime-web');
    } catch (error) {
      throw new Error(
        `onnxruntime-web is required for OnnxRuntimeWebRuntime. Install it with "npm install onnxruntime-web". Cause: ${error}`
      );
    }
  }

  private async resolveModelSource(model: InferenceModel): Promise<string | ArrayBuffer | Uint8Array> {
    const metadata = model.metadata || {};
    const buffer = metadata.modelBuffer;
    if (buffer) {
      const bytes = this.toUint8Array(buffer);
      await this.verifyModelArtifact(model, bytes);
      return bytes;
    }

    const localPath = metadata.modelPath || metadata.path;
    if (typeof localPath === 'string' && this.shouldVerifyModelArtifact(model)) {
      const bytes = await this.readModelFile(localPath);
      await this.verifyModelArtifact(model, bytes);
      return bytes;
    }

    const source = metadata.modelUrl || metadata.modelPath || metadata.url || metadata.path;
    if (!source) {
      throw new Error(
        `ONNX model ${model.id} requires metadata.modelUrl, metadata.modelPath, metadata.url, metadata.path, or metadata.modelBuffer`
      );
    }
    return source as string | ArrayBuffer | Uint8Array;
  }

  private resolveExecutionProviders(model: InferenceModel): string[] {
    const providers = model.metadata?.executionProviders || this.config.executionProviders;
    if (Array.isArray(providers) && providers.length > 0) {
      return providers;
    }
    return ['wasm'];
  }

  private shouldVerifyModelArtifact(model: InferenceModel): boolean {
    return Boolean(model.metadata?.sha256 || model.metadata?.integrity || model.metadata?.expectedSize);
  }

  private async readModelFile(path: string): Promise<Uint8Array> {
    if (this.config.readFile) {
      return this.config.readFile(path);
    }

    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const fs = await dynamicImport('node:fs/promises');
    return new Uint8Array(await fs.readFile(path));
  }

  private toUint8Array(source: unknown): Uint8Array {
    if (source instanceof Uint8Array) {
      return source;
    }
    if (source instanceof ArrayBuffer) {
      return new Uint8Array(source);
    }
    if (ArrayBuffer.isView(source)) {
      const view = source as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    throw new Error('metadata.modelBuffer must be a Uint8Array, ArrayBuffer, or typed array view');
  }

  private async verifyModelArtifact(model: InferenceModel, bytes: Uint8Array): Promise<void> {
    const expectedSize = model.metadata?.expectedSize;
    if (typeof expectedSize === 'number' && bytes.byteLength !== expectedSize) {
      throw new Error(
        `ONNX model ${model.id} size mismatch: expected ${expectedSize} bytes, received ${bytes.byteLength} bytes`
      );
    }

    const expectedHash = this.normalizeSha256(model.metadata?.sha256 || model.metadata?.integrity);
    if (!expectedHash) {
      return;
    }

    const actualHash = await this.sha256(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(
        `ONNX model ${model.id} SHA-256 mismatch: expected ${expectedHash}, received ${actualHash}`
      );
    }
  }

  private normalizeSha256(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }

    return value.replace(/^sha256-/i, '').toLowerCase();
  }

  private async sha256(bytes: Uint8Array): Promise<string> {
    if (this.config.sha256) {
      return (await this.config.sha256(bytes)).toLowerCase();
    }

    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const stableBytes = new Uint8Array(bytes);
      const hash = await subtle.digest('SHA-256', stableBytes.buffer);
      return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    }

    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const crypto = await dynamicImport('node:crypto');
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  private buildFeeds(
    ort: OnnxRuntimeModule,
    session: OnnxSession,
    input: Record<string, any>
  ): Record<string, any> {
    if (input.feeds && typeof input.feeds === 'object') {
      return input.feeds as Record<string, any>;
    }

    if (input.inputs && typeof input.inputs === 'object') {
      const feeds: Record<string, any> = {};
      for (const [name, value] of Object.entries(input.inputs)) {
        feeds[name] = this.toTensor(ort, value);
      }
      return feeds;
    }

    const tensor = input.tensor || this.extractTensorSpec(input);
    if (tensor) {
      const inputName = input.inputName || session.inputNames[0];
      if (!inputName) {
        throw new Error('ONNX model does not expose an input name');
      }
      return { [inputName]: this.toTensor(ort, tensor) };
    }

    throw new Error(
      'ONNX inference requires tensor input. Pass { feeds }, { inputs }, { tensor }, or { data, dims, type }.'
    );
  }

  private extractTensorSpec(input: Record<string, any>): TensorSpec | undefined {
    if ('data' in input && Array.isArray(input.dims)) {
      return {
        data: input.data as TensorData,
        dims: input.dims as number[],
        type: input.type as string | undefined,
      };
    }
    return undefined;
  }

  private toTensor(ort: OnnxRuntimeModule, value: unknown): any {
    if (this.isOrtTensorLike(value)) {
      return value;
    }

    const spec = value as TensorSpec;
    if (!spec || !('data' in spec) || !Array.isArray(spec.dims)) {
      throw new Error('ONNX tensor spec requires { data, dims, type? }');
    }

    const type = spec.type || this.inferTensorType(spec.data);
    const data = Array.isArray(spec.data)
      ? this.toTypedArray(type, spec.data)
      : spec.data;

    return new ort.Tensor(type, data, spec.dims);
  }

  private isOrtTensorLike(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype !== Object.prototype
      && prototype !== null
      && 'dims' in value
      && 'data' in value
      && 'type' in value;
  }

  private inferTensorType(data: TensorData): string {
    if (data instanceof Float64Array) return 'float64';
    if (data instanceof Int8Array) return 'int8';
    if (data instanceof Uint8Array) return 'uint8';
    if (data instanceof Int16Array) return 'int16';
    if (data instanceof Uint16Array) return 'uint16';
    if (data instanceof Int32Array) return 'int32';
    if (data instanceof Uint32Array) return 'uint32';
    if (typeof BigInt64Array !== 'undefined' && data instanceof BigInt64Array) return 'int64';
    if (typeof BigUint64Array !== 'undefined' && data instanceof BigUint64Array) return 'uint64';
    if (Array.isArray(data) && typeof data[0] === 'bigint') return 'int64';
    return 'float32';
  }

  private toTypedArray(type: string, data: number[] | bigint[]): TensorData {
    switch (type) {
      case 'float64':
        return new Float64Array(data as number[]);
      case 'int8':
        return new Int8Array(data as number[]);
      case 'uint8':
        return new Uint8Array(data as number[]);
      case 'int16':
        return new Int16Array(data as number[]);
      case 'uint16':
        return new Uint16Array(data as number[]);
      case 'int32':
        return new Int32Array(data as number[]);
      case 'uint32':
        return new Uint32Array(data as number[]);
      case 'int64':
        return new BigInt64Array(data as bigint[]);
      case 'uint64':
        return new BigUint64Array(data as bigint[]);
      default:
        return new Float32Array(data as number[]);
    }
  }

  private resolveOutputNames(session: OnnxSession, input: Record<string, any>): string[] | undefined {
    if (Array.isArray(input.outputNames)) {
      return input.outputNames as string[];
    }
    return session.outputNames.length > 0 ? session.outputNames : undefined;
  }

  private outputSummary(outputs: Record<string, any>): string {
    const names = Object.keys(outputs);
    if (names.length === 0) {
      return 'ONNX inference completed with no named outputs';
    }

    const first = outputs[names[0]];
    const dims = Array.isArray(first?.dims) ? first.dims.join('x') : 'unknown';
    return `ONNX inference produced ${names.length} output(s); first=${names[0]} shape=${dims}`;
  }
}

export class HttpInferenceRuntime implements InferenceRuntime {
  id = 'http';

  constructor(private readonly config: HttpInferenceRuntimeConfig = {}) {}

  supports(model: InferenceModel): boolean {
    return model.format === 'http'
      || model.format === 'remote'
      || model.format === 'openai-compatible'
      || model.metadata?.runtime === this.id
      || model.metadata?.runtime === 'openai-compatible'
      || typeof model.metadata?.endpoint === 'string'
      || typeof model.metadata?.apiUrl === 'string';
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const endpoint = this.resolveEndpoint(model);

    return {
      runtime: this.id,
      endpoint,
      headers: this.resolveHeaders(model),
      remoteModel: model.metadata?.remoteModel || model.metadata?.model || model.id,
    };
  }

  async infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const fetcher = this.config.fetch || globalThis.fetch;
    if (!fetcher) {
      throw new Error('fetch is required for HttpInferenceRuntime');
    }

    const endpoint = String(session.endpoint || this.resolveEndpoint(model));
    const body = this.config.buildRequest
      ? this.config.buildRequest(model, input, options)
      : this.buildOpenAICompatibleRequest(model, session, input, options);
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(session.headers as Record<string, string> || {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? this.parseJson(text, endpoint) : {};

    if (!response.ok) {
      throw new Error(`HTTP inference failed for ${model.id}: ${response.status} ${this.errorPreview(payload, text)}`);
    }

    const outputText = this.config.parseResponse
      ? this.config.parseResponse(payload)
      : this.parseOpenAICompatibleResponse(payload);

    return {
      text: outputText,
      response: payload,
      request: body,
      status: response.status,
      source: 'remote',
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private resolveEndpoint(model: InferenceModel): string {
    const endpoint = model.metadata?.endpoint || model.metadata?.apiUrl || this.config.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      throw new Error(`HTTP model ${model.id} requires metadata.endpoint or runtime endpoint`);
    }
    return endpoint;
  }

  private resolveHeaders(model: InferenceModel): Record<string, string> {
    const headers: Record<string, string> = {
      ...(this.config.headers || {}),
      ...(model.metadata?.headers || {}),
    };
    const apiKey = model.metadata?.apiKey || this.config.apiKey;

    if (apiKey && !headers.authorization && !headers.Authorization) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private buildOpenAICompatibleRequest(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Record<string, any> {
    const messages = Array.isArray(input.messages)
      ? input.messages
      : [
          {
            role: 'user',
            content: input.text || input.prompt || input.normalized || JSON.stringify(input),
          },
        ];

    return {
      model: session.remoteModel || model.metadata?.remoteModel || model.id,
      messages,
      temperature: options.temperature ?? model.metadata?.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? model.metadata?.maxTokens ?? 256,
      stream: false,
      ...(model.metadata?.request || {}),
    };
  }

  private parseJson(text: string, endpoint: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`HTTP inference endpoint ${endpoint} returned invalid JSON`);
    }
  }

  private parseOpenAICompatibleResponse(payload: unknown): string {
    const data = payload as Record<string, any>;
    const firstChoice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    const content = firstChoice?.message?.content
      || firstChoice?.delta?.content
      || firstChoice?.text
      || data.output_text
      || data.generated_text
      || data.text
      || data.result;

    if (typeof content !== 'string') {
      throw new Error('HTTP inference response did not include text output');
    }

    return content;
  }

  private errorPreview(payload: unknown, fallback: string): string {
    const data = payload as Record<string, any>;
    const message = data?.error?.message || data?.message || fallback;
    return String(message).slice(0, 240);
  }
}

export class CloudflareWorkersAIRuntime implements InferenceRuntime {
  id = 'cloudflare-workers-ai';

  constructor(private readonly config: CloudflareWorkersAIConfig = {}) {}

  supports(model: InferenceModel): boolean {
    const runtime = model.metadata?.runtime || model.metadata?.provider;
    const remoteModel = this.resolveModelName(model, false);

    return runtime === this.id
      || runtime === 'workers-ai'
      || model.metadata?.cloudflare === true
      || (model.format === 'remote' && typeof remoteModel === 'string' && remoteModel.startsWith('@cf/'));
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    const remoteModel = this.resolveModelName(model);

    return {
      runtime: this.id,
      mode: this.config.ai ? 'binding' : 'rest',
      remoteModel,
      gatewayId: model.metadata?.gatewayId || this.config.gatewayId,
    };
  }

  async infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const remoteModel = String(session.remoteModel || this.resolveModelName(model));
    const payload = this.config.buildInput
      ? this.config.buildInput(model, input, options)
      : this.buildWorkersAIInput(model, input, options);
    const providerOptions = this.buildProviderOptions(session);
    const response = this.config.ai
      ? await this.config.ai.run(remoteModel, payload, providerOptions)
      : await this.runViaRest(model, remoteModel, payload, providerOptions);
    const outputText = this.config.parseResponse
      ? this.config.parseResponse(response)
      : this.parseWorkersAIResponse(response);

    return {
      text: outputText,
      response,
      request: payload,
      remoteModel,
      source: 'remote',
      runtime: this.id,
      mode: this.config.ai ? 'binding' : 'rest',
    };
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private async runViaRest(
    model: InferenceModel,
    remoteModel: string,
    payload: Record<string, any>,
    providerOptions: Record<string, any> | undefined
  ): Promise<unknown> {
    const fetcher = this.config.fetch || globalThis.fetch;
    if (!fetcher) {
      throw new Error('fetch is required for CloudflareWorkersAIRuntime REST mode');
    }

    const accountId = model.metadata?.accountId || this.config.accountId;
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new Error(`Cloudflare Workers AI model ${model.id} requires metadata.accountId or runtime accountId`);
    }

    const apiToken = model.metadata?.apiToken || this.config.apiToken;
    if (typeof apiToken !== 'string' || apiToken.length === 0) {
      throw new Error(`Cloudflare Workers AI model ${model.id} requires metadata.apiToken or runtime apiToken`);
    }

    const endpoint = this.buildRestEndpoint(accountId, remoteModel);
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        ...(providerOptions?.gateway?.id ? { 'cf-aig-gateway-id': providerOptions.gateway.id } : {}),
        ...(this.config.headers || {}),
        ...(model.metadata?.headers || {}),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const json = text ? this.parseJson(text, endpoint) : {};

    if (!response.ok) {
      throw new Error(`Cloudflare Workers AI inference failed for ${model.id}: ${response.status} ${this.errorPreview(json, text)}`);
    }

    return json;
  }

  private resolveModelName(model: InferenceModel, required = true): string | undefined {
    const remoteModel = model.metadata?.remoteModel || model.metadata?.model || model.metadata?.workersAIModel || model.id;
    if (typeof remoteModel === 'string' && remoteModel.length > 0) {
      return remoteModel;
    }
    if (required) {
      throw new Error(`Cloudflare Workers AI model ${model.id} requires metadata.remoteModel or metadata.model`);
    }
    return undefined;
  }

  private buildWorkersAIInput(
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ): Record<string, any> {
    const base = Array.isArray(input.messages)
      ? { messages: input.messages }
      : { prompt: input.prompt || input.text || input.normalized || JSON.stringify(input) };

    return {
      ...base,
      ...(options.temperature ?? model.metadata?.temperature ? { temperature: options.temperature ?? model.metadata?.temperature } : {}),
      ...(options.maxTokens ?? model.metadata?.maxTokens ? { max_tokens: options.maxTokens ?? model.metadata?.maxTokens } : {}),
      ...(model.metadata?.input || {}),
    };
  }

  private buildProviderOptions(session: Record<string, any>): Record<string, any> | undefined {
    if (!session.gatewayId) {
      return undefined;
    }

    return {
      gateway: {
        id: session.gatewayId,
      },
    };
  }

  private buildRestEndpoint(accountId: string, remoteModel: string): string {
    const baseUrl = (this.config.baseUrl || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
    const modelPath = remoteModel.replace(/^\//, '');
    return `${baseUrl}/accounts/${accountId}/ai/run/${modelPath}`;
  }

  private parseJson(text: string, endpoint: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Cloudflare Workers AI endpoint ${endpoint} returned invalid JSON`);
    }
  }

  private parseWorkersAIResponse(payload: unknown): string {
    const data = payload as Record<string, any>;
    const result = data.result && typeof data.result === 'object'
      ? data.result as Record<string, any>
      : undefined;
    const firstChoice = Array.isArray(data.choices)
      ? data.choices[0]
      : Array.isArray(result?.choices)
        ? result.choices[0]
        : undefined;
    const content = data.response
      || data.text
      || data.output_text
      || data.generated_text
      || result?.response
      || result?.text
      || result?.output_text
      || firstChoice?.message?.content
      || firstChoice?.text;

    if (typeof content !== 'string') {
      throw new Error('Cloudflare Workers AI response did not include text output');
    }

    return content;
  }

  private errorPreview(payload: unknown, fallback: string): string {
    const data = payload as Record<string, any>;
    const errors = Array.isArray(data?.errors) ? data.errors : [];
    const message = errors[0]?.message || data?.error?.message || data?.message || fallback;
    return String(message).slice(0, 240);
  }
}

export class OllamaRuntime implements InferenceRuntime {
  id = 'ollama';

  constructor(private readonly config: OllamaRuntimeConfig = {}) {}

  supports(model: InferenceModel): boolean {
    const runtime = model.metadata?.runtime || model.metadata?.provider;

    return runtime === this.id
      || model.metadata?.ollama === true
      || model.format === 'ollama';
  }

  async load(model: InferenceModel): Promise<Record<string, any>> {
    return {
      runtime: this.id,
      endpoint: model.metadata?.endpoint || this.config.endpoint || 'chat',
      host: this.resolveHost(model),
      remoteModel: this.resolveModelName(model),
      headers: this.resolveHeaders(model),
    };
  }

  async infer(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const fetcher = this.config.fetch || globalThis.fetch;
    if (!fetcher) {
      throw new Error('fetch is required for OllamaRuntime');
    }

    const endpoint = session.endpoint === 'generate' ? 'generate' : 'chat';
    const url = `${String(session.host).replace(/\/$/, '')}/api/${endpoint}`;
    const body = this.config.buildRequest
      ? this.config.buildRequest(model, input, options)
      : this.buildRequest(model, session, input, options, endpoint);
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(session.headers as Record<string, string> || {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? this.parseJson(text, url) : {};

    if (!response.ok) {
      throw new Error(`Ollama inference failed for ${model.id}: ${response.status} ${this.errorPreview(payload, text)}`);
    }

    const outputText = this.config.parseResponse
      ? this.config.parseResponse(payload)
      : this.parseResponse(payload);

    return {
      text: outputText,
      response: payload,
      request: body,
      status: response.status,
      remoteModel: session.remoteModel,
      endpoint,
      source: 'remote',
      runtime: this.id,
    };
  }

  async batchInfer(
    model: InferenceModel,
    session: Record<string, any>,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    return Promise.all(inputs.map(input => this.infer(model, session, input, options)));
  }

  private resolveHost(model: InferenceModel): string {
    const host = model.metadata?.host || model.metadata?.baseUrl || this.config.host || 'http://localhost:11434';
    if (typeof host !== 'string' || host.length === 0) {
      throw new Error(`Ollama model ${model.id} requires a valid host`);
    }
    return host;
  }

  private resolveModelName(model: InferenceModel): string {
    const remoteModel = model.metadata?.remoteModel || model.metadata?.model || model.id;
    if (typeof remoteModel !== 'string' || remoteModel.length === 0) {
      throw new Error(`Ollama model ${model.id} requires metadata.remoteModel or metadata.model`);
    }
    return remoteModel;
  }

  private resolveHeaders(model: InferenceModel): Record<string, string> {
    const headers: Record<string, string> = {
      ...(this.config.headers || {}),
      ...(model.metadata?.headers || {}),
    };
    const apiKey = model.metadata?.apiKey || this.config.apiKey;

    if (apiKey && !headers.authorization && !headers.Authorization) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private buildRequest(
    model: InferenceModel,
    session: Record<string, any>,
    input: Record<string, any>,
    options: InferenceOptions,
    endpoint: 'chat' | 'generate'
  ): Record<string, any> {
    const common = {
      model: session.remoteModel || this.resolveModelName(model),
      stream: false,
      ...(options.temperature ?? model.metadata?.temperature ? { options: { temperature: options.temperature ?? model.metadata?.temperature } } : {}),
      ...(model.metadata?.request || {}),
    };

    if (endpoint === 'generate') {
      return {
        ...common,
        prompt: input.prompt || input.text || input.normalized || JSON.stringify(input),
      };
    }

    return {
      ...common,
      messages: Array.isArray(input.messages)
        ? input.messages
        : [
            {
              role: 'user',
              content: input.text || input.prompt || input.normalized || JSON.stringify(input),
            },
          ],
    };
  }

  private parseJson(text: string, endpoint: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Ollama endpoint ${endpoint} returned invalid JSON`);
    }
  }

  private parseResponse(payload: unknown): string {
    const data = payload as Record<string, any>;
    const content = data.message?.content
      || data.response
      || data.text
      || data.output_text;

    if (typeof content !== 'string') {
      throw new Error('Ollama response did not include text output');
    }

    return content;
  }

  private errorPreview(payload: unknown, fallback: string): string {
    const data = payload as Record<string, any>;
    const message = data?.error || data?.message || fallback;
    return String(message).slice(0, 240);
  }
}

/**
 * Multi-format model loader
 * Supports ONNX, TensorFlow Lite, GGLM (for LLMs)
 */
export class ModelLoader {
  private loadedModels: Map<string, LoadedModel>;
  private runtimes: InferenceRuntime[];

  constructor(runtimes: InferenceRuntime[] = [new SimulatedInferenceRuntime()]) {
    this.loadedModels = new Map();
    this.runtimes = runtimes;
  }

  async loadModel(model: InferenceModel): Promise<{ modelId: string; status: string; loadTime: number }> {
    if (model.size <= 0) {
      throw new Error('Model size must be positive');
    }

    if (this.loadedModels.has(model.id)) {
      return { modelId: model.id, status: 'already-loaded', loadTime: 0 };
    }

    const startTime = performance.now();
    const format = this.detectFormat(model);
    const runtime = this.selectRuntime(model);

    try {
      const session = await runtime.load(model);

      this.loadedModels.set(model.id, {
        model,
        format,
        loadedAt: Date.now(),
        session: { format, ...session },
        runtime,
      });

      const loadTime = performance.now() - startTime;
      return { modelId: model.id, status: 'loaded', loadTime };
    } catch (error) {
      throw new Error(`Failed to load model ${model.id}: ${error}`);
    }
  }

  private detectFormat(model: InferenceModel): string {
    if (model.format) {
      return model.format;
    }

    if (model.id.endsWith('.onnx')) return 'onnx';
    if (model.id.endsWith('.tflite')) return 'tflite';
    if (model.id.endsWith('.gguf')) return 'gguf';
    if (model.id.endsWith('.safetensors')) return 'safetensors';
    return 'generic';
  }

  private selectRuntime(model: InferenceModel): InferenceRuntime {
    const runtime = this.runtimes.find(candidate => candidate.supports(model));
    if (!runtime) {
      throw new Error(`No inference runtime supports model ${model.id}`);
    }
    return runtime;
  }

  hasModel(modelId: string): boolean {
    return this.loadedModels.has(modelId);
  }

  getModel(modelId: string): InferenceModel | undefined {
    return this.loadedModels.get(modelId)?.model;
  }

  getSession(modelId: string): Record<string, any> | undefined {
    return this.loadedModels.get(modelId)?.session;
  }

  getRuntime(modelId: string): InferenceRuntime | undefined {
    return this.loadedModels.get(modelId)?.runtime;
  }

  getLoadedModelDiagnostics(): LoadedModelDiagnostic[] {
    const now = Date.now();

    return Array.from(this.loadedModels.values()).map(loaded => ({
      modelId: loaded.model.id,
      modelName: loaded.model.name,
      format: loaded.format,
      runtime: loaded.runtime.id,
      loadedAt: loaded.loadedAt,
      ageMs: Math.max(0, now - loaded.loadedAt),
      source: this.inferSessionSource(loaded.session),
      capabilities: [...(loaded.model.capabilities || [])],
      session: this.sanitizeSession(loaded.session),
    }));
  }

  listLoaded(): string[] {
    return Array.from(this.loadedModels.keys());
  }

  async unloadModel(modelId: string): Promise<{ modelId: string; status: string }> {
    if (!this.loadedModels.has(modelId)) {
      throw new Error(`Model not loaded: ${modelId}`);
    }

    const loaded = this.loadedModels.get(modelId)!;
    await loaded.runtime.unload?.(modelId, loaded.session);
    this.loadedModels.delete(modelId);
    return { modelId, status: 'unloaded' };
  }

  private inferSessionSource(session: Record<string, any>): InferenceSource | 'unknown' {
    if (session.runtime === 'simulated') {
      return 'cpu';
    }
    if (
      session.runtime === 'http'
      || session.runtime === 'cloudflare-workers-ai'
      || session.runtime === 'ollama'
      || typeof session.endpoint === 'string'
      || typeof session.host === 'string'
    ) {
      return 'remote';
    }
    if (session.runtime === 'onnxruntime-web') {
      return 'cpu';
    }
    return 'unknown';
  }

  private sanitizeSession(session: Record<string, any>): Record<string, any> {
    const safe: Record<string, any> = {};
    const secretPattern = /(authorization|api.?key|token|secret|password|credential)/i;

    for (const [key, value] of Object.entries(session)) {
      if (secretPattern.test(key)) {
        safe[key] = '[redacted]';
        continue;
      }

      if (key === 'headers' && value && typeof value === 'object') {
        safe[key] = this.sanitizeHeaders(value as Record<string, any>);
        continue;
      }

      if (this.isPrimitiveDiagnosticValue(value)) {
        safe[key] = value;
        continue;
      }

      if (Array.isArray(value) && value.every(item => this.isPrimitiveDiagnosticValue(item))) {
        safe[key] = [...value];
        continue;
      }

      if (value && typeof value === 'object') {
        safe[key] = `[${value.constructor?.name || 'Object'}]`;
      }
    }

    return safe;
  }

  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const safe: Record<string, any> = {};
    const secretPattern = /(authorization|api.?key|token|secret|password|credential)/i;

    for (const [key, value] of Object.entries(headers)) {
      safe[key] = secretPattern.test(key) ? '[redacted]' : value;
    }

    return safe;
  }

  private isPrimitiveDiagnosticValue(value: unknown): boolean {
    return value === null
      || value === undefined
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean';
  }
}

/**
 * High-performance inference engine with optimizations
 */
export class InferenceEngine {
  private loader: ModelLoader;
  private config: ResolvedInferenceConfig;
  private cache = new Map<string, CachedEntry>();
  private totalRequests = 0;
  private totalLatency = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: InferenceConfig = {}) {
    this.config = {
      maxBatchSize: 8,
      gpuEnabled: false,
      wasmEnabled: false,
      quantization: 'int8',
      ...config,
      runtimes: config.runtimes?.length ? config.runtimes : [new SimulatedInferenceRuntime()],
    };
    this.loader = new ModelLoader(this.config.runtimes);
  }

  async loadModel(model: InferenceModel): Promise<{ modelId: string; status: string; loadTime: number }> {
    return await this.loader.loadModel(model);
  }

  async unloadModel(modelId: string): Promise<{ modelId: string; status: string }> {
    return this.loader.unloadModel(modelId);
  }

  async infer(
    modelId: string,
    input: InferenceInput,
    options: InferenceOptions = {}
  ): Promise<InferenceOutput> {
    const startTime = performance.now();
    const allowCache = options.cache !== false;
    const cacheKey = this.buildCacheKey(modelId, input, options);

    if (allowCache && this.cache.has(cacheKey)) {
      this.cacheHits++;
      const cached = this.cache.get(cacheKey)!;
      cached.hits += 1;
      return { ...cached.output, cached: true };
    }

    const model = this.loader.getModel(modelId);
    if (!model) {
      throw new Error(`Model not loaded: ${modelId}`);
    }

    const processedInput = this.preprocessInput(input, model);
    const output = await this.compute(model, processedInput, options);
    const inferenceOutput = this.postprocessOutput(output, model, input);

    if (allowCache) {
      this.cache.set(cacheKey, { output: inferenceOutput, timestamp: Date.now(), hits: 1 });
      this.cacheMisses++;
    }

    const latency = performance.now() - startTime;
    this.totalRequests++;
    this.totalLatency += latency;
    console.debug(`[PRISM] Inference latency: ${latency.toFixed(2)}ms`);
    return inferenceOutput;
  }

  async batchInfer(
    modelId: string,
    inputs: InferenceInput[],
    options: InferenceOptions = {}
  ): Promise<Array<InferenceOutput>> {
    const startTime = performance.now();
    const model = this.loader.getModel(modelId);
    if (!model) {
      throw new Error(`Model not loaded: ${modelId}`);
    }

    const batchSize = this.config.maxBatchSize;
    const results: InferenceOutput[] = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const processedBatch = batch.map(input => this.preprocessInput(input, model));
      const batchResults = await this.computeBatch(model, processedBatch, options);

      batchResults.forEach((output, index) => {
        const inferenceOutput = this.postprocessOutput(output, model, batch[index]);
        results.push(inferenceOutput);
      });
    }

    const latency = performance.now() - startTime;
    const throughput = inputs.length / (latency / 1000 || 1);
    console.debug(`[PRISM] Batch inference: ${inputs.length} items in ${latency.toFixed(2)}ms (${throughput.toFixed(0)} items/sec)`);
    return results;
  }

  getStats(): {
    loadedModels: number;
    totalRequests: number;
    averageLatency: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  } {
    return {
      loadedModels: this.loader.listLoaded().length,
      totalRequests: this.totalRequests,
      averageLatency: this.totalRequests > 0 ? this.totalLatency / this.totalRequests : 0,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  listLoadedModels(): string[] {
    return this.loader.listLoaded();
  }

  getLoadedModelDiagnostics(): LoadedModelDiagnostic[] {
    return this.loader.getLoadedModelDiagnostics();
  }

  getRuntimeDiagnostics(): RuntimeDiagnostic[] {
    const groups = new Map<string, RuntimeDiagnostic>();

    for (const model of this.getLoadedModelDiagnostics()) {
      const existing = groups.get(model.runtime) || {
        runtime: model.runtime,
        loadedModels: 0,
        modelIds: [],
        formats: [],
        sources: [],
      };

      existing.loadedModels += 1;
      existing.modelIds.push(model.modelId);
      if (!existing.formats.includes(model.format)) {
        existing.formats.push(model.format);
      }
      if (!existing.sources.includes(model.source)) {
        existing.sources.push(model.source);
      }
      groups.set(model.runtime, existing);
    }

    return Array.from(groups.values());
  }

  getDiagnostics(): InferenceEngineDiagnostics {
    const models = this.getLoadedModelDiagnostics();

    return {
      status: models.length > 0 ? 'ready' : 'idle',
      generatedAt: Date.now(),
      stats: this.getStats(),
      cache: {
        entries: this.cache.size,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0,
      },
      models,
      runtimes: this.getRuntimeDiagnostics(),
    };
  }

  private buildCacheKey(
    modelId: string,
    input: InferenceInput,
    options: Record<string, any>
  ): string {
    return `${modelId}:${JSON.stringify(input)}:${JSON.stringify({
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 256,
    })}`;
  }

  private preprocessInput(
    input: InferenceInput,
    _model: InferenceModel
  ): Record<string, any> {
    if (typeof input === 'string') {
      return {
        text: input,
        normalized: input.trim().replace(/\s+/g, ' '),
        length: input.length,
      };
    }

    return {
      ...input,
      normalized: JSON.stringify(input),
    };
  }

  private async compute(
    model: InferenceModel,
    input: Record<string, any>,
    options: InferenceOptions
  ): Promise<Record<string, any>> {
    const runtime = this.loader.getRuntime(model.id);
    const session = this.loader.getSession(model.id);

    if (!runtime || !session) {
      throw new Error(`Model runtime not loaded: ${model.id}`);
    }

    return runtime.infer(model, session, input, this.resolveExecutionOptions(options));
  }

  private async computeBatch(
    model: InferenceModel,
    inputs: Record<string, any>[],
    options: InferenceOptions
  ): Promise<Record<string, any>[]> {
    const runtime = this.loader.getRuntime(model.id);
    const session = this.loader.getSession(model.id);

    if (!runtime || !session) {
      throw new Error(`Model runtime not loaded: ${model.id}`);
    }

    const executionOptions = this.resolveExecutionOptions(options);
    if (runtime.batchInfer) {
      return runtime.batchInfer(model, session, inputs, executionOptions);
    }

    return Promise.all(
      inputs.map(input => runtime.infer(model, session, input, executionOptions))
    );
  }

  private postprocessOutput(
    output: Record<string, any>,
    model: InferenceModel,
    originalInput: string | Record<string, any>
  ): InferenceOutput {
    const tokens = this.estimateTokenCount(originalInput);
    const text = this.generateTextResponse(model, originalInput, output);

    return {
      text,
      tokens,
      modelId: model.id,
      modelName: model.name,
      source: output.source || 'cpu',
      ...(output.runtime && output.runtime !== 'simulated' ? { raw: output } : {}),
    };
  }

  private estimateTokenCount(input: InferenceInput): number {
    if (typeof input === 'string') {
      return Math.max(1, Math.min(256, Math.floor(input.length / 4)));
    }

    return Math.max(1, Math.min(256, Math.floor(JSON.stringify(input).length / 4)));
  }

  private generateTextResponse(
    model: InferenceModel,
    input: InferenceInput,
    output: Record<string, any>
  ): string {
    if (typeof output.text === 'string') {
      return output.text;
    }

    const preview = typeof input === 'string' ? input : JSON.stringify(input);
    const shortInput = preview.length > 120 ? preview.slice(0, 120) + '...' : preview;
    const style = model.name.toLowerCase().includes('llama')
      ? 'Llama-style'
      : model.name.toLowerCase().includes('qwen')
      ? 'Qwen-style'
      : 'PRISM-style';

    return `${style} response for ${shortInput}`;
  }

  private resolveExecutionOptions(options: InferenceOptions): InferenceOptions {
    return {
      ...options,
      useGPU: Boolean(this.config.gpuEnabled && options.useGPU && this.hasWebGPU()),
    };
  }

  private hasWebGPU(): boolean {
    return typeof globalThis !== 'undefined' && 'navigator' in globalThis && typeof (globalThis as any).navigator?.gpu !== 'undefined';
  }
}

/**
 * Quantization utilities for smaller models
 */
export class QuantizationUtils {
  static quantizeInt8(weights: Float32Array): Int8Array {
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const scale = max === min ? 1 : 255.0 / (max - min);

    return new Int8Array(
      Array.from(weights).map(w => Math.round((w - min) * scale - 128))
    );
  }

  static dequantizeInt8(
    weights: Int8Array,
    min: number,
    max: number
  ): Float32Array {
    const scale = max === min ? 1 : (max - min) / 255.0;
    return new Float32Array(
      Array.from(weights).map(w => (w + 128) * scale + min)
    );
  }

  static estimateSize(original: number, quantization: string): number {
    switch (quantization) {
      case 'int8':
        return Math.round(original * 0.25);
      case 'int4':
        return Math.round(original * 0.125);
      case 'float16':
        return Math.round(original * 0.5);
      default:
        return original;
    }
  }
}
