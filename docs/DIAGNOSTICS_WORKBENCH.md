# Crystal Ball Diagnostics Workbench

Use the workbench when the app is running but a feed, renderer workflow, or algorithm appears wrong. It is optimized for quick current-session diagnosis; `npm run checkup` remains the broader source-tree and release-readiness audit.

## Fast path

```bash
npm run doctor
```

The command discovers the live sidecar port and token from the app's private runtime files. It checks:

- sidecar availability, PID, memory, event-loop lag, and heartbeat freshness;
- current feed health;
- renderer-mirrored reasoning errors and state freshness;
- algorithm health, evaluation coverage, persistence, errors, and p95 latency;
- fatal or analysis-worker events from the latest desktop-log session.

Findings are ordered by operational impact and include evidence plus a suggested next action. Exit codes are `0` for green, `1` for warnings, and `2` for critical failures.

For provider and route probes:

```bash
npm run doctor -- --deep
```

For an agent-readable handoff:

```bash
npm run doctor -- --deep --json --output /tmp/crystalball-doctor.json
```

The output file is created with mode `0600`. Nested strings are redacted for bearer tokens, credential query parameters, email addresses, and the local macOS username. Algorithm records intentionally exclude raw input details, notes, and input hashes.

## Agent tools

When Crystal Ball is running, Codex or Claude can use:

- `diagnose_runtime({ deep: false })` for ranked live findings;
- `diagnose_runtime({ deep: true })` when route-level evidence is needed;
- `get_algorithm_diagnostics({})` for evaluation coverage, health, latency, bounded tunings, adjustment proposals, and recent decisions;
- `get_pipeline_trace({ domain, stalledOnly: true })` to find facts stuck before a routed or dropped terminal stage;
- `get_reasoning_debug_log(...)` and `get_reasoning_metrics(...)` for renderer errors and operation latency.

Run `help({ tool: "diagnose_runtime" })` or `help({ tool: "get_algorithm_diagnostics" })` for the in-MCP man pages.

## Algorithm tuning workflow

1. Run the doctor and resolve red runtime or persistence findings first.
2. Inspect evaluation coverage. Do not tune from pending or undersampled results.
3. Check per-algorithm errors and p95 latency, then inspect recent evaluations or pipeline traces for the same algorithm and time window.
4. Reproduce the behavior with the replay harness or a deterministic fixture.
5. Change only a declared bounded tuning parameter.
6. Run the relevant algorithm tests, replay baseline, and cognition benchmark.
7. Compare the new health snapshot and record whether the proposal was applied or held by policy.

Do not weaken validation, inflate timeouts, or widen adjustment bounds solely to turn a warning green. The diagnostic evidence should identify whether the cause is upstream data, pipeline routing, algorithm behavior, persistence, or runtime pressure.

## If the doctor cannot connect

1. Confirm `~/Applications/Crystal Ball.app` is running.
2. Restart the app and retry after fifteen seconds.
3. Inspect the latest session in `~/Library/Logs/com.bradleybond.crystalball/desktop.log`.
4. Check `sidecar.health.json`, `sidecar.port`, and `sidecar.token` in the same private log directory.
5. Run `npm run checkup` if the runtime files are missing after a clean restart.
