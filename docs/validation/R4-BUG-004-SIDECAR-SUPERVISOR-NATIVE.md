# R4-BUG-004 validation (PR A, native) — supervised sidecar restarts

Validated September 29, 2026 on branch `claude/r4-bug-004-sidecar-supervisor`
(base `a255546ee`). Approved design:
[plan](../plans/2026-09-29-r4-bug-004-sidecar-supervisor.md). This is PR A
(native). PR B (renderer routing, fallback policy, status UI) follows.
Repair cycle 1 (review of `6a4f6170b`) is validated below on the rebased
branch.

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
  - **Generation-owned port publication** (`sidecar_publication.rs`, repair
    cycle 1). Every write of the port and its confirmation goes through one
    `PortCell`, which takes the child lock before the port lock:
    - A starter publishes its confirmed port, or the unconfirmed default
      after the 15 s wait, only while its generation is the live child and
      shutdown has not begun. A starter that stalls past its child's exit
      changes nothing, so it cannot overwrite the next child's port.
    - The timeout fallback never undoes a confirmation that the monitor
      already made for the same child.
    - Only the current generation's monitor reaps its child, revokes the
      port on an unexpected exit, or confirms a port file that appeared
      after the boot wait. It does all three under the child lock, so a
      revocation cannot interleave with a late confirmation. Nothing is sent
      to a revoked port during the backoff.
    - `stop_local_api` takes the child and revokes its port under one child
      lock.
    - Secret injection reads the port under the child lock. If the port was
      revoked after its earlier checks, it sends nothing. It never falls
      back to the default port.
  - New trusted-window commands:
    - `get_local_api_status`: phase, generation, confirmed port, restarts,
      last exit code/signal, next retry.
    - `restart_local_api`: acts only when `stopped`, and never kills a live
      sidecar.
  - Secrets reach a restarted sidecar through its env from the authoritative
    `SecretsCache`. The bearer token is stable for the app's lifetime (design
    rationale in the plan).

## Repair cycle 1 (review of `6a4f6170b`)

Finding (P1): a starter whose child had exited could still publish that
child's port. The sequence:

1. Starter A reads its port file.
2. Child A exits, and A's monitor revokes the port.
3. Child B starts and confirms its own port.
4. Starter A resumes and overwrites B's port with A's dead one.

The late confirmation and the timeout fallback had no ownership, generation
or liveness check either. The renderer and secret injection could then be
pointed at a port that any local process can bind.

Fix: publication and revocation moved into `sidecar_publication.rs`, a pure
module with no Tauri, clock or real process. `main.rs` passes its
`LocalApiState` fields; tests pass a fake child whose exit the test
controls. The restart, backoff, flap and manual-retry policy is unchanged,
and so are the reaper's exact-ownership check, the lifetime token and the
`SecretsCache`.

Red first. Eleven contract tests drive the real shared-state path with fake
children and real threads. One parks starter A after it reads its port,
reaps and revokes A, confirms B, resumes A, and asserts that B's port
survives. Barriers are released on any assertion failure, and every wait is
bounded.

The tests first ran against an extraction of the pre-repair glue behind the
same API:

- 9 failed: the parked starter, the stale timeout, an exited child
  published before it was reaped, shutdown, shutdown revocation, the
  fallback downgrade, the lock order of publication, the late confirmation
  outside the child lock, and secret injection's default-port fallback.
- 2 passed both before and after the fix: a replaced monitor touches
  nothing, and a failed exit poll changes nothing. These guard behavior that
  must be preserved.

The new source gate (child lock before the port lock in every publisher)
also failed. All pass after the fix.

## Actual validation

Repair cycle 1 ran in a clean, isolated QA worktree at the code head
`10c6e35b7`, on main `b9122ab23`. Toolchain: Node 22.23.1, rustc and cargo
1.93.1. Cargo used the shared target, a synthetic frontend `dist/index.html`
and the `build:sidecar-xmpp` resource (both gitignored).

`cargo test --manifest-path src-tauri/Cargo.toml`:

```text
Running unittests src/main.rs                 test result: ok. 83 passed; 0 failed
Running tests/current_location_contract.rs    test result: ok. 9 passed; 0 failed
Running tests/imessage_contract.rs            test result: ok. 44 passed; 0 failed
Running tests/notify_policy_contract.rs       test result: ok. 7 passed; 0 failed
Running tests/sidecar_supervisor_contract.rs  test result: ok. 24 passed; 0 failed
Running tests/watchdog_contract.rs            test result: ok. 9 passed; 0 failed
```

Targeted scripts:

```text
test:sidecar-supervisor    pass 7 / fail 0 (6 source gates + cargo contract run)
test:native-responsiveness pass 13 / fail 0
test:desktop-updater       pass 13 / fail 0 ; pass 22 / fail 0
test:imessage              pass 6 / fail 0 ; pass 108 / fail 0
test:imessage-native       pass 1 / fail 0
test:native-notify         pass 5 / fail 0 ; pass 75 / fail 0
test:notifications         pass 227 / fail 0
```

The agentic validation gate (`scripts/agentic-validate.sh` with the scripts
above) runs at the final head, which includes this document. Its raw log is
kept with the review evidence, not here.

## Mutation proof

Each mutation was applied alone, in a clean QA worktree at the final head.
For each one, the runner (`mutate-qa.mjs`) records:

- the applied `git diff`;
- the raw test output, with its pass/fail counts and failing assertions;
- the SHA-256 before mutating and after restoring;
- a clean `git status` after the restore.

Rust rows ran the contract through `rustc --edition 2021 --test`. Gate rows
ran `tests/sidecar-supervisor-boundary.test.mjs`, and each one mutates the
text that gate reads.

The original twelve were regenerated, because their raw output had not been
kept (only this table). M1–M11 use their original find/replace. M12
(exit keeps the dead port) moved with the code into the cell. P1–P14 and
S1–S11 cover the ownership, liveness, shutdown, stale-timeout,
late-confirmation, revocation, consumer and lock-order families added in
repair cycle 1.

| ID | Mutation | File (sha before) | Pass/fail | Result | Red test(s) |
|---|---|---|---|---|---|
| M1 | flap limit off-by-one | `sidecar_supervisor.rs` (`86b6d8fce3fd`) | 21/3 | RED | `consecutive_quick_exits_back_off_then_give_up_on_the_fifth_in_five_minutes`, `manual_retry_only_acts_when_stopped_and_clears_the_breaker` (+1) |
| M2 | stable-run boundary | `sidecar_supervisor.rs` (`86b6d8fce3fd`) | 23/1 | RED | `a_stable_run_resets_the_backoff` |
| M3 | manual retry while running | `sidecar_supervisor.rs` (`86b6d8fce3fd`) | 22/2 | RED | `nothing_restarts_after_shutdown`, `manual_retry_only_acts_when_stopped_and_clears_the_breaker` |
| M4 | restart after shutdown | `sidecar_supervisor.rs` (`86b6d8fce3fd`) | 23/1 | RED | `nothing_restarts_after_shutdown` |
| M5 | reaper prefix/suffix match | `sidecar_supervisor.rs` (`86b6d8fce3fd`) | 23/1 | RED | `foreign_listeners_are_never_treated_as_ours` |
| M12 | exit keeps the dead port confirmed | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `a_replaced_monitor_neither_confirms_nor_reaps_for_the_next_child` |
| P1 | publication ignores the generation | `sidecar_publication.rs` (`c274370e418c`) | 22/2 | RED | `a_stale_timeout_fallback_cannot_clear_the_next_childs_confirmation`, `a_starter_parked_after_reading_its_port_cannot_publish_it_once_the_next_child_confirms` |
| P2 | publication ignores that the child exited | `sidecar_publication.rs` (`c274370e418c`) | 21/3 | RED | `an_exited_child_is_never_published_even_before_its_monitor_reaps_it`, `a_failed_exit_poll_neither_reaps_nor_changes_the_publication` (+1) |
| P3 | publication ignores shutdown | `sidecar_publication.rs` (`c274370e418c`) | 22/2 | RED | `secret_injection_gets_only_a_confirmed_port_of_the_live_child_and_never_a_default`, `nothing_is_published_or_confirmed_late_once_shutdown_begins` |
| P4 | timeout fallback downgrades a confirmation | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `the_timeout_fallback_records_the_default_unconfirmed_and_never_undoes_a_confirmation` |
| P5 | a replaced monitor still ticks | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `a_replaced_monitor_neither_confirms_nor_reaps_for_the_next_child` |
| P6 | late confirmation ignores shutdown | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `nothing_is_published_or_confirmed_late_once_shutdown_begins` |
| P7 | late confirmation replaces a confirmation | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `a_replaced_monitor_neither_confirms_nor_reaps_for_the_next_child` |
| P8 | late confirmation drops the child lock first | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `a_late_confirmation_is_read_and_published_under_the_child_lock` |
| P9 | shutdown leaves the port published | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `shutdown_takes_the_child_and_revokes_its_confirmed_port` |
| P10 | revocation leaves the port confirmed | `sidecar_publication.rs` (`c274370e418c`) | 22/2 | RED | `a_replaced_monitor_neither_confirms_nor_reaps_for_the_next_child`, `shutdown_takes_the_child_and_revokes_its_confirmed_port` |
| P11 | publication takes the port before the child | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `publication_waits_for_the_child_lock_before_it_touches_the_port` |
| P12 | secret injection falls back to the default port | `sidecar_publication.rs` (`c274370e418c`) | 23/1 | RED | `secret_injection_gets_only_a_confirmed_port_of_the_live_child_and_never_a_default` |
| P13 | secret injection ignores liveness | `sidecar_publication.rs` (`c274370e418c`) | 22/2 | RED | `a_failed_exit_poll_neither_reaps_nor_changes_the_publication`, `secret_injection_gets_only_a_confirmed_port_of_the_live_child_and_never_a_default` |
| P14 | a new child reuses the previous generation | `sidecar_publication.rs` (`c274370e418c`) | 21/3 | RED | `a_stale_timeout_fallback_cannot_clear_the_next_childs_confirmation`, `a_replaced_monitor_neither_confirms_nor_reaps_for_the_next_child` (+1) |
| M6 | monitor never restarts | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the monitor restarts the sidecar after an unexpected exit |
| M7 | reaper kills foreign listener | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | only this install's own orphaned sidecar is ever signalled |
| M8 | stop skips shutdown flag | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | shutdown wins every race with a pending restart |
| M9 | start ignores shutdown flag | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | shutdown wins every race with a pending restart |
| M10 | unconfirmed port handed out | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the renderer is only ever handed a confirmed port |
| M11 | restart without trusted window | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | status and manual restart are trusted-window only and cannot kill a running sidecar |
| S1 | starter confirms outside the cell | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the renderer is only ever handed a confirmed port |
| S2 | monitor adopts whatever generation is current | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the renderer is only ever handed a confirmed port |
| S3 | starter publishes for whatever generation is current | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the renderer is only ever handed a confirmed port |
| S4 | start installs outside the cell | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the renderer is only ever handed a confirmed port |
| S5 | stop takes the child outside the cell | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | shutdown wins every race with a pending restart |
| S6 | secrets fall back to the default port | `main.rs` (`7a19a090fa9f`) | 5/1 | RED | the renderer is only ever handed a confirmed port |
| S7 | publication takes the port before the child (gate) | `sidecar_publication.rs` (`c274370e418c`) | 5/1 | RED | port publication and revocation take the child lock before the port lock |
| S8 | late confirmation drops the child lock first (gate) | `sidecar_publication.rs` (`c274370e418c`) | 5/1 | RED | port publication and revocation take the child lock before the port lock |
| S9 | revocation re-locks the child (gate) | `sidecar_publication.rs` (`c274370e418c`) | 5/1 | RED | port publication and revocation take the child lock before the port lock |
| S10 | shutdown revokes before taking the child lock (gate) | `sidecar_publication.rs` (`c274370e418c`) | 5/1 | RED | port publication and revocation take the child lock before the port lock |
| S11 | consumer reads the port before the child lock (gate) | `sidecar_publication.rs` (`c274370e418c`) | 5/1 | RED | port publication and revocation take the child lock before the port lock |

Every mutation went red, and every file was restored to its original hash
with a clean worktree.

## Not performed

- No installed app, real Keychain, or real signal to a process was used. The
  policy is proven with a pure contract and the glue with source gates.
- Manual acceptance after merge (Bradley):
  - Force-quit Crystal Ball's `node` process during a session. Feeds should
    return within about 10 s, with no app restart.
  - Launching World Monitor should no longer leave Crystal Ball dark for the
    session.
- Limitation, present since before this PR and out of its scope: the
  diagnostics bundle still fetches `/api/diag` from the recorded port, or
  the default port, without checking the confirmation. Recommended follow-up:
  read it through `PortCell::confirmed_live_port` like secret injection.
- PR B is required before the renderer follows a new port or stops sending
  its token to an unconfirmed port. Until then, while the port is
  unconfirmed, the renderer uses the default port without caching it.

## Rollback

There are no persisted-data changes. Reverting restores the no-restart
behavior and the unverified reaper. Prefer a reviewed forward fix.
