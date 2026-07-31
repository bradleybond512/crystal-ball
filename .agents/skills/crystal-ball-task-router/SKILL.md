---
name: crystal-ball-task-router
description: Use at the start of every coding task to select the minimum-cost workflow, specialists, tests, and review gates from changed domains. Run the deterministic router before spawning agents.
---

# Crystal Ball Task Router

## Goal

Use code for mechanical classification and reserve expert agents for judgment. Minimize context, duplicate exploration, and unnecessary delegation without reducing quality.

## Start

Run:

```bash
node scripts/agent-router.mjs --request "<task request>"
```

Read the emitted JSON. Treat it as the default routing plan unless repository evidence justifies a change.

## Cost tiers

- `mechanical`: formatting, generated metadata, simple docs, obvious localized fixes. No swarm. One implementer plus changed-file checks.
- `focused`: bounded feature or bug. Repository analyst only when execution path is unclear; one domain specialist; test engineer when behavior changes; independent reviewer.
- `standard`: multi-domain or multi-file work. Repository analyst, architect, relevant specialists, tests, reviewer.
- `high_assurance`: prediction/calibration, correlation scoring, security, Tauri/native privilege, release/install, destructive or architectural work. Mission architect, repository analyst, architect, domain specialists, test engineer, independent reviewer, and human design approval.

## Specialist routing

- providers, feeds, ingestion, caching, source health → `provider_engineer`
- intelligence, situations, rules, alerts, evidence → `intelligence_engineer`
- prediction, calibration, scoring, forecasts, self-tuning → `prediction_engineer`
- correlation, causal, clustering, anomaly, evidence graph → `correlation_engineer`
- Tauri, Rust, sidecar, IPC, CSP, SSRF, secrets, filesystem → `tauri_security_engineer`
- UI, components, map, globe, deck.gl, accessibility → `ui_map_engineer`; add `product_designer` for new interactions
- performance, memory, render loops, benchmarks → `performance_engineer`
- package, signing, updater, install, release, version → `release_engineer`

## Context discipline

Give every specialist only:
- task brief;
- approved design section relevant to it;
- exact files/symbols;
- acceptance criteria;
- allowed scope;
- targeted commands.

Do not forward full transcripts or all discovery notes. Summarize evidence once and reuse it.

## Completion

Run targeted checks first, then:

```bash
bash scripts/agentic-check-changed.sh
```

Use the independent reviewer only after deterministic checks pass. Escalate to broader validation only when changed domains require it.
