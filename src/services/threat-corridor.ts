/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Threat corridor mapping — identifies geographic corridors where
 * multiple alert sources report events along a common axis.
 * Uses a simplified bearing-cluster approach.
 */

import { unifiedAlertStore } from './unified-alerts';

const SCAN_INTERVAL = 2 * 60_000;
const WINDOW_MS = 6 * 60 * 60_000;
const MIN_ALERTS = 4;
const BEARING_TOLERANCE = 30;
const MAX_WIDTH_KM = 200;

export interface ThreatCorridor {
  id: string;
  bearing: number;
  alerts: { id: string; lat: number; lon: number }[];
  lengthKm: number;
  centroid: { lat: number; lon: number };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function bearingDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function detectCorridors(): ThreatCorridor[] {
  const now = Date.now();
  const located = unifiedAlertStore.getAll()
    .filter(a => a.location && now - a.timestamp < WINDOW_MS)
    .map(a => ({ id: a.id, lat: a.location!.lat, lon: a.location!.lon }));

  if (located.length < MIN_ALERTS) return [];

  const corridors: ThreatCorridor[] = [];
  const used = new Set<string>();

  for (let i = 0; i < located.length; i++) {
    const anchor = located[i]!;
    if (used.has(anchor.id)) continue;

    for (let j = i + 1; j < located.length; j++) {
      const target = located[j]!;
      if (used.has(target.id)) continue;
      const dist = haversineKm(anchor.lat, anchor.lon, target.lat, target.lon);
      if (dist < 50) continue;

      const axisB = bearingDeg(anchor.lat, anchor.lon, target.lat, target.lon);
      const aligned = [anchor, target];

      for (const candidate of located) {
        if (candidate.id === anchor.id || candidate.id === target.id || used.has(candidate.id)) continue;
        const cb = bearingDeg(anchor.lat, anchor.lon, candidate.lat, candidate.lon);
        if (bearingDiff(axisB, cb) > BEARING_TOLERANCE) continue;
        const perpDist = haversineKm(anchor.lat, anchor.lon, candidate.lat, candidate.lon) *
          Math.sin(bearingDiff(axisB, cb) * Math.PI / 180);
        if (Math.abs(perpDist) > MAX_WIDTH_KM) continue;
        aligned.push(candidate);
      }

      if (aligned.length >= MIN_ALERTS) {
        let maxDist = 0;
        for (let a = 0; a < aligned.length; a++) {
          for (let b = a + 1; b < aligned.length; b++) {
            const d = haversineKm(aligned[a]!.lat, aligned[a]!.lon, aligned[b]!.lat, aligned[b]!.lon);
            if (d > maxDist) maxDist = d;
          }
        }
        const centLat = aligned.reduce((s, p) => s + p.lat, 0) / aligned.length;
        const centLon = aligned.reduce((s, p) => s + p.lon, 0) / aligned.length;
        corridors.push({
          id: `corridor-${anchor.id}-${axisB.toFixed(0)}`,
          bearing: Math.round(axisB),
          alerts: aligned.map(a => ({ id: a.id, lat: a.lat, lon: a.lon })),
          lengthKm: Math.round(maxDist),
          centroid: { lat: centLat, lon: centLon },
        });
        for (const a of aligned) used.add(a.id);
        break;
      }
    }
  }

  return corridors;
}

function scan(): void {
  const corridors = detectCorridors();
  if (corridors.length > 0) {
    document.dispatchEvent(new CustomEvent('cb:threat-corridors', {
      detail: { corridors },
    }));
  }
}

let started = false;
export function startThreatCorridor(): void {
  if (started) return;
  started = true;
  window.setInterval(scan, SCAN_INTERVAL);
  window.setTimeout(scan, 25_000);
}
