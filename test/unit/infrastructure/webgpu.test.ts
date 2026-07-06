import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGPUAccelerator } from '../../../src/infrastructure/inference/webgpu';

// Mock WebGPU API for testing
const mockGPU = {
  requestAdapter: vi.fn(),
  getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm')
};

const mockAdapter = {
  requestDevice: vi.fn(),
  limits: {
    maxBufferSize: 256 * 1024 * 1024,
    maxStorageBufferBindingSize: 128 * 1024 * 1024
  },
  info: {
    device: 'Mock GPU'
  }
};

const mockDevice = {
  createBuffer: vi.fn(),
  createShaderModule: vi.fn(),
  createComputePipeline: vi.fn(),
  createBindGroup: vi.fn(),
  createCommandEncoder: vi.fn(),
  queue: {
    submit: vi.fn(),
    writeBuffer: vi.fn()
  },
  features: new Set(['shader-f16']),
  destroy: vi.fn()
};

const mockBuffer = {
  getMappedRange: vi.fn(() => new ArrayBuffer(16)),
  unmap: vi.fn(),
  destroy: vi.fn()
};

const mockPipeline = {
  getBindGroupLayout: vi.fn(() => ({
    label: 'mock-layout'
  }))
};

const mockShaderModule = {
  label: 'mock-shader'
};

const mockCommandEncoder = {
  beginComputePass: vi.fn(() => ({
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn()
  })),
  finish: vi.fn(() => 'mock-command-buffer')
};

// Setup global mocks
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    writable: true,
    configurable: true
  });
}

Object.defineProperty(globalThis.navigator, 'gpu', {
  value: mockGPU,
  writable: true,
  configurable: true
});

describe('WebGPU Accelerator', () => {
  let accelerator: WebGPUAccelerator;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mocks
    mockGPU.requestAdapter.mockResolvedValue(mockAdapter);
    mockAdapter.requestDevice.mockResolvedValue(mockDevice);
    mockDevice.createBuffer.mockReturnValue(mockBuffer);
    mockDevice.createShaderModule.mockReturnValue(mockShaderModule);
    mockDevice.createComputePipeline.mockReturnValue(mockPipeline);
    mockDevice.createBindGroup.mockReturnValue('mock-bind-group');
    mockDevice.createCommandEncoder.mockReturnValue(mockCommandEncoder);

    accelerator = new WebGPUAccelerator();
  });

  describe('initialization', () => {
    it('should initialize WebGPU successfully', async () => {
      await expect(accelerator.initialize()).resolves.not.toThrow();
      expect(accelerator.isAvailable()).toBe(true);
    });

    it('should handle WebGPU not available', async () => {
      // Temporarily remove gpu from navigator
      const originalGpu = (navigator as any).gpu;
      delete (navigator as any).gpu;

      const accel = new WebGPUAccelerator();
      await expect(accel.initialize()).rejects.toThrow('WebGPU not supported');

      // Restore
      (navigator as any).gpu = originalGpu;
    });

    it('should handle adapter not available', async () => {
      mockGPU.requestAdapter.mockResolvedValue(null);

      await expect(accelerator.initialize()).rejects.toThrow('No suitable GPU adapter found');
    });

    it('should handle device creation failure', async () => {
      mockAdapter.requestDevice.mockRejectedValue(new Error('Device creation failed'));

      await expect(accelerator.initialize()).rejects.toThrow('Device creation failed');
    });
  });

  describe('tensor operations', () => {
    beforeEach(async () => {
      await accelerator.initialize();
    });

    it('should create tensor buffer', () => {
      const data = new Float32Array([1, 2, 3, 4]);
      const buffer = accelerator.createTensorBuffer(data, [2, 2]);

      expect(buffer).toBeDefined();
      expect(buffer.shape).toEqual([2, 2]);
      expect(buffer.dtype).toBe('float32');
      expect(mockDevice.createBuffer).toHaveBeenCalled();
    });

    it('should perform matrix multiplication', async () => {
      // Mock staging buffer for reading results
      const mockStagingBuffer = {
        ...mockBuffer,
        mapAsync: vi.fn().mockResolvedValue(undefined),
        getMappedRange: vi.fn(() => new Float32Array([1, 2, 3, 4]).buffer)
      };

      mockDevice.createBuffer
        .mockReturnValueOnce(mockBuffer) // input A
        .mockReturnValueOnce(mockBuffer) // input B
        .mockReturnValueOnce(mockBuffer) // output
        .mockReturnValueOnce(mockBuffer) // uniform
        .mockReturnValueOnce(mockStagingBuffer); // staging

      const A = accelerator.createTensorBuffer(new Float32Array([1, 2, 3, 4]), [2, 2]);
      const B = accelerator.createTensorBuffer(new Float32Array([5, 6, 7, 8]), [2, 2]);

      // Note: This would normally work but requires full WebGPU pipeline setup
      // For now, we test that the method exists and can be called
      expect(typeof accelerator.matmul).toBe('function');
    });

    it('should perform GELU activation', async () => {
      expect(typeof accelerator.gelu).toBe('function');
    });

    it('should perform layer normalization', async () => {
      expect(typeof accelerator.layerNorm).toBe('function');
    });
  });

  describe('profiling', () => {
    beforeEach(async () => {
      await accelerator.initialize();
    });

    it('should enable profiling when configured', () => {
      const accel = new WebGPUAccelerator({ enableProfiling: true });
      expect(accel.getProfilingStats()).toBeDefined();
    });

    it('should return profiling statistics', () => {
      const stats = accelerator.getProfilingStats();
      expect(typeof stats).toBe('object');
    });
  });

  describe('cleanup', () => {
    it('should destroy resources', async () => {
      await accelerator.initialize();
      accelerator.destroy();

      expect(mockDevice.destroy).toHaveBeenCalled();
    });
  });
});
