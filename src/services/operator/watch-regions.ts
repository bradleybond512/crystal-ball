/**
 * Operator watch regions — pinned lat/lon bounding boxes that decorate
 * matching alerts/situations with a `WATCHED` badge.
 *
 * Persistence: localStorage `wm-operator-watch-regions`.
 * Pure helpers (parse, list, add, remove, overlap) are exposed so tests
 * can pin behaviour without touching the DOM. The persistence path uses
 * an injectable Storage so tests can pass a Map-backed stub.
 */

export interface WatchRegion {
  id: string;
  label: string;
  /** Bounding box: south latitude < north, west longitude < east. */
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** ms-since-epoch when the region was first added. */
  createdAt: number;
}

export interface WatchRegionInput {
  label: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const STORAGE_KEY = 'wm-operator-watch-regions';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Parse a stored payload into a typed array. Returns [] for any malformed
 * input — operator mode must not break on a corrupt localStorage row.
 */
export function parseWatchRegions(raw: string | null): WatchRegion[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: WatchRegion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    if (typeof r.minLat !== 'number' || typeof r.maxLat !== 'number') continue;
    if (typeof r.minLon !== 'number' || typeof r.maxLon !== 'number') continue;
    if (typeof r.createdAt !== 'number') continue;
    out.push({
      id: r.id, label: r.label,
      minLat: r.minLat, maxLat: r.maxLat,
      minLon: r.minLon, maxLon: r.maxLon,
      createdAt: r.createdAt,
    });
  }
  return out;
}

/**
 * Validate + normalize a region input so south/west are always the smaller
 * value. Throws on NaN, out-of-range, or zero-area boxes — these are bugs
 * in the caller, not data conditions the panel should silently accept.
 */
export function normalizeRegion(input: WatchRegionInput, now: number, id: string): WatchRegion {
  const label = input.label.trim();
  if (!label) throw new Error('watch-region: label required');
  const minLat = Math.min(input.minLat, input.maxLat);
  const maxLat = Math.max(input.minLat, input.maxLat);
  const minLon = Math.min(input.minLon, input.maxLon);
  const maxLon = Math.max(input.minLon, input.maxLon);
  if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLon)) {
    throw new TypeError('watch-region: coordinates must be finite');
  }
  if (minLat < -90 || maxLat > 90) throw new Error('watch-region: latitude out of range');
  if (minLon < -180 || maxLon > 180) throw new Error('watch-region: longitude out of range');
  if (minLat === maxLat || minLon === maxLon) throw new Error('watch-region: zero-area box');
  return { id, label, minLat, maxLat, minLon, maxLon, createdAt: now };
}

/**
 * Point-in-bbox check. `lat`/`lon` in degrees. No haversine needed for a
 * containment test — the bbox is in degree-space and we compare directly.
 * Returns true when the point is inside the box (inclusive on the edges).
 */
export function regionContainsPoint(region: WatchRegion, lat: number, lon: number): boolean {
  return lat >= region.minLat && lat <= region.maxLat
      && lon >= region.minLon && lon <= region.maxLon;
}

/**
 * Find the first region (if any) that contains the given point. Used to
 * stamp a `WATCHED` badge on alerts/situations. Returns undefined when
 * nothing matches — callers should treat that as "no badge".
 */
export function regionFor(point: { lat: number; lon: number } | undefined, regions: readonly WatchRegion[]): WatchRegion | undefined {
  if (!point) return undefined;
  for (const r of regions) {
    if (regionContainsPoint(r, point.lat, point.lon)) return r;
  }
  return undefined;
}

// ── Persistent store ─────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(now: number): string {
  _idCounter += 1;
  return `wr-${now.toString(36)}-${_idCounter}`;
}

export interface WatchRegionStore {
  list(): WatchRegion[];
  add(input: WatchRegionInput): WatchRegion;
  remove(id: string): void;
  clear(): void;
}

export function createWatchRegionStore(
  storage: StorageLike | null = defaultStorage(),
  now: () => number = Date.now,
): WatchRegionStore {
  let cache: WatchRegion[] = parseWatchRegions(storage?.getItem(STORAGE_KEY) ?? null);

  const persist = (): void => {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(cache)); }
    catch { /* quota / disabled — best-effort */ }
  };

  return {
    list() { return [...cache]; },
    add(input) {
      const region = normalizeRegion(input, now(), nextId(now()));
      cache = [...cache, region];
      persist();
      return region;
    },
    remove(id) {
      const next = cache.filter((r) => r.id !== id);
      if (next.length === cache.length) return;
      cache = next;
      persist();
    },
    clear() {
      cache = [];
      if (storage?.removeItem) {
        try { storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      } else { persist(); }
    },
  };
}

/** Reset internal counter — tests only. */
export function _resetWatchRegionIdCounter(): void { _idCounter = 0; }
