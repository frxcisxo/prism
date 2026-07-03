import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { InferenceEngine, OnnxRuntimeWebRuntime } from './dist/inference.js';

const fixturePath = fileURLToPath(new URL('./test/fixtures/onnx/add-one.onnx', import.meta.url));
const expectedSha256 = 'b7d06325e6a907bdad72053370bc5d3501f599c89eb7e0c9577e556527e83eef';

const engine = new InferenceEngine({
  runtimes: [
    new OnnxRuntimeWebRuntime({
      executionProviders: ['wasm'],
      importOrt: () => import('onnxruntime-web'),
      readFile: async (path) => new Uint8Array(await readFile(path)),
    }),
  ],
});

await engine.loadModel({
  id: 'add-one-real',
  name: 'Add One Real ONNX',
  version: '1.0.0',
  format: 'onnx',
  size: 112,
  capabilities: ['numeric'],
  metadata: {
    modelPath: fixturePath,
    sha256: expectedSha256,
    expectedSize: 112,
  },
});

const result = await engine.infer(
  'add-one-real',
  {
    inputName: 'X',
    data: [41],
    dims: [1],
    type: 'float32',
  },
  { cache: false },
);

const outputs = result.raw?.outputs;
const value = Number(outputs?.Y?.data?.[0]);

if (value !== 42) {
  throw new Error(`Expected ONNX fixture to return 42, received ${value}`);
}

console.log('PRISM ONNX demo');
console.log('Runtime: onnxruntime-web');
console.log(`Model: ${fixturePath}`);
console.log(`SHA-256 verified: ${expectedSha256}`);
console.log(`Input: 41 -> Output: ${value}`);
