# Crystal Ball — Deep Bug & Logic-Error Audit
**Date:** 2026-07-17  
**Auditor:** Claude Sonnet 4.6  
**Scope:** All TypeScript source under `src/`, sidecar `src-tauri/sidecar/local-api-server.mjs`  
**Branch with fixes:** `claude/bug-audit-fixes` (see `docs/bug-audit-fixes.patch` + `docs/commit-bug-fixes.sh`)

> **Note on git locks:** The repo's `HEAD.lock` and `index.lock` are held by a host-machine process (likely a previous Claude Code session). All 17 file fixes are applied to the working tree and saved as `docs/bug-audit-fixes.patch`. Once the lock clears, run `docs/commit-bug-fixes.sh` to commit and push.

---

## Summary

| Category | Findings | Fixed in patch |
|---|---|---|
| Logic / scoring errors | 4 | ✅ 4 |
| State-machine / mutation safety | 3 | ✅ 3 |
| Race conditions | 2 | ✅ 2 |
| Null / invalid-date safety | 4 | ✅ 4 |
| Missing `.catch` / unhandled rejections | 2 files, 5 call sites | ✅ 2 |
| AbortSignal listener leak | 1 | ✅ 1 |
| Side-effect getter | 1 | ✅ 1 |
| Retry / reconnect backoff missing | 1 | ✅ 1 |
| Event listener leaks (no `removeEventListener`) | 13 locations | ⚠️ documented below |
| Unclearable `setInterval` (no stop function) | 20+ services | ⚠️ documented below |
| Race: api-gate callbacks bypass `runGuarded` | 3 call sites | ⚠️ documented below |
| IDB `putMemory` silent drop on `InvalidStateError` | 1 | ⚠️ documented below |

---

## FIXED — Scoring / Logic Errors

### BUG-01 · HIGH · `src/services/providers/source-fusion.ts:61`
**Freshness decay uses 1×TTL instead of 2×TTL**

The freshness formula `1 - age / ttl` reaches 0 at 1×TTL. Both `truth-score.ts` (line 84) and `shortage-score.ts` (line 154) explicitly document "mirrors providers/fusion.scoreFreshness" and both use `1 - age / (2 * ttl)`. A provider observation at 75% of its TTL scored 0.25 in fusion but 0.625 everywhere else — a 2.5× discrepancy for the same data.

**Fix:** `return Math.max(0, 1 - age / (2 * ttl));`

---

### BUG-02 · HIGH · `src/services/shortage/shortage-score.ts:101–108`
**Protective drivers averaged into bucket score — dilute it instead of subtracting**

`averageBucket` divides the net sum by `drivers.length` (all drivers). The module's own docstring (line 8) reads: *"protective signals subtract from risk; they don't get averaged in."* Adding a zero-scored protective driver to two risk drivers at 60 and 80 drops the bucket from 70 to ~47 with no real-world justification.

**Fix:** Average only risk drivers; protective sum subtracts from that mean.

```typescript
const riskDrivers = drivers.filter(d => d.polarity !== 'protective');
const riskMean = riskDrivers.reduce((s, d) => s + d.score, 0) / riskDrivers.length;
const protectiveSum = drivers.filter(d => d.polarity === 'protective')
  .reduce((s, d) => s + d.score, 0);
return clamp(0, 100, riskMean - protectiveSum);
```

---

### BUG-03 · MEDIUM · `src/services/llm-budget.ts:132,171–174,190–192`
**`cloud-groq` excluded from daily cap; missing from `reserveCloudCall` and `refundCloudCall`**

`getBudgetStatus` computed `cloud = state.cloudAgent + state.cloudChat` — omitting `state.cloudGroq`. `reserveCloudCall` used the same incomplete sum, so it never blocked Groq calls. `refundCloudCall` had no `cloud-groq` branch so it hit `else return` and never decremented the counter. Groq calls were tracked in `recordCall` but were effectively unbudgeted.

**Fix:** Add `+ state.cloudGroq` to both cap checks; add `else if (provider === 'cloud-groq')` branches to both functions.

---

### BUG-04 · MEDIUM · `src/services/intelligence/situation-clustering.ts:254`
**`computeTrend` uses asymmetric late window for odd-length fact arrays**

`facts.slice(half)` for an odd-N cluster gives the late window one more element than the early window. The middle element (closest to the division) always biases the late mean, producing spurious 'rising'/'falling' trend labels.

**Fix:** `const lateMean = meanSeverity(facts.slice(facts.length - half));` — symmetric windows of equal size.

---

## FIXED — State-Machine / Mutation Safety

### BUG-05 · CRITICAL · `src/services/escalation-lifecycle.ts:91` + `src/services/situation-engine.ts:372`
**`autoResolveStaleSituations` mutates engine-internal objects via type-cast bypass**

`getSituations()` returns `[...this.situations].sort(...)` — a new array but the same object references. `escalation-lifecycle` wrote `(sit as { phase: string }).phase = 'resolved'` to bypass TypeScript's readonly protection, directly mutating the engine's internal state without calling `persist()` or `notify()`. The resolved state was written to the object but never persisted to localStorage or broadcast to subscribers.

**Fix (two parts):**
1. `situation-engine.getSituations()` now returns `.map(s => ({ ...s }))` — shallow-copies each object, so callers can't reach internal state.
2. Added `SituationEngine.resolveSituation(id)` public method that mutates the internal object, calls `persist()`, and calls `notify()`.
3. `escalation-lifecycle` now calls `situationEngine.resolveSituation(sit.id)`.
4. Added `stopEscalationTracking()` export (the corresponding `startEscalationTracking` had no cleanup path).

---

### BUG-06 · MEDIUM · `src/services/anomaly-detection.ts:244–251`
**`getActiveAnomalies()` mutates `this.activeAnomalies` as a side-effect of a read**

The getter reassigned `this.activeAnomalies = this.activeAnomalies.filter(...)` every time it was called. Any two concurrent callers saw inconsistent internal state, and debug tools calling the getter twice got a silently pruned array on the second call.

**Fix:** Extracted TTL eviction to `private evictStaleAnomalies()` called from the ingest path. `getActiveAnomalies()` is now a pure read.

---

### BUG-07 · HIGH · `src/services/gps-tracker.ts:59–76`
**Check-then-act race: `_active` set only inside `await` branches**

Two concurrent callers both pass `if (this._active) return;` (synchronous). Both then `await this._tryTier1()`. The first sets `this._active = true` and returns, but a second caller already past the guard also proceeds to `_tryTier2()` then `_tryTier3()`, assigning a second `setInterval` whose ID overwrites `_pollId`. `stop()` can only clear the second interval; the first runs for the life of the page.

**Fix:** `this._active = true` immediately after the guard, before any `await`. Reset to `false` in the catch block and on total failure.

---

## FIXED — Race Conditions

### BUG-08 · HIGH · `src/services/notification-digest.ts:186–207`
**Concurrent `generateDigest()` calls clobber each other's digest entry**

`generateDigest()` is called by `setInterval` and also manually triggered. On a '5m' frequency setting, two calls can run concurrently: both read `pendingAlerts` and `loadDigests()` before either calls `saveDigests()`. The second `saveDigests()` overwrites the first, permanently losing one digest entry.

**Fix:** Module-level `generatingDigest` boolean guard with `try/finally` reset.

---

## FIXED — Null / Invalid-Date Safety

### BUG-09 · MEDIUM · `src/services/weather.ts:67–68`
**`new Date(null)` from NWS API produces silent epoch timestamps**

The NWS API returns `null` for `onset`/`expires` on some advisory-type alerts. The TypeScript interface declares them as `string` (non-nullable) via an unchecked `response.json()` cast, but the runtime value is `null`. `new Date(null)` = epoch (1970-01-01T00:00:00Z), silently producing wrong urgency scores and false-negative "why didn't I get warned?" diagnoses.

**Fix:** `onset: alert.properties.onset ? new Date(alert.properties.onset) : new Date()`

Same fix applied to `src/services/red-flag-warnings.ts:79–80`.

---

### BUG-10 · LOW-MEDIUM · `src/services/gdacs.ts:76,91`
**`undefined-undefined` dedup keys and Invalid Date from optional GDACS properties**

GDACS GeoJSON has inconsistent property presence. Without guards:
- `eventtype` or `eventid` missing → key becomes `"undefined-undefined"` → all such events silently deduplicate to one
- `fromdate` missing → `new Date(undefined)` = Invalid Date → sorting and display break

**Fix:** `eventtype ?? 'unk'`, `eventid ?? '0'`, and `fromdate ? new Date(fromdate) : new Date()`.

---

### BUG-11 · MEDIUM · `src/services/survival/storm-posture-adapter.ts:74–75`
**MultiPolygon guard checks only `coords[0][0]` but iterates all polygons with `!`-assertion**

`if (Array.isArray(coords?.[0]?.[0]))` validates only the first polygon's first ring. `coords.map((poly) => poly[0]!.map(...))` then iterates ALL polygons with `!`-assertion. A second polygon with a missing outer ring (observed in some coastal NWS alerts) throws `"Cannot read properties of undefined (reading 'map')"`.

**Fix:** Use `(poly[0] ?? []).map(...)` for each ring and `.filter(ring => ring.length > 0)` to drop empty rings.

---

## FIXED — Missing `.catch` / Unhandled Rejections

### BUG-12 · HIGH · `src/components/SmsSettingsPanel.ts:266,276,284`
Three `void this.saveConfig({...}).then(() => this.renderPanel())` calls with no `.catch()`. `saveConfig()` calls `fetch()` directly with no try/catch; a sidecar-down condition causes an unhandled rejection and the UI silently desynchronises from the saved state. The enabled checkbox is never reverted.

**Fix:** Added `.catch()` to all three; the toggle handler reverts the checkbox on failure.

---

### BUG-13 · HIGH · `src/components/ResourceInventoryPanel.ts:421–423,473`
`void putItem(item).then(...)` and `void deleteItem(id).then(...)` with no `.catch()`. IDB errors (quota, version mismatch, `versionchange` race) cause unhandled rejections; the edit form stays permanently locked in edit mode and deleted items remain visible with no error feedback.

**Fix:** Added `.catch()` to both call sites.

---

## FIXED — AbortSignal Listener Leak

### BUG-14 · MEDIUM · `src/services/llm-adapter.ts:333–340`
**`combineSignals` leaks listeners on every successful LLM call**

`{ once: true }` only removes a listener when that specific signal fires. When neither fires (normal success), both listeners remain on `a` and `b` indefinitely. If `options.signal` is a long-lived HUD abort controller, each LLM call permanently adds a listener to it.

**Fix:** Use `AbortSignal.any([a, b])` (available since Node 20 / Chrome 116) which handles cleanup internally. Fallback for older runtimes explicitly calls `removeEventListener` inside the `forward` closure.

---

## FIXED — Retry / Reconnect

### BUG-15 · HIGH · `src-tauri/sidecar/local-api-server.mjs:853,978–986`
**AIS WebSocket reconnect has no backoff and no retry cap**

`socket.onclose` scheduled `setTimeout(() => aisConnect(currentKey), 5_000)` unconditionally — fixed 5-second delay, unlimited retries. If the AISstream server is down or the API key is revoked, the sidecar hammers the endpoint every 5 seconds forever.

**Fix:** Added `reconnectAttempts` counter to `aisState`, reset on `socket.onopen`. On close, delay = `min(5000 × 2^attempts, 300000)` — caps at 5 minutes.

---

## NOT FIXED — Documented for Follow-up

### EVT-01 · HIGH · `src/app/event-handlers.ts` — `EventHandlerManager.destroy()` missing 6 listeners
`destroy()` removes `boundKeydownHandler`, `boundVisibilityHandler`, `boundResizeHandler`, etc. — but leaves 6 anonymous handlers permanently attached:
- TV mode `keydown` (line 116) — fires on every keydown for the app's lifetime
- `window.storage` (line 229) — fires on every localStorage change from any tab
- `focal-points-ready` + `theme-changed` (lines 322–329)
- Download dropdown `click` + `keydown` (lines 698–706)
- Map resize `blur` + anonymous `visibilitychange` (lines 1042–1045)
- `IntersectionObserver` in `setupPanelViewTracking()` (line 950) — never `.disconnect()`'d, holds references to all panel DOM nodes

**Recommended fix:** Introduce class fields for each anonymous handler; call `removeEventListener` on all of them in `destroy()`. Or add an `AbortController` whose signal is passed as the `{ signal }` option to all `addEventListener` calls — abort the controller in `destroy()`.

---

### EVT-02 · HIGH · `src/services/sidecar-pusher.ts` + `src/services/hypothesis-notifier.ts`
Both register `document.addEventListener` calls with anonymous closures in their `start*()` functions and have no corresponding `stop*()` counterpart. Listeners cannot be removed.

---

### EVT-03 · MEDIUM · Systemic unclearable `setInterval` across 20+ service files
The following services call `window.setInterval(fn, ms)` without storing the return value and without exporting a stop function:
`alert-fatigue.ts`, `alert-lifecycle.ts`, `intel-channels-bridge.ts`, `compound-alert-bridge.ts`, `geofence-alerts.ts`, `blackout-signature.ts`, `forecast-accuracy.ts`, `offline-staleness.ts`, `escalation-lifecycle.ts`, `proximity-cascade.ts`, `anomaly-baselines.ts`, `pattern-memory.ts`, `periodicity-detector.ts`, `severity-recalibration.ts`, `silence-anomaly.ts`, `silence-detector.ts`, `sidebar-heat.ts`, `threat-corridor.ts`, `watchlist-proximity.ts`, `military-flights.ts`, `military-vessels.ts`.

**Recommended fix:** Add an ESLint rule (`no-floating-setinterval`) that requires the return value of `setInterval` to be assigned. Each service needs a `stop*()` function that calls `clearInterval`. This is also what prevents clean unit test isolation.

---

### RACE-01 · HIGH · `src/app/data-loader.ts:1289,1292,3097,3346`
**API gate callbacks bypass `runGuarded` inFlight protection**

`showApiKeyGate(panel, 'FINNHUB_API_KEY', () => { void this.loadMarkets(); })` is registered twice (markets panel + heatmap panel). When the user saves a Finnhub key, both callbacks fire simultaneously, launching two unguarded `loadMarkets()` calls that race against each other. Same pattern for `FRED_API_KEY` → `loadFredData()` and `NASA_FIRMS_API_KEY` → `loadFirmsData()`.

**Recommended fix:** Gate callbacks should check and set `inFlight` themselves, or register a single callback per key.

---

### RACE-02 · MEDIUM · `src/services/reasoning-memory.ts:140–161`
**`putMemory()` silently drops writes on `InvalidStateError`**

When another tab opens the shared `crystalball_db` at a higher version, the `versionchange` event closes the current connection. Any in-flight `putMemory()` call that already resolved `openDB()` now holds a closed handle. The subsequent `db.transaction(...)` throws `InvalidStateError`, which the catch block logs and swallows — the write is permanently lost with no retry.

**Recommended fix:** Add a one-shot retry on `InvalidStateError` that calls `dbInstance = null` and re-runs `putMemory()`.

---

### RACE-03 · MEDIUM · `src/services/llm-budget.ts:71–88`
**Stale IDB hydrate can revert budget counter across rapid reloads**

`save()` writes synchronously to localStorage and asynchronously to IDB. If the app reloads within the IDB write window, the new session's `load()` reads the correct counter from localStorage, but the IDB hydrate completes with the pre-save value. If no write has happened in the new session yet (`writtenSinceLoad === false`), the IDB data overwrites the in-memory counter, effectively refunding cloud calls that were already charged.

**Recommended fix:** In the IDB hydrate callback, apply counts using `Math.max(current, loaded)` rather than replacing — treat IDB as a high-water mark.

---

### RACE-04 · CRITICAL · `src/services/gps-tracker.ts:184–243` — `stop()` during `_tryTier3` retry
If `stop()` is called while `_tryTier3()` is in its 4-attempt retry loop (between `await`s), `_active` is set to `false` and `_pollId` cleared (but `_pollId` is `null` at that point). When `_tryTier3()` eventually succeeds, it assigns `this._pollId = setInterval(...)` with `_active = false`. `stop()` will never be called again; the interval fires indefinitely.

**Recommended fix:** Check `if (!this._active) return false` after each `await` inside `_tryTier3()`.

---

## Files Changed in Patch

| File | Bug fixed |
|---|---|
| `src/services/providers/source-fusion.ts` | BUG-01 |
| `src/services/shortage/shortage-score.ts` | BUG-02 |
| `src/services/llm-budget.ts` | BUG-03 |
| `src/services/intelligence/situation-clustering.ts` | BUG-04 |
| `src/services/situation-engine.ts` | BUG-05 |
| `src/services/escalation-lifecycle.ts` | BUG-05 |
| `src/services/anomaly-detection.ts` | BUG-06 |
| `src/services/gps-tracker.ts` | BUG-07 |
| `src/services/notification-digest.ts` | BUG-08 |
| `src/services/weather.ts` | BUG-09 |
| `src/services/red-flag-warnings.ts` | BUG-09 |
| `src/services/gdacs.ts` | BUG-10 |
| `src/services/survival/storm-posture-adapter.ts` | BUG-11 |
| `src/components/SmsSettingsPanel.ts` | BUG-12 |
| `src/components/ResourceInventoryPanel.ts` | BUG-13 |
| `src/services/llm-adapter.ts` | BUG-14 |
| `src-tauri/sidecar/local-api-server.mjs` | BUG-15 |

## To Land the PR

```bash
# From the repo root, once all git lock files are cleared:
bash docs/commit-bug-fixes.sh
```

This creates/resets `claude/bug-audit-fixes` from `origin/main`, applies the patch, commits with the full message, and pushes. Open a PR from that branch.
