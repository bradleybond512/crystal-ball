# UX-034: breaking banner follows the measured shelf

## Scope and status

Standard existing-contract repair based on main
`0a01b4b24f1dc5f8beb617ade94650a514d2728b`. UX-034 remains MONITOR.
Only production change: `BreakingNewsBanner.ts`. No rail redesign, CSS change,
stack cap, alert priority, dismissal, sound, warning routing or native change.
Corrected CI-owner local qualification below passed. Independent review remains
pending; no
publication or release is authorized by this receipt.

The banner now observes the same shelf border box whose bottom it measures.
A filtered direct-body child watcher reconciles late mount, replacement, removal
and reattachment. At most one shelf is observed; identical targets do not rebind.
Destroy disconnects observation and guards queued callbacks. The exact rectangle
calculation and absent-shelf 44px fallback are unchanged.

## Tests-first and fixture fidelity

Exact-main reproduction: ordinary row growth moved shelf.bottom 80 to 184 while
breaking.top remained 80, yielding 45px overlap. Shrink/removal left 24/36px gaps.
Reservation was correct; viewport and body classes were stable and no posture
row existed. Synthetic alerts and disposable Chromium only, no personal alerts.

The extended existing summary harness loads the full production CSS import graph.
Initially its old simplified native shell omitted the native toolbar: full native
CSS hides the web header, producing summary.top 36 versus shelf.bottom 80.
Adding the actual `.mac-content-toolbar` class restores the missing 44px shell
origin without changing production CSS or expected assertions. Independent
architect reproduction confirmed both the minimal correction and full native
shell topology. This was fixture mismatch, not evidence of a production summary
bug. All eight existing assertions now execute under the full CSS graph.

Before production edits: browser `RESULT 10 pass / 12 fail`; lifecycle 0 pass / 4
fail. The twelve failures were the six new geometry cases in each style variant.
After the narrow repair: browser `RESULT 22 pass / 0 fail`; lifecycle 4 pass / 0
fail; weather 411 pass / 0 fail. The final tests independently seed shrink at
140px and removal at 12px; clean-tree mutation proofs below use those final
post-hook test bytes, distinct from the initial tests-first run.

Node 22.23.1, npm 10.9.8, canonical user TMPDIR. Existing root dependency donor
matched the package lock; no dependencies installed. Commands:

```sh
npm run test:summary-strip-layout
npm run test:breaking-stack-lifecycle
npm run test:weather
```

The existing Accessibility CI job owns the real-browser harness and installs
Chromium. Additive Node mappings select the lifecycle recipe; no selector policy,
workflow or baseline changed. The initial browser adapter was removed by the
CI-owner correction below. Browser cases are reported separately from Node tests.

## Remaining acceptance and rollback

Review after: 2026-11-15.
Exit condition: verify full application startup/interactions and coexistence with
correlation/entity/related/Just In rails, plus installed macOS/WebKit acceptance.
Chromium native styling is not installed native acceptance. UX-033 cap and
horizontal sidebar allocation remain separate. Arbitrary nested shelf parents,
body replacement and position-only movement without existing class/window
triggers are outside this narrow repair. No full UX-034 completion claim.

Rollback: revert this bounded source/test/evidence change; no migrations, persisted
state, permissions or dependency changes exist.

## Historical wrapper-based local qualification (superseded wiring)

Execution source commit: `5399308419806f9ad47d4a1f8abc52a92326be09`.
Execution tree: `79ccfbeaa97b6fd10398ca73e08aa167794fb491`.
Pinned actual-main/selector base: `0a01b4b24f1dc5f8beb617ade94650a514d2728b`.
The later evidence-only commit does not represent a new source execution.

Normal hooks passed before mutation proofs. Each independent mutant started clean,
printed its applied diff, restored the original source SHA-256, and ended clean:

| Mutant | Before | Applied mutant | Restored |
| --- | --- | --- | --- |
| Remove shelf observe binding | Browser 22/0 | Browser 14/8 | Browser 22/0 |
| Disable direct-child reconciliation | Browser 22/0 | Browser 18/4 | Browser 22/0 |
| Remove queued positioning lifecycle guard | Lifecycle 4/0 | Lifecycle 3/1 | Lifecycle 4/0 |

Counts are pass/fail. Browser wrapper is one Node runner test, containing 22
browser cases, not 23 independently counted cases. No source-only assertion or
fake geometry substitutes for the browser mutations.

Exact SHA-256 boundaries:

```text
BreakingNewsBanner.ts: abe374cd1b30302d986222b79c318f68843b46d91a3a24b172dc5ec66eb978a3
summary-strip-layout.mjs: 8f15cd761b2610763f173ac0bdf4428b91b62164690f2b6d9d76378dd0325ebb
breaking-news-stack-lifecycle.test.mts: dd98bc0cae3f5bab2bc739131a7a2b4083357430c73e3b5cd35689be03b3e3a9
breaking-stack-layout.test.mjs: 781342c439c45fbac8f045de263ce4c2684ce6de4f8d6241477489dd875c85fb
```

The unchanged selector copied from exact actual main selected and executed all 51
scripts: 4712 Node runner tests passed, zero failures/skips. Its complete selected
recipes, main-versus-PR ownership, expanded stages and stage environment overrides
are recorded in `ux034-plan.json`. Both new recipes are explicitly selected;
additive mappings do not replace or weaken main requirements. Supplemental
single-path selection confirms each changed source/test path selects both suites.

Explicit `npm run lint:ci` passed: full repository baseline 1006 existing findings,
no increases (197 debt drop reported, baseline deliberately unchanged), and all
four changed JS/TS targets clean. Marketing package/lock matched the existing donor;
494 installed package versions and lock entries verified. No installation.
Selector execution generated the ignored sidecar bundle. The preflight stopped
before lint when detecting it, then verified it was untracked and ignored and
reversibly preserved only that bundle during lint. Restored SHA-256 and mode match:
`4c5328fdbdf07514d9f04d5bd7815dd99664a23455418026c0c3b97074dc11ce`, mode 0644.
No dist directory moves, source exclusions or validation-rule changes.

```sh
bash scripts/agentic-validate.sh --tests "test:breaking-stack-layout test:breaking-stack-lifecycle test:weather test:agentic-pipeline"
```

The unchanged aggregate passed: 500 Node runner tests (1 browser wrapper, 4
lifecycle, 411 weather, 84 pipeline), zero failures/skips; lockfile, strict lint,
all typechecks, secret scan, cross-agent structural check, docs, roadmap and
frontend build passed. Cross-agent structural validation is not independent
review. Build retained existing Vite native-config extension warnings, dynamic
chunk/debug-name/timing advisories and chunks above 1200kB; no thresholds changed.
All tracked inputs remained byte-identical through selector, lint and aggregate;
674 build-file hashes were captured after each build boundary.

Replay of the original isolated reproduction on the fixed source yields
breaking.top == shelf.bottom at 80, 184, 56 and 44px, zero overlap/gap and zero
body-class/viewport events. Grown screenshot inspected. That direct comparison
retains its original simplified shell; summary assertions use the separately
corrected native-toolbar fixture described above.

Local audit artifacts on the implementation Mac are under
`/tmp/cb-merge-nov7/`: `ux034-plan.json`, `ux034-selection.log`,
`ux034-selector-run.log`, `ux034-selector-counts.json`,
`ux034-mutations/receipt.json` and its applied diffs/before/red/restored logs,
`ux034-marketing.json`, `ux034-lint-receipt.json`, `ux034-lint-ci.log`,
`ux034-aggregate.log`, `ux034-{selector,aggregate}-build.json`,
`ux034-fixed/geometry.json` and screenshots, and `ux034-fixture-proof.json`.

## Prior integration hold (resolved by composite below)

Frozen UX044 PR #1854 separately changes the same summary harness to use
CriticalPostureBanner and adds a polite-status accessibility case. This candidate
does not integrate pending UX044 code. After that change reaches actual main,
preserve both harness changes and rerun layout/lifecycle and effective selected
paths before review/publication. UX-033 stack cap remains separately owned.
Independent review, installed native acceptance and broader rail acceptance are
still open. No Claude invocation, verdict, push, merge or native/release action
was performed for this candidate.

## CI execution-owner correction

The initial plain-node browser adapter incorrectly assumed the Node-only targeted
job had a Playwright Chromium installation. It does not. That adapter, its new
package recipe and its override references are removed; no production, browser
assertion, lifecycle test, workflow, selector rule or baseline is changed.

Existing `.github/workflows/accessibility.yml` owns browser execution: on each
in-repository PR, push to main and merge-group event, it runs Node 22, `npm ci`,
`npx playwright install --with-deps chromium`, then the unchanged
`npm run test:summary-strip-layout` recipe. All 22 browser cases remain there.
The Node-only targeted job selects the four-case lifecycle recipe through additive
mappings. All checks must pass before merge. Hosted CI remains pending publication.

The earlier 51-script/4712-runner and 500-runner wrapper-based aggregate receipts
are historical, not corrected final counts. Fresh selector, explicit lint and
aggregate qualification passed on the correction commit as recorded below. The
old mutation proofs remain historical: all three were rerun with the corrected
direct command rather than assuming wrapper environment continuity.

## Corrected final local qualification

Qualified execution: `cc542e5c5a00660e3f7abd8c47f601b9b23acb9e`, atop actual main
`0a01b4b24f1dc5f8beb617ade94650a514d2728b`. Original source/evidence heads
`5399308419806f9ad47d4a1f8abc52a92326be09` and
`9e3a07ae59e890ef0b9d4ef8be8c2842068931ec` are preserved as local backup refs.
The production, browser-harness and lifecycle-test SHA-256 values above remain
identical; only adapter/package/mapping/evidence wiring changed.

Fresh clean-tree mutation proofs on the correction commit used
`npm run test:summary-strip-layout` for both geometry mutants and
`npm run test:breaking-stack-lifecycle` for the lifecycle mutant, under Node
22.23.1/npm 10.9.8/canonical TMPDIR. Actual direct browser execution is
`node e2e/summary-strip-layout.mjs`, with no Node-test wrapper. We reran instead of
assuming equality of wrapper npm lifecycle/Node-test context environment variables.

| Fresh direct-command mutant | Before | Applied mutant | Restored |
| --- | --- | --- | --- |
| Remove shelf observe binding | Browser 22/0 | Browser 14/8 | Browser 22/0 |
| Disable direct-child reconciliation | Browser 22/0 | Browser 18/4 | Browser 22/0 |
| Remove queued lifecycle guard | Lifecycle 4/0 | Lifecycle 3/1 | Lifecycle 4/0 |

Each recorded the actual applied diff and restored the source hash and clean tree.

The unchanged actual-main selector selected and ran **50 scripts / 4711 Node
runner tests**, zero failures/skips. Its expanded effective commands and stage.env
forwarding are captured. Each of the three changed source/test paths individually
selects the new lifecycle recipe; existing derived suites remain selected. There
is no new browser recipe in the Node-only targeted job. Existing Accessibility
workflow ownership, event conditions, Chromium install and unchanged summary
recipe are separately verified. Hosted CI is still pending publication, not a
local pass; all checks must pass before merge.

Fresh explicit `npm run lint:ci` passed: baseline 1006 existing findings, no
increase, 197 debt reduction advisory left unchanged, and three changed targets
clean. Marketing lock/manifests and 494 installed packages were reverified. Only
the ignored/untracked generated sidecar bundle was reversibly preserved during
lint and restored byte/mode-identically. No installs or dist moves occurred.

```sh
bash scripts/agentic-validate.sh --tests "test:summary-strip-layout test:breaking-stack-lifecycle test:weather test:agentic-pipeline"
```

This unchanged aggregate passed **499 Node runner tests** (4 lifecycle, 411
weather, 84 pipeline), zero failures/skips, plus the direct browser result
`RESULT 22 pass / 0 fail`. Browser cases are not counted as Node runner tests.
All remaining aggregate stages and frontend build passed. Existing Vite import,
chunk-size, debug-name and timing advisories remain; no suppression or threshold
change. All tracked inputs remained byte-identical through selector/lint/aggregate;
674 build artifact hashes were captured after each build boundary. The subsequent
evidence-only commit is not presented as a new source execution.

Corrected artifacts: `/tmp/cb-merge-nov7/ux034-ci-owner/` contains `plan.json`,
`ownership.json`, `selection.log`, `selector-run.log`, `selector-counts.json`,
`mutations/receipt.json` plus before/red/restored logs and actual diffs,
`dependencies-and-source.json`, `marketing.json`, `lint-receipt.json`,
`lint-ci.log`, `aggregate.log`, `aggregate-counts.json`, and
`selector-build.json` / `aggregate-build.json`. These supersede the old wrapper
execution counts without renaming historical receipts. All MONITOR, native,
broader-rail, UX044 integration and publication/review holds above remain in force.

## Pending UX033 composite integration

Actual main at integration is `42034cfaa8d49004de90e333dd1946e9e505a936`
(merged UX044). Local pending base is
`3114acc2b5894074454d5549a8b792cec321271a`, whose UX033 source is
`913f3c1bd0c8746e741f462a63154310b2b7283e` plus verdict-only metadata.
This is not a claim that UX033 is merged. Original UX034 branch/head 728fcb0d4
and all previous qualification remain preserved.

Reconciled conflicts in the summary harness and additive test mappings only:
actual CriticalPostureBanner and its polite-AX assertion are retained alongside
full production CSS, native-toolbar fixture fidelity and all UX034 cases.
BreakingNewsBanner and lifecycle source bytes remain unchanged. NotificationStack
matches the pending upstream cap exactly. Browser ownership remains in the
existing Accessibility workflow; no new adapter or workflow change.

Initial integration checks: summary 23/0 (nine upstream plus fourteen added cases),
lifecycle 4/0, unchanged warning-stack cap harness 5/0. Fresh mutations, explicit lint and aggregate qualification passed on the
composite execution recorded below.
Actual native speech/macOS notification, installed WebKit and broader rail exits
remain open. Final actual-main transition and review/publication are coordinator
owned; no push, model review, release or install is authorized here.

## Qualified composite receipt

Execution: `8a14a150afee746fc3c3cfc4234e2f467b0ab73f` on preserved branch
`codex/ux034-pending-ux033-nov7`. Normal source commit hooks passed. Qualification
used pinned origin/main `42034cfaa8d49004de90e333dd1946e9e505a936` and immutable
pending base `3114acc2b5894074454d5549a8b792cec321271a`; these identities were not
silently replaced during the run. Original UX034 branch remains at 728fcb0d4.

During qualification UX033 landed at actual main
`4edcc70c99069ef96a75a06aec2c4af94e2c7c06`. Read-only comparison proves pending
3114acc2 and actual 4edcc70c have identical complete Git tree
`67d52988dade4e893368ff4f6c011f188af6eaf5` and an empty diff. This identity is
separate from execution provenance: no final actual-main branch transition was
performed. The coordinator owns that transition and final review/publication.

Fresh direct-command mutations on the reconciled 23-case harness:

| Mutant | Before | Applied | Restored |
| --- | --- | --- | --- |
| Remove shelf observation | Browser 23/0 | Browser 15/8 | Browser 23/0 |
| Disable direct-child watcher | Browser 23/0 | Browser 19/4 | Browser 23/0 |
| Remove queued lifecycle guard | Lifecycle 4/0 | Lifecycle 3/1 | Lifecycle 4/0 |

Every mutation recorded its applied diff, restored SHA-256 and clean status.
These are fresh composite runs, not renamed earlier 22-case receipts.

The full unchanged main-owned selector ran **51 scripts / 4737 Node tests**, zero
failures/skips. Complete selected recipes, main/PR ownership and expanded stage
environments were captured. Existing Accessibility owns the browser harness;
additive Node mappings retain UX044 and lifecycle coverage without a browser
adapter or workflow change. Hosted checks for this candidate remain pending.

Explicit `npm run lint:ci` passed: 1006 existing findings, no increase, six changed
targets clean. The 197-debt reduction advisory was not used to alter a baseline.
Marketing lock/manifests and 494 installed packages were reverified. The ignored
sidecar bundle alone was preserved for lint and restored with identical hash/mode;
no dist movement, installation, source exclusion or validation-rule change.

```sh
bash scripts/agentic-validate.sh --tests "test:summary-strip-layout test:warning-stack-layout test:breaking-stack-lifecycle test:ux044 test:ux047 test:weather test:agentic-pipeline"
```

The unchanged aggregate passed **649 Node tests** (4 lifecycle, 26 UX044,
124 UX047, 411 weather, 84 pipeline), zero failures/skips, plus **23 summary
browser cases and 5 cap browser cases**. Browser cases are separate from Node
runner totals. All aggregate checks and frontend build passed, with existing Vite
native-config/import/chunk/debug-name/timing advisories unchanged. All tracked
inputs remained byte-identical through the qualification; 674 build artifact
hashes were captured after selector and aggregate build boundaries.

Additional isolated active-breaking/capped-shelf probe on the same source grew
an ordinary row to 900px. The shelf capped at 270.390625px and breaking.top
followed its measured bottom 314.390625px, then followed shrink/removal at 56/44px.
All four stages had zero overlap/gap and zero body-class/window-resize triggers.
This supplements, rather than replaces, the unchanged upstream cap harness.

Exact receipts are under `/tmp/cb-merge-nov7/ux034-pending/`: `plan.json`,
`integration-continuity.json`, `upstream-tree-continuity.json`, `ownership.json`,
`selection.log`, `selector-run.log`, `selector-counts.json`,
`mutations/receipt.json` and applied diffs/before/red/restored logs,
`marketing.json`, `lint-ci.log`, `lint-receipt.json`, `aggregate.log`,
`aggregate-counts.json`, `selector-build.json`, `aggregate-build.json`, and
`cap-follow/geometry.json`. The later evidence-only commit is not a fresh source
execution. UX044 harness integration is resolved; independent review, final
actual-main transition, native speech/notification/WebKit and broader rail
acceptance remain open. UX-034 stays MONITOR with Review after 2026-11-15.

## Full pending roadmap composite preparation

Actual-main qualification base remains
`4edcc70c99069ef96a75a06aec2c4af94e2c7c06`. New immutable pending base is
`1c24ecef44f940f390d710e7a11b60dbe2cfbc98` (ACC508), atop ACC505
`e30ae193d6ae3fa7349bf647c6c96fa68c76932c` and UX037/link source
`efc95984a1dc5f2d7f50d88a9c721c4b64b5a3bc`. None of those pending heads is
claimed reviewed, pushed or merged. Live dependency blockers remain #1840 and
PR #1856. This preparation does not rewrite their owners' evidence or claims.

Only the approved seven-file UX034 delta from preserved f20e728a2 relative to
actual 4edcc70c was applied. Package and mapper conflicts were resolved by keeping
all pending upstream content and adding only the lifecycle recipe/mappings.
Production, browser and lifecycle bytes match f20e728a2; all upstream accuracy,
link, cap and accessibility inputs remain untouched. Original f20 and historical
qualification are preserved on their separate branch.

Initial focused composite checks passed: summary 23/0, lifecycle 4/0, cap 5/0,
UX044 26/0 and UX047 124/0. Fresh mutation and combined selector/lint/aggregate
qualification remain pending this source checkpoint. Node22 uses the canonical
macOS user TMPDIR resolved from DARWIN_USER_TEMP_DIR, explicitly not /private/tmp.
All review/publication/native/full-app holds remain. Final actual-main transition
is coordinator-owned.

## Corrected full pending composite preparation

The prior full pending source `c707139792b1d2535ae39225ace7e3bd886a77e0` is
preserved and **not qualified**: its 88-script/9300-test selector finished, but
coordinator discovery of the upstream chronology defect triggered a safe stop.
Lint had automatically started and was intentionally interrupted; its generated
sidecar artifact was restored exactly. Aggregate was never started. The stopped
receipt remains `/tmp/cb-merge-nov7/ux034-full-pending/stopped-receipt.json`.

Replacement immutable pending base:
`79ebd71f5a4e277188b29d3a2d7acb4059f5cbf1`, atop actual main
`4edcc70c99069ef96a75a06aec2c4af94e2c7c06` plus pending UX037 and corrected
ACC505/ACC508. Upstream finite-normalizes unknown predictedAt so future resolvedAt
cannot be masked by NaN. The accuracy owner freshly qualified that repair; this
UX034 preparation neither changes those files nor substitutes old flawed receipts.

Only the same approved seven-file UX034 delta is applied on the corrected base;
no conflicts or additional production edits were required. Initial focused
summary/lifecycle/cap/UX044/UX047 checks passed 23/4/5/26/124 respectively, zero
failures. Fresh applicable mutations and full combined selector, explicit lint
and aggregate/build passed on the corrected execution recorded below. Node22 uses the canonical
wrapper and qualified user TMPDIR. Pending heads are not described as actual main,
reviewed, pushed or merged. All acceptance and publication holds remain.

## Corrected combined qualification receipt

Executed source: `ab0725e3a3832cdd1aadae50a25d4b997aff1ea9`, a clean linear commit
on immutable repaired pending base `79ebd71f5a4e277188b29d3a2d7acb4059f5cbf1`.
Actual-main selector/lint pin throughout qualification:
`4edcc70c99069ef96a75a06aec2c4af94e2c7c06`. Pending UX037/ACC505/ACC508 are not
misrepresented as merged main. Source and final evidence commits use normal hooks.

Continuity proves exactly the approved seven-file UX034 delta. Production,
browser-harness and lifecycle-test bytes match preserved f20; every upstream blob
outside that delta is untouched. All upstream package recipes, dependency sections
and mappings remain, with only additive lifecycle coverage. The repaired chronology
helper and regression are byte-identical to the accuracy owner's immutable base.
The stopped c707 branch/receipts remain preserved and are not current qualification.

Fresh direct-command UI mutation proofs on this corrected combined source:

| Mutant | Before | Applied | Restored |
| --- | --- | --- | --- |
| Remove shelf observe binding | Browser 23/0 | Browser 15/8 | Browser 23/0 |
| Disable direct-child watcher | Browser 23/0 | Browser 19/4 | Browser 23/0 |
| Remove queued lifecycle guard | Lifecycle 4/0 | Lifecycle 3/1 | Lifecycle 4/0 |

Each records its applied diff, source/test hashes and clean restoration. No old
whole-file mutant result is relabeled as a new execution.

The complete unchanged actual-main selector was freshly executed, not just audited:
**88 scripts / 9304 Node tests**, zero failures/skips. Complete effective recipes,
main-versus-PR ownership and expanded stage environment overrides are recorded;
actual execution forwards stage.env. The unchanged Accessibility CI job owns
Chromium and the summary browser harness; no browser adapter/workflow was added.

Explicit `npm run lint:ci` passed: 1006 existing baseline findings, no increases,
23 changed targets. The 197-debt reduction advisory and the existing unmatched
configuration warning for `scripts/correlation-benchmark.mts` were retained, not
suppressed. Marketing manifests/lock/vendor and 494 installed packages matched;
root dependency lock matches its existing donor. No packages were installed.
Only the verified ignored/untracked sidecar bundle was reversibly preserved during
lint, then restored with identical SHA-256/mode. No dist moves or source exclusions.

```sh
bash scripts/agentic-validate.sh --tests "test:summary-strip-layout test:warning-stack-layout test:breaking-stack-lifecycle test:ux044 test:ux047 test:weather test:agentic-pipeline test:untrusted-html test:acc505 test:acc508"
```

The unchanged aggregate passed **759 Node tests**: lifecycle 4, UX044 26, UX047
124, weather 411, pipeline 84, untrusted HTML 66, repaired ACC505 23 and ACC508 21;
zero failures/skips. Separately, browser results were **23 summary / 5 cap cases,
all passed**. All remaining aggregate stages and frontend build passed. Existing
Vite native-config/import/chunk/debug-name/timing advisories remain unchanged.
Node22.23.1/npm10.9.8 used the canonical wrapper and qualified user TMPDIR
`/private/var/folders/qt/hq7cydbd06d6g0yksx3mxm3c0000gn/T`, not `/private/tmp`.
All tracked input hashes remained exact through qualification; each build boundary
has a 674-file artifact manifest. Final evidence-only edits are not presented as
a fresh source run.

Fresh evidence here is the listed focused tests, UI mutations, full 88-script
selector, explicit lint and combined aggregate/build. The accuracy owner's repaired
standalone benchmark/seed/migration artifacts and chronology mutation receipts are
retained by exact upstream identity, not claimed as rerun here. Historical visual
screenshots/probes likewise keep their original execution provenance. This is not
installed native, speech/notification or complete full-app acceptance.

Current receipts: `/tmp/cb-merge-nov7/ux034-corrected/` contains `plan.json`,
`integration-continuity.json`, `ownership.json`, `selection.log`,
`selector-run.log`, `selector-counts.json`, `mutations/receipt.json` and actual
diffs/before/red/restored logs, `marketing.json`, `lint-receipt.json`,
`lint-ci.log`, `aggregate.log`, `aggregate-counts.json`, `selector-build.json`
and `aggregate-build.json`. Upstream repaired evidence remains under
`/tmp/accuracy-chronology-repair/` with its original source identities.

All native/full-app/rail exits remain open; UX-034 stays MONITOR and its ISO review
date/exit conditions are unchanged. The pending dependency chain, final actual-main
transition, independent reviews and hosted CI remain coordinator-owned gates.
No model call, verdict, push, readiness flag, merge, release/tag, dispatch,
installation or deployment was performed for this qualification.

## Metadata-only preparation on actual-main1bf pending accuracy

The owned seven-file UX034 delta is applied atop immutable pending ACC508
`ea856d3cc05e0ae75abf738b65f6ab5971958abb`, whose parent is pending ACC505
`79643689c1a2dd7a23b2bde6be7bc9f90266f55b`. Actual main is
`1bf063349fd826072eff51ab5daf8797735c5176`; ACC505 is under hosted CI, not merged.
This is pending preparation, not final actual-main transition or a new full run.
Qualified b62759185, execution ab0725e3a, stopped c707 and prior history remain
preserved. No source/test behavior changes are intended; exact post-hook continuity
and current effective-plan audit are required before inheriting the ab0725 receipts.

### Current preparation continuity result

Prepared source `6fb3f1474c25d9f57a372a4bbe6a9451e7df6e4b` passed normal hooks.
Every non-evidence Git blob and mode equals qualified execution ab0725e3a.
Only the inherited UX038/#1840 review JSON and four roadmap/QA documents differ.
All 674 existing aggregate-build artifacts rehash identically; they are historical
ab0725 output, not a new build. Physical root dependencies/lock/relevant tool
versions and marketing lock/494 installed entries/13 vendor files still match.

Actual ab0725 logs record Node22.23.1/npm10.9.8, executable paths and canonical
user TMPDIR. Current Node SHA-256 is
`79bc31d84868436058ea7e020626a8046905bd5361e5d30d47917ee6e6d9120f`;
current npm-cli SHA-256 is
`8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7`.
Both match current frozen upstream runtime. Earlier UX033 receipts at
`/tmp/ux033-actual-42034/{final-receipt,continuity}.json` independently match Node
and the physical tsx/tsc/Vite/ESLint tools. Those earlier files contain no npm hash.
Verified Node mtime/ctime are 1783374035/1783374037; npm-cli mtime/ctime are
1782232065/1783374034, all predating today's runs. This before/after evidence,
recorded execution environment and physical dependency identity show no observed
runtime change. No missing ab-time binary-hash field is invented.

Raw diagnostics that incorrectly assumed absent historical fields are preserved
in `failed-runtime-diagnostic.txt`; they did not detect changed executables and
are not an extra approval or full-gate requirement.

The exact actual-main1bf combined selector audit still selects 88 suites. UI
component coverage retains suites removed from accuracy-only plans. One owner
changed: `test:live-news-links` is now trusted main, with the same recipe formerly
PR-only. Both exact trusted stages were freshly run with stage.env forwarding:
12 plus 46 tests passed, zero failures/skips. Every other owner/command/stage plan
is identical. No new full selector, aggregate, build, explicit lint, benchmark or
mutation execution is claimed. The qualified ab0725 proofs retain their dates,
roots and source identity; b627, stopped c707 and older receipts are preserved.

Current audit directory: `/tmp/cb-merge-nov7/ux034-main1bf/`, containing plan and
plan-continuity JSON, continuity JSON, runtime logs and before/after hash/stat
proof, marketing proof, changed-execution JSON/log, raw failed diagnostics and
normal-hook logs. No shared main ref was fetched or moved. Final actual-main
transition, review and publication remain coordinator-owned after accuracy PRs
land. Native/full-app/rail exits and UX-034 MONITOR conditions remain unchanged.

## Final actual-main transition (2026-11-07)

Source `405c8520e72b273451f6876e4ff876c65c3c8cee` applies only the approved
seven-file UX034 delta to actual merged main
`5b08d9e819af566a7f7609a7fc643ed3bd1ffa2b`, on new branch
`codex/ux034-breaking-stack-follow-nov7`. Prior pending ba1d, qualified ab0725/b627
and stopped c707 histories remain preserved. Upstream reviews/QA are retained;
the inherited review label above is corrected to UX038/#1840.

Post-hook verification finds all non-evidence Git blobs/modes identical to
qualified ab0725, and rehashes all 674 qualified build files successfully.
Root lock/physical dependencies, relevant installed tools, matching marketing
lock/494 installed entries/13 vendor files still match. Current Node/npm hashes
and timestamps and earlier project-tool anchors were reverified; historical
ab-time binary hashes and an earlier npm hash remain unavailable, not invented.
The narrower runtime scope and raw earlier failed field-assumption diagnostics
remain as documented above.

Actual-main effective selection is now 52 suites (previous composite 88), with
no new or changed effective owner/command/stages relative to the prior audited
plan. ACC505/ACC508 no longer select because their changes are now upstream.
No additional stages or full gates were required or run. Reused ab0725 results
remain 9304 selected Node tests; aggregate 759 Node tests plus 23 summary browser
and 5 cap browser cases; explicit lint and build passed. The three clean mutation
proofs retain their original execution identities, not newly rerun claims.

Fresh complete live main-target snapshot includes 23 open PRs and 80 referenced
reads (103 total records); actual-main baseline reconciliation has zero blockers.
No UX034 PR exists yet, so candidate PR list is empty rather than inventing a PR.
The branch/task delta is validated locally; future publication must refresh the
real candidate snapshot and hosted checks. Evidence is in
`/tmp/cb-merge-nov7/ux034-main5b08/` (plan, continuity, runtime, snapshot, roadmap,
normal-hook logs and final receipt). Existing Accessibility owns the 23 Chromium
cases; required targeted Node lifecycle mapping is unchanged.

UX034 remains MONITOR with its existing Review after and Exit condition.
Native speech/notifications, WebKit/full-app and broader rail acceptance remain
open. Independent review, draft publication and all hosted checks remain pending;
no model call, push, PR creation, install or release action was performed.

## Real candidate #1861 evidence correction (2026-11-07)

Draft #1861 now claims UX034. Its first complete candidate snapshot correctly
rejected MONITOR without the candidate number in roadmap evidence. The existing
controller explicitly supports evidence-backed MONITOR; no controller, test,
status or acceptance rule is changed. Both the Evidence line and tracker now
identify #1861. Review after 2026-11-15 and all Exit conditions remain intact.

Prior source b82ae87f received a genuine zero-blocker Sonnet review, recorded in
verdict dbc40db; both are backed up. This metadata-only repair is rebuilt as one
source commit on unchanged actual main5b08d9 and requires fresh independent
review and hosted gates. Historical ab0725 test/lint/build/mutation counts remain
reused exact-input proofs, not new executions. Fresh unchanged roadmap-controller
tests and the complete real-candidate snapshot gate validate the evidence repair.
Receipt directory: `/tmp/cb-merge-nov7/ux034-pr1861-repair/`. Native speech,
notifications, WebKit/full-app and broader rails remain MONITOR limitations.
