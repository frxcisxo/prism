#!/usr/bin/env node

const checks = [
  {
    id: 'readiness',
    label: 'Model readiness is separate from service liveness',
    why: 'Traffic should not reach a model just because the edge function is alive.'
  },
  {
    id: 'fallback',
    label: 'Fallback paths emit structured reason codes',
    why: 'Support and engineering need to explain degraded AI behavior after incidents.'
  },
  {
    id: 'cache',
    label: 'Cache hit, miss, skip, and stale outcomes are observable',
    why: 'Cache behavior drives latency, fallback load, and provider spend.'
  },
  {
    id: 'routing',
    label: 'Model routing state is deterministic or convergent across regions',
    why: 'Regions should not disagree silently about model availability or priority.'
  },
  {
    id: 'timeouts',
    label: 'Timeout, retry, and circuit-breaker policies are bounded',
    why: 'Unbounded retries can turn a small model outage into a platform incident.'
  },
  {
    id: 'artifacts',
    label: 'Model artifact version, signature, or checksum is visible',
    why: 'Operators need to know what model actually handled a request.'
  },
  {
    id: 'offline',
    label: 'Offline or degraded-mode queue semantics are explicit',
    why: 'Accepted work should not duplicate, disappear, or conflict after reconnect.'
  },
  {
    id: 'metrics',
    label: 'Business metrics are connected to reliability metrics',
    why: 'Latency, fallback rate, support tickets, and provider spend should be reviewed together.'
  }
];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    markdown: args.has('--markdown'),
    json: args.has('--json'),
    help: args.has('--help') || args.has('-h')
  };
}

function renderText() {
  const lines = [
    'PRISM Edge AI Reliability Checklist',
    '',
    'Use this before scaling a Cloudflare Workers, Workers AI, Vercel Edge, browser AI, ONNX Runtime Web, WebGPU, IoT, or hybrid edge/cloud inference workflow.',
    ''
  ];

  for (const [index, check] of checks.entries()) {
    lines.push(`${index + 1}. [ ] ${check.label}`);
    lines.push(`   Why: ${check.why}`);
  }

  lines.push('');
  lines.push('If several boxes are unclear, consider a PRISM Edge AI Reliability Snapshot.');
  lines.push('Fixed fee: USD 1,200. Details: COMMERCIAL_SUPPORT.md');
  lines.push('Sample deliverable: SAMPLE_SNAPSHOT_REPORT.md');
  lines.push('Contact: frxcisxo@dev.com');

  return lines.join('\n');
}

function renderMarkdown() {
  const lines = [
    '# PRISM Edge AI Reliability Checklist',
    '',
    'Use this before scaling a Cloudflare Workers, Workers AI, Vercel Edge, browser AI, ONNX Runtime Web, WebGPU, IoT, or hybrid edge/cloud inference workflow.',
    ''
  ];

  for (const check of checks) {
    lines.push(`- [ ] **${check.label}**`);
    lines.push(`  ${check.why}`);
  }

  lines.push('');
  lines.push('If several boxes are unclear, consider a [PRISM Edge AI Reliability Snapshot](./COMMERCIAL_SUPPORT.md).');
  lines.push('');
  lines.push('- Fixed fee: USD 1,200');
  lines.push('- Sample deliverable: [SAMPLE_SNAPSHOT_REPORT.md](./SAMPLE_SNAPSHOT_REPORT.md)');
  lines.push('- Contact: frxcisxo@dev.com');

  return lines.join('\n');
}

function renderHelp() {
  return [
    'Usage: prism-reliability-check [--markdown] [--json]',
    '',
    'Prints an edge AI reliability checklist for production and pre-production workflows.',
    '',
    'Options:',
    '  --markdown   Print Markdown output',
    '  --json       Print machine-readable JSON',
    '  -h, --help   Show help'
  ].join('\n');
}

const options = parseArgs(process.argv);

if (options.help) {
  console.log(renderHelp());
} else if (options.json) {
  console.log(JSON.stringify({ checks }, null, 2));
} else if (options.markdown) {
  console.log(renderMarkdown());
} else {
  console.log(renderText());
}
