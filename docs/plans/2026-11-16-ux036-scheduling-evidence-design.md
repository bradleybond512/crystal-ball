# UX-036 — scheduler and battery evidence design

Status: test-only first stage, documentation-only draft claim and local
implementation approved November 16. High Assurance, Priority B. Publish the
claim before implementation. Later implementation-code publication requires
separate reviewed-tip approval.

## Decision and evidence

Current source already implements +/-10% refresh jitter, browser battery
monitoring, and foreground recovery staggering. Existing battery tests bypass
`installBatteryMonitor()` through a test setter; scheduler tests mainly exercise
a multiplier helper or manually seeded runners. The verified gap is evidence.
Do not add timing changes before measuring actual scheduler behavior.

The complete live roadmap snapshot selects UX-036 after excluding existing
higher-priority claims. UX-072 remains owned by draft #1911. Carry the previously
reviewed UX-076/#1900 MONITOR metadata reconciliation when preparing this claim;
it is not a second task claim. Keep full UX-036 acceptance open.

## Bounded scope and ownership

Test engineer owns a bounded asynchronous clock fixture at
`tests/helpers/refresh-scheduler-clock.mjs`, new
`tests/refresh-scheduler-characterization.test.mts`, actual battery-event coverage
in `src/services/__tests__/adaptive-cadence.test.mts`, and a synthetic measurement
entry point `scripts/measure-refresh-scheduling.mts` reusing the same harness.
Parent owns one named test command, exact targeted-test mappings, docs and tracker.

Production scheduler, adaptive cadence, App, registration and provider modules
remain unchanged. No new dependencies, storage, native IPC, data feeds, notification
policy, credentials or delivery settings. No live app or real battery access.
Fixture setup replaces ambient APIs before import and restores globals afterward.
Use bounded operation counts and trace sizes; never wait through real intervals.

## Timing contract to characterize

For base interval I, backoff B in {1,2,4}, Ghost multiplier G, context multiplier
C in {1,2,4}, hidden multiplier H and random value r:

```text
D = max(1000, round(I * B * G * C * H * (0.9 + 0.2 * r)))
```

Context uses the strongest policy, not stacked silent/battery multiplication.
Characterize existing bounds without extending them. Rearming follows loader
completion, so loader duration adds to start-to-start gaps. A timer bound is not
an end-to-end warning-detection guarantee.

Exercise actual `scheduleRefresh`, `registerAll`, `setHiddenSince`,
`flushStaleRefreshes` and `destroy`: success, unchanged/false, rejection,
condition refusal, an existing in-flight name, policy changes while a timer is
pending and while a loader runs. Preserve completion-based rearming and backoff.

## Hidden and foreground behavior

Hidden callbacks do not invoke loaders. Always-on changes the hidden multiplier
but does not bypass the unconditional hidden pause; record that distinction.
Resume selects stale registrations using base intervals, shortest first, cancels
replaced timers and deduplicates repeated recovery. With six blocked synthetic
loaders, expected initial flush starts are 0/150/300/450/600/750 ms. Verify slot
release, failure, repeated activity/visibility transitions and destruction.
The six-slot limit applies to recovery admission, not all steady-state traffic.

## Battery event coverage

Use fake `navigator.getBattery()` and BatteryManager charging-change events with
the real `installBatteryMonitor()`. Verify initial state, both charging transitions,
absent API, rejected promise and strongest-signal composition. Existing armed
timers are not recalculated; later scheduling samples the new policy. This is
characterized behavior, not an automatically approved runtime defect repair.
Fake browser APIs do not prove native/WebKit support or real battery savings.

## Synthetic measurement

Use fixed seeded traces and explicit lower/mid/upper jitter boundary sequences.
Measure equal-interval cohorts and mixed 1/3/5/8/10/30/60-minute and two-hour
patterns, with immediate, bounded slow, unchanged and failing loaders. Compare
AC, battery, low-power, Ghost and hidden/resume fixtures.

Report per-job starts, maximum start gaps, starts in 1/150/1000-ms windows,
modeled active-loader concurrency and pending timers after cleanup. Record the
seed, inputs and replay horizon. No CPU, energy or production-load improvement
claim follows from these synthetic timings.

All production jobs are unchanged, including seismic, weather/NWS, space-weather,
internet-outage and other warning registrations, loader budgets, freshness checks
and recovery priority. A later runtime change needs exact eligible jobs and an
approved delay budget fitting existing upper bounds.

## Validation and acceptance

Use the new suite, existing `tests/flush-stale-refreshes.test.mjs`,
`src/app/__tests__/refresh-scheduler-throttle.test.mts`, adaptive-cadence tests and
`tests/data-sources-wiring.test.mjs`. Then all type checks, secrets and the named
agentic gate, independent Sol/Sonnet review and separately approved code push.

In clean temporary checkouts prove actual failures for removed jitter, reversed
battery polarity or missing events, stacked multipliers, changed backoff, missing
condition/in-flight guards, hidden pause, recovery deduplication, slot/stagger
limits and cleanup. Save applied diffs, before/red/restored counts and checksums.
No mutant may remain applied to the candidate. A failing characterization invokes
diagnosis, not weaker tests or an automatic runtime repair outside this scope.

## Risks, remainder and rollback

Fake-clock ordering and leaked globals can invent timing behavior: test bounded
microtask handling, teardown and reproducible traces. Full UX-036 remains open
for actual synchronized refresh cost, justified production staggering, packaged
warning latency, real browser battery integration and power savings.

Rollback removes only fixture/tests/report wiring; no runtime or stored data
changes require recovery. Merging, auto-merge, releases, deployment and
application installation remain paused.
