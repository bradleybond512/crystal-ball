import { WebcamSpatialIndex, haversineKm } from './webcam-spatial.ts';
import type { WebcamFeed } from './webcam-types';

export type WebcamTriggerKind = 'seismic_volcano' | 'fire' | 'flood';

export interface SeismicEventInput {
  id: string;
  lat: number;
  lon: number;
  magnitude: number | null;
  occurredAt: number;
}

export interface FireIncidentInput {
  id: string;
  lat: number;
  lon: number;
  name: string;
  detectedAt: number;
}

export interface FloodGaugeInput {
  siteNo: string;
  lat: number;
  lon: number;
  stageLabel: 'action' | 'minor' | 'moderate' | 'major';
  observedAt: number;
}

export interface WebcamTriggerEvent {
  kind: WebcamTriggerKind;
  triggeredAt: number;
  affectedCamIds: string[];
  reason: string;
  metadata: Record<string, string | number>;
}

// ── Seismic / Volcano ───────────────────────────────────────────────────

export const KNOWN_VOLCANO_COORDS: readonly { name: string; lat: number; lon: number }[] = [
  { name: 'Kilauea', lat: 19.4067, lon: -155.2834 },
  { name: 'Mauna Loa', lat: 19.475, lon: -155.608 },
  { name: 'Yellowstone', lat: 44.46, lon: -110.829 },
  { name: 'Mount St. Helens', lat: 46.276, lon: -122.218 },
  { name: 'Mount Hood', lat: 45.331, lon: -121.711 },
  { name: 'Mount Rainier', lat: 46.836, lon: -121.731 },
  { name: 'Redoubt', lat: 60.485, lon: -152.742 },
  { name: 'Pavlof', lat: 55.42, lon: -161.894 },
  { name: 'Cleveland', lat: 52.825, lon: -169.944 },
  { name: 'Shishaldin', lat: 54.756, lon: -163.97 },
];

export const SEISMIC_VOLCANO_RADIUS_KM = 150;
export const SEISMIC_MIN_MAGNITUDE = 4.5;

export function evaluateSeismicVolcanoTrigger(
  event: SeismicEventInput,
  index: WebcamSpatialIndex,
  now: number = Date.now(),
): WebcamTriggerEvent | null {
  if (event.magnitude == null || event.magnitude < SEISMIC_MIN_MAGNITUDE) return null;
  const closeVolcano = KNOWN_VOLCANO_COORDS.find(
    (v) => haversineKm(event.lat, event.lon, v.lat, v.lon) <= SEISMIC_VOLCANO_RADIUS_KM,
  );
  if (!closeVolcano) return null;
  const candidates = index
    .byCategory('volcano')
    .filter((f) => haversineKm(closeVolcano.lat, closeVolcano.lon, f.lat, f.lon) <= 50);
  if (candidates.length === 0) return null;
  return {
    kind: 'seismic_volcano',
    triggeredAt: now,
    affectedCamIds: candidates.map((c) => c.id),
    reason: `M${event.magnitude.toFixed(1)} quake within ${SEISMIC_VOLCANO_RADIUS_KM}km of ${closeVolcano.name}`,
    metadata: {
      eventId: event.id,
      volcano: closeVolcano.name,
      magnitude: event.magnitude,
    },
  };
}

// ── Fire ────────────────────────────────────────────────────────────────

export const FIRE_RADIUS_KM = 75;

export function evaluateFireTrigger(
  incident: FireIncidentInput,
  index: WebcamSpatialIndex,
  now: number = Date.now(),
): WebcamTriggerEvent | null {
  const fireCams = index.byCategory('fire');
  const matched = fireCams.filter(
    (f) => haversineKm(incident.lat, incident.lon, f.lat, f.lon) <= FIRE_RADIUS_KM,
  );
  if (matched.length === 0) return null;
  return {
    kind: 'fire',
    triggeredAt: now,
    affectedCamIds: matched.map((c) => c.id),
    reason: `Active fire incident "${incident.name}" within ${FIRE_RADIUS_KM}km`,
    metadata: { incidentId: incident.id, incidentName: incident.name },
  };
}

// ── Flood ───────────────────────────────────────────────────────────────

export const FLOOD_RADIUS_KM = 50;
const FLOOD_STAGES = new Set<FloodGaugeInput['stageLabel']>([
  'action',
  'minor',
  'moderate',
  'major',
]);

export function evaluateFloodTrigger(
  gauge: FloodGaugeInput,
  index: WebcamSpatialIndex,
  now: number = Date.now(),
): WebcamTriggerEvent | null {
  if (!FLOOD_STAGES.has(gauge.stageLabel)) return null;
  const streamCams = index.byCategory('stream');
  if (streamCams.length === 0) return null;
  let nearest: WebcamFeed | null = null;
  let nearestKm = Infinity;
  for (const cam of streamCams) {
    const km = haversineKm(gauge.lat, gauge.lon, cam.lat, cam.lon);
    if (km <= FLOOD_RADIUS_KM && km < nearestKm) {
      nearestKm = km;
      nearest = cam;
    }
  }
  if (!nearest) return null;
  return {
    kind: 'flood',
    triggeredAt: now,
    affectedCamIds: [nearest.id],
    reason: `Stream gauge ${gauge.siteNo} at ${gauge.stageLabel} stage`,
    metadata: { siteNo: gauge.siteNo, stage: gauge.stageLabel, distanceKm: Number(nearestKm.toFixed(2)) },
  };
}

// ── Registry ────────────────────────────────────────────────────────────

export class WebcamTriggerRegistry {
  private readonly events: WebcamTriggerEvent[] = [];
  private readonly maxAgeMs: number;

  constructor(maxAgeMs: number = 30 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
  }

  push(event: WebcamTriggerEvent): void {
    this.events.push(event);
  }

  active(now: number = Date.now()): WebcamTriggerEvent[] {
    const cutoff = now - this.maxAgeMs;
    return this.events.filter((e) => e.triggeredAt >= cutoff);
  }

  clear(): void {
    this.events.length = 0;
  }
}

let SINGLETON: WebcamTriggerRegistry | null = null;
export function getWebcamTriggerRegistry(): WebcamTriggerRegistry {
  SINGLETON ??= new WebcamTriggerRegistry();
  return SINGLETON;
}

// ── Browser-side bridge: dispatches `webcam:highlight` for UI consumers ──

export function emitWebcamHighlight(event: WebcamTriggerEvent): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('webcam:highlight', {
      detail: { kind: event.kind, camIds: event.affectedCamIds, reason: event.reason },
    }),
  );
}
