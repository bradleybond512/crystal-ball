# UX-070 dependency coverage — local validation

Draft: [#1903](https://github.com/bradleybond512/crystal-ball/pull/1903).
Original implementation checkpoint: `4c25e205134a0ebeb9dc998c5245e1306754c100`.
Status: locally validated candidate; hosted runtime acceptance remains open.

## Behavior and scope

Dependency changes now select explicit graph obligations and trusted test
commands. Unknown graphs and missing policy fail closed. The runner uses
fixed commands, isolated temporary state, deadlines, bounded output and
receipts that distinguish success, failure, timeout and missing execution.
The new workflow supports forks without secrets and proposes seven weekly
jobs with two running concurrently, within 140 total runner-minutes including
planning and reporting. Existing checks and budgets are preserved.

Changed architecture: trusted selector and new dependency runner; one new
workflow and narrowed existing targeted-workflow fallback; graph runtime
contracts, portable tests and package test registrations. No dependency
versions, production application behavior, permissions or storage changed.
The approved SPC fixture-clock repair from #1902 is carried as a test-only
prerequisite, preserving payload, assertions and real execution deadlines.

The [baseline inventory](UX-070-BASELINE-INVENTORY.json) describes main at
`5955a8d98`, before these additions. Its script/file counts are not executed
test counts. Cargo runtime and broader scheduled browser coverage remain
explicit gaps; UX-071 addresses the former separately.

## Executed local checks

Supported Node 22.23.1 and canonical macOS TMPDIR were used. Exact gate:

```sh
bash scripts/agentic-validate.sh --tests "test:dependency-coverage test:dependency-coverage-workflow test:dependency-runtime-contracts test:agentic-pipeline test:workflow-security test:supply-chain-gates test:install-scripts test:ux054 test:roadmap-controller test:spc-angle"
```

Actual output totals, quoted from each suite:

| Script | Output | Output |
| --- | --- | --- |
| `test:dependency-coverage` | `# pass 13` | `# fail 0` |
| `test:dependency-coverage-workflow` | `# pass 12` | `# fail 0` |
| `test:dependency-runtime-contracts` | `# pass 7` | `# fail 0` |
| `test:agentic-pipeline` | `# pass 85` | `# fail 0` |
| `test:workflow-security` | `# pass 96` | `# fail 0` |
| `test:supply-chain-gates` | `# pass 27` | `# fail 0` |
| `test:install-scripts` | `# pass 63` | `# fail 0` |
| `test:ux054` | `# pass 22` | `# fail 0` |
| `test:roadmap-controller` | `# pass 135` | `# fail 0` |
| `test:spc-angle` | `# pass 5` | `# fail 0` |

The gate finished with `Agentic validation gate passed.` It also completed
lockfile verification, strict lint, both TypeScript configurations, secret
scanning, documentation/roadmap checks and build. Existing dynamic-import
build warnings remain visible. Explicit ESLint checks passed for new scripts.
The roadmap snapshot covered 103 PRs and reported no blockers for the claim.

The previously verified Zizmor 1.32 binary was hash-checked and reused with
network access denied. `--offline --min-severity medium --format github`
completed all 24 current workflows with exit 0 and no findings at that
threshold. No tool was installed for this check. Actionlint execution remains
hosted; the local executable was unavailable.

## Detecting mutations

All proofs started clean, recorded SHA-256, saved and inspected nonempty Git
diffs, ran real assertions, restored bytes and verified clean status/hash
equality. The local evidence directory `next-nov13` retains raw logs, diffs
and reproducible proof drivers.

| Surface | Baseline | Applied mutation result | Restored |
| --- | --- | --- | --- |
| Selector/runner, 13 controls | 13 pass / 0 fail | Graph obligation: 10/3; NUL paths: 11/2; other 11 controls: 12/1 each | 13/0 |
| Workflow, 8 controls | 12 pass / 0 fail | Candidate policy substitution: 10/2; other 7 controls: 11/1 each | 12/0 |
| Runtime helper, 12 controls | 7 pass / 0 fail | 6/1 each | 7/0 |
| Carried SPC fixture-clock repair | 5 pass / 0 fail | Removing child clock pin: 4/1, including simulated 2040 | 5/0 |

Controls cover graph obligations, unknown/renamed paths, trusted-policy
substitution/absence, positive test counts, missing receipts, timeouts,
output bounds, credentials, hosted-native guard, workflow identity/budgets,
installed graph/version resolution, observed WebSocket behavior and cleanup.
The WebSocket helper used the existing root dependency locally; this is not
evidence that scripts or cb-control's installed graph works.

Restored SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `scripts/targeted-tests.mjs` | `5268bf8bdac8680ce08f283798076bf5403bc1024564382ccb4abf72968e8a81` |
| `scripts/dependency-test-runner.mjs` | `6f0231f64793db73ce079661a12814ba47fb958adc14218f0283ff55e031f361` |
| `.github/workflows/dependency-coverage.yml` | `87b6f384d6cdfdf8fcf436f298f0d92225e7c84a465d20e25470bc6bdece2f72` |
| `.github/workflows/targeted-tests.yml` | `668a64db453a554388818d035e81295aa85b104f99ecf64b9392b7fc4ccf7aa2` |
| `tests/helpers/dependency-runtime-fixture.mjs` | `fccd991d360f4d6e9cd409c0eb35b5ea033606eb7bf82834a7463caa2e0a7a7b` |
| `src/services/__tests__/spc-angle.test.mts` | `89f6e45e96f028480155b9fd502d463dfee42a211410f98cea828079f0f23571` |

## Rollout and remaining acceptance

### November 14 hosted failures and local repairs

Approved tip `7b810edbc` was published and the approved
`dependency-change-approved` label applied. Dependency Coverage run
`43606597994` stopped all seven graphs at npm's version probe, before any
dependency installation or runtime contract execution. Actual diagnostic:

```text
Exit prior to config file resolving
cause
double-loading config "/dev/null" as "global", previously loaded as "user"
```

Repair `9f4e67ffb` gives npm separate owned empty user/global configuration
files, removes conflicting install arguments, and isolates the lifecycle
probe's version lookup. Actual npm regression checks use version commands
and fixed empty fixtures, with no dependency installation or native build.
The focused suite changed from `# pass 13` / `# fail 3` to `# pass 16` /
`# fail 0`. Three new mutations and all 13 previous policy mutations were
detected: duplicate environment paths 13/3; duplicate CLI paths 15/1;
inherited probe environment 15/1; graph obligations 13/3; NUL paths and
credential environment 14/2 each; remaining ten controls 15/1 each. Clean
detached copies restored to 16/0 and matching checksums. Updated runner
SHA-256: `e947ee745faaeec541ec625763636e7fddf0ecc0e2e0d46cd501ebffbb5355da`.
The earlier hash table records the original checkpoint, not this repair.

Targeted Tests run `43606597837` also exposed five fixture failures because
temporary Git repositories inherited the real CI `CB_TARGETED_POLICY_SHA`.
That commit does not exist in the fixtures. Repair `fb055e879` removes that
outer setting only from the fixture environment; production trusted-policy
enforcement and all existing assertions remain intact. Reproduction with
the hosted setting returned `# pass 80` / `# fail 5`; the repaired suite,
including an explicit hostile-environment regression, returned `# pass 86` /
`# fail 0`. The new regression was observed failing before the repair.
Its clean-copy mutation removed only the fixture environment cleanup:
`# pass 1` / `# fail 0` became `# pass 0` / `# fail 1`, then restored to 1/0.
The applied diff was inspected and the restored test SHA-256 was
`20ad5e2042502142b9aac5bcb029995e5bfceaac5038514cc60ac67b85e385a6`.

Final repair validation used the real hosted policy setting:

```sh
CB_TARGETED_POLICY_SHA=5955a8d9860ad2f616008a3d738d423fbb8e5415 bash scripts/agentic-validate.sh --tests "test:dependency-coverage test:dependency-coverage-workflow test:dependency-runtime-contracts test:agentic-pipeline test:workflow-security test:supply-chain-gates test:install-scripts"
```

Actual output pairs (`# pass N` / `# fail 0`) in that order were 16/0, 12/0,
7/0, 86/0, 96/0, 27/0 and 63/0. The final output was
`Agentic validation gate passed.` Both TypeScript configurations, strict
lint, secret scanning, documentation checks and the build passed.

Raw logs, actual applied mutation diffs and reproduction scripts are retained
under the session's `next-nov14/npm-config-fix` and `policy-fixture-fix`
evidence directories. Manual recheck requires the focused suites with the
hosted policy setting, then all seven actual graph receipts after publication.
Reverting these two repairs restores the startup/fixture failures without
changing application behavior or data. Hosted runtime acceptance remains open.

Main does not contain the new policy while merging is paused. Mixing the new
selector with old main metadata correctly fails for unavailable mandatory
suites. Explicit candidate preview uses `CB_TARGETED_POLICY_SHA` pinned to the
candidate commit; it is not trusted-main enforcement. Current main's selector
enumerated 52 suites; the candidate preview enumerated 54. These are selection
counts, not a claim that all those suites ran locally. Several invoke native
builders and remain for disposable hosted execution.

Cold Linux execution of all six installed npm graphs, the fixture job, five
actual scripts/cb-control mutation controls, aggregate receipts and measured
costs remain required. No native package builds or actual native contracts
ran on this Mac. Initial resource limits are ceilings, not measured capacity.
The existing critical marketing dependency audit remains unresolved; new
runtime tests do not clear that separate finding.

The final SHA-pinned review verdict governs publication; this report does
not replace independent Sol and actual Sonnet review. After approved code
publication, inspect each graph's policy/execution SHA, actual counts and
failure receipts. Keep the PR draft and UX-070 open until hosted acceptance.

Rollback reverts the selector/runner/workflow changes and their registrations
together, with review of lost coverage, preserving previous checks. There is
no production migration or application installation. Proposed PR summary:
require explicit dependency runtime checks and honest bounded execution
receipts while preserving existing tests and exposing remaining coverage.

Merging, auto-merge, releases, deployment and application installation remain
paused.

## November 15 hosted execution and environment repairs

Approved tip `d22ce0447` was published. Its checks finished with 33 successes,
seven failures and one intended skip. Dependency run `43684596587` used
candidate-preview merge source `ea40e48bcbce3addc4965149f298f8edd685919f`.
The npm startup and selector-fixture repairs passed hosted execution.

Three complete graph jobs passed: Codex (86/0, 63/0, 27/0), fixtures
(8/0, 18/0, 22/0, 2/0, 4/0, 4/0, 5/0, 14/0, 7/0) and marketing (51/0).
cb-control built its native dependencies and passed runtime contracts at 4/0;
scripts passed AIS 15/0 and runtime 3/0. Their mutation subprocesses then
failed before baseline execution. Inheriting NODE_TEST_CONTEXT caused Node
to skip nested test files with exit zero and empty TAP; the positive-execution
parser correctly rejected that. The harness now clears only this inherited
test-runner setting. Inert pass/fail fixtures reproduce actual nested execution.

Root progressed through 63/0, 96/0, 2/0 and 46/0 before its existing native
identity fixture failed: isolated HOME hid installed Rust metadata. Only the
hosted root graph now receives a validated original Rust metadata directory.
Relative, missing, redirected and checkout/state-overlapping paths fail closed;
HOME remains owned and compiler hooks, Cargo configuration and credentials
remain excluded. No new Rust suite or dependency was introduced.

MCP's first suites passed 1/0 and 10/0; its package suite returned 269/1.
The installer fixture expected the public package cache at owned HOME/.npm,
but the runner stored it elsewhere. Cache now resides at owned HOME/.npm.
The fix preserves the offline fixture and its assertions. No local dependency
installation or native execution was used to verify these repairs.

Both branches were rebased onto main `92ff943df`. The stale UX-076 claim for
merged #1900 is reconciled as MONITOR, retaining packaged acceptance. The
marketing critical audit remains unresolved; passing marketing tests do not
clear a dependency audit.

At repair source `4e13c04be`, the full gate used the same seven-suite command
above plus `test:roadmap-controller`, with CB_TARGETED_POLICY_SHA set to
`92ff943dfc96c31c1c9f399baf9e1429e75bbd75`. Actual pass totals, each with
`# fail 0`, were 19, 12, 8, 86, 96, 27, 63 and 135. Final output:
`Agentic validation gate passed.` Types, lint, secrets and build passed.
Subsequent test-only commits add durable production-wiring and independent
relative-path assertions; focused checks remain 19/0 and hooks reran types.

The nested-test mutation at `4e13c04be` changed `# pass 8` / `# fail 0` to
`# pass 7` / `# fail 1`, then restored 8/0 and clean status. Applied diff
inspected; restored harness SHA-256:
`811c5eec9d07da3662e7eae2ed1bbd2104a449b5a9d303e9bdaeeca7357a5062`.

Raw receipts, bounded logs, regression output and mutation diffs are retained
under session evidence `next-nov15`. All seven complete hosted graph receipts
remain required after publication. Reverting these environment repairs restores
the demonstrated setup failures without changing application data or behavior.

Final environment proof at `2c88d98c8` detected all 29 controls: 13 new and
16 repeated policy controls. Every clean baseline/restored suite returned
`# pass 19` / `# fail 0`. The explicit Rust-source mutation returned 17/2;
the other 12 new controls returned 18/1 each. Repeated graph obligations
returned 16/3; NUL paths 17/2; credential and npm configuration mutations
15/4 each; other 12 repeated controls 18/1 each. Production call-site bypass,
lost stage environment and environment setup outside cleanup each returned
18/1 through the shipped source-scoped wiring assertion. Applied diffs were
inspected; all detached trees restored cleanly with matching checksums.
Restored runner SHA-256:
`702d84f94ab8e685cda23a0f8ea44e9b87de87a391f6bc1b9b100273a57369b1`.
The separate nested-test proof above adds one detecting mutation. Hosted
execution remains distinct from these 30 local controls.

## November 28 mechanical reconciliation

This candidate preserves the reviewed implementation from `3daf552d98` on
combined audit-repair base `7159ff6330`. The old verdict files and obsolete SPC
clock edit are excluded. Current main's SPC fixture, cookie/URL Cargo fixes,
coherent marketing React 19.2.9 pair and Zizmor 1.32.0 remain unchanged. Only the
UX-070 tracker row is reconciled; unrelated roadmap rows are preserved.

The same ten-suite validation command above passed with Node 22 and canonical
macOS `TMPDIR`. Actual output pairs (`# pass N` / `# fail 0`) in listed order
were 19/0, 12/0, 8/0, 86/0, 96/0, 27/0, 63/0, 22/0, 135/0 and 5/0. The gate ended
with `Agentic validation gate passed.` Both TypeScript configurations, lint,
secret scanning, documentation/roadmap checks and build passed. These local
fixtures do not replace the outstanding complete hosted graph receipts.

The first gate invocation omitted canonical `TMPDIR` and returned 85/1 in the
agentic suite's temporary-directory containment assertion. Its focused check
reproduced 0/1 under the `/var` alias and 1/0 under the canonical `/private/var`
path. No production code or assertion changed. Both logs are retained alongside
the successful gate under session evidence `next-nov28/ux070-reconciliation`.

A read-only three-way preview against native candidate `3cbc7bf1b4` found three
mechanical textual conflicts: additive override keys, adjacent tracker rows,
and checkout inventory (34 existing plus three dependency and two native
checkouts). Integration must retain both sets of mappings and tracker evidence,
and assert all 39 checkouts still disable persisted credentials. Package script
additions merge cleanly. Native changes have not been copied into this candidate;
the reviewed pending-UX-071 wording remains until integration.

The November 28 instruction permits protected merging when safe. Historical
merge/install pauses above describe earlier checkpoints. Fresh independent
reviews, SHA-pinned verdict and hosted acceptance remain required; public
releases, deployment and destructive cleanup remain paused. Rollback and the
broader browser-coverage limits above still apply.
