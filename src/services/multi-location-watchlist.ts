/* eslint-disable sonarjs/pseudo-random, unicorn/no-array-callback-reference */
/**
 * Multi-Location Watchlist — Phase 2.1 roadmap spec.
 *
 * Provides the canonical `WatchedLocation` shape (with km radius + kind tag)
 * required by the Alerts Enhancement Roadmap. Backed by a dedicated
 * localStorage key (`cb-watched-locations`) so it can coexist with the legacy
 * `watchlist-locations.ts` service (which persists miles-based entries under
 * `wm-watched-locations-v1`).
 *
 * Key additions over the legacy service:
 *   - `kind: 'primary' | 'secondary' | 'travel'` for semantic tagging.
 *   - `radiusKm` (not miles) matching the alert pipeline's native units.
 *   - `findNearestLocation(lat, lon)` — nearest-location lookup regardless of radius.
 *   - `tagAlertWithNearest(alert)` — stamps alerts with their nearest watched location.
 */

import type { UnifiedAlert } from './unified-alerts';
import { computeDistanceKm } from './unified-alerts';

const STORAGE_KEY = 'cb-watched-locations';
const DEFAULT_RADIUS_KM = 50;

export interface WatchedLocation {
  id: string;
  /** Human label, e.g. "Home", "Office", "Mom's house". */
  label: string;
  lat: number;
  lon: number;
  /** Alert radius in kilometres. Defaults to 50 km. */
  radiusKm: number;
  kind: 'primary' | 'secondary' | 'travel';
  createdAt: number;
}

type WatchedLocationInput = Omit<WatchedLocation, 'id' | 'createdAt'>;

type Listener = () => void;

// ── Internal state ───────────────────────────────────────────────────────────

let cache: WatchedLocation[] | null = null;
const listeners = new Set<Listener>();

function generateId(): string {
  // Non-security-sensitive identifier for UI/storage keying.
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `wloc-${Date.now().toString(36)}-${rand}`;
}

function isWatchedLocation(value: unknown): value is WatchedLocation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<WatchedLocation>;
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number' &&
    typeof v.radiusKm === 'number' &&
    (v.kind === 'primary' || v.kind === 'secondary' || v.kind === 'travel') &&
    typeof v.createdAt === 'number'
  );
}

function load(): WatchedLocation[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed: unknown = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed.filter(isWatchedLocation) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* quota exceeded — ignore */ }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* listener error */ }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getWatchedLocations(): WatchedLocation[] {
  return [...load()];
}

export function addWatchedLocation(loc: Omit<WatchedLocation, 'id' | 'createdAt'>): WatchedLocation {
  const list = load();
  const input: WatchedLocationInput = {
    label: loc.label,
    lat: loc.lat,
    lon: loc.lon,
    radiusKm: typeof loc.radiusKm === 'number' && loc.radiusKm > 0 ? loc.radiusKm : DEFAULT_RADIUS_KM,
    kind: loc.kind,
  };
  const entry: WatchedLocation = {
    ...input,
    id: generateId(),
    createdAt: Date.now(),
  };
  list.push(entry);
  save();
  notify();
  return entry;
}

export function removeWatchedLocation(id: string): void {
  const list = load();
  const next = list.filter(l => l.id !== id);
  if (next.length === list.length) return;
  cache = next;
  save();
  notify();
}

export function updateWatchedLocation(id: string, patch: Partial<WatchedLocation>): void {
  const list = load();
  const idx = list.findIndex(l => l.id === id);
  if (idx === -1) return;
  const existing = list[idx];
  if (!existing) return;
  // Preserve immutable fields (id, createdAt).
  list[idx] = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
  };
  save();
  notify();
}

/**
 * Returns the closest watched location to the given point, or `null` if
 * no locations are configured. Distance is not bounded by radius — use
 * `findNearbyLocations`-style filtering at the caller if needed.
 */
export function findNearestLocation(
  lat: number,
  lon: number,
): { location: WatchedLocation; distanceKm: number } | null {
  const list = load();
  if (list.length === 0) return null;
  let bestLoc: WatchedLocation | null = null;
  let bestDist = Infinity;
  for (const loc of list) {
    const d = computeDistanceKm(loc.lat, loc.lon, lat, lon);
    if (d < bestDist) {
      bestDist = d;
      bestLoc = loc;
    }
  }
  if (!bestLoc) return null;
  return { location: bestLoc, distanceKm: bestDist };
}

/**
 * Tags an alert with its nearest watched location. Returns the nearest
 * location + distance in km, or an empty object if the alert has no
 * `location` or no watched locations exist.
 */
export function tagAlertWithNearest(
  alert: UnifiedAlert,
): { nearestLocation?: WatchedLocation; distanceKm?: number } {
  if (!alert.location) return {};
  const nearest = findNearestLocation(alert.location.lat, alert.location.lon);
  if (!nearest) return {};
  return { nearestLocation: nearest.location, distanceKm: nearest.distanceKm };
}

/**
 * Subscribe to watchlist changes (add/remove/update). Returns an
 * unsubscribe function.
 */
export function subscribeWatchedLocations(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Test/internal utility — clears the in-memory cache so the next read
 * rehydrates from localStorage. Not part of the public spec.
 */
export function _resetWatchedLocationsCache(): void {
  cache = null;
}
