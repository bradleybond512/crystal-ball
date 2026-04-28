import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShortageRadar,
  ALL_RADAR_COMMODITIES,
  type ShortageCommodity,
  type ShortageRadarRequest,
} from '../shortage-radar.ts';

const NOW = 1_745_000_000_000;

function input(value: number, source = 'test') {
  return { value, source, observedAt: NOW };
}

function req(commodity: ShortageCommodity, inputs: Record<string, ReturnType<typeof input>> = {}, region = 'global'): ShortageRadarRequest {
  return { commodity, region, inputs };
}

// ── Coverage ───────────────────────────────────────────────────────────

test('ALL_RADAR_COMMODITIES covers seven base commodities', () => {
  assert.equal(ALL_RADAR_COMMODITIES.length, 7);
  assert.ok(ALL_RADAR_COMMODITIES.includes('wheat'));
  assert.ok(ALL_RADAR_COMMODITIES.includes('coffee'));
});

test('empty input list → empty radar with friendly summary', () => {
  const r = buildShortageRadar([], { now: () => NOW });
  assert.equal(r.entries.length, 0);
  assert.match(r.summary, /No commodity feeds/);
});

// ── Sort + tier ────────────────────────────────────────────────────────

test('sorts by riskScore desc, then confidence desc', () => {
  const r = buildShortageRadar([
    req('wheat', { rainfall_pct_of_normal: input(50), local_wheat_price_mom: input(15) }),
    req('coffee', { frost_risk_index_brazil: input(85), arabica_futures_mom: input(8), roaster_inventory_weeks: input(4) }),
    req('corn', {}),
  ], { now: () => NOW });
  assert.ok(r.entries.length === 3);
  // Highest risk first
  for (let i = 1; i < r.entries.length; i += 1) {
    assert.ok(r.entries[i - 1].forecast.riskScore >= r.entries[i].forecast.riskScore);
  }
});

test('headline includes the right tier label', () => {
  const r = buildShortageRadar([
    req('coffee', {
      frost_risk_index_brazil: input(95),
      arabica_futures_mom: input(15),
      roaster_inventory_weeks: input(2),
      rainfall_pct_of_normal: input(40),
    }, 'BR'),
  ], { now: () => NOW });
  const tier = r.entries[0]?.headline ?? '';
  assert.ok(/CRITICAL|ELEVATED/.test(tier), `expected elevated/critical headline, got "${tier}"`);
});

// ── topDrivers + summary ───────────────────────────────────────────────

test('topDrivers caps at 3 entries', () => {
  const r = buildShortageRadar([
    req('wheat', {
      rainfall_pct_of_normal: input(50),
      soil_moisture_percentile: input(10),
      ndvi_anomaly: input(-0.3),
      fertilizer_price_yoy: input(40),
      local_wheat_price_mom: input(20),
      futures_curve_tightness: input(2),
      export_ban_count: input(3),
    }),
  ], { now: () => NOW });
  assert.ok(r.entries[0]?.topDrivers.length !== undefined);
  assert.ok(r.entries[0]!.topDrivers.length <= 3);
});

test('summary tallies tiers across commodities', () => {
  const r = buildShortageRadar([
    req('wheat', { rainfall_pct_of_normal: input(50), local_wheat_price_mom: input(15) }),
    req('corn', {}),
    req('diesel', {}),
  ], { now: () => NOW });
  assert.match(r.summary, /Commodities:/);
});

// ── Recommendations ────────────────────────────────────────────────────

test('recommendations only include commodities with riskScore >= 50', () => {
  const r = buildShortageRadar([
    req('coffee', {
      frost_risk_index_brazil: input(90),
      arabica_futures_mom: input(10),
      rainfall_pct_of_normal: input(50),
      roaster_inventory_weeks: input(3),
    }, 'BR'),
    req('corn', {}),
  ], { now: () => NOW });
  // Coffee should have a rec; corn (empty inputs, low risk) should not.
  assert.ok(r.recommendations.length >= 1);
  for (const rec of r.recommendations) {
    assert.match(rec, /CRITICAL|ELEVATED/);
  }
});

test('recommendations capped at 6 entries', () => {
  const r = buildShortageRadar(ALL_RADAR_COMMODITIES.map((c) => req(c, {
    rainfall_pct_of_normal: input(40),
    fertilizer_price_yoy: input(50),
    local_wheat_price_mom: input(20),
    soil_moisture_percentile: input(5),
  })), { now: () => NOW });
  assert.ok(r.recommendations.length <= 6);
});

// ── JSON serializability ──────────────────────────────────────────────

test('radar report is JSON-serializable', () => {
  const r = buildShortageRadar([req('wheat')], { now: () => NOW });
  const parsed = JSON.parse(JSON.stringify(r)) as { entries: unknown[] };
  assert.ok(Array.isArray(parsed.entries));
});
