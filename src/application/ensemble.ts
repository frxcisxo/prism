/**
 * 🔮 PRISM Multi-Model Ensemble
 *
 * Combines multiple ML models for improved accuracy, robustness, and reliability.
 * Supports various ensemble strategies: voting, averaging, stacking, and boosting.
 */

import { InferenceEngine } from '../infrastructure/inference/inference';
import { PrismCRDT } from './prism-crdt';

export interface EnsembleModel {
  id: string;
  name: string;
  models: string[]; // Model IDs in the ensemble
  strategy: 'voting' | 'averaging' | 'weighted' | 'stacking' | 'boosting';
  weights?: number[]; // For weighted averaging
  metaModel?: string; // For stacking (meta-model ID)
  threshold?: number; // For voting (confidence threshold)
}

export interface EnsembleConfig {
  ensembleId: string;
  name: string;
  strategy: EnsembleModel['strategy'];
  modelIds: string[];
  weights?: number[];
  metaModelId?: string;
  votingThreshold?: number;
  enableFallback?: boolean; // Fallback to best single model if ensemble fails
}

export interface EnsembleResult {
  ensembleId: string;
  strategy: string;
  individualResults: Array<{
    modelId: string;
    result: any;
    confidence: number;
    latency: number;
  }>;
  finalResult: any;
  confidence: number;
  latency: number;
  consensus?: boolean; // For voting strategies
}

/**
 * 🎯 Multi-Model Ensemble Manager
 *
 * Orchestrates multiple models to produce better predictions through ensemble methods.
 */
export class MultiModelEnsemble {
  private ensembles = new Map<string, EnsembleModel>();
  private inferenceEngine: InferenceEngine;
  private prism: PrismCRDT;

  constructor(inferenceEngine: InferenceEngine, prism: PrismCRDT) {
    this.inferenceEngine = inferenceEngine;
    this.prism = prism;
  }

  /**
   * Create a new model ensemble
   */
  async createEnsemble(config: EnsembleConfig): Promise<EnsembleModel> {
    // Validate that all models exist
    for (const modelId of config.modelIds) {
      if (!await this.prism.isModelDeployed(modelId)) {
        throw new Error(`Model ${modelId} is not deployed`);
      }
    }

    // Validate meta-model for stacking
    if (config.strategy === 'stacking' && config.metaModelId) {
      if (!await this.prism.isModelDeployed(config.metaModelId)) {
        throw new Error(`Meta-model ${config.metaModelId} is not deployed`);
      }
    }

    const ensemble: EnsembleModel = {
      id: config.ensembleId,
      name: config.name,
      models: config.modelIds,
      strategy: config.strategy,
      weights: config.weights,
      metaModel: config.metaModelId,
      threshold: config.votingThreshold || 0.5
    };

    this.ensembles.set(ensemble.id, ensemble);
    console.log(`[PRISM] Created ensemble ${ensemble.id} with ${ensemble.models.length} models using ${ensemble.strategy} strategy`);

    return ensemble;
  }

  /**
   * Run inference using an ensemble
   */
  async infer(ensembleId: string, input: any, _options?: { timeout?: number }): Promise<EnsembleResult> {
    const ensemble = this.ensembles.get(ensembleId);
    if (!ensemble) {
      throw new Error(`Ensemble ${ensembleId} not found`);
    }

    const startTime = performance.now();
    const individualResults: EnsembleResult['individualResults'] = [];

    try {
      // Run inference on all models in parallel
      const inferencePromises = ensemble.models.map(async (modelId) => {
        const modelStartTime = performance.now();
        try {
          const result = await this.inferenceEngine.infer(modelId, input); // Remove options
          const latency = performance.now() - modelStartTime;

          return {
            modelId,
            result: result.text, // Use .text as main output
            confidence: 0.5, // Default confidence (no .confidence field)
            latency
          };
        } catch (error) {
          console.warn(`[PRISM] Model ${modelId} failed:`, error);
          return {
            modelId,
            result: null,
            confidence: 0,
            latency: performance.now() - modelStartTime,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      const results = await Promise.all(inferencePromises);
      individualResults.push(...results.filter(r => r.result !== null));

      // If we don't have enough valid results for ensemble (less than 2), fallback to single model
      if (individualResults.length < 2) {
        throw new Error('Not enough valid models for ensemble, falling back to single model');
      }

      // Apply ensemble strategy
      const finalResult = await this.applyEnsembleStrategy(ensemble, individualResults, input);
      const totalLatency = performance.now() - startTime;

      return {
        ensembleId,
        strategy: ensemble.strategy,
        individualResults,
        finalResult: finalResult.result,
        confidence: finalResult.confidence,
        latency: totalLatency,
        consensus: finalResult.consensus
      };

    } catch (error) {
      // Fallback to best single model if enabled
      if (ensemble.strategy !== 'voting' || !ensemble.models[0]) {
        throw error;
      }

      console.warn(`[PRISM] Ensemble failed, falling back to single model`);
      const fallbackResult = await this.inferenceEngine.infer(ensemble.models[0], input); // Remove options

      return {
        ensembleId,
        strategy: 'fallback',
        individualResults,
        finalResult: fallbackResult.text, // Use .text as main output
        confidence: 0.6, // Lower confidence for fallback
        latency: performance.now() - startTime
      };
    }
  }

  /**
   * Apply ensemble strategy to combine results
   */
  private async applyEnsembleStrategy(
    ensemble: EnsembleModel,
    results: EnsembleResult['individualResults'],
    originalInput: any
  ): Promise<{ result: any; confidence: number; consensus?: boolean }> {

    switch (ensemble.strategy) {
      case 'voting':
        return this.applyVotingStrategy(ensemble, results);

      case 'averaging':
        return this.applyAveragingStrategy(ensemble, results);

      case 'weighted':
        return this.applyWeightedStrategy(ensemble, results);

      case 'stacking':
        return await this.applyStackingStrategy(ensemble, results, originalInput);

      case 'boosting':
        return this.applyBoostingStrategy(ensemble, results);

      default:
        throw new Error(`Unknown ensemble strategy: ${ensemble.strategy}`);
    }
  }

  /**
   * Voting strategy: Majority vote for classification, average for regression
   */
  private applyVotingStrategy(ensemble: EnsembleModel, results: EnsembleResult['individualResults']): { result: any; confidence: number; consensus: boolean } {
    const validResults = results.filter(r => r.confidence >= (ensemble.threshold || 0.5));

    if (validResults.length === 0) {
      // Fallback to highest confidence result
      const bestResult = results.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );
      return {
        result: bestResult.result,
        confidence: bestResult.confidence * 0.5, // Penalize low confidence
        consensus: false
      };
    }

    // For simplicity, assume classification task - take majority vote
    // In production, this would need to be more sophisticated
    const resultCounts = new Map<any, number>();
    for (const result of validResults) {
      resultCounts.set(result.result, (resultCounts.get(result.result) || 0) + 1);
    }

    let maxCount = 0;
    let majorityResult: any = null;
    for (const [result, count] of resultCounts) {
      if (count > maxCount) {
        maxCount = count;
        majorityResult = result;
      }
    }

    // Consensus requires majority (more than half) and at least 2 votes
    const consensus = validResults.length >= 2 && maxCount > validResults.length / 2;
    const confidence = consensus ? maxCount / validResults.length : maxCount / validResults.length * 0.7;

    return {
      result: majorityResult,
      confidence,
      consensus
    };
  }

  /**
   * Averaging strategy: Average predictions across all models
   */
  private applyAveragingStrategy(_ensemble: EnsembleModel, results: EnsembleResult['individualResults']): { result: any; confidence: number } {
    // For numerical outputs, average them
    if (typeof results[0].result === 'number') {
      const values = results.map(r => r.result as number);
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;

      // Confidence based on variance (lower variance = higher confidence)
      const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      const confidence = Math.max(0.1, Math.min(1.0, 1.0 - stdDev / Math.abs(avg || 1)));

      return { result: avg, confidence };
    }

    // For non-numerical, return the result with highest confidence
    const bestResult = results.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    return {
      result: bestResult.result,
      confidence: bestResult.confidence
    };
  }

  /**
   * Weighted averaging strategy
   */
  private applyWeightedStrategy(ensemble: EnsembleModel, results: EnsembleResult['individualResults']): { result: any; confidence: number } {
    if (!ensemble.weights || ensemble.weights.length !== results.length) {
      throw new Error('Weights must be provided for all models in weighted strategy');
    }

    // For numerical outputs
    if (typeof results[0].result === 'number') {
      let weightedSum = 0;
      let totalWeight = 0;

      for (let i = 0; i < results.length; i++) {
        weightedSum += (results[i].result as number) * ensemble.weights[i];
        totalWeight += ensemble.weights[i];
      }

      const avg = weightedSum / totalWeight;

      // Confidence based on weighted variance
      let variance = 0;
      for (let i = 0; i < results.length; i++) {
        variance += Math.pow((results[i].result as number) - avg, 2) * ensemble.weights[i];
      }
      variance /= totalWeight;

      const stdDev = Math.sqrt(variance);
      const confidence = Math.max(0.1, Math.min(1.0, 1.0 - stdDev / Math.abs(avg || 1)));

      return { result: avg, confidence };
    }

    // For non-numerical, weight by confidence
    let bestResult = results[0];
    let bestScore = results[0].confidence * (ensemble.weights[0] || 1);

    for (let i = 1; i < results.length; i++) {
      const score = results[i].confidence * (ensemble.weights[i] || 1);
      if (score > bestScore) {
        bestScore = score;
        bestResult = results[i];
      }
    }

    return {
      result: bestResult.result,
      confidence: bestScore
    };
  }

  /**
   * Stacking strategy: Use a meta-model to combine predictions
   */
  private async applyStackingStrategy(
    ensemble: EnsembleModel,
    results: EnsembleResult['individualResults'],
    originalInput: any
  ): Promise<{ result: any; confidence: number }> {
    if (!ensemble.metaModel) {
      throw new Error('Meta-model required for stacking strategy');
    }

    // Prepare input for meta-model: combine original input with model predictions
    const metaInput = {
      original: originalInput,
      predictions: results.map(r => ({
        modelId: r.modelId,
        prediction: r.result,
        confidence: r.confidence
      }))
    };

    try {
      const metaResult = await this.inferenceEngine.infer(ensemble.metaModel, metaInput);
      return {
        result: metaResult.text, // Use .text as main output
        confidence: 0.95 // High confidence for meta-model predictions
      };
    } catch (error) {
      console.warn('[PRISM] Meta-model failed, falling back to averaging');
      return this.applyAveragingStrategy(ensemble, results);
    }
  }

  /**
   * Boosting strategy: Weight models based on their historical performance
   */
  private applyBoostingStrategy(_ensemble: EnsembleModel, results: EnsembleResult['individualResults']): { result: any; confidence: number } {
    // Simplified boosting: weight by inverse of error rate
    // In production, this would use actual historical performance data

    const weights = results.map(r => Math.max(0.1, r.confidence));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (typeof results[0].result === 'number') {
      let weightedSum = 0;
      for (let i = 0; i < results.length; i++) {
        weightedSum += (results[i].result as number) * weights[i];
      }

      return {
        result: weightedSum / totalWeight,
        confidence: 0.9 // Boosting typically has high confidence
      };
    }

    // For non-numerical, pick highest weighted result
    let bestResult = results[0];
    let bestWeight = weights[0];

    for (let i = 1; i < results.length; i++) {
      if (weights[i] > bestWeight) {
        bestWeight = weights[i];
        bestResult = results[i];
      }
    }

    return {
      result: bestResult.result,
      confidence: 0.9
    };
  }

  /**
   * Get ensemble information
   */
  getEnsemble(ensembleId: string): EnsembleModel | undefined {
    return this.ensembles.get(ensembleId);
  }

  /**
   * List all ensembles
   */
  listEnsembles(): EnsembleModel[] {
    return Array.from(this.ensembles.values());
  }

  /**
   * Remove an ensemble
   */
  removeEnsemble(ensembleId: string): boolean {
    return this.ensembles.delete(ensembleId);
  }

  /**
   * Get ensemble performance statistics
   */
  getEnsembleStats(ensembleId: string): {
    modelCount: number;
    strategy: string;
    avgLatency: number;
    avgConfidence: number;
  } | null {
    const ensemble = this.ensembles.get(ensembleId);
    if (!ensemble) return null;

    // In production, this would track actual performance metrics
    return {
      modelCount: ensemble.models.length,
      strategy: ensemble.strategy,
      avgLatency: 50, // Placeholder
      avgConfidence: 0.85 // Placeholder
    };
  }
}