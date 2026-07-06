#!/usr/bin/env node

/**
 * PRISM packaged demo validation.
 *
 * This packs the current build, installs the tarball in a clean temporary
 * project, and verifies the demos exactly as an npm consumer would run them.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packageName = '@frxncisxo/prism';
const port = Number(process.env.PRISM_PACKAGED_VALIDATE_PORT || 5193);
const baseUrl = `http://127.0.0.1:${port}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`);
  }

  return result.stdout || '';
}

async function waitForServer(process, expectedUrl) {
  let output = '';

  process.stdout.on('data', chunk => {
    output += chunk.toString();
  });
  process.stderr.on('data', chunk => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (output.includes(expectedUrl)) {
      return () => output;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`visual console server did not start in time\n${output.trim()}`);
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

function assertPackagedVisual(data) {
  if (!data.deployed || !data.synced) {
    throw new Error('packaged visual console did not deploy and sync nodes');
  }
  if (data.sharding?.artifact !== 'PRISM') {
    throw new Error('packaged visual console did not verify sharded artifact');
  }
  if (
    data.resilience?.summary?.active !== 1
    || data.resilience?.health?.status !== 'degraded'
    || data.resilience?.second?.raw?.innerRuntime !== 'visual-fallback-runtime'
  ) {
    throw new Error('packaged visual console did not exercise resilient fallback');
  }
  if (!data.inference?.output?.text?.includes('Validate packaged PRISM visual console')) {
    throw new Error('packaged visual console did not use the provided prompt');
  }
}

console.log('PRISM packaged demo validation\n');

const workspace = process.cwd();
const installDir = await mkdtemp(join(tmpdir(), 'prism-packaged-'));
const cacheDir = await mkdtemp(join(tmpdir(), 'prism-npm-cache-'));
let tarballPath;
let server;

try {
  const packJson = run('npm', ['pack', '--json'], {
    cwd: workspace,
    capture: true,
  });
  const [packed] = JSON.parse(packJson);
  tarballPath = resolve(workspace, packed.filename);

  run('npm', ['init', '-y'], {
    cwd: installDir,
    capture: true,
  });
  run('npm', ['install', tarballPath], {
    cwd: installDir,
    env: {
      ...process.env,
      npm_config_cache: cacheDir,
    },
  });

  const packageDir = join(installDir, 'node_modules', ...packageName.split('/'));
  const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));

  for (const file of [
    'demo.js',
    'demo-onnx.js',
    'examples/visual-console/server.js',
    'examples/visual-console/index.html',
    'examples/visual-console/main.js',
    'examples/visual-console/styles.css',
    'test/fixtures/onnx/add-one.onnx',
  ]) {
    if (!packageJson.files.some(entry => file === entry || file.startsWith(`${entry}/`))) {
      throw new Error(`packaged demo file is not covered by package files: ${file}`);
    }
    await readFile(join(packageDir, file));
  }

  run('npm', ['run', 'demo'], { cwd: packageDir });
  console.log('OK packaged vertical slice demo');

  run('npm', ['run', 'demo:onnx'], { cwd: packageDir });
  console.log('OK packaged ONNX demo');

  server = spawn(process.execPath, ['examples/visual-console/server.js'], {
    cwd: packageDir,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server, baseUrl);
  const html = await fetch(baseUrl).then(response => response.text());
  if (!html.includes('data-preset="retail"') || !html.includes('data-preset="clinic"')) {
    throw new Error('packaged visual console did not include use-case presets');
  }
  const scenario = await postJson('/api/scenario', {
    prompt: 'Validate packaged PRISM visual console.',
  });
  assertPackagedVisual(scenario);
  console.log('OK packaged visual console demo');

  console.log('\nAll packaged demo checks passed.');
} catch (error) {
  console.error('FAIL packaged demo:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill('SIGTERM');
  }
  if (tarballPath) {
    await rm(tarballPath, { force: true });
  }
  await rm(installDir, { recursive: true, force: true });
  await rm(cacheDir, { recursive: true, force: true });
}
