/**
 * Coverage for scenario-library.ts — verifies that the curated
 * scenario catalog is JSON-serializable, deterministic, free of
 * private user data, and covers every mission domain plus every
 * starter category from the plan.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listScenarios,
  getScenario,
  listByDomain,
  listByCategory,
  summarizeScenarioCoverage,
  type ScenarioCategory,
} from '../scenario-library.ts';

const REQUIRED_CATEGORIES: ScenarioCategory[] = [
  'tornado_at_night',
  'flash_flood_saved_place',
  'cyber_zero_day',
  'port_closure',
  'refinery_fire',
  'regional_blackout',
  'conflict_escalation',
  'market_shock',
  'food_shortage_escalation',
  'provider_outage_during_hazard',
];

test('catalog covers all 10 starter categories from the plan', () => {
  const cats = new Set(listScenarios().map((s) => s.category));
  for (const required of REQUIRED_CATEGORIES) {
    assert.ok(cats.has(required), `missing category: ${required}`);
  }
});

test('every scenario has stable id + non-empty description + ≥1 expectation', () => {
  for (const s of listScenarios()) {
    assert.ok(s.id.length > 0, 'id present');
    assert.ok(s.description.length > 0, 'description present');
    assert.ok(s.expectations.length > 0, `${s.id} has no replay expectations`);
    for (const e of s.expectations) {
      assert.ok(e.rationale.length > 0, `${s.id} expectation missing rationale`);
    }
  }
});

test('ids are unique', () => {
  const ids = listScenarios().map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate scenario ids');
});

test('getScenario returns the expected entry', () => {
  const s = getScenario('tornado-at-night');
  assert.ok(s);
  assert.equal(s!.domain, 'weather_safety');
});

test('listByDomain filters correctly', () => {
  const weather = listByDomain('weather_safety');
  assert.ok(weather.length >= 2, 'expect tornado + flash flood + provider outage');
  for (const s of weather) assert.equal(s.domain, 'weather_safety');
});

test('listByCategory filters correctly', () => {
  const cyber = listByCategory('cyber_zero_day');
  assert.equal(cyber.length, 1);
  assert.equal(cyber[0]!.domain, 'cyber_exposure');
});

test('catalog is JSON-serializable + deterministic', () => {
  const a = listScenarios();
  const b = listScenarios();
  assert.deepEqual(a, b);
  const round = JSON.parse(JSON.stringify(a));
  assert.equal(JSON.stringify(round), JSON.stringify(a));
});

test('no scenario contains private-looking user data', () => {
  // Heuristic: scenarios MUST NOT carry email-shaped strings or
  // anything that looks like a real personal name/SSN. The fixtures
  // use synthetic ids ("home", "Acme Networks", utility names).
  const json = JSON.stringify(listScenarios());
  assert.ok(!/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i.test(json), 'contains email-shaped string');
  assert.ok(!/\b\d{3}-\d{2}-\d{4}\b/.test(json), 'contains SSN-shaped string');
});

test('coverage summary tallies match the catalog', () => {
  const cov = summarizeScenarioCoverage();
  assert.equal(cov.totalScenarios, listScenarios().length);
  // Every starter category present in the catalog should be in
  // cov.byCategory with a non-zero count.
  for (const cat of REQUIRED_CATEGORIES) {
    assert.ok((cov.byCategory[cat] ?? 0) >= 1, `missing coverage for ${cat}`);
  }
});

test('every mission_domain in the catalog has ≥1 scenario', () => {
  const domains = new Set(listScenarios().map((s) => s.domain));
  // Mission domains the plan listed:
  const required = ['weather_safety', 'cyber_exposure', 'travel_disruption', 'energy_fuel_stress', 'local_infrastructure', 'conflict_escalation', 'market_portfolio_risk', 'food_commodity_shortage'];
  for (const d of required) {
    assert.ok(domains.has(d as never), `no scenario for domain ${d}`);
  }
});
