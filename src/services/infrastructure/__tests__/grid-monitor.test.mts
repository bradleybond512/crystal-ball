import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EIA_REGIONS,
  buildGridSnapshot,
  isGridSnapshotFresh,
  buildOutageSummary,
  ageOutageSummary,
  selectActiveOutageSummary,
  resetActiveOutageSummary,
  buildBgpSummary,
  activeBgpEvents,
  countActiveBgpAlerts,
  isRadSummaryFresh,
  countActiveRadiationAlerts,
  buildRadSummary,
  severityFor,
  OUTAGE_REPORTED_THRESHOLDS,
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
    assert.equal(r.totalNetInterchangeMwh, null);
    assert.equal(r.balanceInterpretation, 'unknown');
    assert.equal((r as unknown as Record<string, unknown>).deltaMwh, undefined);
    assert.equal((r as unknown as Record<string, unknown>).status, undefined);
  }
});

test('grid: net generation below demand does not establish a supply deficit or imports', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'CISO', type: 'D', value: '1000000' },
    { period: '2026-05-05', respondent: 'CISO', type: 'NG', value: '950000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  const ciso = snap.regions.find((r) => r.region === 'CISO')!;
  assert.equal(ciso.demandMwh, 1_000_000);
  assert.equal(ciso.generationMwh, 950_000);
  assert.equal(ciso.totalNetInterchangeMwh, null);
  assert.equal(ciso.balanceInterpretation, 'unknown');
  assert.equal((ciso as unknown as Record<string, unknown>).status, undefined);
  assert.equal((ciso as unknown as Record<string, unknown>).deltaMwh, undefined);
});

test('grid: net generation above demand does not establish a surplus or exports', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'PJM', type: 'D', value: '1000000' },
    { period: '2026-05-05', respondent: 'PJM', type: 'NG', value: '1010000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  const pjm = snap.regions.find((r) => r.region === 'PJM')!;
  assert.equal(pjm.totalNetInterchangeMwh, null);
  assert.equal(pjm.balanceInterpretation, 'unknown');
  assert.equal((pjm as unknown as Record<string, unknown>).status, undefined);
  assert.equal((pjm as unknown as Record<string, unknown>).loadRatio, undefined);
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

test('grid: missing values preserve unknown balance context and isComplete=false', () => {
  const rows = [{ period: '2026-05-05', respondent: 'ERCO', type: 'D', value: '500000' }];
  const snap = buildGridSnapshot(rows, NOW);
  assert.equal(snap.isComplete, false);
  const erco = snap.regions.find((r) => r.region === 'ERCO')!;
  assert.equal(erco.generationMwh, null);
  assert.equal(erco.balanceInterpretation, 'unknown');
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
  assert.equal(isGridSnapshotFresh(snap, NOW), false);
});

test('grid: once-fresh descriptive observations age to unknown at the supplied clock', () => {
  const snap = buildGridSnapshot([
    { period: '2026-05-05', respondent: 'CISO', type: 'D', value: '1000000' },
    { period: '2026-05-05', respondent: 'CISO', type: 'NG', value: '950000' },
  ], NOW);
  assert.equal(isGridSnapshotFresh(snap, NOW), true);
  assert.equal(isGridSnapshotFresh(snap, NOW + 1), false);
});

test('grid: invalid and future civil dates cannot establish current conditions', () => {
  for (const period of ['2026-02-30', '2026-05-07', '2026-05-06T12:00:00Z']) {
    const snap = buildGridSnapshot([
      { period, respondent: 'CISO', type: 'D', value: '1000000' },
      { period, respondent: 'CISO', type: 'NG', value: '950000' },
    ], NOW);
    const ciso = snap.regions.find((region) => region.region === 'CISO');
    assert.equal(ciso?.demandMwh, null, period);
    assert.equal(ciso?.balanceInterpretation, 'unknown', period);
  }
});

test('grid: demand and generation from different daily periods cannot form a balance or alert', () => {
  const snap = buildGridSnapshot([
    { period: '2026-05-06', respondent: 'PJM', type: 'D', value: '100' },
    { period: '2026-05-05', respondent: 'PJM', type: 'NG', value: '50' },
  ], NOW);
  const pjm = snap.regions.find((region) => region.region === 'PJM');
  assert.equal(pjm?.demandMwh, 100);
  assert.equal(pjm?.generationMwh, 50);
  assert.equal(pjm?.totalNetInterchangeMwh, null);
  assert.equal(pjm?.balanceInterpretation, 'unknown');
  assert.equal((pjm as unknown as Record<string, unknown>).deltaMwh, undefined);
  assert.equal((pjm as unknown as Record<string, unknown>).status, undefined);
  assert.equal(pjm?.observedDate, null);
  assert.equal(snap.isComplete, false);
  assert.equal(isGridSnapshotFresh(snap, NOW), false);
});

test('grid: snapshot is JSON-serializable', () => {
  const rows = [
    { period: '2026-05-05', respondent: 'NYIS', type: 'D', value: '300000' },
    { period: '2026-05-05', respondent: 'NYIS', type: 'NG', value: '305000' },
  ];
  const snap = buildGridSnapshot(rows, NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
});

// ─── ORNL ODIN exact-county outage context ────────────────────────────

function odinCondition(customersOut: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `odin:${customersOut}`,
    type: 'power_outage',
    source: 'ornl-odin',
    coverage: 'reported',
    countyFips: '18091',
    county: 'LaPorte',
    state: 'Indiana',
    customersOut,
    utilityName: `Utility ${customersOut}`,
    utilityId: `u-${customersOut}`,
    observedAt: new Date(NOW - 5 * 60_000),
    retrievedAt: new Date(NOW - 5 * 60_000),
    expiresAt: new Date(NOW + 25 * 60_000),
    ...over,
  };
}

function odinSnapshot(
  conditions: Record<string, unknown>[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    placeId: 'home',
    placeName: 'Home',
    countyFips: '18091',
    areaConditions: conditions,
    providers: [{
      id: 'ornl-odin',
      state: 'ok',
      acceptedRows: conditions.length,
      droppedRows: 0,
      observedAt: new Date(NOW - 5 * 60_000),
      retrievedAt: new Date(NOW - 5 * 60_000),
    }],
    ...over,
  };
}

test('outage: an accepted ODIN zero stays reported, never becomes unknown or an all-clear', () => {
  const sum = buildOutageSummary(odinSnapshot([odinCondition(0)]), NOW);
  assert.equal(sum.coverage, 'reported');
  assert.equal(sum.reportedCustomersOut, 0);
  assert.equal(sum.reportCount, 1);
  assert.equal(sum.severity, 'normal');
});

test('outage: accepted utility reports aggregate and sort without becoming a county total claim', () => {
  const sum = buildOutageSummary(odinSnapshot([
    odinCondition(10, { utilityName: 'Small', customersRestored: 2 }),
    odinCondition(25, { utilityName: 'Large' }),
  ], {
    providers: [{
      id: 'ornl-odin', state: 'partial', acceptedRows: 2, droppedRows: 1,
      observedAt: new Date(NOW - 5 * 60_000), retrievedAt: new Date(NOW - 5 * 60_000),
    }],
  }), NOW);
  assert.equal(sum.reportedCustomersOut, 35);
  assert.equal(sum.reportedCustomersRestored, null);
  assert.equal(sum.completeness, 'partial');
  assert.deepEqual(sum.reports.map((report) => report.utility), ['Large', 'Small']);
  assert.equal(sum.countyFips, '18091');
});

test('outage: a fresh empty ODIN response is unknown, not a known zero', () => {
  const sum = buildOutageSummary(odinSnapshot([], {
    providers: [{
      id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0,
      observedAt: new Date(NOW), retrievedAt: new Date(NOW),
    }],
  }), NOW);
  assert.equal(sum.coverage, 'unknown');
  assert.equal(sum.reportedCustomersOut, null);
  assert.equal(sum.unknownReason, 'no_accepted_reports');
  assert.equal(sum.badge.isStale, false);
});

test('outage: expired reports fail closed to unknown and discard the old count', () => {
  const sum = buildOutageSummary(odinSnapshot([
    odinCondition(700, { expiresAt: new Date(NOW) }),
  ]), NOW);
  assert.equal(sum.coverage, 'unknown');
  assert.equal(sum.reportedCustomersOut, null);
  assert.equal(sum.reports.length, 0);
  assert.equal(sum.unknownReason, 'expired_reports');
  assert.equal(sum.badge.isStale, true);
});

test('outage: row/provider count mismatch and wrong county FIPS fail closed', () => {
  const countMismatch = odinSnapshot([odinCondition(10)], {
    providers: [{
      id: 'ornl-odin', state: 'ok', acceptedRows: 2, droppedRows: 0,
      observedAt: new Date(NOW), retrievedAt: new Date(NOW),
    }],
  });
  const wrongCounty = odinSnapshot([odinCondition(10, { countyFips: '06037' })]);
  assert.equal(buildOutageSummary(countMismatch, NOW).unknownReason, 'malformed_snapshot');
  assert.equal(buildOutageSummary(wrongCounty, NOW).unknownReason, 'malformed_snapshot');
});

test('outage: ageOutageSummary expires a previously accepted report without the raw snapshot', () => {
  const accepted = buildOutageSummary(odinSnapshot([odinCondition(50)]), NOW);
  const aged = ageOutageSummary(accepted, NOW + 26 * 60_000);
  assert.equal(aged.coverage, 'unknown');
  assert.equal(aged.reportedCustomersOut, null);
  assert.equal(aged.unknownReason, 'expired_reports');
});

test('outage: active A ignores a later background-prewarm snapshot for B', () => {
  const activeA = buildOutageSummary(odinSnapshot([odinCondition(25)]), NOW);
  const backgroundB = buildOutageSummary(odinSnapshot([
    odinCondition(900, { countyFips: '06037', county: 'Los Angeles', state: 'California' }),
  ], {
    placeId: 'bugout', placeName: 'Bugout', countyFips: '06037',
  }), NOW);
  const selected = selectActiveOutageSummary(activeA, backgroundB, 'home', NOW);
  assert.equal(selected.placeId, 'home');
  assert.equal(selected.reportedCustomersOut, 25);
});

test('outage: switching active A to B clears A before any B snapshot arrives', () => {
  const activeA = buildOutageSummary(odinSnapshot([odinCondition(25)]), NOW);
  const pendingB = selectActiveOutageSummary(activeA, null, 'bugout', NOW);
  assert.equal(pendingB.placeId, null);
  assert.equal(pendingB.coverage, 'unknown');
  assert.equal(pendingB.reportedCustomersOut, null);
  assert.equal(pendingB.unknownReason, 'awaiting_lifeline_context');
});

test('outage: same-ID place edit is a hard boundary when the new exact cache is absent', () => {
  const oldFingerprintA = buildOutageSummary(odinSnapshot([odinCondition(25)]), NOW);
  const afterEdit = resetActiveOutageSummary(null, 'home', NOW);
  assert.equal(oldFingerprintA.placeId, 'home');
  assert.equal(afterEdit.placeId, null);
  assert.equal(afterEdit.coverage, 'unknown');
  assert.equal(afterEdit.reportedCustomersOut, null);
  assert.equal(afterEdit.unknownReason, 'awaiting_lifeline_context');
});

test('outage: active-place boundary may seed only an exact current-place cache', () => {
  const exactCurrentA = buildOutageSummary(odinSnapshot([odinCondition(25)]), NOW);
  const seeded = resetActiveOutageSummary(exactCurrentA, 'home', NOW);
  const rejectedOtherPlace = resetActiveOutageSummary(exactCurrentA, 'bugout', NOW);
  assert.equal(seeded.reportedCustomersOut, 25);
  assert.equal(rejectedOtherPlace.coverage, 'unknown');
  assert.equal(rejectedOtherPlace.reportedCustomersOut, null);
});

test('outage: reported-count display bands are scoped and deterministic', () => {
  assert.equal(severityFor(0, OUTAGE_REPORTED_THRESHOLDS), 'normal');
  assert.equal(severityFor(1, OUTAGE_REPORTED_THRESHOLDS), 'elevated');
  assert.equal(severityFor(10_000, OUTAGE_REPORTED_THRESHOLDS), 'high');
  assert.equal(severityFor(50_000, OUTAGE_REPORTED_THRESHOLDS), 'major');
  assert.equal(severityFor(100_000, OUTAGE_REPORTED_THRESHOLDS), 'extreme');
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
  assert.equal(sum.coverage, 'reported');
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
      ended_at: null,
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
    { id: 'a', started_at: '2026-05-06T10:00:00Z', ended_at: null, prefixes: ['203.0.113.0/24'], expected_origin: null, detected_origins: [], involved_asns: ['1'], type: '' },
    { id: 'b', started_at: '2026-05-06T11:00:00Z', ended_at: null, prefixes: ['1.1.1.0/24'], expected_origin: '13335', detected_origins: ['666'], involved_asns: ['666'], type: '' },
    { id: 'c', started_at: '2026-05-06T11:30:00Z', ended_at: null, prefixes: ['203.0.113.0/24'], expected_origin: '111', detected_origins: ['222'], involved_asns: ['222'], type: '' },
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
  assert.equal(sum.coverage, 'unknown');
  assert.match(sum.error ?? '', /no valid event rows/i);
});

test('bgp: a valid empty provider response remains reported zero', () => {
  const sum = buildBgpSummary([], NOW);
  assert.equal(sum.coverage, 'reported');
  assert.equal(sum.events.length, 0);
  assert.equal(sum.acceptedRows, 0);
  assert.equal(sum.error, null);
});

test('bgp: missing, invalid, or backwards lifecycle timestamps cannot become active', () => {
  const base = {
    prefixes: ['1.1.1.0/24'], expected_origin: '13335', detected_origins: ['64512'],
    involved_asns: ['64512'], type: 'BGP_HIJACK',
  };
  for (const row of [
    { ...base, id: 'missing-end', started_at: '2026-05-06T11:00:00Z' },
    { ...base, id: 'invalid-end', started_at: '2026-05-06T11:00:00Z', ended_at: 'bad' },
    { ...base, id: 'backwards-end', started_at: '2026-05-06T11:00:00Z', ended_at: '2026-05-06T10:00:00Z' },
  ]) {
    const sum = buildBgpSummary([row], NOW);
    assert.equal(sum.coverage, 'unknown', row.id);
    assert.equal(activeBgpEvents(sum, NOW).length, 0, row.id);
  }
});

test('bgp: active alert projection rejects ended events but preserves future-ended and open events', () => {
  const sum = buildBgpSummary([
    {
      id: 'ended-critical', started_at: '2026-05-06T10:00:00Z', ended_at: '2026-05-06T11:59:59Z',
      prefixes: ['1.1.1.0/24'], expected_origin: '13335', detected_origins: ['64512'],
      involved_asns: ['64512'], type: 'BGP_HIJACK',
    },
    {
      id: 'future-ended-critical', started_at: '2026-05-06T11:30:00Z', ended_at: '2026-05-06T12:00:01Z',
      prefixes: ['8.8.8.0/24'], expected_origin: '15169', detected_origins: ['64513'],
      involved_asns: ['64513'], type: 'BGP_HIJACK',
    },
    {
      id: 'open-elevated', started_at: '2026-05-06T11:45:00Z', ended_at: null,
      prefixes: ['203.0.113.0/24'], expected_origin: '64496', detected_origins: ['64514'],
      involved_asns: ['64514'], type: 'BGP_HIJACK',
    },
  ], NOW);

  assert.deepEqual(activeBgpEvents(sum, NOW).map((event) => event.id), [
    'future-ended-critical', 'open-elevated',
  ]);
  assert.deepEqual(countActiveBgpAlerts(sum, NOW), { critical: 1, elevated: 1 });
  assert.equal(sum.criticalCount, 2, '24-hour provider totals remain distinct from active alerts');
});

test('bgp: active alert projection ages a once-fresh summary to stale using the supplied clock', () => {
  const sum = buildBgpSummary([{
    id: 'open-critical', started_at: '2026-05-05T12:00:00Z', ended_at: null,
    prefixes: ['1.1.1.0/24'], expected_origin: '13335', detected_origins: ['64512'],
    involved_asns: ['64512'], type: 'BGP_HIJACK',
  }], NOW, {
    coverage: 'reported', error: null, retrievedAt: NOW, droppedRows: 0,
  });

  assert.equal(sum.badge.isStale, false, 'freshness follows provider retrieval, not event start time');
  assert.equal(activeBgpEvents(sum, NOW).length, 1);
  assert.deepEqual(countActiveBgpAlerts(sum, NOW + 60 * 60_000 + 1), { critical: 0, elevated: 0 });
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

test('rad: a nonempty response with zero valid CPM readings is unknown', () => {
  const sum = buildRadSummary([
    { StationName: 'Anywhere', Latitude: 0, Longitude: 0 },
  ], NOW);
  assert.equal(sum.coverage, 'unknown');
  assert.equal(sum.maxCpm, null);
  assert.equal(sum.severity, null);
  assert.equal(sum.droppedRows, 1);
});

test('rad: an explicitly empty provider response is reported, not malformed', () => {
  const sum = buildRadSummary([], NOW);
  assert.equal(sum.coverage, 'reported');
  assert.equal(sum.stationCount, 0);
  assert.equal(sum.severity, 'normal');
  assert.equal(sum.maxCpm, null);
});

test('rad: a real zero-CPM reading is accepted as reported background evidence', () => {
  const sum = buildRadSummary([
    { StationName: 'Zero, NM', GammaCpm: 0, Latitude: 0, Longitude: 0, SampleDateTime: '2026-05-06T11:00:00Z' },
  ], NOW);
  assert.equal(sum.coverage, 'reported');
  assert.equal(sum.stationCount, 1);
  assert.equal(sum.acceptedRows, 1);
  assert.equal(sum.maxCpm, 0);
  assert.equal(sum.severity, 'normal');
});

test('rad: negative, nonfinite, empty, and numeric-prefix CPM values are rejected', () => {
  const sum = buildRadSummary([
    { StationName: 'negative', GammaCpm: -1 },
    { StationName: 'infinite', GammaCpm: Number.POSITIVE_INFINITY },
    { StationName: 'empty', GammaCpm: ' ' },
    { StationName: 'suffix', GammaCpm: '150 junk' },
  ], NOW);
  assert.equal(sum.coverage, 'unknown');
  assert.equal(sum.acceptedRows, 0);
  assert.equal(sum.droppedRows, 4);
  assert.equal(sum.severity, null);
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

test('rad: active projection ages elevated and reported-zero evidence with the supplied clock', () => {
  const elevated = buildRadSummary([{
    StationName: 'Alert, IN', GammaCpm: 250, Latitude: 41.6, Longitude: -86.7,
    SampleDateTime: '2026-05-06T11:00:00Z',
  }], NOW);
  const reportedZero = buildRadSummary([], NOW, {
    coverage: 'reported', error: null, retrievedAt: NOW, droppedRows: 0,
  });

  assert.equal(isRadSummaryFresh(elevated, NOW), true);
  assert.equal(countActiveRadiationAlerts(elevated, NOW), 1);
  assert.equal(isRadSummaryFresh(reportedZero, NOW), true);
  assert.equal(isRadSummaryFresh(elevated, NOW + 6 * 60 * 60_000 + 1), false);
  assert.equal(countActiveRadiationAlerts(elevated, NOW + 6 * 60 * 60_000 + 1), 0);
  assert.equal(isRadSummaryFresh(reportedZero, NOW + 6 * 60 * 60_000 + 1), false);
});

test('rad: missing, invalid, or future sample times cannot become current evidence', () => {
  for (const row of [
    { StationName: 'missing-time', GammaCpm: 250 },
    { StationName: 'invalid-time', GammaCpm: 250, SampleDateTime: 'bad' },
    { StationName: 'future-time', GammaCpm: 250, SampleDateTime: '2026-05-06T12:05:00.001Z' },
  ]) {
    const sum = buildRadSummary([row], NOW);
    assert.equal(sum.coverage, 'unknown', row.StationName);
    assert.equal(countActiveRadiationAlerts(sum, NOW), 0, row.StationName);
  }
});
