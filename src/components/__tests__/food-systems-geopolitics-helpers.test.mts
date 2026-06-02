import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOngoingEvents,
  getHighImpact,
  getCriticalConcentrations,
  computeGlobalFoodSecurityIndex,
  computeWeaponizationRiskScore,
  mechanismClass,
  concentrationRiskClass,
  volatilityClass,
  mechanismLabel,
  getMostVulnerableRegions,
  hasFertilizerDependencyAlert,
  buildRenderData,
  WEAPONIZATION_EVENTS,
  SUPPLY_CONCENTRATIONS,
  type FoodWeaponizationEvent,
  type FoodSupplyConcentration,
  type FoodWeaponizationMechanism,
  type ChokepointRisk,
  type VolatilityLevel,
} from '../food-systems-geopolitics-helpers.ts';

// ── Static data shape ────────────────────────────────────────────────────────
test('WEAPONIZATION_EVENTS has exactly 10 entries', () => {
  assert.equal(WEAPONIZATION_EVENTS.length, 10);
});

test('SUPPLY_CONCENTRATIONS has exactly 8 entries', () => {
  assert.equal(SUPPLY_CONCENTRATIONS.length, 8);
});

test('all events have required fields', () => {
  for (const e of WEAPONIZATION_EVENTS) {
    assert.ok(e.id, 'id present');
    assert.ok(e.date, 'date present');
    assert.ok(e.actor, 'actor present');
    assert.ok(e.target, 'target present');
    assert.ok(e.mechanism, 'mechanism present');
    assert.ok(e.commodity, 'commodity present');
    assert.ok(typeof e.impactM === 'number', 'impactM is number');
    assert.ok(typeof e.priceSpikesPct === 'number', 'priceSpikesPct is number');
    assert.ok(typeof e.ongoing === 'boolean', 'ongoing is boolean');
    assert.ok(e.significance >= 1 && e.significance <= 10, 'significance in range');
  }
});

test('all concentrations have required fields', () => {
  for (const c of SUPPLY_CONCENTRATIONS) {
    assert.ok(c.commodity, 'commodity present');
    assert.ok(Array.isArray(c.topProducers), 'topProducers is array');
    assert.ok(c.topProducers.length >= 1, 'at least one producer');
    assert.ok(c.top3SharePct > 0 && c.top3SharePct <= 100, 'share pct in range');
    assert.ok(c.chokepointRisk, 'chokepointRisk present');
    assert.ok(c.priceVolatility, 'priceVolatility present');
  }
});

test('events with significance 10 exist (highest impact)', () => {
  const topSig = WEAPONIZATION_EVENTS.filter((e) => e.significance === 10);
  assert.ok(topSig.length >= 1, 'at least one significance-10 event');
});

test('at least one ongoing event exists', () => {
  const ongoing = WEAPONIZATION_EVENTS.filter((e) => e.ongoing);
  assert.ok(ongoing.length >= 1, 'at least one ongoing event');
});

test('wheat is a tracked concentration', () => {
  const wheat = SUPPLY_CONCENTRATIONS.find((c) => c.commodity === 'Wheat');
  assert.ok(wheat, 'wheat concentration present');
  assert.equal(wheat!.chokepointRisk, 'Critical');
});

test('potash fertilizer is tracked as Critical risk', () => {
  const potash = SUPPLY_CONCENTRATIONS.find((c) => c.commodity === 'Potash Fertilizer');
  assert.ok(potash, 'potash present');
  assert.equal(potash!.chokepointRisk, 'Critical');
});

// ── getOngoingEvents ─────────────────────────────────────────────────────────
test('getOngoingEvents returns only ongoing events', () => {
  const ongoing = getOngoingEvents(WEAPONIZATION_EVENTS);
  assert.ok(ongoing.every((e) => e.ongoing === true));
});

test('getOngoingEvents returns empty array for all-finished events', () => {
  const finished: FoodWeaponizationEvent[] = [
    { id: 'X1', date: '2020-01', actor: 'A', target: 'B', mechanism: 'Export Ban',
      commodity: 'Wheat', impactM: 10, priceSpikesPct: 5, description: 'test',
      ongoing: false, significance: 3 },
  ];
  assert.deepEqual(getOngoingEvents(finished), []);
});

test('getOngoingEvents handles empty input', () => {
  assert.deepEqual(getOngoingEvents([]), []);
});

// ── getHighImpact ────────────────────────────────────────────────────────────
test('getHighImpact default threshold 200M returns correct events', () => {
  const highImpact = getHighImpact(WEAPONIZATION_EVENTS);
  assert.ok(highImpact.every((e) => e.impactM >= 200));
});

test('getHighImpact with threshold 0 returns all events', () => {
  const all = getHighImpact(WEAPONIZATION_EVENTS, 0);
  assert.equal(all.length, WEAPONIZATION_EVENTS.length);
});

test('getHighImpact with threshold 1000 returns empty', () => {
  const none = getHighImpact(WEAPONIZATION_EVENTS, 1000);
  assert.equal(none.length, 0);
});

test('getHighImpact with threshold 400 returns FW001', () => {
  const big = getHighImpact(WEAPONIZATION_EVENTS, 400);
  assert.ok(big.some((e) => e.id === 'FW001'));
});

// ── getCriticalConcentrations ─────────────────────────────────────────────────
test('getCriticalConcentrations returns only Critical risk items', () => {
  const crit = getCriticalConcentrations(SUPPLY_CONCENTRATIONS);
  assert.ok(crit.every((c) => c.chokepointRisk === 'Critical'));
});

test('getCriticalConcentrations returns at least 2 items (wheat, potash)', () => {
  const crit = getCriticalConcentrations(SUPPLY_CONCENTRATIONS);
  assert.ok(crit.length >= 2);
});

test('getCriticalConcentrations handles empty input', () => {
  assert.deepEqual(getCriticalConcentrations([]), []);
});

// ── computeGlobalFoodSecurityIndex ───────────────────────────────────────────
test('computeGlobalFoodSecurityIndex returns value in 0-100 range', () => {
  const idx = computeGlobalFoodSecurityIndex(WEAPONIZATION_EVENTS, SUPPLY_CONCENTRATIONS);
  assert.ok(idx >= 0 && idx <= 100, `expected 0-100, got ${idx}`);
});

test('computeGlobalFoodSecurityIndex returns integer', () => {
  const idx = computeGlobalFoodSecurityIndex(WEAPONIZATION_EVENTS, SUPPLY_CONCENTRATIONS);
  assert.equal(idx, Math.round(idx));
});

test('computeGlobalFoodSecurityIndex with no events and no concentrations returns 100', () => {
  assert.equal(computeGlobalFoodSecurityIndex([], []), 100);
});

test('computeGlobalFoodSecurityIndex decreases with more ongoing events', () => {
  const e1: FoodWeaponizationEvent = {
    id: 'T1', date: '2023-01', actor: 'A', target: 'B', mechanism: 'Export Ban',
    commodity: 'X', impactM: 10, priceSpikesPct: 5, description: 'd',
    ongoing: true, significance: 5,
  };
  const low = computeGlobalFoodSecurityIndex([e1, e1, e1], []);
  const high = computeGlobalFoodSecurityIndex([{ ...e1, ongoing: false }], []);
  assert.ok(low < high, `expected ${low} < ${high}`);
});

test('computeGlobalFoodSecurityIndex clamps to 0 minimum', () => {
  const manyOngoing: FoodWeaponizationEvent[] = Array.from({ length: 20 }, (_, i) => ({
    id: `T${i}`, date: '2023-01', actor: 'A', target: 'B', mechanism: 'Export Ban' as const,
    commodity: 'X', impactM: 10, priceSpikesPct: 5, description: 'd',
    ongoing: true, significance: 10,
  }));
  const idx = computeGlobalFoodSecurityIndex(manyOngoing, SUPPLY_CONCENTRATIONS);
  assert.equal(idx, 0);
});

// ── computeWeaponizationRiskScore ────────────────────────────────────────────
test('computeWeaponizationRiskScore returns value in 0-100 range', () => {
  const score = computeWeaponizationRiskScore(WEAPONIZATION_EVENTS);
  assert.ok(score >= 0 && score <= 100, `expected 0-100, got ${score}`);
});

test('computeWeaponizationRiskScore returns 0 for empty events', () => {
  assert.equal(computeWeaponizationRiskScore([]), 0);
});

test('computeWeaponizationRiskScore is higher with more ongoing events', () => {
  const e: FoodWeaponizationEvent = {
    id: 'T1', date: '2023-01', actor: 'A', target: 'B', mechanism: 'Export Ban',
    commodity: 'X', impactM: 10, priceSpikesPct: 5, description: 'd',
    ongoing: true, significance: 5,
  };
  const high = computeWeaponizationRiskScore([e, e]);
  const low = computeWeaponizationRiskScore([{ ...e, ongoing: false }]);
  assert.ok(high > low);
});

test('computeWeaponizationRiskScore clamps to 100 maximum', () => {
  const manyOngoing: FoodWeaponizationEvent[] = Array.from({ length: 20 }, (_, i) => ({
    id: `T${i}`, date: '2023-01', actor: 'A', target: 'B', mechanism: 'Export Ban' as const,
    commodity: 'X', impactM: 10, priceSpikesPct: 5, description: 'd',
    ongoing: true, significance: 10,
  }));
  assert.equal(computeWeaponizationRiskScore(manyOngoing), 100);
});

// ── mechanismClass ───────────────────────────────────────────────────────────
test('mechanismClass Export Ban returns export-ban', () => {
  assert.equal(mechanismClass('Export Ban'), 'export-ban');
});
test('mechanismClass Grain Blockade returns grain-blockade', () => {
  assert.equal(mechanismClass('Grain Blockade'), 'grain-blockade');
});
test('mechanismClass Fertilizer Cutoff returns fertilizer-cutoff', () => {
  assert.equal(mechanismClass('Fertilizer Cutoff'), 'fertilizer-cutoff');
});
test('mechanismClass Trade Coercion returns trade-coercion', () => {
  assert.equal(mechanismClass('Trade Coercion'), 'trade-coercion');
});
test('mechanismClass Sanctions Impact returns sanctions-impact', () => {
  assert.equal(mechanismClass('Sanctions Impact'), 'sanctions-impact');
});
test('mechanismClass Infrastructure Attack returns infrastructure-attack', () => {
  assert.equal(mechanismClass('Infrastructure Attack'), 'infrastructure-attack');
});

// ── concentrationRiskClass ───────────────────────────────────────────────────
test('concentrationRiskClass Low returns risk-low', () => {
  assert.equal(concentrationRiskClass('Low'), 'risk-low');
});
test('concentrationRiskClass Medium returns risk-medium', () => {
  assert.equal(concentrationRiskClass('Medium'), 'risk-medium');
});
test('concentrationRiskClass High returns risk-high', () => {
  assert.equal(concentrationRiskClass('High'), 'risk-high');
});
test('concentrationRiskClass Critical returns risk-critical', () => {
  assert.equal(concentrationRiskClass('Critical'), 'risk-critical');
});

// ── volatilityClass ──────────────────────────────────────────────────────────
test('volatilityClass covers all four values', () => {
  assert.equal(volatilityClass('Low'), 'vol-low');
  assert.equal(volatilityClass('Medium'), 'vol-medium');
  assert.equal(volatilityClass('High'), 'vol-high');
  assert.equal(volatilityClass('Extreme'), 'vol-extreme');
});

// ── mechanismLabel ───────────────────────────────────────────────────────────
test('mechanismLabel returns the mechanism string itself', () => {
  const mechs: FoodWeaponizationMechanism[] = [
    'Export Ban', 'Grain Blockade', 'Fertilizer Cutoff',
    'Trade Coercion', 'Sanctions Impact', 'Infrastructure Attack',
  ];
  for (const m of mechs) {
    assert.equal(mechanismLabel(m), m);
  }
});

// ── getMostVulnerableRegions ─────────────────────────────────────────────────
test('getMostVulnerableRegions returns at most 5 entries', () => {
  const regions = getMostVulnerableRegions(WEAPONIZATION_EVENTS);
  assert.ok(regions.length <= 5);
});

test('getMostVulnerableRegions returns no duplicates', () => {
  const regions = getMostVulnerableRegions(WEAPONIZATION_EVENTS);
  assert.equal(regions.length, new Set(regions).size);
});

test('getMostVulnerableRegions returns empty for no ongoing events', () => {
  const allFinished = WEAPONIZATION_EVENTS.map((e) => ({ ...e, ongoing: false }));
  assert.deepEqual(getMostVulnerableRegions(allFinished), []);
});

// ── hasFertilizerDependencyAlert ─────────────────────────────────────────────
test('hasFertilizerDependencyAlert returns true for ongoing Fertilizer Cutoff', () => {
  assert.equal(hasFertilizerDependencyAlert(WEAPONIZATION_EVENTS), true);
});

test('hasFertilizerDependencyAlert returns false when no ongoing fertilizer events', () => {
  const noFert = WEAPONIZATION_EVENTS.map((e) =>
    e.mechanism === 'Fertilizer Cutoff' ? { ...e, ongoing: false } : e,
  );
  assert.equal(hasFertilizerDependencyAlert(noFert), false);
});

test('hasFertilizerDependencyAlert returns false for empty events', () => {
  assert.equal(hasFertilizerDependencyAlert([]), false);
});

// ── buildRenderData ───────────────────────────────────────────────────────────
test('buildRenderData returns FoodGeopoliticsData shape', () => {
  const data = buildRenderData();
  assert.ok(Array.isArray(data.events));
  assert.ok(Array.isArray(data.concentrations));
  assert.ok(typeof data.globalFoodSecurityIndex === 'number');
  assert.ok(typeof data.weaponizationRiskScore === 'number');
  assert.ok(Array.isArray(data.mostVulnerableRegions));
  assert.ok(typeof data.fertilizer_dependency_alert === 'boolean');
});

test('buildRenderData sorts events by significance descending', () => {
  const data = buildRenderData();
  for (let i = 1; i < data.events.length; i++) {
    assert.ok(
      data.events[i - 1].significance >= data.events[i].significance,
      `event ${i - 1} sig >= event ${i} sig`,
    );
  }
});

test('buildRenderData uses default datasets when called with no args', () => {
  const data = buildRenderData();
  assert.equal(data.events.length, 10);
  assert.equal(data.concentrations.length, 8);
});

test('buildRenderData accepts overridden events', () => {
  const custom: FoodWeaponizationEvent[] = [
    { id: 'C1', date: '2024-01', actor: 'X', target: 'Y', mechanism: 'Export Ban',
      commodity: 'Rice', impactM: 50, priceSpikesPct: 10, description: 'test',
      ongoing: false, significance: 5 },
  ];
  const data = buildRenderData(custom, SUPPLY_CONCENTRATIONS);
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].id, 'C1');
});

test('buildRenderData fertilizer_dependency_alert is true with default data', () => {
  const data = buildRenderData();
  assert.equal(data.fertilizer_dependency_alert, true);
});
