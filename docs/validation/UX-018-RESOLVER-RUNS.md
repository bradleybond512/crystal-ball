# UX-018 — Forecast resolution receipts and evidence timing

**Status: in progress.** Implementation `8b1643d84` is verified locally. Closing UX-018 requires an approved installed build, seven real scheduled runs with evidence opportunities and a matched production coverage comparison.

Calibration diagnostics now expose the last 16 session receipts under `algorithmDiagnostics.forecastCalibration.resolverRuns`. Operators can inspect the authenticated analyst-state snapshot or call `get_algorithm_diagnostics`. The model preserves the raw deadline, the 15-minute diagnostics grace and the typed resolver’s 30-minute expiry boundary. Scheduled runs, catch-ups, and hourly bridge expiries have distinct receipts. Fixed counters describe actual eligible writes, evidence gaps, unsupported criteria, expired records and failures. Earlier late records retain an unknown cause.

Visible workspaces share cadence stamps and Web Locks. A hydrated owner with due work can catch up after startup or resume. Overlapping work, a stale ledger or failed durable write cannot publish tentative labels to the evidence journal. The existing hourly generic expiry remains separate. Legacy producers use nontransactional Web Storage, so the new lock and currency checks apply to these resolver paths. Unavailable coordination cannot establish a streak. Receipts reset with the session.

## Replay and baselines

The existing ACC-008 aggregate counted 49 direct and 375 proxy labels among 424 resolved forecasts. It reported 274 late resolutions and zero pending forecasts past their raw deadlines at that instant.

On 11 identical mature synthetic forecasts, the original warning resolver yielded nine direct, one proxy and one pending. The repaired resolver yielded two direct, one proxy and eight pending. It removed seven invalid direct labels and preserved provable positives in complete and partial batches. The retained complete negative remained a proxy. This measures label integrity; improved production direct-label coverage has yet to be demonstrated.

[Replay results and public source shape](UX018-REPLAY.json) include 33/33 acceptance checks each in Chromium web, desktop-mode Chromium and nonpersistent macOS WKWebView. Real scheduler and diagnostics code ran against a frozen clock, isolated storage and synthetic observations. In two same-origin renderer contexts only one provider lookup ran. Seven simulated scheduled opportunities demonstrated the streak counter; a hidden, failed or empty run did not establish production evidence.

The public Iowa State local storm reports control returned HTTP 200 with a GeoJSON FeatureCollection of 181 rows. The fixture uses the report’s `type`, `valid` time and point coordinates. Acquisition and coverage times come from the collector. The JSON records the request URL and field names. The production datasource and operator ledger were not modified.

## Validation

| Command | Captured output |
| --- | --- |
| `npm run test:ux018` | `# pass 113`, `# fail 0` |
| `npm run test:intelligence` | `# pass 597`, `# fail 0` |
| `npm run test:diagnostics` | `# pass 442`, `# fail 0`, then `# pass 64`, `# fail 0` |
| `node --test scripts/doctor-core.test.mjs tools/mcp-server/__tests__/diagnostics-tools.test.mjs` | `# pass 21`, `# fail 0` |

`bash scripts/agentic-validate.sh --tests 'test:ux018 test:intelligence test:diagnostics'` concluded with `Agentic validation gate passed.` Both TypeScript configurations and the production build passed.

The first integrated gate exposed a missing named export used by Doctor. Restoring the export preserved that existing caller. Sol’s independent review found zero blocking code findings after checking the repair, stale-write handling, receipt qualification, lifecycle and public projections. Sonnet’s final review is recorded in the pinned verdict commit.

The [mutation certificate](UX018-MUTATIONS.json) covers 92 isolated reversals yielding 94 intended failed tests. The six focused commands passed 81/81 both before and after restoration. It records each applied diff, failing assertion, red counts and restored hashes. The startup integration rehearsal with draft #1848 required combining additive test mappings. Both the forecast and boot suites passed on the reconciled code.

## Remaining operator verification

After installation is approved and the reviewed changes have landed on main, inspect receipts for seven consecutive natural scheduled passes in one uninterrupted session. Check eligible overdue outcomes after each pass, opportunities, persistence failures and provenance, and compare mature matched forecaster/domain/horizon/version cohorts. Keep the task open if coverage is insufficient or remaining proxy/unresolved outcomes cannot be accounted for.

Rollback reverts the implementation and its diagnostics projection together. It introduces no ledger migration or historical relabeling. Existing committed outcomes are retained.
