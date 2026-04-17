 
/**
 * Near-Me Alert Filter
 *
 * Centralizes "is this alert near the user?" logic across ALL alert sources.
 * Provides a toggleable filter mode (off / near-me / strict) that panels and
 * the unified inbox can subscribe to.
 */

import type { UnifiedAlert } from './unified-alerts';
import { haversineKm } from './proximity-filter';
import { watchlistLocations } from './watchlist-locations';

export type NearMeMode = 'off' | 'near-me' | 'strict';

export interface UserLocationHint {
  lat: number;
  lon: number;
  radiusKm: number;
}

const MODE_KEY = 'cb-near-me-mode';
const FALLBACK_LOCATION_KEY = 'cb-user-location';
const MODE_CHANGED_EVENT = 'cb:near-me-changed';
const MILES_TO_KM = 1.609_34;
const DEFAULT_RADIUS_KM = 250;

function isNearMeMode(value: unknown): value is NearMeMode {
  return value === 'off' || value === 'near-me' || value === 'strict';
}

export function getNearMeMode(): NearMeMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (isNearMeMode(raw)) return raw;
  } catch { /* noop */ }
  return 'off';
}

export function setNearMeMode(mode: NearMeMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* noop */ }
  try {
    window.dispatchEvent(new CustomEvent<NearMeMode>(MODE_CHANGED_EVENT, { detail: mode }));
  } catch { /* noop */ }
}

export function getUserLocationHint(): UserLocationHint | null {
  // Prefer enabled primary watched location
  try {
    const enabled = watchlistLocations.getWatchedLocations().filter(l => l.enabled);
    if (enabled.length > 0) {
      const primary = enabled[0];
      if (primary) {
        return {
          lat: primary.lat,
          lon: primary.lon,
          radiusKm: primary.radiusMi * MILES_TO_KM,
        };
      }
    }
  } catch { /* noop */ }

  // Fallback to legacy localStorage key
  try {
    const raw = localStorage.getItem(FALLBACK_LOCATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserLocationHint>;
      if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
        return {
          lat: parsed.lat,
          lon: parsed.lon,
          radiusKm: typeof parsed.radiusKm === 'number' ? parsed.radiusKm : DEFAULT_RADIUS_KM,
        };
      }
    }
  } catch { /* noop */ }

  return null;
}

/** Stamp distanceKm on every alert that has a location. Non-mutating. */
export function stampDistance(alerts: UnifiedAlert[], hint?: UserLocationHint): UnifiedAlert[] {
  const h = hint ?? getUserLocationHint();
  if (!h) return alerts;
  return alerts.map(a => {
    if (!a.location) return a;
    const dist = haversineKm(h.lat, h.lon, a.location.lat, a.location.lon);
    return { ...a, distanceKm: dist };
  });
}

/**
 * Filter based on current mode and user location.
 *  off:      returns all alerts unchanged
 *  near-me:  returns alerts within 2× radius OR alerts with no location
 *  strict:   returns only alerts within radius (drops unlocated)
 */
export function filterByProximity(alerts: UnifiedAlert[], mode?: NearMeMode): UnifiedAlert[] {
  const m = mode ?? getNearMeMode();
  if (m === 'off') return alerts;

  const hint = getUserLocationHint();
  if (!hint) return alerts; // no location configured — can't filter

  const stamped = stampDistance(alerts, hint);
  const maxKm = m === 'strict' ? hint.radiusKm : hint.radiusKm * 2;

  return stamped.filter(a => {
    if (!a.location) return m === 'near-me'; // near-me keeps unlocated, strict drops
    const dist = a.distanceKm ?? haversineKm(hint.lat, hint.lon, a.location.lat, a.location.lon);
    return dist <= maxKm;
  });
}

/** Subscribe to mode changes. Returns an unsubscribe function. */
export function subscribeNearMeMode(cb: (mode: NearMeMode) => void): () => void {
  const handler = (e: Event): void => {
    const detail = (e as CustomEvent<NearMeMode>).detail;
    if (isNearMeMode(detail)) cb(detail);
    else cb(getNearMeMode());
  };
  window.addEventListener(MODE_CHANGED_EVENT, handler);
  return () => { window.removeEventListener(MODE_CHANGED_EVENT, handler); };
}
