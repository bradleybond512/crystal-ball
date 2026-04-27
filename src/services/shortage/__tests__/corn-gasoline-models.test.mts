import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCornShortageRisk } from '../corn-shortage-risk.ts';
import { computeGasolineShortageRisk } from '../gasoline-shortage-risk.ts';
import { CORN_PLAYBOOK, GASOLINE_PLAYBOOK, getPlaybook, ALL_PLAYBOOKS } from '../commodity-playbooks.ts';
import type { ShortageInput } from '../shortage-types.ts';

const POLLINATION_NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // Jul 15, peak corn pollination
const DRIVE_SEASON_NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // Jul, summer driving
const OFF_SEASON_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);  // Jan

function input(value: number, source = 'src1', ageMs = 0, now = POLLINATION_NOW): ShortageInput {
  return { value, observedAt: now - ageMs, source };
}

// ── Playbook registration ──────────────────────────────────────────────

test('playbooks: ALL_PLAYBOOKS includes corn + gasoline', () => {
  const commodities = ALL_PLAYBOOKS.map((p) => p.commodity);
  assert.ok(commodities.includes('corn'));
  assert.ok(commodities.includes('gasoline'));
});

test('getPlaybook: corn + gasoline lookup case-insensitive', () => {
  assert.equal(getPlaybook('CORN')?.commodity, 'corn');
  assert.equal(getPlaybook('Gasoline')?.commodity, 'gasoline');
});

test('CORN_PLAYBOOK: pollination + GDD signals are leading', () => {
  assert.ok(CORN_PLAYBOOK.leadingIndicators.includes('gdd_accumulation_pct'));
  assert.ok(CORN_PLAYBOOK.leadingIndicators.includes('pollination_window_temp_anomaly_c'));
  assert.ok(CORN_PLAYBOOK.confirmingIndicators.includes('usda_crop_condition_g_e_pct'));
});

test('GASOLINE_PLAYBOOK: RBOB + driving season + Colonial chokepoint', () => {
  assert.ok(GASOLINE_PLAYBOOK.leadingIndicators.includes('rbob_futures_backwardation'));
  assert.ok(GASOLINE_PLAYBOOK.leadingIndicators.includes('driving_season_demand_proxy'));
  assert.ok(GASOLINE_PLAYBOOK.chokepoints.some((c) => /colonial pipeline/i.test(c)));
});

// ── Corn model ─────────────────────────────────────────────────────────

test('corn: drought + heat pollination + poor USDA condition → high risk', () => {
  const f = computeCornShortageRisk(
    {
      rainfall_pct_of_normal: input(50, 'noaa'),
      soil_moisture_percentile: input(15, 'usda'),
      ndvi_anomaly: input(-0.2, 'usgs'),
      gdd_accumulation_pct: input(70, 'noaa'),
      pollination_window_temp_anomaly_c: input(3.5, 'noaa'),
      usda_crop_condition_g_e_pct: input(45, 'usda'),
      fertilizer_price_yoy: input(35, 'worldbank'),
      ethanol_demand_index: input(75, 'industry'),
      local_corn_price_mom: input(15, 'cme'),
    },
    { region: 'US Corn Belt', now: POLLINATION_NOW },
  );
  assert.equal(f.commodity, 'corn');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(['medium', 'high'].includes(f.confidence));
  assert.ok(f.drivers.some((d) => d.kind === 'production'));
  assert.ok(f.drivers.some((d) => d.kind === 'price'));
});

test('corn: pollination month amplifies production drivers more than other in-season months', () => {
  const aug = Date.UTC(2026, 7, 15);
  const inputs = {
    rainfall_pct_of_normal: input(50, 'noaa'),
    pollination_window_temp_anomaly_c: input(3.0, 'noaa'),
  };
  const inJuly = computeCornShortageRisk(inputs, { region: 'X', now: POLLINATION_NOW });
  const inAug = computeCornShortageRisk(inputs, { region: 'X', now: aug });
  const julyProd = inJuly.drivers.find((d) => d.kind === 'production' && /Rainfall/.test(d.label));
  const augProd = inAug.drivers.find((d) => d.kind === 'production' && /Rainfall/.test(d.label));
  assert.ok(julyProd!.score >= augProd!.score, 'pollination month should amplify ≥ other in-season');
});

test('corn: empty inputs produce low confidence with all data gaps', () => {
  const f = computeCornShortageRisk({}, { region: 'X', now: POLLINATION_NOW });
  assert.equal(f.confidence, 'low');
  assert.ok(f.dataGaps.length >= 4);
  assert.equal(f.drivers.length, 0);
});

test('corn: deterministic for same inputs', () => {
  const inputs = {
    rainfall_pct_of_normal: input(75, 'noaa'),
    usda_crop_condition_g_e_pct: input(70, 'usda'),
  };
  const a = computeCornShortageRisk(inputs, { region: 'X', now: POLLINATION_NOW });
  const b = computeCornShortageRisk(inputs, { region: 'X', now: POLLINATION_NOW });
  assert.equal(a.riskScore, b.riskScore);
  assert.deepEqual(a.drivers, b.drivers);
});

test('corn: forecast preserves confirming + invalidating from playbook', () => {
  const f = computeCornShortageRisk(
    { rainfall_pct_of_normal: input(60) },
    { region: 'X', now: POLLINATION_NOW },
  );
  assert.deepEqual(f.confirmingIndicators, [...CORN_PLAYBOOK.confirmingIndicators]);
  assert.deepEqual(f.invalidatingIndicators, [...CORN_PLAYBOOK.invalidatingIndicators]);
  assert.equal(f.horizonDays, 90);
});

// ── Gasoline model ─────────────────────────────────────────────────────

test('gasoline: low inventory + driving season + pipeline disruption → high risk', () => {
  const f = computeGasolineShortageRisk(
    {
      gasoline_inventory_vs_5yr: input(-18, 'eia', 0, DRIVE_SEASON_NOW),
      refinery_utilization_pct: input(82, 'eia', 0, DRIVE_SEASON_NOW),
      crude_imports_wow: input(-12, 'eia', 0, DRIVE_SEASON_NOW),
      crack_spread_gasoline: input(40, 'cme', 0, DRIVE_SEASON_NOW),
      driving_season_demand_proxy: input(78, 'industry', 0, DRIVE_SEASON_NOW),
      pipeline_disruption_active: input(1, 'incident-feed', 0, DRIVE_SEASON_NOW),
      retail_gasoline_price_wow: input(5, 'eia', 0, DRIVE_SEASON_NOW),
    },
    { region: 'PADD3 (Gulf Coast)', now: DRIVE_SEASON_NOW },
  );
  assert.equal(f.commodity, 'gasoline');
  assert.ok(f.riskScore >= 60, `expected high risk, got ${f.riskScore}`);
  assert.ok(f.drivers.some((d) => d.kind === 'inventory'));
  assert.ok(f.drivers.some((d) => d.kind === 'transport' && /Pipeline/.test(d.label)));
});

test('gasoline: pipeline_disruption_active flag adds a transport driver', () => {
  const f = computeGasolineShortageRisk(
    { pipeline_disruption_active: input(1, 'incident-feed', 0, DRIVE_SEASON_NOW) },
    { region: 'X', now: DRIVE_SEASON_NOW },
  );
  const pipeline = f.drivers.find((d) => /Pipeline/.test(d.label));
  assert.ok(pipeline);
  assert.equal(pipeline!.kind, 'transport');
});

test('gasoline: pipeline_disruption_active=0 does NOT add a driver', () => {
  const f = computeGasolineShortageRisk(
    { pipeline_disruption_active: input(0, 'incident-feed', 0, DRIVE_SEASON_NOW) },
    { region: 'X', now: DRIVE_SEASON_NOW },
  );
  assert.ok(!f.drivers.some((d) => /Pipeline/.test(d.label)));
});

test('gasoline: in-season scoring exceeds off-season for same inputs', () => {
  const inputs = {
    gasoline_inventory_vs_5yr: input(-15, 'eia'),
    refinery_utilization_pct: input(85, 'eia'),
    crude_imports_wow: input(-10, 'eia'),
    crack_spread_gasoline: input(35, 'cme'),
    retail_gasoline_price_wow: input(3, 'eia'),
  };
  const inSeason = computeGasolineShortageRisk(inputs, { region: 'X', now: DRIVE_SEASON_NOW });
  const offSeason = computeGasolineShortageRisk(inputs, { region: 'X', now: OFF_SEASON_NOW });
  assert.ok(
    inSeason.riskScore >= offSeason.riskScore,
    `in-season ${inSeason.riskScore} should be ≥ off-season ${offSeason.riskScore}`,
  );
});

test('gasoline: empty inputs → low confidence + all gaps', () => {
  const f = computeGasolineShortageRisk({}, { region: 'X', now: DRIVE_SEASON_NOW });
  assert.equal(f.confidence, 'low');
  assert.ok(f.dataGaps.length >= 4);
});

test('gasoline: deterministic for same inputs', () => {
  const inputs = {
    gasoline_inventory_vs_5yr: input(-10),
    refinery_utilization_pct: input(88),
  };
  const a = computeGasolineShortageRisk(inputs, { region: 'X', now: DRIVE_SEASON_NOW });
  const b = computeGasolineShortageRisk(inputs, { region: 'X', now: DRIVE_SEASON_NOW });
  assert.equal(a.riskScore, b.riskScore);
});

// ── Plan invariants ────────────────────────────────────────────────────

test('invariant: corn + gasoline forecasts include drivers, gaps, confirming + invalidating', () => {
  const cases = [
    computeCornShortageRisk({ rainfall_pct_of_normal: input(60) }, { region: 'X', now: POLLINATION_NOW }),
    computeGasolineShortageRisk({ gasoline_inventory_vs_5yr: input(-5) }, { region: 'US', now: DRIVE_SEASON_NOW }),
    computeCornShortageRisk({}, { region: 'X', now: POLLINATION_NOW }),
    computeGasolineShortageRisk({}, { region: 'US', now: DRIVE_SEASON_NOW }),
  ];
  for (const f of cases) {
    assert.ok(Array.isArray(f.drivers));
    assert.ok(Array.isArray(f.dataGaps));
    assert.ok(f.confirmingIndicators.length > 0);
    assert.ok(f.invalidatingIndicators.length > 0);
    assert.ok(typeof f.lastUpdated === 'string');
    assert.ok(['low', 'medium', 'high'].includes(f.confidence));
    assert.ok(f.riskScore >= 0 && f.riskScore <= 100);
  }
});
