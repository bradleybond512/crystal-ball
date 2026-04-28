import assert from 'node:assert/strict';
import test from 'node:test';

import { computeRiceShortageRisk } from '../rice-shortage-risk.ts';
import { computeSoybeansShortageRisk } from '../soybeans-shortage-risk.ts';
import { RICE_PLAYBOOK, SOYBEANS_PLAYBOOK, ALL_PLAYBOOKS, getPlaybook } from '../commodity-playbooks.ts';
import type { ShortageInput } from '../shortage-types.ts';

const MONSOON_NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // July (peak monsoon)
const SOY_PEAK_NOW = Date.UTC(2026, 7, 15, 12, 0, 0); // August (US podfill)
const OFF_NOW = Date.UTC(2026, 3, 15, 12, 0, 0);  // April (rice off-season)

function input(value: number, source = 'src1', ageMs = 0, now = MONSOON_NOW): ShortageInput {
  return { value, observedAt: now - ageMs, source };
}

// ── Playbook hygiene ───────────────────────────────────────────────────

test('playbooks: ALL_PLAYBOOKS includes rice + soybeans', () => {
  const commodities = ALL_PLAYBOOKS.map((p) => p.commodity);
  assert.ok(commodities.includes('rice'));
  assert.ok(commodities.includes('soybeans'));
});

test('getPlaybook: rice + soybeans lookup', () => {
  assert.equal(getPlaybook('rice')?.commodity, 'rice');
  assert.equal(getPlaybook('SOYBEANS')?.commodity, 'soybeans');
});

test('RICE_PLAYBOOK: monsoon + paddy + India ban signals', () => {
  assert.ok(RICE_PLAYBOOK.leadingIndicators.includes('monsoon_rainfall_pct_of_normal'));
  assert.ok(RICE_PLAYBOOK.leadingIndicators.includes('paddy_water_availability_index'));
  assert.ok(RICE_PLAYBOOK.confirmingIndicators.includes('india_export_ban_active'));
});

test('SOYBEANS_PLAYBOOK: La Niña + China crush + USDA condition', () => {
  assert.ok(SOYBEANS_PLAYBOOK.leadingIndicators.includes('south_america_la_nina_signal'));
  assert.ok(SOYBEANS_PLAYBOOK.leadingIndicators.includes('china_crush_demand_index'));
  assert.ok(SOYBEANS_PLAYBOOK.confirmingIndicators.includes('usda_crop_condition_g_e_pct'));
});

// ── Rice model ──────────────────────────────────────────────────────────

test('rice: weak monsoon + low paddy water + India ban + price spike → high risk', () => {
  const f = computeRiceShortageRisk(
    {
      monsoon_rainfall_pct_of_normal: input(60, 'imd'),
      paddy_water_availability_index: input(35, 'fao'),
      planting_progress_pct: input(70, 'usda'),
      fertilizer_price_yoy: input(30, 'worldbank'),
      export_corridor_status: input(40, 'gdacs'),
      india_export_ban_active: input(1, 'gov-in'),
      thai_rice_export_price_mom: input(15, 'fao'),
      fews_net_stage: input(3, 'fewsnet'),
    },
    { region: 'South Asia', now: MONSOON_NOW },
  );
  assert.equal(f.commodity, 'rice');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(f.drivers.some((d) => /Indian export ban/i.test(d.label)));
  assert.ok(f.drivers.some((d) => d.kind === 'production'));
});

test('rice: India export ban only fires when active=1', () => {
  const off = computeRiceShortageRisk(
    { india_export_ban_active: input(0) },
    { region: 'X', now: MONSOON_NOW },
  );
  const on = computeRiceShortageRisk(
    { india_export_ban_active: input(1) },
    { region: 'X', now: MONSOON_NOW },
  );
  assert.ok(!off.drivers.some((d) => /Indian export ban/i.test(d.label)));
  assert.ok(on.drivers.some((d) => /Indian export ban/i.test(d.label)));
});

test('rice: monsoon-season multiplier on production drivers', () => {
  const inputs = { monsoon_rainfall_pct_of_normal: input(70) };
  const monsoon = computeRiceShortageRisk(inputs, { region: 'X', now: MONSOON_NOW });
  const off = computeRiceShortageRisk(inputs, { region: 'X', now: OFF_NOW });
  const monsoonProd = monsoon.drivers.find((d) => d.kind === 'production');
  const offProd = off.drivers.find((d) => d.kind === 'production');
  assert.ok(monsoonProd!.score >= offProd!.score);
});

test('rice: empty inputs → low confidence', () => {
  const f = computeRiceShortageRisk({}, { region: 'X', now: MONSOON_NOW });
  assert.equal(f.confidence, 'low');
  assert.ok(f.dataGaps.length >= 4);
});

// ── Soybeans model ─────────────────────────────────────────────────────

test('soy: drought + La Niña + high China demand + price spike → high risk', () => {
  const f = computeSoybeansShortageRisk(
    {
      rainfall_pct_of_normal: input(55, 'noaa', 0, SOY_PEAK_NOW),
      soil_moisture_percentile: input(20, 'usda', 0, SOY_PEAK_NOW),
      ndvi_anomaly: input(-0.15, 'usgs', 0, SOY_PEAK_NOW),
      usda_crop_condition_g_e_pct: input(50, 'usda', 0, SOY_PEAK_NOW),
      south_america_la_nina_signal: input(70, 'noaa', 0, SOY_PEAK_NOW),
      china_crush_demand_index: input(80, 'usda', 0, SOY_PEAK_NOW),
      cbot_soy_price_mom: input(15, 'cme', 0, SOY_PEAK_NOW),
      soy_meal_basis_widening: input(4, 'cme', 0, SOY_PEAK_NOW),
    },
    { region: 'US Corn Belt', now: SOY_PEAK_NOW },
  );
  assert.equal(f.commodity, 'soybeans');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(f.drivers.some((d) => /La Niña/.test(d.label)));
  assert.ok(f.drivers.some((d) => /China crush/.test(d.label)));
});

test('soy: deterministic for same inputs', () => {
  const inputs = {
    rainfall_pct_of_normal: input(70),
    usda_crop_condition_g_e_pct: input(70),
  };
  const a = computeSoybeansShortageRisk(inputs, { region: 'X', now: SOY_PEAK_NOW });
  const b = computeSoybeansShortageRisk(inputs, { region: 'X', now: SOY_PEAK_NOW });
  assert.equal(a.riskScore, b.riskScore);
  assert.deepEqual(a.drivers, b.drivers);
});

test('soy: empty inputs → low confidence + gaps', () => {
  const f = computeSoybeansShortageRisk({}, { region: 'X', now: SOY_PEAK_NOW });
  assert.equal(f.confidence, 'low');
  assert.ok(f.dataGaps.length >= 4);
});

test('soy: forecast preserves confirming + invalidating + 90d horizon', () => {
  const f = computeSoybeansShortageRisk(
    { rainfall_pct_of_normal: input(70) },
    { region: 'X', now: SOY_PEAK_NOW },
  );
  assert.deepEqual(f.confirmingIndicators, [...SOYBEANS_PLAYBOOK.confirmingIndicators]);
  assert.equal(f.horizonDays, 90);
});

// ── Plan invariants ────────────────────────────────────────────────────

test('invariant: rice + soybeans forecasts include all required fields', () => {
  const cases = [
    computeRiceShortageRisk({ monsoon_rainfall_pct_of_normal: input(80) }, { region: 'X', now: MONSOON_NOW }),
    computeSoybeansShortageRisk({ rainfall_pct_of_normal: input(80) }, { region: 'US', now: SOY_PEAK_NOW }),
  ];
  for (const f of cases) {
    assert.ok(Array.isArray(f.drivers));
    assert.ok(Array.isArray(f.dataGaps));
    assert.ok(f.confirmingIndicators.length > 0);
    assert.ok(f.invalidatingIndicators.length > 0);
    assert.ok(f.riskScore >= 0 && f.riskScore <= 100);
  }
});
