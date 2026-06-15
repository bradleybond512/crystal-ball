/**
 * Tests for the deterministic Shortage Input Bridge — the pure layer
 * that maps already-fetched feed payloads into per-commodity input bags.
 * No fetch, no DOM — every test passes synthetic source data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShortageInputsFromSources,
  mergeShortageEntriesByFeedStatus,
  healthyCommodities,
  COMMODITY_SOURCE_FEEDS,
  type ChokepointSignal,
  type ShortageFeedId,
} from '../shortage-input-bridge.ts';
import {
  ALL_FULLSET_COMMODITIES,
  type FullSetCommodity,
  type RiskLevel,
  type ShortageSummaryEntry,
} from '../shortage-fullset.ts';
import type { DroughtState, DroughtSummary } from '@/services/drought-monitor';
import type { PowerGridAlert } from '@/services/power-grid-alerts';

const ALL_FEEDS_OK: Record<ShortageFeedId, boolean> = {
  'drought-monitor': true,
  'power-grid-alerts': true,
  'chokepoint-status': true,
};

function summaryEntry(commodity: FullSetCommodity, riskLevel: RiskLevel): ShortageSummaryEntry {
  // The merge only reads `commodity`; `riskLevel` is the marker we assert on.
  return { commodity, riskLevel, riskScore: 0, primaryDrivers: [], timeToImpact: '', trend: 'stable' } as unknown as ShortageSummaryEntry;
}

const NOW = Date.parse('2026-05-12T12:00:00Z');

function droughtState(abbr: string, severeBands: { d2?: number; d3?: number; d4?: number }): DroughtState {
  return {
    id: abbr,
    state: abbr,
    stateAbbr: abbr,
    validStart: new Date(NOW - 7 * 24 * 60 * 60 * 1000),
    validEnd: new Date(NOW),
    none: 0,
    d0: 0,
    d1: 0,
    d2: severeBands.d2 ?? 0,
    d3: severeBands.d3 ?? 0,
    d4: severeBands.d4 ?? 0,
    maxLevel: 'D2',
    severity: 'medium',
  };
}

function droughtSummary(states: DroughtState[]): DroughtSummary {
  return {
    states,
    validDate: new Date(NOW),
    nationalD3D4Pct: 0,
    fetchedAt: new Date(NOW),
  };
}

function gridAlert(overrides: Partial<PowerGridAlert>): PowerGridAlert {
  return {
    id: overrides.id ?? 'a1',
    title: overrides.title ?? '',
    description: overrides.description ?? '',
    source: overrides.source ?? 'NERC',
    region: overrides.region ?? 'Texas',
    alertType: overrides.alertType ?? 'warning',
    pubDate: overrides.pubDate ?? new Date(NOW),
    url: overrides.url ?? 'https://example.test',
    severity: overrides.severity ?? 'high',
  };
}

// ── Empty bundle ──────────────────────────────────────────────────────────

test('empty bundle returns empty record', () => {
  const r = buildShortageInputsFromSources({}, { now: NOW });
  assert.deepEqual(r, {});
});

test('drought with no grain-belt states leaves wheat/corn/soybeans untouched', () => {
  const r = buildShortageInputsFromSources(
    { drought: droughtSummary([droughtState('FL', { d2: 50 })]) },
    { now: NOW },
  );
  assert.equal(r.wheat, undefined);
  assert.equal(r.corn, undefined);
  assert.equal(r.soybeans, undefined);
});

// ── Drought → grains ──────────────────────────────────────────────────────

test('wheat-belt drought populates wheat soil_moisture + rainfall', () => {
  const r = buildShortageInputsFromSources(
    { drought: droughtSummary([
      droughtState('KS', { d2: 40, d3: 30, d4: 0 }),
      droughtState('ND', { d2: 20, d3: 0, d4: 0 }),
      droughtState('CA', { d2: 80 }), // non-belt — should not pull the mean down
    ]) },
    { now: NOW },
  );
  assert.ok(r.wheat, 'wheat bag exists');
  assert.ok(r.wheat.soil_moisture_percentile, 'soil_moisture_percentile present');
  assert.ok(r.wheat.rainfall_pct_of_normal, 'rainfall_pct_of_normal present');
  // KS d2+d3+d4 = 70, ND = 20, mean = 45 → soil_moisture_percentile = 55.
  assert.equal(r.wheat.soil_moisture_percentile.value, 55);
  // rainfall = 100 - 45*0.8 = 64 (rounded to 1 dp).
  assert.equal(r.wheat.rainfall_pct_of_normal.value, 64);
});

test('corn belt mean differs from wheat belt mean (Iowa-weighted)', () => {
  const r = buildShortageInputsFromSources(
    { drought: droughtSummary([
      droughtState('IA', { d2: 60, d3: 20 }),
      droughtState('IL', { d2: 0 }),
      droughtState('KS', { d2: 100 }), // wheat belt only, also corn belt 10th
    ]) },
    { now: NOW },
  );
  assert.ok(r.corn);
  assert.ok(r.wheat);
  assert.notEqual(r.corn.soil_moisture_percentile?.value, r.wheat.soil_moisture_percentile?.value);
});

test('drought inputs carry observedAt = fetchedAt and the right source tag', () => {
  const r = buildShortageInputsFromSources(
    { drought: droughtSummary([droughtState('IA', { d2: 30 })]) },
    { now: NOW },
  );
  assert.equal(r.corn?.soil_moisture_percentile?.observedAt, NOW);
  assert.equal(r.corn?.soil_moisture_percentile?.source, 'us-drought-monitor');
});

test('soil_moisture_percentile is clamped to [0, 100]', () => {
  const r = buildShortageInputsFromSources(
    { drought: droughtSummary([
      droughtState('IA', { d2: 60, d3: 35, d4: 10 }), // sum = 105, clamps to 100 severe
    ]) },
    { now: NOW },
  );
  const v = r.corn?.soil_moisture_percentile?.value ?? -1;
  assert.ok(v >= 0 && v <= 100, `soil_moisture_percentile out of range: ${v}`);
});

// ── Chokepoints ───────────────────────────────────────────────────────────

test('bosphorus block populates wheat export_corridor_status near 100', () => {
  const cp: ChokepointSignal = { key: 'bosphorus', disruptionScore: 80, status: 'blocked' };
  const r = buildShortageInputsFromSources({ chokepoints: [cp] }, { now: NOW });
  assert.ok(r.wheat?.export_corridor_status);
  // blocked floor = 85, base = 80, max = 85
  assert.equal(r.wheat.export_corridor_status.value, 85);
  assert.equal(r.wheat.export_corridor_status.source, 'chokepoint:bosphorus');
});

test('suez stressed → rice export_corridor_status with status floor applied', () => {
  const cp: ChokepointSignal = { key: 'suez', disruptionScore: 10, status: 'stressed' };
  const r = buildShortageInputsFromSources({ chokepoints: [cp] }, { now: NOW });
  // stressed floor = 30, base = 10
  assert.equal(r.rice?.export_corridor_status?.value, 30);
});

test('hormuz disruption produces a negative crude_imports_wow for diesel AND gasoline', () => {
  const cp: ChokepointSignal = { key: 'hormuz', disruptionScore: 100, status: 'blocked' };
  const r = buildShortageInputsFromSources({ chokepoints: [cp] }, { now: NOW });
  // 100 stress * -0.4 = -40
  assert.equal(r.diesel?.crude_imports_wow?.value, -40);
  assert.equal(r.gasoline?.crude_imports_wow?.value, -40);
});

test('open chokepoint with low score does not escalate', () => {
  const cp: ChokepointSignal = { key: 'bosphorus', disruptionScore: 5, status: 'open' };
  const r = buildShortageInputsFromSources({ chokepoints: [cp] }, { now: NOW });
  assert.equal(r.wheat?.export_corridor_status?.value, 5);
});

// ── Grid alerts → nat gas ─────────────────────────────────────────────────

test('cold snap alerts populate heating_degree_days_vs_normal + cold_snap flag', () => {
  const r = buildShortageInputsFromSources(
    {
      gridAlerts: [
        gridAlert({ title: 'Winter storm advisory', severity: 'high' }),
        gridAlert({ id: 'a2', description: 'Extreme cold expected', severity: 'critical' }),
      ],
    },
    { now: NOW },
  );
  assert.ok(r['natural-gas']);
  assert.equal(r['natural-gas'].heating_degree_days_vs_normal?.value, 16); // 2 alerts × 8
  assert.equal(r['natural-gas'].cold_snap_arrival_imminent?.value, 1);
});

test('heatwave alerts populate cooling_degree_days_vs_normal', () => {
  const r = buildShortageInputsFromSources(
    {
      gridAlerts: [
        gridAlert({ title: 'Heatwave warning', severity: 'high' }),
      ],
    },
    { now: NOW },
  );
  assert.equal(r['natural-gas']?.cooling_degree_days_vs_normal?.value, 8);
});

test('curtailment alerts set utility_curtailment_active', () => {
  const r = buildShortageInputsFromSources(
    {
      gridAlerts: [gridAlert({ description: 'Rolling blackout in progress', severity: 'critical' })],
    },
    { now: NOW },
  );
  assert.equal(r['natural-gas']?.utility_curtailment_active?.value, 1);
});

test('low-severity alerts are ignored', () => {
  const r = buildShortageInputsFromSources(
    {
      gridAlerts: [gridAlert({ title: 'Cold front advisory', severity: 'low' })],
    },
    { now: NOW },
  );
  assert.equal(r['natural-gas'], undefined);
});

test('HDD saturates at 60 even with many alerts', () => {
  const r = buildShortageInputsFromSources(
    {
      gridAlerts: Array.from({ length: 10 }, (_, i) =>
        gridAlert({ id: `c${i}`, title: 'Extreme cold', severity: 'high' }),
      ),
    },
    { now: NOW },
  );
  assert.equal(r['natural-gas']?.heating_degree_days_vs_normal?.value, 60);
});

// ── Cross-commodity merge ─────────────────────────────────────────────────

test('drought + bosphorus block both populate wheat without overwriting each other', () => {
  const r = buildShortageInputsFromSources(
    {
      drought: droughtSummary([droughtState('KS', { d2: 30 })]),
      chokepoints: [{ key: 'bosphorus', disruptionScore: 90, status: 'blocked' }],
    },
    { now: NOW },
  );
  assert.ok(r.wheat?.soil_moisture_percentile);
  assert.ok(r.wheat?.rainfall_pct_of_normal);
  assert.ok(r.wheat?.export_corridor_status);
});

test('output is JSON-serializable', () => {
  const r = buildShortageInputsFromSources(
    {
      drought: droughtSummary([droughtState('KS', { d2: 30 })]),
      chokepoints: [{ key: 'suez', disruptionScore: 50, status: 'disrupted' }],
      gridAlerts: [gridAlert({ title: 'Winter storm', severity: 'high' })],
    },
    { now: NOW },
  );
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
});

// ── Per-commodity feed map + fail-closed merge ──────────────────────────────

test('COMMODITY_SOURCE_FEEDS covers every commodity with valid feed ids', () => {
  const validFeeds: ShortageFeedId[] = ['drought-monitor', 'power-grid-alerts', 'chokepoint-status'];
  for (const commodity of ALL_FULLSET_COMMODITIES) {
    const deps = COMMODITY_SOURCE_FEEDS[commodity];
    assert.ok(deps, `${commodity} missing from COMMODITY_SOURCE_FEEDS`);
    for (const f of deps) assert.ok(validFeeds.includes(f), `${commodity} has invalid feed ${f}`);
  }
  // Matches what buildShortageInputsFromSources actually wires.
  assert.deepEqual([...COMMODITY_SOURCE_FEEDS.wheat].sort(), ['chokepoint-status', 'drought-monitor']);
  assert.deepEqual(COMMODITY_SOURCE_FEEDS.rice, ['chokepoint-status']);
  assert.deepEqual(COMMODITY_SOURCE_FEEDS['natural-gas'], ['power-grid-alerts']);
  assert.deepEqual(COMMODITY_SOURCE_FEEDS['jet-fuel'], []);
});

test('merge with all feeds OK takes every fresh entry', () => {
  const fresh = [summaryEntry('rice', 'LOW'), summaryEntry('corn', 'LOW')];
  const cached = [summaryEntry('rice', 'CRITICAL'), summaryEntry('corn', 'HIGH')];
  const merged = mergeShortageEntriesByFeedStatus(fresh, cached, ALL_FEEDS_OK);
  assert.deepEqual(merged.map((e) => e.riskLevel), ['LOW', 'LOW']);
});

test('merge keeps cached entry only for commodities whose feed is down', () => {
  // Chokepoint-status feed down, drought + grid healthy.
  const feedsOk: Record<ShortageFeedId, boolean> = {
    'drought-monitor': true,
    'power-grid-alerts': true,
    'chokepoint-status': false,
  };
  const fresh = [
    summaryEntry('rice', 'LOW'),      // deps chokepoint-status (down)  -> keep cached
    summaryEntry('diesel', 'LOW'),    // deps chokepoint-status (down)  -> keep cached
    summaryEntry('wheat', 'LOW'),     // deps drought + chokepoint-status (down) -> keep cached
    summaryEntry('corn', 'LOW'),      // deps drought (up)         -> take fresh
    summaryEntry('natural-gas', 'LOW'), // deps grid (up)          -> take fresh
    summaryEntry('jet-fuel', 'LOW'),  // no deps                   -> take fresh
  ];
  const cached = [
    summaryEntry('rice', 'CRITICAL'),
    summaryEntry('diesel', 'HIGH'),
    summaryEntry('wheat', 'CRITICAL'),
    summaryEntry('corn', 'CRITICAL'),     // stale; corn's feed is up so this is dropped
    summaryEntry('natural-gas', 'CRITICAL'),
    summaryEntry('jet-fuel', 'CRITICAL'),
  ];
  const byCommodity = new Map(
    mergeShortageEntriesByFeedStatus(fresh, cached, feedsOk).map((e) => [e.commodity, e.riskLevel]),
  );
  assert.equal(byCommodity.get('rice'), 'CRITICAL');     // preserved through outage
  assert.equal(byCommodity.get('diesel'), 'HIGH');       // preserved
  assert.equal(byCommodity.get('wheat'), 'CRITICAL');    // any dead dep preserves
  assert.equal(byCommodity.get('corn'), 'LOW');          // refreshed (feed up)
  assert.equal(byCommodity.get('natural-gas'), 'LOW');   // refreshed (feed up)
  assert.equal(byCommodity.get('jet-fuel'), 'LOW');      // no deps -> always fresh
});

test('merge falls back to fresh when a down-feed commodity has no cached entry', () => {
  // Cold-ish merge: chokepoint-status down, but no prior rice entry to preserve.
  const feedsOk: Record<ShortageFeedId, boolean> = {
    'drought-monitor': true,
    'power-grid-alerts': true,
    'chokepoint-status': false,
  };
  const merged = mergeShortageEntriesByFeedStatus([summaryEntry('rice', 'LOW')], [], feedsOk);
  assert.deepEqual(merged.map((e) => e.riskLevel), ['LOW']);
});
