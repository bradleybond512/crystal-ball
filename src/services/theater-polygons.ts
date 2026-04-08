/**
 * Theater Polygons Service
 *
 * Worldview-style active conflict theater overlays.
 * Each theater is a geographic bounding polygon colored in real-time
 * by its current EscalationForecast score (0-100).
 *
 * Score → color mapping:
 * 0–39  stable → blue tint, low opacity
 * 40–59 elevated → amber, medium opacity
 * 60–79 high → orange, higher opacity
 * 80+ critical → red/crimson, pulsing
 */

import { getEscalationForecasts, subscribeEscalation, type EscalationForecast } from './escalation-forecast';

export interface TheaterPolygon {
  id: string;
  name: string;
  region: string;
  /** GeoJSON polygon ring — [ [lon, lat], ... ] */
  polygon: [number, number][];
  score: number;
  trend: EscalationForecast['trend'];
  color: [number, number, number, number]; // RGBA
}

// ── Theater Bounding Polygons ─────────────────────────────────────────────────
// Approximate bounding regions for each escalation theater

const THEATER_SHAPES: Record<string, [number, number][]> = {
  iran: [
 [44, 37], [63, 37], [63, 26], [56, 22], [50, 24], [44, 26], [44, 37],
  ],
  taiwan: [
 [118, 27], [124, 27], [124, 21], [118, 21], [118, 27],
  ],
  ukraine: [
 [22, 52], [40, 52], [40, 44], [33, 44], [28, 45], [22, 48], [22, 52],
  ],
  baltic: [
 [14, 60], [28, 60], [28, 53], [20, 53], [14, 55], [14, 60],
  ],
  blacksea: [
 [28, 47], [41, 47], [41, 41], [28, 41], [28, 47],
  ],
  korea: [
 [124, 40], [130, 40], [130, 34], [124, 34], [124, 40],
  ],
  scs: [
 [109, 23], [122, 23], [122, 4], [105, 4], [105, 16], [109, 20], [109, 23],
  ],
  gaza: [
 [34, 34], [36, 34], [36, 29], [34, 29], [34, 34],
  ],
  redsea: [
 [32, 30], [50, 30], [50, 10], [43, 12], [38, 8], [32, 15], [32, 30],
  ],
};

// ── Color Encoding ────────────────────────────────────────────────────────────

function scoreToColor(score: number, trend: EscalationForecast['trend']): [number, number, number, number] {
  const rising = trend === 'rising';

  if (score >= 80) {
 // Critical — deep red, high opacity
 return rising ? [220, 30, 30, 110] : [200, 50, 50, 95];
  }
  if (score >= 60) {
 // High — orange
 return rising ? [230, 110, 20, 90] : [210, 100, 30, 75];
  }
  if (score >= 40) {
 // Elevated — amber
 return rising ? [200, 170, 20, 70] : [180, 155, 20, 55];
  }
  // Stable — blue-grey
  return [60, 100, 180, 35];
}

function scoreToBorderColor(score: number): [number, number, number, number] {
  if (score >= 80) return [255, 60, 60, 200];
  if (score >= 60) return [255, 140, 40, 180];
  if (score >= 40) return [230, 200, 50, 160];
  return [80, 130, 220, 80];
}

// ── State ─────────────────────────────────────────────────────────────────────

let cachedPolygons: TheaterPolygon[] = [];
let unsubscribe: (() => void) | null = null;

function buildPolygons(): TheaterPolygon[] {
  const forecasts = getEscalationForecasts();
  const forecastMap = new Map(forecasts.map(f => [f.theaterId, f]));

  return Object.entries(THEATER_SHAPES).map(([id, polygon]) => {
 const forecast = forecastMap.get(id);
 const score = forecast?.score ?? 0;
 const trend = forecast?.trend ?? 'stable';
 return {
 id,
 name: forecast?.name ?? id,
 region: forecast?.region ?? '',
 polygon,
 score,
 trend,
 color: scoreToColor(score, trend),
 };
  });
}

export function getTheaterPolygons(): TheaterPolygon[] {
  return cachedPolygons;
}

export function getTheaterBorderColor(t: TheaterPolygon): [number, number, number, number] {
  return scoreToBorderColor(t.score);
}

type PolygonCallback = () => void;
const subscribers = new Set<PolygonCallback>();

export function subscribeTheaterPolygons(cb: PolygonCallback): () => void {
  if (subscribers.size === 0) {
 // Start listening to escalation updates
 unsubscribe = subscribeEscalation(() => {
 cachedPolygons = buildPolygons();
 subscribers.forEach(fn => fn());
 });
  }
  cachedPolygons = buildPolygons();
  subscribers.add(cb);
  return () => {
 subscribers.delete(cb);
 if (subscribers.size === 0 && unsubscribe) {
 unsubscribe();
 unsubscribe = null;
 }
  };
}
