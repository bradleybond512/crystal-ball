# Crystal Ball Quality and Reliability Roadmap

> Status: ACTIVE
> Updated: 2026-08-02
> Owners: Codex and Claude
> Scope: desktop delivery, runtime workers, diagnostics, UI readiness, test
> gates, native quality, feeds, and release proof.

This file is the single execution board for the reliability findings from the
2026-08-02 exhaustive audit. Prediction, calibration, correlation, scoring,
self-tuning, and model-promotion behavior remain governed by
`docs/PREDICTION_ACCURACY_ROADMAP.md`; this board links to that work rather than
duplicating it.

## Goal

Make Crystal Ball easy to update, diagnose, recover, test, and tune without a
green check concealing a broken runtime path.

## Definition of complete

This roadmap is complete only when all of the following are true:

1. The Mac sync agent survives package-manager Node upgrades, reports the
   installed and target commit, rotates logs, and proves a fail-closed install
   from merged `main`.
2. ML and analysis workers recover from fatal errors without remaining falsely
   ready, and diagnostics identify the failed operation without recording
   private input text.
3. The installed app completes a seven-day soak without an unexplained worker
   crash, runaway storage growth, or a stuck update.
4. God's Vision, Home Shell Escape, header controls, zero-coordinate deep links,
   and initially enabled map layers pass deterministic browser tests.
5. Prediction diagnostics distinguish rigorous direct-label holdouts from
   proxy, late, overlapping, and insufficient-evidence cohorts. Any scoring
   change satisfies the applicable `ACC-NNN` task and evidence rules.
6. Pipeline traces give every intentionally terminal signal an explicit
   terminal state and do not classify expected filtering as a stall.
7. One documented command reaches every supported automated test file, and
   audit scripts exit nonzero for every state they label as a failure.
8. Browser visual tests are deterministic and do not depend on live map tiles
   or provider timing.
9. TypeScript, strict lint, Rust formatting, strict Clippy, dependency audits,
   production builds, bundle budgets, desktop packaging, signing verification,
   and required GitHub checks are green.
10. The merged `main` build is installed through the supported sync path and
    `doctor --deep` accurately describes the installed runtime.

## Audit baseline

The original audit ran against source commit `e1cda667` and the installed
2.25.147 application. Canonical `main` had advanced to `a57e901e` when this
roadmap was created, so each task must reproduce its finding against fresh
`main` before implementation.

| Finding | Audit evidence | Initial disposition |
|---|---|---|
| Broken main-sync agent | LaunchAgent references removed Homebrew Node 25.8.2; exits `EX_CONFIG` every interval | Confirmed in current setup source |
| Stale installed application | Repaired sync installed canonical main `a57e901e` on 2026-08-02 | REL-001 live acceptance passed |
| ML worker failure | 184 `Offset should not be negative` errors; ready state survives fatal error | Confirmed in current manager source |
| Misleading prediction RED | Raw score mixes 270 proxy and 297 late labels; rigorous holdout had only 26 usable direct records | Revalidate under an `ACC-NNN` task |
| UI startup/input defects | God's Vision readiness, Escape ownership, pointer interception, zero-coordinate URL, initial APT load | Reproduce individually on current main |
| Test-gate gaps | 171 of 200 nested test files absent from named scripts; audit wrappers can mask failures | Recompute on current main |
| Native debt | Rust tests pass; format and strict Clippy fail | Recompute on current main |
| Feed degradation | 414 RSS feeds healthy, one stale, six dead, one empty | Reprobe before changing feeds |

## Coordination protocol

### Claiming work

1. Start from fresh canonical `main` on a `codex/*` or `claude/*` branch.
2. Search open PRs for the `REL-NNN` id.
3. Claim one task in a draft PR whose title or body contains
   `Roadmap task: REL-NNN` before production implementation.
4. Keep one owner per task. Closely coupled tasks may share a PR only when the
   PR states why separate delivery would be unsafe or would duplicate tests.
5. Update the task status, evidence, commands, mutation proof, rollback, and
   next unblocked task in the same PR that completes it.
6. Prediction-adjacent work must also claim the applicable `ACC-NNN` task and
   obey the prediction roadmap's sample and benchmark gates.

### Status values

- `TODO`: unclaimed and dependencies are satisfied.
- `DESIGN`: discovery/design is owned; production implementation awaits human approval.
- `IN REVIEW`: a draft or ready PR owns the task.
- `WAITING`: blocked on another task, external credential, or evidence window.
- `MONITOR`: merged; completion requires live evidence.
- `DONE`: merged to `main` and acceptance evidence passed.
- `REJECTED`: investigated and intentionally not changed, with evidence.

### Evidence required from every implementation PR

- before/after behavior and exact reproduction;
- focused red-green test evidence and mutation proof;
- targeted commands with pass/fail counts;
- `bash scripts/agentic-validate.sh --tests "<actual test scripts>"`;
- security and privacy review for installer, persistence, IPC, or diagnostics;
- performance or resource impact for startup, worker, polling, or bundle work;
- rollback or recovery procedure;
- fresh review evidence required by repository policy, unless the user and
  repository gate establish an explicit alternative.

## Phase 0 — Re-establish trustworthy desktop delivery

### REL-001 — Stable main-sync executable

Status: `IN REVIEW`

Owner: Codex

Branch: `codex/reliability-remediation-20260802`

PR: [#1612](https://github.com/bradleybond512/crystal-ball/pull/1612)

Risk: High Assurance

Dependencies: none

Modify:

- `scripts/setup-main-sync-agent.mjs`
- `tests/main-sync-agent.test.mjs`
- local sync runbook documentation

Deliver:

- resolve a stable Node launcher that remains valid across Homebrew cellar
  version changes;
- reject a missing or non-executable launcher during setup;
- keep plist values XML-safe;
- preserve the existing fail-closed required-check and install path;
- make reinstall idempotent and report the executable actually installed.

Acceptance:

- a fixture using a versioned `process.execPath` emits a stable launcher;
- setup fails before writing a broken plist when no trusted launcher exists;
- mutation proof demonstrates the regression test fails with the old embedded
  cellar path;
- the real LaunchAgent bootstraps and completes one sync attempt.

Verify:

- `node --test tests/main-sync-agent.test.mjs`
- `npm run main-sync:setup`
- `launchctl print gui/$(id -u)/com.bradleybond.crystalball.main-sync`
- `npm run main-sync:run`

Rollback: rerun the previous setup script or boot out the user LaunchAgent;
never install an unchecked build manually as fallback.

Evidence (2026-08-02):

- reproduced LaunchAgent exit `78` with a missing Homebrew Cellar executable;
- red-green mutation proof progressed from 4 failing / 6 passing focused tests
  to 11 passing tests after stable-launcher, policy, PATH, and XML coverage;
- temporary-root setup selected `/opt/homebrew/opt/node@22/bin/node`, and
  `plutil -lint` accepted the generated plist;
- the repaired live agent installed checked main `a57e901e` to
  `~/Applications/Crystal Ball.app`, recorded SHA-256
  `5ced3abd6d0a7bcbf44e153250f0be91bb1a96065c0f74e3502c8f782d5a93ed`,
  and relaunched the application and sidecar. A second setup completed
  idempotently and reported the same commit as already installed and healthy;
- focused ESLint, `lint:strict`, `docs:check`, `secrets:scan`, and
  `typecheck:all` passed. The broad `test:data` run passed 810 of 812 tests;
  the two failures are pre-existing REL-402/REL-406 inputs: a panels bundle
  budget overage and a stale workflow action-pin assertion. The required
  agentic gate was executed and stopped at those same two failures.
- security/privacy review found no new data collection, credentials, network
  destinations, or untrusted PATH entries. Runtime overhead is unchanged;
  executable probing occurs only during setup. Recovery is rerunning setup
  after installing Node 22, or booting out the user LaunchAgent.

### REL-002 — Main-sync health, retention, and commit visibility

Status: `WAITING`

Dependencies: REL-001

Deliver:

- bounded stdout/stderr retention and disposable build-artifact cleanup;
- current target SHA, installed SHA, last successful phase, duration, and
  failure reason in `status.json`;
- a doctor/MCP probe that detects a stopped agent, stale install, repeated
  failure, invalid executable, and excessive sync-root growth;
- no source, token, environment value, or signing identity leakage.

Verify:

- sync unit fixtures plus diagnostics privacy fixtures;
- `npm run test:diagnostics`;
- `npm run mcp:test`;
- forced failure and recovery against a temporary sync root.

## Phase 1 — Worker recovery and runtime performance

### REL-101 — Fatal ML-worker recovery contract

Status: `TODO`

Dependencies: none

Modify:

- `src/services/ml-worker.ts`
- a new focused manager test using an injected worker factory or existing
  project worker-test seam

Deliver:

- a fatal `error` or `messageerror` rejects pending requests, clears timeouts,
  terminates the worker, clears loaded-model state, and marks it unavailable;
- one bounded lazy reinitialization path with no restart storm;
- concurrent callers share one initialization attempt;
- `terminate()` prevents automatic restart during shutdown.

Acceptance: after a simulated fatal error, `isAvailable` is false, the old
worker receives no subsequent messages, and a later permitted request uses a
new ready worker.

Verify: focused worker-manager tests, `npm run test:renderer`,
`npm run typecheck:all`.

### REL-102 — Diagnose and eliminate negative ML offsets

Status: `WAITING`

Dependencies: REL-101

Deliver:

- privacy-safe operation metadata: request type, bounded input count and
  lengths, model id/version, elapsed time, and fatal/recovered state;
- deterministic reproduction or a documented upstream/runtime attribution;
- validation at the earliest trusted boundary when malformed input is the
  cause, or a pinned dependency/runtime fix when the inference stack is the
  cause;
- no raw headlines, summaries, entities, embeddings, or model payloads in logs.

Verify: regression fixture, secrets/privacy scan, worker recovery suite, and a
live installed-app exercise.

### REL-103 — Analysis-worker readiness and recovery

Status: `TODO`

Dependencies: none

Deliver: replace startup-time assumptions with an explicit state machine and
condition-based readiness; fail degraded without blocking app boot; recover
from a later successful worker start.

Verify: focused analysis-worker tests and browser startup with delayed and
failed worker fixtures.

### REL-104 — IndexedDB and command-poll latency attribution

Status: `WAITING`

Dependencies: REL-002

Deliver: separate queue wait, transaction, serialization, and storage latency;
bound diagnostic retention; identify background-tab and shutdown effects; add
actionable thresholds without treating transient old samples as current health.

Verify: deterministic latency fixtures, storage-size bound, and a 30-minute
runtime profile.

## Phase 2 — Startup, navigation, and map correctness

| ID | Status | Work | Acceptance | Focused verification |
|---|---|---|---|---|
| REL-201 | TODO | God's Vision command readiness | A click or shortcut during startup is queued or visibly unavailable; no lost command | Playwright delayed-listener fixture plus current entry-point tests |
| REL-202 | TODO | Escape ownership | Escape closes the topmost visible surface exactly once; hidden Command Palette cannot consume it | Home Shell and keyboard unit tests plus Playwright |
| REL-203 | TODO | Header pointer ownership | Safety/Just-In surfaces never intercept unrelated header controls at supported widths | Pointer-hit Playwright matrix and axe |
| REL-204 | TODO | Zero-coordinate deep links | `lat=0`, `lon=0`, and either zero independently survive initial URL sync and navigation | URL-state unit fixtures plus cold-start Playwright |
| REL-205 | TODO | Initially enabled APT layer | Full/Finance startup loads APT data once when enabled initially; off/on remains idempotent | DeckGL layer lifecycle test and variant identity E2E |

Phase exit: all five flows pass on Full, relevant Tech/Finance variants, desktop
viewport, narrow desktop viewport, and reduced-motion mode.

## Phase 3 — Honest diagnostics and prediction evaluation

### REL-301 — Prediction diagnostic cohort honesty

Status: `WAITING`

Governance: implement only after claiming the applicable task in
`docs/PREDICTION_ACCURACY_ROADMAP.md`. ACC-702 is the likely integration point
after ACC-701 is complete; create a new ACC task instead if scope would distort
ACC-702.

Deliver:

- separate direct/manual rigorous holdout, proxy, late, overlap-excluded, and
  pending cohorts in doctor, UI, and MCP;
- headline severity derives only from an eligible time-ordered holdout;
- explicit `insufficient_evidence` below roadmap floors;
- raw/proxy scores remain visible as labeled diagnostics, never promotion
  evidence;
- sample count, split, algorithm version, and exclusion reasons accompany each
  score.

Verify: forecast-evaluation known-answer fixtures, privacy tests,
`npm run bench:forecast`, `npm run test:intelligence`,
`npm run test:diagnostics`, and roadmap-required benchmark evidence.

### REL-302 — Pipeline terminal-state semantics

Status: `TODO`

Deliver: represent intentionally ignored/deferred/low-severity work with an
explicit terminal state or reason; reserve `stalled` for work expected to
advance; bound trace retention and preserve safety-event visibility.

Verify: lifecycle fixtures for evaluated, routed, dropped, intentionally
ignored, timeout, and actual stall paths.

### REL-303 — Cross-layer incident correlation

Status: `WAITING`

Dependencies: REL-002, REL-101, REL-302

Deliver: one privacy-safe incident id connecting renderer worker failures,
sidecar requests, feed health, algorithm evaluations, and doctor snapshots;
export a bounded troubleshooting packet without secrets or raw intelligence.

### REL-304 — Installed-build provenance

Status: `WAITING`

Dependencies: REL-001

Deliver: expose app version, source commit, build time, sidecar/runtime version,
active variant, installed path, and sync state in diagnostics and the support
bundle. Avoid using the unchanged semver string as proof the code is current.

### REL-305 — Feed-health repair loop

Status: `TODO`

Deliver: classify dead/stale/empty feeds by cause; replace only feeds with a
stable authoritative endpoint; preserve optional credential degradation; add
per-feed last-good and failure-class evidence.

Verify: live response-body probe for every changed endpoint, normalization
fixture, `npm run test:feeds`, feed tracker tests, and sidecar tests.

## Phase 4 — Make green gates trustworthy

### REL-401 — Authoritative test inventory and `test:all`

Status: `TODO`

Deliver:

- generate or validate an explicit inventory of supported test files;
- make one CI command reach every supported file exactly once or through a
  documented shard;
- maintain an allowlisted exclusion file with owner and reason;
- fail on an orphaned test, duplicate execution, zero-test shard, cancellation,
  or unexpected skip.

Verify: inventory mutation tests, shard dry run, and full test execution.

### REL-402 — Persistence contract cleanup

Status: `TODO`

Deliver: decide and document whether microtask-coalesced local persistence is
eventual or flushable; update stale synchronous tests to observe the real
contract; add shutdown/durability coverage without test-only production APIs.

### REL-403 — Deterministic E2E contracts

Status: `WAITING`

Dependencies: REL-201 through REL-205

Deliver: update stale HTTPS/vault/updater/request-method/SWR expectations;
replace arbitrary waits with readiness conditions; isolate provider and map
network fixtures; fail with actionable screenshots and traces.

### REL-404 — Deterministic bundle budgets

Status: `TODO`

Deliver: match exact manifest entries rather than first prefix from
`readdir`; give the aggregate panels chunk a stable identity; enforce both
total and per-chunk budgets; either split the oversized chunk or change a
budget only with measured justification.

Verify: synthetic directory-order fixtures, current production build,
`npm run bundle:check`, and `npm run pwa:budget`.

### REL-405 — Fatal audit semantics

Status: `TODO`

Deliver: sidecar-route, embedded-route, and panel-smoke audits must exit nonzero
for every unbaselined failure they print; baselines must be explicit, bounded,
and reject unexpected improvements that should be removed from the baseline.

### REL-406 — Repository lint completion

Status: `TODO`

Deliver: reproduce the ESLint wrapper hang, distinguish long runtime from a
leaked process/handle, provide progress and a bounded CI timeout, and preserve
the full lint rule set.

### REL-407 — Documentation freshness

Status: `TODO`

Deliver: repair missing changelog/PR evidence and make freshness checks
identify the exact stale section without false success.

Phase exit: `test:all`, focused suites, lint, docs, type checks, security scans,
builds, and audits all return accurate exit codes from a clean checkout.

## Phase 5 — Native quality and release proof

| ID | Status | Work | Required evidence |
|---|---|---|---|
| REL-501 | TODO | Rust formatting baseline | `cargo fmt --check` clean without behavior change |
| REL-502 | WAITING | Strict Clippy cleanup | Depends REL-501; `cargo clippy --all-targets --all-features -- -D warnings` clean |
| REL-503 | TODO | Fresh Rust advisory gate | Live database refresh, documented allowlist rationale/expiry, `cargo audit` and intended `cargo deny` scopes |
| REL-504 | WAITING | Production signing/notarization | Valid Developer ID team, hardened runtime, notarization/stapling, Gatekeeper acceptance; no secret handling changes without explicit authorization |
| REL-505 | WAITING | Merged-main install and soak | Depends all release blockers; full package, supported sync install, deep doctor, E2E, seven-day runtime evidence |

## Global verification matrix

| Change area | Required minimum |
|---|---|
| Installer or LaunchAgent | focused Node tests, temporary-root failure tests, plist validation, real `launchctl` state, supported sync run |
| Worker lifecycle | red-green worker tests, timeout/fatal/messageerror/shutdown paths, renderer tests, live runtime log check |
| UI or map | pure state tests, relevant Playwright variant, axe, reduced-motion and narrow-width checks |
| Prediction diagnostics | applicable `ACC-NNN` evidence, intelligence/algorithm/diagnostic suites, frozen benchmark, privacy scan |
| Test infrastructure | mutation proof for failure exit, inventory audit, clean-checkout execution |
| Rust/native | fmt, check, tests, strict Clippy, audit/deny, package, signature/Gatekeeper checks |
| Every PR | focused tests, `lint:ci`, `lint:strict`, `typecheck:all`, staged secret scan, `git diff --check`, agentic validation |
| Final production claim | required GitHub checks, merged-main sync install, installed commit proof, `doctor --deep --json`, runtime and log soak |

## Open risks and assumptions

- The exhaustive browser and nested-test audit predates current `main`; failures
  must be reproduced before code changes.
- The ML offset error may originate in application inputs, Transformers.js,
  ONNX Runtime, model artifacts, or an interaction among them. Recovery can be
  specified now; attribution cannot be guessed.
- Provider endpoints and schemas are temporally unstable. Every feed change
  requires a fresh body-level live probe with secrets redacted.
- Prediction metrics from different event mixes are not directly comparable.
  Use matched, time-ordered cohorts and the prediction roadmap's evidence floors.
- Production notarization requires credentials and external Apple services;
  absence of those prerequisites is a blocker, not permission to weaken signing.
- Cross-agent review was explicitly deferred by the user while Claude capacity
  was unavailable. That does not silently bypass repository-required checks;
  publication must use an approved review or explicit gate-compatible waiver.

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-08-02 | Keep reliability work separate from prediction accuracy tracking | Prevents duplicate status and preserves `ACC-NNN` evidence governance |
| 2026-08-02 | Repair desktop delivery before installing new builds | The current updater is broken, so later fixes would not reliably reach the Mac |
| 2026-08-02 | Repair worker recovery before diagnosing the upstream offset defect | A known model/runtime error must not leave the application falsely healthy |
| 2026-08-02 | Require current-main reproduction for every inherited finding | The audit source commit predates canonical main |
| 2026-08-02 | Treat test infrastructure as production infrastructure | A masked failure makes all later completion claims unreliable |
