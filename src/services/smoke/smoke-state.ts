/**
 * Smoke engine singleton — fetches conditions for the primary saved place,
 * composes SmokeSnapshots via the pure builder, and lets surfaces subscribe.
 * Persistence for checklist done-state + sensitivity toggle lives here so
 * the pure modules stay fixture-testable.
 */
import { getSavedPlaces } from '@/services/saved-places';
import type { CompassPoint, SmokeSnapshot } from './smoke-types';
import { compassPoints } from './clean-air-compass';
import { fetchAqForPoint, fetchAqForPoints, type ParsedAq } from './smoke-fetch';
import { buildSnapshot } from './smoke-snapshot';

const CHECKLIST_KEY = 'cb-smoke-checklist';
const SENSITIVE_KEY = 'cb-smoke-sensitive';
export const COMPASS_RADII_MI = [30, 60, 100];

let snapshots: SmokeSnapshot[] = [];
const listeners = new Set<(s: SmokeSnapshot[]) => void>();

function readIds(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function getSmokeSnapshots(): SmokeSnapshot[] {
  return snapshots;
}

export function getDoneChecklistIds(): string[] {
  return readIds(CHECKLIST_KEY);
}

export function setChecklistDone(ids: string[]): void {
  try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(ids)); } catch { /* quota */ }
  void refreshSmokeConditions(false);
}

export function getSensitiveGroup(): boolean {
  try { return localStorage.getItem(SENSITIVE_KEY) === '1'; } catch { return false; }
}

export function setSensitiveGroup(v: boolean): void {
  try { localStorage.setItem(SENSITIVE_KEY, v ? '1' : '0'); } catch { /* quota */ }
  void refreshSmokeConditions(false);
}

export function subscribeSmoke(fn: (s: SmokeSnapshot[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let lastFetch: {
  home: ParsedAq;
  compass: { point: CompassPoint; parsed: ParsedAq | null }[];
  placeId: string;
} | null = null;

/** Refresh snapshots. withNetwork=false recomputes from cached fetches
 *  (checklist/sensitivity toggles shouldn't refetch). */
export async function refreshSmokeConditions(withNetwork = true): Promise<void> {
  const places = getSavedPlaces();
  const primary = places.find((p) => p.primary) ?? places[0];
  if (!primary) {
    snapshots = [];
    for (const l of listeners) l(snapshots);
    return;
  }

  if (withNetwork || lastFetch?.placeId !== primary.id) {
    try {
      const points = compassPoints(primary.lat, primary.lon, COMPASS_RADII_MI);
      const [home, ring] = await Promise.all([
        fetchAqForPoint(primary.lat, primary.lon),
        fetchAqForPoints(points),
      ]);
      lastFetch = {
        home,
        compass: points.map((point, i) => ({ point, parsed: ring[i] ?? null })),
        placeId: primary.id,
      };
    } catch {
      // Keep the last snapshot — staleness shows via generatedAt + the
      // smoke_forecast freshness feed (recorded inside the fetcher).
      if (!lastFetch) return;
    }
  }

  snapshots = [buildSnapshot({
    place: { id: primary.id, name: primary.name, lat: primary.lat, lon: primary.lon },
    home: lastFetch.home,
    compassParsed: lastFetch.compass,
    doneChecklistIds: getDoneChecklistIds(),
    sensitiveGroup: getSensitiveGroup(),
    now: Date.now(),
  })];
  for (const l of listeners) l(snapshots);
}
