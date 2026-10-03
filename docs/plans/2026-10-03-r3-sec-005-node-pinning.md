# Q17: release sidecar runs only the bundled, hash-pinned Node (R3-SEC-005)

Status: **approved by Bradley on October 3, 2026** with every recommended
option (A: as designed; B: fail closed without a pin; C: keep Always Allow
and document the trade-off). Stacked on
`claude/r3-sec-003-phase-a` (#1775). Every open PR in that stack edits
`main.rs`, and this one does too.

High Assurance: this is the process that receives `LOCAL_API_TOKEN` and every
Keychain secret.

## Problem (verified at the #1775 tip)

- **A release build can fall back to a Node that isn't bundled.** If
  `<resources>/sidecar/node/node` is missing, `resolve_node_binary` tries every
  `PATH` entry, then `/opt/homebrew/bin/node`, `/usr/local/bin/node` and
  others. Homebrew's `node` is user-writable and changes on every
  `brew upgrade`. Whichever binary is found receives the secrets.
- **Nothing checks that the bundled Node is the one that was downloaded.**
  `download-node.sh` verifies the archive against `SHASUMS256.txt`, but that
  hash never reaches the app.

Checked read-only on your Mac:

- The installed app's `Contents/Resources/sidecar/node/node` is byte-identical
  to the downloaded file (SHA-256 `e2d4915d…50e0`, Node v22.14.0). Packaging
  does not re-sign files in Resources, so it still carries the Node.js
  Foundation signature.
- Pinning that exact hash therefore works with today's packaging, including
  the stable "Crystal Ball Dev" signature.
- Hashing it takes about 0.1 to 0.4 s.

## Design

1. **Release builds use the bundled Node only.**
   - No `PATH` and no common-location fallback in release builds. The Windows
     flattened-name candidate stays.
   - `LOCAL_API_NODE_BIN` is still ignored in release builds, as today.
   - The selection becomes a pure function, tested with temporary
     directories.
   - Debug builds keep today's fallback.
2. **Pin the hash at build time.**
   - `build.rs` hashes `src-tauri/sidecar/node/node`, the exact file Tauri
     bundles, for release profiles only, and embeds it as
     `CRYSTALBALL_BUNDLED_NODE_SHA256`.
   - It reruns only when that file changes. Debug builds embed nothing and
     skip the read.
   - This adds `sha2` as a build dependency, at the same version the app
     already uses, so no new crate is downloaded.
3. **Verify before every spawn.**
   - In a release build, the bundled file must match the pinned hash before
     the sidecar starts. That covers the first launch and every supervisor
     restart, which carries the secrets in its environment.
   - A missing file, a mismatch, or a missing pin (decision B) **fails
     closed**: the sidecar does not start, so no secret leaves native.
4. **Say why.**
   - A desktop-log ERROR names the reason.
   - The local-engine status gains a value-free `startError`, so System
     Diagnostic shows, for example, "Local engine can't start: its bundled
     Node runtime is missing or was modified. Reinstall Crystal Ball."
     instead of a bare "stopped".

## Decisions for you

- **A.** Approve the design.
- **B.** A release build made without the bundled runtime (no pin). That
  only happens with a raw `tauri build` or `--skip-node-runtime`; nothing in
  the repo does either. Recommended: fail closed. The alternative runs the
  unpinned bundled Node with a warning.
- **C.** A trade-off in the #1775 signing guide. It tells you to click
  **Always Allow** so unattended main-sync can sign. That also lets any
  process running as you sign with "Crystal Ball Dev". Such a process could
  re-sign a modified Crystal Ball that the Keychain would still trust.
  - Recommended: keep Always Allow and state the trade-off in the guide.
    Unattended builds need it, and it is still far better than the shadow
    vault's key, which any process can derive with no prompt at all.
  - The alternative is to click **Allow** on every build, which means
    main-sync waits for you each time.

## Tests (fakes only; mutation proof per behavior)

- **Rust:**
  - the pure selection never returns a `PATH` or common-location binary in
    release mode, and keeps the debug fallback;
  - the pin check accepts the matching file and rejects a modified, missing
    or unpinned one;
  - `build.rs` hashing is release-only.
- **Source checks:**
  - `start_local_api` verifies the pin before spawning, and before the
    secrets reach the environment;
  - the error reaches the status.
- **Renderer:** `startError` parsing and the diagnostics text.

## Approval requirement

Implementation starts only after Bradley approves.
