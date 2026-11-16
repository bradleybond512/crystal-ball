# UX-071 — remaining native lint and marketing audit repair

## Status and scope

Approved local repair continues [draft #1904](https://github.com/bradleybond512/crystal-ball/pull/1904).
Native source is committed at `51f1b7bfca`, marketing at `07fb8e5c89`.
The marketing audit passes locally. New native compilation, strict Clippy and
actual Rust mutation acceptance remain pending hosted execution after separate
publication approval. UX-071 remains in progress. Merging, auto-merge, releases,
deployment and application installation remain paused.

The native repair scopes platform-specific code to its real consumers, separates
the pure location controller from its native adapter, preserves required updater
asset parsing on every OS, removes verified unused helpers, and makes updater
lock non-truncation explicit. IPC names, authorization, wire values, FFI and
cleanup remain intact. Independent byte comparison confirms the entire
16,636-byte macOS adapter block and the command/cleanup/controller bodies match
published `4f3e4731e`. The final new-file trailing blank line was removed only
for diff hygiene.

Changed native modules: `main.rs`, `current_location.rs`, new
`current_location_native.rs`, `imessage.rs`, `updater_policy.rs`,
`vault_coordinator.rs` and its contract test. Driver/inventory/receipt tests and
targeted-test mappings enforce the new proof contract. The safe Node-only
`test:native-boundaries` alias permits local source checks without native code.

Marketing changes only its manifest and lock: React, React DOM and
`react-server-dom-webpack` 19.2.8 → 19.2.9. The lock changes its root pins and
three package records; all 627 records remain, with no added packages or unrelated
normalization. The existing MIT packages address the
[confirmed RSC advisory](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3).
Next, Vinext/plugins, overrides, audit coverage and severity threshold are intact.

## Executed local validation

Evidence directory in this session:
`next-nov15/remaining-gates/` under the session visualization root.
Commands used Node v22.23.1 / npm 10.9.8. No local Cargo, rustc, native executable,
app launch, Keychain access or application installation ran.

On committed source `07fb8e5c89`:

```sh
bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-ci-workflow test:native-crypto-boundary test:native-boundaries test:ux054 test:supply-chain-gates test:workflow-security test:agentic-pipeline test:roadmap-controller"
```

Actual output from `full-gate.log`, in command order:

| Suite | Actual output |
| --- | --- |
| native-ci-driver | `# pass 20` / `# fail 0` |
| native-ci-workflow | `# pass 4` / `# fail 0` |
| native-crypto-boundary | `# pass 3` / `# fail 0` |
| native-boundaries | `# pass 54` / `# fail 0` |
| ux054 | `# pass 22` / `# fail 0` |
| supply-chain-gates | `# pass 27` / `# fail 0` |
| workflow-security | `# pass 96` / `# fail 0` |
| agentic-pipeline | `# pass 85` / `# fail 0` |
| roadmap-controller | `# pass 135` / `# fail 0` |

Exit 0; final output `Agentic validation gate passed.` Lockfile checks, repository
`lint:strict` checks, all TypeScript checks, secret scan, docs checks and build passed.
Existing build warnings about extensionless imports, native configuration and
chunk sizes remain in the raw log; none were suppressed. The previously
disclosed intermittent 400 ms child-process fixture remains a repeatability
risk; this passing run does not establish its stability.

`npm run audit:locks` on the committed candidate exited 0. Actual audit output:

```text
[npm-audit] .: 1041 dependencies; 0 info, 3 low, 13 moderate, 0 high, 0 critical
[npm-audit] .github/tools/codex: 7 dependencies; 0 info, 0 low, 0 moderate, 0 high, 0 critical
[npm-audit] marketing-site: 627 dependencies; 0 info, 0 low, 8 moderate, 0 high, 0 critical
[npm-audit] scripts: 47 dependencies; 0 info, 0 low, 0 moderate, 0 high, 0 critical
[npm-audit] tools/cb-control: 41 dependencies; 0 info, 0 low, 0 moderate, 0 high, 0 critical
[npm-audit] tools/mcp-server: 93 dependencies; 0 info, 0 low, 2 moderate, 0 high, 0 critical
```

The diagnostic package-name suffixes are omitted here; full output is in
`six-lock-audit-after.log`. Before the patch marketing reported one critical
finding and the six-lock command exited 1. Moderate/low findings remain open.

Marketing used a separate scratch worktree, isolated HOME/config/cache/temp
paths, no inherited credentials and no shared dependency changes:

| Command | Actual result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0; `added 494 packages in 41s` |
| `npm ls react react-dom react-server-dom-webpack --all --json` | Exit 0 |
| `npm audit --package-lock-only --ignore-scripts --include=dev --include=optional --include=peer --audit-level=high --json` | Exit 0; `"moderate": 8`, `"high": 0`, `"critical": 0` |
| `npm run lint` | Exit 0 |
| `npm run typecheck` | Exit 0, including generated types and `tsc --noEmit` |
| `npm run test` | Exit 0; production build plus built Worker tests: `# tests 51`, `# pass 51`, `# fail 0`, `# skipped 0` |

Raw commands, output and isolation settings are preserved in `marketing/`.
This establishes integration and audit evidence, not a dedicated exploit
reproduction. No project-authored marketing behavior or test was changed.

## Portable mutation proof

At clean committed source `07fb8e5c89e7a199afef21ecc70ecc54b22214f2`, ran:

```sh
node --test --test-concurrency=1 tests/native-ci-controls.test.mjs tests/ux010-location-startup.test.mjs
```

Actual baseline and restored output: `# pass 10` / `# fail 0`.
All **34/34** deliberate mutations failed: 21 runs produced `# pass 9` /
`# fail 1`, and 13 produced `# pass 8` / `# fail 2`. Each started from an
empty status, mutated one file, saved and inspected its applied diff, recorded
actual failing assertions, restored the matching SHA-256, then verified empty
status. The separate proof worktree left the candidate untouched. Raw logs,
applied diffs, exact assertions and hashes are retained in
`remaining-gates/portable-mutations/results.json` and its per-mutant files.
These prove portable driver/source safeguards, not execution of native tests.

Independent review caught a filename collision: the final restored-green log
had overwritten the raw red log for the mutation named `restored`. That one
mutation was rerun from the same clean commit: actual `# pass 8` / `# fail 2`,
then restored `# pass 10` / `# fail 0`. Unique
`mutant-restored-applied.diff`, `mutant-restored-red.log` and
`mutant-restored-green.log` now preserve the proof. The evidence index explicitly
names every log; all 34 raw red counts were checked against it, with no other
collisions. This was the first evidence-review repair cycle.

| Deliberate defect | File | Baseline → red → restored (pass/fail) |
| --- | --- | --- |
| `linux-lock-fabrication` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `missing-macos-lock-control` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `unknown-extra-controls` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `bound-source` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `bound-target` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `applied-diff` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `detected-red` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `restored` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `restored-hash` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `distinct-mutated-hash` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `hash-format` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `exact-failure-name-membership` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `full-green-counts` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `full-red-fail-count` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `red-unfiltered` | `scripts/native-test-driver.mjs` | 10/0 → 8/2 → 10/0 |
| `real-process-failure` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `unique-mutation-declaration` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `dto-size-default-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `updater-serialization-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `native-outcome-serialization-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `location-serialization-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `accessor-value-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `accessor-identity-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `lock-truncation-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `watchdog-control-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `crypto-auth-control-noop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `crypto-nonce-control-incomplete` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `platform-control-loop` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `always-restore` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `shared-deadline` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `full-platform-test-list` | `scripts/native-test-driver.mjs` | 10/0 → 9/1 → 10/0 |
| `adapter-command-registration` | `src-tauri/src/main.rs` | 10/0 → 9/1 → 10/0 |
| `adapter-window-guard` | `src-tauri/src/current_location_native.rs` | 10/0 → 9/1 → 10/0 |
| `adapter-sync-cleanup` | `src-tauri/src/current_location_native.rs` | 10/0 → 9/1 → 10/0 |

Failure assertions cover exact platform control sets and receipt evidence,
real complete harness failures, uniquely applied source mutations, bounded
orchestration/restoration, and moved location registration/authorization/cleanup.
The per-mutant report records each actual assertion without inferring coverage
from a green run.

Restored SHA-256 values:

- Driver: `0af3e33e324349257733f2acb13b126b7ca1d14758fffc532cb7691c4bab9f21`.
- `main.rs`: `6a38eb26137c3d4bda60a8832b21207e40b784e7ea012b4054a86cfa4e0649d0`.
- Native location adapter: `d3c554f0727f0d598f8c4fe3199d82cc16dd79b6341f77732e90664728dbaf24`.

The final adapter removes exactly one trailing LF, preserving all other bytes;
its final SHA-256 is
`efee65baa52a8ccd988d3aa883bf427988c6db6aeb7e96b1388c08a727cbd976`.
`whitespace-reconciliation.json` records the independent comparison. No native
mutation execution is claimed by these Node/source proofs.

## Native acceptance boundary

Published stage2 [run 43806526270](https://github.com/bradleybond512/crystal-ball/actions/runs/43806526270)
ran merge source `1863f7ff51a711348a02a937a4941ffc967b8063` for head `4f3e4731e`.
All eight targets passed: Linux 260/0 and macOS 262/0. Watchdog proof was 8/1
then 9/0 on both; nonce proof 118/1 then 119/0 Linux, 120/1 then 121/0 macOS;
authentication proof 115/4 then 119/0 Linux, 117/4 then 121/0 macOS. Applied
diffs and restored hashes were verified. Strict Clippy alone failed native
acceptance, with 89 Linux and 11 macOS emitted diagnostic instances. These are
historical results and do not validate the new native code.

The [fixed proof contract](../plans/2026-11-15-ux071-native-proof-contract.md)
adds seven named regression cases across existing harnesses and requires exact
eight Linux / nine macOS mutation controls. Expected total cases are 269 Linux
and 272 macOS; these are prospective inventory requirements, not run results.
Full unfiltered red/restored-green harnesses, exact failure sets, checksums and
clean restoration remain mandatory. Budgets and strict lint flags are unchanged.
Compile errors or exceeded budgets cannot count as a successful proof.

## Review, manual checks and rollback

Independent Sol and actual Sonnet source reviews found no code blockers. Final
review of the evidence repair and documentation must pin the frozen tip before
publication. After the final whitespace/docs edits, Markdown and docs checks
passed; roadmap tests returned `# pass 135` / `# fail 0`, and the focused portable
suite returned `# pass 10` / `# fail 0`. Diff whitespace checks passed. Logs are
`final-docs.log` and `final-portable.log`. Local checks cannot establish Objective-C runtime behavior
or hosted Linux/macOS compilation; those remain explicit acceptance limits.

After approved publication, inspect both hosted receipts for all eight targets,
exact new case counts, all required mutation controls and strict Clippy; inspect
the six-lock audit and overall CI. Keep the PR draft and all delivery holds.
Any subsequent app-level location/updater manual check requires the relevant
hold to be lifted; no app permission or credential prompt is authorized here.

Rollback: reviewed revert of the native repair, retaining matching inventory
and proof wiring. No persistence migration. Marketing can be reverted separately
with its matching lock, but doing so restores a known critical advisory and is
not a release candidate. No release or user-data rollback is needed.

Draft PR update: preserve native security contracts while clearing platform lint
debt; strengthen fixed hosted regression proofs; patch the coordinated marketing
React packages. Local validation and six-lock audit pass; hosted native
acceptance remains pending. UX-071 remains open.
