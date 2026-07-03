import type { EdgeNode, InferenceModel } from '../index';

export interface EdgePlacementRequest {
  modelId: string;
  preferredRegion?: string;
  requireGPU?: boolean;
  requireWasm?: boolean;
  requireQuantization?: boolean;
  load?: Map<string, number> | Record<string, number>;
}

export interface EdgePlacementScore {
  nodeId: string;
  score: number;
  eligible: boolean;
  reasons: string[];
  penalties: string[];
  node: EdgeNode;
}

export interface EdgePlacementPlan {
  selectedNodeId?: string;
  scores: EdgePlacementScore[];
}

export interface EdgePlacementWeights {
  base?: number;
  modelAvailable?: number;
  gpu?: number;
  wasm?: number;
  quantization?: number;
  region?: number;
  loadPenalty?: number;
  offlinePenalty?: number;
}

const defaultWeights: Required<EdgePlacementWeights> = {
  base: 100,
  modelAvailable: 80,
  gpu: 24,
  wasm: 14,
  quantization: 14,
  region: 18,
  loadPenalty: 8,
  offlinePenalty: 1_000,
};

export class EdgePlacementPlanner {
  private weights: Required<EdgePlacementWeights>;

  constructor(weights: EdgePlacementWeights = {}) {
    this.weights = { ...defaultWeights, ...weights };
  }

  plan(
    nodes: EdgeNode[],
    model: InferenceModel | undefined,
    request: EdgePlacementRequest
  ): EdgePlacementPlan {
    const scores = nodes
      .map(node => this.scoreNode(node, model, request))
      .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
    const selected = scores.find(score => score.eligible);

    return {
      selectedNodeId: selected?.nodeId,
      scores,
    };
  }

  select(
    nodes: EdgeNode[],
    model: InferenceModel | undefined,
    request: EdgePlacementRequest
  ): string | undefined {
    return this.plan(nodes, model, request).selectedNodeId;
  }

  private scoreNode(
    node: EdgeNode,
    model: InferenceModel | undefined,
    request: EdgePlacementRequest
  ): EdgePlacementScore {
    const reasons: string[] = [];
    const penalties: string[] = [];
    let score = this.weights.base;
    let eligible = true;

    if (node.status !== 'online') {
      score -= this.weights.offlinePenalty;
      eligible = false;
      penalties.push(`status:${node.status}`);
    }

    if (!node.models.includes(request.modelId)) {
      eligible = false;
      penalties.push('model-missing');
    } else {
      score += this.weights.modelAvailable;
      reasons.push('model-available');
    }

    if (request.requireGPU && !node.capabilities.gpu) {
      eligible = false;
      penalties.push('gpu-required');
    } else if (node.capabilities.gpu) {
      score += this.weights.gpu;
      reasons.push('gpu');
    }

    if (request.requireWasm && !node.capabilities.wasm) {
      eligible = false;
      penalties.push('wasm-required');
    } else if (node.capabilities.wasm) {
      score += this.weights.wasm;
      reasons.push('wasm');
    }

    if (request.requireQuantization && !node.capabilities.quantization) {
      eligible = false;
      penalties.push('quantization-required');
    } else if (node.capabilities.quantization) {
      score += this.weights.quantization;
      reasons.push('quantization');
    } else if (model?.quantization) {
      penalties.push('quantization-unavailable');
    }

    if (request.preferredRegion && node.region === request.preferredRegion) {
      score += this.weights.region;
      reasons.push('preferred-region');
    }

    const load = this.getLoad(request.load, node.id) ?? node.loadScore ?? 0;
    if (load > 0) {
      score -= load * this.weights.loadPenalty;
      penalties.push(`load:${load}`);
    }

    return {
      nodeId: node.id,
      score,
      eligible,
      reasons,
      penalties,
      node,
    };
  }

  private getLoad(load: EdgePlacementRequest['load'], nodeId: string): number | undefined {
    if (!load) {
      return undefined;
    }
    if (load instanceof Map) {
      return load.get(nodeId);
    }
    return load[nodeId];
  }
}
