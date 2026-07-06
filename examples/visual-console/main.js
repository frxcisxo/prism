const state = {
  events: [],
  activePreset: 'retail',
};

const presets = {
  retail: {
    prompt: 'Plan a safe edge deployment for a retail store with cameras, inventory events, and intermittent WAN.',
    summary: 'Retail edge nodes keep planning and cache repeated store requests while fallback protects remote inference.',
  },
  industrial: {
    prompt: 'Detect machine anomalies at a factory cell, keep inference local during provider failure, and sync state after network recovery.',
    summary: 'Industrial nodes route low-latency anomaly checks locally, then use resilient fallback when the primary runtime fails.',
  },
  clinic: {
    prompt: 'Coordinate mobile clinic triage assistance where connectivity drops, patient data must stay local, and results sync later.',
    summary: 'Mobile clinic workflows keep sensitive prompts local, queue state through outages, and expose health for operators.',
  },
  logistics: {
    prompt: 'Optimize warehouse routing for scanners and cameras while repeated requests hit cache and edge nodes converge.',
    summary: 'Logistics teams can test cache hits, node convergence, and resilient routing for busy warehouse decisions.',
  },
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
  useCaseOutput: document.querySelector('#useCaseOutput'),
  presetButtons: Array.from(document.querySelectorAll('[data-preset]')),
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
  resilienceStatus: document.querySelector('#resilienceStatus'),
  resilienceAlerts: document.querySelector('#resilienceAlerts'),
  resilienceFallbacks: document.querySelector('#resilienceFallbacks'),
  resiliencePrimaryCalls: document.querySelector('#resiliencePrimaryCalls'),
  resilienceOutput: document.querySelector('#resilienceOutput'),
  metricsPreview: document.querySelector('#metricsPreview'),
  timeline: document.querySelector('#timeline'),
  eventCount: document.querySelector('#eventCount'),
  runScenario: document.querySelector('#runScenario'),
  repeatInference: document.querySelector('#repeatInference'),
  resetDemo: document.querySelector('#resetDemo'),
};

function resetState() {
  state.events = [];
  applyPreset(state.activePreset);
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
  els.resilienceStatus.textContent = 'Idle';
  els.resilienceAlerts.textContent = '0';
  els.resilienceFallbacks.textContent = '0';
  els.resiliencePrimaryCalls.textContent = '0';
  els.resilienceOutput.textContent = 'Resilient runtime health will appear after the scenario runs.';
  els.metricsPreview.textContent = 'Prometheus metrics preview will appear here.';
  renderEvents();
}

function applyPreset(presetId) {
  const preset = presets[presetId] || presets.retail;
  state.activePreset = presetId in presets ? presetId : 'retail';
  els.promptInput.value = preset.prompt;
  els.useCaseOutput.textContent = preset.summary;
  els.presetButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.preset === state.activePreset);
  });
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
  renderResilience(data.resilience);

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

function renderResilience(resilience) {
  if (!resilience) {
    els.resilienceStatus.textContent = 'Idle';
    els.resilienceAlerts.textContent = '0';
    els.resilienceFallbacks.textContent = '0';
    els.resiliencePrimaryCalls.textContent = '0';
    els.resilienceOutput.textContent = 'Resilient runtime health will appear after the scenario runs.';
    els.metricsPreview.textContent = 'Prometheus metrics preview will appear here.';
    return;
  }

  const health = resilience.health || resilience.report || {};
  const report = resilience.report || {};
  const summary = resilience.summary || {};
  const circuitBreaker = health.circuitBreaker || report.circuitBreaker || {};
  const activeAlerts = summary.active
    ?? resilience.alertStates?.filter(alert => alert.status === 'active').length
    ?? 0;
  const fallbackHits = report.totals?.fallbackSuccesses
    ?? health.totals?.fallbackSuccesses
    ?? report.fallbackSuccesses
    ?? 0;
  const activeAlert = resilience.alertStates?.find(alert => alert.status === 'active') || resilience.alerts?.[0];
  const fallbackText = resilience.second?.text || resilience.second?.raw?.text || 'fallback completed';

  els.resilienceStatus.textContent = `${health.status || report.status || 'unknown'} · HTTP ${health.statusCode || report.statusCode || 200}`;
  els.resilienceAlerts.textContent = String(activeAlerts);
  els.resilienceFallbacks.textContent = String(fallbackHits);
  els.resiliencePrimaryCalls.textContent = String(resilience.primaryCalls || 0);
  els.resilienceOutput.textContent = `${health.summary || 'Runtime evaluated'} · circuit ${circuitBreaker.state || 'closed'} · ${activeAlert ? activeAlert.message : 'No active alerts'} · output: ${fallbackText}`;
  els.metricsPreview.textContent = resilience.metricsPreview || 'No metrics yet.';
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
els.presetButtons.forEach(button => {
  button.addEventListener('click', () => {
    applyPreset(button.dataset.preset);
    els.cacheBadge.textContent = 'Cold';
    els.inferenceOutput.textContent = 'Run the scenario to route the first request.';
  });
});

resetState();
