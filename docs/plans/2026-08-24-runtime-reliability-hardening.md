# Crystal Ball Runtime Reliability Hardening

## Goal

Remove the renderer, persistence, notification, diagnostic, MCP, CLI, and local-sync defects found in the August 24 live audit without weakening situation semantics, safety gates, provider truthfulness, or rollback protection.

Baseline: `macos/main` at `8da854fe`. The live audit found a 1.27 GB renderer, 20-second situation-ingest bursts, an 18 MB encoded situation record, overlapping IndexedDB work, incomplete notification tracing, fail-open MCP health, and 63 MB of unbounded main-sync logs.

This is High Assurance work. Production edits are test-first, each changed behavior receives mutation proof, and every PR requires independent review and the repository closeout gate.

## Constraints and non-goals

- Keep `wm-situation-store-v2` readable; do not delete, clear, or silently cap user history.
- Preserve ordered situation, hypothesis, calibration, alert, provenance, and quarantine semantics.
- Keep unsafe algorithms quarantined and keep their current safety floors.
- Never report missing credentials, malformed payloads, rate limits, or upstream outages as healthy.
- Do not put provider credentials in source, logs, diagnostics, fixtures, or PR text.
- Do not mix cross-event correlation semantics into the runtime-performance PR. `ACC-507` is a separate High-Assurance PR.
- Do not claim Apple notarization or 30-day algorithm recovery without their external evidence.

## Key systems

- Situation and observation pipeline: `src/services/intelligence/`
- Resume scheduling: `src/app/refresh-scheduler.ts`
- Reasoning metrics and persistence: `src/services/reasoning-*.ts`
- Notification delivery and trace registry: `src/services/notifications/`, `src/services/insights/`
- MCP tools, monitor, and CLI: `tools/mcp-server/`, `tools/crystalball-cli/`
- Main-to-Mac sync: `scripts/sync-main-to-mac.mjs`, `scripts/setup-main-sync-agent.mjs`
- Prediction roadmap: `docs/PREDICTION_ACCURACY_ROADMAP.md`

## Task 1: Lightweight situation mutations

- Owner: Codex
- Dependencies: none
- Files: `situation-store-v2.ts`, `situation-hypothesis-bridge.ts`, `epistemic-bridge.ts`, `correlation-calibration.ts`, `situation-alert-bridge-v2.ts`, `situation-timeline.ts`, `HypothesisPanel.ts`, focused tests
- Change: return bounded mutation receipts from ingest; make exact duplicates true no-ops; provide lightweight analytical subscriptions and coalesced view subscriptions; remove full-list scans from per-event paths.
- Acceptance: unchanged events do not change `updatedAt`, persist, or notify; ordered replay produces identical situation, hypothesis, calibration, alert, and quarantine digests; view listeners fire at most once per frame or 100 ms.
- Validation: focused store/bridge tests, `npm run test:intelligence`, semantic replay fixture.
- Mutation evidence: disable duplicate guard, receipt routing, and view coalescing one at a time and record the expected test failures before restoring the implementation.
- Non-goal: cross-event `CorrelateEngine` batching.

## Task 2: Persistence coordination

- Owner: Codex
- Dependencies: Task 1
- Files: `situation-store-v2.ts`, `idb-store-cache.ts`, `reasoning-memory.ts`, `reasoning-metrics.ts`, focused tests
- Change: use a fixed-window situation flush; add lifecycle flushes; implement one single-flight IndexedDB drain with generation ordering and same-value skipping; isolate diagnostic writes from measured application-write counters.
- Acceptance: serialization occurs at most once per second and never for unchanged input; IndexedDB concurrency is exactly one; older writes cannot overwrite newer values; diagnostic polling does not increase its own measured application-write count.
- Validation: focused IDB/metrics tests and 18 MB synthetic fixture.
- Mutation evidence: remove single-flight, ordering, equality, lifecycle, and diagnostic-exclusion guards independently and capture the failing assertions.
- Non-goal: v3 storage migration or production-data compaction.

## Task 3: Resume-burst control

- Owner: Codex
- Dependencies: none
- Files: `src/app/refresh-scheduler.ts`, `tests/flush-stale-refreshes.test.mjs`
- Change: preserve an active catch-up queue across repeated visibility transitions, derive staleness from per-task success time, enforce the concurrency bound, and exclude disabled tasks.
- Acceptance: repeated hide/resume cannot duplicate work or exceed six concurrent refreshes; priority and stagger ordering remain deterministic.
- Validation: scheduler tests with controlled promises and timers.
- Mutation evidence: reset the active queue during a second resume and show the concurrency/duplicate test failing.

## Task 4: Notification safety and observability

- Owner: Codex
- Dependencies: none
- Files: `notification-dispatcher.ts`, `notification-router.ts`, notification trace/provenance services, focused tests
- Change: exempt distinct critical events from source-wide rate limiting; record all production gate decisions and native delivery failures in the trace registry.
- Acceptance: a second distinct critical event from the same source is delivered; quiet hours, user mute, domain disable, dedupe, rate limit, permission denial, and native failures have explicit trace outcomes; diagnostics can account for both production notification paths.
- Validation: production-path notification tests, diagnostic trace tests, `npm run test:diagnostics`.
- Mutation evidence: restore critical rate limiting or remove one trace hook and show the focused test failing.
- Non-goal: override an explicit user master mute or domain disable.

## Task 5: Truthful MCP, monitor, CLI, and feed diagnostics

- Owner: Codex
- Dependencies: none
- Files: `tools/mcp-server/tools/aggregate.mjs`, `granular.mjs`, `analyst.mjs`, shared result/health helpers, monitor, CLI doctor/installer, MCP tests
- Change: replace hard-coded health with schema-aware classification; normalize live USGS, crypto, fear-and-greed, infrastructure, algorithm, and feed payloads; fail closed on missing or malformed health; report initial monitor failures; add CLI executable, handshake, sibling-bin, registration, and version checks.
- Acceptance: all-failed and malformed payloads cannot be healthy; missing credentials and upstream failures are distinct; installed CLI and desktop/MCP version mismatches are actionable; current live payload fixtures parse correctly.
- Validation: MCP tool/monitor/CLI suites, `npm run mcp:test`, `npm run test:diagnostics`, live read-only probes.
- Mutation evidence: restore hard-coded health or remove each live schema adapter and show its contract fixture failing.
- Non-goal: manufacture provider availability or install credentials.

## Task 6: Main-sync idle cost and log retention

- Owner: Codex
- Dependencies: none
- Files: `scripts/sync-main-to-mac.mjs`, `scripts/setup-main-sync-agent.mjs`, `tests/main-sync-agent.test.mjs`
- Change: use a five-minute default cadence; make unchanged-main stop after the remote-SHA probe; avoid reset, clean, dependency, build, and install work; bound future stdout/stderr growth.
- Acceptance: unchanged polls do no destructive checkout/reset/clean or build work; installation still requires green GitHub checks and the complete canonical build/install sequence.
- Validation: injected command-count tests and LaunchAgent fixture tests.
- Mutation evidence: restore the 60-second cadence or unchanged reset and show tests failing.
- Non-goal: delete the existing 63 MB logs without separate approval.

## Task 7: ACC-507 bounded correlation

- Owner: Codex
- Dependencies: runtime performance PR merged; draft PR claim containing `Roadmap task: ACC-507`
- Files: roadmap-approved situation/correlation modules and deterministic fixtures only
- Change: add bounded, time-windowed cross-event handoff, deduplication, expiry, learned-pair liveness, and recovery from degraded to healthy without delaying safety ingestion.
- Acceptance: deterministic multi-call fixture correlates eligible history, rejects duplicates/expired events, and proves liveness recovery; benchmark and safety outputs remain within committed gates.
- Validation: `npm run test:correlation`, `npm run bench:correlation`, algorithm gates and exact roadmap evidence.
- Mutation evidence: remove handoff, dedupe, or expiry independently and show the liveness fixture failing.
- Non-goal: model promotion, safety-floor changes, or proxy relabeling.

## Verification and delivery

Run focused tests after each task, then:

```text
npm run test:intelligence
npm run test:correlation
npm run test:algorithms
npm run test:diagnostics
npm run mcp:test
npm run bench:correlation
npm run bench:forecast
npm run typecheck:all
bash scripts/agentic-validate.sh --tests "<exact scripts run>"
```

After independent review and publication approval, record the SHA-pinned review verdict and run `bash scripts/pr-closeout.sh`. Merge only through GitHub auto-merge into `main`.

After merge, install only through `npm run main-sync:run`, then verify installed SHA/version, bundle identifier, `codesign --verify --deep --strict`, deep doctor output, provider classifications, quarantine state, and LaunchAgent state. Repeat the cold-settle probe and a 30-minute soak.

## Performance confirmation budgets

- Eleven-observation cold settle: at most 2 seconds.
- Full situation serialization: at most once per second, zero for unchanged events.
- IndexedDB concurrency: exactly one; duplicate same-value writes: zero.
- `idb.put`: p95 at most 2 seconds, maximum at most 5 seconds.
- Command polling: p95 at most 2 seconds.
- Renderer after settle: five-minute CPU average at most 5%, p95 at most 10%.
- Renderer memory: no post-settle peak above 1 GB and less than 100 MB growth over 30 minutes.
- Main-sync unchanged path: five-minute cadence with negligible sustained CPU.

## External evidence and blockers

- Provider keys must be supplied through the existing secret plumbing before credential-gated feeds can pass live probes.
- Rate-limited or unavailable upstreams remain degraded until they recover; code will provide truthful fallback and diagnostics.
- Existing log or cache deletion requires explicit target approval and a recoverable plan.
- Official Gatekeeper success requires Developer ID and Apple notarization credentials.
- Failing algorithms stay quarantined until authoritative paired outcomes meet the roadmap floors. `ACC-703` remains waiting for its 30-day production window.

## Rollback

The first repair cycle keeps the v2 persistence schema, so rollback is code-only: reinstall the previous verified main build. If the memory budget later requires a v3 hot/cold split, it must be a separate approved migration that writes and verifies v3 before switching and retains v2 through at least one successful release.
