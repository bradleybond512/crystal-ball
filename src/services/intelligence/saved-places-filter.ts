/**
 * Saved Places Filter — promotes saved places to a first-class
 * global proximity filter for ObservationEvent consumers.
 *
 * When activated, every panel that pipes its observations through
 * `filterObservations()` sees only events within `radiusKm` (default
 * 500km) of the chosen saved place. Observations without
 * coordinates pass through unchanged so non-geolocated signals
 * (system events, generic feeds) are never silently hidden.
 *
 * Sources data from the existing `src/services/saved-places.ts`
 * store (single canonical source) and persists the active
 * filter id to `localStorage 'wm-saved-places-filter'` so the
 * choice survives reloads.
 *
 * Pure module — no DOM imports, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';
import {
  getSavedPlace,
  getSavedPlaces,
  subscribeSavedPlaces,
  type SavedPlace,
} from '../saved-places';

// ── Public types ──────────────────────────────────────────────────────

export interface FilterContext {
  activePlaceId: string | null;
  activePlaceName: string | null;
  /** Pinned coordinate when a place is active. Null when inactive. */
  center: { lat: number; lon: number } | null;
  /** Effective radius — the saved place's own \`radiusKm\` if set,
   *  else \`DEFAULT_RADIUS_KM\`. */
  radiusKm: number;
  isActive: boolean;
}

export interface FilterStats {
  total: number;
  passed: number;
  failed: number;
  /** Observations without coordinates (always pass through). */
  passthrough: number;
}

export type FilterListener = (context: FilterContext) => void;

export interface SavedPlacesAdapter {
  list(): readonly SavedPlace[];
  get(id: string): SavedPlace | null;
  subscribe(listener: (places: readonly SavedPlace[]) => void): () => void;
}

export interface SavedPlacesFilterServiceOptions {
  adapter?: SavedPlacesAdapter;
  clock?: () => number;
  /** Override the default 500km radius. */
  defaultRadiusKm?: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-saved-places-filter';
const DEFAULT_RADIUS_KM = 500;
const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function liveAdapter(): SavedPlacesAdapter {
  return {
    list: () => getSavedPlaces(),
    get: (id: string) => getSavedPlace(id),
    subscribe: (listener) => subscribeSavedPlaces(listener),
  };
}

// ── Service ──────────────────────────────────────────────────────────

export class SavedPlacesFilterService {
  private activeId: string | null = null;
  private listeners = new Set<FilterListener>();
  private adapter: SavedPlacesAdapter;
  private adapterUnsubscribe: (() => void) | null = null;
  private defaultRadiusKm: number;
  private hydrated = false;

  constructor(options: SavedPlacesFilterServiceOptions = {}) {
    this.adapter = options.adapter ?? liveAdapter();
    this.defaultRadiusKm = options.defaultRadiusKm ?? DEFAULT_RADIUS_KM;
    // Watch the upstream store so a deletion / rename clears the
    // active filter rather than leaving a dangling pointer.
    this.adapterUnsubscribe = this.adapter.subscribe((places) => {
      if (this.activeId === null) return;
      if (places.some((p) => p.id === this.activeId)) {
        // Name / radius may have changed — notify subscribers.
        this.notify();
      } else {
        this.activeId = null;
        this.persist();
        this.notify();
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────────

  activate(placeId: string): void {
    this.ensureHydrated();
    const place = this.adapter.get(placeId);
    if (!place) return;
    if (this.activeId === placeId) return;
    this.activeId = placeId;
    this.persist();
    this.notify();
  }

  deactivate(): void {
    this.ensureHydrated();
    if (this.activeId === null) return;
    this.activeId = null;
    this.persist();
    this.notify();
  }

  getContext(): FilterContext {
    this.ensureHydrated();
    const place = this.activePlace();
    if (!place) {
      return {
        activePlaceId: null,
        activePlaceName: null,
        center: null,
        radiusKm: this.defaultRadiusKm,
        isActive: false,
      };
    }
    return {
      activePlaceId: place.id,
      activePlaceName: place.name,
      center: { lat: place.lat, lon: place.lon },
      radiusKm: place.radiusKm > 0 ? place.radiusKm : this.defaultRadiusKm,
      isActive: true,
    };
  }

  /** Filter observations by proximity to the active saved place.
   *  Observations without coordinates pass through (never silently
   *  hidden). When no place is active, returns input unchanged. */
  filterObservations<T extends ObservationEvent>(observations: readonly T[]): T[] {
    this.ensureHydrated();
    const ctx = this.getContext();
    if (!ctx.isActive || !ctx.center) return [...observations];
    const center = ctx.center;
    const radius = ctx.radiusKm;
    return observations.filter((obs) => isWithinRadius(obs, center, radius));
  }

  /** Report how the active filter would split the supplied
   *  observations. Useful for the panel's "pass / fail / passthrough"
   *  triplet without filtering twice. */
  evaluate(observations: readonly ObservationEvent[]): FilterStats {
    this.ensureHydrated();
    const ctx = this.getContext();
    const stats: FilterStats = { total: observations.length, passed: 0, failed: 0, passthrough: 0 };
    if (!ctx.isActive || !ctx.center) {
      stats.passed = observations.length;
      return stats;
    }
    const center = ctx.center;
    const radius = ctx.radiusKm;
    for (const obs of observations) {
      if (!obs.location) {
        stats.passthrough += 1;
        continue;
      }
      const dist = haversineKm(center.lat, center.lon, obs.location.lat, obs.location.lon);
      if (dist <= radius) stats.passed += 1;
      else stats.failed += 1;
    }
    return stats;
  }

  listPlaces(): readonly SavedPlace[] {
    return this.adapter.list();
  }

  subscribe(listener: FilterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: FilterListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state + persisted blob and tears down the
   *  upstream subscription. */
  resetForTesting(): void {
    this.activeId = null;
    this.listeners.clear();
    this.hydrated = true;
    if (this.adapterUnsubscribe) {
      this.adapterUnsubscribe();
      this.adapterUnsubscribe = null;
    }
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ────────────────────────────────────────────────────

  private activePlace(): SavedPlace | null {
    if (this.activeId === null) return null;
    return this.adapter.get(this.activeId);
  }

  private notify(): void {
    const snapshot = this.getContext();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { activeId?: string | null; defaultRadius?: number } | null;
      const candidate = parsed?.activeId;
      if (typeof candidate === 'string' && this.adapter.get(candidate)) {
        this.activeId = candidate;
      }
      const r = parsed?.defaultRadius;
      if (typeof r === 'number' && r >= 50 && r <= 5000) {
        this.defaultRadiusKm = r;
      }
    } catch {
      // corrupt — leave defaults
    }
  }

  setDefaultRadius(km: number): void {
    const clamped = Math.max(50, Math.min(5000, Math.round(km)));
    if (clamped === this.defaultRadiusKm) return;
    this.defaultRadiusKm = clamped;
    this.persist();
    this.notify();
  }

  getDefaultRadius(): number {
    return this.defaultRadiusKm;
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ activeId: this.activeId, defaultRadius: this.defaultRadiusKm }));
    } catch {
      // best effort
    }
  }
}

function isWithinRadius(
  obs: ObservationEvent,
  center: { lat: number; lon: number },
  radiusKm: number,
): boolean {
  if (!obs.location) return true; // passthrough — never silently hide
  return haversineKm(center.lat, center.lon, obs.location.lat, obs.location.lon) <= radiusKm;
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: SavedPlacesFilterService | null = null;

export function getSavedPlacesFilterService(): SavedPlacesFilterService {
  _singleton ??= new SavedPlacesFilterService();
  return _singleton;
}

export function __resetSavedPlacesFilterSingleton(): void {
  _singleton?.resetForTesting();
  _singleton = null;
}

/** Convenience: returns true if (lat, lon) falls within the active saved-place
 *  filter radius, or if no filter is active. Panels use this for per-item gating. */
export function isNearActivePlace(lat: number, lon: number): boolean {
  const ctx = getSavedPlacesFilterService().getContext();
  if (!ctx.isActive || !ctx.center) return true;
  return haversineKm(ctx.center.lat, ctx.center.lon, lat, lon) <= ctx.radiusKm;
}

export const __internals = {
  haversineKm,
  isWithinRadius,
  DEFAULT_RADIUS_KM,
  STORAGE_KEY,
};
