import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeFertilizerShortageRisk,
  computeCrudeShortageRisk,
  computePropaneShortageRisk,
  computeElectricityShortageRisk,
} from '../energy-fertilizer-models.ts';
import {
  FERTILIZER_PLAYBOOK,
  CRUDE_PLAYBOOK,
  PROPANE_PLAYBOOK,
  ELECTRICITY_PLAYBOOK,
  ALL_PLAYBOOKS,
  getPlaybook,
} from '../commodity-playbooks.ts';

const NOW = 1_745_000_000_000;

function input(value: number, source = 'eia') {
  return { value, source, observedAt: NOW };
}

// ── Playbooks ──────────────────────────────────────────────────────────

test('ALL_PLAYBOOKS includes the four batch-6 commodities', () => {
  const ids = ALL_PLAYBOOKS.map((p) => p.commodity);
  assert.ok(ids.includes('fertilizer'));
  assert.ok(ids.includes('crude'));
  assert.ok(ids.includes('propane'));
  assert.ok(ids.includes('electricity'));
});

test('getPlaybook resolves all four', () => {
  assert.equal(getPlaybook('fertilizer')?.commodity, 'fertilizer');
  assert.equal(getPlaybook('crude')?.commodity, 'crude');
  assert.equal(getPlaybook('propane')?.commodity, 'propane');
  assert.equal(getPlaybook('electricity')?.commodity, 'electricity');
});

test('domains match the gameplan classification', () => {
  assert.equal(FERTILIZER_PLAYBOOK.domain, 'food');
  assert.equal(CRUDE_PLAYBOOK.domain, 'energy');
  assert.equal(PROPANE_PLAYBOOK.domain, 'energy');
  assert.equal(ELECTRICITY_PLAYBOOK.domain, 'energy');
});

// ── Fertilizer ─────────────────────────────────────────────────────────

test('fertilizer: high natural gas + sanctions + China quota cut → high risk', () => {
  const r = computeFertilizerShortageRisk(
    {
      natural_gas_price_yoy: input(80),
      urea_price_mom: input(15),
      china_export_quota_pct: input(20),
      russia_belarus_sanctions_pressure: input(85),
    },
    { region: 'global', now: NOW },
  );
  assert.equal(r.commodity, 'fertilizer');
  assert.ok(r.riskScore >= 50);
});

test('fertilizer: clean inputs → low risk', () => {
  const r = computeFertilizerShortageRisk(
    {
      natural_gas_price_yoy: input(0),
      urea_price_mom: input(0),
      china_export_quota_pct: input(100),
      russia_belarus_sanctions_pressure: input(0),
    },
    { region: 'global', now: NOW },
  );
  assert.ok(r.riskScore < 30);
});

// ── Crude ──────────────────────────────────────────────────────────────

test('crude: Hormuz tension + low SPR + tight floating storage → high risk', () => {
  const r = computeCrudeShortageRisk(
    {
      opec_compliance_pct: input(110),
      us_strategic_petroleum_reserve_level: input(360),
      global_floating_storage: input(80),
      middle_east_tension_index: input(85),
    },
    { region: 'global', now: NOW },
  );
  assert.equal(r.commodity, 'crude');
  assert.ok(r.riskScore >= 50);
});

test('crude: SPR full + low tension + healthy storage → low risk', () => {
  const r = computeCrudeShortageRisk(
    {
      opec_compliance_pct: input(95),
      us_strategic_petroleum_reserve_level: input(700),
      global_floating_storage: input(180),
      middle_east_tension_index: input(15),
    },
    { region: 'global', now: NOW },
  );
  assert.ok(r.riskScore < 30);
});

// ── Propane ────────────────────────────────────────────────────────────

test('propane: cold winter + low inventory + heavy crop drying → high risk', () => {
  const r = computePropaneShortageRisk(
    {
      propane_inventory_vs_5yr: input(70),
      heating_degree_days_anomaly: input(30),
      crop_drying_demand_index: input(80),
      us_export_pace_lpg: input(20),
    },
    { region: 'US', now: NOW },
  );
  assert.equal(r.commodity, 'propane');
  assert.ok(r.riskScore >= 50);
});

test('propane: mild winter + high inventory → low risk', () => {
  const r = computePropaneShortageRisk(
    {
      propane_inventory_vs_5yr: input(115),
      heating_degree_days_anomaly: input(0),
      crop_drying_demand_index: input(20),
      us_export_pace_lpg: input(0),
    },
    { region: 'US', now: NOW },
  );
  assert.ok(r.riskScore < 30);
});

// ── Electricity ────────────────────────────────────────────────────────

test('electricity: heat dome + thin reserve margin + grid alert → high risk', () => {
  const r = computeElectricityShortageRisk(
    {
      reserve_margin_pct: input(7),
      extreme_temperature_index: input(85),
      natural_gas_price_yoy: input(50),
      reservoir_levels_pct: input(60),
      grid_alert_active: input(1),
    },
    { region: 'ERCOT', now: NOW },
  );
  assert.equal(r.commodity, 'electricity');
  assert.ok(r.riskScore >= 50);
});

test('electricity: ample reserve + mild temps + clean grid → low risk', () => {
  const r = computeElectricityShortageRisk(
    {
      reserve_margin_pct: input(25),
      extreme_temperature_index: input(20),
      natural_gas_price_yoy: input(0),
      reservoir_levels_pct: input(100),
      grid_alert_active: input(0),
    },
    { region: 'ERCOT', now: NOW },
  );
  assert.ok(r.riskScore < 30);
});

// ── Common output shape ────────────────────────────────────────────────

test('all four models return JSON-serializable ShortageForecast', () => {
  const f1 = computeFertilizerShortageRisk({}, { region: 'global', now: NOW });
  const f2 = computeCrudeShortageRisk({}, { region: 'global', now: NOW });
  const f3 = computePropaneShortageRisk({}, { region: 'US', now: NOW });
  const f4 = computeElectricityShortageRisk({}, { region: 'ERCOT', now: NOW });
  for (const r of [f1, f2, f3, f4]) {
    JSON.stringify(r);
    assert.ok(typeof r.riskScore === 'number');
    assert.ok(Array.isArray(r.dataGaps));
    assert.ok(typeof r.lastUpdated === 'string');
  }
});

test('data gaps recorded when required inputs missing', () => {
  const r = computeElectricityShortageRisk({}, { region: 'CAISO', now: NOW });
  assert.ok(r.dataGaps.length >= 4);
});
