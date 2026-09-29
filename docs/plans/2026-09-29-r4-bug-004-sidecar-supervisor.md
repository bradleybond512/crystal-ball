# R4-BUG-004: supervised sidecar restarts and privacy-safe cloud fallback

Status: approved by Bradley on September 29, 2026 ("Approve as designed").
Implementation proceeds as PR A (native), then PR B (renderer).
Branch `claude/r4-bug-004-sidecar-supervisor` from `a255546ee`.
Classification: High Assurance (process supervision, local auth boundary,
network egress).

## Problem (verified at a255546ee)

1. **No restart.** The monitor thread in `start_local_api`
   (`src-tauri/src/main.rs:3885-3920`) logs "exited unexpectedly", clears the
   child slot and returns. `start_local_api` has one call site, at boot
   (`main.rs:4747`). The `restart_count` bookkeeping (`main.rs:3640-3650`)
   only ever counts boot starts.
2. **The real-world cause is port 46123 being fought over.** Your desktop logs
   show the legacy **World Monitor.app** (v2.10.4, `~/Applications`) and
   Crystal Ball use the same port and the same unverified "stale-sidecar
   reaper" (`main.rs:3656-3680`). The reaper kills *any* listener on 46123
   that is not the app's own pid:
   - Aug 31 01:35 and 15:56 UTC: World Monitor launched, logged
     "pre-existing listener on port 46123 pid=… — killing", and Crystal Ball's
     sidecar exited with code 0 (its SIGTERM handler) one second later. Crystal
     Ball never restarted it.
   - Aug 29 20:12 UTC: Crystal Ball launched and SIGKILLed World Monitor's
     sidecar the same way.
   - The sidecar itself says "Never kill arbitrary listeners on occupied
     ports" (`local-api-server.mjs:22114`). The Rust reaper contradicts it.
3. **The renderer trusts an unconfirmed port.** `get_local_api_port`
   (`main.rs:1006`) returns the default 46123 even when the sidecar never
   confirmed it (`main.rs:3940-3949`). `resolveLocalApiPort()` caches the first
   answer for the whole session (`runtime.ts:18-43`). After a restart on a
   fallback port, the renderer keeps calling the old port. If another process
   holds 46123, it receives:
   - the bearer token on every request (`runtime.ts:344`);
   - plaintext API keys from Settings: `pushSecretToSidecar` and
     `local-validate-secret` (`runtime-config.ts:1181-1199, 1297`), including from
     the Settings window, which has no fetch patch (`settings-main.ts:760`).

   The boot path already refuses this (the `port_confirmed` guard at
   `main.rs:4211`). The renderer paths do not.
4. **Cloud fallback is too eager.** The fetch patch (`runtime.ts:340-403`)
   falls back on any non-2xx, including 4xx. It even enters the fallback path
   on a caller abort (the aborted signal happens to stop it before the network). It forwards
   the full query string, including exact `lat`/`lon`, search terms and
   routes. Even `/api/health` can fall back, so the health probe could report
   the cloud as "sidecar healthy". Today this is inert: `VITE_WS_API_URL` is
   empty and nothing is deployed. It will not stay inert if a cloud base is
   ever configured.

## Design

Two PRs under this one design: **A (native)**, then **B (renderer)**. Each
PR is independently safe to merge.

### PR A — Native supervisor (Rust)

**New pure module `src-tauri/src/sidecar_supervisor.rs`** (no I/O, no
clock). Unit-tested like `notify_policy.rs`.

- Constants:

  | Constant | Value | Meaning |
  |---|---|---|
  | `BACKOFF_BASE_MS` | 1 000 | first restart delay |
  | `BACKOFF_MAX_MS` | 60 000 | delay cap |
  | `FLAP_WINDOW_MS` | 300 000 | 5-minute window for counting exits |
  | `FLAP_LIMIT` | 5 | exits in the window before giving up |
  | `STABLE_UPTIME_MS` | 120 000 | a run this long resets the backoff |

- `SupervisorState` methods:
  - `on_started(now)`: phase becomes `Running{since}`.
  - `on_exit(now) -> Decision`:
    - `RestartAfter(ms)` with delay 1 s, 2 s, 4 s … capped at 60 s. The
      attempt count resets when the previous run lasted ≥ 2 min.
    - `GiveUp` when there are ≥ 5 exits in 5 min. Phase becomes
      `Stopped{GaveUp}`.
  - `on_start_failed(now)`: counted as an exit, so it can also give up.
  - `on_manual_retry(now)`: clears the exit window and the attempt count.
  - `on_shutdown()`: terminal. No decision after it restarts anything.
  - `snapshot()`: returns phase, restarts, last exit (code/signal/at) and
    `next_retry_in_ms`.
- `is_own_sidecar_command(args, node_bin, script) -> bool`: an exact match of
  the listener's `ps -o args=` against `"<node_bin> <script>"` for this
  install. It is used by the reaper.

**`main.rs` integration**

- `LocalApiState` gains:
  - `supervisor: Mutex<SupervisorState>`;
  - `shutting_down: AtomicBool`;
  - `generation: AtomicU64`, bumped on each successful spawn.

  The old `restart_count` / `last_restart_at` fields and their log line are
  replaced by the supervisor. The log line is kept, and now reflects real
  restarts.
- **Monitor thread, unexpected exit.** It records the exit status, calls
  `on_exit`, and releases the child lock.
  - On `RestartAfter(ms)`, it sleeps on the same dedicated thread. It then
    calls `start_local_api` only if `!shutting_down` and the slot is still
    empty.
  - If `start_local_api` returns `Err`, it calls `on_start_failed` and loops
    on the new decision.
  - On `GiveUp`, it logs once at ERROR and stops.
- **Exit race.** `stop_local_api` sets `shutting_down` *before* it takes the
  child lock and kills. `start_local_api` checks it *under* the child lock
  before spawning. (Implementation note: setting it before the lock is
  equally race-free and still works if the lock is poisoned.) Either the exit wins and no child is spawned, or the spawn
  wins and the exit kills it. There is no orphaned Node process on quit.
- **Verified reaper.** Before signalling a pid on 46123, read
  `ps -ww -o args= -p <pid>` (untruncated). The command is re-checked before
  the SIGKILL that follows SIGTERM, so a pid reused in the grace period is
  never killed.
  - It kills only a listener whose command is exactly this install's
    `<node> <local-api-server.mjs>`, meaning an orphan from our own previous
    session.
  - Anything else (World Monitor, an unrelated tool, a squatter) is logged and
    left alone. The sidecar then binds an OS-assigned port, which it already
    supports, and confirms it via the port file.
  - The reaper moves below `local_api_paths` / `resolve_node_binary` so it
    knows our paths.
- **Late confirmation.** On the 15 s port-file timeout, the monitor keeps
  checking the port file on its 1.5 s tick. It sets `port_confirmed` when the
  file appears, so a slow Node start still becomes usable without trusting
  46123 blindly.
- **Token and secrets across restarts.**
  - The bearer token is kept for the app's lifetime and is **not**
    regenerated. This deliberately deviates from the round-4 text.
    - The renderer, the Settings window and the MCP server all hold it.
    - Rotating it would add a 401 window and buy nothing: the token never
      left the app's trust boundary.
    - `sidecar.token` is rewritten 0600 on each start.
  - Secrets come from `SecretsCache` in the child's env. The cache is
    authoritative, including Settings edits since launch (`set_secret`
    commits to it). So a restarted sidecar has current keys without any IPC
    push.
  - If a restart happens before the boot keychain read finishes, the existing
    injector still covers it: it checks liveness and `port_confirmed` at push
    time.
- **New trusted-window commands** (`require_trusted_window`):
  - `get_local_api_status` returns `{ phase, generation, port, portConfirmed,
    restarts, lastExit, nextRetryInMs }`, with exit code/signal only and no
    log content.
  - `restart_local_api`: a manual retry. It only acts when the phase is
    `Stopped`. It never kills a running sidecar, so a compromised renderer
    cannot drive a kill loop.
- **`get_local_api_port`** now returns `Err("not confirmed")` unless
  `port_confirmed`. The renderer can therefore never be handed an unverified
  port.

### PR B — Renderer

**Confirmed-port routing (`runtime.ts`)**

- `resolveLocalApiPort()` only caches a *confirmed* port.
  - While the port is unconfirmed (boot or restarting), it polls
    `get_local_api_port` every 250 ms for up to 5 s. Concurrent callers share
    one promise.
  - It returns `null` instead of silently using 46123.
- A new `invalidateLocalApiPort()` is called by the fetch patch on a local
  connection failure and on a 401. A restarted sidecar on a new port, or a
  foreign listener, is re-resolved on the next request.
- The fetch patch never sends the bearer token to an unconfirmed port. No
  confirmed port counts as a connection failure. `getApiBaseUrl()` keeps its
  default for non-secret callers (iframes, display strings).
- **Secret-bearing calls** (`pushSecretToSidecar`, `local-validate-secret`,
  both windows) use `resolveConfirmedLocalApiBase()`. When there is no
  confirmed port, they skip the push (keychain + `SecretsCache` remain the
  source of truth; the restarted sidecar gets the key from env) and never
  post to 46123 on spec.

**Cloud fallback policy: new pure module `src/services/cloud-fallback-policy.ts`**

This implements your decision.

- `mayFallBack(outcome)`:
  - yes for a local **connection failure** (network error, no confirmed port,
    our own 15 s timeout);
  - yes for **HTTP 500-599**;
  - never for 4xx, 2xx/3xx or a **caller abort**.
- `prepareCloudTarget(target, method, hasBody)` returns a sanitized target or
  `blocked(reason)`. It is **fail-closed**:
  - Local-only targets are blocked. This covers the existing set,
    `/api/local-*`, plus `/api/health` and `/api/diag`, so the cloud never
    answers a local health check.
  - Any request with a body, or any method other than GET/HEAD, is blocked.
    Bodies are where prompts, watchboards, routes and settings live, and they
    cannot be inspected generically.
  - Coordinate parameters (`lat`, `lon`, `lng`, `latitude`, `longitude`,
    `sw_lat`, `sw_lon`, `ne_lat`, `ne_lon`, and each number in `bbox`) are
    rounded to **2 decimals** (about 1 km).
  - Personal parameters are **blocked** rather than stripped, because
    stripping changes the answer:
    - `q`, `query`, `name`, `city`, `origin`, `destination`, `coords`
      (routes), `ip`, `domain`, `email`, `address`, `place`, `term(s)`,
      `keyword(s)`, `watchlist`.
    - This covers saved-place names, watchlist terms, routes, lookups and
      searches.
  - Any parameter not in the reviewed **neutral allowlist** (for example
    `limit`, `page`, `country`, `symbols`, `url` for RSS) is **blocked**.
    Unknown means "stay local", never "send it".
- The fetch patch:
  - calls both helpers;
  - treats an empty remote base as "unavailable" (no request is made);
  - rethrows immediately on caller abort.

**Status surfacing**

- `sidecar-probe.ts`: when `/api/health` fails, it reads
  `get_local_api_status`. The reason, shown in the ribbon and in System
  Diagnostic, is one of:
  - "Local engine restarting (attempt 2, next try in 4 s)";
  - "Local engine stopped after 5 crashes in 5 min — use Restart in System
    Diagnostic".

  It re-probes about 3 s after `nextRetryInMs` instead of waiting for the
  30 s tick, so the ribbon clears quickly.
- `SystemDiagnosticPanel`: a **Restart local engine** button next to the
  existing sidecar self-test, enabled only when the phase is `Stopped`.
- The `system-health.ts` recommendation text changes from "restart Crystal
  Ball…" to the Restart button.

### Non-goals (recorded, not done here)

- **Hang watchdog** (kill on a stale heartbeat). Your log has 182
  "heartbeat stale" warnings with ages of 263–7236 s, and every one
  recovered within seconds. That pattern is system sleep, not hangs. A
  wall-clock watchdog would kill healthy sidecars on every wake. A follow-up
  would need awake-time (monotonic) staleness plus a failed `/api/health`
  before killing.
- The sidecar's own server-side cloud pass-through stays off. It is opt-in
  via `LOCAL_API_CLOUD_FALLBACK`, which the app never sets.
- Deploying a cloud API. Fallback stays inert until one exists and
  `VITE_WS_API_URL` is set.
- The legacy World Monitor.app is yours to quit or remove. We cannot patch
  its reaper. After PR A, Crystal Ball stops killing it, and it can no longer
  black out Crystal Ball for the session.

## Tests (written first, fake-only; mutation proof per behavior)

**Rust — `src-tauri/tests/sidecar_supervisor_contract.rs`**

- The backoff sequence is 1/2/4/8/16/32/60/60 s.
- The attempt count resets after a ≥ 2 min run.
- Exactly the 5th exit inside 5 min gives up, and an exit outside the window
  is forgotten.
- A start failure counts toward giving up.
- A manual retry clears the breaker.
- Nothing restarts after shutdown.
- `is_own_sidecar_command` rejects:
  - World Monitor's path;
  - a prefix match;
  - extra arguments;
  - a different node binary.

**Source gates — `tests/sidecar-supervisor-boundary.test.mjs`**

- The monitor's unexpected-exit branch calls the restart path.
- The reaper signals only after `is_own_sidecar_command`.
- `stop_local_api` sets `shutting_down` before taking the child, and
  `start_local_api` checks it.
- `get_local_api_port` refuses unconfirmed ports.
- The new commands call `require_trusted_window`.

**Renderer (tsx, injected fakes)**

- `cloud-fallback-policy.test.mts`:
  - the full trigger matrix (conn/timeout/5xx yes; 4xx/abort/2xx no);
  - rounding, including negatives, precision and `bbox`;
  - every personal param blocks;
  - unknown params block;
  - body/POST blocks;
  - health/diag/local-* block.
- `runtime-fetch-patch-fallback.test.mts` (fake `nativeFetch` + fake IPC):
  - a 4xx never reaches the cloud;
  - a 5xx reaches it with rounded coordinates;
  - a request with `q=` or a body never reaches it;
  - an empty base makes no request;
  - a caller abort makes no request;
  - no request goes to an unconfirmed port;
  - the port is re-resolved after a connection failure and after a 401.
- `sidecar-secret-push.test.mts`: with no confirmed port, the secret push
  and validation make zero network calls.
- `api-param-classification.test.mjs`: scans renderer `/api/` query literals
  and `URLSearchParams` keys, and fails if a name is not classified as
  coordinate, personal or neutral. This is heuristic; the runtime fail-closed
  rule covers misses.
- Updates to the existing `sidecar-probe`, `fetch-attribution-port-race` and
  `system-health` tests for the new reasons and the confirmed-port semantics.

**Proof**

- A `package.json` script `test:sidecar-supervisor` plus override mappings.
- `bash scripts/agentic-validate.sh --tests "test:sidecar-supervisor …"`.
- `cargo test` for the supervisor contract.
- A mutation table, with at least one mutation per behavior above.

**Manual acceptance (you, after merge)**

- During a session, force-quit Crystal Ball's `node` process (Activity Monitor,
  or `kill -9` on the pid from `lsof -nP -iTCP -sTCP:LISTEN | grep node`).
- Feeds should return within about 10 s, and the ribbon should show
  "restarting" and then clear.
- Launching World Monitor should no longer black out Crystal Ball.

## Rollback

There are no persisted-data changes. Revert PR B first, then PR A. Reverting
A alone restores today's no-restart behavior. Prefer a reviewed forward fix.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.
