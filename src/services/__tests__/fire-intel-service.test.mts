import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clusterHotspots,
  rankIncidentsByThreat,
  categorizeAqi,
} from '../wildfires/fire-intel-helpers.ts';
import type { MapFire } from '../wildfires/index.ts';
import type { IncidentReport } from '../inciweb.ts';

// ── clusterHotspots ──────────────────────────────────────────────────────

function fire(lat: number, lon: number, frp: number, conf = 50, brightness = 320): MapFire {
  return { lat, lon, brightness, frp, confidence: conf, region: 'TestRegion', acq_date: '2026-05-06', daynight: 'D' };
}

test('clusterHotspots: empty input → empty output', () => {
  assert.deepEqual(clusterHotspots([]), []);
});

test('clusterHotspots: two fires in the same 0.1° cell → one cluster, summed FRP', () => {
  // Both points round to (lat 34.1, lon -118.2) under gridDeg=0.1.
  const fires = [fire(34.08, -118.22, 10), fire(34.12, -118.18, 15)];
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 50 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].fireCount, 2);
  assert.equal(clusters[0].totalFrp, 25);
});

test('clusterHotspots: fires in different cells → separate clusters', () => {
  const fires = [fire(34.05, -118.24, 10), fire(40.10, -100.00, 20)];
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 50 });
  assert.equal(clusters.length, 2);
});

test('clusterHotspots: ranks by total FRP descending', () => {
  const fires = [fire(34.05, -118.24, 5), fire(40.10, -100.00, 20), fire(50.10, -50.00, 12)];
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 50 });
  assert.deepEqual(clusters.map(c => c.totalFrp), [20, 12, 5]);
});

test('clusterHotspots: topN cap honored', () => {
  const fires: MapFire[] = [];
  for (let i = 0; i < 10; i++) fires.push(fire(i * 5, i * 5, i + 1));
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 3 });
  assert.equal(clusters.length, 3);
});

test('clusterHotspots: sets highConfidence when any pixel ≥95', () => {
  const fires = [fire(34.05, -118.24, 5, 50), fire(34.05, -118.24, 5, 95)];
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 1 });
  assert.equal(clusters[0].highConfidence, true);
});

test('clusterHotspots: highConfidence stays false when every pixel <95', () => {
  const fires = [fire(34.05, -118.24, 5, 50), fire(34.05, -118.24, 5, 70)];
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 1 });
  assert.equal(clusters[0].highConfidence, false);
});

test('clusterHotspots: ignores NaN / Infinity coordinates', () => {
  const fires = [fire(NaN, -118.24, 99), fire(Infinity, -118.24, 99), fire(34.05, -118.24, 1)];
  const clusters = clusterHotspots(fires, { gridDeg: 0.1, topN: 50 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].totalFrp, 1);
});

// ── rankIncidentsByThreat ────────────────────────────────────────────────

function incident(name: string, acres: number | null, contained: number | null): IncidentReport {
  return {
    id: name,
    name,
    state: 'CA',
    county: '',
    cause: 'Unknown',
    acresBurned: acres,
    percentContained: contained,
    evacuationOrders: false,
    evacuationWarnings: false,
    personnel: null,
    engines: null,
    helicopters: null,
    discoveryDate: null,
    updatedAt: new Date(0),
    url: '',
    lat: null,
    lon: null,
    incidentType: 'Wildfire',
    severity: 'medium',
  };
}

test('rankIncidentsByThreat: 10000 acres @ 50% > 5000 acres @ 0%', () => {
  const a = incident('A', 10_000, 50); // score 5000
  const b = incident('B', 5_000, 0);   // score 5000
  const c = incident('C', 12_000, 30); // score 8400
  const ranked = rankIncidentsByThreat([a, b, c]);
  assert.equal(ranked[0].incident.name, 'C');
});

test('rankIncidentsByThreat: 100% contained → score 0', () => {
  const ranked = rankIncidentsByThreat([incident('A', 99_999, 100)]);
  assert.equal(ranked[0].threatScore, 0);
});

test('rankIncidentsByThreat: null containment treated as 0% → full acreage', () => {
  const ranked = rankIncidentsByThreat([incident('A', 1_000, null)]);
  assert.equal(ranked[0].threatScore, 1_000);
});

test('rankIncidentsByThreat: null acreage → score 0', () => {
  const ranked = rankIncidentsByThreat([incident('A', null, 50)]);
  assert.equal(ranked[0].threatScore, 0);
});

test('rankIncidentsByThreat: bogus containment >100 clamped', () => {
  const ranked = rankIncidentsByThreat([incident('A', 1_000, 999)]);
  assert.equal(ranked[0].threatScore, 0);
});

test('rankIncidentsByThreat: stable sort ordering of equal threats preserves length', () => {
  const ranked = rankIncidentsByThreat([
    incident('A', 1_000, 50),
    incident('B', 1_000, 50),
    incident('C', 1_000, 50),
  ]);
  assert.equal(ranked.length, 3);
  for (const r of ranked) assert.equal(r.threatScore, 500);
});

// ── categorizeAqi ────────────────────────────────────────────────────────

test('categorizeAqi: thresholds map per EPA US AQI scale', () => {
  assert.equal(categorizeAqi(null), 'unknown');
  assert.equal(categorizeAqi(0), 'good');
  assert.equal(categorizeAqi(50), 'good');
  assert.equal(categorizeAqi(51), 'moderate');
  assert.equal(categorizeAqi(100), 'moderate');
  assert.equal(categorizeAqi(101), 'sensitive');
  assert.equal(categorizeAqi(150), 'sensitive');
  assert.equal(categorizeAqi(151), 'unhealthy');
  assert.equal(categorizeAqi(200), 'unhealthy');
  assert.equal(categorizeAqi(201), 'very_unhealthy');
  assert.equal(categorizeAqi(300), 'very_unhealthy');
  assert.equal(categorizeAqi(301), 'hazardous');
  assert.equal(categorizeAqi(500), 'hazardous');
});

test('categorizeAqi: NaN / Infinity → unknown', () => {
  assert.equal(categorizeAqi(Number.NaN), 'unknown');
  assert.equal(categorizeAqi(Number.POSITIVE_INFINITY), 'unknown');
});
