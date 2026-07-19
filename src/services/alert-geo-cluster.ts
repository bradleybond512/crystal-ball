/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Alert geo-clustering — aggregates nearby alerts into visual clusters
 * for the God's Vision globe and DeckGL map. Prevents dot overload in
 * high-activity regions.
 *
 * Uses simple grid-based clustering: divide the globe into cells of ~2°,
 * then merge adjacent cells if they share high alert counts.
 *
 * Dispatches `cb:alert-clusters` with cluster data every 30s.
 */

import { unifiedAlertStore, type UnifiedAlert, computeDistanceKm } from './unified-alerts';
import { debounce } from '../utils';

const CELL_DEG = 2;
const MERGE_RADIUS_KM = 300;

export interface AlertCluster {
  id: string;
  lat: number;
  lon: number;
  alerts: UnifiedAlert[];
  maxSeverity: UnifiedAlert['severity'];
  radius: number;   // visual radius hint in km
}

function cellKey(lat: number, lon: number): string {
  const clat = Math.floor(lat / CELL_DEG) * CELL_DEG;
  const clon = Math.floor(lon / CELL_DEG) * CELL_DEG;
  return `${clat},${clon}`;
}

export function clusterAlerts(alerts: UnifiedAlert[]): AlertCluster[] {
  const withLoc = alerts.filter(a => a.location && !a.acknowledged);
  if (withLoc.length === 0) return [];

  // Phase 1: grid assignment.
  const cells = new Map<string, UnifiedAlert[]>();
  for (const a of withLoc) {
    const key = cellKey(a.location!.lat, a.location!.lon);
    const arr = cells.get(key) ?? [];
    arr.push(a);
    cells.set(key, arr);
  }

  // Phase 2: merge adjacent cells within MERGE_RADIUS_KM.
  const clusters: AlertCluster[] = [];
  const used = new Set<string>();
  const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

  for (const [key, group] of cells) {
    if (used.has(key)) continue;
    used.add(key);
    const merged = [...group];
    const [latStr, lonStr] = key.split(',') as [string, string];
    const cLat = Number(latStr);
    const cLon = Number(lonStr);

    // Try to absorb neighboring cells.
    for (const [otherKey, otherGroup] of cells) {
      if (used.has(otherKey)) continue;
      const [oLatStr, oLonStr] = otherKey.split(',') as [string, string];
      const oLat = Number(oLatStr);
      const oLon = Number(oLonStr);
      const dist = computeDistanceKm(cLat + CELL_DEG / 2, cLon + CELL_DEG / 2, oLat + CELL_DEG / 2, oLon + CELL_DEG / 2);
      if (dist <= MERGE_RADIUS_KM) {
        merged.push(...otherGroup);
        used.add(otherKey);
      }
    }

    // Compute cluster centroid.
    let sumLat = 0;
    let sumLon = 0;
    let maxSev: UnifiedAlert['severity'] = 'info';
    for (const a of merged) {
      sumLat += a.location!.lat;
      sumLon += a.location!.lon;
      if ((sevRank[a.severity] ?? 0) > (sevRank[maxSev] ?? 0)) maxSev = a.severity;
    }
    const centLat = sumLat / merged.length;
    const centLon = sumLon / merged.length;

    clusters.push({
      id: `cluster-${key}`,
      lat: centLat,
      lon: centLon,
      alerts: merged,
      maxSeverity: maxSev,
      radius: Math.min(500, 50 + merged.length * 20),
    });
  }

  return clusters.sort((a, b) => b.alerts.length - a.alerts.length);
}

function publish(): void {
  const alerts = unifiedAlertStore.getAll();
  const clusters = clusterAlerts(alerts);
  document.dispatchEvent(new CustomEvent('cb:alert-clusters', { detail: { clusters } }));
}

// Debounced so burst ingests coalesce into one cluster pass.
const _debouncedPublish = debounce(publish as (...args: unknown[]) => void, 500);

let started = false;
export function startAlertGeoClustering(): void {
  if (started) return;
  started = true;
  window.setTimeout(publish, 5000);
  // subscribe handles reactivity; redundant 30 s setInterval removed.
  unifiedAlertStore.subscribe(_debouncedPublish);
}
