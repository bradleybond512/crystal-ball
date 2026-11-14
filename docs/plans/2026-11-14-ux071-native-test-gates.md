# UX-071 — Safe Rust tests and strict Clippy checks

Status: design, draft claim and local implementation approved November 14;
claim publication and implementation pending.
Base: `5955a8d9860ad2f616008a3d738d423fbb8e5415`.

## Objective and boundaries

Run explicit, reviewed Rust test targets and strict Clippy on disposable Linux
and macOS runners. Preserve cargo-audit, cargo-deny and existing targeted
checks. Keep this work separate from UX-070 and its weekly run budget.

Discovery found one application binary and seven Cargo integration targets.
The inspected test harnesses use fake backends or owned temporary files;
running the binary's test harness does not invoke Tauri's application main.
There are 234 literal test attributes and 61 lexical occurrences of unsafe;
neither is an executed-case or AST unsafe-block count. Included modules
duplicate some tests. Actual execution counts and Clippy findings are unknown.

No app launch, real Keychain access, production behavior change, installation,
permission change or general Rust refactor is included.

## Explicit target inventory

| Target | Inspected boundary |
| --- | --- |
| `current_location_contract` | Fake controller; no CoreLocation permission request |
| `imessage_contract` | Fake prompts/sends; owned filesystem, symlink and lock fixtures |
| `notify_policy_contract` | Pure notification policy |
| `sidecar_supervisor_contract` | Fake children, clocks and publication state |
| `updater_identity_contract` | Pure identity predicate |
| `vault_coordinator_contract` | Fake store, channels and included secret-sync tests |
| `watchdog_contract` | Nine pure focus/grace/heartbeat cases |
| `--bin crystalball` | Guards, crypto and owned temporary files; macOS updater fixtures use injected verification |

New Cargo targets require safety classification. Do not replace the list with
`--all-targets` or `--workspace`. Compare discovered target and test names
against a reviewed inventory so deleted or filtered tests cannot create a
smaller green run. Platform-specific expected lists must be explicit.

## Runner matrix and commands

Use Rust 1.93.1 with Clippy, Node 22, and two standard hosted runner jobs:

| Runner | Required architecture |
| --- | --- |
| `ubuntu-24.04` | `x86_64-unknown-linux-gnu` |
| `macos-15` | `aarch64-apple-darwin` |

These labels follow the current [GitHub hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Assert and record actual OS, image and architecture; do not assume them from
the label. Windows and macOS Intel runtime coverage remain open.

```sh
cargo +1.93.1 test --locked --manifest-path src-tauri/Cargo.toml \
  --test current_location_contract --test imessage_contract \
  --test notify_policy_contract --test sidecar_supervisor_contract \
  --test updater_identity_contract --test vault_coordinator_contract \
  --test watchdog_contract -- --test-threads=1

cargo +1.93.1 test --locked --manifest-path src-tauri/Cargo.toml \
  --bin crystalball -- --test-threads=1

cargo +1.93.1 clippy --locked --manifest-path src-tauri/Cargo.toml \
  --bin crystalball --test current_location_contract --test imessage_contract \
  --test notify_policy_contract --test sidecar_supervisor_contract \
  --test updater_identity_contract --test vault_coordinator_contract \
  --test watchdog_contract -- -D warnings
```

The driver may run targets individually for clearer receipts, sharing only
that job's compilation output. Separate bounded compilation from execution;
compilation success is not test success.

## Preparation and isolation

Each platform gets its own disposable checkout, Cargo target directory and
temporary test directory. No native builders share a checkout concurrently.
Use existing root dependency and XMPP bundle preparation, plus a temporary
frontend directory through `TAURI_CONFIG`. Linux needs the existing
WebKitGTK 4.1, appindicator and librsvg development packages. macOS uses the
hosted Xcode toolchain and frameworks.

This build has side effects: `build.rs` always invokes the pruning script on
the checkout's actual `dist`, regardless of temporary frontendDist, and Tauri
requires the generated XMPP bundle. Never run this pipeline in the installed
application, the sync clone or the user's development checkout.

Test processes use owned HOME, TMPDIR, TMP and TEMP and an environment without
service credentials. Give each target a separate temporary directory because
binary tests use fixed temporary filenames. Preserve fake Keychain/store
boundaries: changing HOME alone does not isolate macOS Keychain APIs.

Hosted runners only, read-only repository permissions, no secrets, OIDC,
persisted checkout credentials or `pull_request_target` execution. Candidate
build scripts still run code; disposable runners provide the host boundary.
No local native execution is needed for portable driver tests.

## Triggers, limits and failure reporting

Run for relevant Rust, native-build and toolchain changes on PRs, including
forks, merge groups and main; include manual execution for evidence. Do not
change branch protection or add a schedule.

- Two platform jobs, at most 45 minutes each, fail-fast disabled.
- Planning and reporting together at most five minutes: total ceiling 95
  runner-minutes per run, independent of UX-070's 140-minute allowance.
- Test execution at most 120 seconds per target after compilation.
- Explicit compilation and Clippy stage limits inside the platform deadline.
- Bounded logs and receipts retained for seven days.

These are provisional ceilings. Cold runs on both platforms must establish
actual costs. Timeout is failure, never an excuse to drop a target or silently
increase the budget.

Receipts include source SHA, runner identity, Rust/Clippy/Node versions, lock
hash, target, exact arguments, duration, result and actual counts. Fail on
missing targets/receipts, zero tests, unexpected ignored/filtered tests, lock
drift, compiler/lint failure or timeout. Continue independent stages when
possible, while the aggregate preserves every failure.

Run strict Clippy and retain existing diagnostics. Do not add allow attributes,
warning baselines, continue-on-error, weaker flags or removed assertions to
manufacture success. Classify actual failures and prepare bounded repairs;
behavior changes or materially broader repairs return for approval. Keep
UX-071 open until both platforms pass. The two-review-cycle limit applies.

## Owners, validation and rollback

1. Security specialist owns a small fixed-target driver, dedicated workflow
   and necessary wiring: owned paths, direct argv, deadlines and receipts.
2. Test engineer owns portable failure fixtures for missing/zero tests,
   wrong architecture/toolchain, lock drift, timeout and hostile inputs.
3. Parent owns inventory, roadmap claim and actual local/hosted evidence.
   Production Rust modules remain unchanged absent an approved repair.
4. Independent Sol and actual Sonnet review the complete diff and evidence.

Run driver tests, relevant workflow-security and agentic suites,
`typecheck:all`, and the full named-suite validation gate. A harmless Rust
fixture assertion must deliberately fail on the hosted pipeline, then be
restored and pass. Mutate missing-target, zero-count and timeout guards too;
record actual red counts, applied diffs and restored checksums.

Rollback removes only the new workflow/driver through review while preserving
existing checks. No production migration is involved. Actual passing hosted
execution and demonstrated failure detection are required for completion;
enumeration or compilation alone is insufficient.

Approved scope: this matrix, strict gate, budgets, documentation-only
draft claim and implementation. Reviewed code publication remains separate.
Merging, auto-merge, releases, deployment and application installation stay
paused.
