# Diagnostics and Observability Enhancement Plan

Use this plan to make Crystal Ball internally self-diagnosing across panels, services, providers, notification paths, sidecar health, and user-facing intelligence quality.

The app already has useful diagnostic pieces. The gap is that they are fragmented and do not yet provide one reliable answer to:

```text
Is Crystal Ball working effectively right now?
If not, what is broken, what does it affect, and what should I do?
```

## Current Diagnostic Coverage

Existing pieces:

- `src/services/api-diagnostic.ts`
  - Aggregates data freshness, circuit-breaker state, offline state, live probes, and recommendations.
  - Exposes `window.cbDiag`.
- `src/components/ApiDiagnosticPanel.ts`
  - UI for source health, stale feeds, failures, probes, and export.
- `src/services/data-freshness.ts`
  - Tracks source update time, error state, item counts, and intelligence gaps.
- `src/services/data-health.ts`
  - Tracks source health and confidence multipliers through a dependency graph.
- `src/services/providers/health.ts`
  - Tracks provider-level success/error/latency/rate-limit/staleness.
- `src/services/reasoning-debug.ts`
  - Ring-buffer debug log for analyst/reasoning systems.
- `src/services/reasoning-metrics.ts`
  - Latency histograms and counters for reasoning operations.
- `src/components/ReasoningDebugOverlay.ts`
  - Reasoning diagnostic UI.
- `src/services/weather/weather-warning-diagnostics.ts`
  - "Why didn't I get warned?" severe weather trace.
- `src/services/weather/weather-warning-router.ts`
  - Produces weather routing decisions and diagnostic traces.
- `src/components/Panel.ts`
  - Per-panel heartbeat/staleness indicator.
- `src-tauri/src/main.rs`
  - Sidecar heartbeat staleness detection.
  - `copy_diagnostics` command for desktop log + sidecar `/api/diag`.
- `src-tauri/sidecar/local-api-server.mjs`
  - `/api/diag` sidecar snapshot.
  - `sidecar.health.json` heartbeat file.
- `src/services/log-bridge.ts`
  - Frontend log bridge and Cmd+Shift+D diagnostics copy-out.

## Main Gaps

### 1. No Unified System Health Score

There is no single top-level verdict that says:

- healthy
- degraded
- failing
- blind
- unsafe for critical alerts

Needed output:

```text
System Health: Degraded
Reason: weather alert route healthy, but ADS-B frontend feed stale and 3 providers failing.
Affected features: aviation confidence, military surge, strike packages.
Recommended action: check provider keys and /api/adsb-aggregate.
```

### 2. Panel Health Is Not Centrally Tracked

Panels have heartbeat UI, but there is no central registry of:

- panel mounted
- panel visible/enabled
- last render
- last data update
- last error
- refresh interval
- stale threshold
- data dependencies
- whether count is nonzero
- whether empty state is expected or suspicious

Needed:

- `PanelHealthRegistry`
- panel-to-source dependency mapping
- central "which panels are stale/broken?" report

### 3. Services Do Not Share One Instrumentation Contract

Many services fetch, compute, or transform data without a uniform trace shape.

Needed service lifecycle events:

- started
- success
- empty_success
- stale_success
- failure
- skipped
- suppressed
- degraded_fallback

Each event should include:

- service id
- source/provider id
- panel id if applicable
- latency
- item count
- error
- stale age
- dependency ids
- user-facing feature affected

### 4. Provider Health, Data Freshness, and API Diagnostics Are Separate

Provider health tracks provider reliability. Data freshness tracks source update freshness. API diagnostics aggregates source status. These need a joined view.

Needed:

- A normalized `DiagnosticNode` model
- Joined provider/source/panel/service status
- Dependency graph rollups
- Confidence multiplier impact by feature

### 5. Notification Pipeline Is Not Fully Observable

For severe weather and major events, we need to know exactly why a notification did or did not fire.

Needed for every high-urgency candidate:

- candidate created
- matched user/place/watchlist
- urgency score
- confidence score
- quiet-hours decision
- dedupe/repeat decision
- dispatch attempt
- native notification result
- user action/ack/snooze

Weather has a diagnostic start. Generalize it for all critical notifications.

### 6. No Feature Readiness Matrix

The app has many panels and capabilities, but no visible matrix like:

```text
Weather warnings        Ready
Storm Mode              Ready, UI missing
ADS-B redundancy        Backend ready, frontend stale
Shortage forecasts      Models ready, provider wiring missing
Command Center          Detector ready, UI missing
Notifications           Router partial, native ladder missing
```

Needed:

- Feature readiness registry
- Implementation status
- Runtime status
- User-visible impact
- Next remediation step

### 7. No "Blind Spot" Alerts

Crystal Ball should notify or visibly warn when it becomes blind in a critical domain.

Examples:

- Weather feed failing while severe weather risk is active
- ADS-B unavailable in war/disaster mode
- Provider keys missing for enabled panels
- Sidecar heartbeat stale
- Notification permission missing
- Saved places missing, preventing personal weather warnings

### 8. Diagnostics Are Not Tied To User Trust

If data is stale or a feature is degraded, risk cards and alerts should say so.

Needed:

- Data quality badge on major situations
- Confidence penalty from diagnostics
- "Why confidence is lower" explanation
- "Data gaps" section on Command Center and briefings

### 9. No Automated Self-Test / Smoke-Test Button

The user should be able to run:

```text
Run Crystal Ball self-test
```

It should check:

- sidecar alive
- `/api/diag` reachable
- notification permission and dispatch path
- saved places configured
- weather polygon matching test fixture
- panel registry mounted
- provider registry loaded
- critical localStorage/IndexedDB stores available
- core source probes
- recent renderer errors

### 10. No Diagnostics Timeline

Debugging needs chronology:

```text
10:05 weather fetch failed
10:06 sidecar recovered
10:08 NWS alert received
10:08 polygon matched Home
10:08 notification suppressed by quiet hours
10:09 user opened Storm Mode
```

Needed:

- Shared diagnostic event bus
- Ring buffer
- Export in Cmd+Shift+D bundle
- Filter by feature/source/panel

## Proposed Architecture

### Unified Diagnostic Event Bus

Create a small, deterministic diagnostics event service.

Suggested file:

- `src/services/diagnostics/diagnostic-events.ts`

Suggested type:

```ts
type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

type DiagnosticEventKind =
  | 'service_started'
  | 'service_success'
  | 'service_empty'
  | 'service_failure'
  | 'service_stale'
  | 'provider_success'
  | 'provider_failure'
  | 'panel_mounted'
  | 'panel_rendered'
  | 'panel_error'
  | 'notification_candidate'
  | 'notification_suppressed'
  | 'notification_dispatched'
  | 'feature_degraded'
  | 'feature_recovered';

interface DiagnosticEvent {
  id: string;
  at: number;
  severity: DiagnosticSeverity;
  kind: DiagnosticEventKind;
  featureId?: string;
  panelId?: string;
  serviceId?: string;
  sourceId?: string;
  providerId?: string;
  message: string;
  detail?: Record<string, unknown>;
}
```

### Feature Health Registry

Create a registry that maps capabilities to dependencies.

Suggested file:

- `src/services/diagnostics/feature-health-registry.ts`

Example:

```ts
weather_warning: {
  label: 'Weather warnings',
  panels: ['nws-alerts', 'personal-storm-mode'],
  services: ['weather-warning-router', 'nws-polygon-match'],
  sources: ['weather'],
  providers: ['nws-alerts'],
  critical: true,
}
```

Feature health should answer:

- Is this feature enabled?
- Are dependencies healthy?
- Is data fresh?
- Are panels mounted?
- Are notifications possible?
- What confidence multiplier should downstream logic use?

### Panel Health Registry

Create central tracking for panels.

Suggested file:

- `src/services/diagnostics/panel-health-registry.ts`

Track:

- panel id
- mounted
- enabled
- visible
- last render
- last data update
- last error
- stale age
- dependencies
- heartbeat state

Integrate with:

- `src/components/Panel.ts`
- `src/app/panel-layout.ts`

### Notification Trace Registry

Generalize the weather diagnostic style to all high-importance notification paths.

Suggested file:

- `src/services/diagnostics/notification-trace.ts`

Track:

- candidate id
- situation/alert id
- urgency
- confidence
- user relevance
- quiet-hours state
- dedupe decision
- dispatch rung
- native result
- user action

### System Health Aggregator

Create one top-level report that joins everything.

Suggested file:

- `src/services/diagnostics/system-health.ts`

Output:

```ts
interface SystemHealthReport {
  generatedAt: number;
  status: 'healthy' | 'degraded' | 'failing' | 'blind' | 'unsafe';
  summary: string;
  features: FeatureHealth[];
  panels: PanelHealth[];
  sources: SourceDiagnostic[];
  providers: ProviderHealthRecord[];
  notifications: NotificationTraceSummary;
  sidecar: SidecarHealth;
  recommendations: string[];
}
```

### Diagnostics UI

Upgrade `ApiDiagnosticPanel` or add a new `SystemDiagnosticPanel`.

Recommended tabs:

- Overview
- Features
- Panels
- Sources
- Providers
- Notifications
- Sidecar
- Timeline
- Self-Test

## Implementation Plan

### PR 1: Unified Diagnostic Event Bus and System Health Types

Add the common event model and report types.

Suggested files:

- `src/services/diagnostics/diagnostic-events.ts`
- `src/services/diagnostics/system-health-types.ts`
- `src/services/diagnostics/__tests__/diagnostic-events.test.mts`

Keep this pure and deterministic.

### PR 2: Panel Health Registry — SHIPPED

Wire panels into central health tracking.

Shipped files:

- `src/services/diagnostics/panel-health-registry.ts` ✅ pure deterministic registry
- `src/services/diagnostics/__tests__/panel-health-registry.test.mts` ✅ 17 tests

Pending follow-up:

- `src/components/Panel.ts` — integrate `recordRender` / `recordError`
- `src/app/panel-layout.ts` — call `recordMount` / `recordUnmount` / `setEnabled`
  on the layout lifecycle. Deliberately deferred so the registry contract
  could land first.

### PR 3: Feature Health Registry — SHIPPED

Map features to services, sources, panels, and providers.

Shipped files:

- `src/services/diagnostics/feature-health-registry.ts` ✅
- `src/services/diagnostics/__tests__/feature-health-registry.test.mts` ✅ 19 tests

The plan invariant "every degraded feature must include user impact and
recommended next action" is enforced at registration time: each
`FeatureDefinition` requires `userImpactWhenDegraded` and
`recommendedActionWhenDegraded` strings, so the runtime cannot produce a
non-healthy `FeatureHealth` without remediation guidance.

Default catalog (via `defaultFeatureCatalog()`):

- weather warnings ✅ critical
- Personal Storm Mode ✅ critical
- ADS-B aggregation ✅
- shortage forecasts ✅
- Command Center ✅
- notification routing ✅ critical
- reasoning layer ✅
- sidecar ✅ critical

### PR 4: System Health Aggregator — SHIPPED

Joins panel + feature + source + provider + notification + sidecar
diagnostics into one deterministic `SystemHealthReport`.

Shipped files:

- `src/services/diagnostics/system-health.ts` ✅ `aggregateSystemHealth`
  + `aggregateFromRegistries` + `contextFromSnapshots`
- `src/services/diagnostics/__tests__/system-health.test.mts` ✅ 11 tests

System status calculator highlights:

- A single critical feature in `failing` or `unsafe` flips the whole
  system to `unsafe` (gameplan invariant).
- Sidecar `failing` propagates because everything else depends on it.
- Notification trace's `unsafeSuppressions` degrades an otherwise
  healthy system so the user notices that a critical alert was held back.
- Recommendations are sorted: critical features first, then
  non-critical, then sidecar / notifications. Capped at six entries.

Pending integration follow-up:

- Wire `diagnoseAll()` / `getAllHealth()` / `dataFreshness` /
  `data-health` snapshots into the aggregator's `sources` and `providers`
  arguments at the wiring layer (`src/app/panel-layout.ts` or a new
  `src/services/diagnostics/system-health-bus.ts`).
- Reasoning debug/metrics summary is consumed at the UI layer (PR 6).

### PR 5: Notification Trace Registry

Generalize notification diagnostics beyond weather.

Suggested files:

- `src/services/diagnostics/notification-trace.ts`
- `src/services/notification-router.ts`
- `src/services/notification-dispatcher.ts`
- `src/services/weather/weather-warning-router.ts`
- `src/services/diagnostics/__tests__/notification-trace.test.mts`

### PR 6: System Diagnostic Panel

Create a user-facing diagnostics center.

Suggested files:

- `src/components/SystemDiagnosticPanel.ts`
- `src/styles/macos-native.css`
- `src/config/panels.ts`

Tabs:

- Overview
- Features
- Panels
- Sources
- Providers
- Notifications
- Sidecar
- Timeline
- Self-Test

### PR 7: Self-Test Runner

Add an explicit self-test.

Suggested file:

- `src/services/diagnostics/self-test.ts`

Tests:

- sidecar `/api/diag`
- notification permission
- saved places present
- NWS polygon fixture
- provider registry loaded
- IndexedDB/localStorage availability
- core data source probes
- recent renderer error count
- panel registry mounted

### PR 8: Diagnostics Export Bundle

Include unified report in Cmd+Shift+D diagnostics.

Suggested files:

- `src/services/log-bridge.ts`
- `src-tauri/src/main.rs`
- `src/services/diagnostics/system-health.ts`

## Best First Build

Start with:

1. Unified Diagnostic Event Bus
2. Panel Health Registry
3. Feature Health Registry
4. System Health Aggregator

That gives Claude and the user one place to answer whether Crystal Ball is actually working.

## Guardrails

- Diagnostics must not require network access unless running explicit live probes.
- Use deterministic unit tests for health rollups.
- Do not spam logs for high-frequency panel renders.
- Keep ring buffers bounded.
- Redact secrets and API keys from exported diagnostics.
- Every degraded feature should include a user-facing impact statement.
- Every failure should include a recommended next action.
- Prefer one unified diagnostics model over adding another isolated debug panel.

## Claude Instruction

Claude should read this plan before diagnostics work.

Recommended prompt:

```text
Read docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md. Implement PR 1 only: unified diagnostic event bus and system health types with deterministic tests. Do not build broad UI yet.
```

## Current Follow-Up Prompt

Use this prompt after PR 1 exists or is open:

```text
Read docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md and inspect PR #157 if it is still open. Crystal Ball already has useful diagnostics, but they are fragmented: ApiDiagnosticPanel/window.cbDiag, Cmd+Shift+D diagnostics, sidecar /api/diag and heartbeat, panel heartbeat indicators, provider health, data freshness, reasoning debug/metrics, and weather warning diagnostics.

Goal: continue the unified diagnostics track so Claude can reliably answer "is Crystal Ball working effectively right now?"

Implement the next smallest batch after PR #157:
1. Panel Health Registry
2. Feature Health Registry
3. System Health Aggregator skeleton

Requirements:
- Keep the work deterministic and unit-tested.
- Do not build broad UI yet.
- Track panel mounted/enabled/visible/last render/last update/last error/staleness/dependencies.
- Map initial feature health for weather warnings, Personal Storm Mode, ADS-B aggregation, shortage forecasts, Command Center, notification routing, reasoning layer, and sidecar.
- Aggregate existing source/provider/freshness diagnostics into one SystemHealthReport.
- Every degraded feature must include user impact and recommended next action.
- Do not add live network probes except where existing diagnostic APIs already do so.
- Keep ring buffers bounded and redact secrets from exported data.

Suggested files:
- src/services/diagnostics/panel-health-registry.ts
- src/services/diagnostics/feature-health-registry.ts
- src/services/diagnostics/feature-health.ts
- src/services/diagnostics/system-health.ts
- src/services/diagnostics/__tests__/panel-health-registry.test.mts
- src/services/diagnostics/__tests__/feature-health.test.mts
- src/services/diagnostics/__tests__/system-health.test.mts

Verification:
- Run the new diagnostics tests.
- Run npm run typecheck:all.
- Run npm run cross-check before marking ready if on an agent branch.
```
