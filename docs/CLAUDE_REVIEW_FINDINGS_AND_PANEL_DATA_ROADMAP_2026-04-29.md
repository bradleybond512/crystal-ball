# Claude Roadmap: Review Findings And Panel Data Functionality

Date: 2026-04-29

## Goal

Address the three current review findings, then continue into the broader reason many panels appear to have no data. The target outcome is not just "tests pass"; Crystal Ball should fail closed for unsafe automation, redact diagnostics exports consistently, make panel smoke trustworthy, and distinguish real no-data problems from harness artifacts.

## Current Inputs

Review findings to address:

1. `src/services/governance/policy-gate.ts`
   Missing algorithm registry metadata can still auto-apply.
2. `src/services/diagnostics/export-bundle.ts`
   Strategic diagnostics export bypasses redaction.
3. `tests/panels/run-harness.mjs`
   Panel smoke can exit green even when `node:test` reports panel failures.

Additional Codex investigation:

- Panel smoke reported `197` degraded panels, but most are not proof of live data failure.
- A trace across the smoke registry showed:
  - `197` degraded panels
  - `187` degraded panels made zero fetch calls during isolated smoke mount
  - `150` were simply stuck on `.panel-loading`
  - only `10` degraded panels actually fetched anything during mount
- The live sidecar is healthy and returns real data for several routes:
  - `/api/fear-greed`
  - `/api/fuel-prices`
  - `/api/national-debt`
  - `/api/faa-cameras`
  - `/api/nws-alerts`
  - `/api/space-weather`
  - `/api/news/v1/list-feed-digest`
- Real remaining data issues include missing keys, missing local handlers, upstream rate limits, and slow refreshes.

## Priority 1: Fix Policy Gate Fail-Closed Behavior

### Problem

`GateInput.algorithm` is optional, and the interface says missing registry metadata should fail closed. The unsafe behavior is defaulting unknown algorithms to medium criticality/domain unknown, which can return `allow_auto` when enough evidence is present.

### Required Fix

File:

- `src/services/governance/policy-gate.ts`

Implementation:

- If `input.algorithm` is absent, immediately return:
  - `decision: 'require_user_approval'`
  - a clear reason that algorithm registry metadata is missing
  - `requiredEvidence` that includes registering the algorithm
  - a stable rule id such as `policy_gate_unknown_algorithm`
- Do not call `evaluatePolicy()` for unknown algorithms.
- Ensure `autoApplyOnly()` can never include a missing-metadata proposal.

Tests:

- `src/services/governance/__tests__/policy-gate.test.mts`

Add or update tests for:

- unknown algorithm with high evidence still requires user approval
- unknown algorithm with no evidence requires user approval
- unknown noop still requires user approval
- `autoApplyOnly()` excludes unknown algorithms

Verification:

```bash
npx tsx --test src/services/governance/__tests__/policy-gate.test.mts
npm run test:algorithms
npm run typecheck:all
```

## Priority 2: Redact Strategic Diagnostics Sections

### Problem

The original export bundle redacts system health, traces, and events. Strategic sections added later can contain free-text evidence, reasons, recommendations, and handoff text, but they are passed through directly.

Sensitive sections:

- `qualityDebt`
- `failurePrediction`
- `trustBudget`
- `improvementPlan`
- `scenarioCoverage`

### Required Fix

File:

- `src/services/diagnostics/export-bundle.ts`

Implementation:

- Add a generic structural redaction helper:

```ts
function redactStrategicSection<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  return redactDetail(value) as T;
}
```

- Apply it to every strategic section before adding the section to the final bundle.
- Keep truncation behavior for `qualityDebt`, then redact the capped list before export.

Tests:

- `src/services/diagnostics/__tests__/export-bundle.test.mts`

Add or update tests proving redaction inside:

- `qualityDebt[].evidence.detail`
- `qualityDebt[].impact`
- `qualityDebt[].recommendedFix`
- `failurePrediction.predictions[].reasons[].text`
- `failurePrediction.predictions[].recommendations[].text`
- `trustBudget` free-text concerns
- `improvementPlan` handoff outline

Verification:

```bash
npx tsx --test src/services/diagnostics/__tests__/export-bundle.test.mts
npm run test:diagnostics
npm run typecheck:all
```

## Priority 3: Make Panel Smoke Exit Match Real Failures

### Problem

The wrapper exits from the JSON report only. That hid a run where `node:test` reported failing rows for:

- `faa-weather-cams`
- `fear-greed`
- `fuel-prices`

The harness is useful as a structured report, but it must not hide test-run failures or async panel failures.

### Required Fix

Files:

- `tests/panels/run-harness.mjs`
- `tests/panels/panel-smoke.test.mts`
- `tests/panels/baseline.json`

Implementation:

- Capture post-mount unhandled rejections per panel as `asyncErrors`.
- Treat any non-baselined panel with `asyncErrors.length > 0` as a wrapper failure.
- Preserve the structured state gate for `silent` and `errored`.
- Keep the baseline empty unless there is a separately documented known-broken panel.
- If `node:test` exits non-zero but no JSON report exists, fail hard.
- If `node:test` exits non-zero due to structured async panel offenders, surface those panel ids in the wrapper output.

Tests:

- Add a harness-level regression test if practical.
- At minimum, use the known previously failing panels as verification:
  - `faa-weather-cams`
  - `fear-greed`
  - `fuel-prices`

Verification:

```bash
npm run test:panels:smoke
```

Expected:

- `node:test` reports `0` failures
- wrapper exits `0` only when there are no new `silent`, `errored`, or async-error offenders
- final report includes panel counts

## Priority 4: Separate Real Panel Data Gaps From Smoke Harness Artifacts

### Problem

Most degraded smoke panels did not fetch data at all. They are mounted alone, but the real app usually creates panels and then `DataLoader.loadAllData()` pushes data into them.

This means the current smoke number overstates live data breakage and understates harness incompleteness.

### Required Fix

Create a panel data contract registry.

Suggested file:

- `tests/panels/panel-data-contracts.mts`

Each panel should be classified as one of:

- `self-fetches`
- `updated-by-data-loader`
- `requires-user-config`
- `requires-api-key`
- `static-local`
- `fixture-only-testable`
- `intentionally-degraded-in-isolated-smoke`

For each `updated-by-data-loader` panel, record:

- update method name, such as `update`, `setData`, `renderNews`, `renderMarkets`
- loader owner, such as `src/app/data-loader.ts` or `src/app/loaders/*.ts`
- representative fixture shape

Tests:

- Add a test that every panel in `tests/panels/panel-smoke-registry.mts` has a data contract.
- Add a test that every `updated-by-data-loader` contract has either:
  - a fixture-backed functional test, or
  - an explicit reason it cannot be fixture-tested yet.

Verification:

```bash
npx tsx --import ./tests/panels/register-hook.mjs --test tests/panels/panel-fixtures.test.mts
npm run test:panels:smoke
npm run typecheck:all
```

## Priority 5: Expand Fixture-Backed Functional Panel Tests

### Problem

Smoke proves "not silent and not thrown" but does not prove most panels can render useful data.

### Required Fix

Files:

- `tests/panels/panel-fixtures.mts`
- `tests/panels/panel-fixtures.test.mts`
- `tests/panels/panel-smoke-registry.mts`

Add fixture-backed functional coverage for high-value panels first:

- `markets`
- `commodities`
- `crypto`
- `economic`
- `nws-alerts`
- `gdacs-alerts`
- `earthquakes`
- `air-quality`
- `cyber-threats`
- `space-weather`
- `disease-outbreaks`
- `humanitarian-crisis`
- `infrastructure`
- `openSanctions`
- `service-status`
- `faa-weather-cams`
- `fear-greed`
- `fuel-prices`
- `national-debt`

Expected behavior:

- Tests should install representative endpoint fixtures or call the same panel update methods used by `DataLoader`.
- A fixture-backed panel should assert a `rendered` state, not just `degraded`.
- Keep separate tests for valid degraded states, such as missing config or empty saved places.

Verification:

```bash
npm run test:panels:fixtures
npm run test:panels:smoke
```

## Priority 6: Fix Missing Or Mismatched Local Sidecar Handlers

### Problem

The live sidecar returns shape-aware degraded payloads for missing handlers. That prevents crashes, but it can hide the fact that important routes are unavailable locally.

Observed no-local-handler routes include:

- `/api/acled`
- `/api/ais-clusters`
- `/api/usgs-earthquakes`
- `/api/tags`
- `/api/gdelt-tensions`
- `/api/extended-forecast`
- `/api/tide-predictions`
- `/api/news`
- `/api/fred-data`

Some of these have working replacements:

- `/api/fred-series`
- `/api/fred-fallback`
- `/api/economic/v1/get-fred-series`
- `/api/news/v1/list-feed-digest`
- `/api/newsapi-headlines`
- `/api/newsdata-feed`
- `/api/gdacs`

### Required Fix

Files:

- `src-tauri/sidecar/local-api-server.mjs`
- `api/`
- `src/services/*`
- `src/app/data-loader.ts`

Implementation:

- For each missing route, decide whether to:
  - add a real local handler
  - update frontend callers to use the new canonical route
  - classify as intentionally degraded
  - remove dead route usage
- Add route tests for any new or changed sidecar route.
- Avoid adding fake "success" data. Use explicit degraded payloads when a provider is missing.

High-priority route decisions:

- `ACLED`: requires `ACLED_ACCESS_TOKEN` and `ACLED_EMAIL`; keep fail-closed but make UI action clear.
- `FRED`: update legacy `/api/fred-data` callers/docs to canonical `/api/fred-series` or RPC route.
- `news`: prefer `/api/news/v1/list-feed-digest`; avoid legacy `/api/news` unless implemented.
- `extended-forecast` and `tide-predictions`: these are direct public upstream services in frontend services; either add sidecar handlers or remove stale sidecar route expectations.
- `usgs-earthquakes`: frontend should use existing `/api/earthquakes` or add alias handler.

Verification:

```bash
npm run test:sidecar
npm run test:api
npm run test:panels:smoke
npm run typecheck:all
```

## Priority 7: Surface Provider And Credential Problems In The UI

### Problem

Some panels look empty because credentials or upstreams are missing, rate-limited, or down. The UI should tell the user exactly what is wrong.

Missing keys observed:

- `ACLED_ACCESS_TOKEN`
- `ACLED_EMAIL`
- `GEONAMES_USERNAME`
- `ABUSEIPDB_API_KEY`
- `SHODAN_API_KEY`
- `ANTHROPIC_API_KEY`

Upstream/provider problems observed:

- OpenSky / ADS-B: `429` or `503`
- Open-Meteo climate calls: repeated `429`
- ECDC: repeated fetch failures
- NOAA/NDBC/WPC: fetch failure bursts
- GDELT tensions: repeated `503`
- individual RSS feeds fail

### Required Fix

Files:

- `src/components/*Panel.ts`
- `src/components/SystemDiagnosticPanel.ts`
- `src/components/ApiDiagnosticPanel.ts`
- `src/services/diagnostics/*`
- `src/services/runtime-config.ts`

Implementation:

- Panels that require keys should show:
  - key name
  - feature impacted
  - settings action
  - whether degraded data is being retained
- API Diagnostic should group:
  - missing credentials
  - rate-limited providers
  - unavailable upstreams
  - missing local handlers
- System Diagnostic should treat repeated missing-handler or rate-limit bursts as quality debt.

Verification:

```bash
npm run test:diagnostics
npm run test:panels:smoke
npm run typecheck:all
```

## Priority 8: Reduce Slow Refreshes That Keep Panels Looking Empty

### Problem

Desktop logs show many slow refreshes. Examples observed:

- `news`: roughly `16s` to `110s`
- `markets`: often `7s` to `40s`
- `intelligence`: often `30s` to `40s`
- `economicStress`: roughly `8s`
- `faa-weather-cams`: roughly `7s` to `15s`

### Required Fix

Files:

- `src/app/data-loader.ts`
- `src/app/loaders/*.ts`
- `src/services/*`
- `src-tauri/sidecar/local-api-server.mjs`

Implementation:

- Add per-task timing into diagnostics, not only console logs.
- Show stale cached data while refresh continues.
- Add backoff/cooldown UI state for rate-limited sources.
- Cap concurrency for noisy upstreams.
- Use route-level caching for slow sidecar requests.
- Prefer digest endpoints for news over individual feed fan-out when available.

Verification:

```bash
npm run test:diagnostics
npm run test:panels:smoke
npm run build
npm run bundle:check
```

Manual verification:

- Launch desktop.
- Confirm panels show cached/stale data quickly.
- Confirm slow refreshes do not leave panels in indefinite loading.

## Required Final Verification

Before opening or marking the PR ready:

```bash
npm run lint:ci
npm run lint:md
npm run secrets:scan
npm run typecheck:all
npm run test:diagnostics
npm run test:algorithms
npm run test:strategic-self-improvement
npm run test:panels:fixtures
npm run test:panels:smoke
npm run test:sidecar
npm run test:api
npm run scenarios:check
npm run build
npm run bundle:check
```

If local environment supports it:

```bash
npm run desktop:build:app:full
node scripts/release-doctor.mjs --allow-existing-target-release --variant full
```

## PR Notes Claude Should Include

Include these in the PR body:

- Which review findings were fixed.
- Exact policy-gate behavior for unknown algorithms.
- Exact strategic export sections covered by redaction.
- Panel smoke before/after counts.
- Fixture-backed panel functional coverage added.
- Missing local handlers fixed, aliased, or intentionally classified.
- Remaining missing keys and upstream limitations.
- Slowest refresh tasks before/after if measured.
- Any skipped checks and why.

## Ready-To-Paste Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: address the current review findings and the panel data functionality gaps documented in docs/CLAUDE_REVIEW_FINDINGS_AND_PANEL_DATA_ROADMAP_2026-04-29.md.

Start by reading:
- AGENTS.md
- docs/CLAUDE_REVIEW_FINDINGS_AND_PANEL_DATA_ROADMAP_2026-04-29.md
- docs/CLAUDE_GET_FUNCTIONALITY_PASS_TO_MAIN_2026-04-29.md

Tasks:
1. Fix policy-gate fail-closed behavior for missing algorithm metadata.
2. Redact all strategic diagnostics export sections.
3. Make panel smoke fail on real node:test/async panel failures instead of hiding them.
4. Add panel data contracts so smoke distinguishes self-fetch panels from data-loader-driven panels.
5. Expand fixture-backed panel tests for high-value panels.
6. Fix, alias, or classify missing local sidecar handlers.
7. Surface missing credentials, rate limits, and upstream failures clearly in UI diagnostics.
8. Reduce slow refresh behavior so panels show cached/stale data instead of indefinite loading.
9. Run the required verification suite from the roadmap.
10. Push the agent branch, open or update a PR to main, wait for required checks, and use GitHub auto-merge. Do not direct-merge.

Stage files explicitly. Do not use git add . or git add -A.
Every commit must include:
Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>
```
