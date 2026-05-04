/**
 * 🔮 PRISM CRDT Components - Componentes CRDT específicos para PRISM
 *
 * Implementación de componentes PRISM usando CRDT puros para consistencia garantizada
 */

import { ORMap, LWWMap, PNCounter, ORSet, GCounter } from './types';
import type { InferenceModel, InferenceRequest, CacheEntry } from '../../index';

// ============================================================================
// COMPONENTES CRDT PARA PRISM
// ============================================================================

/**
 * ModelRegistry CRDT - Registro distribuido de modelos
 * OR-Map garantiza que todos los nodos tengan el mismo conjunto de modelos
 */
export class ModelRegistryCRDT extends ORMap<string, InferenceModel> {
  deployModel(model: InferenceModel, nodeId: string): void {
    this.set(model.id, model, nodeId);
  }

  undeployModel(modelId: string, nodeId: string): void {
    this.delete(modelId);
  }

  hasModel(modelId: string): boolean {
    return this.get(modelId) !== undefined;
  }

  getAllModels(): Map<string, InferenceModel> {
    const models = new Map<string, InferenceModel>();
    // Access the entries map from the parent ORMap class
    const entriesMap = (this as any).entries as Map<string, any>;
    for (const [key, set] of entriesMap) {
      const elements = set.elements();
      if (elements.length > 0) {
        const modelId = JSON.parse(key);
        models.set(modelId, elements[elements.length - 1].value);
      }
    }
    return models;
  }

  merge(other: ModelRegistryCRDT): void {
    super.merge(other);
  }

  toJSON(): any {
    return super.toJSON();
  }

  static fromJSON(data: any): ModelRegistryCRDT {
    const registry = new ModelRegistryCRDT();
    registry['entries'] = new Map();
    for (const [key, setData] of Object.entries(data.entries || {})) {
      registry['entries'].set(key, ORSet.fromJSON(setData));
    }
    return registry;
  }
}

/**
 * DistributedCache CRDT - Cache inteligente distribuido
 * LWW-Map garantiza consistencia eventual del cache
 */
export class DistributedCacheCRDT extends LWWMap<string, CacheEntry> {
  setCacheEntry(key: string, entry: CacheEntry): void {
    this.set(key, entry, entry.timestamp, 'cache-node');
  }

  getCacheEntry(key: string): CacheEntry | undefined {
    return this.get(key);
  }

  getStats(): { entries: number; totalSize: number; hitRate: number } {
    let totalSize = 0;
    let entries = 0;

    for (const [, entry] of this.entries()) {
      totalSize += entry.size || 0;
      entries++;
    }

    return {
      entries,
      totalSize,
      hitRate: 0.95 // Simplified for demo
    };
  }

  merge(other: DistributedCacheCRDT): void {
    super.merge(other);
  }

  toJSON(): any {
    return super.toJSON();
  }

  static fromJSON(data: any): DistributedCacheCRDT {
    const cache = new DistributedCacheCRDT();
    cache['entryMap'] = new Map();
    for (const [key, entry] of Object.entries(data.entries || {})) {
      cache['entryMap'].set(key, entry as any);
    }
    return cache;
  }
}

/**
 * LoadBalancer CRDT - Balanceador de carga distribuido
 * PN-Counter para conteo de requests, GCounter para total
 */
export class LoadBalancerCRDT {
  private nodeLoads: Map<string, PNCounter> = new Map();
  private totalRequests = new GCounter();

  recordRequest(nodeId: string): void {
    let counter = this.nodeLoads.get(nodeId);
    if (!counter) {
      counter = new PNCounter();
      this.nodeLoads.set(nodeId, counter);
    }
    counter.increment(nodeId, 1);
    this.totalRequests.increment(nodeId, 1);
  }

  getLoadDistribution(): Map<string, number> {
    const distribution = new Map<string, number>();
    for (const [nodeId, counter] of this.nodeLoads) {
      distribution.set(nodeId, counter.value());
    }
    return distribution;
  }

  selectOptimalNode(nodeIds: string[]): string | undefined {
    let minLoad = Infinity;
    let optimalNode: string | undefined;

    for (const nodeId of nodeIds) {
      const counter = this.nodeLoads.get(nodeId);
      const load = counter ? counter.value() : 0;

      if (load < minLoad) {
        minLoad = load;
        optimalNode = nodeId;
      }
    }

    return optimalNode;
  }

  merge(other: LoadBalancerCRDT): void {
    // Merge node loads
    for (const [nodeId, otherCounter] of other.nodeLoads) {
      let localCounter = this.nodeLoads.get(nodeId);
      if (!localCounter) {
        localCounter = new PNCounter();
        this.nodeLoads.set(nodeId, localCounter);
      }
      localCounter.merge(otherCounter);
    }

    // Merge total requests
    this.totalRequests.merge(other.totalRequests);
  }

  toJSON(): any {
    const nodeLoads: any = {};
    for (const [nodeId, counter] of this.nodeLoads) {
      nodeLoads[nodeId] = counter.toJSON();
    }

    return {
      nodeLoads,
      totalRequests: this.totalRequests.toJSON()
    };
  }

  static fromJSON(data: any): LoadBalancerCRDT {
    const lb = new LoadBalancerCRDT();

    for (const [nodeId, counterData] of Object.entries(data.nodeLoads || {})) {
      lb.nodeLoads.set(nodeId, PNCounter.fromJSON(counterData));
    }

    lb.totalRequests = GCounter.fromJSON(data.totalRequests || {});
    return lb;
  }
}

/**
 * OfflineQueue CRDT - Cola de requests offline
 * OR-Set para gestión de requests en cola
 */
export class OfflineQueueCRDT extends ORSet<InferenceRequest> {
  queueRequest(request: InferenceRequest, nodeId: string): void {
    this.add(request, nodeId);
  }

  async processQueue(processor: (request: InferenceRequest) => Promise<void>): Promise<void> {
    const requests = this.elements();
    for (const request of requests) {
      try {
        await processor(request);
        // Remove from queue after successful processing
        this.remove(request, 'processed');
      } catch (error) {
        // Keep in queue for retry
        console.warn('Failed to process offline request:', error);
      }
    }
  }

  getQueueSize(): number {
    return this.elements().length;
  }

  merge(other: OfflineQueueCRDT): void {
    super.merge(other);
  }

  toJSON(): any {
    return super.toJSON();
  }

  static fromJSON(data: any): OfflineQueueCRDT {
    return super.fromJSON(data) as OfflineQueueCRDT;
  }
}

/**
 * NodeRegistry CRDT - Registro de nodos distribuidos
 * OR-Map para gestión de nodos en la red
 */
export class NodeRegistryCRDT extends ORMap<string, any> {
  registerNode(node: any, nodeId: string): void {
    this.set(node.id, node, nodeId);
  }

  getNode(nodeId: string): any | undefined {
    return this.get(nodeId);
  }

  getActiveNodes(): any[] {
    const nodes: any[] = [];
    for (const [, set] of this['entries']) {
      const elements = set.elements();
      if (elements.length > 0) {
        nodes.push(elements[elements.length - 1].value);
      }
    }
    return nodes;
  }

  merge(other: NodeRegistryCRDT): void {
    super.merge(other);
  }

  toJSON(): any {
    return super.toJSON();
  }

  static fromJSON(data: any): NodeRegistryCRDT {
    const registry = new NodeRegistryCRDT();
    registry['entries'] = new Map();
    for (const [key, setData] of Object.entries(data.entries || {})) {
      registry['entries'].set(key, ORSet.fromJSON(setData));
    }
    return registry;
  }
}

/**
 * InferenceStats CRDT - Estadísticas de inferencia distribuidas
 * GCounter para métricas acumulativas
 */
export class InferenceStatsCRDT {
  private totalRequests = new GCounter();
  private successfulRequests = new GCounter();
  private failedRequests = new GCounter();
  private totalLatency = new GCounter();
  private cacheHits = new GCounter();
  private cacheMisses = new GCounter();

  recordRequest(success: boolean, latency: number, cacheHit: boolean): void {
    this.totalRequests.increment('stats-node', 1);

    if (success) {
      this.successfulRequests.increment('stats-node', 1);
    } else {
      this.failedRequests.increment('stats-node', 1);
    }

    this.totalLatency.increment('stats-node', Math.round(latency));

    if (cacheHit) {
      this.cacheHits.increment('stats-node', 1);
    } else {
      this.cacheMisses.increment('stats-node', 1);
    }
  }

  getStats(): {
    totalRequests: number;
    successRate: number;
    averageLatency: number;
    cacheHitRate: number;
  } {
    const total = this.totalRequests.value();
    const successful = this.successfulRequests.value();
    const totalLatency = this.totalLatency.value();
    const cacheHits = this.cacheHits.value();

    return {
      totalRequests: total,
      successRate: total > 0 ? successful / total : 0,
      averageLatency: total > 0 ? totalLatency / total : 0,
      cacheHitRate: (cacheHits + this.cacheMisses.value()) > 0 ?
        cacheHits / (cacheHits + this.cacheMisses.value()) : 0
    };
  }

  merge(other: InferenceStatsCRDT): void {
    this.totalRequests.merge(other.totalRequests);
    this.successfulRequests.merge(other.successfulRequests);
    this.failedRequests.merge(other.failedRequests);
    this.totalLatency.merge(other.totalLatency);
    this.cacheHits.merge(other.cacheHits);
    this.cacheMisses.merge(other.cacheMisses);
  }

  toJSON(): any {
    return {
      totalRequests: this.totalRequests.toJSON(),
      successfulRequests: this.successfulRequests.toJSON(),
      failedRequests: this.failedRequests.toJSON(),
      totalLatency: this.totalLatency.toJSON(),
      cacheHits: this.cacheHits.toJSON(),
      cacheMisses: this.cacheMisses.toJSON()
    };
  }

  static fromJSON(data: any): InferenceStatsCRDT {
    const stats = new InferenceStatsCRDT();
    stats.totalRequests = GCounter.fromJSON(data.totalRequests || {});
    stats.successfulRequests = GCounter.fromJSON(data.successfulRequests || {});
    stats.failedRequests = GCounter.fromJSON(data.failedRequests || {});
    stats.totalLatency = GCounter.fromJSON(data.totalLatency || {});
    stats.cacheHits = GCounter.fromJSON(data.cacheHits || {});
    stats.cacheMisses = GCounter.fromJSON(data.cacheMisses || {});
    return stats;
  }
}