# R3-SEC-005 validation: the release sidecar runs only the bundled, pinned Node

October 11 private integration: **compiled native, source, renderer, pure build
helper, all 17 mutation proofs and all 40 selected scripts completed**. The
final full gate and independent Sol review occur after this documentation
commit; their final results will be recorded in private frozen-tip evidence.
They are not claimed as passed here. External publication and the human
dependency-change label remain held. No operational native checks were run.

The results below are the original **historical October 3, 2026 claims**, on
branch `claude/r3-sec-005-node-pinning`, stacked on
`claude/r3-sec-003-phase-a` (#1775). They have not been rerun and do not certify
the current integration onto main
`3836f56d01a5b7d7c34c5e126a87e74694d6b5eb`. Approved design:
[plan](../plans/2026-10-03-r3-sec-005-node-pinning.md). Bradley's choices:

- A: as designed.
- B: fail closed when a release build has no pin.
- C: keep codesign Always Allow and document the trade-off.

## Intended integrated behavior

- **Bundled Node only in release builds.**
  - A release build chooses only `<resources>/sidecar/node/node`, or on
    Windows `node.exe` plus the flattened `node.node.exe`. It never uses a
    `PATH` entry or `/opt/homebrew/bin/node` and the other common locations.
  - `LOCAL_API_NODE_BIN` is still honored only in debug builds.
  - The choice is a pure function, `select_node_binary`. Debug builds keep
    the developer fallbacks: override, then `PATH`, then common locations.
- **Pinned at build time.**
  - For release profiles, `build.rs` hashes the exact file Tauri bundles
    (`src-tauri/sidecar/node/node`) and embeds it as
    `CRYSTALBALL_BUNDLED_NODE_SHA256`. Debug builds embed nothing and skip
    the read.
  - `build.rs` reruns when that directory changes.
  - `sha2` was added as a build dependency at the version the app already
    uses, so no new crate.
- **Verified before every spawn.**
  - `resolve_node_binary` streams the bundled file through SHA-256 and
    compares it with the pin before `start_local_api` builds the child's
    environment or spawns it. That covers launch and every supervisor
    restart.
  - A missing file, a mismatch, or no pin (decision B) refuses to start, so
    no secret leaves native.
- **The reason is shown.** The refusal is a fixed message, kept in
  `LocalApiState.start_error` and returned as `startError` by
  `get_local_api_status`. While the engine is not running, System Diagnostic
  shows it instead of a bare "stopped". For example: "Local engine can't
  start: its bundled Node runtime was modified (hash mismatch). Reinstall
  Crystal Ball." The text is capped at 300 characters, and a non-text value
  rejects the payload.
- **Signing guide** (decision C): a new section states the Always Allow
  trade-off.

### Historical October 3 checks on Bradley's Mac (not rerun)

- The installed app's bundled Node is byte-identical to the downloaded file
  (SHA-256 `e2d4915d…50e0`, v22.14.0). Packaging leaves Resources unsigned
  by us, so the pin survives the stable re-signing.
- A real `cargo build --release` of this branch, with that file in place,
  embedded the same hash in the release binary.

### Not changed

- Debug-build behavior, the Node version, and `download-node.sh`.
- The sidecar's JavaScript is not hash-pinned. Signing is a separate control;
  this pin proves only equality of Node bytes to the build input, not an OS
  guarantee against replacement between verification and spawn. A same-user
  attacker who can re-sign with the Always Allow identity remains the accepted
  trade-off stated in the guide. Installed signature/pin equality and actual
  macOS/Windows release operation are not verified by this private integration.

## Historical October 3 validation (unrerun)

The original report described the unit and contract suites as using temporary
files and fakes. Its release-build and installed-file observations are historical
only. No fresh suite or operational result is claimed below.

| Historical suite | Historical reported result (unrerun) |
|---|---|
| `cargo test`: `main.rs` unit tests (4 new: release selection, debug fallbacks, pin accept/reject, hash vector) | 96/96 |
| `cargo test`: the vault writer, watchdog, iMessage, sidecar-supervisor and location contracts | 19/19, 9/9, 44/44, 13/13, 9/9 |
| `test:node-pinning` (new): source checks, then `local-engine-status` (1 new test) | 5/5, then 5/5 |
| `sidecar-probe-engine` (existing) | 4/4 |
| `cargo build --release` | embedded pin equals the bundled file's SHA-256 |

- `tsc --noEmit` and ESLint are clean on every changed file.
- The agentic gate passed: `lint:strict`, `typecheck:all`, `secrets:scan`,
  `docs:check` and `npm run build`.

## Historical October 3 mutation claims (unrerun)

The original report claimed each mutation was applied alone, each file was restored and its SHA-256
re-verified. Baselines were green: Rust `node_pinning_tests` 4/4, source
checks 5/5, and the renderer test 5/5.

| # | Mutation | File (sha before) | Red result |
|---|---|---|---|
| N01 | release falls back past the bundle | `main.rs` (`fda675253b0c`) | Rust unit tests: 1 failing |
| N02 | a missing bundled file is still chosen | `main.rs` (`fda675253b0c`) | Rust unit tests: 1 failing |
| N03 | any hash passes the pin | `main.rs` (`fda675253b0c`) | Rust unit tests: 1 failing |
| N04 | an empty pin is not reported as unpinned | `main.rs` (`fda675253b0c`) | Rust unit tests: 1 failing |
| N05 | the hash covers only part of the file | `main.rs` (`fda675253b0c`) | Rust unit tests: 1 failing |
| N06 | debug override ignored | `main.rs` (`fda675253b0c`) | Rust unit tests: 1 failing |
| S01 | override honored in release | `main.rs` (`fda675253b0c`) | source checks: 1 failing |
| S02 | release skips the pin check | `main.rs` (`fda675253b0c`) | source checks: 1 failing |
| S03 | release searches PATH and common locations | `main.rs` (`fda675253b0c`) | source checks: 1 failing |
| S04 | refusal reason not recorded | `main.rs` (`fda675253b0c`) | source checks: 1 failing |
| S05 | status omits the refusal reason | `main.rs` (`fda675253b0c`) | source checks: 1 failing |
| S06 | build.rs never pins | `build.rs` (`751c2c9564df`) | source checks: 1 failing |
| S07 | build dependency drifts from the runtime sha2 | `Cargo.toml` (`a265552a5e26`) | source checks: 1 failing |
| T01 | refusal reason not shown | `local-engine-status.ts` (`3a69d8861d68`) | renderer test: 1 failing |
| T02 | a non-text reason accepted | `local-engine-status.ts` (`3a69d8861d68`) | renderer test: 1 failing |
| T03 | reason unbounded | `local-engine-status.ts` (`3a69d8861d68`) | renderer test: 1 failing |
| T04 | a running engine shows a stale reason | `local-engine-status.ts` (`3a69d8861d68`) | renderer test: 1 failing |

The original report claimed all 17 mutations went red. These rows are not fresh
integrated mutation evidence. In particular, the original small hash fixture
did not independently establish hashing past the first buffer.

## October 11 actual private integration evidence

The completed execution receipts bind the integrated production source to code
tip `3fdf63c8d0163641d4563988f4e13e26375ee272` on main base
`3836f56d01a5b7d7c34c5e126a87e74694d6b5eb`. Initial focused checks ran on the
same integrated source before its normal code commit; clean compiled/build-helper,
mutation and corrected selector runs bind the committed tip. These are fake or
pure tests under owned HOME/data/tmp/frontend/cache resources and offline local
dependencies, not release application, installed Node, Keychain or signing checks.

The source integration preserves PortCell generation ownership,
`transport_launch` revision floors and LaunchReconciliation, including storing
launch secrets before releasing child ownership. The source check places
resolution/refusal before token generation, token-file open/write,
`LOCAL_API_TOKEN`, current secret transport and spawn. Existing package scripts
and main.rs/renderer targeted mappings are retained; lockfiles are unchanged.

### Actual focused and native results

Counts below are separate executions per suite or binary, not summed distinct
behaviors. The recorded source/renderer footer pairs are `# pass 5` / `# fail 0`;
compiled pinning reports `4 passed; 0 failed`; the pure build helper reports
`6 passed; 0 failed`.

| Executed suite or binary | Actual pass / fail |
|---|---|
| `npm run test:node-pinning`: source boundary suite | 5 / 0 |
| Same script: actual `local-engine-status.test.mts` renderer fixtures | 5 / 0 |
| Initial `test:sidecar-routing`: source footer, then renderer footer | 10 / 0; then 57 / 0 |
| `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --bin crystalball node_pinning_tests -- --nocapture` | 4 / 0 |
| Full `--bin crystalball` | 111 / 0 |
| `--test vault_coordinator_contract` | 45 / 0 |
| `--test watchdog_contract` | 9 / 0 |
| `--test imessage_contract` | 44 / 0 |
| `--test sidecar_supervisor_contract` | 24 / 0 |
| `--test current_location_contract` | 9 / 0 |
| `--test notify_policy_contract` | 7 / 0 |
| Exact-source `bundled_node_sha256` pure Rust fixture | 6 / 0 |

Each full native command used `cargo test --offline --locked --manifest-path
src-tauri/Cargo.toml` with the target shown above. The seven-binary receipt is
`clean-full-native-fixtures-corrected-binding-full-native-receipt.json`; it retains
separate commands, raw logs, counts and hashes. The source and renderer raw logs
are `initial-node-pinning.log` and `initial-sidecar-routing.log`; the corrected
pinning retry is `retry-native-pinning-local-resource.json`.

The build-helper harness extracted the exact helper and required imports from
`src-tauri/build.rs`, SHA-256
`751c2c9564df00280ab3e0f9f84e6b500a7a9623ed6d6bbc4ab92011b0b3c3c4`,
without executing its pruning/Tauri main. Its six serial fake cases checked
PROFILE debug/present, release/absent, release/present, release/multiple buffers,
changed final tail and fake Windows `node.exe` selection over `node`, plus rerun
and pin stdout. Exact helper SHA-256 is
`69fdad10676e925477f6a0901601f0f3d3409cd77e2070dc2e76180681f3d307`;
source, generated harness, cached sha2 linkage and binary hashes are recorded in
`clean-build-hash-fixture-build-hash-receipt.json`. This proves the helper against
fake bytes, not Windows installation or release packaging.

### Actual mutation proofs

All 17 accepted mutations had a confirmed nonempty production-source diff,
assertion failure, exact source/index restoration and a passing restored suite:
six freshly compiled native, seven source-boundary and four actual renderer
proofs, with 51 baseline/red/restored runtime invocations. The manifest records
full source hashes, diffs, commands, receipts, raw logs and failing assertions;
`root-adopted-mutation-proof.json` rechecks these bindings. Mutation manifest
SHA-256: `1fb6be146f6f7911d391d34c059e26d9dbd296e78fb0e5fcc2632e216858c103`.

| ID | Actual mutation | Baseline pass / fail | Red pass / fail | Restored pass / fail |
|---|---|---|---|---|
| N01 | release falls through bundled-only selection | 4 / 0 | 3 / 1 | 4 / 0 |
| N02 | missing bundled file accepted | 4 / 0 | 3 / 1 | 4 / 0 |
| N03 | wrong pin accepted | 4 / 0 | 2 / 2 | 4 / 0 |
| N04 | missing pin misclassified | 4 / 0 | 3 / 1 | 4 / 0 |
| N05 | only first read buffer hashed; later bytes ignored | 4 / 0 | 3 / 1 | 4 / 0 |
| N06 | debug override ignored | 4 / 0 | 3 / 1 | 4 / 0 |
| S01 | release override cfg boundary removed (source-only) | 5 / 0 | 4 / 1 | 5 / 0 |
| S02 | release skips verification | 5 / 0 | 4 / 1 | 5 / 0 |
| S03 | release fallback input isolation removed (source-only) | 5 / 0 | 4 / 1 | 5 / 0 |
| S04 | refusal not recorded | 5 / 0 | 4 / 1 | 5 / 0 |
| S05 | status drops refusal | 5 / 0 | 4 / 1 | 5 / 0 |
| S06 | build release guard inverted | 5 / 0 | 4 / 1 | 5 / 0 |
| S07 | buildsha2 drifts from runtime | 5 / 0 | 4 / 1 | 5 / 0 |
| T01 | refusal hidden | 5 / 0 | 4 / 1 | 5 / 0 |
| T02 | nontext refusal accepted | 5 / 0 | 4 / 1 | 5 / 0 |
| T03 | refusal text uncapped | 5 / 0 | 4 / 1 | 5 / 0 |
| T04 | running displays stale refusal | 5 / 0 | 4 / 1 | 5 / 0 |

S01 and S03 are strictly source-boundary proofs. Removing the debug-only cfg or
release fallback-input isolation kills the source assertion; these do not
execute a release application honoring an override or fallback. N01 separately
exercises bundled-only selection in compiled native behavior.

N05 inserted a stop after the first production `sha256_file_hex` buffer and
freshly compiled the native suite. The independent multiple-buffer assertion
failed with `3 passed; 1 failed`: actual first-buffer hash
`9bc1b2a288b26af7257a36277ae3816a7d4f16e89c1e7e77d0a5c48bad62b360`
versus literal expected
`4b3947d921dabaa30de55acc60853fc793ec853ab17fdb426fe7a185d0d4683b`.
The fixture retains the empty vector and hashes 1,048,576 ASCII `a` bytes plus
`independent-tail\n` (1,048,593 bytes). Changing its final LF to `!` yields
`e13364d31f857c97997faa5f80caff34a1b54e3a5b27ab4d86a0cc648eef01b5`
and rejects the original pin. Literal expected hashes are independent of the
helper under test. All native mutation builds and restored executions used
`--offline --locked`, with no stale compiled binary accepted.

### Complete selected-script execution and corrected attempts

The unchanged trusted selector executed all 40 selected scripts successfully
at the same code tip, child exit 0 in 131.566 seconds, with exact source/raw-index
restoration. Raw log SHA-256:
`0da0ba93a29296df5fc23a183e45f33d8f548d4ad9e53c763b7f0dce4424bcde`.
`corrected-trusted-targeted-execution.json` records the command and guard result;
`corrected-targeted-script-footer-counts.json` retains the complete inventory and
individual footer blocks. Footers can be nested: they are not summed into a
purported unique test total. For example, `test:little-snitch` reports
`# pass 207` / `# fail 0`, then `# pass 17` / `# fail 0`.

The failures before corrected success remain part of the evidence:

- Initial native compilation failed because the local ignored XMPP resource
  was absent. Only that resource was rebuilt from existing local dependencies,
  then the compiled pinning retry passed 4 / 0; tracked source was unchanged.
- The first full-native attempt supplied a mistaken source-hash binding. Its
  guard rejected execution before Cargo; it is not a native test pass. The
  corrected binding produced the seven actual native results above.
- The first 40-script run failed three GID fixtures. A runner-only change to
  owned temporary-directory group setup repaired fixture isolation. The focused
  exporter suite then passed 14 / 0, and the corrected all-40 run passed.
  No production code, test assertion or validation gate was weakened.

The final full agentic gate and independent Sol review run after this document
is committed, against the final frozen tip. Their final results belong in the
private frozen-tip evidence, with no pass asserted by this refresh. External
publication, human dependency-change label, installed signature/pin equality,
actual macOS/Windows release operation and human operational checks remain held
or unverified. Same-user check-to-spawn replacement, Always Allow signing-key
access and unpinned JavaScript remain the approved limits.

## Rollback

Revert the commit. Release builds would again fall back to a `PATH` or
Homebrew `node` when the bundled one is missing, and run a modified bundled
Node without noticing.
