# Q16: one vault writer (R3-BUG-001 slice B), then fail-closed signing (R3-SEC-003 phase A)

Status: **approved by Bradley on October 3, 2026** with every recommended
option (A: Part 1 as designed; B: refuse saves until the real vault is read;
C: 15 s, then pending; D: Part 2 as designed). Two PRs, stacked on
`claude/r4-sec-001-secret-boundary` (#1768, tip `36754f628`). That branch
already rewrote the secret commands, `keychain.ts` and `runtime-config.ts`, so
basing on `main` would conflict with it everywhere.

Both items are High Assurance (the secrets path). No code, test or script in
either PR touches the real Keychain. Tests use a fake vault store.

## Part 1: R3-BUG-001 slice B

### Problems (verified at `36754f628`)

1. **A Keychain write holds the secrets lock.** `set_secret` and
   `delete_secret` keep `SecretsCache.secrets` locked across `save_vault`
   (Keychain `set_password`, which has no timeout) and the shadow write (file
   I/O plus an `xattr` subprocess). Every reader waits behind it:
   - the Settings status reads;
   - the sidecar pushes;
   - the boot merge;
   - `start_local_api`, which builds the sidecar's environment. This means a
     hung write also stalls a supervisor restart of the sidecar.

   Slice A moved these waits off the main thread, but they can still wait
   forever.
2. **Writers are not coordinated.**
   - `reload_secrets_from_keychain` can still run the legacy migration, which
     writes the vault outside any lock, while a Settings save writes it too.
     The last writer wins and the other change is lost.
   - The boot, reload and retry reads refresh the shadow file with whatever
     they read. A read that started before a save can finish after it, leaving
     the shadow file staler than the vault.
   - Full sidecar injections (boot, reload, retry) and per-key pushes race,
     so an older value can reach the sidecar after a newer one.
3. **Readiness is a sleep-poll.** `wait_until_secrets_loaded` polls every
   50 ms for up to about 271 s. If the boot load task dies, `loaded` never
   flips, and every save waits out the full 271 s.
4. **New finding: a save can erase keys.** A save builds the new vault from
   the in-memory cache. Two cases leave that cache incomplete:
   - **Running on the shadow copy.** The Keychain read timed out (common
     after a rebuild), so the cache holds the shadow copy, which can be stale.
     For example, it may predate `restore-keys`, or have been written by a
     different build.
   - **A read error counted as "empty".** `read_keychain_entry_with_timeout`
     turns any read error into "no entry". That includes a denied prompt and
     a locked keychain at login, so the cache comes up empty.

   In both cases, the first Settings save writes that partial map as the vault
   and drops every other key. This is the 2026-05-08 incident class.

### Design

- **One vault writer** (new `src-tauri/src/vault_coordinator.rs`, pure, with
  the store behind a trait so tests use a fake):
  - A single dedicated thread is the only code that changes the secrets
    cache, writes the vault, writes the shadow file, or pushes secrets to the
    sidecar. Jobs run one at a time, first in, first out:
    - Settings set and delete;
    - the boot, reload and retry merges;
    - the migration's consolidated write and cleanup;
    - full and per-key sidecar pushes.
  - **Snapshot, write, commit.** The lock is held only for a copy and for
    the swap, never across the Keychain or the disk. Readers never wait on
    the Keychain.
  - **Bounded queue and bounded caller wait.** At most 8 queued jobs; a full
    queue answers "busy" at once. A Settings save waits up to 15 s (decision
    C):
    - If its job has not started by then, it is cancelled atomically and
      **never runs later**. The answer is "not saved, Keychain busy".
    - If it started but has not finished, the answer is "pending". The write
      keeps ownership until the Keychain answers; no later write can overtake
      it. A write that never finishes makes saves fail fast as busy while the
      app stays responsive.
  - **Late outcome.** When a pending write finishes, native commits the
    change (on success), pushes it to the sidecar in order, and emits
    `secrets-changed { revision, key, status }`. The event never carries a
    value. The renderer reloads secret status, so Settings updates on its
    own.
  - **Ordered merges.**
    - Each Keychain read records the write generation it started at.
    - If a save committed in the meantime, the read's shadow refresh is
      skipped.
    - Merges keep today's rules: never resurrect a key the user deleted, and
      never overwrite a key the user set.
    - The migration write merges into the current cache instead of writing
      its own snapshot. It keeps today's rules: delete only the legacy entries
      that were read, only after a successful vault write, and never when any
      per-key read timed out.
- **Readiness:** the state is `Loading`, then `Ready(source)` or `Failed`,
  held in a mutex with a condition variable.
  - Waiters wake on the change. There is no polling and no missed wakeup: the
    predicate is checked under the lock.
  - A drop guard on the boot task sets `Failed` if it panics, so saves get a
    clear error instead of waiting about 271 s.
  - `secrets_ready` keeps its meaning: true once the load is no longer
    `Loading`.
- **Write gate for unverified vaults** (decision B; fixes problem 4):
  - Reads now tell "entry absent" (`keyring::Error::NoEntry`) apart from
    "error" and from "timed out".
  - A save is allowed only after the real vault was read this session, or
    after the Keychain confirmed there is no vault yet (first run).
  - On the shadow copy, or after a read error, a save is refused with: "Your
    keys were loaded from the backup copy because the Keychain didn't answer.
    Saving now could erase keys. Use "Reload keys from Keychain" in Settings
    (approve the prompt), then save again."
  - The automatic 120 s retry or a manual reload lifts the gate. The first
    real vault read then replaces the shadow-derived cache, since no user
    edit could have happened in between.

Implementation note: the late outcome is pulled, not pushed. The webviews
have no Tauri event permission today, and granting one would widen their
capability surface. So a save that ends "pending" makes the renderer poll a
new value-free `get_secret_write_state` command (`{ revision, pending }`)
every 2 s, for up to 3 minutes, and reload secret status once nothing is
pending. The approved behavior is unchanged: the save finishes in the
background and Settings refreshes on its own.

### Not changed

- Shadow-vault policy: it is still written and read as today. Removing it is
  R3-SEC-003 phase B (Q16b).
- Migration policy, the Keychain item names, and the renderer's
  secret-boundary rules from #1768.

### Tests (fake store only; mutation proof per behavior)

- **Rust contract tests** (`src-tauri/tests/vault_coordinator_contract.rs`):
  - concurrent edits lose nothing;
  - set and delete keep their order;
  - a cancelled job never runs;
  - a timed-out write reports pending, then commits and notifies on a late
    success, and rolls back nothing on a late failure;
  - a hung write leaves readers and status reads unblocked, and later saves
    fail fast as busy;
  - a stale read does not refresh the shadow file, and a merge does not
    resurrect a deleted key;
  - migration does not overwrite a newer save;
  - pushes arrive in order;
  - a waiter before or after `Ready` wakes, and a panic gives `Failed`;
  - the write gate refuses saves on shadow or error sources and allows them
    on vault or absent sources.
- **Source checks** that `set_secret`, `delete_secret`, the readers and
  `start_local_api` do not hold the secrets lock across the Keychain or the
  disk.
- **Renderer tests:** the pending message, and a `secrets-changed` event
  reloading status.

## Part 2: R3-SEC-003 phase A

- **Fail closed:**
  - `desktop-package.mjs` gains `--require-stable-identity`, also set by the
    environment variable `CRYSTALBALL_REQUIRE_STABLE_IDENTITY=1`. With it, a
    failed "Crystal Ball Dev" signing exits non-zero instead of falling back
    to ad hoc.
  - `sync-main-to-mac.mjs` sets it for its build. Before installing, it also
    checks that the built app is not ad hoc (`codesign -dv` must not print
    `Signature=adhoc`).
  - Manual `npm run desktop:build:app:full` builds without the flag behave
    as today.
- **Diagnostics:** a native `get_vault_diagnostics` command returns no
  secrets. It reports:
  - whether the running app is stable-signed, using a read-only `codesign`
    check of its own bundle (no new dependency);
  - the vault source this session (vault, shadow, absent or error);
  - a counter of shadow-fallback activations, persisted in app data;
  - whether saves are currently gated.

  System Diagnostic shows these under a "Keys & signing" row, and every
  fallback is logged.
- **Manual for you** (`docs/guides/crystal-ball-dev-signing-identity.md`):
  how to check for, or create, the "Crystal Ball Dev" code-signing
  certificate in Keychain Access. You do this yourself; no script or agent
  touches the Keychain.
- **Tests:**
  - the package script fails closed with the flag and keeps ad hoc without
    it, with `codesign` faked;
  - main-sync passes the flag and refuses to install an ad hoc app;
  - diagnostics parsing for ad hoc, stable and unknown output;
  - the counter and logging.

## Decisions for you

- **A.** Approve Part 1 as designed.
- **B.** The write gate for unverified vaults. Recommended: refuse saves until
  the real vault has been read this session. The alternative keeps today's
  behavior, so a save while on the shadow copy, or after a read error, can
  erase keys.
- **C.** The wait for a slow Keychain write. Recommended: 15 s, then "pending",
  finishing in the background with an automatic refresh. The alternative is
  up to 60 s on the Save spinner, with no background completion.
- **D.** Approve Part 2 as designed: main-sync fails closed without the stable
  identity, plus the diagnostics and the manual.

## Approval requirement

Implementation starts only after Bradley approves. Each part ships as its own
PR, and Part 2 stacks on Part 1.
