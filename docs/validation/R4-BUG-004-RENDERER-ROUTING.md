# R4-BUG-004 validation (PR B, renderer) — confirmed-port routing and privacy-safe fallback

Validated September 29, 2026 on branch `claude/r4-bug-004-renderer`, stacked
on PR A (`claude/r4-bug-004-sidecar-supervisor`). Approved design:
[plan](../plans/2026-09-29-r4-bug-004-sidecar-supervisor.md).

## Behavior and architecture

- **Confirmed-port routing** (`src/services/runtime.ts`):
  - `resolveConfirmedLocalApiPort()` caches only a port the native side
    confirmed. While the sidecar boots or restarts, it polls every 250 ms for
    up to 5 s, with one shared poll. It returns `null`, never the default
    46123.
  - `invalidateLocalApiPort()` runs after a local connection failure and
    after a 401, so a restarted sidecar on a new port, or a foreign listener
    on the old one, is re-resolved.
  - The fetch router (`createRuntimeFetch`, injectable) builds each local
    URL from the port *that request* resolved. With no confirmed port it
    sends nothing to localhost; the bearer token never goes to an
    unconfirmed port.
  - Secret-bearing calls re-resolve from the native side every time, and
    send nothing without a confirmed base:
    - Settings key sync (`pushSecretToSidecar`);
    - key validation (`callSidecarWithAuth`);
    - the Settings window's bearer-token diagnostics (`diagFetch`).

    The keychain and the native `SecretsCache` stay authoritative. A
    restarted sidecar receives keys through its env.
- **Cloud fallback policy** (`src/services/cloud-fallback-policy.ts`, pure,
  fail-closed), per Bradley's decision:
  - It falls back only on a connection failure (including no confirmed port
    or our own 15 s timeout) or an HTTP 5xx. It never falls back on 4xx or a
    caller abort.
  - Coordinates (`lat`/`lon`/`lng`/…, bounding-box corners, `bbox`) are
    rounded to 2 decimals.
  - These always stay local:
    - personal parameters (search terms, names, places, routes, IPs,
      domains, `value`, `context`, keys);
    - request bodies and non-GET methods;
    - coordinates embedded in the path;
    - any unclassified parameter.
  - `/api/health`, `/api/diag` and `/api/local-*` never fall back. A caller
    `Authorization` header is never forwarded. An empty remote base or a
    missing cloud key means no request.
  - `tests/api-param-classification.test.mts` scans the renderer. It fails
    when an `/api/` query parameter is not classified. On first run it found
    10 real gaps, now classified: PurpleAir `nwlat/nwlng/selat/selng`
    (coordinates), `context` (personal), and five neutral names.
- **Status surfacing:**
  - `local-engine-status.ts` strictly validates `get_local_api_status`.
  - A failed `/api/health` probe explains the failure as "Local engine
    restarting (next try in N s)" or "stopped after 5 failures in 5 min — use
    Restart local engine". It re-probes once, 3 s after a scheduled restart.
  - System Diagnostic shows the engine state, plus a **Restart local engine**
    button only when the supervisor has stopped.

## Actual validation

`bash scripts/agentic-validate.sh --tests "test:sidecar-routing test:sidecar-supervisor test:fetch-attribution"`:

```text
test:sidecar-routing     ℹ pass 10 / ℹ fail 0 (source gates, UCDP + OpenAQ boundaries)
                         ℹ pass 52 / ℹ fail 0 (policy, router, confirmed port, engine status, probe, classification, attribution)
test:sidecar-supervisor  ℹ pass 6 / ℹ fail 0
test:fetch-attribution   ℹ pass 30 / ℹ fail 0
lockfile:check, lint:strict, typecheck:all, cross-agent:check, roadmap:check, build — passed
Secret scan passed for 4935 file(s).
[docs:check] Documentation appears fresh.
Agentic validation gate passed.
```

`SECURITY.md` has no statement about the reaper, the port or the fallback, so
it needs no change (docs:check hint reviewed).

## Mutation proof

Each mutation was applied alone against `npm run test:sidecar-routing`
(baseline 62/0 before and after). The table records the SHA-256 prefix of the
file before mutating. Every file was restored and its hash re-verified.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| 4xx may fall back | `cloud-fallback-policy.ts` (`5c54d8442f6f`) | 60/2 | 4xx never reaches the cloud; trigger matrix |
| Coordinates not rounded | `cloud-fallback-policy.ts` | 61/1 | rounded to 2 decimals |
| Personal params not recognised | `cloud-fallback-policy.ts` | 61/1 | place names/watchlist/routes never leave |
| Unknown params sent | `cloud-fallback-policy.ts` | 60/2 | fail-closed; personal + bodies on 5xx |
| Request bodies sent | `cloud-fallback-policy.ts` | 61/1 | fail-closed |
| Path coordinates sent | `cloud-fallback-policy.ts` | 61/1 | fail-closed |
| Unconfirmed port used | `runtime.ts` (`76912a60cc2a`) | 9/1 | local URLs from the resolved port |
| 401 keeps the stale port | `runtime.ts` | 61/1 | 401 re-resolves port and token |
| Caller abort falls back | `runtime.ts` | 61/1 | caller abort never falls back |
| Authorization forwarded to cloud | `runtime.ts` | 61/1 | caller Authorization never forwarded |
| Cloud answers local health | `runtime.ts` | 61/1 | local health never falls back |
| Unconfirmed default cached | `runtime.ts` | 57/5 | five confirmed-port routing tests |
| Secret base trusts the cache | `runtime.ts` | 61/1 | secret calls always re-resolve |
| Key sync to the default port | `runtime-config.ts` (`232762fa0e40`) | 9/1 | key sync/validation gate |
| Settings diagnostics to the default port | `settings-main.ts` (`c2f09fa9d36c`) | 9/1 | diagFetch gate |
| Probe ignores the supervisor | `sidecar-probe.ts` (`9f334d800ac7`) | 60/2 | restarting and stopped reasons |
| Restart offered while running | `local-engine-status.ts` (`bbf1abcd5153`) | 61/1 | Restart only when stopped |
| New coordinate param unclassified | `cloud-fallback-policy.ts` | 61/1 | classification scan |

All 18 mutations went red, and every file was restored to its original hash.

## Not performed

- No installed app, real Keychain, real sidecar or real cloud endpoint was
  used. Cloud fallback remains inert in shipped builds: `VITE_WS_API_URL` is
  empty and no cloud API is deployed.
- The System Diagnostic button is exercised through its view model
  (`buildLocalEngineView`), not a DOM test.
- Manual acceptance after both PRs merge (Bradley):
  - Force-quit Crystal Ball's `node` process. The ribbon should show
    "restarting" and clear within about 10 s, and feeds should resume.
  - With World Monitor holding port 46123, Crystal Ball should keep working
    on its own port.

## Rollback

There are no persisted-data changes. Revert this PR before PR A. Prefer a
reviewed forward fix.
