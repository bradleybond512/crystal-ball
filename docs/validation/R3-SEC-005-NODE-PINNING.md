# R3-SEC-005 validation: the release sidecar runs only the bundled, pinned Node

Validated October 3, 2026 on branch `claude/r3-sec-005-node-pinning`, stacked
on `claude/r3-sec-003-phase-a` (#1775). Approved design:
[plan](../plans/2026-10-03-r3-sec-005-node-pinning.md). Bradley's choices:

- A: as designed.
- B: fail closed when a release build has no pin.
- C: keep codesign Always Allow and document the trade-off.

## Behavior

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

### Checked on Bradley's Mac (read-only)

- The installed app's bundled Node is byte-identical to the downloaded file
  (SHA-256 `e2d4915d…50e0`, v22.14.0). Packaging leaves Resources unsigned
  by us, so the pin survives the stable re-signing.
- A real `cargo build --release` of this branch, with that file in place,
  embedded the same hash in the release binary.

### Not changed

- Debug-build behavior, the Node version, and `download-node.sh`.
- The sidecar's JavaScript is not hash-pinned. It sits in the same sealed
  Resources folder, so the app's code signature covers it. A same-user
  attacker who can re-sign the app with your identity is the Always Allow
  trade-off stated in the guide.

## Actual validation

All tests use temporary files and fakes; nothing touches the Keychain or the
installed app.

| Suite | Result (Bradley's Mac) |
|---|---|
| `cargo test`: `main.rs` unit tests (4 new: release selection, debug fallbacks, pin accept/reject, hash vector) | 96/96 |
| `cargo test`: the vault writer, watchdog, iMessage, sidecar-supervisor and location contracts | 19/19, 9/9, 44/44, 13/13, 9/9 |
| `test:node-pinning` (new): source checks, then `local-engine-status` (1 new test) | 5/5, then 5/5 |
| `sidecar-probe-engine` (existing) | 4/4 |
| `cargo build --release` | embedded pin equals the bundled file's SHA-256 |

- `tsc --noEmit` and ESLint are clean on every changed file.
- The agentic gate passed: `lint:strict`, `typecheck:all`, `secrets:scan`,
  `docs:check` and `npm run build`.

## Mutation proof

Each mutation was applied alone, and each file was restored and its SHA-256
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

All 17 mutations went red.

## Rollback

Revert the commit. Release builds would again fall back to a `PATH` or
Homebrew `node` when the bundled one is missing, and run a modified bundled
Node without noticing.
