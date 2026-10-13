# Q17: release sidecar runs only the bundled, hash-pinned Node (R3-SEC-005)

Status: **approved by Bradley on October 3, 2026** with every recommended
option (A: as designed; B: fail closed without a pin; C: keep Always Allow
and document the trade-off). The original October 3 implementation was stacked
on `claude/r3-sec-003-phase-a` (#1775).

October 11 private integration: this approved own delta is being adapted onto
canonical main `3836f56d01a5b7d7c34c5e126a87e74694d6b5eb`, preserving its
generation-owned port publication and launch-secret revision/reconciliation
mechanisms. Fresh integrated validation, mutation proofs and independent review
are **PENDING**. External publication and the human dependency-change label
remain held. No package, install, Keychain or signing operation is authorized
by this integration document.

High Assurance: this is the process that receives `LOCAL_API_TOKEN` and every
Keychain secret.

## Historical problem (October 3 observations at the #1775 tip)

- **A release build can fall back to a Node that isn't bundled.** If
  `<resources>/sidecar/node/node` is missing, `resolve_node_binary` tries every
  `PATH` entry, then `/opt/homebrew/bin/node`, `/usr/local/bin/node` and
  others. Homebrew's `node` is user-writable and changes on every
  `brew upgrade`. Whichever binary is found receives the secrets.
- **Nothing checks that the bundled Node is the one that was downloaded.**
  `download-node.sh` verifies the archive against `SHASUMS256.txt`, but that
  hash never reaches the app.

Historical October 3 read-only observations, not rerun for this private integration:

- The installed app's `Contents/Resources/sidecar/node/node` is byte-identical
  to the downloaded file (SHA-256 `e2d4915d…50e0`, Node v22.14.0). Packaging
  does not re-sign files in Resources, so it still carries the Node.js
  Foundation signature.
- The original report concluded that pinning that exact hash worked with the then-current packaging, including
  the stable "Crystal Ball Dev" signature.
- The original report measured hashing at about 0.1 to 0.4 s; this is not a fresh benchmark.

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
   - It watches the bundled Node directory and the present target file. Debug
     builds embed nothing and skip the read; Windows builds choose `node.exe`.
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

## Recorded approval decisions (October 3)

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

The October 3 choices A/B/C and October 11 bounded private integration
approval satisfy the design stop for this scope. Operational validation,
publication and the dependency-change label remain separate held actions.

## Integration limits and fresh evidence

A matching pin proves equality to the trusted build input, not independent
publisher authenticity. Download verification and signing remain separate
controls. The same-user check-to-spawn replacement window, access to the Always
Allow signing key and unpinned sidecar JavaScript remain accepted limits.

The private native fixture retains the empty SHA-256 vector and adds 1,048,576
ASCII `a` bytes followed by `independent-tail\n` (1,048,593 bytes total), with
literal independently supplied expected hashes. It also changes only the final
byte and checks rejection against the original pin. Fresh compiled results and
all mutation proofs must be recorded after execution; none are claimed here.
The source ordering check uses current `transport_launch(&secrets_cache.revisions)`
and explicitly covers token generation, token-file open/write, token environment
setup and spawn. All current-main targeted suite mappings remain required.
