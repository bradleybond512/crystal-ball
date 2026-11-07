# UX-035 — Bound invisible presentation refreshes

Status: Bradley approved this bounded slice, documentation-only draft claim and local implementation. Fresh complete roadmap ownership check confirmed UX-035 as the next eligible task with no blocking findings; draft [#1859](https://github.com/bradleybond512/crystal-ball/pull/1859) claims it. Production-code publication requires separate approval. Installation, auto-merge and delivery remain paused.

## Brief and evidence

The complete roadmap snapshot selects UX-035, priority B, with higher eligible work already claimed. Start from canonical main `c5f24fbda5a1b99ca4d36f6a16ce738c9f77a084`. UX-035 is high assurance. Goal: stop unnecessary invisible presentation computation while preserving safety monitoring and data dependencies. This slice does not claim application-wide performance completion.

Repository discovery and architect review traced two candidates: AlertFatigueDashboardPanel's 30-second timer reads cached detector state and builds its view; CorrelationMapPanel's 30-second timer reads cached observations/chains/pairs and builds its view. Neither timer performs ingestion, correlation production, scoring or notification dispatch. AirSmokePanel is excluded because its loader feeds safety callouts and native notifications.

Before selecting these panels, three controlled lifecycle profiles executed actual whole Panel/subclass code and real cached store/view helpers in Happy DOM/VM. Workloads: 1,000 alert records, 1,000 observations, 100 chains, 500 pairs (30 displayed). Both panels performed 200 reads/builds per 200 callbacks when visible, offscreen, document-hidden, disabled and resumed. Median callback ranges were 0.063–0.081 ms for Alert Fatigue and 0.927–0.981 ms for Correlation Map. Constructor work was measured separately; both intervals stop on destruction.

Reproducible harness, three raw runs and detailed limitations are retained at `~/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/ux035/` (`profile.mjs`, `FINDINGS.md`, `profile.json`, `profile-repeat-2.json`, `profile-repeat-3.json`). Runtime source was identical to canonical main, with only the reviewed roadmap CI repair at profiling revision `7ca71372185a8accb3de093a50093f5b576d402b`.

These are controlled callback counts and timings, not installed-app CPU, battery, layout or safety-latency measurements. Repeated identical HTML used the existing no-op cache; this isolates avoidable read/build work. At a 30-second cadence, per-panel savings are modest.

## Design and boundaries

Add an instance opt-in, provisionally `PanelOptions.presentationRefreshPolicy?: 'visible-only'`, only to these two subclasses. Route their timer callbacks through existing `renderWhenVisible`; preserve direct constructor rendering. Reuse its one latest-wins pending callback slot. Add no scheduler, observer, acquisition gate or persisted setting.

For opted-in instances only:

1. Eligibility requires alive, foreground document, no explicit `hidden` class, and observed intersection within the existing 200-pixel margin. Read current document visibility directly, including when constructed hidden.
2. With IntersectionObserver, wait for its first result before periodic work. Track observation readiness separately from the existing optimistic intersection flag. Without IO, foreground/non-hidden periodic work remains allowed; offscreen savings are unavailable.
3. Defer a closure that reads current stores when executed. Keep only the newest request. Clear the slot before executing; immediate eligible work supersedes older pending work.
4. Drain exactly once when eligible on intersection, foreground transition or `show()`. First IO delivery must drain even if the old optimistic flag was true. Foreground recovery must not depend on another IO event.
5. `hide()` suppresses computation immediately, before observer delivery. `show()` uses the latest observed intersection or waits for observation.
6. Destroy discards queued work. Captured observer/timer callbacks and direct gate requests after destruction cannot execute opted-in work.
7. Preserve existing callback error isolation and normal next-timer recovery; no backlog, automatic retry or synthetic freshness update.

Leave all non-opted-in helper paths unchanged. There are 181 existing call sites across 177 subclasses, including diagnostic acquisition inside SystemDiagnosticPanel callbacks. Globally changing the helper would affect unprofiled dependencies. An instance option is simpler than a second queue/helper or per-call mode metadata and isolates semantics to measured presentation-only callers.

Non-goals: acquisition, warning monitoring, notifications, recommendation policy, correlation calculations, startup construction, refresh cadence, battery policy, settings persistence, native permissions, dependencies, and application-wide migration. Keep UX-036 scheduling and UX-042 construction separate. Existing setContent debounce, escaping, empty states and interaction behavior remain intact.

## Acceptance, owners and validation

| Owner | Files/responsibility | Dependencies |
|---|---|---|
| Test engineer | New whole-class lifecycle/candidate tests; controlled timer/IO/document harness | Approved policy; real baseline behavior |
| UI specialist | Panel.ts, AlertFatigueDashboardPanel.ts, CorrelationMapPanel.ts; named test script and additive test mapping | Test contract and approval |
| Test engineer | Clean-tree mutation proofs; identical repeated profile | Frozen implementation |
| Independent reviewer | Complete diff, dependency boundaries and evidence | Validation and proofs |

Add a named `test:panel-presentation` script. Tests must prove:

- Settled constructors followed by 200 visible callbacks produce 200 builds; 200 offscreen, hidden-document or disabled callbacks produce zero.
- Each eligible resume performs exactly one pending refresh from updated stores/current time. Cover foreground without IO, hidden IO, first IO, disable before IO, rapid hide/show and no-IO fallback.
- Latest-wins ordering, destroy/late-callback protection, unchanged constructor output and interval teardown.
- Empty/error states recover on the next eligible refresh; correlation expansion state persists; foreground interaction behavior remains intact.
- Legacy probe and Emergency Readiness behavior remain unchanged. Fixture acquisition/native/notification boundaries throw if unexpectedly reached.

Mutation proof independently bypasses each timer gate, eligibility guard, resume drain, latest-wins rule and destruction protection. Each proof requires an applied diff, actual red assertions/counts and matching restored checksums in a clean tree.

Run the new script, `test:alert-fatigue-dashboard`, correlation view fixtures through the new script, `test:emergency-readiness`, `typecheck:all`, then `bash scripts/agentic-validate.sh --tests '<actual scripts>'` and trusted selected suites. These are proposed checks, not completed results. Repeat three profile runs with identical fixtures, separate constructor/resume counts and bounded timing claims. Browser verification should cover scrolling, disable/re-enable, background/foreground and interaction continuity. Native acceptance remains outstanding while installation is paused.

## Risks and rollback

Main risks are incorrect resume eligibility, callback retention after destruction, and accidentally extending lifecycle semantics to acquisition callers. Opt-in scope and adversarial lifecycle tests contain those risks. No persistence migration or production data access is needed. Revert the option and two wrappers to restore prior presentation cadence; no stores or forecasts require rollback.

UX-035's broader acceptance stays open: this is two measured presentation timers, not an app-wide guarantee. Any additional panel requires dependency tracing and profiling first. Claim one UX-035 draft only after approval, then retain this limitation in the Progress Tracker and evidence. Code publication needs separate approval after implementation/review.
