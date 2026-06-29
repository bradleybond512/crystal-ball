# Webcam Coverage — Phase 1 (Solidify the Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing webcam system reliable and uniform — a source-adapter health model (no silent failures), the dead `USFS` source implemented, stale catalogs auto-validated, offline-probe backoff, a maintainable YouTube registry, the globe over-filter fixed, and pinning restored for any cam — so Phase 2's breadth explosion plugs in cleanly.

**Architecture:** Source health is derived in the sidecar `/api/webcams` aggregator from its existing `Promise.allSettled` results and returned as `sourceHealth[]`; the renderer `fetcher` carries it into `WebcamCatalog`; `UnifiedWebcamPanel` renders a status strip with a missing-key CTA. New sources (USFS) and stale catalogs (volcano/stream/coastal) are validated at fetch time. Pinning is a feed-id-keyed store + a re-wired, registered panel.

**Tech Stack:** TypeScript (Vite renderer), Node.js sidecar (`local-api-server.mjs`), `node:test`/`tsx` for renderer unit tests, `node --test` for sidecar tests.

**Spec:** `docs/superpowers/specs/2026-06-28-webcam-coverage-and-streaming-design.md`

---

## File Structure

**Renderer (modify):**
- `src/services/webcams/webcam-types.ts` — add `streamType`, `WebcamSourceHealth`, `SourceStatus`; extend `WebcamCatalog`.
- `src/services/webcams/fetcher.ts` — parse `sourceHealth` from the API into the catalog.
- `src/components/UnifiedWebcamPanel.ts` — render the source-health strip + missing-key CTA; add a "Pin" action; offline-probe backoff.
- `src/services/webcams/webcam-globe-layer.ts:16` — relax the salience filter.

**Renderer (create):**
- `src/services/webcams/youtube-live-registry.ts` — the 27 (+) YouTube channels as data + a validity helper.
- `src/services/webcams/pinned-store.ts` — feed-id pin store (replaces the one removed in #1314).
- `src/components/PinnedWebcamsPanel.ts` — re-wired any-source pinboard.
- `src/services/webcams/__tests__/webcam-health.test.mts`, `pinned-store.test.mts`, `youtube-live-registry.test.mts`.

**Sidecar (modify):**
- `src-tauri/sidecar/local-api-server.mjs` — add the `USFS` subroute + `/api/webcams/usfs` handler; derive + return `sourceHealth`; validate the volcano/stream/coastal catalogs at fetch.
- `src-tauri/sidecar/__tests__/webcam-source-health.test.mjs` — health derivation.

**Config (modify):**
- `src/config/panels.ts` — register `pinned-webcams` in `FULL_PANELS` + `PANEL_CATEGORY_MAP`.
- `src/app/panel-layout.ts` — instantiate `PinnedWebcamsPanel`.
- `src/services/diagnostics/self-test-definitions.ts` (or wherever `standardSelfTestDefinitions` lives) — a webcam-sources probe.

---

## Task 1: Extend webcam types (health + streamType)

**Files:**
- Modify: `src/services/webcams/webcam-types.ts`

- [ ] **Step 1: Add the health + stream types** (append to the file)

```ts
export type SourceStatus = 'ok' | 'missing_key' | 'down' | 'rate_limited' | 'empty';

export interface WebcamSourceHealth {
  source: WebcamSource;
  status: SourceStatus;
  count: number;
  needsKey: boolean;
  error?: string;
  lastChecked: number;
}

/** Streaming kind for a feed; 'snapshot' = refreshing image (Phase 1 default). */
export type WebcamStreamType = 'hls' | 'mjpeg' | 'youtube' | 'embed' | 'snapshot';
```

- [ ] **Step 2: Extend `WebcamFeed` and `WebcamCatalog`**

In `WebcamFeed` (after `streamUrl?`):
```ts
  streamType?: WebcamStreamType;
```
In `WebcamCatalog` (after `lastUpdated`):
```ts
  sourceHealth?: WebcamSourceHealth[];
```

- [ ] **Step 3: Typecheck** — Run: `npm run typecheck:all` — Expected: 0 errors.

- [ ] **Step 4: Commit**
```bash
git add src/services/webcams/webcam-types.ts
git commit -m "feat(webcams): add source-health + stream-type to webcam types"
```

---

## Task 2: Sidecar — derive and return `sourceHealth`

The `/api/webcams` route already runs `Promise.allSettled(targets.map(...))`. Derive health per source from those results.

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (the `/api/webcams` handler, ~15859–15935)
- Test: `src-tauri/sidecar/__tests__/webcam-source-health.test.mjs`

- [ ] **Step 1: Extract a pure helper next to the route** (so it's testable). Add near the top of the `/api/webcams` block:

```js
// Pure: derive per-source health from settled subroute results.
// settled[i] corresponds to targets[i]; each fulfilled value is the feed array.
function deriveWebcamSourceHealth(targets, settled, keyedSources, now) {
  return targets.map((sub, i) => {
    const r = settled[i];
    const needsKey = keyedSources.has(sub.source);
    if (r.status === 'rejected') {
      const msg = String(r.reason?.message ?? r.reason ?? 'error');
      const status = needsKey && /401|403|missing|unauthor/i.test(msg) ? 'missing_key'
        : /429|rate/i.test(msg) ? 'rate_limited' : 'down';
      return { source: sub.source, status, count: 0, needsKey, error: msg, lastChecked: now };
    }
    const feeds = Array.isArray(r.value) ? r.value : [];
    return { source: sub.source, status: feeds.length > 0 ? 'ok' : 'empty', count: feeds.length, needsKey, lastChecked: now };
  });
}
module.exports.__deriveWebcamSourceHealth = deriveWebcamSourceHealth; // test seam (guard: only if module.exports exists)
```
> If the sidecar is ESM (no `module.exports`), instead `export` the helper or place it in a small shared file the test can import. Check the file's module system first (`grep -m1 "module.exports\|export " src-tauri/sidecar/local-api-server.mjs`).

- [ ] **Step 2: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { __deriveWebcamSourceHealth as derive } from '../local-api-server.mjs';

const targets = [
  { source: 'FAA' }, { source: 'WINDY' }, { source: 'NPS' }, { source: 'DOT511' },
];
const keyed = new Set(['WINDY', 'NPS']);

test('ok / empty / missing_key / down derived correctly', () => {
  const settled = [
    { status: 'fulfilled', value: [{ id: 'a' }, { id: 'b' }] },        // FAA → ok(2)
    { status: 'rejected', reason: new Error('Windy HTTP 401 unauthorized') }, // WINDY → missing_key
    { status: 'fulfilled', value: [] },                                // NPS → empty
    { status: 'rejected', reason: new Error('HTTP 500') },             // DOT511 → down
  ];
  const h = derive(targets, settled, keyed, 1000);
  assert.equal(h.find(x => x.source === 'FAA').status, 'ok');
  assert.equal(h.find(x => x.source === 'FAA').count, 2);
  assert.equal(h.find(x => x.source === 'WINDY').status, 'missing_key');
  assert.equal(h.find(x => x.source === 'NPS').status, 'empty');
  assert.equal(h.find(x => x.source === 'DOT511').status, 'down');
});

test('rate-limited classified', () => {
  const h = derive([{ source: 'WINDY' }], [{ status: 'rejected', reason: new Error('429 Too Many Requests') }], keyed, 1000);
  assert.equal(h[0].status, 'rate_limited');
});
```

- [ ] **Step 3: Run it (fails)** — Run: `node --test src-tauri/sidecar/__tests__/webcam-source-health.test.mjs` — Expected: FAIL (helper not exported / wrong logic).

- [ ] **Step 4: Wire the helper into the route.** After the `const results = await Promise.allSettled(...)` line, build health and add it to the response. Define the keyed set once:
```js
const KEYED_WEBCAM_SOURCES = new Set(['WINDY', 'NPS']); // extended-DOT keys handled inside dot-extended
const sourceHealth = deriveWebcamSourceHealth(targets, results, KEYED_WEBCAM_SOURCES, Math.floor(Date.now() / 1000));
```
Then change the response object from `{ feeds: allFeeds, count: allFeeds.length, updatedAt: ... }` to also include `sourceHealth`:
```js
const result = { feeds: allFeeds, count: allFeeds.length, sourceHealth, updatedAt: Math.floor(Date.now() / 1000) };
```

- [ ] **Step 5: Run the test (passes) + sidecar route tests** — `node --test src-tauri/sidecar/__tests__/webcam-source-health.test.mjs` (PASS) and `npm run test:sidecar 2>&1 | tail -3` (no new failures).

- [ ] **Step 6: Commit**
```bash
git add src-tauri/sidecar/local-api-server.mjs src-tauri/sidecar/__tests__/webcam-source-health.test.mjs
git commit -m "feat(webcams): sidecar derives + returns per-source health"
```

---

## Task 3: Implement the dead `USFS` source (validated catalog adapter)

`USFS` is in the enum but has no endpoint. Add a curated-but-validated catalog (same pattern as volcano/coastal), registered as a subroute. (Phase 2 expands it.)

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/webcams/usfs` handler + subroute entry)
- Test: extend `src-tauri/sidecar/__tests__/webcam-source-health.test.mjs` or a new `usfs-catalog.test.mjs`

- [ ] **Step 1: Add the USFS catalog + handler** near the other webcam sub-handlers. Use real USFS public fire-lookout/recreation snapshot URLs (start with a small validated set; expand in Phase 2):

```js
const USFS_CAMS = [
  // { id, name, lat, lon, snapshotUrl, category }
  { id: 'usfs-mthood-timberline', name: 'Mt Hood — Timberline (USFS)', lat: 45.331, lon: -121.711,
    snapshotUrl: 'https://www.timberlinelodge.com/snowcams/palmer.jpg', category: 'nature' },
  // ... (curated list; validated at fetch in Step 2)
];
```
> The exact USFS URLs are a feasibility item — the executing agent should source 10–20 known-public USFS/forest cams (USFS region pages, recreation.gov public cams) and put them here. The validation in Step 2 guarantees dead ones are dropped, so a partially-stale starter list is safe.

- [ ] **Step 2: The handler validates + returns feeds** (drop unreachable URLs via a short HEAD with timeout, cached):

```js
if (requestUrl.pathname === '/api/webcams/usfs') {
  const TTL = 30 * 60 * 1000;
  const cached = getCached('webcams:usfs', TTL);
  if (cached) return json(cached);
  const checked = await Promise.all(USFS_CAMS.map(async (c) => {
    try {
      const r = await fetchWithTimeout(c.snapshotUrl, { method: 'HEAD' }, 4000);
      return r.ok ? c : null;
    } catch { return null; }
  }));
  const feeds = checked.filter(Boolean).map(c => ({
    id: c.id, source: 'USFS', name: c.name, lat: c.lat, lon: c.lon,
    snapshotUrl: c.snapshotUrl, refreshIntervalSec: 300, category: c.category,
    metadata: { agency: 'USFS' }, streamType: 'snapshot',
  }));
  const result = { feeds, count: feeds.length };
  setCached('webcams:usfs', result, TTL);
  return json(result);
}
```

- [ ] **Step 3: Register the subroute.** In the `/api/webcams` `subroutes` array, add:
```js
{ source: 'USFS', path: '/api/webcams/usfs', shape: 'feeds' },
```

- [ ] **Step 4: Test the handler shape** (fixture: monkeypatch `fetchWithTimeout` to return ok/!ok and assert filtering). Add to the sidecar test file:
```js
// asserts USFS_CAMS entries with a failing HEAD are dropped; passing ones map to feeds with source 'USFS'
```

- [ ] **Step 5: Run + commit**
```bash
node --check src-tauri/sidecar/local-api-server.mjs   # parses
npm run test:sidecar 2>&1 | tail -3                    # no new failures
git add src-tauri/sidecar/local-api-server.mjs src-tauri/sidecar/__tests__
git commit -m "feat(webcams): implement USFS source (validated catalog)"
```

---

## Task 4: De-stale the volcano / stream / coastal catalogs (validate at fetch)

Apply the same HEAD-validation to the three hardcoded sidecar catalogs so rotted URLs are dropped + reported (count shrinks honestly rather than showing broken images).

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (the `/api/webcams/volcano`, `/streamgauge`, `/coastal` handlers)

- [ ] **Step 1: Extract a shared validator** (DRY) near the webcam handlers:
```js
async function validateWebcamCatalog(cams, cacheKey, ttlMs) {
  const cached = getCached(cacheKey, ttlMs);
  if (cached) return cached;
  const checked = await Promise.all(cams.map(async (c) => {
    try { const r = await fetchWithTimeout(c.snapshotUrl, { method: 'HEAD' }, 4000); return r.ok ? c : null; }
    catch { return null; }
  }));
  const feeds = checked.filter(Boolean);
  setCached(cacheKey, feeds, ttlMs);
  return feeds;
}
```

- [ ] **Step 2: Use it in the three handlers** — replace each handler's direct `feeds = CATALOG.map(...)` with `const valid = await validateWebcamCatalog(CATALOG, 'webcams:<name>', 30*60*1000);` then map `valid` to the feed shape. Reuse for the USFS handler from Task 3 (refactor Task 3 to call it).

- [ ] **Step 3: Verify** — `node --check ...` parses; `npm run test:sidecar 2>&1 | tail -3` no new failures; manual: `curl -s 127.0.0.1:46123/api/webcams/volcano | node -e "..."` returns feeds.

- [ ] **Step 4: Commit**
```bash
git add src-tauri/sidecar/local-api-server.mjs
git commit -m "feat(webcams): validate volcano/stream/coastal/USFS catalogs at fetch (drop dead URLs)"
```

---

## Task 5: Renderer fetcher carries `sourceHealth`

**Files:**
- Modify: `src/services/webcams/fetcher.ts`
- Test: `src/services/webcams/__tests__/webcam-health.test.mts`

- [ ] **Step 1: Failing test** (parse a response with sourceHealth):
```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogFromResponse } from '../fetcher.ts';

test('catalogFromResponse carries sourceHealth + builds bySource', () => {
  const cat = catalogFromResponse({
    feeds: [{ id: 'a', source: 'FAA', name: 'x', lat: 0, lon: 0, snapshotUrl: 'u', refreshIntervalSec: 300, category: 'weather', metadata: {} }],
    sourceHealth: [{ source: 'WINDY', status: 'missing_key', count: 0, needsKey: true, lastChecked: 1 }],
    updatedAt: 1000,
  });
  assert.equal(cat.feeds.length, 1);
  assert.equal(cat.sourceHealth?.[0].status, 'missing_key');
});
```

- [ ] **Step 2: Run (fails)** — `npx tsx --test src/services/webcams/__tests__/webcam-health.test.mts` — Expected: FAIL (`catalogFromResponse` not exported).

- [ ] **Step 3: Refactor fetcher** — extract the response→catalog mapping into an exported pure `catalogFromResponse(data)` and have `fetchUnifiedWebcams` call it. Include `sourceHealth: Array.isArray(data.sourceHealth) ? data.sourceHealth : undefined` in the returned catalog. Update the `data` cast to include `sourceHealth?: WebcamSourceHealth[]`.

- [ ] **Step 4: Run (passes) + typecheck** — test PASS; `npm run typecheck:all` 0 errors.

- [ ] **Step 5: Commit**
```bash
git add src/services/webcams/fetcher.ts src/services/webcams/__tests__/webcam-health.test.mts
git commit -m "feat(webcams): fetcher carries per-source health into the catalog"
```

---

## Task 6: Source-health strip + missing-key CTA in the panel

**Files:**
- Modify: `src/components/UnifiedWebcamPanel.ts` (render a strip from `this.catalog.sourceHealth`)

- [ ] **Step 1: Add a pure label helper** (testable) — create `src/services/webcams/health-view.ts`:
```ts
import type { WebcamSourceHealth } from './webcam-types';
const ENV_HINT: Partial<Record<string, string>> = { WINDY: 'WINDY_WEBCAMS_API_KEY', NPS: 'NPS_API_KEY' };
export function healthSummary(health: WebcamSourceHealth[]): { ok: number; degraded: WebcamSourceHealth[]; cta: string[] } {
  const degraded = health.filter(h => h.status !== 'ok' && h.status !== 'empty');
  const cta = health.filter(h => h.status === 'missing_key' && ENV_HINT[h.source])
    .map(h => `${h.source}: add ${ENV_HINT[h.source]} in Settings → API Keys`);
  return { ok: health.filter(h => h.status === 'ok').length, degraded, cta };
}
```

- [ ] **Step 2: Test it** — `src/services/webcams/__tests__/health-view.test.mts`: missing_key WINDY → cta includes `WINDY_WEBCAMS_API_KEY`; down source → in `degraded`; ok not in degraded.

- [ ] **Step 3: Render the strip** in `UnifiedWebcamPanel.renderPanel()` — when `this.catalog?.sourceHealth?.length`, compute `healthSummary` and render a compact line above the grid: `N sources live` + a muted list of degraded sources, and a yellow CTA banner (reuse the existing banner style) for each `cta` entry. Use `escapeHtml`.

- [ ] **Step 4: typecheck + eslint** — `npm run typecheck:all` (0); `npx eslint --quiet src/components/UnifiedWebcamPanel.ts src/services/webcams/health-view.ts` (0). If the panel trips pre-existing complexity rules, extract the strip HTML into a private `renderHealthStrip()` method.

- [ ] **Step 5: Commit**
```bash
git add src/components/UnifiedWebcamPanel.ts src/services/webcams/health-view.ts src/services/webcams/__tests__/health-view.test.mts
git commit -m "feat(webcams): show source-health strip + missing-key CTA in the panel"
```

---

## Task 7: Offline-probe exponential backoff

**Files:**
- Modify: `src/components/UnifiedWebcamPanel.ts` (the `probeVisibleFeeds` loop / `OFFLINE_REPROBE_INTERVAL_MS`)

- [ ] **Step 1: Pure backoff helper** — create `src/services/webcams/probe-backoff.ts`:
```ts
/** Next delay (ms) given consecutive failures: base*2^fails, capped, with ±20% jitter. */
export function nextProbeDelay(fails: number, baseMs = 60_000, capMs = 15 * 60_000, rand = 0.5): number {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, fails));
  return Math.round(raw * (0.8 + 0.4 * rand));
}
```

- [ ] **Step 2: Test** — `nextProbeDelay(0)` ≈ base (within jitter); grows ×2 each fail; never exceeds cap; `rand=0.5` → exactly raw.

- [ ] **Step 3: Wire it** — track a per-host failure count; when a probe round has failures, schedule the next round via `nextProbeDelay(fails)` instead of the fixed interval; reset count on success.

- [ ] **Step 4: typecheck + commit**
```bash
git add src/services/webcams/probe-backoff.ts src/services/webcams/__tests__/probe-backoff.test.mts src/components/UnifiedWebcamPanel.ts
git commit -m "feat(webcams): exponential backoff for offline probes"
```

---

## Task 8: YouTube live registry + validation

**Files:**
- Create: `src/services/webcams/youtube-live-registry.ts`
- Modify: `src/components/LiveWebcamsPanel.ts` (import the registry instead of the inline 27 IDs)

- [ ] **Step 1: Extract the registry** — move the 27 hardcoded `{ id, title, region, videoId }` entries into `youtube-live-registry.ts` as `export const YOUTUBE_LIVE_FEEDS: YoutubeLiveFeed[]` with a typed `YoutubeLiveFeed` interface + `export function feedsForRegion(region)`. Keep the exact same data.

- [ ] **Step 2: Test** — registry has the expected regions; `feedsForRegion('iran')` returns only Iran feeds; all `videoId` are non-empty 11-char strings.

- [ ] **Step 3: Point the panel at it** — `LiveWebcamsPanel` imports `YOUTUBE_LIVE_FEEDS`/`feedsForRegion`; behaviour unchanged. (Live validation of channel liveness is a Phase-2 enhancement; this task just makes the list maintainable + testable.)

- [ ] **Step 4: typecheck + commit**
```bash
git add src/services/webcams/youtube-live-registry.ts src/services/webcams/__tests__/youtube-live-registry.test.mts src/components/LiveWebcamsPanel.ts
git commit -m "feat(webcams): extract YouTube live feeds into a maintainable registry"
```

---

## Task 9: Fix the globe-layer over-filter

**Files:**
- Modify: `src/services/webcams/webcam-globe-layer.ts:16`

- [ ] **Step 1:** Replace the hardcoded `const HIGH_SALIENCE = ['fire','volcano','coastal']` filter with a configurable option defaulting to **show all categories**, and only apply a salience subset when explicitly requested (e.g. an `options.salientOnly` flag, default `false`). Confirm the layer plots all feed categories.

- [ ] **Step 2: typecheck** — `npm run typecheck:all` 0 errors.

- [ ] **Step 3: Commit**
```bash
git add src/services/webcams/webcam-globe-layer.ts
git commit -m "fix(webcams): globe layer no longer drops 66% of cams by category"
```

---

## Task 10: Restore pinning (any cam)

**Files:**
- Create: `src/services/webcams/pinned-store.ts` (feed-id keyed; NOT Windy-specific)
- Create: `src/components/PinnedWebcamsPanel.ts`
- Modify: `src/config/panels.ts` (register `pinned-webcams` + add to a `PANEL_CATEGORY_MAP` category)
- Modify: `src/app/panel-layout.ts` (instantiate)
- Modify: `src/components/UnifiedWebcamPanel.ts` (a "📌 Pin" action per cam card)

- [ ] **Step 1: pinned-store (TDD).** Test `src/services/webcams/__tests__/pinned-store.test.mts`:
```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinFeed, unpinFeed, getPinnedIds, isPinned } from '../pinned-store.ts';
// (localStorage shimmed in the test setup, as sibling tests do)
test('pin/unpin/isPinned round-trips for any feed id', () => {
  pinFeed('faa-xyz'); assert.ok(isPinned('faa-xyz'));
  assert.deepEqual(getPinnedIds().includes('faa-xyz'), true);
  unpinFeed('faa-xyz'); assert.equal(isPinned('faa-xyz'), false);
});
```

- [ ] **Step 2: Implement pinned-store** — localStorage key `crystalball-pinned-webcams`, a `string[]` of feed ids, `pinFeed/unpinFeed/togglePin/isPinned/getPinnedIds/onPinnedChange(cb)`. (Reuse the `safe-storage` util the repo uses elsewhere.)

- [ ] **Step 3: PinnedWebcamsPanel** — extends `Panel`, id `pinned-webcams`; subscribes to `onPinnedChange`; resolves pinned ids against the latest `WebcamCatalog` (passed via `update(catalog)` from data-loader, or fetched) and renders each pinned feed's `snapshotUrl` (or embed) in a grid with an unpin button + an empty state ("Pin any cam from Live Webcams").

- [ ] **Step 4: Register + instantiate** — `panels.ts`: add `'pinned-webcams': { name: 'Pinned Webcams', enabled: true, priority: 2 }` to `FULL_PANELS` and add `'pinned-webcams'` to an appropriate `PANEL_CATEGORY_MAP` category (e.g. the same category as `unified-webcams`). `panel-layout.ts`: `this.ctx.panels['pinned-webcams'] = new PinnedWebcamsPanel();` + the import.

- [ ] **Step 5: Pin action** — in `UnifiedWebcamPanel` each cam card gets a 📌 button calling `togglePin(feed.id)`; reflect pinned state.

- [ ] **Step 6: Verify** — `npm run typecheck:all` (0); pinned-store test PASS; `npx eslint --quiet` on the new files (0).

- [ ] **Step 7: Commit**
```bash
git add src/services/webcams/pinned-store.ts src/components/PinnedWebcamsPanel.ts src/config/panels.ts src/app/panel-layout.ts src/components/UnifiedWebcamPanel.ts src/services/webcams/__tests__/pinned-store.test.mts
git commit -m "feat(webcams): restore pinning for any cam (store + wired panel + pin action)"
```

---

## Task 11: Webcam-source diagnostic probe

**Files:**
- Modify: wherever `standardSelfTestDefinitions(...)` is defined (grep: `grep -rl standardSelfTestDefinitions src/services`)

- [ ] **Step 1:** Add a self-test probe `webcam-sources` that fetches `/api/webcams`, reads `sourceHealth`, and returns `pass` if ≥1 source is `ok`, `warn` if some are `missing_key`/`down`, `fail` if all down — with a message listing degraded sources. Follow the existing probe signature in that file.

- [ ] **Step 2: typecheck + commit**
```bash
git add <self-test-file>
git commit -m "feat(webcams): add webcam-source health probe to diagnostics self-test"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck:all` → 0 errors
- [ ] `npx tsx --test src/services/webcams/__tests__/*.test.mts` → all pass
- [ ] `npm run test:sidecar 2>&1 | tail -3` → no new failures
- [ ] `npm run smoke:offline` → GREEN
- [ ] Manual (app running): UnifiedWebcamPanel shows the health strip; a missing Windy key shows the CTA; USFS cams appear; pin a FAA cam → it shows in Pinned Webcams.

## Self-review notes

- **Spec coverage:** every Phase-1 deliverable maps to a task (1=types, 2=health, 3=USFS, 4=catalogs, 5/6=health surfacing, 7=backoff, 8=YouTube registry, 9=globe filter, 10=pinning, 11=diagnostic). ✓
- **Type consistency:** `WebcamSourceHealth`/`SourceStatus`/`WebcamStreamType` defined in Task 1 are used identically in Tasks 2,5,6,11. The sidecar `sourceHealth` field name matches the fetcher + panel. ✓
- **Module-system caveat** for the sidecar test seam is flagged in Task 2 Step 1 (check ESM vs CJS before adding the export).
