# Storm Posture UI Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the survival engine **visible and usable** — a `StormPosturePanel` that renders live survival posture (physical-safety axis from real NWS alerts near saved places), the incoming threat (what/why/when/confidence), recommended moves with modeled effect + a Commit button, and a grid-down/data-age banner — backed by IDB-persisted snapshots so it works offline.

**Architecture:** A new data path wires live alerts + saved places into the existing pure `src/services/survival/` engine (`buildSnapshot` → `computePosture`/`availableMoves`/`applyPlanToPosture`/`projectView`). A pure adapter normalizes live alerts (polygon geometry *or* centroid fallback) into `NwsAlertMinimal`; an IDB `snapshot-store` persists the `WorldSnapshot`; a `storm-posture-state` singleton orchestrates fetch→build→persist→notify; `StormPosturePanel` renders it, mirroring `ShortageRadarPanel`.

**Tech Stack:** TypeScript, the `Panel` base class, `node:test`+`tsx` for the pure adapter, IndexedDB (`crystalball_db`), Vite preview for visual verification.

---

## Context the implementer needs (verified against the codebase)

- **Engine (already on main, pure):** `src/services/survival/` exports `buildSnapshot(inputs,{now})`, `computePosture`, `availableMoves(posture,snapshot,{now})`, `commitMove(plan,move,now)`, `applyPlanToPosture(posture,plan,moves)`, `projectView(snapshot,{now})`. `WorldSnapshot.posture` already reflects committed plan mitigation. Types in `survival-types.ts`. `buildSnapshot` `SnapshotInputs = { weatherAlerts: NwsAlertMinimal[], savedPlaces: weather.SavedPlace[], weatherFetchedAtMs, plan? }`.
- **Weather types** (`src/services/weather/weather-threat-types.ts`): `NwsAlertMinimal = { id, event, polygon?: AlertPolygon, sent: ISO, expires: ISO, messageType?, severity?: 'minor'|'moderate'|'severe'|'extreme'|'unknown', references?, ugcZones?, headline? }`; `AlertPolygon = { rings: readonly Coord[][] }`; `Coord = readonly [number, number]` (`[lon, lat]`); weather `SavedPlace = { id, label, lat, lon, radiusKm?, ugcZones? }`.
- **Live alert source:** `fetchNWSAlerts(): Promise<NWSAlert[]>` in `src/services/nws-alerts.ts`. `NWSAlert = { id, event, headline, description, severity: 'Extreme'|'Severe'|'Moderate'|'Minor'|'Unknown', urgency, areaDesc, onset, expires, status, centroid: [lon,lat]|null }`. The sidecar `/api/nws-alerts` response also carries `geometry` (GeoJSON Polygon/MultiPolygon) per `local-api-server.mjs:8484`; the adapter accepts an optional `geometry` field so it uses real polygons when present and a synthetic circle around `centroid` otherwise.
- **Saved places:** `getSavedPlaces(): SavedPlace[]` and `subscribeSavedPlaces(cb)` in `src/services/saved-places.ts`. App `SavedPlace = { id, name, lat, lon, radiusKm, ... }`.
- **Panel base** (`src/components/Panel.ts`): subclass `extends Panel`, `super({id,title,showCount?,trackActivity?,infoTooltip?})`; use `this.setContent(html)`, `this.setCount(n)`, `this.markFresh()`; override `destroy()` (clear timers, call `super.destroy()`). Mirror `ShortageRadarPanel` structure (refresh timer, `buildHtml`, event delegation via `document.addEventListener('click', this.onClick)`).
- **Registration:** add `'storm-posture': { name: 'Storm Posture', enabled: true, priority: 1 }` to `FULL_PANELS` in `src/config/panels.ts`; import + `this.ctx.panels['storm-posture'] = new StormPosturePanel();` in `src/app/panel-layout.ts` (next to `command-center`/`shortage-radar`).
- **IDB pattern:** mirror `src/services/reasoning-memory.ts` (`crystalball_db`, probe→upgrade-only-if-store-missing, attach `versionchange`/`close` handlers, swallow errors).
- **Styling:** add `[data-panel-id="storm-posture"]` to the macOS-native panel selector list in `src/styles/macos-native.css`.
- **HTML safety:** escape all dynamic strings (use the same `escapeHtml` helper `ShortageRadarPanel` imports).

## Invariants

- The pure adapter is deterministic, no DOM/fetch, fixture-tested (`now` injected).
- `storm-posture-state` + `snapshot-store` are the only impure modules (fetch + IDB), and must never throw into the panel — degrade to last snapshot.
- Every rendered score shows its "why" (the engine already carries `ConfidenceBreakdown` + `AlgorithmExplanation`); the panel renders the threat `why`, confidence, arrival, and the move's modeled effect.

---

## Task 1: Pure live-alert adapter — `storm-posture-adapter.ts`

**Files:** Create `src/services/survival/storm-posture-adapter.ts`; Test `src/services/survival/__tests__/storm-posture-adapter.test.mts`.

- [ ] **Step 1: Failing test**

```ts
// src/services/survival/__tests__/storm-posture-adapter.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptLiveAlert, adaptSavedPlace, type LiveAlertInput } from '../storm-posture-adapter.ts';

const HOME = { id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

test('adaptSavedPlace maps app place -> weather place (name->label)', () => {
  const p = adaptSavedPlace(HOME);
  assert.equal(p.id, 'home');
  assert.equal(p.label, 'Home');
  assert.equal(p.lat, 41.6);
  assert.equal(p.radiusKm, 25);
});

test('adaptLiveAlert uses GeoJSON Polygon geometry when present', () => {
  const raw: LiveAlertInput = {
    id: 'a1', event: 'Tornado Warning', severity: 'Extreme',
    onset: '2026-06-14T10:00:00Z', expires: '2026-06-14T11:00:00Z',
    geometry: { type: 'Polygon', coordinates: [[[-87, 41], [-86, 41], [-86, 42], [-87, 42], [-87, 41]]] },
    centroid: [-86.5, 41.5],
  };
  const m = adaptLiveAlert(raw);
  assert.equal(m.id, 'a1');
  assert.equal(m.event, 'Tornado Warning');
  assert.equal(m.severity, 'extreme');
  assert.equal(m.sent, '2026-06-14T10:00:00Z');
  assert.ok(m.polygon && m.polygon.rings.length === 1);
  assert.equal(m.polygon!.rings[0]!.length, 5);
});

test('adaptLiveAlert synthesizes a circle around centroid when geometry is absent', () => {
  const raw: LiveAlertInput = {
    id: 'a2', event: 'Severe Thunderstorm Warning', severity: 'Severe',
    onset: '2026-06-14T10:00:00Z', expires: '2026-06-14T11:00:00Z',
    centroid: [-86.7, 41.6],
  };
  const m = adaptLiveAlert(raw);
  assert.ok(m.polygon && m.polygon.rings[0]!.length >= 8, 'synthetic ring has several points');
  // The synthesized polygon contains its own centroid point neighborhood:
  const lons = m.polygon!.rings[0]!.map((c) => c[0]);
  assert.ok(Math.min(...lons) < -86.7 && Math.max(...lons) > -86.7);
});

test('adaptLiveAlert with neither geometry nor centroid -> no polygon (no_match downstream)', () => {
  const m = adaptLiveAlert({ id: 'a3', event: 'Flood Watch', severity: 'Minor', onset: 'x', expires: 'y' });
  assert.equal(m.polygon, undefined);
});
```

- [ ] **Step 2: Run, verify fail.** `npx tsx --test src/services/survival/__tests__/storm-posture-adapter.test.mts` → module-not-found.

- [ ] **Step 3: Implement**

```ts
// src/services/survival/storm-posture-adapter.ts
import type { AlertPolygon, Coord, NwsAlertMinimal, SavedPlace, WeatherSeverity } from '../weather/weather-threat-types.ts';

export interface AppSavedPlaceLike {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm?: number;
  ugcZones?: string[];
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface LiveAlertInput {
  id: string;
  event: string;
  severity?: string;
  onset: string;
  expires: string;
  headline?: string;
  centroid?: [number, number] | null;
  geometry?: GeoJsonGeometry | null;
}

const SYNTHETIC_RADIUS_KM = 20;
const SYNTHETIC_POINTS = 12;

export function adaptSavedPlace(p: AppSavedPlaceLike): SavedPlace {
  return { id: p.id, label: p.name, lat: p.lat, lon: p.lon, radiusKm: p.radiusKm, ugcZones: p.ugcZones };
}

function normalizeSeverity(raw: string | undefined): WeatherSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'extreme': return 'extreme';
    case 'severe': return 'severe';
    case 'moderate': return 'moderate';
    case 'minor': return 'minor';
    default: return 'unknown';
  }
}

function ringFromGeometry(geom: GeoJsonGeometry | null | undefined): Coord[][] | null {
  if (!geom) return null;
  const coords = geom.coordinates as number[][][] | number[][][][];
  if (geom.type === 'Polygon' && Array.isArray(coords?.[0])) {
    return [(coords as number[][][])[0]!.map((c) => [c[0]!, c[1]!] as Coord)];
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(coords?.[0]?.[0])) {
    return (coords as number[][][][]).map((poly) => poly[0]!.map((c) => [c[0]!, c[1]!] as Coord));
  }
  return null;
}

function syntheticCircle(centroid: [number, number], radiusKm: number): Coord[][] {
  const [lon, lat] = centroid;
  const latDeg = radiusKm / 111;
  const lonDeg = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const ring: Coord[] = [];
  for (let i = 0; i < SYNTHETIC_POINTS; i++) {
    const a = (2 * Math.PI * i) / SYNTHETIC_POINTS;
    ring.push([lon + lonDeg * Math.cos(a), lat + latDeg * Math.sin(a)]);
  }
  ring.push(ring[0]!);
  return [ring];
}

export function adaptLiveAlert(raw: LiveAlertInput): NwsAlertMinimal {
  const geomRings = ringFromGeometry(raw.geometry);
  const rings = geomRings ?? (raw.centroid ? syntheticCircle(raw.centroid, SYNTHETIC_RADIUS_KM) : null);
  const polygon: AlertPolygon | undefined = rings ? { rings } : undefined;
  return {
    id: raw.id,
    event: raw.event,
    polygon,
    sent: raw.onset,
    expires: raw.expires,
    severity: normalizeSeverity(raw.severity),
    headline: raw.headline,
  };
}
```

- [ ] **Step 4: Run, verify pass** (4 tests). **Step 5: Commit** `feat(survival): live-alert + saved-place adapters for storm posture`.

---

## Task 2: IDB snapshot persistence — `snapshot-store.ts`

**Files:** Create `src/services/survival/snapshot-store.ts`. (No unit test — IDB-bound; verified via the panel + a Step-4 smoke note. Mirror `reasoning-memory.ts` exactly.)

- [ ] **Step 1: Implement** (copy the open/upgrade/close pattern from `src/services/reasoning-memory.ts`; store name `survival_snapshots`, keyPath `id` with a single fixed key `'latest'`):

```ts
// src/services/survival/snapshot-store.ts
import type { WorldSnapshot } from './survival-types.ts';

const DB_NAME = 'crystalball_db';
const STORE = 'survival_snapshots';
const KEY = 'latest';

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

function attach(db: IDBDatabase): void {
  db.addEventListener('close', () => { dbInstance = null; });
  db.addEventListener('versionchange', () => { db.close(); dbInstance = null; });
}

function upgrade(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version + 1);
    req.addEventListener('upgradeneeded', () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    });
    req.addEventListener('success', () => { dbInstance = req.result; attach(req.result); resolve(req.result); });
    req.addEventListener('error', () => reject(req.error ?? new Error('upgrade failed')));
  });
}

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (openPromise) return openPromise;
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const probe = indexedDB.open(DB_NAME);
    probe.addEventListener('success', () => {
      const db = probe.result;
      if (db.objectStoreNames.contains(STORE)) { dbInstance = db; attach(db); resolve(db); return; }
      const v = db.version; db.close(); upgrade(v).then(resolve, reject);
    });
    probe.addEventListener('error', () => reject(probe.error ?? new Error('probe failed')));
  });
  openPromise.finally(() => { openPromise = null; }).catch(() => {});
  return openPromise;
}

export async function saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: KEY, snapshot, updatedAt: snapshot.capturedAtMs });
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => reject(tx.error ?? new Error('put failed')));
    });
  } catch (error) { console.warn(`[snapshot-store] save failed: ${String(error)}`); }
}

export async function loadLatestSnapshot(): Promise<WorldSnapshot | null> {
  try {
    const db = await openDB();
    return await new Promise<WorldSnapshot | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.addEventListener('success', () => resolve((req.result?.snapshot as WorldSnapshot) ?? null));
      req.addEventListener('error', () => resolve(null));
    });
  } catch (error) { console.warn(`[snapshot-store] load failed: ${String(error)}`); return null; }
}
```

- [ ] **Step 2: Typecheck** `npm run typecheck:all` → 0 errors. **Step 3: Commit** `feat(survival): IDB snapshot-store for grid-down persistence`.

---

## Task 3: Orchestration singleton — `storm-posture-state.ts`

**Files:** Create `src/services/survival/storm-posture-state.ts`. (Impure: fetch + IDB + subscribers. No unit test; verified via panel/preview.)

- [ ] **Step 1: Implement**

```ts
// src/services/survival/storm-posture-state.ts
import { fetchNWSAlerts } from '../nws-alerts.ts';
import { getSavedPlaces } from '../saved-places.ts';
import { buildSnapshot } from './world-snapshot.ts';
import { availableMoves } from './survival-moves.ts';
import { commitMove } from './survival-plan.ts';
import { adaptLiveAlert, adaptSavedPlace, type LiveAlertInput } from './storm-posture-adapter.ts';
import { saveSnapshot, loadLatestSnapshot } from './snapshot-store.ts';
import type { SurvivalMove, WorldSnapshot } from './survival-types.ts';

let current: WorldSnapshot | null = null;
const listeners = new Set<() => void>();

function notify(): void { for (const l of listeners) { try { l(); } catch { /* isolate */ } } }

export function getStormSnapshot(): WorldSnapshot | null { return current; }

export function subscribeStormPosture(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function hydrateStormPosture(): Promise<void> {
  if (current) return;
  const saved = await loadLatestSnapshot();
  if (saved && !current) { current = saved; notify(); }
}

export async function refreshStormPosture(now = Date.now()): Promise<void> {
  try {
    const [rawAlerts, appPlaces] = await Promise.all([fetchNWSAlerts(), Promise.resolve(getSavedPlaces())]);
    const alerts = (rawAlerts as unknown as LiveAlertInput[]).map(adaptLiveAlert);
    const places = appPlaces.map(adaptSavedPlace);
    const plan = current?.plan;
    const snap = buildSnapshot({ weatherAlerts: alerts, savedPlaces: places, weatherFetchedAtMs: now, plan }, { now });
    current = snap;
    notify();
    void saveSnapshot(snap);
  } catch (error) {
    console.warn(`[storm-posture] refresh failed, keeping last snapshot: ${String(error)}`);
  }
}

export function commitStormMove(move: SurvivalMove, now = Date.now()): void {
  if (!current) return;
  const plan = commitMove(current.plan, move, now);
  const moves = availableMoves(current.posture, current, { now });
  // Re-derive posture with the new plan by re-building from the same inputs.
  current = { ...current, plan, posture: applyMovesToCurrent(current, plan, moves) };
  notify();
  void saveSnapshot(current);
}

import { applyPlanToPosture } from './survival-plan.ts';
function applyMovesToCurrent(snap: WorldSnapshot, plan: WorldSnapshot['plan'], moves: readonly SurvivalMove[]) {
  return applyPlanToPosture(snap.posture, plan, moves);
}
```

- [ ] **Step 2: Typecheck** → 0 errors. **Step 3: Commit** `feat(survival): storm-posture state singleton (fetch->build->persist->notify)`.

---

## Task 4: The panel — `StormPosturePanel.ts`

**Files:** Create `src/components/StormPosturePanel.ts`. Mirror `ShortageRadarPanel` structure. (Verified via preview, Task 6.)

- [ ] **Step 1: Implement** a `Panel` subclass that:
  - constructs `super({ id: 'storm-posture', title: 'Storm Posture', showCount: true, trackActivity: true, infoTooltip: 'Your survival posture from severe-weather threats near your saved places.' })`, then `subscribeStormPosture(() => this.render())`, calls `void hydrateStormPosture().then(()=>this.render())` and `void refreshStormPosture()`, and starts a refresh timer (`setInterval(()=>void refreshStormPosture(), 120_000)`).
  - `render()` reads `getStormSnapshot()`; if null, `showLoading('Reading your survival posture…')`; else `projectView(snap)` + builds HTML.
  - `buildHtml(view)` renders, in order: a **grid-down banner** when `view.isStale` (`⚠ Data is N min old — showing last known posture`); the **overall posture** (band + headline, colored by band); the **physical-safety axis** card with its level/band + each threat (`hazardLabel`, `why`, `arrivalLabel ?? 'arrival unknown'`, `confidenceLabel`); the **recommended moves** from `availableMoves(snap.posture, snap)` — each a row with label, cost, lead-time, its `effect[0].deltaLevel` ("−25 physical safety"), and a `data-storm-move="<id>"` **Commit** button; show committed moves' status from `snap.plan`.
  - `setCount(physicalSafety.threats.length)`.
  - Click delegation: `document.addEventListener('click', this.onCommitClick)` where `onCommitClick` resolves `[data-storm-move]`, finds the move in `availableMoves(...)`, calls `commitStormMove(move)`.
  - `destroy()`: clear timer, `document.removeEventListener`, unsubscribe, `super.destroy()`.
  - Escape every dynamic string with the shared `escapeHtml`.
  - Band→color: secure `#34c759`, guarded `#a7c957`, elevated `#ffd60a`, high `#ff9f0a`, critical `#ff453a`.

- [ ] **Step 2: Typecheck** → 0 errors. **Step 3: Commit** `feat(ui): StormPosturePanel renders live survival posture + moves`.

---

## Task 5: Register + style + tick

**Files:** Modify `src/config/panels.ts`, `src/app/panel-layout.ts`, `src/styles/macos-native.css`, and (refresh tick) `src/app/data-loader.ts`.

- [ ] **Step 1:** Add `'storm-posture': { name: 'Storm Posture', enabled: true, priority: 1 }` to `FULL_PANELS` in `panels.ts` (and the category map if entries there are required — mirror `shortage-radar`).
- [ ] **Step 2:** In `panel-layout.ts`: `import { StormPosturePanel } from '@/components/StormPosturePanel';` and `this.ctx.panels['storm-posture'] = new StormPosturePanel();` next to the `shortage-radar` instantiation.
- [ ] **Step 3:** In `macos-native.css`, add `body.is-desktop-macos .panel[data-panel-id="storm-posture"]` to the existing new-panel selector list (same block as `shortage-radar`).
- [ ] **Step 4:** Find where weather refreshes in `src/app/data-loader.ts` and add a `void refreshStormPosture()` call there (so posture updates on the weather tick), importing from `@/services/survival/storm-posture-state`.
- [ ] **Step 5: Typecheck** → 0 errors. **Step 6: Commit** `feat(ui): register + style Storm Posture panel, wire refresh tick`.

---

## Task 6: Verify in the browser + full suite

- [ ] **Step 1:** `npm run test:survival` (engine still green) + the new adapter test pass; `npm run typecheck:all` → 0 errors.
- [ ] **Step 2:** Start the dev server (`npm run dev`) via the preview tooling, open the Storm Posture panel, and confirm it renders (posture card + moves + grid-down banner). Capture a screenshot. Check the console for errors. If no live alerts are near the saved place, the panel should honestly show "secure — no active threats near your places" (not an error).
- [ ] **Step 3:** Commit any fixes from preview. Final commit if needed.

---

## Self-Review (author)

- **Data path covered:** live alerts (geometry or centroid) → `adaptLiveAlert` → `NwsAlertMinimal` → `buildSnapshot`; saved places → `adaptSavedPlace`. The "always secure" failure mode is prevented by the centroid-circle fallback (Task 1 test 3).
- **Grid-down:** `snapshot-store` persists; `hydrateStormPosture` restores last snapshot on boot; `projectView` surfaces staleness. Panel shows the banner.
- **No placeholders:** adapter + store + state have full code; the panel/registration steps reference exact files, the `ShortageRadarPanel` pattern to mirror, and exact strings/colors/selectors.
- **Type consistency:** `LiveAlertInput`, `adaptLiveAlert`, `adaptSavedPlace`, `getStormSnapshot`, `refreshStormPosture`, `commitStormMove`, `subscribeStormPosture`, `hydrateStormPosture` used consistently across Tasks 1/3/4.
- **Deferred:** the God's Vision board overlay (E4) and richer multi-axis rendering (post-E3) are out of scope; this slice surfaces the physical-safety axis (the only one the engine computes today) honestly.
