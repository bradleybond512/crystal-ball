import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REPLAY_FIXTURE_MISSIONS,
  buildCatalogReplayFixtures,
  LATE_SEVERE_WIND_FIXTURE,
  SILENT_TORNADO_POLYGON_FIXTURE,
  FUEL_STRESS_LATE_FIXTURE,
  QUIET_HOURS_SUPPRESSION_FIXTURE,
  ADSB_OUTAGE_FIXTURE,
} from '../replay-fixtures-catalog.ts';

// ── Catalog coverage ────────────────────────────────────────────────────

test('catalog ships at least five fixtures across multiple domains', () => {
  assert.ok(REPLAY_FIXTURE_MISSIONS.length >= 5);
  const domains = new Set(REPLAY_FIXTURE_MISSIONS.map((m) => m.domain));
  assert.ok(domains.size >= 2);
});

test('every catalog mission resolved_miss with at least one event', () => {
  for (const m of REPLAY_FIXTURE_MISSIONS) {
    assert.equal(m.status, 'resolved_miss');
    assert.ok(m.events.length >= 1, `${m.id} should have events`);
  }
});

test('every catalog mission has a stable id starting with "fixture-"', () => {
  for (const m of REPLAY_FIXTURE_MISSIONS) {
    assert.ok(m.id.startsWith('fixture-'), `${m.id} should start with fixture-`);
  }
});

// ── Specific fixtures keep their identity ───────────────────────────────

test('late severe wind fixture has user_notified after actual_impact', () => {
  const events = LATE_SEVERE_WIND_FIXTURE.events;
  const impact = events.find((e) => e.kind === 'actual_impact');
  const warning = events.find((e) => e.kind === 'user_notified');
  assert.ok(impact && warning);
  assert.ok(warning!.at > impact!.at, 'late_warning fixture: warning must come after impact');
});

test('silent polygon fixture has weak_signal but no user_notified', () => {
  const events = SILENT_TORNADO_POLYGON_FIXTURE.events;
  assert.ok(events.some((e) => e.kind === 'weak_signal'));
  assert.ok(!events.some((e) => e.kind === 'user_notified'));
});

test('fuel-stress fixture is in the energy domain', () => {
  assert.equal(FUEL_STRESS_LATE_FIXTURE.domain, 'energy_fuel_stress');
});

test('quiet-hours fixture has near_miss event with quiet-hours-no-bypass reason', () => {
  const nm = QUIET_HOURS_SUPPRESSION_FIXTURE.events.find((e) => e.kind === 'near_miss');
  assert.ok(nm);
  assert.equal(nm!.detail?.suppressionReason, 'quiet-hours-no-bypass');
});

test('ADS-B outage fixture is in the travel domain with a silent_signal near miss', () => {
  assert.equal(ADSB_OUTAGE_FIXTURE.domain, 'travel_disruption');
  const nm = ADSB_OUTAGE_FIXTURE.events.find((e) => e.kind === 'near_miss');
  assert.ok(nm);
});

// ── Harness integration ─────────────────────────────────────────────────

test('buildCatalogReplayFixtures returns one ReplayFixture per mission', () => {
  const fixtures = buildCatalogReplayFixtures();
  assert.equal(fixtures.length, REPLAY_FIXTURE_MISSIONS.length);
});

test('every produced fixture has at least one expectation', () => {
  const fixtures = buildCatalogReplayFixtures();
  for (const f of fixtures) {
    assert.ok(f.expectations.length >= 1, `${f.fixtureId} should have expectations`);
  }
});

test('late-warning fixture produces a warning_before_impact expectation', () => {
  const fixtures = buildCatalogReplayFixtures();
  const lateWind = fixtures.find((f) => f.fixtureId.includes('late-severe-wind'));
  assert.ok(lateWind);
  const expectations = lateWind!.expectations.map((e) => e.check.kind);
  assert.ok(expectations.includes('warning_before_impact'));
});

test('all fixtures are JSON-serializable', () => {
  const fixtures = buildCatalogReplayFixtures();
  const json = JSON.stringify(fixtures);
  const parsed = JSON.parse(json) as { fixtureId: string }[];
  assert.equal(parsed.length, fixtures.length);
});
