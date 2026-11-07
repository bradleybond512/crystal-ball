# UX-018 — Forecast resolution receipts and evidence timing

**Status: MONITOR.** Implementation `8b1643d84` is verified locally. Closing UX-018 requires an approved installed build, seven real scheduled runs with evidence opportunities and a matched production coverage comparison.

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

## November 7 base reconciliation (candidate #1853)

Reconciled the bounded implementation with main `4cc92fa7731b1416b7ee3d032081ae1c22b9eac9`. The only merge conflict was additive targeted-test mapping; both UX-018 and main-owned ACC-510/UX-035 mappings are preserved. Inference semantics are unchanged. Fifteen of sixteen mutation source/test files are byte-identical to the original certificate candidate `8b1643d84`; the shared data-loader also contains main's independent news-domain changes. Its forecast readiness call site remains unchanged.

The task stays MONITOR, not DONE. Candidate #1853 does not satisfy the seven natural scheduled production passes or matched direct-label coverage comparison. Installation, scheduled production execution, historical relabeling, release and deployment remain outside this reconciliation. Review after 2026-11-14, contingent on separately authorized installation; the original acceptance requirements above remain the exit condition.

Fresh Node 22 verification of reconciled source (`9ad990256`):

| Command | Captured output |
| --- | --- |
| `npm run test:ux018` | `# pass 113`, `# fail 0` |
| `npm run test:intelligence` | `# pass 597`, `# fail 0` |
| `npm run test:diagnostics` | `# pass 442`, `# fail 0`; `# pass 64`, `# fail 0` |
| `npm run test:acc510` | `# pass 85`, `# fail 0` |
| `npm run test:panel-presentation` | `# pass 41`, `# fail 0` |
| `npm run test:roadmap-controller` | `# pass 126`, `# fail 0` |
| `npm run test:agentic-pipeline` | `# pass 82`, `# fail 0` |
| `npm run test:evidence-journal` | `# pass 40`, `# fail 0`; `# pass 68`, `# fail 0` |
| `npm run test:forecast-load` | `# pass 238`, `# fail 0` |
| `npm run test:pwa-deployment` | `# pass 26`, `# fail 0` |

`PATH=/opt/homebrew/opt/node@22/bin:$PATH TMPDIR=/private/tmp bash scripts/agentic-validate.sh --tests 'test:ux018 test:intelligence test:diagnostics test:acc510 test:panel-presentation test:roadmap-controller test:agentic-pipeline'` returned `Agentic validation gate passed.` The unchanged agentic-pipeline suite first reported `# pass 81`, `# fail 1` under the host's symlinked temporary path; canonical TMPDIR resolved its existing strict cwd-prefix assertion without source or assertion changes. The first roadmap run rejected a prose Review-after value; the ISO date repair passed both the structural check and complete fresh live candidate #1853 snapshot (38 open-main PRs plus 65 referenced records; no blocking findings).

[Reconciliation certificate](UX018-RECONCILIATION.json) records source/test identity and fresh shared-file mutations SCHED18/SCHED19. Each applied reversal produced `# pass 0`, `# fail 1`, between green `# pass 1`, `# fail 0` runs. Both restored SHA-256 `95167e9733c4b2b1b04ec8c539390f795ca20adc4a03deac570a23631e5cb349` with a clean tree. Other mutation proofs remain historical evidence on identical source/tests, not newly rerun claims. Fresh Sonnet review of this reconciliation is pending; the older verdict does not authorize the new tip.

## Pending warning-chain preparation, November 7

This is a conservative superset rehearsal, **not final actual-main or live-candidate acceptance**. Execution head `838c61bca42cfde125ac33107a97804656e24d36` combines the earlier UX-018 source with local pending dependency `6adfee497df1a1b9b5b99b581a63899e1cdeaaba`. Only additive test mappings conflicted. Inference source/tests stayed unchanged; updated App, loader and panel lifecycle integration passed refreshed SCHED18–22 mutation checks. Each was `# pass 1`, `# fail 0` → `# pass 0`, `# fail 1` → `# pass 1`, `# fail 0`, with applied diff inspection, restored checksum and clean tree.

The exact unmodified selector exported from actual main `4b047a1288291fd4f030985b26878c28b28b38d5` selected 112 commands across 173 changed paths and returned `[targeted-tests] 112 script(s) passed.` (exit 0). Main's package index and base ref remained pinned to that SHA for the completed run. The unchanged aggregate command `bash scripts/agentic-validate.sh --tests 'test:ux018 test:ux053 test:ux047 test:ux058 test:ux052'` returned `Agentic validation gate passed.` (exit 0). Both used Node 22 and the canonical realpath of the user's existing TMPDIR, not `/private/tmp`.

[Pending-dependency certificate](UX018-PENDING-DEPENDENCY-VALIDATION.json) records the execution SHA, exact selected commands, actual reported counts, source/test/build/selector hashes and refreshed mutation proofs. All 5,890 tracked file hashes matched before and after execution. The later evidence-only commit is not the execution SHA. An initial unsupported `--help` invocation accidentally launched a partial selector under host Node 26; it was stopped and is excluded from these results. Only the complete Node 22 run is counted.

Final actual-main transition must preserve corrected upstream evidence, compare required selection and changed bytes, execute any added or affected coverage, obtain a fresh complete live candidate snapshot and genuine Sonnet review, then satisfy CI. UX-018 remains MONITOR; no natural production-pass or comparable coverage acceptance is inferred from this rehearsal. No installation, production-ledger mutation, release or deployment was performed.

## Current-main-owned conservative rerun after trusted recipe repair

Execution **`bdbf5b55f98c23dbf6b07c5ef24f2d7e687f2496`** refreshes the pending dependency to `1886a48c40f8c1aba58ecd809565a02df7f90574`, retaining corrected upstream evidence and the direct Node UX050 precache-budget command. Product source and all 16 UX018 mutation source/test files match the earlier `838c61bca` execution. The executable changes are the inherited package recipe and trusted mapper regression tests, not inference logic.

The unchanged selector exported from actual main **`e104ebfe7768ab814dccc145b1dd3412c4912d60`** freshly executed **102 scripts** across 114 changed paths and returned `[targeted-tests] 102 script(s) passed.` (exit 0). The main ref and package index remained at that SHA through completion. This is a conservative pending-dependency run, not a final actual-main candidate pass.

Selection-name subset alone was explicitly rejected as sufficient evidence: UX050 and UX052 became main-owned, while quiet-hours and UX050 command text changed from the prior run. All current trusted commands were actually executed, including complete UX050 build/direct budget/bundle stages. [Current selector receipt](UX018-CURRENT-SELECTOR-VALIDATION.json) records command ownership, full commands, expanded stages, actual counts and input/output hashes. Historical outcome labels had a trailing display colon; this comparison strips that delimiter and uses the preserved actual command headers, not an assumed owner.

Fresh unchanged aggregate command `bash scripts/agentic-validate.sh --tests 'test:agentic-pipeline test:ux018 test:ux050'` also returned `Agentic validation gate passed.` (exit 0) on **bdbf5b55f**, with actual results `# pass 84`, `# fail 0`; `# pass 113`, `# fail 0`; and UX050 stages `# pass 89`, `# fail 0`, `# pass 4`, `# fail 0`, `# pass 2`, `# fail 0`. Both runs used Node 22 and the canonical user TMPDIR. All tracked file hashes matched before/after both runs. Subsequent documentation commits are not execution heads.

MONITOR and natural production evidence remain open. Final actual-main transition still requires preserving latest upstream receipts, checking effective command ownership/stages and changed bytes, rerunning added or changed coverage, a fresh live candidate snapshot, genuine exact-head Sonnet review and hosted CI. No production store, credentials, installation or delivery actions were used.

## Repaired upstream permission path: fresh type-aware lint and aggregate

The later upstream warning repair changes `notification-dispatcher.ts` and its trace tests. They are **not** identical to the earlier 102-suite execution; that earlier result is historical evidence only for unaffected inputs. The repair preserves denied-permission short-circuiting, uses a typed nullish reason fallback, and adds exact-reason/denied-Ghost assertions. Final upstream evidence from published pending head `abaa515e6af3479b79c91871a1a8b2de6f40c95b` is preserved. No UX018 inference implementation changed.

Fresh execution **`74ac3a192a8334f1ea0d14d4d17b76aad62c10ac`** passed `npm run lint:ci` and the unchanged aggregate `bash scripts/agentic-validate.sh --tests 'test:ux018 test:ux058 test:ux052 test:warning-delivery test:notifications test:ux053 test:agentic-pipeline'`, both exit 0. Actual base stayed `6dec686846bcf9f12a6de3062ac1b46697d49259`; this was not an inferred merge or final actual-main candidate execution. Exact test counts were UX018 113/0, UX058 90/0, UX052 117/0, warning-delivery 45/0, notifications 227/0, boot 1/0 plus 71/0, and agentic-pipeline 84/0. All tracked file hashes remained unchanged across execution.

Type-aware lint was run in the CI-equivalent checkout shape, without changing tracked files, lint rules or baselines. The existing regular generated `s2u-xmpp.bundle.mjs` was proven untracked, ignored and owned by `scripts/build-sidecar-xmpp.mjs`, reversibly moved outside the checkout during lint, then restored to its exact SHA-256. Marketing dependencies were linked only after matching package/lock bytes, checking 494 installed lock entries, and obtaining `npm ls --depth=0` exit 0. [Restoration, commands and hashes](UX018-REPAIRED-LINT-GATE.json) record the setup. The full baseline reported **1015 existing findings, no increases**; changed-file lint reported **0 errors, 1 warning** for the existing `nws-alert-row.d.mts` ignored-config condition. These are not new errors and no baseline was ratcheted or weakened.

The aggregate concluded `Agentic validation gate passed.` The later receipt commit is metadata only, not the execution SHA. Earlier focused repair tests ran on a staged merge tree proven identical to committed `bd9a2ca516c5b602090ad89bc7190017410ef4ef`; that receipt does not misattribute those runs to the old pre-merge HEAD. Current source still requires the final actual-main comparison, live candidate snapshot, exact-head Sonnet review and hosted CI. MONITOR production acceptance remains open.

## Actual-main transition after #1852 merged

Verified actual main **`f106fc842528b63ccc592f7d12e8089550fc36df`** is integrated at source **`e9f9e9ad562aeca3af7160206858302bc7fc7186`**. Every source/test/build/mapper root Git object matches the repaired lint-and-aggregate execution **`74ac3a192a8334f1ea0d14d4d17b76aad62c10ac`**. Latest upstream QA and the final warning repair receipt are retained. This history-only transition does not pretend those earlier commands ran again.

The authoritative actual-main selector now requires **64 scripts**. Their effective commands are audited against the qualified 102-script execution, not merely compared by name. UX053 and UX058's newly main-owned expansions were freshly executed again on **e9f9e9ad5**, yielding UX053 `# pass 1`, `# fail 0` plus `# pass 71`, `# fail 0`, and repaired UX058 `# pass 90`, `# fail 0`. The other 62 effective command paths match the prior selection; changed dispatcher/test inputs are additionally covered by the repaired **74ac3a192** aggregate and focused repair evidence, not asserted unchanged against **bdbf5b55f**. No fresh full 64-suite execution is claimed.

A complete fresh live GitHub snapshot explicitly naming candidate **#1853** contains 103 PR records and passes with no blocking roadmap findings. [Actual-main continuity](UX018-ACTUAL-MAIN-CONTINUITY.json) records the source, required stages, actual focused runs, root objects and snapshot hash. This evidence-only update is not an execution commit. Genuine exact-head Sonnet review and hosted checks remain required. UX018 stays MONITOR: seven natural scheduled production passes and comparable direct-label coverage are still unproven and require separately authorized installation.
