/**
 * Geospatial Clustering — groups observations and situations that
 * land within a configurable haversine radius of an existing cluster,
 * producing "hotspot" zones the globe view can light up. Each cluster
 * tracks its centroid (mean lat/lon), dominant severity (highest
 * present), and domain (single domain, or `'mixed'` when multiple).
 *
 * Pure store: injectable Storage + clock. Clusters persist in a
 * 200-record ring buffer under `wm-geo-clusters`. New points join the
 * NEAREST cluster within the radius; lone points create their own
 * cluster. Removing the last point in a cluster disbands it.
 */

// ── Public types ─────────────────────────────────────────────────────────

export interface GeoPoint {
  id: string;
  lat: number;
  lon: number;
  domain: string;
  severity: string;
  timestamp: number;
}

export interface GeoCluster {
  id: string;
  centroidLat: number;
  centroidLon: number;
  radiusKm: number;
  points: GeoPoint[];
  /** Single shared domain, or `'mixed'` when the cluster spans multiple. */
  domain: string;
  dominantSeverity: string;
  pointCount: number;
  firstSeenAt: number;
  lastUpdatedAt: number;
}

export interface ClusterFilter {
  domain?: string;
  minPoints?: number;
}

export interface ClusterSummary {
  totalClusters: number;
  hotspots: GeoCluster[];
  avgPointsPerCluster: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GeospatialClusteringOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface GeospatialClusteringService {
  addPoint(point: GeoPoint): void;
  removePoint(pointId: string): void;
  getClusters(filter?: ClusterFilter): GeoCluster[];
  getCluster(clusterId: string): GeoCluster | null;
  getNearby(lat: number, lon: number, radiusKm: number): GeoCluster[];
  getSummary(): ClusterSummary;
  setClusterRadius(km: number): void;
  subscribe(cb: (clusters: GeoCluster[]) => void): void;
  unsubscribe(cb: (clusters: GeoCluster[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-geo-clusters';
export const MAX_CLUSTERS = 200;
export const DEFAULT_CLUSTER_RADIUS_KM = 500;
export const HOTSPOT_POINT_COUNT = 3;

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const HOTSPOT_SEVERITIES: ReadonlySet<string> = new Set(['high', 'critical']);

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `clus-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

const EARTH_RADIUS_KM = 6371;
function toRad(deg: number): number { return (deg * Math.PI) / 180; }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function recomputeCluster(cluster: GeoCluster): void {
  if (cluster.points.length === 0) {
    cluster.pointCount = 0;
    return;
  }
  let latSum = 0;
  let lonSum = 0;
  let topRank = 0;
  let topSeverity = cluster.points[0]?.severity ?? 'low';
  const domains = new Set<string>();
  for (const p of cluster.points) {
    latSum += p.lat;
    lonSum += p.lon;
    domains.add(p.domain);
    const rank = SEVERITY_RANK[p.severity] ?? 0;
    if (rank > topRank) {
      topRank = rank;
      topSeverity = p.severity;
    }
  }
  cluster.centroidLat = latSum / cluster.points.length;
  cluster.centroidLon = lonSum / cluster.points.length;
  cluster.dominantSeverity = topSeverity;
  cluster.domain = domains.size === 1 ? [...domains][0] ?? 'mixed' : 'mixed';
  cluster.pointCount = cluster.points.length;
}

function clonePoint(p: GeoPoint): GeoPoint {
  return { ...p };
}

function cloneCluster(c: GeoCluster): GeoCluster {
  return { ...c, points: c.points.map((p) => clonePoint(p)) };
}

function deserialize(raw: unknown): GeoCluster | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.centroidLat !== 'number' || typeof r.centroidLon !== 'number') return null;
  const points = Array.isArray(r.points)
    ? r.points
        .map((p) => deserializePoint(p))
        .filter((p): p is GeoPoint => p !== null)
    : [];
  const cluster: GeoCluster = {
    id: r.id,
    centroidLat: r.centroidLat,
    centroidLon: r.centroidLon,
    radiusKm: typeof r.radiusKm === 'number' ? r.radiusKm : DEFAULT_CLUSTER_RADIUS_KM,
    points,
    domain: typeof r.domain === 'string' ? r.domain : 'mixed',
    dominantSeverity: typeof r.dominantSeverity === 'string' ? r.dominantSeverity : 'low',
    pointCount: points.length,
    firstSeenAt: typeof r.firstSeenAt === 'number' ? r.firstSeenAt : 0,
    lastUpdatedAt: typeof r.lastUpdatedAt === 'number' ? r.lastUpdatedAt : 0,
  };
  recomputeCluster(cluster);
  return cluster;
}

function deserializePoint(raw: unknown): GeoPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.lat !== 'number' || typeof r.lon !== 'number') return null;
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    domain: typeof r.domain === 'string' ? r.domain : 'unknown',
    severity: typeof r.severity === 'string' ? r.severity : 'low',
    timestamp: typeof r.timestamp === 'number' ? r.timestamp : 0,
  };
}

function rehydrate(storage: StorageLike | null): GeoCluster[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: GeoCluster[] = [];
  for (const p of parsed) {
    const d = deserialize(p);
    if (d) out.push(d);
  }
  return out;
}

function severityRank(s: string): number {
  return SEVERITY_RANK[s] ?? 0;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createGeospatialClusteringService(
  options: GeospatialClusteringOptions = {},
): GeospatialClusteringService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const clusters: GeoCluster[] = rehydrate(storage);
  let radiusKm = DEFAULT_CLUSTER_RADIUS_KM;
  const listeners = new Set<(clusters: GeoCluster[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(clusters));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function capRingBuffer(): void {
    if (clusters.length <= MAX_CLUSTERS) return;
    // Evict oldest by lastUpdatedAt first.
    clusters.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    clusters.length = MAX_CLUSTERS;
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const snapshot = clusters.map((c) => cloneCluster(c));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function findNearestCluster(lat: number, lon: number): GeoCluster | null {
    let best: { cluster: GeoCluster; distanceKm: number } | null = null;
    for (const c of clusters) {
      const distanceKm = haversineKm(lat, lon, c.centroidLat, c.centroidLon);
      if (distanceKm > radiusKm) continue;
      if (best === null || distanceKm < best.distanceKm) {
        best = { cluster: c, distanceKm };
      }
    }
    return best?.cluster ?? null;
  }

  return {
    addPoint(point): void {
      const nowMs = clock();
      const nearest = findNearestCluster(point.lat, point.lon);
      if (nearest) {
        // Replace if id collides; otherwise append.
        const existingIdx = nearest.points.findIndex((p) => p.id === point.id);
        if (existingIdx === -1) {
          nearest.points.push(clonePoint(point));
        } else {
          nearest.points[existingIdx] = clonePoint(point);
        }
        nearest.lastUpdatedAt = nowMs;
        recomputeCluster(nearest);
      } else {
        const cluster: GeoCluster = {
          id: nextId(nowMs),
          centroidLat: point.lat,
          centroidLon: point.lon,
          radiusKm,
          points: [clonePoint(point)],
          domain: point.domain,
          dominantSeverity: point.severity,
          pointCount: 1,
          firstSeenAt: nowMs,
          lastUpdatedAt: nowMs,
        };
        clusters.push(cluster);
      }
      capRingBuffer();
      persist();
      notify();
    },

    removePoint(pointId): void {
      let changed = false;
      for (let i = clusters.length - 1; i >= 0; i--) {
        const cluster = clusters[i];
        if (!cluster) continue;
        const idx = cluster.points.findIndex((p) => p.id === pointId);
        if (idx === -1) continue;
        cluster.points.splice(idx, 1);
        cluster.lastUpdatedAt = clock();
        if (cluster.points.length === 0) {
          clusters.splice(i, 1);
        } else {
          recomputeCluster(cluster);
        }
        changed = true;
        break;
      }
      if (!changed) return;
      persist();
      notify();
    },

    getClusters(filter): GeoCluster[] {
      let out = clusters;
      if (filter?.domain !== undefined) {
        const domain = filter.domain;
        out = out.filter((c) => c.domain === domain);
      }
      if (filter?.minPoints !== undefined) {
        const minPoints = filter.minPoints;
        out = out.filter((c) => c.pointCount >= minPoints);
      }
      return out.map((c) => cloneCluster(c));
    },

    getCluster(clusterId): GeoCluster | null {
      const found = clusters.find((c) => c.id === clusterId);
      return found ? cloneCluster(found) : null;
    },

    getNearby(lat, lon, searchRadiusKm): GeoCluster[] {
      const out: GeoCluster[] = [];
      for (const c of clusters) {
        if (haversineKm(lat, lon, c.centroidLat, c.centroidLon) <= searchRadiusKm) {
          out.push(cloneCluster(c));
        }
      }
      out.sort((a, b) =>
        haversineKm(lat, lon, a.centroidLat, a.centroidLon)
        - haversineKm(lat, lon, b.centroidLat, b.centroidLon));
      return out;
    },

    getSummary(): ClusterSummary {
      const totalClusters = clusters.length;
      let totalPoints = 0;
      for (const c of clusters) totalPoints += c.pointCount;
      const avgPointsPerCluster = totalClusters === 0 ? 0 : totalPoints / totalClusters;
      const hotspots = clusters
        .filter((c) => c.pointCount >= HOTSPOT_POINT_COUNT || HOTSPOT_SEVERITIES.has(c.dominantSeverity))
        .map((c) => cloneCluster(c))
        .sort((a, b) => {
          const rankDelta = severityRank(b.dominantSeverity) - severityRank(a.dominantSeverity);
          if (rankDelta !== 0) return rankDelta;
          return b.pointCount - a.pointCount;
        });
      return { totalClusters, hotspots, avgPointsPerCluster };
    },

    setClusterRadius(km): void {
      if (typeof km !== 'number' || !Number.isFinite(km) || km <= 0) return;
      radiusKm = km;
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: GeospatialClusteringService | null = null;

export function getGeospatialClusteringService(): GeospatialClusteringService {
  _singleton ??= createGeospatialClusteringService();
  return _singleton;
}

export function resetGeospatialClusteringServiceForTests(): void {
  _singleton = null;
}
