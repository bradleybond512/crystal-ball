# Persisted forecast load hardening

Selected Q18/R4-LOW-008 hardening, originally PR #1784 on PR #1777.
This private repair preserves canonical main
`294534674915c7644762190f01522fbb90dfc2f2` and accepted private evidence parent
`5e77762340770f7712c319d9638de3547f7dc8ff`. Their integration foundation is
`cbd084466a09126a2b98d0f94ee87dca3b922ff8`. Existing ACC task statuses remain
unchanged; this work claims no prediction accuracy uplift.

## Behavior and boundary

The original raw persisted-array cast admitted malformed rows. The first
parser additionally discarded invalid present provenance while retaining a
resolved outcome. A numeric resolver ID could therefore turn a proxy outcome
into apparently manual history, changing real baseline and audit inputs.

The adapter now passes the actual localStorage blob through the loader before
`store.loadJson`. The loader rebuilds known top-level fields, validates required
strings, finite timestamps, probability in [0,1] and known statuses, then sorts
and keeps the newest 500 accepted rows. Unknown top-level fields are dropped.
The accepted parent's loaded-row evidence capture loop is preserved.

Resolved true/false rows reject invalid **present** criteria or provenance.
Own-property presence matters: null, false and own undefined are not legacy
absence. Truly absent metadata remains compatible. Resolved provenance requires
a direct/proxy kind, a string resolver ID and an actual evidence array whose
items have string-array sourceIds and finite observedAt. Present optional value,
reference and supportsOutcome have finite-number, string and boolean types.

Pending/expired metadata is normalized for store cloning: invalid containers
are omitted; absent/nonarray evidence becomes []; primitive and clone-unsafe
object evidence is filtered. Valid structured empty evidence and empty string
resolver IDs are retained, including evidence-journal reconstruction payloads.
Nested unknown fields and audit-visible semantic defects are retained.

Criteria checks enforce known kinds and clone safety, rather than a new full
resolver schema: event arrays contain strings; warning polygon/rings/coordinate
tuples and reportTypes have the shapes the clone consumes. Partial market_move
criteria remain compatible. Invalid resolved criteria rejects the row; invalid
pending/expired criteria is omitted. These checks do not certify semantic
quality, identifiers, timing windows or baseline eligibility. Criteria on
history is not universally excluded by the consumers.

## Scope and current evidence

Own scope is exactly six files: this document, package.json, the targeted-test
override map, the loader, its load test, and the adapter import/load call.
Shared schemas, baseline/audit/resolver/journal modules, dependencies, provider
code, native code, security gates and roadmap statuses are unchanged.

The original three test bodies and assertions remain unchanged. Expanded
fixtures use synthetic actual KEY-to-adapter loads, good neighbors in both
orders, real hierarchical/persistence estimators and resolution audit, journal
reconstruction, newest-cap ordering and loaded-row capture.

The current pre-fix A1 run reported:

```text
# tests 234
# pass 38
# fail 196
# cancelled 0
```

Four independent P01 tests exposed admission, hierarchical probability 1/2
instead of 1/3, persistence probability/sample count, and audit manual/resolved
counts. The repaired A2 run reported:

```text
# tests 234
# pass 234
# fail 0
# cancelled 0
# skipped 0
```

Final A2 scoped ESLint exited 0. Loader SHA-256:
`ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a`.
A2 fixture SHA-256:
`c01c770c5cb20b8f13bdb3df07680eaa3718dc872d7e10c297ab5ac59929047f`.
A4 preparation added null-evidence neighbor controls and nested provenance
container unknown-field retention controls without changing the original three
test bodies. At that stage, immutable fixture SHA-256:
`c5db8d1f75f1a6cca6488a1fd014552120b4cd316022cc74da0af2e6e3fe4636`.
The actual pre-freeze rerun reported 236 tests / 236 pass / 0 fail / 0 cancelled,
exit 0 in 1.908 seconds, with all 5,063 source paths unchanged. Its raw log SHA:
`6f8ead9733f05acc8602b0f7ab1efaa0d66d12ba129dd90f0db1400980456e43`.
Actual logs and full-source receipts are stored privately under
`approved-batch/pr1784/oct11-repair/execution/`; A1 receipt is
`approved-batch/pr1784/oct11-test-preparation/a1-final-red-receipt.json` and
A2 ownership receipt is
`approved-batch/pr1784/oct11-implementation-preparation/a2-ownership-return.json`.
All 5,063 source paths/modes remained unchanged during final A2 executions;
only loader bytes/index changed during the specialist's implementation lease.

The clean private code freeze is
`d01a778b5fae5b5e1a7be684dc7d25da772b213b`, tree
`5947877ffebd2cb7156b72e3d23f583941a73171`. Its normal hooks passed in
33.727 seconds with all source bytes unchanged. The first qualified campaign
executed 65 distinct guard variants: 64 assertion kills and one genuine survivor.
Both controls passed 236 tests / 0 failures; all 5,063 paths/modes and raw index
were restored exactly after each run. P01's rejection-guard mutation produced
173 pass / 63 fail, including independently executed real baseline and audit
semantic assertions. The supportsOutcome-absence mutant produced 236 pass /
0 fail because every positive resolved nonempty item supplied that optional
field. That survivor remains recorded and is not counted as a kill.

The first campaign's prior L01 execution had a genuine 33 pass / 203 fail red,
but Git diff refreshed its raw index after observation. Its restoration proof
was excluded and rerun after all index-sensitive inspectors were isolated with
external index copies. The original attempt and correction are preserved.

Current strengthening adds actual-load supportsOutcome-absent compatibility
controls for both resolved statuses while retaining all prior test bytes. Actual
staged validation: 238 tests / 238 pass / 0 fail / 0 cancelled, exit 0 in
1.959 seconds. Its raw log SHA-256 is
`70e25534cff4b4d4979bfb1e356250f71100c2df9fb04b224e4d15556847f5bd`;
current test SHA-256 is
`90b0078b1165bee5ed8fd275c9d2a89b44fb3469ae0c9f694885505ed31dac81`.
All 5,063 source paths/modes remained unchanged during that execution and the
owned process group was observed reaped. A fresh normal-hook test/doc freeze
and full 65-variant rerun completed as recorded below. The final named-script
gate and independent Sol medium review run after this document is frozen; their
exact final-tip outcomes belong to the private final-review handoff. The qualifying campaign
summary is `approved-batch/pr1784/oct11-repair/A4-cycle-1-qualified/campaign-summary.json`,
SHA-256 `b1006792d1228e1ad479a7f778f6fa834380f641a54cb65cb64af9545a42a8ba`.
No end-to-end interrupted-campaign recovery test was run; runner signal handlers
and observed normal owned-process reaping are distinct evidence.
The original branch's three-test/35-total/eight-mutation and gate claims are
historical and are not reused as current integrated execution evidence.

Runs use Node 22, a fake home, disposable local data, offline npm and owned child
cleanup. Initial tsx IPC EPERM attempts and three initial lint callback errors
are retained separately; approved IPC reruns and explicit-arrow lint repairs
produced the results above. Existing fixture-only ICAO and DOM compatibility
controls remain narrowly file-scoped. No live provider, installed app, native
runtime, real user storage or accuracy uplift was tested or claimed.

## Current integrated proof and validation

The strengthened clean code/test freeze is
`5e6c4d3b1db42f6dc69f5defc95c574595a51bdb`, tree
`15df5cd6dfe71317644a1bd5838bdc2de07b6dc6`. Normal hooks passed in
22.814 seconds, raw log SHA-256
`59ed5339e9957839ad9dd95386513879e726e6266498f697caf107ab6aa7854c`.
Only the test and this evidence document changed from the preceding code freeze;
production loader/adapter and all other source remained unchanged.

The fresh current campaign ran all 65 single-guard variants, with 65 named
runtime assertion kills, zero survivors and zero invalid qualified runs. Both
controls reported:

```text
# tests 238
# pass 238
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The former supportsOutcome-absence survivor now reports 236 pass / 2 fail,
with the two separately named actual-load resolved_true/false compatibility
assertions red. P01 reports 175 pass / 63 fail, including real hierarchical,
persistence and audit semantic failures. The prior 64-kill/one-survivor campaign
and excluded initial index-observer attempt remain intact, without counting them
as extra current proof obligations.

Every variant has an inspected nonempty diff, immutable test checksum, raw
numeric counts/diagnostics and exact all-5,063-path bytes/modes plus raw-index
restoration. Current campaign summary SHA-256:
`17c13e66e5296e74ba7c8510f6c679a5a67d9c87b6e705a07522bae27648254c`.
Its raw index restored to
`056393cba1ab914eee8181f12caffe6144cb037d952b0651934f390c45c14c7a`.
All 67 owned runs (65 mutants and two controls) were observed reaped. Four
container-guard variants also caused helper TypeErrors; those are supplemental
consequences, with separate actual-load ERR_ASSERTION neighbor/admission reds
required for the accepted behavioral proof. No syntax/IPC/timeout error counts
as a kill.

The integrator independently reconstructed all 65 applied patches in disposable
scratch files and checked 854 artifact hashes plus the full runtime/restoration
manifests. Audit SHA-256:
`c095c5dc65d929852dbc04542188039d6c0fd727987cd82150b7d83beb7c8a8c`.
The complete private artifacts are under
`approved-batch/pr1784/oct11-repair/A4-cycle-1-v2-qualified/`, with the root
qualification in `A4-qualified-root-audit.json`. The table quotes actual red
counts and the complete restored source hash for each variant:

| Variant | Actual red pass / fail | Restored full SHA-256 |
|---|---:|---|
| L01 | 35 / 203 | 400847a18fc3c1fd5ba6c5a61abac011460da87ee792068db9705f26a9375eee |
| L02-RANGE | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L02-TYPE | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L02-FINITE | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L03 | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L04 | 172 / 66 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L05 | 235 / 3 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L06 | 235 / 3 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L07 | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| L08 | 235 / 3 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P01 | 175 / 63 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P01-TRUE | 167 / 71 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P01-FALSE | 174 / 64 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P02-PROVENANCE | 28 / 210 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P02-CRITERIA | 23 / 215 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P03-PROVENANCE | 230 / 8 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P03-CRITERIA | 233 / 5 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P04 | 230 / 8 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P05 | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P06 | 230 / 8 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P07 | 232 / 6 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P08-ARRAY | 232 / 6 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P08-ITEM | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P09-TYPE | 232 / 6 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P09-FINITE | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-VALUE | 233 / 5 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-VALUE-FINITE | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-VALUE-OWN | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-VALUE-ABSENT | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-REFERENCE | 233 / 5 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-REFERENCE-OWN | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-REFERENCE-ABSENT | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-SUPPORTSOUTCOME | 233 / 5 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-SUPPORTSOUTCOME-OWN | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P10-SUPPORTSOUTCOME-ABSENT | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P11 | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P12-ARRAY | 202 / 36 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P12-ITEM | 226 / 12 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P13-POLYGON | 230 / 8 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P13-RINGS | 222 / 16 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P13-RING | 230 / 8 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P13-REPORTS-ARRAY | 226 / 12 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P13-REPORTS-ITEM | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P14-ARRAY | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P14-LENGTH | 226 / 12 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P14-TYPE | 230 / 8 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P14-FINITE | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P15 | 166 / 72 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P16-EMPTY-EVIDENCE | 232 / 6 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P16-EMPTY-RESOLVER | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P17 | 228 / 10 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P18 | 39 / 199 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| P19 | 237 / 1 | 400847a18fc3c1fd5ba6c5a61abac011460da87ee792068db9705f26a9375eee |
| X-ROOT-OBJECT | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-CRITERIA-OBJECT | 18 / 220 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-PROVENANCE-OBJECT | 22 / 216 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-EVIDENCE-OBJECT | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-PROVENANCE-FIELDS | 234 / 4 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-EVIDENCE-FIELDS | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-NONRESOLVED-CONTAINER | 236 / 2 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-NONRESOLVED-OBSERVED | 235 / 3 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-EMPTY-SOURCEIDS | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-EMPTY-EVENT-ARRAYS | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-EMPTY-WARNING-RINGS | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |
| X-EMPTY-WARNING-REPORTS | 237 / 1 | ab40d434e30db74bb1f27e065df31430d68943ee40509f29a663841fcec8eb3a |

Actual adjacent/integration checks on that clean freeze:

- `npm run test:evidence-journal`: Node 40 pass / 0 fail, then TypeScript
  65 pass / 0 fail; exit 0 in 8.297 seconds. Raw SHA-256
  `fc66292d4e9d9e9e83b7b5a89775e5f635525de15fb337c6ca3e8e9ce85c6cd0`.
- Scoped ESLint on loader, adapter and expanded test with `--max-warnings 0`:
  exit 0 with empty output in 7.626 seconds.
- `npm run bench:forecast -- --json`: exit 0, comparison ok=true with no
  regressions. Committed 120-record corpus, four folds, 65 scored of 80
  evaluation records; Brier 0.23773538461538452, baseline Brier
  0.23894483347905854, resolution coverage 0.8875. Raw SHA-256
  `acbd7a031a042f1ef7ed1f075cd247b9c546f9776e0c10928c442ba99af705bb`.
- `npm run bench:baselines`: exit 0, "PASS — all baseline-pairing gates are
  within the reviewed baseline." Committed 72-fixture corpus; production
  incumbent Brier 0.152317, hierarchical 0.261052, momentum 0.209604 and
  persistence 0.386255. Raw SHA-256
  `1fe593f837dfb4c072fcfaae57068126382ae90dad6eb02701a5174d390283f4`.

Benchmarks were run once each against unchanged committed corpora/baselines.
They exercise shared algorithm behavior and do not load the persisted blob;
the actual KEY consumer fixtures and P01 mutation establish parser impact.
All source bytes/modes stayed unchanged during these executions and all owned
process groups were observed reaped. Raw logs retain Node/SQLite warnings.
Final command after normal-hook document freeze:
`bash scripts/agentic-validate.sh --tests "test:forecast-load test:evidence-journal"`.
The final gate and nonimplementer Sol medium review have not run at this document
freeze; their real exact-tip outcome must be read from the later private handoff.
No publication or external review supplement is implied.

## Migration, manual check and rollback

There is no schema/key migration or startup storage rewrite. Dropping malformed
resolved rows can reduce stored outcome counts and later normal persistence
may write reduced history. Structural validity does not imply audit quality.
Manual verification can load a synthetic legacy false row next to a resolved
true row with numeric proxy resolverId: only the legacy row should remain, both
baseline estimates should use it, and audit should count one manual outcome.
Valid direct/proxy journal rows with empty evidence must keep their provenance.

Rollback reverts the bounded #1784 own delta while preserving canonical main
and accepted #1777 evidence behavior. It restores the earlier admission defect;
it cannot reconstruct rows removed by a later legitimate storage write. No
publication, verdict, release, deployment or installation is implied by this
private validation document.

## Current main708 integration evidence

PR #1784 remains private. The entire document prefix above is retained byte for byte from the archived c7d86 validation document; its earlier “current” wording and recorded reds apply to that historical source, not to a new runtime campaign.

Current code tip: `ff83c9d014835b20578d84a57e457279992c548f`. Delivered main: `708c6535bc6bbad0073bbc8a3b70bfa4f3723ab3`, tree `f50a44fb1d15eaddd83472d8e9fd4d87f8afac36`. The sealed saved source contains 5081 records; all 5075 unowned main objects, types, modes and bytes remain preserved. Normal code-commit hooks exited 0 without source changes.

The delivery counter remains 16 delivered of 28, with 12 remaining. Publication is not authorized for PR #1784.

### Actual focused and selector execution

- `forecastLoad`: exit 0, 3.737 seconds; receipt SHA-256 `ccb2cac59c28d55e94e397570d9007d4449099436dae4c16358f33d2a27417f7`; log SHA-256 `139745bc50c30ad7b7bd27e04dbeab72e59b16021f9b2b58eae26f0240fcd3c0`.
- `evidenceJournal`: exit 0, 7.965 seconds; receipt SHA-256 `0d0d2575401f899f85b821877fbe6242b3d84e4afb0ea2db904c5099ab7fd8cd`; log SHA-256 `392e30b82c3eabd3f6cbc3a9daf7dcc734dca223facb04ab79f95a8d8a0f306d`.
- `scopedLint`: exit 0, 7.868 seconds; receipt SHA-256 `b79e619046f3bfb54d03b01df79e0ba0c3454e4bbd719df483f3fd1b5ddc0060`; log SHA-256 `267407f6837d6031774718ed2d1f46199870e1f551ae067bc33a9ea5571d577e`.
- `benchForecast`: exit 0, 1.29 seconds; receipt SHA-256 `61cde2e3b597689650b5117cccf52f41689acb457a82f1fc97f554309a9eb27f`; log SHA-256 `59fbfb55c65e4287caf6687a30f652576411e014eb47fccd73081a6c82b3d1b8`.
- `benchBaselines`: exit 0, 1.213 seconds; receipt SHA-256 `c31d06e74e3793ce64423ff40e6230333e7ad73a287044fad08ceaf466674286`; log SHA-256 `1fe593f837dfb4c072fcfaae57068126382ae90dad6eb02701a5174d390283f4`.
- `selectorList`: exit 0, 0.753 seconds; receipt SHA-256 `d3258295e0b752e865933a10c648d27e31ad09ee3cd13942bbdc88a4eb1bc5d3`; log SHA-256 `43926605b93c21c9c92b66789a67518afb4fcc95eae84cebcdf04821f6cf2f50`.
- `selectorFull`: exit 0, 234.042 seconds; receipt SHA-256 `223bceeeebb3e158d644bb753448c09731bbf3b38369fab6761535cea28a9525`; log SHA-256 `18d115b118738b0d26715dc9e6d8dde6d01fa02c570783fb4434cd74656e421e`.

Commands below are the verified actual receipt commands, including the owned bootstrap:

```text
forecastLoad: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:forecast-load
evidenceJournal: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:evidence-journal
scopedLint: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs scripts/run-eslint.mjs src/services/intelligence/forecast-calibration-load.ts src/services/intelligence/forecast-calibration-adapter.ts src/services/intelligence/__tests__/forecast-calibration-load.test.mts --max-warnings 0
benchForecast: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run bench:forecast
benchBaselines: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run bench:baselines
selectorList: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs scripts/targeted-tests.mjs --list --strict
selectorFull: /opt/homebrew/opt/node@22/bin/node --import /Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1761/oct11-private-provider-preparation/copied-index-fixture-bootstrap.mjs scripts/targeted-tests.mjs
```

The focused test footers below are exact lines from saved logs. They describe individual Node stages, with no deduplicated total inferred across logs.

`forecastLoad` footer source SHA-256 `139745bc50c30ad7b7bd27e04dbeab72e59b16021f9b2b58eae26f0240fcd3c0`:

```text
# tests 238
# suites 0
# pass 238
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`evidenceJournal` footer source SHA-256 `392e30b82c3eabd3f6cbc3a9daf7dcc734dca223facb04ab79f95a8d8a0f306d`:

```text
# tests 40
# suites 0
# pass 40
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 68
# suites 0
# pass 68
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The actual strict selector declaration and full execution both contain these 40 unique scripts; execution announcements and the final 40-script pass footer were verified:

`test:acc509`, `test:alert-capacity`, `test:alert-deduplication`, `test:algorithms`, `test:analytics-consent`, `test:briefing-scheduler`, `test:command-center`, `test:crisis-signature-library`, `test:crisis-trajectory`, `test:cross-domain-contradictions`, `test:evidence-journal`, `test:fetch-attribution`, `test:forecast-load`, `test:gdacs-map`, `test:imessage`, `test:install-scripts`, `test:intelligence`, `test:intelligence-timeline`, `test:lifelines`, `test:little-snitch`, `test:maritime`, `test:ml-budget`, `test:native-notify`, `test:quiet-hours`, `test:reasoning`, `test:review-trail`, `test:rules-engine`, `test:satellite`, `test:secret-boundary`, `test:settings`, `test:sidecar-routing`, `test:situations`, `test:survival`, `test:ucdp-provider`, `test:ux010`, `test:ux026`, `test:ux059`, `test:vault-writer`, `test:warning-delivery`, `test:wildfire`

Actual benchmark output excerpts:

`benchForecast`:

```text
  Corpus                  crystal-ball-forecast-replay-v1 (120 records)
  Walk-forward folds      4
  Baseline model          hierarchical-base-rate@1.0.0
  Scored / evaluation     65 / 80
  Resolution coverage     88.8%
  Brier score             0.2377
  Brier skill             0.0051
  Baseline Brier          0.2389
  Global baseline Brier   0.2390
  Log loss                0.6984
  High-confidence misses  10
  Top source loss       analyst-loop 75.4% of loss; Brier 0.448; 8 high-confidence misses
  Top domain loss       macro 28.1% of loss; Brier 0.434; 3 high-confidence misses
  Top horizon loss       1h-6h 46.4% of loss; Brier 0.448; 9 high-confidence misses
  Top version loss       analyst-v1 37.7% of loss; Brier 0.448; 4 high-confidence misses
PASS — all forecast replay gates are within the reviewed baseline.
```

`benchBaselines`:

```text
Baseline pairing benchmark — corpus baseline-pairing-v1 (72 fixtures)
  Production incumbent   Brier 0.152317 over 72
  hierarchical-base-rate   Brier 0.261052 over 36  skill vs production -0.115069
  momentum-baseline        Brier 0.209604 over 12  skill vs production -0.057487
  persistence-baseline     Brier 0.386255 over 40  skill vs production -0.238375
PASS — all baseline-pairing gates are within the reviewed baseline.
```

### Historical proof carry qualification

The accepted old source is `c7d86ac8cfbdc0ade4ee17c5e82284f7a6a78a9e`. The 65 runtime assertion reds and the independent audit of 854 artifacts remain historical evidence bound to that accepted source and its documented earlier code freeze. This refresh runs no new mutation campaign and does not claim 65 fresh runtime kills or a fresh 854-artifact audit.

All 65 actual candidate source/test forward and inverse carries match the archived receipt/patch/source/test hashes. The forecast-load command and 12 named consumer anchors are unchanged. Actual validation receipt manifests match the same clean saved source and raw index before and after each successful command; owned child/process-group cleanup is complete.

Historical independent audit SHA-256: `35895741f709b02af5894b3317d727e4106f7f68b0a96947f565564b33f598b9`. Actual 65-carry artifact SHA-256: `d80ed016bdec3cd1add5c7c33b5efdb17dbfea9ec38cecb5b24bc8f368106307`. Consumer/command anchor artifact SHA-256: `5c7b542c50d77580627c8daab0f0716c316d32f0ba1532b44824e32d7c90b1d7`.

The attempted duplicate blanket 854-artifact rehash was interrupted and remains incomplete (owned attempts exited 130). Its bounded diagnostic verified 200 saved artifacts without a mismatch and supported slow I/O; the exact original termination file remains unknown. No corruption conclusion or stronger source-content-after claim is inferred. The completed static 65-carry qualification is separate from that incomplete duplicate audit.

### Remaining validation and limits

Final documentation adoption and its normal commit, the final named full gate on that documentation tip, private Sonnet medium review (at most three passes), and last nonimplementer Sol medium cycle 2 remain pending. After genuine final validation and freeze, private Sonnet triage precedes the last Sol cycle on the same exact validated tip. This section records no future documentation-tip gate or review pass.

The persisted-loader contract remains structural: genuine absent legacy metadata and degraded empty-evidence journal history stay compatible; invalid present resolved metadata is rejected. No accuracy uplift, provider/native installed-app verification, real-user-data operation, or interrupted-campaign recovery result is claimed. Rollback removes only the own six-path delta while retaining delivered main protections.
