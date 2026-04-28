import assert from 'node:assert/strict';
import test from 'node:test';

import { computeNaturalGasShortageRisk } from '../natural-gas-shortage-risk.ts';
import { computeJetFuelShortageRisk } from '../jet-fuel-shortage-risk.ts';
import { NATURAL_GAS_PLAYBOOK, JET_FUEL_PLAYBOOK, ALL_PLAYBOOKS, getPlaybook } from '../commodity-playbooks.ts';
import type { ShortageInput } from '../shortage-types.ts';

const WINTER_NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // January
const HOLIDAY_NOW = Date.UTC(2026, 11, 20, 12, 0, 0); // December
const SUMMER_NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // July
const OFF_SEASON_NOW = Date.UTC(2026, 3, 15, 12, 0, 0); // April

function input(value: number, source = 'src1', ageMs = 0, now = WINTER_NOW): ShortageInput {
  return { value, observedAt: now - ageMs, source };
}

// ── Playbook hygiene ───────────────────────────────────────────────────

test('playbooks: ALL_PLAYBOOKS includes natural_gas + jet_fuel', () => {
  const commodities = ALL_PLAYBOOKS.map((p) => p.commodity);
  assert.ok(commodities.includes('natural_gas'));
  assert.ok(commodities.includes('jet_fuel'));
});

test('getPlaybook: natural_gas + jet_fuel lookup', () => {
  assert.equal(getPlaybook('natural_gas')?.commodity, 'natural_gas');
  assert.equal(getPlaybook('Jet_Fuel')?.commodity, 'jet_fuel');
});

test('NATURAL_GAS_PLAYBOOK: HDD/CDD + LNG export + cold-snap signals', () => {
  assert.ok(NATURAL_GAS_PLAYBOOK.leadingIndicators.includes('heating_degree_days_vs_normal'));
  assert.ok(NATURAL_GAS_PLAYBOOK.leadingIndicators.includes('lng_export_capacity_pct'));
  assert.ok(NATURAL_GAS_PLAYBOOK.confirmingIndicators.includes('cold_snap_arrival_imminent'));
});

test('JET_FUEL_PLAYBOOK: SAF + crack-spread + airport-shortage signals', () => {
  assert.ok(JET_FUEL_PLAYBOOK.leadingIndicators.includes('sustainable_aviation_fuel_constraint'));
  assert.ok(JET_FUEL_PLAYBOOK.leadingIndicators.includes('crack_spread_jet'));
  assert.ok(JET_FUEL_PLAYBOOK.confirmingIndicators.includes('airport_fuel_shortage_alert'));
});

// ── Natural gas model ──────────────────────────────────────────────────

test('natgas: storage deficit + cold + curtailment + price spike → high risk', () => {
  const f = computeNaturalGasShortageRisk(
    {
      natgas_storage_vs_5yr: input(-22, 'eia', 0, WINTER_NOW),
      heating_degree_days_vs_normal: input(28, 'noaa', 0, WINTER_NOW),
      henry_hub_basis_widening: input(4, 'cme', 0, WINTER_NOW),
      retail_natgas_price_mom: input(20, 'eia', 0, WINTER_NOW),
      utility_curtailment_active: input(1, 'utility', 0, WINTER_NOW),
      cold_snap_arrival_imminent: input(1, 'noaa', 0, WINTER_NOW),
    },
    { region: 'US Northeast', now: WINTER_NOW },
  );
  assert.equal(f.commodity, 'natural_gas');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(f.drivers.some((d) => d.kind === 'inventory'));
  assert.ok(f.drivers.some((d) => /Curtailment/i.test(d.label)));
});

test('natgas: curtailment flag adds a demand driver only when active', () => {
  const off = computeNaturalGasShortageRisk(
    { utility_curtailment_active: input(0, 'utility', 0, WINTER_NOW) },
    { region: 'X', now: WINTER_NOW },
  );
  const on = computeNaturalGasShortageRisk(
    { utility_curtailment_active: input(1, 'utility', 0, WINTER_NOW) },
    { region: 'X', now: WINTER_NOW },
  );
  assert.ok(!off.drivers.some((d) => /Curtailment/i.test(d.label)));
  assert.ok(on.drivers.some((d) => /Curtailment/i.test(d.label)));
});

test('natgas: winter scoring bumps demand harder than off-season', () => {
  const inputs = {
    natgas_storage_vs_5yr: input(-15, 'eia'),
    heating_degree_days_vs_normal: input(20, 'noaa'),
    henry_hub_basis_widening: input(2, 'cme'),
  };
  const winter = computeNaturalGasShortageRisk(inputs, { region: 'US', now: WINTER_NOW });
  const offSeason = computeNaturalGasShortageRisk(inputs, { region: 'US', now: OFF_SEASON_NOW });
  assert.ok(winter.riskScore >= offSeason.riskScore);
});

test('natgas: deterministic + low-confidence baseline', () => {
  const inputs = { natgas_storage_vs_5yr: input(-10) };
  const a = computeNaturalGasShortageRisk(inputs, { region: 'X', now: WINTER_NOW });
  const b = computeNaturalGasShortageRisk(inputs, { region: 'X', now: WINTER_NOW });
  assert.equal(a.riskScore, b.riskScore);
  assert.equal(computeNaturalGasShortageRisk({}, { region: 'X', now: WINTER_NOW }).confidence, 'low');
});

// ── Jet fuel model ─────────────────────────────────────────────────────

test('jet: low inventory + high demand + airport alert + pipeline disruption → high risk', () => {
  const f = computeJetFuelShortageRisk(
    {
      jet_fuel_inventory_vs_5yr: input(-18, 'eia', 0, HOLIDAY_NOW),
      refinery_utilization_pct: input(80, 'eia', 0, HOLIDAY_NOW),
      crack_spread_jet: input(35, 'cme', 0, HOLIDAY_NOW),
      air_traffic_demand_proxy: input(85, 'tsa', 0, HOLIDAY_NOW),
      airport_fuel_shortage_alert: input(1, 'faa', 0, HOLIDAY_NOW),
      pipeline_jet_disruption_active: input(1, 'incident', 0, HOLIDAY_NOW),
    },
    { region: 'US East Coast', now: HOLIDAY_NOW },
  );
  assert.equal(f.commodity, 'jet_fuel');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(f.drivers.some((d) => /Pipeline disruption/i.test(d.label)));
  assert.ok(f.drivers.some((d) => /Airport fuel-shortage/i.test(d.label)));
});

test('jet: in-season scoring exceeds off-season', () => {
  const inputs = {
    jet_fuel_inventory_vs_5yr: input(-15, 'eia'),
    refinery_utilization_pct: input(82, 'eia'),
    crack_spread_jet: input(30, 'cme'),
    air_traffic_demand_proxy: input(75, 'tsa'),
  };
  const summer = computeJetFuelShortageRisk(inputs, { region: 'US', now: SUMMER_NOW });
  const offSeason = computeJetFuelShortageRisk(inputs, { region: 'US', now: Date.UTC(2026, 4, 15) });
  assert.ok(summer.riskScore >= offSeason.riskScore);
});

test('jet: SAF constraint adds a production driver', () => {
  const f = computeJetFuelShortageRisk(
    { sustainable_aviation_fuel_constraint: input(75, 'iata', 0, HOLIDAY_NOW) },
    { region: 'EU', now: HOLIDAY_NOW },
  );
  assert.ok(f.drivers.some((d) => /SAF/.test(d.label)));
});

test('jet: empty inputs → low confidence + 4+ data gaps', () => {
  const f = computeJetFuelShortageRisk({}, { region: 'X', now: HOLIDAY_NOW });
  assert.equal(f.confidence, 'low');
  assert.ok(f.dataGaps.length >= 4);
});

test('jet: deterministic for same inputs', () => {
  const inputs = {
    jet_fuel_inventory_vs_5yr: input(-10),
    refinery_utilization_pct: input(85),
  };
  const a = computeJetFuelShortageRisk(inputs, { region: 'X', now: HOLIDAY_NOW });
  const b = computeJetFuelShortageRisk(inputs, { region: 'X', now: HOLIDAY_NOW });
  assert.equal(a.riskScore, b.riskScore);
});

// ── Plan invariants ────────────────────────────────────────────────────

test('invariant: forecasts include drivers, gaps, confirming, invalidating', () => {
  const cases = [
    computeNaturalGasShortageRisk({ natgas_storage_vs_5yr: input(-10) }, { region: 'X', now: WINTER_NOW }),
    computeJetFuelShortageRisk({ jet_fuel_inventory_vs_5yr: input(-5) }, { region: 'US', now: HOLIDAY_NOW }),
  ];
  for (const f of cases) {
    assert.ok(Array.isArray(f.drivers));
    assert.ok(Array.isArray(f.dataGaps));
    assert.ok(f.confirmingIndicators.length > 0);
    assert.ok(f.invalidatingIndicators.length > 0);
    assert.ok(f.riskScore >= 0 && f.riskScore <= 100);
  }
});
