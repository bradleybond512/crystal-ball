# UX-071 — local validation and hosted acceptance

Draft: [#1904](https://github.com/bradleybond512/crystal-ball/pull/1904).
Implementation checkpoint: `8729dc55cb90cd8cd401b2a498fbebdb55b3b05e`.
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
