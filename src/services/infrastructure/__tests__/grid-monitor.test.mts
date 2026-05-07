import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EIA_REGIONS,
  buildGridSnapshot,
  buildOutageSummary,
  buildBgpSummary,
  buildRadSummary,
  severityFor,
  OUTAGE_NATIONAL_THRESHOLDS,
  OUTAGE_STATE_THRESHOLDS,
  RADIATION_THRESHOLDS,
  RADIATION_BACKGROUND_CPM,
  KNOWN_PREFIX_TAGS,
} from '../grid-monitor.ts';

const NOW = Date.UTC(2026, 4, 6, 12, 0, 0); // 2026-05-06T12:00Z

// ─── EIA grid snapshot ────────────────────────────────────────────────

test('grid: snapshot covers all five EIA regions', () => {
  const rows = EIA_REGIONS.flatMap((region) => [
    { period: '2026-05-05', respondent: region, type: 'D', value: '500000' },
    { period: '2026-05-05', respondent: region, type: 'NG', value: '510000' },
  ]);
  const snap = buildGridSnapshot(rows, NOW);
  assert.equal(snap.regions.length, 5);
  assert.equal(snap.isComplete, true);
  for (const r of snap.regions) {
    assert.equal(r.demandMwh, 500_000);
    assert.equal(r.generationMwh, 510_000);
    assert.equal(r.deltaMwh, 10_000);
    assert.equal(r.status, 'surplus');
  }
});

test('grid: deficit when demand > generation by >2%', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'CISO', type: 'D', value: '1000000' },
    { period: '2026-05-05', respondent: 'CISO', type: 'NG', value: '950000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  const ciso = snap.regions.find((r) => r.region === 'CISO')!;
  assert.equal(ciso.status, 'deficit');
  assert.equal(ciso.deltaMwh, -50_000);
});

test('grid: balanced when |delta/demand| < 2%', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'PJM', type: 'D', value: '1000000' },
    { period: '2026-05-05', respondent: 'PJM', type: 'NG', value: '1010000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  const pjm = snap.regions.find((r) => r.region === 'PJM')!;
  assert.equal(pjm.status, 'balanced');
});

test('grid: latest period wins per (region, type)', () => {
  const rows = [
    { period: '2026-05-04', respondent: 'CISO', type: 'D', value: '100000' },
    { period: '2026-05-05', respondent: 'CISO', type: 'D', value: '200000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  const ciso = snap.regions.find((r) => r.region === 'CISO')!;
  assert.equal(ciso.demandMwh, 200_000);
});

test('grid: missing values produce status=unknown, isComplete=false', () => {
  const rows = [{ period: '2026-05-05', respondent: 'ERCO', type: 'D', value: '500000' }];
  const snap = buildGridSnapshot(rows, NOW);
  assert.equal(snap.isComplete, false);
  const erco = snap.regions.find((r) => r.region === 'ERCO')!;
  assert.equal(erco.status, 'unknown');
  assert.equal(erco.generationMwh, null);
});

test('grid: rows for unknown respondents are dropped', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'AEC', type: 'D', value: '50000' },
    { period: '2026-05-05', respondent: 'AEC', type: 'NG', value: '52000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  for (const r of snap.regions) {
    assert.equal(r.demandMwh, null);
  }
});

test('grid: stale badge fires when the latest period is older than 36h', () => {
  const rows = [
    { period: '2026-05-01', respondent: 'CISO', type: 'D', value: '500000' },
    { period: '2026-05-01', respondent: 'CISO', type: 'NG', value: '510000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  assert.equal(snap.badge.isStale, true);
});

test('grid: snapshot is JSON-serializable', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'NYIS', type: 'D', value: '300000' },
    { period: '2026-05-05', respondent: 'NYIS', type: 'NG', value: '305000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
});

// ─── PowerOutage.us ───────────────────────────────────────────────────

test('outage: top counties sorted descending by customers-affected', () => {
  const rows = [
    { StateName: 'TX', CountyName: 'Harris', CustomersAffected: 12000, CustomersTracked: 1_500_000 },
    { StateName: 'TX', CountyName: 'Dallas', CustomersAffected: 30000, CustomersTracked: 1_000_000 },
    { StateName: 'CA', CountyName: 'Los Angeles', CustomersAffected: 50000, CustomersTracked: 4_000_000 },
  ];
  const sum = buildOutageSummary(rows, NOW, 2);
  assert.equal(sum.topCounties.length, 2);
  assert.equal(sum.topCounties[0]!.county, 'Los Angeles');
  assert.equal(sum.topCounties[1]!.county, 'Dallas');
});

test('outage: zero-affected entries are dropped', () => {
  const rows = [
    { StateName: 'TX', CountyName: 'Harris', CustomersAffected: 0, CustomersTracked: 1_500_000 },
    { StateName: 'TX', CountyName: 'Dallas', CustomersAffected: 100, CustomersTracked: 1_000_000 },
  ];
  const sum = buildOutageSummary(rows, NOW);
  assert.equal(sum.countyCount, 1);
  assert.equal(sum.nationalCustomersAffected, 100);
});

test('outage: state rollup aggregates customers + counties', () => {
  const rows = [
    { StateName: 'TX', CountyName: 'A', CustomersAffected: 10, CustomersTracked: 100 },
    { StateName: 'TX', CountyName: 'B', CustomersAffected: 20, CustomersTracked: 100 },
    { StateName: 'TX', CountyName: 'C', CustomersAffected: 30, CustomersTracked: 100 },
    { StateName: 'CA', CountyName: 'X', CustomersAffected: 5, CustomersTracked: 100 },
  ];
  const sum = buildOutageSummary(rows, NOW);
  const tx = sum.byState.find((s) => s.state === 'TX')!;
  assert.equal(tx.customersAffected, 60);
  assert.equal(tx.countyCount, 3);
  assert.equal(tx.topCounty, 'C');
});

test('outage: severity ladder', () => {
  assert.equal(severityFor(0, OUTAGE_NATIONAL_THRESHOLDS), 'normal');
  assert.equal(severityFor(300_000, OUTAGE_NATIONAL_THRESHOLDS), 'elevated');
  assert.equal(severityFor(1_500_000, OUTAGE_NATIONAL_THRESHOLDS), 'high');
  assert.equal(severityFor(4_000_000, OUTAGE_NATIONAL_THRESHOLDS), 'major');
  assert.equal(severityFor(9_000_000, OUTAGE_NATIONAL_THRESHOLDS), 'extreme');
});

test('outage: state severity uses lower thresholds than national', () => {
  // 60k state-wide should be elevated, but only 60k nationally is still normal.
  assert.equal(severityFor(60_000, OUTAGE_STATE_THRESHOLDS), 'elevated');
  assert.equal(severityFor(60_000, OUTAGE_NATIONAL_THRESHOLDS), 'normal');
});

test('outage: empty input produces normal severity + zero counts', () => {
  const sum = buildOutageSummary([], NOW);
  assert.equal(sum.nationalCustomersAffected, 0);
  assert.equal(sum.severity, 'normal');
  assert.equal(sum.countyCount, 0);
});

// ─── BGP / Cloudflare Radar ───────────────────────────────────────────

test('bgp: critical when known prefix has a detected origin ≠ expected', () => {
  const sum = buildBgpSummary([
    {
      id: 'evt-1',
      started_at: '2026-05-06T11:00:00Z',
      ended_at: null,
      prefixes: ['8.8.8.0/24'],
      expected_origin: '15169', // Google
      detected_origins: ['64512'], // bogus AS
      involved_asns: ['64512'],
      type: 'BGP_HIJACK',
    },
  ], NOW);
  assert.equal(sum.events[0]!.severity, 'critical');
  assert.deepEqual(sum.events[0]!.tags, ['google-dns']);
  assert.equal(sum.criticalCount, 1);
});

test('bgp: elevated when unexpected origin but no known-prefix tag', () => {
  const sum = buildBgpSummary([
    {
      id: 'evt-2',
      started_at: '2026-05-06T11:30:00Z',
      ended_at: '2026-05-06T11:45:00Z',
      prefixes: ['203.0.113.0/24'],
      expected_origin: '12345',
      detected_origins: ['67890'],
      involved_asns: ['67890'],
      type: 'BGP_HIJACK',
    },
  ], NOW);
  assert.equal(sum.events[0]!.severity, 'elevated');
});

test('bgp: info when no escalation signals', () => {
  const sum = buildBgpSummary([
    {
      id: 'evt-3',
      started_at: '2026-05-06T11:00:00Z',
      prefixes: ['203.0.113.0/24'],
      expected_origin: null,
      detected_origins: [],
      involved_asns: ['12345'],
      type: 'BGP_LEAK',
    },
  ], NOW);
  assert.equal(sum.events[0]!.severity, 'info');
});

test('bgp: events sorted critical → elevated → info, then by recency', () => {
  const sum = buildBgpSummary([
    { id: 'a', started_at: '2026-05-06T10:00:00Z', prefixes: ['203.0.113.0/24'], expected_origin: null, detected_origins: [], involved_asns: ['1'], type: '' },
    { id: 'b', started_at: '2026-05-06T11:00:00Z', prefixes: ['1.1.1.0/24'], expected_origin: '13335', detected_origins: ['666'], involved_asns: ['666'], type: '' },
    { id: 'c', started_at: '2026-05-06T11:30:00Z', prefixes: ['203.0.113.0/24'], expected_origin: '111', detected_origins: ['222'], involved_asns: ['222'], type: '' },
  ], NOW);
  assert.deepEqual(sum.events.map((e) => e.id), ['b', 'c', 'a']);
});

test('bgp: well-known prefix table covers DNS + CDN + cloud', () => {
  assert.ok(KNOWN_PREFIX_TAGS.some((t) => t.tag === 'google-dns'));
  assert.ok(KNOWN_PREFIX_TAGS.some((t) => t.tag === 'cloudflare-dns'));
  assert.ok(KNOWN_PREFIX_TAGS.some((t) => t.tag === 'fastly'));
});

test('bgp: events without prefixes or ASNs are dropped', () => {
  const sum = buildBgpSummary([
    { id: 'empty', started_at: '2026-05-06T11:00:00Z', prefixes: [], involved_asns: [], detected_origins: [], expected_origin: null, type: '' },
  ], NOW);
  assert.equal(sum.events.length, 0);
});

// ─── EPA RadNet ───────────────────────────────────────────────────────

test('rad: stations >100 CPM are flagged elevated', () => {
  const sum = buildRadSummary([
    { StationName: 'Atlanta, GA', GammaCpm: 80, Latitude: 33.7, Longitude: -84.4, SampleDateTime: '2026-05-06T11:00:00Z' },
    { StationName: 'Tokyo, JP', GammaCpm: 150, Latitude: 35.7, Longitude: 139.7, SampleDateTime: '2026-05-06T11:00:00Z' },
    { StationName: 'Fukushima, JP', GammaCpm: 800, Latitude: 37.4, Longitude: 140.5, SampleDateTime: '2026-05-06T11:00:00Z' },
  ], NOW);
  assert.equal(sum.elevatedStations.length, 2);
  assert.equal(sum.elevatedStations[0]!.name, 'Fukushima, JP');
  assert.equal(sum.elevatedStations[0]!.severity, 'major');
  assert.equal(sum.maxCpm, 800);
  assert.equal(sum.severity, 'major');
});

test('rad: severity ladder rounds correctly at boundaries', () => {
  assert.equal(severityFor(99, RADIATION_THRESHOLDS), 'normal');
  assert.equal(severityFor(100, RADIATION_THRESHOLDS), 'elevated');
  assert.equal(severityFor(200, RADIATION_THRESHOLDS), 'high');
  assert.equal(severityFor(500, RADIATION_THRESHOLDS), 'major');
  assert.equal(severityFor(1000, RADIATION_THRESHOLDS), 'extreme');
});

test('rad: state extracted from "City, ST" station name', () => {
  const sum = buildRadSummary([
    { StationName: 'Boise, ID', GammaCpm: 60, Latitude: 43.6, Longitude: -116.2, SampleDateTime: '2026-05-06T11:00:00Z' },
  ], NOW);
  assert.equal(sum.elevatedStations.length, 0);
  assert.equal(RADIATION_BACKGROUND_CPM, 100);
});

test('rad: missing CPM stations do not crash', () => {
  const sum = buildRadSummary([
    { StationName: 'Anywhere', Latitude: 0, Longitude: 0 },
  ], NOW);
  assert.equal(sum.maxCpm, null);
  assert.equal(sum.severity, 'normal');
});

test('rad: empty input → normal severity', () => {
  const sum = buildRadSummary([], NOW);
  assert.equal(sum.stationCount, 0);
  assert.equal(sum.severity, 'normal');
  assert.equal(sum.maxCpm, null);
});

test('rad: stale badge fires when newest sample is older than 6h', () => {
  const sum = buildRadSummary([
    { StationName: 'X', GammaCpm: 50, SampleDateTime: '2026-05-05T11:00:00Z' },
  ], NOW);
  assert.equal(sum.badge.isStale, true);
});

test('rad: result is JSON-serializable', () => {
  const sum = buildRadSummary([
    { StationName: 'X, NM', GammaCpm: 250, Latitude: 35, Longitude: -106, SampleDateTime: '2026-05-06T11:00:00Z' },
  ], NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(sum)), sum);
});
