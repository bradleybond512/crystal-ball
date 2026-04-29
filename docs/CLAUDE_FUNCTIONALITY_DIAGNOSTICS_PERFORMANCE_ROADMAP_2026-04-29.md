# Claude Roadmap: Functionality, Diagnostics, Performance, Algorithm, And UI Polish

Date: 2026-04-29

## Goal

Take the current post-PR199 system from "stable and non-crashing" to "as functional as we expect." The previous bug-smash fixed the obvious safety and smoke-test issues. This pass should improve diagnostic truthfulness, live-data confidence, algorithm self-improvement wiring, performance, and UI quality.

## Current Baseline

Current shipped state:

- `origin/main`: `55e9292871646e0a162c0526d2c718be2c2fd373`
- PR `#199`: merged
- Local main-sync installed the same SHA to `/Users/bradleybond/Applications/Crystal Ball.app`
- `~/.crystalball-main-sync/status.json`: `phase: "idle"`, `installedSha === targetSha`

Fresh checks:

```bash
npm run test:strategic-self-improvement
```

Result: `130/130` pass.

```bash
npx tsx --test \
  src/services/governance/__tests__/policy-gate.test.mts \
  src/services/diagnostics/__tests__/export-bundle.test.mts \
  src/services/quality/__tests__/quality-debt-adapters.test.mts
```

Result: `49/49` pass.

```bash
npm run scenarios:check
```

Result: OK, 10 scenarios across all 8 mission domains.

```bash
npm run test:panels:smoke
```

Result:

- node tests: `233/233` pass
- panel count: `230`
- rendered: `32`
- degraded: `197`
- silent: `0`
- errored: `0`
- skipped: `1` (`map`)
- async error panels: `0`
- sidecar audit: `222` renderer calls, `151` handlers, `0` dangling, `22` sidecar-only

```bash
npm run typecheck:all
node scripts/release-doctor.mjs --allow-existing-target-release --variant full
npm run secrets:scan
npm run lint:ci
npm run bundle:check
```

Results:

- typecheck: pass
- release doctor: OK for `v2.10.21`
- secret scan: 2045 files clean
- changed-file lint: pass
- bundle policy: pass

Important environment caveat:

- Local shell used Node `v25.8.2`
- Repo engines expect Node `>=22 <23`
- CI and main-sync are stronger signals for Node 22 behavior

## Reality Summary

The system is now stable enough to build on. The next problem is not crash prevention. The next problem is operational usefulness.

Main gaps:

- Diagnostics panels still report mostly empty synthetic state rather than live source/provider/sidecar truth.
- The smoke harness proves panels do not crash, but not that most panels render meaningful real-data states.
- Algorithm self-improvement primitives exist, but the UI still shows ungated proposals and no live tuning path.
- The exported frontend diagnostic bundle is pure and tested, but the desktop `Cmd+Shift+D` diagnostics path is still a separate Rust/log bundle and does not include the new strategic sections.
- Bundle size is within policy, but raw chunk shape suggests meaningful performance work remains.
- Several UI panels are functionally "degraded acceptable" under smoke, but that is not the same as end-user usefulness.

## Priority 1: Make Diagnostics Truthful In The UI

### Problem

`SystemDiagnosticPanel` and `CommandCenterPanel` still use empty source/provider snapshots and hard-coded unknown sidecar status.

Files:

- `src/components/SystemDiagnosticPanel.ts`
- `src/components/CommandCenterPanel.ts`
- `src/services/diagnostics/diagnostics-state.ts`
- `src/services/diagnostics/system-health.ts`
- `src/services/insights/insights-state.ts`

Current evidence:

In `SystemDiagnosticPanel.collect()`:

- `sources: never[] = []`
- `providers: never[] = []`
- sidecar reason: `Sidecar adapter not wired into the diagnostic panel yet.`
- feed audit receives `snapshots: []`

In `CommandCenterPanel.buildHtml()`:

- `contextFromSnapshots({ panels, sources: [], providers: [] })`
- sidecar reason: `Sidecar adapter not wired into Command Center yet.`
- `auditFeeds({ sentinels, snapshots: [] })`

Why it matters:

The panels can say the app is warming up, unknown, or clear while real sidecar/provider/source state exists elsewhere. That makes the diagnostic surface less trustworthy than the pure services behind it.

### Fix

Create a diagnostics snapshot aggregator that exposes one live snapshot object:

```ts
interface LiveDiagnosticsSnapshot {
  panels: PanelHealth[];
  sources: SourceDiagnostic[];
  providers: ProviderHealthRecord[];
  sidecar: SidecarHealth;
  feedSnapshots: FeedHealthSnapshot[];
  notificationSummary: NotificationTraceSummary;
  recentEvents: DiagnosticEvent[];
}
```

Likely files:

- `src/services/diagnostics/diagnostics-state.ts`
- `src/services/diagnostics/live-diagnostics-snapshot.ts`
- `src/components/SystemDiagnosticPanel.ts`
- `src/components/CommandCenterPanel.ts`
- `src/app/data-loader.ts`
- `src/app/refresh-scheduler.ts`

Implementation notes:

- Wire source freshness from existing `dataFreshness`, status panel updates, or API diagnostic surfaces.
- Wire provider health from provider redundancy snapshots where available.
- Wire sidecar status from the desktop/local API state or `/api/diag` if reachable.
- Wire feed snapshots into `auditFeeds()` instead of passing `[]`.
- Keep this pure at the service layer. Panels should render snapshots, not fetch on their own.

Verification:

```bash
npm run test:diagnostics
npm run test:panels:smoke
npm run typecheck:all
```

Add focused tests showing:

- Sidecar failing flips system health to failing.
- Stale feed snapshots appear in System Diagnostic → Feeds.
- Command Center risk label reflects live source/provider failures.

## Priority 2: Connect Strategic Diagnostics To The Actual Export Path

### Problem

`src/services/diagnostics/export-bundle.ts` now supports schema v2 strategic sections, but the desktop `Cmd+Shift+D` path still calls the Tauri `copy_diagnostics` command, which returns logs and `/api/diag` text from Rust.

Files:

- `src/services/log-bridge.ts`
- `src-tauri/src/main.rs`
- `src/services/diagnostics/export-bundle.ts`
- `src/services/diagnostics/diagnostics-state.ts`

Current evidence:

- `log-bridge.ts` calls `invokeTauri<string>('copy_diagnostics', {})`
- `src-tauri/src/main.rs::copy_diagnostics()` builds a plain text bundle with:
  - desktop log tail
  - local API log tail
  - `/api/diag`
- It does not call frontend `buildExportBundle()`
- It cannot include `failurePrediction`, `qualityDebt`, `trustBudget`, `improvementPlan`, or `scenarioCoverage` unless the frontend appends them

### Fix

Add a frontend diagnostics-export composer that:

- collects the live diagnostics snapshot from Priority 1
- computes strategic sections
- calls `buildExportBundle()`
- serializes markdown or JSON
- appends Rust log bundle as an appendix instead of replacing the structured frontend bundle

Suggested shape:

- `src/services/diagnostics/frontend-export-composer.ts`
- `composeFrontendDiagnosticsExport(options)`
- `copyDiagnostics()` in `log-bridge.ts` calls frontend composer first, then Tauri logs

Verification:

```bash
npm run test:diagnostics
npx tsx --test src/services/diagnostics/__tests__/export-bundle.test.mts
npm run typecheck:all
```

Add tests showing:

- `Cmd+Shift+D` export includes `schemaVersion: 2`
- strategic sections are present when inputs exist
- Tauri log appendix failures do not prevent frontend bundle creation
- sensitive strings are redacted after composition, not just in unit fixtures

## Priority 3: Make Panel Smoke Prove Functional States, Not Just Non-Crashing States

### Problem

Panel smoke is now reliable, but it mostly proves degraded fallback behavior.

Latest smoke:

- rendered: `32`
- degraded: `197`
- skipped: `1`

Top degraded reasons:

- `.panel-loading`: `154`
- `.panel-empty`: `25`
- no-data text: `10`
- `.error-message`: `5`
- loading text: `3`

This is acceptable for crash gating, but it does not prove that the majority of panels render meaningful populated data.

Files:

- `tests/panels/panel-smoke-registry.mts`
- `tests/panels/fixture-store.mts`
- `tests/panels/setup-dom.mts`
- `tests/panels/panel-smoke.test.mts`

### Fix

Add a second smoke mode:

```bash
npm run test:panels:fixtures
```

Goal:

- endpoint-specific fixtures for the top 30-50 most important panels
- assert each fixture-backed panel reaches `rendered`, not merely `degraded`
- keep the existing empty-response smoke as the crash/degraded contract

Start with these high-value panels:

- `command-center`
- `system-diagnostic`
- `algorithm-diagnostic`
- `api-diagnostic`
- `alert-center`
- `hazard-alerts`
- `shortage-radar`
- `strategic-risk`
- `strategic-posture`
- `faa-weather-cams`
- `fear-greed`
- `fuel-prices`
- `internet-disruptions`
- `national-debt`
- `service-status`
- `threat-inbox`
- `weather-radar`
- `nws-alerts`
- `gdelt-intel`
- `live-news`

Verification:

```bash
npm run test:panels:smoke
npm run test:panels:fixtures
```

Acceptance criteria:

- empty smoke remains `0 silent`, `0 errored`, `0 asyncErrors`
- fixture smoke has a rising rendered target, initially at least 50 key panels
- fixture smoke fails if a key panel remains loading after fixture data is available

## Priority 4: Wire Policy Gate Into Algorithm Diagnostic UI

### Problem

`policy-gate.ts` is fixed and tested, but `AlgorithmDiagnosticPanel` still renders raw `safe-adjustment` proposals without policy verdicts.

Files:

- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/services/algorithms/safe-adjustment.ts`
- `src/services/governance/policy-gate.ts`
- `src/services/algorithms/algorithm-registry.ts`

Current evidence:

`AlgorithmDiagnosticPanel` does:

```ts
const proposals = proposeAdjustments({ reports: [...report.algorithms], tunings: [] });
```

It does not:

- pass real tunables
- call `gateAdjustmentProposal()`
- show whether a proposal is `allow_auto`, `require_user_approval`, `require_pr_review`, or `deny`
- show missing evidence from policy verdicts

### Fix

Add policy-gated proposal rendering:

- map `AlgorithmHealth` rows to registry definitions
- add a tunable catalog for the algorithms that can be tuned
- call `gateAdjustmentProposal()` for every non-noop proposal
- render the policy verdict next to each proposal
- show required evidence and why auto-apply is blocked
- never imply a proposal can be applied when policy says review/approval/deny

Recommended UI labels:

- `Allowed automatically`
- `Needs user approval`
- `Needs PR review`
- `Denied`

Verification:

```bash
npm run test:algorithms
npx tsx --test src/services/governance/__tests__/policy-gate.test.mts
npm run test:panels:smoke
npm run typecheck:all
```

Add a panel-level smoke/fixture assertion that `algorithm-diagnostic` displays policy-gate states when seeded with proposals.

## Priority 5: Feed Quality Debt From Real Live Diagnostics

### Problem

Quality-debt adapters exist, but live quality debt does not appear to be populated from the live app loop yet.

Files:

- `src/services/quality/quality-debt.ts`
- `src/services/quality/quality-debt-adapters.ts`
- `src/services/quality/self-improvement-scheduler.ts`
- `src/services/diagnostics/diagnostics-state.ts`
- `tests/panels/.last-report.json`

### Fix

Create one live quality-debt collector:

- reads panel smoke summaries when available in dev/CI
- reads provider snapshots
- reads algorithm health
- reads failure prediction
- records deterministic debt items into a shared registry
- exposes active debt to System Diagnostic and export bundle

Add a lightweight UI section:

- System Diagnostic → `Quality Debt`
- Command Center shows top 1-3 current debt items only when severity is high/critical

Verification:

```bash
npm run test:strategic-self-improvement
npm run test:diagnostics
npm run test:panels:smoke
```

Acceptance criteria:

- real high-risk diagnostics become debt items
- duplicate signals collapse to one item
- resolved items require evidence
- export bundle includes capped, redacted active debt

## Priority 6: Performance Pass For Panel Chunk And First-Load Work

### Current Evidence

Bundle policy passes:

```text
total JS gzip: 3.31 MB / 6.00 MB
GodsVisionView raw: 4.00 MB, gzip 1.06 MB
panels raw: 2.35 MB, gzip 670.3 KB
main raw: 1006.2 KB, gzip 270.1 KB
deck-stack raw: 988.8 KB, gzip 268.0 KB
maplibre raw: 1001.6 KB, gzip 263.0 KB
```

Policy passes, but the `panels` chunk is a large raw chunk and the app initializes many panels/timers/listeners.

Files:

- `vite.config.ts`
- `src/app/panel-layout.ts`
- `src/components/index.ts`
- `src/config/panels.ts`
- individual panel imports in `panel-layout.ts`

### Fix

Do not chase arbitrary micro-optimizations. Focus on structural wins:

1. Split panels chunk by variant or domain:
   - `panels-core`
   - `panels-full-intel`
   - `panels-finance`
   - `panels-happy`
   - heavy/rare panels lazy-loaded on open

2. Lazy-mount panels not visible in the current viewport/sidebar category.

3. Use the smoke registry and panel config to ensure dynamic imports still cover every panel.

4. Add bundle budget reporting for raw chunk size, not only gzip, because desktop install/build and parse cost care about raw bytes.

Verification:

```bash
npm run build:full
npm run bundle:check
npm run test:panels:smoke
npm run test:e2e:runtime
```

Acceptance criteria:

- bundle policy remains green
- no missing dynamic panel imports
- first visible panels still mount without user-visible blank states
- raw `panels` chunk shrinks or is split into clearer lazy chunks

## Priority 7: Timer And Listener Hygiene

### Problem

The codebase has many `setInterval`, `setTimeout`, document listeners, window listeners, and observers. Some have cleanup paths; some are global one-time app wiring; some are unclear. This is a common source of performance drift in a long-lived desktop app.

Files to inspect first:

- `src/app/panel-layout.ts`
- `src/app/event-handlers.ts`
- `src/app/data-loader.ts`
- `src/services/intel-channels-bridge.ts`
- `src/services/sound-manager.ts`
- `src/services/maritime/index.ts`
- `src/services/geofence-alerts.ts`
- `src/services/periodicity-detector.ts`
- `src/services/blackout-signature.ts`
- `src/services/proximity-cascade.ts`
- `src/components/SystemDiagnosticPanel.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/components/CommandCenterPanel.ts`

### Fix

Add a timer/listener registry for app-owned recurring work:

- register interval names
- expose active timer count in diagnostics
- avoid duplicate startup registration
- pause low-priority polling when document is hidden or low-power mode is on

Do not refactor every listener at once. Start with recurring intervals and app startup listeners.

Verification:

```bash
npm run test:e2e:runtime
npm run test:panels:smoke
npm run typecheck:all
```

Add a test or diagnostic probe:

- repeated app initialization does not double-register named loops
- low-power mode pauses noncritical loops
- System Diagnostic shows active recurring loops

## Priority 8: UI Functional Quality Checks

### Problem

Smoke tests confirm DOM output, but they do not check whether compact panels are readable, actions are discoverable, or diagnostic copy is useful. The latest smoke has many panels with tiny text length and loading banners. That is fine for empty state, but key panels should have professional, helpful empty/error states.

Files:

- `src/components/EmptyState.ts`
- `src/components/SystemDiagnosticPanel.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/components/CommandCenterPanel.ts`
- `src/components/FAAWeatherCamsPanel.ts`
- `src/components/FearGreedPanel.ts`
- `src/components/FuelPricesPanel.ts`
- `src/components/InternetDisruptionsPanel.ts`
- `src/components/NationalDebtPanel.ts`

### Fix

Add UI quality expectations for key panels:

- empty state must name the missing data source
- degraded state must explain whether user action is needed
- API-key-gated panel must name the setting/key
- diagnostic panel must show what is live, stale, and unknown
- no panel should stay as generic `Loading...` after its fetch promise settles

Verification:

```bash
npm run test:panels:smoke
npm run test:e2e:runtime
npm run test:e2e:full -- --grep "diagnostic|command|settings"
```

If targeted E2E names do not exist, add a small Playwright spec covering:

- Command Center visible and non-overlapping
- System Diagnostic tab switching
- Algorithm Diagnostic shows no false auto-apply claim
- Settings diagnostics/debug actions remain usable

## Priority 9: Desktop Diagnostics Warning Cleanup

### Problem

Main-sync install succeeded, but the Rust build emitted a warning:

```text
warning: calls to std::mem::forget with a value that implements Copy does nothing
src/main.rs:2339:5
```

File:

- `src-tauri/src/main.rs`

### Fix

Replace the no-op `std::mem::forget(mgr)` with the compiler-suggested safe ignore or the correct ownership behavior.

Verification:

```bash
npm run desktop:build:app:full
```

Acceptance:

- desktop app builds
- warning removed or explicitly documented if intentional

## Priority 10: Route Audit Follow-Up

### Current Evidence

Sidecar route audit:

- renderer route calls: `222`
- sidecar handlers: `151`
- dangling client calls: `0`
- sidecar-only routes: `22`

Sidecar-only routes are not a blocker, but the list should be classified:

- intentional internal/admin
- future UI surface
- dead route

Files:

- `tests/panels/sidecar-routes-audit.test.mts`
- `src-tauri/sidecar/local-api-server.mjs`
- `api/`

### Fix

Add a checked allowlist with categories:

```json
{
  "intentionalInternal": [],
  "futureUi": [],
  "deprecated": []
}
```

Fail CI only for new unclassified sidecar-only routes.

Verification:

```bash
npm run test:panels:smoke
```

## Suggested Implementation Order

1. Live diagnostics snapshot aggregator.
2. Frontend diagnostics export composer wired into `Cmd+Shift+D`.
3. Policy-gated Algorithm Diagnostic UI.
4. Live quality-debt collector and System Diagnostic section.
5. Fixture-backed panel functional smoke mode.
6. Timer/listener registry for recurring work.
7. Panel chunk/lazy-mount performance pass.
8. Key-panel UI empty/degraded quality pass.
9. Rust warning cleanup.
10. Sidecar-only route classification.

## Required Verification For Claude PR

Run:

```bash
npm run test:diagnostics
npm run test:algorithms
npm run test:strategic-self-improvement
npx tsx --test \
  src/services/governance/__tests__/policy-gate.test.mts \
  src/services/diagnostics/__tests__/export-bundle.test.mts \
  src/services/quality/__tests__/quality-debt-adapters.test.mts
npm run scenarios:check
npm run test:panels:smoke
npm run bundle:check
npm run typecheck:all
node scripts/release-doctor.mjs --allow-existing-target-release --variant full
```

If adding fixture-backed smoke:

```bash
npm run test:panels:fixtures
```

If touching desktop Rust:

```bash
npm run desktop:build:app:full
```

If touching browser-visible UI:

```bash
npm run test:e2e:runtime
```

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Start from a fresh branch off macos/main or origin/main. Do not commit directly to main.

Use docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md as the source of truth.

The current post-PR199 baseline is stable:
- strategic self-improvement tests pass
- panel smoke has 0 silent, 0 errored, 0 asyncErrors
- main-sync installed the shipped SHA

Now improve functional truthfulness and user value:

1. Build a live diagnostics snapshot aggregator and wire SystemDiagnosticPanel / CommandCenterPanel to real source, provider, sidecar, feed, notification, and panel state instead of empty arrays and hard-coded unknown sidecar state.

2. Connect the frontend diagnostics export bundle to Cmd+Shift+D. The copied diagnostics should include schemaVersion 2 and the strategic sections when data exists, plus the Rust log bundle as appendix.

3. Update AlgorithmDiagnosticPanel to show policy-gated adjustment proposals. Raw safe-adjustment proposals must not imply applyability unless policy-gate says allow_auto.

4. Feed quality debt from real diagnostics and expose top active debt in System Diagnostic and export bundle.

5. Add fixture-backed panel functional smoke for key panels so we prove meaningful rendered states, not only degraded fallbacks.

6. Add timer/listener hygiene diagnostics for recurring loops and pause low-priority work under hidden/low-power state.

7. Improve performance by splitting/lazy-loading the large panels chunk without breaking panel smoke or runtime panel creation.

8. Improve key diagnostic/panel empty states so users understand what is unavailable, whether action is needed, and where to fix it.

9. Clean the Rust std::mem::forget warning in src-tauri/src/main.rs.

10. Classify sidecar-only routes and make new unclassified routes fail the route audit.

Keep changes staged and testable. Prefer small pure services plus focused UI wiring over a broad rewrite.

Before PR:
  npm run test:diagnostics
  npm run test:algorithms
  npm run test:strategic-self-improvement
  npx tsx --test src/services/governance/__tests__/policy-gate.test.mts src/services/diagnostics/__tests__/export-bundle.test.mts src/services/quality/__tests__/quality-debt-adapters.test.mts
  npm run scenarios:check
  npm run test:panels:smoke
  npm run bundle:check
  npm run typecheck:all
  node scripts/release-doctor.mjs --allow-existing-target-release --variant full

Also run npm run test:panels:fixtures if you add it, npm run desktop:build:app:full if touching Rust, and npm run test:e2e:runtime if touching user-visible flows.

In the PR body include:
- before/after diagnostics truthfulness notes
- before/after panel smoke and fixture smoke counts
- bundle-size report
- remaining intentional degraded/skipped areas
- any checks not run and why
```
