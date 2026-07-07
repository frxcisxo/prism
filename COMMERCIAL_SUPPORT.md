# PRISM Commercial Support

PRISM is open source, but production edge AI systems often need a focused reliability review before they scale.

## PRISM Edge AI Reliability Snapshot

Fixed fee: USD 1,200

Timeline: 48 hours after payment and kickoff materials

This is a compact review of one edge AI workflow. It is designed for teams using Cloudflare Workers, Workers AI, Vercel Edge, browser AI, ONNX Runtime Web, WebGPU, IoT, mobile/offline-first workflows, or hybrid edge/cloud inference.

### Deliverables

- One-page failure-mode map
- Readiness and fallback checklist
- Conservative ROI estimate
- Small PRISM proof or simulation
- Recommendation: stop, full audit, or pilot

See a fictional [sample Snapshot report](SAMPLE_SNAPSHOT_REPORT.md) for the expected deliverable format.

### Included

- One workflow review
- Up to 30 minutes of kickoff discussion or written context
- Review of one diagram, endpoint, Worker, repo path, architecture note, or workflow description
- Written report

### Not Included

- Production implementation
- Full security audit
- Model quality evaluation
- Long-term maintenance
- More than one workflow

## Upgrade Credit

If you start a full PRISM audit or implementation pilot within 14 days of Snapshot delivery, the USD 1,200 Snapshot fee can be credited toward that next engagement.

## Larger Engagements

- Full reliability audit: USD 2,500
- Implementation pilot: USD 8,000 to 25,000 depending on scope
- Advisory or rescue work: USD 100 to 150/hour, 10-hour minimum

## How To Start

Option 1: open a GitHub issue using the `PRISM Reliability Snapshot` template.

Option 2: email directly.

Email: frxcisxo@dev.com

Subject:

```text
PRISM Reliability Snapshot
```

Include:

- the workflow you want reviewed
- target platform or runtime
- known latency, routing, cache, fallback, readiness, or support issues
- approximate request volume or incident/support context if available

Work starts after payment and receipt of kickoff materials.

## From npm

If you found PRISM through npm, review:

- `COMMERCIAL_SUPPORT.md` for scope and pricing
- `SAMPLE_SNAPSHOT_REPORT.md` for an example deliverable
- `README.md` for demos and validation commands

You can also run the packaged checklist:

```bash
npx @frxncisxo/prism prism-reliability-check
```

Then email `frxcisxo@dev.com` with the subject `PRISM Reliability Snapshot`.
