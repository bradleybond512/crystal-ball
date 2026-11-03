# UX-049 Threat Dashboard coverage

Proposed for design approval on November 2, 2026. Base commit `cd459dfec`. The roadmap controller selected UX-049 at priority S after accounting for open main-target PRs. This branch prepares a draft claim.

## Defect and acceptance

In an isolated Chromium run of the production panel and default aggregator, the panel displayed “All sensors quiet · checked just now” on startup, after a second poll 30 seconds later and after all 11 adapters threw. Both polls returned 11 NONE results stamped at the poll time. The dedicated synthesis suite passed 56 tests on that base. The production panel layout starts the poller with no adapters.

An operator should see how many of the eleven domains are reporting, which sources supplied a signal, how old it is, and where evidence is incomplete. A current ground stop must remain visible during a SIGMET outage. Only eleven current, completely covered domains with no active hazard may collapse into “All sensors quiet.” Display the age of the oldest required evidence for that summary. With incomplete coverage, keep the rows accessible and describe each gap.

## Evidence and lifecycle

Use the existing acquisition owners. Store their validated receipts in memory per source for this app session. Record source scope, event or publication time when available, acquisition time, validity bounds and the outcome of the last attempted refresh. Keep the severity rules separate. An empty, malformed, sampled or filtered response cannot establish full coverage. Reject impossible and out-of-order timestamps and skip duplicate observations. Replaying the same payload may record an attempt but cannot renew its evidence. A pending refresh preserves valid prior evidence. Failure immediately degrades coverage. Show an existing hazard as last known with its original age until the applicable evidence or event limit, then remove it from the current count. Capture upstream age at admission where origin and local clocks differ.

Treat untouched domains as unknown. Report partial sources explicitly in the coverage count and row labels, including which leg failed. The 30-second panel tick can expire a receipt and repaint age. One owner must retain the teardown handle and suppress late updates from retired instances. Reopening the dashboard must not create another acquisition loop.

| Domain | Initial evidence and limits |
| --- | --- |
| Seismic | Use the validated USGS fusion fetch in the existing seismic loader. Distinguish event time from acquisition and retain upstream generation/age validation. Feed horizons, magnitude floors and truncation prevent a quiet verdict for the whole 24-hour window. A narrow snapshot cannot erase a still-valid earlier event outside its scope. |
| Space weather | Use validated SWPC/GFZ Kp bins from the existing fusion loader. Retain the source time and existing freshness rule. A Kp reading covers only Kp. Flare coverage is unknown. |
| Aviation | Use the SIGMET and FAA results already fetched by AviationIntelPanel. Validate original envelopes, current SIGMETs and explicit ground stops. Label acquisition time as fetched. Keep a valid positive in a degraded response. Empty normalized results have ambiguous scope. |
| Maritime | Use MaritimeIntelPanel’s existing four-zone AIS sample. Accept deduplicated valid MMSIs in recognized zones within the feed horizon. Age each by the sidecar receipt of its position report. Neither the response generation time nor an empty sample certifies quiet. |
| Weather | Defer complete warning coverage until the warning lifecycle in draft PR #1844 lands and is verified on the integration base. |
| Economic | A dated VIX reading is available. Define publication and trading-calendar freshness before using it. An OFR index cannot substitute for a normalized z-score. |
| Wildfire | The bounded incident feed can substitute the current time for a missing publication date. It cannot prove current active incident coverage. |
| Biosurveillance | Publication dates and fallback timestamps do not establish ongoing outbreaks. |
| Infrastructure | Internet outage counts cannot stand in for the power-customer counts used by the heuristic. |
| Cyber | The pulse and BGP inputs lack a validated complete 24-hour acquisition window. |
| Geopolitical | The existing event feeds lack a verified count of distinct qualifying high-severity events in the required window. |

The four connected paths can support observed signals or partial coverage. None is approved to certify its whole domain quiet. An unmounted acquisition owner supplies no fresh evidence. A full-coverage fixture must exercise the all-quiet path. Live eleven-domain clearance will require additional provider work.

## Implementation and checks

1. The synthesis specialist owns the per-source receipt contract, expiry, and existing severity evaluation in `src/services/synthesis/threat-aggregator.ts`. Test controlled clocks, unknown startup, explicit failures, same and out-of-order receipts, competing source scopes and positive evidence surviving a partial outage.
2. The provider specialist owns the existing USGS/Kp data-loader paths and the evidence adapters for aviation and AIS. The panel specialist connects the two panel-owned refreshes. Use the existing provider freshness limits and event validity, specify a reviewed bound before admitting any path lacking one, and capture redacted live response shapes, row counts and consumed fields. Test actual production handoffs, capped samples, invalid inputs and duplicate refreshes. Add no new requests or persistence.
3. The UI specialist owns `src/components/ThreatDashboard.ts` and poller lifetime in `src/app/panel-layout.ts`. Test row visibility, evidence age, mixed hazards, a single failed domain among ten current ones, complete quiet at the oldest receipt age, expiry without network, and teardown during an outstanding request.
4. The test owner runs the dedicated suite explicitly with `TSX_DISABLE_CACHE=1 ./node_modules/.bin/tsx --test src/services/synthesis/__tests__/threat-aggregator.test.mts`, targeted adapter/UI tests, `npm run typecheck:all`, and `bash scripts/agentic-validate.sh --tests "<targeted scripts>"`. Record clean-tree checksums, applied mutations, failing assertions and restored totals. Repeat the browser reproduction on the implementation and verify the native panel with isolated test data.
5. Independent review and the required Sonnet verdict cover the final implementation. Rollback reverts the dashboard and its in-memory handoffs together. No data migration is needed. Notification policy, scoring thresholds, installation and delivery are outside this change.
