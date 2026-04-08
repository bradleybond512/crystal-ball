/**
 * SIGINT Convergence Service
 *
 * Unified Signals Intelligence layer combining three data streams:
 * 1. GPS/GNSS Jamming (gps-interference.ts)
 * 2. BGP Routing Anomalies (bgpview.ts)
 * 3. Submarine Cable Outages (cable-health.ts / cable-activity.ts)
 *
 * When 2+ SIGINT indicators fire within 500km and 24h of each other,
 * a SIGINT convergence alert is raised — a strong indicator of
 * state-level electronic warfare or infrastructure sabotage.
 */

export type SigintType = 'gps_jamming' | 'bgp_anomaly' | 'cable_outage';

export interface SigintEvent {
  id: string;
  type: SigintType;
  lat: number;
  lon: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: number;
  source: string;
}

export interface SigintConvergenceCluster {
  id: string;
  lat: number;
  lon: number;
  events: SigintEvent[];
  typeCount: number;
  maxSeverity: SigintEvent['severity'];
  score: number; // 0-100
  color: [number, number, number, number];
}

// ── Event Store ──────────────────────────────────────────────────────────────

const events: SigintEvent[] = [];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const PROXIMITY_KM = 500;
let idCounter = 0;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
 Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SEVERITY_SCORE: Record<SigintEvent['severity'], number> = {
  low: 10,
  medium: 25,
  high: 50,
  critical: 80,
};

function severityMax(a: SigintEvent['severity'], b: SigintEvent['severity']): SigintEvent['severity'] {
  return SEVERITY_SCORE[a] >= SEVERITY_SCORE[b] ? a : b;
}

function scoreToColor(score: number): [number, number, number, number] {
  if (score >= 80) return [200, 40, 255, 180]; // violet — critical SIGINT
  if (score >= 60) return [255, 60, 60, 160];  // red
  if (score >= 40) return [255, 150, 30, 140];  // amber
  return [80, 180, 255, 100]; // blue
}

// ── Ingest ───────────────────────────────────────────────────────────────────

export function ingestSigintEvent(
  type: SigintType,
  lat: number,
  lon: number,
  severity: SigintEvent['severity'],
  description: string,
  source: string,
  timestamp = Date.now(),
): void {
  events.push({
 id: `sigint-${++idCounter}`,
 type,
 lat,
 lon,
 severity,
 description,
 timestamp,
 source,
  });
}

// ── Query ────────────────────────────────────────────────────────────────────

function prune(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (events.length > 0 && events[0]!.timestamp < cutoff) {
 events.shift();
  }
}

export function getSigintEvents(): SigintEvent[] {
  prune();
  return [...events];
}

export function getSigintClusters(): SigintConvergenceCluster[] {
  prune();
  if (events.length === 0) return [];

  // Simple single-linkage clustering at PROXIMITY_KM
  const assigned = new Set<number>();
  const clusters: SigintConvergenceCluster[] = [];

  for (let i = 0; i < events.length; i++) {
 if (assigned.has(i)) continue;
 const cluster: SigintEvent[] = [events[i]!];
 assigned.add(i);

 // Expand cluster
 for (let j = i + 1; j < events.length; j++) {
 if (assigned.has(j)) continue;
 const ej = events[j]!;
 const near = cluster.some(
 (e) => haversineKm(e.lat, e.lon, ej.lat, ej.lon) <= PROXIMITY_KM,
 );
 if (near) {
 cluster.push(ej);
 assigned.add(j);
 }
 }

 // Only emit clusters with 2+ events
 if (cluster.length < 2) continue;

 const types = new Set(cluster.map((e) => e.type));
 let maxSev: SigintEvent['severity'] = 'low';
 let centLat = 0;
 let centLon = 0;
 for (const e of cluster) {
 maxSev = severityMax(maxSev, e.severity);
 centLat += e.lat;
 centLon += e.lon;
 }
 centLat /= cluster.length;
 centLon /= cluster.length;

 // Score: type diversity × severity × event count
 const typeScore = types.size * 30; // max 90 for all 3 types
 const sevScore = SEVERITY_SCORE[maxSev];
 const countBoost = Math.min(20, cluster.length * 3);
 const score = Math.min(100, Math.round((typeScore + sevScore + countBoost) / 2));

 clusters.push({
 id: `sigint-cluster-${clusters.length}`,
 lat: centLat,
 lon: centLon,
 events: cluster,
 typeCount: types.size,
 maxSeverity: maxSev,
 score,
 color: scoreToColor(score),
 });
  }

  clusters.sort((a, b) => b.score - a.score);
  return clusters;
}

/** All individual SIGINT events for the ScatterplotLayer */
export function getSigintPoints(): SigintEvent[] {
  prune();
  return events;
}
