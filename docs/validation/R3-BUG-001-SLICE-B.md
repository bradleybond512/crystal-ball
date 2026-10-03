# R3-BUG-001 slice B validation: one vault writer

Validated October 3, 2026 on branch `claude/r3-bug-001-slice-b`, stacked on
`claude/r4-sec-001-secret-boundary` (#1768, `fc3079382`). Approved design:
[plan](../plans/2026-10-03-q16-vault-writer-and-signing.md), Part 1. Bradley's
choices:

- A: Part 1 as designed.
- B: refuse saves until the real vault has been read this session.
- C: wait 15 s, then report "pending" and finish in the background.

Together with [slice A](R3-BUG-001-SLICE-A.md), this closes R3-BUG-001.

## Behavior

- **One vault writer** (`src-tauri/src/vault_coordinator.rs`, pure, with the
  store behind a trait). A single thread is the only code that:
  - changes the secrets cache;
  - writes the vault (Keychain) or the encrypted shadow copy;
  - pushes secrets to the sidecar (per key and in full);
  - runs the legacy migration's consolidated write and cleanup.

  Jobs run first in, first out. The cache lock is held only to copy, inspect
  or swap. It is never held across the Keychain, the disk or a sidecar push.
  So the Settings status reads, the sidecar push, `start_local_api` (the
  sidecar's environment) and supervisor restarts never wait on a Keychain
  prompt.
- **Bounded saves:**
  - `set_secret` and `delete_secret` wait at most 15 s for the boot load,
    then at most 15 s for the write.
  - A job not yet started when its caller gives up is cancelled with one
    compare-and-swap, and it **never runs later**. The caller hears "not
    saved, busy".
  - A started job keeps the writer until the Keychain answers, so no later
    write can overtake it. Its caller hears "pending".
  - At most 8 jobs wait in the queue; a full queue answers "busy" at once.
  - A panicking job fails only that save; the writer keeps serving.
- **Late outcome, pulled.** A new trusted-window command,
  `get_secret_write_state`, returns `{ revision, pending, source }`. It never
  carries a value.
  - After a failed or pending save, the renderer polls it every 2 s, for up
    to 3 minutes.
  - Once nothing is pending, it reloads secret status and signals the other
    windows.
  - The webviews still have no Tauri event permission.
- **Readiness is signalled.**
  - `Loading`, then `Ready` or `Failed`, held under a mutex with a condition
    variable. The predicate is checked under the lock, so no wakeup is
    missed.
  - A guard on the boot task marks the load `Failed` if the task dies before
    the writer applies its result.
  - The 50 ms sleep-poll (up to about 271 s) is gone. `secrets_ready` keeps
    its meaning.
- **Write gate (new finding fixed).**
  - Reads now tell `NoEntry` (absent) apart from any other error and from a
    timeout. Before, any read error, such as a denied prompt or a keychain
    locked at login, counted as "no keys". A first Settings save then wrote a
    vault holding only that key.
  - Saves are allowed only when the real vault was read this session, or the
    Keychain confirmed there is no vault yet.
  - On the shadow copy, after an error, with an unreadable vault, or after an
    incomplete legacy migration, a save is refused. The message points to
    "Reload keys from Keychain".
  - The automatic 120 s retry or a manual reload lifts the gate. The real
    vault then replaces the shadow-derived cache.
- **Ordered merges.**
  - A read records the write generation it started at. If a save committed
    since then, the read does not refresh the shadow file.
  - Merges never resurrect a key the user deleted, and never replace a held
    value.
  - A verified session ignores later shadow or failed reads.
  - Migration merges into the current cache, and cleans up the legacy entries
    only after its vault write succeeds.

### Changed on purpose

- **`delete_secret` and `set_secret`** no longer push to the sidecar
  themselves; the writer does, after the commit. Three source checks were
  updated to the new path:
  - `secret-boundary` (Settings writes reach the sidecar after the vault
    write);
  - `ucdp-local-boundary` (a deletion is pushed as an unset);
  - `native-responsiveness-boundary` (set and delete run `save_secret_change`
    inside the worker).
- **Reads now tell errors apart.**
  - A vault read error no longer starts the legacy migration scan. That scan
    is only for an absent vault.
  - An unreadable (corrupt) vault no longer falls through to migration. It
    logs an error and keeps saves gated, so the item is not overwritten.
- **Found while testing #1768.** `test:native-responsiveness` still looked
  for `get_secret`, which R4-SEC-001 removed, so it failed (1 of 13). Fixed
  on #1768 itself (`fc3079382`): the check now covers `get_secret_status` and
  `get_renderer_config`. Two mutations proved it: a lock taken before the
  worker, and a missing trusted-window check.

### Not changed

- The shadow vault is still written after every successful save and read, and
  still read on a Keychain timeout. Removing it is R3-SEC-003 phase B (Q16b).
- Keychain item names, migration policy, and the R4-SEC-001 secret boundary.
- A sidecar restart racing a save: if the restart reads the cache just
  before the commit and the push misses the new sidecar, the change applies
  at the next restart. This was already the case before.

## Actual validation

No test touches the Keychain, the security CLI, credentials, a real sidecar
or the installed app. The Rust contract tests drive the writer with a fake
store. The renderer tests use a fake Tauri bridge.

| Suite | Result (Bradley's Mac) |
|---|---|
| `cargo test`: `vault_coordinator_contract` (new) | 19/19 |
| `cargo test`: `main.rs` unit tests (2 new: read classification, vault JSON) | 89/89 |
| `cargo test`: the watchdog, iMessage, sidecar-supervisor and location contracts | 9/9, 44/44, 13/13, 9/9 |
| `test:vault-writer` (new): source checks plus the native wrapper, then the renderer pending test | 9/9, then 4/4 |
| `test:native-responsiveness` | 15/15 |
| `test:secret-boundary` | 13/13, then 15/15 |

- `tsc --noEmit` and ESLint are clean on every changed file.
- The agentic gate passed: `lint:strict`, `typecheck:all`, `secrets:scan`,
  `docs:check` and `npm run build`.
- The writer contract also ran 30 times in a row with no flaky failure.

## Mutation proof

Each mutation was applied alone, and each file was restored and its SHA-256
re-verified. Baselines were green. C mutations ran the Rust contract; S
mutations ran the `vault-writer-boundary`, `secret-boundary` and
`native-responsiveness-boundary` source checks; T mutations ran the renderer
test.

Four things changed during the runs:

- **First run.** A batch was cut off by a shell timeout while C06 was applied.
  The one mutated file was restored by hand and matched its recorded hash
  (`d4f6a9013e1c`) before anything else ran.
- **C04 and C06 deadlocked the whole suite.** Holding the lock across the
  write, and never cancelling a queued save, made the readers or the caller
  wait forever. Both tests now run the blocking call on a thread with a
  deadline, so each mutation fails one named test cleanly.
- **Tests strengthened.**
  - C21 (unbounded queue) survived, because the test filled the queue
    `QUEUE_CAPACITY` times. It now pins 8.
  - T01 (no watch after a failed save) survived, because the test started the
    watch itself. It now waits for the watch the save started.
- **Reruns.** C22's first mutant did not compile, so it was replaced with
  one that does. The gate messages were then reworded to name the real button
  ("Reload keys from Keychain"). Every C and S mutation was rerun against the
  final files and tests.

| # | Mutation | File (sha before) | Red result |
|---|---|---|---|
| C01 | shadow source not gated | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C02 | unavailable source not gated | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C03 | absent vault gated | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 3 failing |
| C04 | cache lock held across the Keychain write | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C05 | cancelled save still runs | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C06 | caller never cancels a queued save | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C07 | pending save not counted | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C08 | late outcome not reported | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C09 | late success reported as failure | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C10 | merge ignores user edits | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C11 | merge replaces held values | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C12 | stale read refreshes the shadow | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C13 | real vault merged into a shadow cache | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 13 failing |
| C14 | verified session accepts the shadow copy | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C15 | migration overwrites a newer save | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C16 | failed migration still cleans up | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C17 | failed migration allows saves | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C18 | readiness not signalled | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C19 | guard undoes a finished load | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C20 | wait ignores the predicate | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C21 | queue unbounded | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C22 | a panicking job kills the writer | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C23 | sidecar push before the vault write | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 5 failing |
| C24 | commit does not mark the key touched | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| S01 | set_secret bypasses the writer | `main.rs` (`5db7efb2b61a`) | node source checks: 4 failing |
| S02 | read error counted as an empty vault | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S03 | boot load without the failure guard | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S04 | retry reaches the full load path | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S05 | save wait not 15 s | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S06 | write state open to any window | `main.rs` (`5db7efb2b61a`) | node source checks: 2 failing |
| S07 | write state carries a value | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S08 | webviews granted the event permission | `default.json` (`8b783df53a15`) | node source checks: 1 failing |
| S09 | writer start failure leaves the load waiting | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S10 | readers lock outside the worker | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| T01 | a failed save starts no watch | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T02 | status reloads before the write lands | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 2 failing |
| T03 | the watch has no deadline | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T04 | concurrent watches | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T05 | other windows are not told | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T06 | a malformed write state is trusted | `keychain.ts` (`17b3510c1bb2`) | renderer test: 1 failing |

All 40 mutations went red.

## Rollback

Revert the commit. Saves would again hold the secrets lock across an
unbounded Keychain write, readiness would poll, and a save after a Keychain
read error or on a stale shadow copy could again erase keys. No stored data
changes format, so a revert needs no migration.
