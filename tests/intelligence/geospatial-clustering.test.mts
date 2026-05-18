import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeospatialClusteringService,
  STORAGE_KEY,
  MAX_CLUSTERS,
  DEFAULT_CLUSTER_RADIUS_KM,
  HOTSPOT_POINT_COUNT,
  type GeoPoint,
} from '../../src/services/intelligence/geospatial-clustering.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-18T12:00:00Z');
const NOW_MS = NOW.getTime();

function makePoint(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return {
    id: `pt-${Math.random().toString(36).slice(2, 8)}`,
    lat: 0,
    lon: 0,
    domain: 'earthquake',
    severity: 'medium',
    timestamp: NOW_MS,
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-geo-clusters"', () => {
  assert.equal(STORAGE_KEY, 'wm-geo-clusters');
});

test('MAX_CLUSTERS is 200', () => {
  assert.equal(MAX_CLUSTERS, 200);
});

test('DEFAULT_CLUSTER_RADIUS_KM is 500', () => {
  assert.equal(DEFAULT_CLUSTER_RADIUS_KM, 500);
});

test('HOTSPOT_POINT_COUNT is 3', () => {
  assert.equal(HOTSPOT_POINT_COUNT, 3);
});

// ── addPoint ─────────────────────────────────────────────────────────────

test('addPoint creates a new cluster for a lone point', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 35.68, lon: 139.69 }));
  const clusters = svc.getClusters();
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.pointCount, 1);
});

test('addPoint within radius joins an existing cluster', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  // Two points 50km apart — well within 500km radius
  svc.addPoint(makePoint({ id: 'a', lat: 35.68, lon: 139.69 }));
  svc.addPoint(makePoint({ id: 'b', lat: 36.0, lon: 140.0 }));
  const clusters = svc.getClusters();
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.pointCount, 2);
});

test('addPoint outside radius creates a separate cluster', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  // Tokyo + LA — vastly outside 500km
  svc.addPoint(makePoint({ id: 'tokyo', lat: 35.68, lon: 139.69 }));
  svc.addPoint(makePoint({ id: 'la', lat: 34.05, lon: -118.24 }));
  const clusters = svc.getClusters();
  assert.equal(clusters.length, 2);
});

test('centroid recomputes after joining', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 35.0, lon: 139.0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 37.0, lon: 141.0 }));
  const c = svc.getClusters()[0];
  assert.ok(c);
  assert.ok(Math.abs((c?.centroidLat ?? 0) - 36) < 1e-9);
  assert.ok(Math.abs((c?.centroidLon ?? 0) - 140) < 1e-9);
});

test('joining picks the NEAREST cluster, not just the first within range', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  // Cluster A around (0,0), Cluster B around (5,5). Both more than radius from each other but distinct.
  // Use a 400km radius so they stay separate (~785km apart).
  svc.setClusterRadius(400);
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 5, lon: 5 }));
  // New point at (4.9, 4.9) — far from (0,0), nearest to (5,5)
  svc.addPoint(makePoint({ id: 'c', lat: 4.9, lon: 4.9 }));
  const clusters = svc.getClusters();
  // Should still be 2 clusters; the one near (5,5) should have 2 points
  assert.equal(clusters.length, 2);
  const nearB = clusters.find((cl) => Math.abs(cl.centroidLat - 5) < 1);
  assert.equal(nearB?.pointCount, 2);
});

// ── dominantSeverity ─────────────────────────────────────────────────────

test('dominantSeverity = critical when any critical present', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, severity: 'low' }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1, severity: 'critical' }));
  svc.addPoint(makePoint({ id: 'c', lat: 0.2, lon: 0.2, severity: 'high' }));
  const c = svc.getClusters()[0];
  assert.equal(c?.dominantSeverity, 'critical');
});

test('dominantSeverity = high when high present without critical', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, severity: 'low' }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1, severity: 'high' }));
  assert.equal(svc.getClusters()[0]?.dominantSeverity, 'high');
});

test('dominantSeverity = medium when medium present without high/critical', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, severity: 'low' }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1, severity: 'medium' }));
  assert.equal(svc.getClusters()[0]?.dominantSeverity, 'medium');
});

test('dominantSeverity = low when only low present', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, severity: 'low' }));
  assert.equal(svc.getClusters()[0]?.dominantSeverity, 'low');
});

// ── Domain ───────────────────────────────────────────────────────────────

test('cluster domain matches single-domain points', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, domain: 'earthquake' }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1, domain: 'earthquake' }));
  assert.equal(svc.getClusters()[0]?.domain, 'earthquake');
});

test('cluster domain = "mixed" when multiple domains', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, domain: 'earthquake' }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1, domain: 'wildfire' }));
  assert.equal(svc.getClusters()[0]?.domain, 'mixed');
});

// ── removePoint ──────────────────────────────────────────────────────────

test('removePoint reduces pointCount', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1 }));
  svc.removePoint('a');
  const c = svc.getClusters()[0];
  assert.equal(c?.pointCount, 1);
});

test('removePoint disbands empty cluster', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.removePoint('a');
  assert.equal(svc.getClusters().length, 0);
});

test('removePoint with unknown id is a no-op', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  assert.doesNotThrow(() => svc.removePoint('nonexistent'));
  assert.equal(svc.getClusters().length, 1);
});

test('removePoint recomputes centroid', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 10, lon: 10 }));
  // Centroid (5,5). Remove b → centroid (0,0).
  svc.removePoint('b');
  const c = svc.getClusters()[0];
  assert.ok(c);
  assert.ok(Math.abs(c?.centroidLat ?? 0) < 1e-9);
});

// ── getClusters filter ───────────────────────────────────────────────────

test('getClusters filters by domain', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, domain: 'earthquake' }));
  svc.addPoint(makePoint({ id: 'b', lat: 50, lon: 50, domain: 'cyber' }));
  assert.equal(svc.getClusters({ domain: 'earthquake' }).length, 1);
  assert.equal(svc.getClusters({ domain: 'cyber' }).length, 1);
});

test('getClusters filters by minPoints', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 50, lon: 50 }));
  svc.addPoint(makePoint({ id: 'c', lat: 51, lon: 51 }));
  // c joins b. So clusters: [single-a, b+c]
  assert.equal(svc.getClusters({ minPoints: 2 }).length, 1);
});

// ── getCluster ───────────────────────────────────────────────────────────

test('getCluster returns null for unknown id', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.equal(svc.getCluster('nope'), null);
});

test('getCluster returns the matching cluster by id', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  const c = svc.getClusters()[0];
  assert.ok(c);
  assert.equal(svc.getCluster(c?.id ?? '')?.pointCount, 1);
});

// ── getNearby ────────────────────────────────────────────────────────────

test('getNearby returns clusters whose centroid is within the radius', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'tokyo', lat: 35.68, lon: 139.69 }));
  svc.addPoint(makePoint({ id: 'la', lat: 34.05, lon: -118.24 }));
  // Search near Tokyo within 200km
  const nearTokyo = svc.getNearby(35.68, 139.69, 200);
  assert.equal(nearTokyo.length, 1);
});

test('getNearby returns empty when no clusters within radius', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'tokyo', lat: 35.68, lon: 139.69 }));
  // Search in middle of South Pacific
  const nearby = svc.getNearby(-30, -150, 500);
  assert.equal(nearby.length, 0);
});

// ── setClusterRadius ─────────────────────────────────────────────────────

test('setClusterRadius affects subsequent addPoint grouping', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.setClusterRadius(50); // small radius
  svc.addPoint(makePoint({ id: 'a', lat: 35.68, lon: 139.69 }));
  svc.addPoint(makePoint({ id: 'b', lat: 36.5, lon: 140.5 })); // ~100km away
  assert.equal(svc.getClusters().length, 2);
});

test('setClusterRadius rejects non-positive', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.setClusterRadius(0);
  // Sanity: still creates clusters using a positive default
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1 }));
  assert.equal(svc.getClusters().length, 1);
});

// ── getSummary ───────────────────────────────────────────────────────────

test('getSummary.totalClusters reflects cluster count', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 50, lon: 50 }));
  assert.equal(svc.getSummary().totalClusters, 2);
});

test('getSummary.hotspots includes clusters with >= 3 points', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1 }));
  svc.addPoint(makePoint({ id: 'c', lat: 0.2, lon: 0.2 }));
  const s = svc.getSummary();
  assert.ok(s.hotspots.length >= 1);
  assert.ok((s.hotspots[0]?.pointCount ?? 0) >= 3);
});

test('getSummary.hotspots includes critical-severity single-point clusters', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0, severity: 'critical' }));
  const s = svc.getSummary();
  assert.ok(s.hotspots.some((h) => h.dominantSeverity === 'critical'));
});

test('getSummary.avgPointsPerCluster math', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1 }));
  svc.addPoint(makePoint({ id: 'c', lat: 50, lon: 50 }));
  // Two clusters: 2 points + 1 point = 3 points / 2 clusters = 1.5
  const s = svc.getSummary();
  assert.ok(Math.abs(s.avgPointsPerCluster - 1.5) < 1e-9);
});

test('getSummary.hotspots is sorted by severity then pointCount desc', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'h1', lat: 50, lon: 50, severity: 'high' }));
  svc.addPoint(makePoint({ id: 'h2', lat: 50.1, lon: 50.1, severity: 'high' }));
  svc.addPoint(makePoint({ id: 'h3', lat: 50.2, lon: 50.2, severity: 'high' }));
  // Mark one critical
  svc.addPoint(makePoint({ id: 'cr', lat: 0, lon: 0, severity: 'critical' }));
  const hots = svc.getSummary().hotspots;
  // critical first, then high
  assert.equal(hots[0]?.dominantSeverity, 'critical');
});

// ── Ring buffer ──────────────────────────────────────────────────────────

test('cluster ring-buffer evicts oldest at MAX_CLUSTERS', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.setClusterRadius(1); // Force each point into its own cluster
  for (let i = 0; i < MAX_CLUSTERS + 30; i++) {
    svc.addPoint(makePoint({ id: `p${i}`, lat: i * 0.5, lon: i * 0.5 }));
  }
  assert.ok(svc.getClusters().length <= MAX_CLUSTERS);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on addPoint', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  assert.ok(calls >= 1);
});

test('subscribe is notified on removePoint', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.removePoint('a');
  assert.ok(calls >= 1);
});

test('unsubscribe stops notifications', () => {
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  assert.equal(calls, 0);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('clusters persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createGeospatialClusteringService({ storage, now: () => NOW_MS });
  svc1.addPoint(makePoint({ id: 'a', lat: 35.68, lon: 139.69 }));
  svc1.addPoint(makePoint({ id: 'b', lat: 35.7, lon: 139.7 }));

  const svc2 = createGeospatialClusteringService({ storage, now: () => NOW_MS });
  const clusters = svc2.getClusters();
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.pointCount, 2);
});

// ── firstSeenAt / lastUpdatedAt ──────────────────────────────────────────

test('firstSeenAt stays at first point addition; lastUpdatedAt advances', () => {
  let t = NOW_MS;
  const svc = createGeospatialClusteringService({ storage: createMemoryStorage(), now: () => t });
  svc.addPoint(makePoint({ id: 'a', lat: 0, lon: 0 }));
  t += 60_000;
  svc.addPoint(makePoint({ id: 'b', lat: 0.1, lon: 0.1 }));
  const c = svc.getClusters()[0];
  assert.equal(c?.firstSeenAt, NOW_MS);
  assert.equal(c?.lastUpdatedAt, NOW_MS + 60_000);
});
