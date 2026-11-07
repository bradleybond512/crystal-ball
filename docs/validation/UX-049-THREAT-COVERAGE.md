# UX-049 verification

## Scope and rollback

The Threat Dashboard starts with eleven unknown domains. Sources supply their last observation, acquisition or position-report receipt time. The dashboard accounts for partial coverage separately from its existing severity thresholds. Its 30-second repaint can expire a signal without refreshing its timestamp. Full reassurance requires complete, current evidence for all eleven domains and uses the oldest required evidence. The four integrated sources cannot produce a live system-wide all-clear.

The in-memory state belongs to this session. Rolling back the implementation restores the previous panel and removes the receipt handoffs. No data migration is required. The design and claim were published in draft PR #1845. The approved implementation is locally validated; delivery requires a fresh exact-head review and hosted CI.

## Live acquisition evidence

The observation window was November 3 UTC (November 2 local). The data below establishes the production wire shapes. Browser and native positive/negative scenarios use controlled fixtures.

| Source | Request, count and consumed fields |
| --- | --- |
| USGS | The desktop all_hour feed returned 7 features, the all_day fallback returned 269, and the web M2.5+ daily feed returned 45. All had GeoJSON feature ID, magnitude, event time, place and coordinates, plus metadata.generated. The dashboard uses the existing route generation, source, HTTP Date and Age to admit receipts. [Desktop](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson), [fallback](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson), [web](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson). |
| Kp | NOAA returned 57 rows with time_tag and Kp. GFZ returned 15 samples with datetime and Kp. At 03:26 UTC both newest bins were 00:00 UTC, beyond the existing three-hour limit. The dedicated Kp acquisition endpoints are implemented by the desktop sidecar on this base. Web deployments without those routes expose the gap. [NOAA](https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json), [GFZ query](https://kp.gfz.de/app/json/?start=2026-11-01T03%3A26%3A44Z&end=2026-11-03T03%3A26%3A44Z&index=Kp). |
| Aviation weather | The two configured upstream URLs returned HTTP 404 JSON error bodies, zero advisories. Positive SIGMET behavior was exercised with fixtures. [SIGMET endpoint](https://aviationweather.gov/cgi-bin/json/SigmetJSON.php), [AIRMET endpoint](https://aviationweather.gov/cgi-bin/json/AirmetJSON.php). |
| FAA | Airport conditions returned HTML 404. Airport events returned 7 airport rows. At 03:29:58 UTC, one FLL stop was active until 03:30 UTC. The previous parser accepted zero of the seven. The new parser consumes airportId and the nested groundStop airportId, startTime, endTime, programExpirationTime and impactingCondition. [Conditions](https://nasstatus.faa.gov/api/airport-conditions), [events](https://nasstatus.faa.gov/api/airport-events). |
| Maritime | An isolated desktop sidecar’s GET /api/maritime/vessels returned vessels, summary, sanctionedCount, asOf and sampleSize with zero vessels and sample size zero. It produced no receipt. Positive checks use fixture MMSI, latitude/longitude, zoneId and position-message receipt time. Positive AIS traffic was not observed live. The Maritime Intel panel loads on demand, so fresh AIS evidence depends on that panel running. |

## Manual verification

Open the Threat Dashboard before a source has reported. All eleven rows should be accessible and its reporting count should be zero. Compare Kp observation age with a USGS fetch age. Interrupt one acquisition and confirm the failed source label and the surviving positive. Let its source validity expire without network and check that the current signal count drops. Restart the panel and confirm only one repaint loop remains.

## Implementation and scope of verification

The synthesis evidence store associates each source with its own scope, clock and validity. The data loader passes USGS acquisitions and Kp votes from the existing readers. Aviation Intel and Maritime Intel pass the results of their existing refreshes. ThreatDashboard owns a single presentation timer, releases it on teardown and distinguishes current signals from last-known hazards. Unconnected, stale and failed sources stay visible. The existing thresholds still determine severity.

The FAA handler now recognizes nested airport ground stops and validates their timing. An invalid primary response falls through to the next existing endpoint. Valid signals in a damaged response can be displayed with reduced coverage, and failures do not enter the FAA success cache. The SWPC sidecar freezes the Kp subfeed acquisition time across cache hits. The store uses that time, the GFZ fetch time and the AIS snapshot time only to order real content revisions. Observation and position-report age remain anchored to the bin or position receipt. An unchanged replay cannot clear an outage or extend expiry.

The first independent review reproduced a Kp 0-to-7 correction disappearing within the same bin and an AIS decrease from six vessels to five disappearing when the newest remaining position retained its timestamp. The repaired store accepts ordered changes, preserves observation ages and rejects conflicting changes without an ordering clock. When the newest vessel leaves, the dashboard can correctly show five vessels with an older last position report. Independent re-review found both defects resolved.

Before the repair, four of the correction checks failed in Chromium. After repair, the same checks passed in Chromium and macOS Tauri/WebKit. [Renderer checks and hashes](UX-049-RENDERERS.json). The native test used a diagnostic Tauri host with the app CSP and an incognito WebKit data store. It exercised the real dashboard, scoped USGS/Kp loader, FAA/SIGMET and maritime panel refreshes. Full installed-app startup and live AIS-positive service were outside that run. A CSP message for the test receipt channel used Tauri’s native postMessage fallback. The fixture made zero external provider requests. An additional Chromium run through the real Kp data loader covered nine stages, including 0→7→0 within one bin, unordered conflict, outage and recovery. Each stage made one request for each of the two Kp sources.

## Reproduction and local checks

The original panel displayed “All sensors quiet · checked just now” at startup, at the second tick and after eleven explicit adapter failures. In Chromium and Tauri, the baseline renderer each failed four of five targeted startup and empty-tick checks. On the repaired renderer both browsers passed all 42 checks. The extended correction suite returned 38 pass / 4 fail on the pre-review build in both renderers, then 42 pass / 0 fail in each on `c935054d3`.

The targeted command was `npm run test:ux049`. Its two runner summaries on the repaired code were:

```text
# pass 138
# fail 0
# pass 23
# fail 0
```

`npm run test:providers` printed `# pass 159` and `# fail 0`. `npm run test:sidecar` printed `# pass 665` and `# fail 0`. The existing maritime suite returned 131/0 and 29/0, and the aviation normalization suite returned 20/0. The scoped sidecar review saw 12/0 for space-weather HTTP behavior. The subsequent integrated gate included the sidecar and the renderer repair.

The integrated command was `bash scripts/agentic-validate.sh --tests 'test:ux049 test:providers test:sidecar'`. It ran both TypeScript configs, lint, the lockfile check, secret scanning, docs checks and the production build. Its final output included

```text
Agentic validation gate passed.
Tests run: test:ux049 test:providers test:sidecar
```

Vite emitted dynamic-import chunking advisories. Rollback of local code commit `c935054d3` removes the behavior change as one unit. The dashboard would again conflate missing data with quiet observations, as reproduced above.

## Mutation testing

All 84 behavior-changing mutations produced the expected failures. The 27 source and test file hashes matched reachable implementation and fixture commit `3c68b4fa9`. The mutation runner reverted individual guards, verified the applied diffs and expected assertion failures, then restored the original file and checked its SHA-256 and clean Git status. The portable record includes the original/repaired suite counts, mutated paths, applied changes, failed assertions and restored checksums. [Mutation record](UX-049-MUTATIONS.json).

Two initial reversals needed investigation. Removing an early stale aviation-envelope check left a later per-row expiry guard enforcing the same limit. Extending the actual five-minute horizon to ten minutes turned that suite from 8 pass / 0 fail to 6 pass / 2 fail. The first zero-size AIS sample test also had an invalid snapshot timestamp, which masked removal of its sample-size guard. With a valid timestamp and one otherwise valid vessel, removing the guard turned 8 pass / 0 fail into 7 pass / 1 fail. The final fixture suite passed after restoration.

## November 7 integration reconciliation (#1845)

Rebased the existing approved implementation onto main `4cc92fa7731b1416b7ee3d032081ae1c22b9eac9`, which includes #1858 and the corrected UX-035 monitoring status. All eight rebased commits were patch-equivalent in `git range-diff`; there were no conflict resolutions, production behavior changes, new sources, or design expansion. Removed obsolete pre-rebase verdict files so they cannot be mistaken for final-tip review.

Actual Node `v22.23.1` validation reran `bash scripts/agentic-validate.sh --tests 'test:ux049 test:providers test:sidecar'` with a canonical macOS temporary directory. The suites printed:

```text
# pass 138
# fail 0
# pass 23
# fail 0
# pass 159
# fail 0
# pass 665
# fail 0
Agentic validation gate passed.
Tests run: test:ux049 test:providers test:sidecar
```

The unchanged gate also passed lockfile consistency, strict lint, application/API typechecking, secret scanning, cross-agent tool availability, documentation/roadmap checks and the production build. Cross-agent tool availability is not a review verdict. Vite retained nonblocking dynamic-import and plugin-timing advisories.

A fresh complete GitHub snapshot contained 103 main-target records (38 open PRs and 65 referenced records), with #1845 as the candidate. The roadmap controller returned `blocking: []`. UX-049 remains DONE for the explicitly approved four-source implementation and fixture-tested all-domain reassurance contract, not for live eleven-domain clearance or installed-app acceptance. Original mutation and renderer records remain historical evidence; this reconciliation does not claim fresh native renderer or live-provider verification. The original AWC HTTP 404 and zero-vessel AIS observations still limit positive coverage to fixtures. Final exact-head Sonnet review and hosted checks remain required before delivery.

The trusted main-owned changed-path selector was copied from the exact integration base and run with the same Node 22/canonical temporary-directory environment. It executed all 84 selected scripts without retries or assertion changes:

```text
[targeted-tests] 84 script(s) passed.
```

This includes shared loader, sidecar, aviation/maritime, synthesis/dashboard, roadmap, security and native-gate regression suites selected by main. Native-gate source/build tests are not an installed application smoke test. No installation, release, tag, hosted build dispatch or deployment was performed.

## Pending-dependency integration (not final-main acceptance)

Light integration checkpoint `e31d2a3cb` is based on the explicit local pending-dependency baseline `fd012930d4ab000c8a111692e42a1720720af72d`, not a claim that this stack has landed on main. The previous `4cc92fa77` gate and 84-suite result above are historical and do not certify this new integration. Final actual-main reconciliation, complete live roadmap snapshot, full selected tests, unchanged aggregate gate, independent exact-head review and hosted checks remain pending.

Rebase conflicts were limited to adjacent roadmap rows and additive package/targeted-suite registrations. The newer NWS, Ghost Mode, derived-alert, boot and forecast lifecycle implementations and MONITOR acceptance limits were retained. The shared loader, sidecar and panel-layout changes merged without a production-code conflict. The dependency boundary remains the exact `fd012930d4a` commit; only #1845 changes follow it.

Focused validation exposed a genuine fixture integration defect: the startup test harness did not supply the newly required `SeismicThreatHistory` constructor. Its original second runner reported `# pass 62` / `# fail 9`, all nine failures naming `SeismicThreatHistory is not a constructor`. The repaired harness supplies the real module, not a weakened substitute, while retaining every boot/NWS assertion. It now reports `# pass 71` / `# fail 0` (the first vault-intro runner remains 1/0). An added panel-layout wiring assertion prevents a second, unowned threat producer beside the dashboard-owned timer. The additive selector mapping includes `test:ux049` for `src/app/panel-layout.ts`, alongside all existing Ghost/boot/forecast suites, so a later layout-only regression runs this guard.

Actual focused Node 22 results on this checkpoint:

| Command | Runner pass/fail counts |
| --- | --- |
| `npm run test:ux049` | 139/0 and 23/0 |
| `npm run test:ux047` | 124/0 |
| `npm run test:ux053` | 1/0 and 71/0 |
| `npm run test:ux018` | 113/0 |
| `npm run test:ux052` | 117/0 |
| `node --test --test-name-pattern='Kp acquisition time' src-tauri/sidecar/local-api-server.test.mjs` | 1/0 |

Five refreshed mutations began from clean `e31d2a3cb`, recorded the applied diffs, and restored matching SHA-256 hashes plus empty Git status: seismic attempt ownership 23/0 → 22/1; Kp revision clock handoff 23/0 → 22/1; sidecar cached acquisition age 1/0 → 0/1; panel-layout poller ownership 1/0 → 0/1; startup genuine dependency 10/0 → 1/9. [Exact commands, applied diffs, assertion failures and checksums](UX-049-PENDING-INTEGRATION-MUTATIONS.json).

No full build, large selector, Claude review, push, closeout, merge, installation or deployment was performed for this pending checkpoint. Original AWC 404 and AIS zero-vessel caveats remain unchanged. These focused fixture results do not establish live source health or installed-app acceptance.

### Pending-baseline aggregate gate

The coordinated aggregate run executed on clean `da6132fa76baacf1d1e8d4f279f1bf8654d95a5e`, still based on local pending baseline `fd012930d4ab000c8a111692e42a1720720af72d`. Node was `v22.23.1`; the user's macOS temporary directory was canonicalized before execution. This evidence update follows the execution head and changes no production, test or build input.

Actual unchanged command: `bash scripts/agentic-validate.sh --tests 'test:ux049 test:ux047 test:ux053 test:ux018 test:ux052 test:providers test:sidecar'`.

Runner summaries were 139/0 and 23/0 (UX-049), 124/0 (NWS), 1/0 and 71/0 (boot), 113/0 (forecast), 117/0 (derived alerts), 159/0 (providers), and 666/0 (sidecar): 1,413 passed and zero failed. Lockfile consistency, strict lint, application/API typechecks, secret scanning, cross-agent tool availability, documentation, structural roadmap and production-build stages passed. The final output was:

```text
Agentic validation gate passed.
Tests run: test:ux049 test:ux047 test:ux053 test:ux018 test:ux052 test:providers test:sidecar
```

Vite emitted nonblocking chunking/plugin-timing advisories. This was a local validation build, not a hosted build dispatch or installed-app test. The large conservative selector was deliberately not run in this slot. Actual-main transition, complete live candidate snapshot, final conservative selection, independent exact-head Sonnet review and hosted CI remain required. No push, closeout, merge or delivery occurred.

### Pending forecast baseline refresh

The later light refresh executed at clean `91e9dfb1a8c8e41c0ccdcd516cd840a4533f316f` on immutable local pending forecast baseline `bdbf5b55f98c23dbf6b07c5ef24f2d7e687f2496`, not actual main. Backup `backup/ux049-before-forecast-refresh` preserves the prior `3e3facc5d` checkpoint. The sole rebase conflict was package-script adjacency: retain the corrected direct-Node UX-050 PWA-budget recipe and add UX-049. All 30 feature source/test files remain byte-identical to the previous checkpoint; all five refreshed mutation source hashes match their restored values, so no changed feature guard requires a replacement mutation. All 15 upstream-only changed paths remain identical to the new dependency baseline, including corrected UX-050 execution metadata, trusted-runner regressions, UX-052 historical/current evidence distinctions and UX-053 evidence. [Source/test hash continuity](UX-049-PENDING-REFRESH-CONTINUITY.json).

Fresh Node 22 focused results: UX-049 139/0 plus 23/0; UX-053 1/0 plus 71/0; UX-018 113/0. The two trusted UX-050 command/budget-alias regressions passed 2/0 via `tsx --test --test-name-pattern='main-owned UX-050|PWA budget alias' tests/agentic-pipeline.test.mjs`. The genuine seismic constructor remains in the startup harness. No assertions, product design or upstream MONITOR limits changed.

This evidence-only commit follows that execution head. No heavy aggregate, large conservative selector, Claude review, push, live-candidate reconciliation or main-acceptance claim was made during this refresh. Later upstream evidence-only updates and the eventual actual-main transition must be preserved. The earlier 1,413-test aggregate remains evidence for its explicitly recorded older execution head, not a claim that this refreshed stack has passed the final gate. Live AWC/AIS and installed-app limitations remain unchanged.

### Fresh trusted conservative selection and aggregate

On clean execution head `943ad4303713908934adaf9babf670043bc87200` (still the local pending `bdbf5b55` stack), the actual main-owned selector was copied from `e104ebfe7768ab814dccc145b1dd3412c4912d60`. Its reference was pinned for the complete selected run. The conservative diff selected 109 scripts over 146 changed paths; every effective main-owned command was executed freshly, not inferred from an unchanged selected-name list. In particular, the trusted UX-050 recipe executed its corrected direct-Node PWA-budget stage, build and bundle checks. The result was `[targeted-tests] 109 script(s) passed.`, with no failed suites or retries.

The unchanged aggregate was also rerun with `test:agentic-pipeline test:ux049 test:ux047 test:ux053 test:ux018 test:ux052 test:providers test:sidecar`. Actual runner counts were 84/0, 139/0, 23/0, 124/0, 1/0, 71/0, 113/0, 117/0, 159/0 and 666/0: 1,497 pass, zero fail. All aggregate stages passed, ending with `Agentic validation gate passed.`. Nonblocking Vite chunking/plugin-timing advisories remain. The shared main-reference pin was released only after the selector and the aggregate's reference-dependent cross-agent availability stage had completed; only the local build remained at release.

All 5,218 tracked non-documentation input SHA-256 values were captured before execution and matched afterward, with an empty Git status. [Exact execution head, trusted selector hash, selected set, effective command ownership/expansion, source/test Git tree hashes, changed/build input SHA-256 values and outcomes](UX-049-TRUSTED-SELECTION.json). Portable command paths are normalized; the original full input manifest and logs remain in `/tmp/cb-merge-nov7/ux049-heavy/`. This following evidence-only commit changes no executed source/test/build input.

These are fresh pending-stack results, not final actual-main or installed-app acceptance. Final reconciliation after the forecast dependency lands must preserve newer upstream evidence, compare effective commands and input hashes, refresh the complete live candidate snapshot, and obtain the final exact-head Sonnet review and hosted CI. No review, push, closeout, merge or delivery was performed in this slot; original AWC 404 and AIS zero-vessel limits still apply.

### Pending dispatcher lint-repair integration

A conflict-free light rebase onto immutable local forecast baseline `bd9a2ca516c5b602090ad89bc7190017410ef4ef` produced clean execution head `bd0d26db4bb71f8b6de1ca959920e6a14548618a`. Backup `backup/ux049-before-dispatcher-refresh` preserves `d69ea4207`. The genuine `SeismicThreatHistory` startup dependency, own implementation, corrected trusted UX-050 recipe, upstream MONITOR limits and accumulated historical/current QA provenance are retained.

Compared with the 109-suite execution manifest at `943ad4303`, 5,216 of 5,218 non-documentation inputs are byte-identical. The only changed executable inputs are `src/services/notification-dispatcher.ts` and its strengthened trace test, both exactly matching the dependency baseline. The dispatcher now expresses denied-outcome exclusion with a ternary and its suppression fallback with nullish coalescing. All five own mutation source hashes still match their recorded restored values. [Changed input SHA-256 values, unchanged count and source/test/build tree proof](UX-049-DISPATCHER-REFRESH-CONTINUITY.json).

Fresh Node 22 focused results on this execution head: Ghost state/policy/dispatcher trace/notice/entry/chunk tests 90/0; UX-049 139/0 plus 23/0; UX-053 1/0 plus 71/0; UX-052 117/0. The Ghost command executes only the existing test-file stage, not its later build/budget/bundle stages. The former 109-suite selection and 1,497-test aggregate remain valid evidence for their recorded older head and unchanged bytes; neither is represented as a rerun or complete certification of these changed shared inputs.

This following commit updates evidence only. No heavy aggregate, large selector, `lint:ci`, independent review, push or delivery occurred during this refresh. Final actual-main preflight must explicitly run `lint:ci` with CI-equivalent locked `marketing-site` dependencies and the repository's generated-artifact handling, in addition to the final snapshot, effective-command/input comparison, required validation, exact-head Sonnet review and hosted CI. The upstream owner's lint result is not claimed as this branch's run. AWC 404, AIS zero-vessel and installed-app acceptance limitations remain unchanged.

### Explicit pending-source CI lint preflight

The unchanged `npm run lint:ci` passed on execution head `b8b9d1974f56b9f9ad4841be407eb01cdcd74559` with Node 22 and canonical user TMPDIR. To match the CI workflow's locked marketing dependencies without running installation scripts, this worktree reused the existing UX-058 marketing dependency directory only after verifying identical `package.json` and lockfile SHA-256 values, all 494 installed lock entries' version/resolution/integrity fields, and a successful full `npm ls` with no dependency-tree errors. No dependency install scripts were executed.

The initial lint run failed solely because this local worktree contained the generated `src-tauri/sidecar/s2u-xmpp.bundle.mjs`; no tracked-path increases were listed. Its generator, untracked status and existing ignore rule were verified. The exact generated file was hashed and temporarily moved aside to reproduce CI's fresh-checkout artifact state. The unchanged command then exited zero: `[lint:baseline] OK — 1015 existing findings, no increases.` The changed-file stage linted 72 files and reported zero errors and two existing declaration-file/no-matching-config warnings (`_faa-ground-stop.d.ts` and `nws-alert-row.d.mts`). No rule, baseline or tracked source was excluded or changed.

The generated file was restored afterward with identical SHA-256 `4c5328fdbdf07514d9f04d5bd7815dd99664a23455418026c0c3b97074dc11ce`. [Execution, dependency hashes and restoration record](UX-049-LINT-PREFLIGHT.json). This evidence-only update follows the successful lint execution head. It does not replace the final actual-main preflight or constitute review, push, merge, installation or live-source acceptance. Future repetitions may directly reproduce the verified clean-checkout artifact state rather than rerunning the already-understood artifact-only failure.

### Frozen forecast dependency preparation

The conflict-free pending refresh executed at `fb46c3793f2aefd0a0781aa8281842329972d740`, atop frozen local forecast source `356f726664c47e0605cc5a7122cc4c7a58395352`. Actual main was still `f106fc842528b63ccc592f7d12e8089550fc36df`; forecast #1853 was not yet merged. Backup `backup/ux049-before-final-forecast-356` retains the prior `f33486d6` evidence tip. Only six upstream documentation/verdict files changed, preserving the current dispatcher and forecast receipts. All 5,218 tracked non-documentation input hashes matched before and after preparation, including package recipes and trusted selector files. No product/test behavior changed and existing mutation proofs remain tied to their recorded execution heads.

The pending-base selector contains 91 scripts, all within the earlier qualified 109-script selection. Exact effective-command comparison, with portable path and inherited-environment normalization, identified two changed ownership paths: UX-053 and UX-058 now execute as trusted-main stages rather than PR npm recipes. Those actual stages were executed freshly on Node 22: UX-053 reports 1/0 plus 71/0, and UX-058 reports 90/0. The unchanged documentation check passed. This does not claim another full aggregate or type-aware lint run; the prior explicit lint proof remains associated with its exact execution head and unchanged executable bytes. [Exact pending identity, effective commands, outcomes and limits](UX-049-FINAL-PENDING-CONTINUITY.json).

The complete 103-record live snapshot for candidate #1845 correctly exited 1 because UX-018 evidence PR #1853 remained OPEN. That dependency gate was not waived or broadened. Final actual-main transition and a fresh passing live snapshot remain mandatory after #1853 lands, followed by independent exact-head Sonnet review and hosted CI. No review, verdict, push, merge, release or installation was performed here. Original AWC 404, AIS zero-vessel and installed-app limitations remain unchanged.

### Final actual-main transition

After forecast #1853 merged, actual main became `b7f5483089e30592163647f70626bf925305b62d`. Its full tree differs from the frozen forecast dependency only by the genuine upstream review verdict. That verdict is preserved alongside all sensor files and evidence. The entire 5,218-file executable input manifest remains identical to pending execution `fb46c3793f2aefd0a0781aa8281842329972d740`. All 91 selected effective commands and their ownership also match that pending audit exactly. Thus no source, test, package, tooling or build input changed at this transition; prior results are retained only under their explicit execution provenance, including the separately qualified dispatcher repair and fresh UX-053/058 trusted paths. No new full aggregate or lint run is claimed.

The fresh complete 103-record GitHub snapshot for candidate #1845 now passes with exit zero; #1853 is verified merged, so the previously recorded dependency blocker is resolved without waiving a rule. Backup `backup/ux049-before-actual-main-b7` preserves the entire pending source. Before final review, the exact reconciled candidate is represented by one linear source commit on actual main to avoid replaying obsolete stacked integration history. The full committed tree must match the staged candidate tree. [Identity, selection and live-gate receipt](UX-049-ACTUAL-MAIN-CONTINUITY.json). Final exact-head Sonnet review, hosted checks and required closeout remain separate delivery gates. AWC 404, AIS zero-vessel and installed-app acceptance limitations still apply.

### Final review repair: pre-aborted transport caller

The genuine Sonnet 4.6 medium review of `9ba29f177d524b1da528ae217d19cf1092ab1146` reported zero blocking findings and one low-severity pre-aborted-signal gap. The helper could start an evidence attempt after its caller was already cancelled, leaving a pending record and replacing a valid in-flight token. The original review's suggested constructor race was not established (initial refresh starts synchronously), and its claimed one-cycle duration was not guaranteed. The original reviewer output is retained unedited; these are implementation-owner qualifications, not changes to that output.

The bounded repair checks `signal.aborted` before `threatEvidence.begin` and returns exactly one `fetchData()` invocation. It preserves the caller's fulfillment value or rejection object, while leaving empty, settled and live pending evidence untouched. No healthy vote, replacement token or cancellation of another owner's attempt is produced. Six focused behavior cases were added first and failed 8 pass / 6 fail; the guard then produced 14 pass / 0 fail. An independently applied guard-removal mutation on clean execution `0118e8e78` repeated 14/0 → 8/6 → 14/0, with inspected diff and exact restored checksum. [Applied mutation, commands, outcomes, hashes and review qualifications](UX-049-PREABORT-REPAIR.json).

On that clean repaired execution, all 37 trusted/PR affected-path scripts passed with exact stage-specific environments. The unchanged aggregate `bash scripts/agentic-validate.sh --tests 'test:ux049'` passed, with UX-049 runners 145/0 and 23/0. Explicit `npm run lint:ci` passed: 1,015 existing baseline findings, no increases, 30 changed files, zero errors and one existing ignored-declaration warning. Locked marketing dependency identities and `npm ls` remained valid; the ignored untracked generated sidecar bundle was preserved and restored byte-for-byte with its mode intact. No rules, baselines or tracked sources were excluded. Input hashes remained unchanged after all checks. Build timing/chunk advisories remain nonblocking.

Earlier broad-run evidence is retained only for unaffected bytes; this new receipt supersedes the transport helper/test qualification. Final source linearization, exact-head repair-cycle-two review and hosted checks remain required. Original AWC 404, AIS zero-vessel and native/installed-app limitations remain unchanged.
