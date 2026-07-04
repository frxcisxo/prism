#!/usr/bin/env node

/**
 * PRISM visual console smoke validation.
 *
 * This starts the local example server after `npm run build` and verifies that
 * the browser-facing API exercises the compiled package end to end.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';

const port = Number(process.env.PRISM_VISUAL_VALIDATE_PORT || 5191);
const baseUrl = `http://127.0.0.1:${port}`;
const prompt = 'Validate resilient visual console.';
const server = spawn(process.execPath, ['examples/visual-console/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';

server.stdout.on('data', chunk => {
  output += chunk.toString();
});
server.stderr.on('data', chunk => {
  output += chunk.toString();
});

function fail(label, error) {
  console.error(`FAIL ${label}:`, error instanceof Error ? error.message : error);
  if (output.trim()) {
    console.error('\nServer output:\n', output.trim());
  }
  process.exitCode = 1;
}

async function waitForServer() {
  const started = once(server.stdout, 'data');
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('visual console server did not start in time')), 5_000);
  });

  await Promise.race([started, timeout]);

  if (!output.includes(baseUrl)) {
    throw new Error(`visual console started with unexpected output: ${output.trim()}`);
  }
}

async function postJson(path, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  return response.json();
}

function assertScenario(data) {
  if (!data.deployed || !data.synced) {
    throw new Error('scenario did not deploy and sync both edge nodes');
  }
  if (data.inference?.edgeStatus !== 200 || data.inference?.cached !== false) {
    throw new Error('scenario did not route the first inference through the edge adapter');
  }
  if (data.sharding?.artifact !== 'PRISM' || data.sharding?.manifest?.shardCount !== 2) {
    throw new Error('scenario did not verify and combine model shards');
  }
  if (data.diagnostics?.status !== 'ready' || data.diagnostics?.models?.[0]?.runtime !== 'simulated') {
    throw new Error('scenario did not expose ready runtime diagnostics');
  }
  if (
    data.resilience?.health?.status !== 'degraded'
    || data.resilience?.health?.statusCode !== 206
    || data.resilience?.summary?.active !== 1
    || data.resilience?.alertStates?.[0]?.status !== 'active'
    || data.resilience?.report?.totals?.fallbackSuccesses !== 2
    || data.resilience?.report?.totals?.primarySkipped !== 1
    || data.resilience?.second?.raw?.innerRuntime !== 'visual-fallback-runtime'
    || !data.resilience?.metricsPreview?.includes('prism_resilient_runtime_health_status{status="degraded"} 1')
  ) {
    throw new Error('scenario did not expose resilient fallback health, alerts, and metrics');
  }
}

function assertRepeat(data) {
  if (data.inference?.cached !== true) {
    throw new Error('repeat inference did not hit the CRDT cache');
  }
  if ((data.resilience?.report?.totals?.fallbackSuccesses || 0) < 4) {
    throw new Error('repeat inference did not keep exercising resilient fallback');
  }
}

console.log('PRISM visual console validation\n');

try {
  await Promise.all([
    access('demo.js'),
    access('demo-onnx.js'),
    access('examples/visual-console/server.js'),
    access('examples/visual-console/index.html'),
    access('examples/visual-console/main.js'),
    access('examples/visual-console/styles.css'),
    access('test/fixtures/onnx/add-one.onnx'),
  ]);

  await waitForServer();

  const html = await fetch(baseUrl).then(response => response.text());
  if (!html.includes('Resilient Runtime') || !html.includes('Runtime Diagnostics')) {
    throw new Error('visual console HTML is missing expected panels');
  }

  const scenario = await postJson('/api/scenario', { prompt });
  assertScenario(scenario);
  console.log('OK visual scenario resilient runtime');

  const repeat = await postJson('/api/repeat', { prompt });
  assertRepeat(repeat);
  console.log('OK visual repeat cache and fallback');

  const reset = await postJson('/api/reset');
  if (reset.deployed || reset.synced || reset.resilience !== null) {
    throw new Error('visual reset did not clear scenario state');
  }
  console.log('OK visual reset state');

  console.log('\nAll visual console checks passed.');
} catch (error) {
  fail('visual console', error);
} finally {
  server.kill('SIGTERM');
}
