import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_PLAYBOOKS,
  WHEAT_PLAYBOOK,
  DIESEL_PLAYBOOK,
  getPlaybook,
  isSeasonalRisk,
} from '../commodity-playbooks.ts';
import { computeWheatShortageRisk } from '../wheat-shortage-risk.ts';
import { computeDieselShortageRisk } from '../diesel-shortage-risk.ts';
import type { ShortageInput } from '../shortage-types.ts';

const NOW = Date.UTC(2026, 3, 27, 12, 0, 0); // 2026-04-27 — wheat in-season, diesel out-of-season

function input(value: number, source = 'src1', ageMs = 0): ShortageInput {
  return { value, observedAt: NOW - ageMs, source };
}

// ── Playbook hygiene ────────────────────────────────────────────────────

test('ALL_PLAYBOOKS: has wheat and diesel', () => {
  const commodities = ALL_PLAYBOOKS.map((p) => p.commodity);
  assert.ok(commodities.includes('wheat'));
  assert.ok(commodities.includes('diesel'));
});

test('getPlaybook: case-insensitive lookup', () => {
  assert.equal(getPlaybook('WHEAT')?.commodity, 'wheat');
  assert.equal(getPlaybook('Diesel')?.commodity, 'diesel');
  assert.equal(getPlaybook('unknown'), undefined);
});

test('isSeasonalRisk: respects month membership', () => {
  assert.equal(isSeasonalRisk(WHEAT_PLAYBOOK, 4), true);  // April: in season
  assert.equal(isSeasonalRisk(WHEAT_PLAYBOOK, 1), false); // January: out
  assert.equal(isSeasonalRisk(DIESEL_PLAYBOOK, 8), true); // August: hurricane season
});

test('every playbook has nonempty leading + confirming + invalidating + chokepoints', () => {
  for (const p of ALL_PLAYBOOKS) {
    assert.ok(p.leadingIndicators.length > 0, `${p.commodity} leading`);
    assert.ok(p.confirmingIndicators.length > 0, `${p.commodity} confirming`);
    assert.ok(p.invalidatingIndicators.length > 0, `${p.commodity} invalidating`);
    assert.ok(p.chokepoints.length > 0, `${p.commodity} chokepoints`);
    assert.ok(p.affectedCountries.length > 0, `${p.commodity} countries`);
    assert.ok(p.forecastHorizonDays > 0);
  }
});

// ── Wheat model ─────────────────────────────────────────────────────────

test('wheat: drought + corridor disruption + price spike → high risk', () => {
  const f = computeWheatShortageRisk(
    {
      rainfall_pct_of_normal: input(45, 'noaa'),
      soil_moisture_percentile: input(8, 'usda'),
      ndvi_anomaly: input(-0.18, 'usgs'),
      fertilizer_price_yoy: input(40, 'worldbank'),
      export_corridor_status: input(75, 'gdacs'),
      local_wheat_price_mom: input(18, 'fao'),
      futures_curve_tightness: input(4, 'cme'),
      fews_net_stage: input(3, 'fewsnet'),
    },
    { region: 'Black Sea Basin', now: NOW },
  );
  assert.equal(f.commodity, 'wheat');
  assert.equal(f.region, 'Black Sea Basin');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(['medium', 'high'].includes(f.confidence));
  assert.ok(f.drivers.some((d) => d.kind === 'production'));
  assert.ok(f.drivers.some((d) => d.kind === 'transport'));
  assert.ok(f.drivers.some((d) => d.kind === 'price'));
});

test('wheat: deterministic for same inputs', () => {
  const inputs = {
    rainfall_pct_of_normal: input(60),
    soil_moisture_percentile: input(20),
    fertilizer_price_yoy: input(15),
    export_corridor_status: input(0),
    local_wheat_price_mom: input(2),
  };
  const a = computeWheatShortageRisk(inputs, { region: 'X', now: NOW });
  const b = computeWheatShortageRisk(inputs, { region: 'X', now: NOW });
  assert.equal(a.riskScore, b.riskScore);
  assert.deepEqual(a.drivers, b.drivers);
});

test('wheat: missing inputs become data gaps, confidence drops', () => {
  const f = computeWheatShortageRisk(
    { rainfall_pct_of_normal: input(60, 'noaa') }, // only one input
    { region: 'X', now: NOW },
  );
  assert.ok(f.dataGaps.length >= 4);
  assert.equal(f.confidence, 'low');
});

test('wheat: stale inputs reduce confidence (do not silently disappear)', () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  const f = computeWheatShortageRisk(
    {
      rainfall_pct_of_normal: input(45, 'noaa', 4 * week), // very stale
      soil_moisture_percentile: input(10, 'usda', 4 * week),
      fertilizer_price_yoy: input(30, 'worldbank', 4 * week),
      export_corridor_status: input(60, 'gdacs', 4 * week),
      local_wheat_price_mom: input(15, 'fao', 4 * week),
    },
    { region: 'X', now: NOW },
  );
  // Should still produce a forecast with the drivers, but confidence
  // should reflect the staleness either via gaps or worstFreshness.
  assert.notEqual(f.confidence, 'high');
  assert.ok(f.drivers.length > 0);
});

test('wheat: in-season production stress is amplified vs out-of-season', () => {
  const inSeason = Date.UTC(2026, 3, 15); // April
  const outSeason = Date.UTC(2026, 0, 15); // January
  const inputs = {
    rainfall_pct_of_normal: input(50, 'noaa'),
    fertilizer_price_yoy: input(20, 'worldbank'),
  };
  const a = computeWheatShortageRisk(inputs, { region: 'X', now: inSeason });
  const b = computeWheatShortageRisk(inputs, { region: 'X', now: outSeason });
  const aProduction = a.drivers.find((d) => d.kind === 'production');
  const bProduction = b.drivers.find((d) => d.kind === 'production');
  assert.ok(aProduction!.score > bProduction!.score);
});

test('wheat: forecast preserves confirming + invalidating indicators from playbook', () => {
  const f = computeWheatShortageRisk(
    { rainfall_pct_of_normal: input(50) },
    { region: 'X', now: NOW },
  );
  assert.deepEqual(f.confirmingIndicators, [...WHEAT_PLAYBOOK.confirmingIndicators]);
  assert.deepEqual(f.invalidatingIndicators, [...WHEAT_PLAYBOOK.invalidatingIndicators]);
  assert.equal(f.horizonDays, WHEAT_PLAYBOOK.forecastHorizonDays);
});

// ── Diesel model ────────────────────────────────────────────────────────

test('diesel: low inventory + falling utilization + crack widening → high risk', () => {
  const f = computeDieselShortageRisk(
    {
      distillate_inventory_vs_5yr: input(-18, 'eia'),
      refinery_utilization_pct: input(82, 'eia'),
      crude_imports_wow: input(-15, 'eia'),
      crack_spread_distillate: input(45, 'cme'),
      refinery_outage_capacity_pct: input(8, 'eia'),
      gulf_weather_risk: input(70, 'noaa'),
      diesel_retail_price_wow: input(6, 'eia'),
      freight_demand_index: input(72, 'industry'),
      futures_curve_distillate: input(3, 'cme'),
    },
    { region: 'PADD3 (Gulf Coast)', now: NOW },
  );
  assert.equal(f.commodity, 'diesel');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(f.drivers.some((d) => d.kind === 'inventory'));
  assert.ok(f.drivers.some((d) => d.kind === 'price'));
});

test('diesel: SPR release announcement applies a protective driver', () => {
  const baseInputs = {
    distillate_inventory_vs_5yr: input(-15, 'eia'),
    refinery_utilization_pct: input(85, 'eia'),
    crack_spread_distillate: input(40, 'cme'),
    diesel_retail_price_wow: input(4, 'eia'),
  };
  const without = computeDieselShortageRisk(baseInputs, { region: 'US', now: NOW });
  const withRelease = computeDieselShortageRisk(
    { ...baseInputs, spr_release_announcement: input(1, 'whitehouse') },
    { region: 'US', now: NOW },
  );
  assert.ok(
    withRelease.riskScore <= without.riskScore,
    `SPR release should not increase risk (${without.riskScore} → ${withRelease.riskScore})`,
  );
  assert.ok(withRelease.drivers.some((d) => d.polarity === 'protective'));
});

test('diesel: deterministic for same inputs', () => {
  const inputs = {
    distillate_inventory_vs_5yr: input(-10),
    refinery_utilization_pct: input(88),
    crack_spread_distillate: input(30),
    diesel_retail_price_wow: input(2),
  };
  const a = computeDieselShortageRisk(inputs, { region: 'US', now: NOW });
  const b = computeDieselShortageRisk(inputs, { region: 'US', now: NOW });
  assert.equal(a.riskScore, b.riskScore);
});

test('diesel: lastUpdated is ISO and reflects `now`', () => {
  const f = computeDieselShortageRisk(
    { distillate_inventory_vs_5yr: input(0) },
    { region: 'US', now: NOW },
  );
  assert.equal(f.lastUpdated, new Date(NOW).toISOString());
});

test('diesel: empty inputs produce a low-confidence forecast with all data gaps', () => {
  const f = computeDieselShortageRisk({}, { region: 'US', now: NOW });
  assert.equal(f.confidence, 'low');
  assert.ok(f.dataGaps.length >= 4);
  assert.equal(f.drivers.length, 0);
});

// ── Plan invariants ─────────────────────────────────────────────────────
//
// Per the plan's "Guardrails" (lines 252-261), every shortage score
// must include drivers + data gaps and every forecast must include
// confirming + invalidating indicators.

test('invariant: every forecast has drivers (or empty), gaps, confirming, invalidating, lastUpdated', () => {
  const cases = [
    computeWheatShortageRisk({ rainfall_pct_of_normal: input(60) }, { region: 'X', now: NOW }),
    computeDieselShortageRisk({ distillate_inventory_vs_5yr: input(-5) }, { region: 'US', now: NOW }),
    computeWheatShortageRisk({}, { region: 'X', now: NOW }),
    computeDieselShortageRisk({}, { region: 'US', now: NOW }),
  ];
  for (const f of cases) {
    assert.ok(Array.isArray(f.drivers));
    assert.ok(Array.isArray(f.dataGaps));
    assert.ok(f.confirmingIndicators.length > 0);
    assert.ok(f.invalidatingIndicators.length > 0);
    assert.ok(typeof f.lastUpdated === 'string' && f.lastUpdated.length > 0);
    assert.ok(['low', 'medium', 'high'].includes(f.confidence));
    assert.ok(f.riskScore >= 0 && f.riskScore <= 100);
  }
});
