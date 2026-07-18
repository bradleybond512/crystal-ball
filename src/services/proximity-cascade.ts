/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Proximity cascade detection — identifies chains of alerts that
 * propagate geographically over time (e.g. a shockwave of events
 * spreading outward from an epicenter).
 */

import { unifiedAlertStore } from './unified-alerts';
import { logDebug } from './reasoning-debug';

const SCAN_INTERVAL = 90_000;
const MAX_CHAIN_AGE_MS = 4 * 60 * 60_000;
const MAX_HOP_DISTANCE_KM = 300;
const MAX_HOP_TIME_MS = 60 * 60_000;
const MIN_CHAIN_LENGTH = 3;

export interface CascadeChain {
  id: string;
  alerts: { alertId: string; lat: number; lon: number; timestamp: number }[];
  spreadSpeedKmH: number;
  bearing: number;
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

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function detectCascades(): CascadeChain[] {
  const now = Date.now();
  const alerts = unifiedAlertStore.getAll()
    .filter(a => a.location && now - a.timestamp < MAX_CHAIN_AGE_MS)
    .sort((a, b) => a.timestamp - b.timestamp);

  const chains: CascadeChain[] = [];
  const used = new Set<string>();

  for (const seed of alerts) {
    if (used.has(seed.id) || !seed.location) continue;

    const chain = [{
      alertId: seed.id,
      lat: seed.location.lat,
      lon: seed.location.lon,
      timestamp: seed.timestamp,
    }];

    let last = chain[0]!;
    for (const candidate of alerts) {
      if (candidate.id === seed.id || used.has(candidate.id) || !candidate.location) continue;
      if (candidate.timestamp <= last.timestamp) continue;
      const dt = candidate.timestamp - last.timestamp;
      if (dt > MAX_HOP_TIME_MS) continue;
      const dist = haversineKm(last.lat, last.lon, candidate.location.lat, candidate.location.lon);
      if (dist > MAX_HOP_DISTANCE_KM || dist < 10) continue;

      chain.push({
        alertId: candidate.id,
        lat: candidate.location.lat,
        lon: candidate.location.lon,
        timestamp: candidate.timestamp,
      });
      last = chain[chain.length - 1]!;
    }

    if (chain.length >= MIN_CHAIN_LENGTH) {
      const first = chain[0]!;
      const lastNode = chain[chain.length - 1]!;
      const totalDist = haversineKm(first.lat, first.lon, lastNode.lat, lastNode.lon);
      const totalTimeH = (lastNode.timestamp - first.timestamp) / 3_600_000;
      chains.push({
        id: `cascade-${seed.id}`,
        alerts: chain,
        spreadSpeedKmH: totalTimeH > 0 ? Math.round(totalDist / totalTimeH) : 0,
        bearing: bearing(first.lat, first.lon, lastNode.lat, lastNode.lon),
      });
      for (const node of chain) used.add(node.alertId);
    }
  }

  return chains;
}

function safeScan(): void {
  try { scan(); } catch (error) {
    logDebug({ level: 'warn', category: 'other', source: 'proximity-cascade', message: 'scan error', data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

function scan(): void {
  const cascades = detectCascades();
  if (cascades.length > 0) {
    document.dispatchEvent(new CustomEvent('cb:proximity-cascades', {
      detail: { cascades },
    }));
  }
}

let started = false;
export function startProximityCascade(): void {
  if (started) return;
  started = true;
  window.setInterval(safeScan, SCAN_INTERVAL);
  window.setTimeout(safeScan, 20_000);
}
