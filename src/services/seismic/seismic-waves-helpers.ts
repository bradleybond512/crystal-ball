/**
 * Pure helpers for the GlobeSeismicWaves Cesium component (Layer 6).
 *
 * Cesium itself is heavy + DOM-bound; the component file imports Cesium.
 * This module keeps the deterministic bits (magnitude→color, diff,
 * entity-key derivation) separate so they can be unit-tested without
 * spinning up a viewer.
 */

import type { GlobeSeismicOverlay } from './globe-overlay-emitter';

export type MagnitudeBand = 'M4-5' | 'M5-6' | 'M6-7' | 'M7+';

export interface BandColor {
  band: MagnitudeBand;
  hex: string;
}

const BAND_COLORS: Record<MagnitudeBand, string> = {
  'M4-5': '#22cc66',
  'M5-6': '#ffcc00',
  'M6-7': '#ff8800',
  'M7+': '#ff2233',
};

/** Returns the magnitude band for an overlay. Null magnitude → 'M4-5'
 *  fallback (the L4 emitter already filters out null magnitudes; this is
 *  defensive). */
export function bandForMagnitude(magnitude: number | null): MagnitudeBand {
  if (magnitude === null || magnitude < 5) return 'M4-5';
  if (magnitude < 6) return 'M5-6';
  if (magnitude < 7) return 'M6-7';
  return 'M7+';
}

export function colorForMagnitude(magnitude: number | null): BandColor {
  const band = bandForMagnitude(magnitude);
  return { band, hex: BAND_COLORS[band] };
}

/** Diff between the previous overlay set and the new one — keyed by
 *  eventId. Returns the events to add (new), update (still present, may
 *  have new radii/opacity), and remove (gone from the new set). */
export interface OverlayDiff {
  added: GlobeSeismicOverlay[];
  updated: GlobeSeismicOverlay[];
  removedIds: string[];
}

export function diffOverlays(
  prev: readonly GlobeSeismicOverlay[],
  next: readonly GlobeSeismicOverlay[],
): OverlayDiff {
  const prevIds = new Set(prev.map((o) => o.eventId));
  const nextIds = new Set(next.map((o) => o.eventId));

  const added: GlobeSeismicOverlay[] = [];
  const updated: GlobeSeismicOverlay[] = [];
  for (const overlay of next) {
    if (prevIds.has(overlay.eventId)) {
      updated.push(overlay);
    } else {
      added.push(overlay);
    }
  }

  const removedIds: string[] = [];
  for (const id of prevIds) {
    if (!nextIds.has(id)) removedIds.push(id);
  }

  return { added, updated, removedIds };
}

/**
 * Cesium entity key suffixes for each per-overlay primitive. We render
 * three entities per overlay; storing them in a Map keyed by these
 * suffixes lets the component remove all three at once on diff `removed`.
 */
export const ENTITY_KEYS = {
  epicenter: 'epicenter',
  pWave: 'p-wave',
  sWave: 's-wave',
} as const;

export type EntitySuffix = (typeof ENTITY_KEYS)[keyof typeof ENTITY_KEYS];

export function entityKey(eventId: string, suffix: EntitySuffix): string {
  return `${eventId}::${suffix}`;
}
