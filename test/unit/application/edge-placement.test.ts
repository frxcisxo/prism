import { describe, expect, it } from 'vitest';
import { EdgePlacementPlanner } from '../../../src/application/edge-placement';
import type { EdgeNode, InferenceModel } from '../../../src';

describe('EdgePlacementPlanner', () => {
  const model: InferenceModel = {
    id: 'planner-model',
    name: 'Planner Model',
    size: 1000,
    format: 'onnx',
    quantization: 'int8',
    capabilities: ['planning'],
  };

  const nodes: EdgeNode[] = [
    {
      id: 'gpu-near',
      name: 'GPU Near',
      region: 'us-east',
      capabilities: { gpu: true, wasm: true, quantization: true },
      models: ['planner-model'],
      status: 'online',
      lastHeartbeat: 1,
      loadScore: 1,
    },
    {
      id: 'cpu-far',
      name: 'CPU Far',
      region: 'eu-west',
      capabilities: { gpu: false, wasm: true, quantization: true },
      models: ['planner-model'],
      status: 'online',
      lastHeartbeat: 1,
      loadScore: 0,
    },
    {
      id: 'missing-model',
      name: 'Missing Model',
      region: 'us-east',
      capabilities: { gpu: true, wasm: true, quantization: true },
      models: [],
      status: 'online',
      lastHeartbeat: 1,
      loadScore: 0,
    },
  ];

  it('should select the highest scoring eligible node and explain the decision', () => {
    const planner = new EdgePlacementPlanner();
    const plan = planner.plan(nodes, model, {
      modelId: 'planner-model',
      preferredRegion: 'us-east',
      load: { 'gpu-near': 1, 'cpu-far': 0 },
    });

    expect(plan.selectedNodeId).toBe('gpu-near');
    expect(plan.scores[0]).toMatchObject({
      nodeId: 'gpu-near',
      eligible: true,
      reasons: expect.arrayContaining(['model-available', 'gpu', 'wasm', 'quantization', 'preferred-region']),
      penalties: expect.arrayContaining(['load:1']),
    });
    expect(plan.scores.find(score => score.nodeId === 'missing-model')).toMatchObject({
      eligible: false,
      penalties: expect.arrayContaining(['model-missing']),
    });
  });

  it('should enforce explicit capability requirements', () => {
    const planner = new EdgePlacementPlanner();
    const plan = planner.plan(nodes, model, {
      modelId: 'planner-model',
      requireGPU: true,
      requireWasm: true,
      requireQuantization: true,
    });

    expect(plan.selectedNodeId).toBe('gpu-near');
    expect(plan.scores.find(score => score.nodeId === 'cpu-far')).toMatchObject({
      eligible: false,
      penalties: expect.arrayContaining(['gpu-required']),
    });
  });

  it('should return no selected node when all candidates are ineligible', () => {
    const planner = new EdgePlacementPlanner();
    const plan = planner.plan(nodes.map(node => ({ ...node, status: 'offline' as const })), model, {
      modelId: 'planner-model',
    });

    expect(plan.selectedNodeId).toBeUndefined();
    expect(plan.scores.every(score => !score.eligible)).toBe(true);
  });
});
