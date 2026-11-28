# UX-071 — hosted gate reconciliation, November 16

## Published results and remaining work

Approved tip `4690b0b45d` was published to draft #1904 and its description
updated. The PR remains draft, unmerged, with auto-merge disabled. Merging,
auto-merge, releases, deployment and application installation remain paused.

[Native run 43912607958](https://github.com/bradleybond512/crystal-ball/actions/runs/43912607958)
tested merge source `104fa2a326e58135b6a76f177a6a7ce9556da137`. All eight
harnesses passed: **269 Linux / 272 macOS**, no ignored or filtered tests.
Strict macOS Clippy passed. Linux Clippy reported exactly one remaining error:

```text
error: associated function `new` is never used
  --> src/imessage.rs:59:12
```

The original three mutation controls executed complete red/restored-green
harnesses on both platforms:

| Control | Linux pass/fail red → green | macOS pass/fail red → green |
| --- | --- | --- |
| watchdog | 8/1 → 9/0 | 8/1 → 9/0 |
| crypto-nonce-rejection | 124/1 → 125/0 | 127/1 → 128/0 |
| crypto-auth-rejection | 121/4 → 125/0 | 124/4 → 128/0 |

The next control, `updater-dto-required-fields`, created the intended real diff
with two added `#[serde(default)]` lines. Both runners then stopped with
`Mutation diff missing`: the driver incorrectly required both added and removed
lines. The applied diff and subsequent clean restoration are in each artifact's
`48-updater-dto-required-fields-diff.stdout.log` and `49-...-restored.stdout.log`.
The new control was not compiled or executed; later controls did not run.

[Targeted run 43912607834](https://github.com/bradleybond512/crystal-ball/actions/runs/43912607834)
failed because `tests/ux010-native-gate.test.mjs` still expected nine cases:

```text
The input did not match the regular expression /test result: ok\. 9 passed; 0 failed;/.
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The extra case is the approved location-error serialization regression. It was
present in the reviewed inventory and passed in both hosted platform harnesses.

All other **14 workflows passed**, including
[Security Audit](https://github.com/bradleybond512/crystal-ball/actions/runs/43912607565).
Its six-lock audit reported zero high/critical findings in every project;
marketing had eight moderate findings. npm signature verification returned
`"invalid": []`. No audit coverage or threshold was changed.

## Bounded repair

Source commit `34ea5971624fb2efe070a9d9e00763c28eb24936` changes four files:

- `src-tauri/src/imessage.rs`: compile `Service::new` for its real macOS and
  test consumers using `cfg(any(target_os = "macos", test))`. No runtime
  behavior, unsupported-platform response or warning allowance changes.
- `scripts/native-test-driver.mjs`: require a unified diff hunk with an actual
  added **or** removed content line. Preserve source mutation hashes, exact
  controls/failure sets, full harness counts, finally restoration and deadlines.
- `tests/native-ci-controls.test.mjs`: validate actual Git output for all nine
  fixed mutations using real tracked source files in a disposable repository;
  reject empty/header-only/no-hunk output and guard the hosted call site.
- `tests/ux010-native-gate.test.mjs`: reconcile the exact expected count to ten,
  matching the observed hosted cases. Other assertions remain unchanged.

The architect confirmed these repairs stay within the approved design. No
new target, budget, dependency, permission or delivery policy was introduced.

## Local validation and mutation proof

On clean source `34ea5971624fb2efe070a9d9e00763c28eb24936`:

```sh
bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-ci-workflow test:native-crypto-boundary test:native-boundaries test:roadmap-controller"
```

Actual outputs in order: `# pass 21`, `# pass 4`, `# pass 3`, `# pass 54`,
`# pass 135`, each with `# fail 0`. Exit 0 and
`Agentic validation gate passed.` All TypeScript checks, repository lint,
secret scanning, docs and build passed. Existing build warnings and the
previously disclosed intermittent 400 ms child-fixture risk remain unchanged.

The new tracked-diff test was first run against the original predicate:
`# pass 5` / `# fail 1`, failing on the DTO addition-only diff. Fixed:
`# pass 6` / `# fail 0`. The combined driver/control/workflow tests returned
`# pass 25` / `# fail 0`; ESLint of changed JavaScript files and diff checks
exited 0. The constructor's existing Node boundary suite passed 6/0.

Five isolated driver mutations each produced **6/0 → 5/1 → 6/0**:
restore the old AND predicate; omit the hunk requirement; omit changed-line
validation; accept empty/header-only output; bypass the hosted validator call.
Each began clean, saved its confirmed applied diff and unique raw output,
restored the original checksum and verified clean status. File:
`scripts/native-test-driver.mjs`; restored SHA-256:
`26cf4791beadbe37ccc047d490b8153284db61e944e986de4e44068c2c5e934f`.

The exact native-wrapper assertion was replayed against both captured hosted
outputs: **2/0 → 0/2** with old count nine **→ 2/0** restored count ten.
Its restored SHA-256 is
`7d9c990fdb28c0301641c05b4205954873982dfffc6a99a37b07065e9c6a2467`.
This is recorded-output validation, not new native execution. No Cargo, rustc,
app, Keychain or native service executed locally.

Raw artifacts are in session `remaining-gates/hosted-4690/`; local commands,
logs, applied diffs, assertions and checksums are in `diff-gate-repair/`,
including `mutations/results.json` and `mutations/wrapper-results.json`.

## Review, completion and rollback

Independent review found no source blocker; exact-tip Sol and Sonnet reviews
must finish before the new verdict and publication request. The previous
approval covered `4690b0b45d`, not these new repair commits.

After approved publication, verify strict Linux/macOS Clippy, all 269/272 cases,
all eight/nine native mutation controls with exact red/restored-green results,
and the targeted wrapper in hosted CI. New controls remain unproven until then.
UX-071 stays in progress. App-level manual verification remains paused.

Rollback is a reviewed revert of this four-file repair and its documentation;
no persisted data or package versions change. Reverting restores known CI
failures, so it is not an acceptance candidate. Proposed PR update: recognize
valid addition-only native mutation diffs, scope the last unused Linux
constructor, and align the wrapper with the actual ten-case location contract.
