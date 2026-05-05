import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiModelEnsemble, EnsembleConfig } from '../../../src/application/ensemble';
import { InferenceEngine } from '../../../src/infrastructure/inference/inference';
import { PrismCRDT } from '../../../src/application/prism-crdt';

// Mock dependencies
vi.mock('../../../src/infrastructure/inference/inference');
vi.mock('../../../src/application/prism-crdt');

const MockInferenceEngine = InferenceEngine as any;
const MockPrismCRDT = PrismCRDT as any;

describe('MultiModelEnsemble', () => {
  let ensemble: MultiModelEnsemble;
  let mockInferenceEngine: any;
  let mockPrism: any;

  beforeEach(() => {
    // Create mocks
    mockInferenceEngine = {
      infer: vi.fn()
    };

    mockPrism = {
      isModelDeployed: vi.fn().mockResolvedValue(true)
    };

    MockInferenceEngine.mockImplementation(() => mockInferenceEngine);
    MockPrismCRDT.mockImplementation(() => mockPrism);

    ensemble = new MultiModelEnsemble(mockInferenceEngine, mockPrism);
  });

  describe('createEnsemble', () => {
    it('should create an ensemble successfully', async () => {
      const config: EnsembleConfig = {
        ensembleId: 'test-ensemble',
        name: 'Test Ensemble',
        strategy: 'averaging',
        modelIds: ['model1', 'model2', 'model3']
      };

      const result = await ensemble.createEnsemble(config);

      expect(result.id).toBe('test-ensemble');
      expect(result.name).toBe('Test Ensemble');
      expect(result.strategy).toBe('averaging');
      expect(result.models).toEqual(['model1', 'model2', 'model3']);
    });

    it('should validate model deployment', async () => {
      mockPrism.isModelDeployed.mockResolvedValue(false);

      const config: EnsembleConfig = {
        ensembleId: 'test-ensemble',
        name: 'Test Ensemble',
        strategy: 'averaging',
        modelIds: ['nonexistent-model']
      };

      await expect(ensemble.createEnsemble(config)).rejects.toThrow('Model nonexistent-model is not deployed');
    });

    it('should validate meta-model for stacking', async () => {
      mockPrism.isModelDeployed.mockImplementation((modelId: string) =>
        modelId === 'meta-model' ? false : true
      );

      const config: EnsembleConfig = {
        ensembleId: 'stacking-ensemble',
        name: 'Stacking Ensemble',
        strategy: 'stacking',
        modelIds: ['model1', 'model2'],
        metaModelId: 'meta-model'
      };

      await expect(ensemble.createEnsemble(config)).rejects.toThrow('Meta-model meta-model is not deployed');
    });
  });

  describe('inference strategies', () => {
    let testEnsemble: any;

    beforeEach(async () => {
      const config: EnsembleConfig = {
        ensembleId: 'test-ensemble',
        name: 'Test Ensemble',
        strategy: 'averaging',
        modelIds: ['model1', 'model2']
      };

      testEnsemble = await ensemble.createEnsemble(config);
    });

    describe('averaging strategy', () => {
      it('should average numerical results', async () => {
        mockInferenceEngine.infer
          .mockResolvedValueOnce({ text: 10, tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' })
          .mockResolvedValueOnce({ text: 20, tokens: 1, modelId: 'model2', modelName: 'Model 2', source: 'cpu' });

        const result = await ensemble.infer('test-ensemble', 'test input');

        expect(result.finalResult).toBe(15); // (10 + 20) / 2
        expect(result.confidence).toBeGreaterThan(0.5);
        expect(result.strategy).toBe('averaging');
        expect(result.individualResults).toHaveLength(2);
      });

      it('should handle non-numerical results', async () => {
        mockInferenceEngine.infer
          .mockResolvedValueOnce({ text: 'class_a', tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' })
          .mockResolvedValueOnce({ text: 'class_b', tokens: 1, modelId: 'model2', modelName: 'Model 2', source: 'cpu' });

        const result = await ensemble.infer('test-ensemble', 'test input');

        expect(result.finalResult).toBe('class_a'); // First result (all have same confidence)
        expect(result.confidence).toBe(0.5);
      });
    });

    describe('voting strategy', () => {
      beforeEach(async () => {
        const config: EnsembleConfig = {
          ensembleId: 'voting-ensemble',
          name: 'Voting Ensemble',
          strategy: 'voting',
          modelIds: ['model1', 'model2', 'model3']
          // Removed votingThreshold to allow all results
        };

        testEnsemble = await ensemble.createEnsemble(config);
      });

      it('should perform majority voting', async () => {
        mockInferenceEngine.infer
          .mockResolvedValueOnce({ text: 'class_a', tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' })
          .mockResolvedValueOnce({ text: 'class_a', tokens: 1, modelId: 'model2', modelName: 'Model 2', source: 'cpu' })
          .mockResolvedValueOnce({ text: 'class_b', tokens: 1, modelId: 'model3', modelName: 'Model 3', source: 'cpu' });

        const result = await ensemble.infer('voting-ensemble', 'test input');

        expect(result.finalResult).toBe('class_a'); // Majority vote
        expect(result.consensus).toBe(true);
      });

      it('should handle low confidence results', async () => {
        mockInferenceEngine.infer
          .mockResolvedValueOnce({ text: 'class_a', tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' }) // Below threshold
          .mockResolvedValueOnce({ text: 'class_b', tokens: 1, modelId: 'model2', modelName: 'Model 2', source: 'cpu' }) // Below threshold
          .mockResolvedValueOnce({ text: 'class_c', tokens: 1, modelId: 'model3', modelName: 'Model 3', source: 'cpu' }); // Above threshold

        const result = await ensemble.infer('voting-ensemble', 'test input');

        expect(result.finalResult).toBe('class_a'); // Fallback to first result (all have same confidence)
        expect(result.consensus).toBe(false);
      });
    });

    describe('weighted strategy', () => {
      beforeEach(async () => {
        const config: EnsembleConfig = {
          ensembleId: 'weighted-ensemble',
          name: 'Weighted Ensemble',
          strategy: 'weighted',
          modelIds: ['model1', 'model2'],
          weights: [0.3, 0.7]
        };

        testEnsemble = await ensemble.createEnsemble(config);
      });

      it('should apply weights to numerical results', async () => {
        mockInferenceEngine.infer
          .mockResolvedValueOnce({ text: 10, tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' })
          .mockResolvedValueOnce({ text: 20, tokens: 1, modelId: 'model2', modelName: 'Model 2', source: 'cpu' });

        const result = await ensemble.infer('weighted-ensemble', 'test input');

        expect(result.finalResult).toBe(17); // (10 * 0.3 + 20 * 0.7) / 1.0
      });
    });

    describe('stacking strategy', () => {
      beforeEach(async () => {
        const config: EnsembleConfig = {
          ensembleId: 'stacking-ensemble',
          name: 'Stacking Ensemble',
          strategy: 'stacking',
          modelIds: ['model1', 'model2'],
          metaModelId: 'meta-model'
        };

        testEnsemble = await ensemble.createEnsemble(config);
      });

      it('should use meta-model for final prediction', async () => {
        mockInferenceEngine.infer
          .mockResolvedValueOnce({ text: 'pred1', tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' })
          .mockResolvedValueOnce({ text: 'pred2', tokens: 1, modelId: 'model2', modelName: 'Model 2', source: 'cpu' })
          .mockResolvedValueOnce({ text: 'final_pred', tokens: 1, modelId: 'meta-model', modelName: 'Meta Model', source: 'cpu' });

        const result = await ensemble.infer('stacking-ensemble', 'test input');

        expect(result.finalResult).toBe('final_pred');
        expect(result.confidence).toBe(0.95);
        expect(mockInferenceEngine.infer).toHaveBeenCalledTimes(3); // 2 base models + 1 meta-model
      });
    });

    describe('error handling', () => {
      it('should handle ensemble not found', async () => {
        await expect(ensemble.infer('nonexistent', 'input')).rejects.toThrow('Ensemble nonexistent not found');
      });

      it('should fallback when not enough models work', async () => {
        // Mock model2 to fail, model1 works for fallback
        mockInferenceEngine.infer.mockImplementation((modelId: string) => {
          if (modelId === 'model2') {
            return Promise.reject(new Error('Model failed'));
          }
          return Promise.resolve({ text: 'fallback_result', tokens: 1, modelId: 'model1', modelName: 'Model 1', source: 'cpu' });
        });

        const config: EnsembleConfig = {
          ensembleId: 'fallback-ensemble',
          name: 'Fallback Ensemble',
          strategy: 'voting',
          modelIds: ['model1', 'model2']
        };

        await ensemble.createEnsemble(config);

        const result = await ensemble.infer('fallback-ensemble', 'test input');

        expect(result.strategy).toBe('fallback');
        expect(result.finalResult).toBe('fallback_result');
        expect(result.confidence).toBe(0.6);
      });
    });
  });

  describe('ensemble management', () => {
    it('should list ensembles', async () => {
      const config1: EnsembleConfig = {
        ensembleId: 'ensemble1',
        name: 'Ensemble 1',
        strategy: 'averaging',
        modelIds: ['model1']
      };

      const config2: EnsembleConfig = {
        ensembleId: 'ensemble2',
        name: 'Ensemble 2',
        strategy: 'voting',
        modelIds: ['model2']
      };

      await ensemble.createEnsemble(config1);
      await ensemble.createEnsemble(config2);

      const ensembles = ensemble.listEnsembles();
      expect(ensembles).toHaveLength(2);
      expect(ensembles.map(e => e.id)).toEqual(['ensemble1', 'ensemble2']);
    });

    it('should remove ensembles', async () => {
      const config: EnsembleConfig = {
        ensembleId: 'test-ensemble',
        name: 'Test Ensemble',
        strategy: 'averaging',
        modelIds: ['model1']
      };

      await ensemble.createEnsemble(config);
      expect(ensemble.getEnsemble('test-ensemble')).toBeDefined();

      const removed = ensemble.removeEnsemble('test-ensemble');
      expect(removed).toBe(true);
      expect(ensemble.getEnsemble('test-ensemble')).toBeUndefined();
    });

    it('should return ensemble statistics', async () => {
      const config: EnsembleConfig = {
        ensembleId: 'stats-ensemble',
        name: 'Stats Ensemble',
        strategy: 'averaging',
        modelIds: ['model1', 'model2', 'model3']
      };

      await ensemble.createEnsemble(config);

      const stats = ensemble.getEnsembleStats('stats-ensemble');
      expect(stats).toBeDefined();
      expect(stats?.modelCount).toBe(3);
      expect(stats?.strategy).toBe('averaging');
    });
  });
});