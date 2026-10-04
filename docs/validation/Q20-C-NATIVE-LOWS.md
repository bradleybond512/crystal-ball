# Q20 PR C validation: native lows (R3-SEC-008, R4-LOW-007)

Plan: `docs/plans/2026-10-04-q20-remaining-lows.md` (on #1779), approved by
Bradley on October 4, 2026. Decision B: Bradley checks the app after the
next install. Stacked on #1776, because every open stack PR edits `main.rs`.

## What changed

- **R3-SEC-008:** `com.apple.security.cs.allow-unsigned-executable-memory`
  is removed from `src-tauri/Entitlements.plist`. Only `allow-jit` and the
  location entitlement remain. This is safe for three reasons:
  - **Bundled Node isn't affected.** It keeps the Node.js Foundation's own
    signature and entitlements: `codesign --deep` re-signs nested code
    bundles, not files in `Resources`, which Q17 verified on the installed
    app.
  - **The web content isn't affected.** WebKit's JIT, and the ML worker's
    WASM, run in Apple's WebContent process.
  - **The Rust host never JITs.**

  `desktop-package.mjs`'s comment now says this.
- **R4-LOW-007:** new std-only module `src-tauri/src/log_rotation.rs`.
  - **`rotate_by_rename`** (the existing behaviour, now shared) for the
    desktop log.
  - **`rotate_by_copy_truncate`** for `local-api.log`, which the sidecar
    writes through an inherited append-mode descriptor. It copies the file
    to `.log.1` with mode 0600, then truncates the original in place, so
    the child's next write lands at offset 0.
  - A shared lock serialises rotations.
  - **`start_sidecar_log_rotator`** starts one background thread per app
    lifetime. It runs at the first sidecar spawn and is reused across
    supervisor restarts, checking every 60 s against the existing 5 MB × 3
    limits.
  - **Trade-off:** a line written between the copy and the truncate can be
    lost. Piping the child's output through Rust was rejected, because a
    stalled reader could block the sidecar on a full pipe.
- **R3 doc:** the status row for R3-SEC-008 is now ✅.

**Smoke test for Bradley (decision B).** After main-sync next installs this
build, confirm:

- the map renders;
- System Diagnostic shows the local engine as running;
- an ML feature (for example a briefing summary) works.

If anything fails, the fix is to restore the single plist key.

## Tests

- **Rust:** 5 unit tests in `log_rotation.rs`. They pass as
  `cargo test --bin crystalball log_rotation` on the Mac, and standalone with
  `rustc --test`. They cover:
  - the child's descriptor keeps working after truncation;
  - backup shifting and dropping the oldest;
  - small files are left alone;
  - rename rotation;
  - the backup's 0600 mode.
- **Node:** `tests/native-lows.test.mjs`, 2 tests (the plist assertion and
  the rotator wiring). New script: `test:native-lows`.
- **Clippy:** the new code adds no warnings (one `useless_vec` in a test
  was fixed).

`bash scripts/agentic-validate.sh --tests "test:native-lows test:node-pinning"`
on the Mac printed "Agentic validation gate passed." It covered lint:strict,
typecheck:all, secrets:scan, cross-agent:check, docs:check, roadmap:check,
the build, and both suites (all passing). `cargo test --bin crystalball
log_rotation` passed 5 of 5.

## Mutation proof (8 mutations, all red, all restored by SHA)

| ID | Mutation | Suite | Result |
|---|---|---|---|
| C01 | log never truncated | Rust unit tests | red (test harness exit 101), restored `a1614fd3b4f3` |
| C02 | rename leaves the child writing to `.log.1` | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C03 | older backups overwritten | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C04 | rotates regardless of size | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C05 | backup not private | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C06 | entitlement restored | native-lows | red (1 failing), restored `c502be838620` |
| C07 | rotator never started | native-lows | red (1 failing), restored `c84dfb5230b7` |
| C08 | rotation checked once a day | native-lows | red (1 failing), restored `c84dfb5230b7` |

## Follow-ups

- **R4 status table:** mark R4-LOW-007 when the handoff branch merges.
- **Possible further tightening:** `allow-jit` itself may be unnecessary for
  the Rust host. Removing it is a candidate once the smoke test confirms
  this change.
