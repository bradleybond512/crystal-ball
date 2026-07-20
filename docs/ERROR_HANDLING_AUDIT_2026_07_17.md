# Crystal Ball — Error Handling Audit
**Date:** 2026-07-17  
**Auditor:** Claude Sonnet 4.6  
**Scope:** Full codebase — TypeScript frontend + Node.js sidecar (local-api-server.mjs)

---

## Push Commands

Run these from your Mac terminal (SSH to GitHub works there):

```bash
cd ~/developer/crystalball
git push origin claude/error-handling-analyst-loop
git push origin claude/error-handling-setinterval-guards
git push origin claude/error-handling-satellite-worker
git push origin claude/error-handling-provider-data-integrity
git push origin claude/error-handling-sidecar-timeouts
```

Then open a PR for each on GitHub. All 5 are isolated single-commit branches on top of `origin/main`.

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| HIGH     | 5     | 5 (all — PRs 1, 3, 4, 5) |
| MEDIUM   | 32    | 29 (PRs 1–5) |
| LOW      | 11    | 0 (documented, no PR) |
| **Total**| **48**| **34 fixed in 5 PRs** |

---

## PR 1 — `claude/error-handling-analyst-loop`

**fix(analyst): error boundaries for hypothesis builders and IDB memory .catch chains**

Files changed: `analyst-loop.ts`, `hypothesis-threads.ts`, `hypothesis-accuracy.ts`,
`hypothesis-projection.ts`, `hypothesis-ensemble.ts`, `briefing-archive.ts`,
`snapshot-archive.ts`, `hypothesis-notifier.ts`, `auto-brief.ts`, `llm-adapter.ts`

---

### HIGH — analyst-loop.ts:348 — Loop-killer: all hypothesis builders share one try scope

All five builder calls (`fromClusters`, `fromAnomalies`, `fromAlertBurst`, `fromSituations`, `getWatchlistHypotheses`) were spread into a single `raw` array with no individual guards. One builder throwing (e.g. corrupt watchlist entry, bad Situation shape) propagated out of `runAnalystCycle()` entirely — every hypothesis for that tick lost.

**Fix:** Each builder wrapped in `safe(() => fn())` returning `[]` on throw.

---

### HIGH — analyst-loop.ts:435 — Recurring cycle errors completely invisible

The `scheduleNext()` setTimeout catch was `catch { /* swallow */ }`. Persistent builder failures produced zero diagnostics in the debug ring buffer or metrics dashboard.

**Fix:** Catch now calls `incrementCounter('analyst-cycle.errors')` and `logDebug(level:'error')`.

---

### MEDIUM — 6 services (12 locations) — IDB write/read promises produce unhandled rejections

All IDB `getMemory`/`putMemory` calls used `void promise` with no `.catch()`. On IDB failure (quota exhaustion, versionchange, storage eviction), each produces an unhandled rejection. Hydration failures meant the service booted from stale localStorage without knowing.

Services: `hypothesis-threads.ts`, `hypothesis-accuracy.ts`, `hypothesis-projection.ts`, `hypothesis-ensemble.ts`, `briefing-archive.ts`, `snapshot-archive.ts`

**Fix:** `.catch(() => { /* IDB unavailable; localStorage bootstrap still valid */ })` added to all 12 call sites.

---

### MEDIUM — hypothesis-accuracy.ts:315 — `gradeDue()` in unguarded setInterval

`gradeDue()` calls `getSituations()`, `unifiedAlertStore.getAll()`, `scoreAlert()`. A throw in setInterval becomes uncaught — permanently kills the interval, silently skipping all pending hypothesis grading.

**Fix:** setInterval callback wraps `gradeDue()` in try/catch.

---

### MEDIUM — hypothesis-projection.ts:142 — `findMatchingCascadeNodeId` unguarded

Calls `getInfraNodes()` and `entitiesForHypothesis()` without a guard, one line above the already-guarded `simulateCascade`. A throw propagated as unhandled rejection to callers (e.g. AnalystHUD on user tap).

**Fix:** Wrapped in try/catch returning `null` on error.

---

### MEDIUM — llm-adapter.ts:247 — `reserveCloudCall` called outside try/catch

`reserveCloudCall` reads/writes localStorage + IDB. A quota error propagates out of `generateText()`, causing unhandled rejections in callers (`projectHypothesis`, etc.) that don't universally catch `generateText`.

**Fix:** Wrapped in try/catch; failure returns `{ text: '', provider: 'none' }`.

---

### LOW — hypothesis-notifier.ts:83 — Event listener can throw uncaught

`handleSnapshot(ce.detail)` inside `cb:analyst-hypotheses` listener. If `notificationDispatcher.dispatchNotification()` throws synchronously, error escapes to `window.onerror` and notification is silently skipped.

**Fix:** Wrapped in try/catch with console.warn.

---

### LOW — auto-brief.ts:168 — Outer catch swallows without logging

`catch { /* Swallow; next crossing retries... */ }` — unexpected throws completely invisible.

**Fix:** Catch logs `console.warn('[auto-brief] runBrief threw', error.message)`.

---

## PR 2 — `claude/error-handling-setinterval-guards`

**fix(services): wrap setInterval scanner callbacks in try/catch**

A throw in a `setInterval` callback becomes an uncaught exception and **permanently kills the interval** for the session. No diagnostic, no restart.

| File | Line | Callback | Risk |
|------|------|----------|------|
| `src/services/geofence-alerts.ts` | 45 | `scan()` | dispatchEvent listener throw |
| `src/services/silence-anomaly.ts` | 74 | `scan()` | dispatchEvent listener throw |
| `src/services/proximity-cascade.ts` | 109 | `scan()` | dispatchEvent listener throw |
| `src/services/alert-fatigue.ts` | 100 | `checkFatigue()` | localStorage + dispatchEvent |
| `src/services/periodicity-detector.ts` | 129 | `scan()` | dispatchEvent listener throw |
| `src/services/intelligence/mission-ledger-bridge.ts` | 133 | `this.poll()` | localStorage write |
| `src/services/forecast-accuracy.ts` | 127 | `logPredictions/checkPredictions` | localStorage write |
| `src/services/gps-tracker.ts` | 110 | async CoreLocation poll | Tauri IPC rejection |

**Fix:** Each callback body wrapped in try/catch (or via `safeScan` arrow function). GPS tracker's async callback additionally handles Promise rejection so the interval stays alive when CoreLocation temporarily returns null.

---

## PR 3 — `claude/error-handling-satellite-worker`

**fix(satellite): add worker onerror handler and TLE processing try/catch**

### HIGH — satellite-propagator.ts:54 — No `worker.onerror` handler

`start()` creates a Worker but never registers `worker.addEventListener('error', ...)`. When the worker crashes (malformed TLE string crashing satellite.js, structured-clone error), the error fires to `window.onerror`, position/orbit listeners receive nothing, and tracking stops permanently with no recovery.

**Fix:** Added `onerror` handler that logs the crash and schedules a 5s auto-restart using the cached `_lastCatalog`. `stop()` clears `_restartTimer` to prevent ghost restarts after deliberate teardown.

---

### MEDIUM — satellite-propagator.worker.ts:56,93,229 — TLE processing unguarded outside per-satellite loop

- `propagateAll()`: `gstime(now)` and `self.postMessage()` outside per-satellite try/catch. A satellite.js regression or structured-clone error kills the 1Hz interval.
- `computeOrbitPath()`: `twoline2satrec(req.line1, req.line2)` unguarded — bad TLE throws out of message handler.
- Message handler: no outer try/catch around the dispatch block.

**Fix:** `propagateAll()` and `computeOrbitPath()` bodies wrapped in try/catch. `computeOrbitPath` posts empty points on failure. Message handler gets outer try/catch.

---

## PR 4 — `claude/error-handling-provider-data-integrity`

**fix(providers,shortage): data integrity — NaN guards, fail-open corrections**

### HIGH — airquality-fusion-observations.ts:20 — `.getTime()` on potentially-null `updatedAt`

`openMeteoAqToObservations` called `r.updatedAt.getTime()` without null check. If Open-Meteo returns `updatedAt: null` in a partial response, the call throws `TypeError`, crashing the whole batch and aborting the data-loader tick. Note: `openaqToObservations` in the same file already had the correct null guard — this was an asymmetry bug.

**Fix:** Added `if (!r.updatedAt || isNaN(r.updatedAt.getTime())) continue;` mirroring the openaq pattern.

---

### MEDIUM — coinbase-fetch.ts:28 + stock-fetch.ts:26 — Fail-open on empty successful response

A live 200 response with all-null prices returned `{ ok: true, prices: [] }`. The provider recorded as healthy while contributing nothing to corroboration. Asymmetry with `coingecko-fetch.ts` which already had `if (prices.length === 0) return { ok: false }` with the comment "A live 200 with all-null prices is not a success."

**Fix:** Same fail-closed check added to both coinbase and stock fetchers.

---

### MEDIUM — fusion-publish.ts:52 — `ingestDomain()` unguarded, can abort data-loader refresh tick

`ingestDomain()` is pure-math but can throw on floating-point edge cases or malformed observations. An unhandled throw aborted the entire `recordDomainObservations()` call, potentially silently skipping all downstream panel updates.

**Fix:** Wrapped in try/catch; on failure, logs a warning and returns early keeping stale fingerprints.

---

### MEDIUM — shortage-score.ts:156,180 — NaN propagates through driver scoring

Two propagation paths:
1. `freshnessFor()`: `input.observedAt` is NaN → `age = Math.max(0, NaN)` = NaN → `clamp(0,1,NaN)` = NaN → confidence never downgraded (NaN comparisons are all false).
2. `buildDriver()`: `args.value` is NaN from failed parse → `toRisk(NaN)` = NaN → `Math.round(NaN)` = NaN → `clamp(0,100,NaN)` = NaN → corrupts the weighted average.

**Fix:** `freshnessFor()` returns `0` immediately if `age` is not finite. `buildDriver()` treats non-finite `args.value` as zero risk.

---

### MEDIUM — data-bridge.ts:114 — `alert.onset.getTime()` on potentially non-Date value

`alertToEvent` handled `onset` as `Date | string` but runtime JSON casts can produce numeric timestamps or undefined. The `else` branch called `.getTime()` without an `instanceof Date` guard — non-Date non-string value throws `TypeError`, crashing `alerts.map()` and leaving the insights singleton stale.

**Fix:** Added `instanceof Date` guard; non-Date non-string falls through to `Number.isFinite(at) ? at : Date.now()` default.

---

## PR 5 — `claude/error-handling-sidecar-timeouts`

**fix(sidecar): add timeouts to bare fetch calls, check HTTP status on registration routes**

### HIGH — local-api-server.mjs:2293 — `patreonTokenExchange` bare `fetch()` with no timeout

Called by `/api/patreon/refresh` and `/api/patreon/connect`. No `AbortSignal`. Node.js 22 undici socket timeout is ~5 minutes — a hung Patreon OAuth server holds the client connection for minutes.

**Fix:** Changed to `fetchWithTimeout(..., 15_000)`. The helper already existed at line 4025.

---

### MEDIUM — local-api-server.mjs:5826,5843,5861 — Three more bare `fetch()` calls with no timeout

YouTube feed, Patreon audio RSS, and Patreon verify routes. Same 5-minute undici default.

**Fix:** All three changed to `fetchWithTimeout(...)` with 12–15s timeouts.

---

### MEDIUM — local-api-server.mjs:7339,7360 — `/api/register/newsapi` + `/api/register/newsdata` — no non-2xx check

Both registration routes called `.json()` without checking `resp.ok` first. HTTP 429 (rate limit), 422 (invalid email), or 403 (quota) responses were silently parsed: `data.apiKey` was null, and the handler returned `HTTP 200 { apiKey: null }` to the caller — **a failed registration appeared to succeed with no key**. The real upstream error was discarded.

**Fix:** `if (!resp.ok) return json({ error: \`NewsAPI registration returned HTTP ${resp.status}\` }, 502)` added before `.json()` in both routes.

---

## Unfixed Low-Priority Findings

No PR created. Document for future cleanup sprint.

| File | Line | Pattern | Description |
|------|------|---------|-------------|
| `src/components/RuntimeConfigPanel.ts` | 652, 772 | no-catch | `void setSecretValue()` calls; keychain write failures give no user feedback |
| `src/components/ResourceInventoryPanel.ts` | 373–500 | no-catch | Multiple `void putItem/deleteItem/logConsumption/resupply` fire-and-forgets |
| `src/components/ResourceInventoryPanel.ts` | 57 | idb-unchecked | openDB missing `close`/`versionchange` listeners |
| `src/services/app-activity.ts` | 35 | no-catch | `void listen('tauri://focus')` with no `.catch()` |
| `src/services/sidecar-pusher.ts` | 93 | bad-retry | Payload discarded before fetch attempt; no backoff; consecutive failures not tracked |
| `src/services/insights/notification-ladder.ts` | 103 | no-catch | Safety-critical notification routing not wrapped in try/catch |
| `src/services/forecast-accuracy.ts` | 140 | no-catch | `setTimeout`-based initial call also unguarded (only setInterval was fixed) |
| `tools/cb-control/web/app.js` | 191 | ws-no-reconnect | WebSocket missing `onclose` handler + reconnect logic |
| `local-api-server.mjs` | 5288 | leaks-internals | `callChatCompletion` error includes up to 200 chars of upstream response body |
| `local-api-server.mjs` | 7150 | leaks-internals | `/api/tle` catch uses `String(error)` — exposes internals to renderer |
| `local-api-server.mjs` | 988 | ws-no-error | AIS WebSocket `onerror` is a no-op comment |

---

## What Was NOT Found (Solid Foundations)

- **IDB core layer** (`reasoning-memory.ts`, `alert-store.ts`): Correct `versionchange` handlers, error classification, and retry logic throughout.
- **Tauri bridge** (`tauri-bridge.ts`): `invokeTauri`/`tryInvokeTauri` have proper error classification and typed returns.
- **Weather service** (`nws-polygon-match.ts`, `weather-urgency.ts`): Pure deterministic — no async surface.
- **Provider health** (`provider-health.ts`, `source-fusion.ts`): Proper fail-closed semantics; disagreements surface rather than averaging away.
- **Data-loader main loop**: Existing retry logic with exponential backoff and jitter is solid.
- **Sidecar global handlers**: `process.on('uncaughtException')` and `process.on('unhandledRejection')` correctly set up.
