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
