# Claude Roadmap: PR198 Bug Smash And Functional Hardening

Date: 2026-04-28

## Goal

Fix the gaps found after PR198 so the self-learning, diagnostics, panel-smoke, and local main-sync systems are safe enough to trust as operational gates.

This is not a new feature pass. Treat it as a bug-smash and hardening pass.

## Current State

PR198 is merged on `main` and added the post-PR197 integration layer:

- `npm run test:strategic-self-improvement`
- diagnostics export schema v2
- quality-debt adapters
- policy-gate wrapper for adjustment proposals
- scenario coverage check in CI/release-doctor
- post-PR197 handoff doc

Fresh local verification after PR198:

```bash
npm run test:strategic-self-improvement
```

Result: `130/130` pass.

```bash
npx tsx --test \
  src/services/governance/__tests__/policy-gate.test.mts \
  src/services/quality/__tests__/quality-debt-adapters.test.mts \
  src/services/diagnostics/__tests__/export-bundle.test.mts
```

Result: `42/42` pass.

```bash
npm run scenarios:check
```

Result: OK, 10 scenarios across all 8 mission domains.

```bash
npm run typecheck:all
```

Result: pass.

```bash
node scripts/release-doctor.mjs --allow-existing-target-release --variant full
```

Result: OK for `v2.10.21`.

```bash
npm run test:panels:smoke
```

Wrapper exit: `0`, but node-test reported 3 failing panel rows before the wrapper forced a green exit.

Full `npm run lint` is not currently a useful clean signal because it scans `.claude/worktrees` and a large amount of pre-existing repo-wide lint debt. `npm run lint:ci` on the already-merged checkout had no changed files to lint.

## Critical Findings To Fix

### 1. Policy Gate Does Not Fail Closed For Unknown Algorithms

File:

- `src/services/governance/policy-gate.ts`
- `src/services/governance/__tests__/policy-gate.test.mts`

Problem:

`GateInput.algorithm` is optional and the interface comment says missing registry metadata should fail closed with `require_user_approval`. The implementation defaults missing metadata to:

```ts
domain: 'unknown'
criticality: 'medium'
```

That allows unknown algorithms to return `allow_auto` when evidence thresholds pass. The test suite currently locks in the unsafe behavior.

Required fix:

- If `input.algorithm` is missing, return a `PolicyVerdict` with `decision: 'require_user_approval'`.
- Include required evidence explaining that registry metadata is missing.
- Do not allow `autoApplyOnly()` to include unknown algorithms.
- Update tests so the old behavior fails.

Expected tests:

- Missing metadata + full evidence still requires user approval.
- Missing metadata + `noop` still does not become auto-apply.
- `autoApplyOnly()` excludes missing-metadata proposals.
- Known low/medium algorithms still auto-apply only when replay and sample gates pass.

### 2. Strategic Diagnostics Export Bypasses Redaction

File:

- `src/services/diagnostics/export-bundle.ts`
- `src/services/diagnostics/__tests__/export-bundle.test.mts`

Problem:

The original export bundle redacts system health, notification traces, and recent events. PR198 added these new strategic fields but passes them through directly:

- `failurePrediction`
- `qualityDebt`
- `trustBudget`
- `improvementPlan`
- `scenarioCoverage`

These can contain evidence details, reasons, recommendations, host strings, user text, email addresses, phone numbers, bearer tokens, API keys, and exact coordinates depending on upstream input.

Required fix:

- Redact the new strategic sections before placing them in the bundle.
- Prefer a generic `redactStrategicSection<T>()` structural clone using existing `redactDetail`.
- Preserve JSON shape but scrub sensitive values.
- Keep numeric aggregates and ids usable.
- Add regression tests with sensitive data embedded inside:
  - `qualityDebt[].evidence.detail`
  - `qualityDebt[].impact`
  - `qualityDebt[].recommendedFix`
  - `failurePrediction.predictions[].reasons[].text`
  - `failurePrediction.predictions[].recommendations[].text`
  - `improvementPlan.handoffOutline`
  - `trustBudget.topConcerns` or equivalent free-text fields if present

Expected tests:

- Emails and bearer tokens inside strategic sections are redacted.
- Exact `lat/lng/latitude/longitude` values inside strategic sections are coarsened.
- Bundle remains JSON round-trippable.
- Byte caps still apply after redaction.

### 3. Panel Smoke Wrapper Hides node:test Failures

Files:

- `tests/panels/run-harness.mjs`
- `tests/panels/panel-smoke.test.mts`
- `tests/panels/setup-dom.mts`
- `tests/panels/baseline.json`
- `tests/panels/README.md`

Problem:

The wrapper exits based on `.last-report.json`, not the underlying node-test process. That was intentional for regression-gating, but the latest run printed 3 node-test failures while the wrapper still exited `0`.

Observed failing rows from stdout:

- `faa-weather-cams`: `TypeError: cameras.map is not a function`
- `fear-greed`: `TypeError: Cannot read properties of undefined (reading 'length')`
- `fuel-prices`: `TypeError: Cannot read properties of undefined (reading '0')`

The generated JSON report classified those same panels as `degraded`, because the DOM still showed loading/degraded content:

- `faa-weather-cams`: degraded, reason `degraded banner .panel-loading`
- `fear-greed`: degraded, reason `degraded banner .panel-loading`
- `fuel-prices`: degraded, reason `degraded banner .panel-loading`

Required fix:

- Make post-mount async exceptions part of the structured report, not only stdout.
- Each panel report should include `asyncErrors?: string[]` or equivalent.
- If a panel has local async errors, classify it as `errored` unless the panel explicitly caught and rendered a meaningful error/degraded state after the failure.
- The wrapper must fail when `asyncErrors` exist for non-baselined panels.
- Baseline only true known broken panels, and remove stale baseline entries.

Specific cleanup:

- `tests/panels/baseline.json` still lists `breakthroughs` as silent, but latest report shows it as degraded. Remove it from the baseline after confirming.
- Keep `map` skipped unless WebGL/DeckGL/Cesium E2E coverage is run separately.

Expected tests:

- A fixture panel with fire-and-forget rejected refresh records `asyncErrors`.
- The wrapper exits non-zero for a new async-error offender.
- Baseline still allows intentional known offenders but reports them clearly.

## Panel/Data Shape Bugs To Fix

### 4. FAA Weather Cams Assumes Array Response

Files:

- `src/services/faa-cameras.ts`
- `src/components/FAAWeatherCamsPanel.ts`
- `tests/panels/panel-smoke-registry.mts`

Observed failure:

```text
TypeError: cameras.map is not a function
at scoreCamerasAgainstAlerts
```

Likely cause:

The default smoke fetch mock returns `{ ok: true, items: [], data: [] }`, but `fetchFAACameras()` casts `await res.json()` directly to `FAACamera[]`.

Required fix:

- Parse FAA camera responses defensively.
- Accept a raw array, `{ cameras: [] }`, `{ items: [] }`, or `{ data: [] }` if those are valid upstream shapes.
- Fall back to cached data or `[]` for unknown shapes.
- Add a service test for object-shaped empty responses.
- Add or update smoke fixture so the panel exercises the real empty state.

### 5. Fear & Greed Assumes `history` Exists

File:

- `src/components/FearGreedPanel.ts`

Observed failure:

```text
TypeError: Cannot read properties of undefined (reading 'length')
at buildSparkline
```

Likely cause:

Default smoke response has no `history` field.

Required fix:

- Normalize response before rendering.
- Treat missing/non-array `history` as `[]`.
- If `score` or `classification` are missing, render a degraded/unavailable state instead of throwing.
- Add tests or smoke fixture for empty object/default response.

### 6. Fuel Prices Assumes `regions` Exists

File:

- `src/components/FuelPricesPanel.ts`

Observed failure:

```text
TypeError: Cannot read properties of undefined (reading '0')
at FuelPricesPanel.renderPanel
```

Likely cause:

Default smoke response has no `regions` field.

Required fix:

- Normalize response before rendering.
- Treat missing/non-array `regions` as `[]`.
- If `regions` is empty and no key-missing state is present, render a clear unavailable/degraded state.
- Add tests or smoke fixture for empty object/default response.

## Post-Mount Async Errors From Smoke Output

The last smoke run also printed ignored async errors that were not represented as structured failures in `.last-report.json`.

Observed examples:

```text
[GDACS] Failed: TypeError: Cannot read properties of undefined (reading 'filter')
[ServiceStatus] Fetch error: TypeError: Cannot read properties of undefined (reading 'map')
[CachedTheaterPosture] Fetch error: TypeError: Cannot read properties of undefined (reading 'map')
[CachedRiskScores] Fetch error: TypeError: Cannot read properties of undefined (reading 'map')
[alert-store] Init failed: ReferenceError: indexedDB is not defined
```

### 7. Normalize Default Empty API Shapes

Files to inspect:

- `src/services/gdacs.ts`
- `src/services/infrastructure/index.ts`
- `src/services/cached-theater-posture.ts`
- `src/services/cached-risk-scores.ts`
- `tests/panels/setup-dom.mts`

Problem:

Several services assume array fields exist when smoke/default empty API responses provide `{ ok: true, items: [], data: [] }`.

Required fix:

- Either make each service parse empty object shapes safely, or make `tests/panels/setup-dom.mts` provide endpoint-specific fixtures for known generated/client routes.
- Prefer service-level validation for user-facing robustness, then use fixtures only where real shape matters.
- Add tests for malformed/empty successful responses.

Expected behavior:

- No unhandled TypeErrors from default empty responses.
- Panels render a degraded state or cached fallback.
- Smoke harness records zero post-mount async errors for these services.

### 8. IndexedDB Missing In Smoke Environment

Files:

- `src/services/alert-store.ts`
- `tests/panels/setup-dom.mts`

Observed failure:

```text
ReferenceError: indexedDB is not defined
```

Required fix:

- Decide whether panel smoke should shim IndexedDB or whether `alert-store` should degrade gracefully when IndexedDB is unavailable.
- Prefer both:
  - `alert-store` detects missing IndexedDB and uses in-memory fallback or clean unavailable behavior.
  - smoke setup provides a minimal IndexedDB shim only if the app assumes browser storage in normal runtime.

Expected tests:

- `alert-store` import/use under Node/happy-dom does not throw.
- `ThreatInboxPanel` renders degraded/empty state without unhandled rejection.

## Main Sync Bug

### 9. Local Main Sync Agent Is Failing On Tag Clobber

Files to inspect:

- `scripts/sync-main-to-mac.mjs`
- `scripts/setup-main-sync-agent.mjs`
- `~/.crystalball-main-sync/status.json`
- `~/.crystalball-main-sync/logs/main-sync.stderr.log`

Current status:

```json
{
  "phase": "failed",
  "checkedAt": "2026-04-28T23:35:29.603Z",
  "error": "From https://github.com/bradleybond512/crystal-ball\n * branch            main       -> FETCH_HEAD\n ! [rejected]        v2.10.5    -> v2.10.5  (would clobber existing tag)"
}
```

Repeated stderr:

```text
! [rejected] v2.10.5 -> v2.10.5 (would clobber existing tag)
```

Impact:

The local Mac install sync is not getting past fetch, so even if `main` is green, Bradley's installed app may not update.

Required fix:

- Inspect how `sync-main-to-mac.mjs` fetches tags.
- Avoid failing the entire sync on stale/conflicting historical tags.
- Fetch the target branch safely first.
- For release tags, verify only the tag relevant to the target version, or fetch tags with an explicit safe strategy.
- Do not silently accept a mutable release tag for the active release.

Expected behavior:

- Historical conflicting tags do not block syncing `main`.
- Active target release tag integrity remains fail-closed.
- `npm run main-sync:run` succeeds or fails with an actionable reason unrelated to old tag conflicts.

Expected verification:

```bash
npm run main-sync:run
cat ~/.crystalball-main-sync/status.json
```

## Route Audit Status

Latest route audit:

```text
Renderer route call sites: 222
Sidecar route handlers: 151
Dangling client calls: 0
Sidecar-only routes: 22
```

This is acceptable for now. Do not spend the bug-smash on sidecar-only routes unless one of them is unexpectedly dead or meant to be used by the renderer.

## Suggested Implementation Order

1. Fix policy-gate fail-closed behavior and tests.
2. Fix strategic export redaction and tests.
3. Make panel smoke preserve async errors in structured output and fail on new async offenders.
4. Fix the three concrete panel/data-shape crashes:
   - FAA weather cams
   - Fear & Greed
   - Fuel Prices
5. Fix or normalize the additional post-mount async errors:
   - GDACS
   - Service Status
   - Cached Theater Posture
   - Cached Risk Scores
   - Alert Store / IndexedDB
6. Clean `tests/panels/baseline.json`.
7. Fix main-sync tag clobber failure.
8. Re-run the full verification set.

## Required Verification

Run these commands before opening the PR:

```bash
npm run test:strategic-self-improvement
npx tsx --test \
  src/services/governance/__tests__/policy-gate.test.mts \
  src/services/diagnostics/__tests__/export-bundle.test.mts \
  src/services/quality/__tests__/quality-debt-adapters.test.mts
npm run scenarios:check
npm run test:panels:smoke
npm run typecheck:all
node scripts/release-doctor.mjs --allow-existing-target-release --variant full
npm run main-sync:run
```

Panel-smoke acceptance criteria:

- wrapper exits `0`
- `.last-report.json` has:
  - `silent: 0`
  - `errored: 0`
  - no unbaselined `asyncErrors`
- stdout does not contain ignored TypeErrors for normal empty responses
- stale baseline entries are removed

Main-sync acceptance criteria:

- `~/.crystalball-main-sync/status.json` is not stuck on tag clobber
- sync either installs successfully or stops on a current, meaningful release/install gate

## Open Risks And Assumptions

- Local commands above were run under Node `v25.8.2`, while repo engines expect Node `>=22 <23`. Claude should verify under Node 22 before final signoff.
- Full repo lint is currently noisy because it includes `.claude/worktrees` plus broad existing lint debt. Use changed-file lint and touched-file lint unless the task includes global lint cleanup.
- `map` remains skipped in panel smoke because it needs WebGL/DeckGL/Cesium coverage. Keep it covered by E2E rather than forcing it into happy-dom.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Start from a fresh branch off macos/main or origin/main. Do not commit directly to main.

Task: run a PR198 bug-smash hardening pass. Use docs/CLAUDE_PR198_BUG_SMASH_ROADMAP_2026-04-28.md as the source of truth.

Fix these in order:

1. Make src/services/governance/policy-gate.ts fail closed when GateInput.algorithm is missing. Unknown algorithms must require user approval and must never appear in autoApplyOnly().

2. Redact the new strategic diagnostics export sections in src/services/diagnostics/export-bundle.ts:
   - failurePrediction
   - qualityDebt
   - trustBudget
   - improvementPlan
   - scenarioCoverage if it ever contains free text
   Add regression tests with emails, bearer tokens, API-key-like fields, and lat/lng inside these sections.

3. Fix tests/panels/run-harness.mjs and tests/panels/panel-smoke.test.mts so post-mount async errors are part of the JSON report and fail the wrapper for new offenders. Do not let node-test failures disappear behind a green wrapper exit.

4. Fix the concrete panel/data-shape crashes seen in smoke:
   - faa-weather-cams: cameras.map is not a function
   - fear-greed: history.length on undefined
   - fuel-prices: regions[0] on undefined

5. Fix or normalize the additional smoke async errors:
   - GDACS undefined filter
   - ServiceStatus undefined map
   - CachedTheaterPosture undefined map
   - CachedRiskScores undefined map
   - alert-store indexedDB missing

6. Clean tests/panels/baseline.json. Remove breakthroughs if it is no longer silent.

7. Fix local main sync tag-clobber failure in scripts/sync-main-to-mac.mjs without weakening active release-tag integrity.

Verify under Node 22 if possible:
   npm run test:strategic-self-improvement
   npx tsx --test src/services/governance/__tests__/policy-gate.test.mts src/services/diagnostics/__tests__/export-bundle.test.mts src/services/quality/__tests__/quality-debt-adapters.test.mts
   npm run scenarios:check
   npm run test:panels:smoke
   npm run typecheck:all
   node scripts/release-doctor.mjs --allow-existing-target-release --variant full
   npm run main-sync:run

In the PR, include exact before/after smoke counts, any remaining baselined panels, and the final ~/.crystalball-main-sync/status.json phase.
```
