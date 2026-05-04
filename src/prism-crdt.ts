/**
 * 🔮 PRISM CRDT - AI-Powered Edge Orchestration with Pure CRDT
 *
 * Versión con CRDT puro para garantías matemáticas de consistencia eventual.
 * Convergencia automática, sin conflictos manuales, escalabilidad masiva.
 */

import { EventEmitter } from 'node:events';
import {
  ModelRegistryCRDT,
  DistributedCacheCRDT,
  LoadBalancerCRDT,
  OfflineQueueCRDT,
  NodeRegistryCRDT,
  InferenceStatsCRDT,
  type CacheEntry
} from './crdt-components';
import type {
  InferenceModel,
  InferenceRequest,
  InferenceResult,
  EdgeNode
} from './index';

/**
 * 🔮 PrismCRDT - PRISM con CRDT puro
 *
 * Garantías matemáticas de consistencia eventual.
 * Convergencia automática sin coordinación central.
 * Escalabilidad masiva para edge computing 2026.
 */
export class PrismCRDT extends EventEmitter {
  // ============================================================================
  // COMPONENTES CRDT CORE
  // ============================================================================

  private modelRegistry = new ModelRegistryCRDT();
  private cache = new DistributedCacheCRDT();
  private loadBalancer = new LoadBalancerCRDT();
  private offlineQueue = new OfflineQueueCRDT();
  private nodeRegistry = new NodeRegistryCRDT();
  private stats = new InferenceStatsCRDT();

  // ============================================================================
  // METADATA Y CONFIGURACIÓN
  // ============================================================================

  private nodeId: string;
  private isOnline: boolean = false;
  private version: number = 0;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(config: { nodeId: string; region?: string; cacheSize?: number }) {
    super();
    this.nodeId = config.nodeId;
  }

  // ============================================================================
  // API PRINCIPAL - REGISTRO DE NODOS
  // ============================================================================

  /**
   * Register this node in the distributed network
   * CRDT: Node registry converge automáticamente
   */
  async registerNode(capabilities: {
    gpu?: boolean;
    wasm?: boolean;
    quantization?: boolean;
  }): Promise<{
    nodeId: string;
    status: string;
    capabilities: {
      gpu: boolean;
      wasm: boolean;
      quantization: boolean;
    };
  }> {
    const node: EdgeNode = {
      id: this.nodeId,
      name: `edge-${this.nodeId}`,
      region: 'local',
      capabilities,
      models: [],
      status: 'online',
      lastHeartbeat: Date.now(),
      loadScore: 0,
    };

    this.nodeRegistry.registerNode(node, this.nodeId);
    this.isOnline = true;
    this.version++;

    this.emit('node:registered', node);

    return {
      nodeId: this.nodeId,
      status: 'registered',
      capabilities: {
        gpu: capabilities.gpu || false,
        wasm: capabilities.wasm || false,
        quantization: capabilities.quantization || false,
      },
    };
  }

  // ============================================================================
  // API PRINCIPAL - DEPLOYMENT DE MODELOS
  // ============================================================================

  /**
   * Deploy ML model to edge
   * CRDT: Model registry converge automáticamente en todos los nodos
   */
  async deployModel(model: InferenceModel): Promise<{
    modelId: string;
    status: string;
    nodeId: string;
    deploymentTime: number;
  }> {
    // Validate model
    if (model.size <= 0) {
      throw new Error('Model size must be positive');
    }

    const startTime = performance.now();

    // CRDT: Converge automáticamente
    this.modelRegistry.deployModel(model, this.nodeId);
    this.version++;

    // Update node models list
    const node = this.nodeRegistry.getNode(this.nodeId);
    if (node && !node.models.includes(model.id)) {
      node.models.push(model.id);
      this.nodeRegistry.registerNode(node, this.nodeId);
    }

    this.emit('model:deployed', model);
    const deploymentTime = performance.now() - startTime;

    return {
      modelId: model.id,
      status: 'deployed',
      nodeId: this.nodeId,
      deploymentTime,
    };
  }

  // ============================================================================
  // API PRINCIPAL - INFERENCE
  // ============================================================================

  /**
   * Run inference with automatic edge routing
   * CRDT: Cache, load balancing y stats convergen automáticamente
   */
  async infer(request: InferenceRequest): Promise<InferenceResult> {
    const startTime = performance.now();

    // Check cache (CRDT converge automáticamente)
    const cacheKey = `${request.modelId}:${JSON.stringify(request.input)}`;
    const cachedEntry = this.cache.getCacheEntry(cacheKey);

    if (cachedEntry) {
      const result = cachedEntry.value;
      this.stats.recordRequest(true, performance.now() - startTime, true);
      this.emit('inference:complete', result);
      return result;
    }

    // Check if model is deployed (CRDT registry)
    if (!this.modelRegistry.hasModel(request.modelId)) {
      const error = new Error('Model not deployed');
      this.stats.recordRequest(false, performance.now() - startTime, false);
      this.emit('inference:error', { request, error });
      throw error;
    }

    // Route to optimal edge (CRDT load balancing)
    const edgeId = request.edgeId || this.selectOptimalEdge(request.modelId);

    try {
      // Perform inference
      const output = await this.performInference(request, edgeId);
      const latency = performance.now() - startTime;

      // Create result
      const result: InferenceResult = {
        id: request.id,
        modelId: request.modelId,
        output,
        latency,
        edgeId,
        timestamp: Date.now(),
      };

      // Cache result (CRDT converge automáticamente)
      const cacheEntry: CacheEntry = {
        value: result,
        timestamp: Date.now(),
        ttl: 3600000, // 1 hour
        accessCount: 1,
      };
      this.cache.setCacheEntry(cacheKey, cacheEntry);

      // Record stats (CRDT counters)
      this.stats.recordRequest(true, latency, false);
      this.loadBalancer.recordRequest(edgeId);

      this.emit('inference:complete', result);
      return result;

    } catch (error) {
      const latency = performance.now() - startTime;
      this.stats.recordRequest(false, latency, false);
      this.emit('inference:error', { request, error });
      throw error;
    }
  }

  private selectOptimalEdge(modelId: string): string {
    // Get nodes that have this model
    const allNodes = this.nodeRegistry.getActiveNodes();
    const eligibleNodes = allNodes.filter(node => node.models.includes(modelId));

    if (eligibleNodes.length === 0) {
      throw new Error(`No nodes available for model ${modelId}`);
    }

    // CRDT load balancing
    const nodeIds = eligibleNodes.map(node => node.id);
    const optimalNode = this.loadBalancer.selectOptimalNode(nodeIds);

    return optimalNode || nodeIds[0];
  }

  private async performInference(request: InferenceRequest, edgeId: string): Promise<any> {
    // In production, this would route to the actual edge node
    // For demo, simulate inference
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50));

    if (typeof request.input === 'string') {
      return {
        text: `AI response for: ${request.input}`,
        tokens: request.input.length,
        model: request.modelId,
        edge: edgeId
      };
    } else {
      return {
        structured: request.input,
        processed: true,
        edge: edgeId
      };
    }
  }

  // ============================================================================
  // SYNC CRDT - CONVERGENCIA AUTOMÁTICA
  // ============================================================================

  /**
   * Merge state from another PRISM CRDT instance
   * Convergencia automática garantizada por propiedades CRDT
   */
  merge(other: PrismCRDT): void {
    // Merge all CRDT components
    this.modelRegistry.merge(other.modelRegistry);
    this.cache.merge(other.cache);
    this.loadBalancer.merge(other.loadBalancer);
    this.nodeRegistry.merge(other.nodeRegistry);
    this.stats.merge(other.stats);

    this.version = Math.max(this.version, other.version);
    this.emit('crdt:merged', { version: this.version });
  }

  /**
   * Get current CRDT state for serialization/sync
   */
  getCRDTState(): any {
    return {
      nodeId: this.nodeId,
      version: this.version,
      modelRegistry: this.modelRegistry.toJSON(),
      cache: this.cache.toJSON(),
      loadBalancer: {
        nodeLoads: Object.fromEntries(
          Array.from(this.loadBalancer['nodeLoads'].entries()).map(
            ([k, v]) => [k, v.toJSON()]
          )
        ),
        totalRequests: this.loadBalancer['totalRequests'].toJSON()
      },
      nodeRegistry: this.nodeRegistry.toJSON(),
      stats: {
        totalRequests: this.stats['totalRequests'].toJSON(),
        successfulRequests: this.stats['successfulRequests'].toJSON(),
        failedRequests: this.stats['failedRequests'].toJSON(),
        totalLatency: this.stats['totalLatency'].toJSON(),
        cacheHits: this.stats['cacheHits'].toJSON(),
        cacheMisses: this.stats['cacheMisses'].toJSON()
      }
    };
  }

  /**
   * Load CRDT state from serialized data
   */
  loadCRDTState(state: any): void {
    this.nodeId = state.nodeId;
    this.version = state.version;

    // Load CRDT components
    if (state.modelRegistry) {
      this.modelRegistry = ModelRegistryCRDT.fromJSON(state.modelRegistry);
    }
    if (state.cache) {
      this.cache = DistributedCacheCRDT.fromJSON(state.cache);
    }
    if (state.nodeRegistry) {
      this.nodeRegistry = NodeRegistryCRDT.fromJSON(state.nodeRegistry);
    }
    if (state.stats) {
      this.stats = InferenceStatsCRDT.fromJSON(state.stats);
    }

    this.emit('crdt:loaded', { version: this.version });
  }

  // ============================================================================
  // API DE ESTADÍSTICAS Y MONITORING
  // ============================================================================

  /**
   * Get comprehensive stats from CRDT counters
   */
  getStats(): {
    nodeId: string;
    version: number;
    models: number;
    cache: { entries: number; totalSize: number; hitRate: number };
    loadBalancer: Map<string, number>;
    inference: {
      totalRequests: number;
      successRate: number;
      averageLatency: number;
      cacheHitRate: number;
    };
    nodes: number;
  } {
    return {
      nodeId: this.nodeId,
      version: this.version,
      models: this.modelRegistry.getAllModels().size,
      cache: this.cache.getStats(),
      loadBalancer: this.loadBalancer.getLoadDistribution(),
      inference: this.stats.getStats(),
      nodes: this.nodeRegistry.getActiveNodes().length
    };
  }

  // ============================================================================
  // OFFLINE SUPPORT
  // ============================================================================

  /**
   * Queue request for offline processing
   * CRDT: Queue converge automáticamente
   */
  queueOfflineRequest(request: InferenceRequest): void {
    this.offlineQueue.queueRequest(request, this.nodeId);
    this.emit('request:queued', { request, reason: 'offline' });
  }

  /**
   * Process offline queue when back online
   */
  async processOfflineQueue(): Promise<void> {
    await this.offlineQueue.processQueue(async (request) => {
      try {
        await this.infer(request);
        this.emit('queue:processed', { request });
      } catch (error) {
        this.emit('queue:failed', { request, error });
      }
    });
  }
}

export default PrismCRDT;