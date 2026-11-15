# UX-071 — local validation and hosted acceptance

Draft: [#1904](https://github.com/bradleybond512/crystal-ball/pull/1904).
Original implementation checkpoint: `8729dc55cb90cd8cd401b2a498fbebdb55b3b05e`.
Status: locally validated candidate; actual native execution remains open.

## Behavior and scope

The dedicated workflow runs eight explicitly reviewed Rust test harnesses and
strict Clippy on disposable Linux x64 and macOS arm64 runners. It rejects
missing targets, changed test inventories, incomplete results, lock drift,
wrong hosts/toolchains, timeouts and missing evidence. The aggregate requires
both platforms at the current workflow SHA. Two 45-minute jobs and a
five-minute report cap each run at 95 runner-minutes.

Changed architecture: `.github/workflows/native-tests.yml`, the fixed native
driver and reviewed JSON inventory, two portable test suites, package aliases,
additive selector mappings and the existing checkout-coverage assertion.
No production Rust or application behavior changed. The already reviewed SPC
fixture-clock repair is carried to remove its known calendar-dependent failure.

The inventory expects 256 Linux and 258 macOS test invocations, including
duplicated included-module tests. These are reviewed expectations, not executed
results. The driver compiles without running, accepts only test-harness Cargo
artifacts inside its owned target directory, lists cases, then executes each
harness serially with its own temporary directory. It does not launch the app.
Fake Keychain/backend boundaries remain essential; HOME isolation alone is
not a Keychain boundary.

## Actual local validation

Node 22.23.1 and canonical temporary paths were used. Exact full gate:

```sh
bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-ci-workflow test:workflow-security test:agentic-pipeline test:roadmap-controller test:spc-angle"
```

| Suite | Actual output | Actual output |
| --- | --- | --- |
| Native driver | `# pass 13` | `# fail 0` |
| Native workflow | `# pass 4` | `# fail 0` |
| Workflow security | `# pass 96` | `# fail 0` |
| Agentic pipeline | `# pass 85` | `# fail 0` |
| Roadmap controller | `# pass 135` | `# fail 0` |
| SPC fixture | `# pass 5` | `# fail 0` |

The final gate output was `Agentic validation gate passed.` It ran strict
lint, both TypeScript configurations, secret scanning, lockfile and roadmap
validation, and the build. Existing build warnings remain visible. Zizmor
1.32.0 inspected the new workflow offline with network denied, at medium
severity or above: exit 0. Actionlint and native execution remain hosted.

Portable tests execute inert Node processes and fixture report commands.
No local Rust compilation, native harness, app startup, Keychain access,
dependency installation or application installation occurred.

## Mutation evidence

At the implementation checkpoint, all 34 portable mutations were detected.
Each began clean, saved and inspected the applied diff, ran the actual suite,
restored bytes and verified matching SHA-256 and empty Git status.

Baseline and restored output: `# pass 17` / `# fail 0`. Thirty-one controls
returned `# pass 16` / `# fail 1`. Empty test inventory, result summary and
exact platform receipt controls each returned `# pass 15` / `# fail 2`.

Controls cover hosted/architecture boundaries, exact toolchains and targets,
positive lists/results, owned harness artifacts, lock drift, separate npm
configuration, environment isolation, strict Clippy, bounded output, process
deadlines and descendant termination, complete current-source receipts,
mutation restoration, workflow failure propagation, budget, permissions and
retention. The real Rust assertion mutation still requires hosted execution.

Restored SHA-256:

- Driver: `b1e118da9fc1f70257499f08b93d6f19e7feab2ed1e7446a87b78a8b74fc4c90`.
- Workflow: `465d54f2633eda851986d0ee16abe64932fdef0c10172825e0080ef01010795a`.

Raw logs, 34 applied diffs, checksums and reproducible proof are retained in
the session evidence directory `next-nov14/native-mutations`. The carried
SPC repair's existing proof was 5/0 → 4/1 → 5/0 with restored checksum;
this gate reran the restored suite at 5/0.

## Hosted acceptance, review and rollback

The documentation-only draft run correctly blocked its then-unupdated
roadmap row, and Smoke reproduced the known SPC fixture-clock failure. Both
repairs are included in this local candidate. The separate marketing security
audit remains unresolved. No hosted implementation success is claimed.

Before completion, inspect both cold platform receipts: actual runner,
toolchain, source/lock hashes, all eight target counts, strict Clippy results,
bounded duration, deliberate watchdog assertion failure and restored success.
Any compiler or lint finding remains visible; do not suppress warnings or
weaken assertions. Windows and macOS Intel coverage remain outside this scope.

Independent Sol and actual Sonnet review must clear the final source and
evidence before code publication. This report is not a review verdict.
Manual local verification repeats the named portable suites; manual native
verification uses only the approved disposable hosted workflow.

Rollback removes the new driver, inventory, workflow and registrations through
review, preserving the existing checks. No migration or user-data rollback is
needed. Proposed PR description: require complete isolated native test and
strict Clippy evidence on Linux/macOS, with bounded execution and fail-closed
reporting; keep actual hosted acceptance open until both platforms pass.

Merging, auto-merge, releases, deployment and installation remain paused.

## November 15 hosted results and bounded repairs

Approved tip `8f485ae2d` was published. Its checks finished with 28 successes,
six failures and one intended skip. Native run `43684688417` used merge
source `e64401902c952c6c20a97d658c762b244f2486b1`.

Linux compiled all targets in 97,740 ms. Actual passing target totals were
current location 9/0, iMessage 44/0, notification policy 7/0, sidecar
supervisor 26/0, updater identity 1/0 and watchdog 9/0: 96/0 total.
The separate actual watchdog mutation was detected at 8/1 and restored to
9/0, with the source checksum restored. Do not double-count that rerun in 96.

Vault (45 listed cases) and binary (115 listed cases) were not executed:
the exact-name guard correctly rejected five incorrect module prefixes in
each inventory. Captured hosted lists and source confirm `transport_tests`,
not `tests`. The repair changes ten prefixes, dropping no cases. Expected
platform totals remain 256/258; those totals have not executed successfully.

macOS failed before compilation: the setup action found installed Rust on
PATH, while the driver assumed nonexistent CARGO_HOME/bin proxies. The driver
now resolves executable regular files from the original absolute runner PATH,
rejects checkout paths and retains pinned toolchain/host checks and isolated
state. Inert fixtures exercise path aliases, missing/non-executable tools and
unsafe locations without running Rust locally.

Linux strict Clippy failed with 105 emitted diagnostics (including included-
module repeats) across eight existing Rust files; 95 distinct normalized
file/line/message locations. The stage took 54,435 ms. Its summaries were
5 errors for current_location_contract, 8 for imessage_contract, 2 for
vault_coordinator_contract and 90 for the binary. Platform/dead-code,
deprecated crypto API and style findings require separately approved
production work. No production Rust, targets or warning settings changed.
macOS Clippy remains unobserved.

Both branches were rebased onto canonical main `92ff943df`, whose merged
UX-076 entry was still IN REVIEW. That metadata is now MONITOR, with packaged
acceptance explicitly open. No merge or installation occurred in this task.
The separate marketing audit and #1904 CI-policy approval gate remain open.

Repair source `55354d961` passed the same six-suite full gate: actual outputs
were `# pass 15`, `# pass 4`, `# pass 96`, `# pass 85`, `# pass 135` and
`# pass 5`, each with `# fail 0`, followed by
`Agentic validation gate passed.` Type checks, lint, secret scanning and build
passed. Later test-only commit `35f6ff882` independently exercises executable
permission and regular-file guards; targeted tests remained 19/0 and commit
hooks reran type checks. Initial mutation testing exposed the two overlapping
fixtures rather than hiding their surviving mutations.

Raw hosted artifacts, gate output and repair regression logs are retained in
the session's `next-nov15` evidence directory. Hosted recheck must establish
macOS discovery, both withheld target executions and actual Clippy outcomes.
Rollback of the driver/inventory repairs restores their demonstrated failures;
there is no user-data migration. Publication readiness is not UX-071 completion.

Final portable proof at `35f6ff882` detected all 44 controls (34 repeated,
ten added). Clean baseline/restored runs were `# pass 19` / `# fail 0`;
41 mutants returned 18/1 and three returned 17/2. The executable-permission
and regular-file mutations now independently return 18/1. Initial survivor
evidence is retained beside the final proof rather than reclassified as green.
Each applied diff was inspected; restored checksums and clean status verified.
Driver SHA-256: `58d2c693ef5c6eeef70fbb1cbe2a700050d8e4eb609ae423ebe0768d3ffd9b05`.
Inventory SHA-256: `d481ab7581cae00673d9155c1f93fb9179d1b6a08090034515b39787cd748826`.
Raw evidence: `next-nov15/native-repair-mutations/final/REPORT.md` and adjacent
diffs/logs. This proof did not execute Rust or establish hosted acceptance.
