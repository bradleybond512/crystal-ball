/**
 * Pure helpers for the weather-hazard globe overlay (PR 3).
 *
 * Extracted from the GlobeDataManager hook so the geometry/color/label
 * computations can be unit-tested without spinning up Cesium. The
 * GlobeDataManager itself just turns these descriptors into entity
 * objects.
 */

import type { NwsHazardAlert, AlertCategory, NhcStorm, HurricaneTrack } from '@/services/weather/nws-hazards';

// ── Polygon descriptors ───────────────────────────────────────────────

export interface AlertPolygonDescriptor {
  alertId: string;
  /** Each ring is a flat [lng, lat, lng, lat, …] array suitable for
   *  Cesium's `Cartesian3.fromDegreesArray`. */
  rings: number[][];
  /** Hex fill / stroke color. Fill is rendered at 35% alpha, stroke
   *  at 100%. */
  color: string;
  category: AlertCategory;
  /** Label/popup body shown on click (text-only — caller handles
   *  HTML escaping if needed). */
  description: string;
}

const CATEGORY_COLOR: Record<AlertCategory, string> = {
  tornado: '#dc2626',
  hurricane: '#9333ea',
  flood: '#2563eb',
  winter: '#0d9488',
  thunderstorm: '#f59e0b',
  other: '#6b7280',
};

/** Convert NWS hazard alerts → polygon descriptors, one per ring of
 *  Polygon / MultiPolygon geometries. Point-only alerts are skipped
 *  here (they show up as billboards on the existing weather radar
 *  layer; a polygon overlay can't render a point). */
export function alertsToPolygonDescriptors(
  alerts: readonly NwsHazardAlert[],
  now: number = Date.now(),
): AlertPolygonDescriptor[] {
  const out: AlertPolygonDescriptor[] = [];
  for (const a of alerts) appendAlertDescriptors(a, now, out);
  return out;
}

function appendAlertDescriptors(
  a: NwsHazardAlert,
  now: number,
  out: AlertPolygonDescriptor[],
): void {
  if (!a.geometry) return;
  const description = describeAlert(a, now);
  const color = CATEGORY_COLOR[a.category];
  if (a.geometry.kind === 'Polygon') {
    pushRings(a, a.geometry.rings, color, description, out);
  } else if (a.geometry.kind === 'MultiPolygon') {
    for (const polygon of a.geometry.polygons) {
      pushRings(a, polygon, color, description, out);
    }
  }
}

function pushRings(
  a: NwsHazardAlert,
  rings: readonly number[][][],
  color: string,
  description: string,
  out: AlertPolygonDescriptor[],
): void {
  for (const ring of rings) {
    const flat = flattenRing(ring);
    if (flat.length >= 6) {
      out.push({ alertId: a.id, rings: [flat], color, category: a.category, description });
    }
  }
}

function flattenRing(ring: readonly number[][]): number[] {
  const out: number[] = [];
  for (const [lng, lat] of ring) {
    if (typeof lng === 'number' && typeof lat === 'number') {
      out.push(lng, lat);
    }
  }
  return out;
}

/** Build the popup description shown when the user clicks an alert
 *  polygon: "<event> — <areaDesc>\nExpires <relative>". */
export function describeAlert(a: NwsHazardAlert, now: number): string {
  const expires = formatExpiresShort(a.expires, now);
  const areaPart = a.areaDesc ? ` — ${a.areaDesc}` : '';
  const head = `${a.event}${areaPart}`;
  const headlinePart = a.headline && a.headline.length < 200 ? `\n${a.headline}` : '';
  const expiresPart = expires ? `\nExpires ${expires}` : '';
  return `${head}${headlinePart}${expiresPart}`;
}

function formatExpiresShort(iso: string, now: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffMs = t - now;
  if (diffMs < 0) return 'expired';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

// ── Hurricane track descriptors ───────────────────────────────────────

export interface HurricaneTrackDescriptor {
  stormId: string;
  /** Forecast track as a flat [lng, lat, …] polyline. May be empty
   *  if the track GeoJSON had no point features. */
  trackPolyline: number[];
  /** Uncertainty cone as a flat [lng, lat, …] polygon (single ring).
   *  Null when the GeoJSON had no polygon feature. */
  uncertaintyCone: number[] | null;
  /** Storm name for the label shown on hover. */
  name: string;
  category: NhcStorm['category'];
}

export function trackToDescriptor(
  track: HurricaneTrack,
  storm: NhcStorm | undefined,
): HurricaneTrackDescriptor {
  const trackPolyline: number[] = [];
  for (const p of track.forecastPoints) trackPolyline.push(p.lng, p.lat);
  const cone = track.uncertaintyCone ? flattenRing(track.uncertaintyCone) : null;
  return {
    stormId: track.stormId,
    trackPolyline,
    uncertaintyCone: cone && cone.length >= 6 ? cone : null,
    name: storm?.name ?? track.stormId,
    category: storm?.category ?? 'unknown',
  };
}

// ── Storm billboard descriptors ───────────────────────────────────────

export interface StormBillboardDescriptor {
  stormId: string;
  name: string;
  position: { lng: number; lat: number };
  category: NhcStorm['category'];
  /** Color hex matching the panel's category badge. */
  color: string;
  description: string;
}

const STORM_CATEGORY_COLOR: Record<NhcStorm['category'], string> = {
  TD: '#1e88e5',
  TS: '#26a69a',
  HU1: '#ffd54f',
  HU2: '#ff9800',
  HU3: '#f4511e',
  HU4: '#ff453a',
  HU5: '#6a1b9a',
  PT: '#9e9e9e',
  unknown: '#616161',
};

export function stormsToBillboards(storms: readonly NhcStorm[]): StormBillboardDescriptor[] {
  return storms.map((s) => ({
    stormId: s.id,
    name: s.name,
    position: { lng: s.position.lng, lat: s.position.lat },
    category: s.category,
    color: STORM_CATEGORY_COLOR[s.category],
    description:
      `${s.name} — ${categoryLabel(s.category)} (${s.basin})\n` +
      `Wind ${s.intensityMph.toFixed(0)} mph` +
      (s.pressureMb ? ` · ${s.pressureMb.toFixed(0)} mb` : '') +
      (s.movement ? `\nMoving ${s.movement.headingDeg.toFixed(0)}° at ${s.movement.speedMph.toFixed(0)} mph` : '') +
      (s.advisoryNumber ? `\nAdvisory #${s.advisoryNumber}` : ''),
  }));
}

function categoryLabel(c: NhcStorm['category']): string {
  switch (c) {
    case 'TD': { return 'Tropical Depression'; }
    case 'TS': { return 'Tropical Storm'; }
    case 'HU1': { return 'CAT 1'; }
    case 'HU2': { return 'CAT 2'; }
    case 'HU3': { return 'CAT 3'; }
    case 'HU4': { return 'CAT 4'; }
    case 'HU5': { return 'CAT 5'; }
    case 'PT': { return 'Post-Tropical'; }
    case 'unknown': { return 'Unknown'; }
  }
}
