# R4-BUG-004 validation (PR A, native) — supervised sidecar restarts

Validated September 29, 2026 on branch `claude/r4-bug-004-sidecar-supervisor`
(base `a255546ee`). Approved design:
[plan](../plans/2026-09-29-r4-bug-004-sidecar-supervisor.md). This is PR A
(native). PR B (renderer routing, fallback policy, status UI) follows.

## Behavior and architecture

- **Policy** (`src-tauri/src/sidecar_supervisor.rs`, pure):
  - Restart after an unexpected exit with 1 s → 2 s → 4 s … ≤ 60 s backoff.
  - A run of ≥ 2 min resets the backoff.
  - Five failures in 5 min (exits or failed spawns) stop automatic restarts.
    Only a manual retry in the `stopped` phase clears the breaker.
  - Nothing restarts after shutdown begins.
- **Glue** (`main.rs`):
  - The monitor thread hands an unexpected exit to `supervise_after_exit`
    after releasing the child lock. The restart loop sleeps on that
    dedicated thread and re-checks `shutting_down` before spawning.
  - `stop_local_api` sets `shutting_down` before taking the child.
    `start_local_api` checks it under the child lock, so quit never leaves an
    orphaned Node process.
  - **Verified reaper:** a listener on 46123 is signalled only if
    `ps -ww -o args=` is exactly this install's `<node> <script>`. The
    command is re-checked before the SIGKILL that follows SIGTERM. Any other
    listener (for example the legacy World Monitor.app, which your logs show
    trading kills with Crystal Ball) is left alone, and the sidecar binds an
    OS-assigned port.
  - `get_local_api_port` returns only a **confirmed** port. The wording is
    kept for tauri-bridge's boot-noise filter.
  - An unexpected exit revokes the confirmed port immediately, so nothing
    is sent to it during the backoff.
  - A port confirmed late (after the 15 s boot wait) is picked up on the
    monitor tick.
  - New trusted-window commands:
    - `get_local_api_status`: phase, generation, confirmed port, restarts,
      last exit code/signal, next retry.
    - `restart_local_api`: acts only when `stopped`, and never kills a live
      sidecar.
  - Secrets reach a restarted sidecar through its env from the authoritative
    `SecretsCache`. The bearer token is stable for the app's lifetime (design
    rationale in the plan).

## Actual validation

`cargo test --manifest-path src-tauri/Cargo.toml` (shared target, synthetic
frontend dir, `build:sidecar-xmpp` resource):

```text
Running unittests src/main.rs                 test result: ok. 83 passed; 0 failed
Running tests/current_location_contract.rs    test result: ok. 9 passed; 0 failed
Running tests/imessage_contract.rs            test result: ok. 44 passed; 0 failed
Running tests/sidecar_supervisor_contract.rs  test result: ok. 13 passed; 0 failed
Running tests/watchdog_contract.rs            test result: ok. 9 passed; 0 failed
```

`bash scripts/agentic-validate.sh --tests "test:sidecar-supervisor test:native-responsiveness test:desktop-updater test:imessage test:imessage-native"`:

```text
test:sidecar-supervisor    ℹ pass 6 / ℹ fail 0 (5 source gates + cargo contract run)
test:native-responsiveness ℹ pass 13 / ℹ fail 0
test:desktop-updater       ℹ pass 13 / ℹ fail 0 ; ℹ pass 22 / ℹ fail 0
test:imessage              ℹ pass 6 / ℹ fail 0 ; ℹ pass 63 / ℹ fail 0
test:imessage-native       ℹ pass 1 / ℹ fail 0
lockfile:check, lint:strict, typecheck:all, cross-agent:check, roadmap:check, build — passed
Secret scan passed for 4924 file(s).
[docs:check] Documentation appears fresh.
Agentic validation gate passed.
```

## Mutation proof

Each mutation was applied alone. The table records the SHA-256 prefix of the
file before mutating, and the red result. The file was then restored and its
hash re-verified. Rust mutations ran the contract through
`rustc --edition 2021 --test`; `main.rs` mutations ran the source gates.
Baselines before and after: Rust 13/0, gates 5/0.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Flap limit `>=` → `>` | `sidecar_supervisor.rs` (`86b6d8fce3fd`) | 10/3 | give-up-on-fifth, manual retry, start failures |
| Stable-run boundary `>=` → `>` | `sidecar_supervisor.rs` | 12/1 | `a_stable_run_resets_the_backoff` |
| Manual retry allowed while running | `sidecar_supervisor.rs` | 11/2 | manual retry, nothing after shutdown |
| Exit after shutdown not ignored | `sidecar_supervisor.rs` | 12/1 | `nothing_restarts_after_shutdown` |
| Reaper matches prefix + suffix only | `sidecar_supervisor.rs` | 12/1 | `foreign_listeners_are_never_treated_as_ours` |
| Monitor never calls the restart path | `main.rs` (`bb953aaa09b4`) | 4/1 | the monitor restarts the sidecar |
| Reaper ownership check removed | `main.rs` | 4/1 | only our own orphaned sidecar is signalled |
| `stop_local_api` skips the shutdown flag | `main.rs` | 4/1 | shutdown wins every race |
| `start_local_api` ignores the shutdown flag | `main.rs` | 4/1 | shutdown wins every race |
| Unconfirmed port handed to the renderer | `main.rs` | 4/1 | only a confirmed port |
| `restart_local_api` without trusted window | `main.rs` | 4/1 | trusted-window only |
| Exit keeps the dead child's port confirmed | `main.rs` (`57a4f0303524`) | 4/1 | only a confirmed port |

All 12 mutations went red, and every file was restored to its original hash.
The last row was added with the follow-up commit that revokes the port on
exit. Without it, `get_local_api_port` would keep handing out the dead
child's port during the backoff, which any process could bind.

## Not performed

- No installed app, real Keychain, or real signal to a process was used. The
  policy is proven with a pure contract and the glue with source gates.
- Manual acceptance after merge (Bradley):
  - Force-quit Crystal Ball's `node` process during a session. Feeds should
    return within about 10 s, with no app restart.
  - Launching World Monitor should no longer leave Crystal Ball dark for the
    session.
- PR B is required before the renderer follows a new port or stops sending
  its token to an unconfirmed port. Until then, while the port is
  unconfirmed, the renderer uses the default port without caching it.

## Rollback

There are no persisted-data changes. Reverting restores the no-restart
behavior and the unverified reaper. Prefer a reviewed forward fix.
