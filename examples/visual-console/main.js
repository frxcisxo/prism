const state = {
  events: [],
};

const els = {
  networkStatus: document.querySelector('#networkStatus'),
  syncState: document.querySelector('#syncState'),
  syncLine: document.querySelector('#syncLine'),
  northNode: document.querySelector('#northNode'),
  southNode: document.querySelector('#southNode'),
  northLoad: document.querySelector('#northLoad'),
  southLoad: document.querySelector('#southLoad'),
  modelStatus: document.querySelector('#modelStatus'),
  modelCount: document.querySelector('#modelCount'),
  cacheBadge: document.querySelector('#cacheBadge'),
  promptInput: document.querySelector('#promptInput'),
  inferenceOutput: document.querySelector('#inferenceOutput'),
  shardStatus: document.querySelector('#shardStatus'),
  shardA: document.querySelector('#shardA'),
  shardB: document.querySelector('#shardB'),
  shardOutput: document.querySelector('#shardOutput'),
  diagnosticStatus: document.querySelector('#diagnosticStatus'),
  runtimeCount: document.querySelector('#runtimeCount'),
  cacheEntries: document.querySelector('#cacheEntries'),
  hitRate: document.querySelector('#hitRate'),
  diagnosticOutput: document.querySelector('#diagnosticOutput'),
  timeline: document.querySelector('#timeline'),
  eventCount: document.querySelector('#eventCount'),
  runScenario: document.querySelector('#runScenario'),
  repeatInference: document.querySelector('#repeatInference'),
  resetDemo: document.querySelector('#resetDemo'),
};

function resetState() {
  state.events = [];
  els.networkStatus.textContent = 'Ready';
  els.syncState.textContent = 'Not synced';
  els.syncLine.classList.remove('synced');
  els.northNode.classList.remove('active');
  els.southNode.classList.remove('active');
  els.northLoad.style.width = '14%';
  els.southLoad.style.width = '10%';
  els.modelStatus.textContent = 'Empty';
  els.modelCount.textContent = '0';
  els.cacheBadge.textContent = 'Cold';
  els.inferenceOutput.textContent = 'Run the scenario to route the first request.';
  els.shardStatus.textContent = 'Waiting';
  els.shardA.classList.remove('verified');
  els.shardB.classList.remove('verified');
  els.shardOutput.textContent = 'Two verified byte shards will combine into one artifact.';
  els.diagnosticStatus.textContent = 'Idle';
  els.runtimeCount.textContent = '0';
  els.cacheEntries.textContent = '0';
  els.hitRate.textContent = '0%';
  els.diagnosticOutput.textContent = 'Engine diagnostics will appear after the scenario runs.';
  renderEvents();
}

function addEvent(message) {
  state.events.unshift(`${new Date().toLocaleTimeString()} · ${message}`);
  state.events = state.events.slice(0, 8);
  renderEvents();
}

function renderEvents() {
  els.timeline.innerHTML = state.events.map(event => `<li>${event}</li>`).join('');
  els.eventCount.textContent = `${state.events.length} event${state.events.length === 1 ? '' : 's'}`;
}

async function runScenario() {
  els.runScenario.disabled = true;
  els.networkStatus.textContent = 'Running';

  const data = await postJson('/api/scenario', { prompt: els.promptInput.value.trim() });
  renderState(data);
  els.networkStatus.textContent = 'Healthy';
  els.runScenario.disabled = false;
}

async function repeatInference() {
  const data = await postJson('/api/repeat', { prompt: els.promptInput.value.trim() });
  renderState(data);
}

function renderState(data) {
  state.events = data.events || [];
  els.northNode.classList.toggle('active', data.northStats?.nodes > 0);
  els.southNode.classList.toggle('active', data.southStats?.nodes > 0);
  els.syncState.textContent = data.synced ? 'Converged' : 'Not synced';
  els.syncLine.classList.toggle('synced', data.synced);
  els.modelStatus.textContent = data.deployed ? 'Visible on both' : 'Empty';
  els.modelCount.textContent = String(data.southStats?.models || 0);

  if (data.inference) {
    els.cacheBadge.textContent = data.inference.cached ? 'Cache hit' : 'Cache miss';
    els.northLoad.style.width = data.inference.cached ? '24%' : '58%';
    els.southLoad.style.width = data.inference.cached ? '18%' : '32%';
    const engineCache = data.inference.engine?.cached ? 'engine cache hit' : 'engine cache miss';
    els.inferenceOutput.textContent = `${data.inference.cached ? 'Served from distributed cache' : `Routed to ${data.inference.edgeId}`}. Latency: ${data.inference.latency.toFixed(2)}ms. Edge adapter: HTTP ${data.inference.edgeStatus}, ${data.inference.edgeCacheHeader}. ${engineCache}. Output: ${JSON.stringify(data.inference.output)}`;
  }

  if (data.sharding) {
    els.shardA.classList.add('verified');
    els.shardB.classList.add('verified');
    els.shardStatus.textContent = 'Verified';
    els.shardOutput.textContent = `${data.sharding.manifest.shardCount} shards · ${data.sharding.manifest.totalSize} bytes · combined artifact: ${data.sharding.artifact}`;
  }

  renderDiagnostics(data.diagnostics);

  renderEvents();
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics) {
    return;
  }

  const runtime = diagnostics.runtimes?.[0];
  const model = diagnostics.models?.[0];
  const hitRate = Math.round(diagnostics.cache?.hitRate || 0);

  els.diagnosticStatus.textContent = diagnostics.status === 'ready' ? 'Ready' : 'Idle';
  els.runtimeCount.textContent = String(diagnostics.runtimes?.length || 0);
  els.cacheEntries.textContent = String(diagnostics.cache?.entries || 0);
  els.hitRate.textContent = `${hitRate}%`;
  els.diagnosticOutput.textContent = runtime && model
    ? `${model.modelId} · ${runtime.runtime} · ${model.source} · ${diagnostics.stats.totalRequests} request${diagnostics.stats.totalRequests === 1 ? '' : 's'} · avg ${diagnostics.stats.averageLatency.toFixed(2)}ms`
    : 'No runtime loaded.';
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }

  return response.json();
}

els.runScenario.addEventListener('click', runScenario);
els.repeatInference.addEventListener('click', repeatInference);
els.resetDemo.addEventListener('click', () => {
  postJson('/api/reset')
    .then(data => {
      resetState();
      state.events = data.events || [];
      renderEvents();
    })
    .catch(error => {
      els.networkStatus.textContent = 'Error';
      addEvent(error.message);
    });
});

resetState();
