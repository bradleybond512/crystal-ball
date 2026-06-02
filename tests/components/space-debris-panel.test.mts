/**
 * Tests for SpaceDebrisPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --import ./tests/panels/register-hook.mjs --test tests/components/space-debris-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getByOrbitRegime,
  getHighRiskEvents,
  getASATCapableNations,
  computeKesslerRiskIndex,
  debrisSeverityClass,
  regimeDensityClass,
  buildRenderData,
  DEBRIS_EVENTS,
  ORBIT_REGIME_STATUSES,
  ASAT_CAPABILITIES,
  type DebrisEvent,
  type OrbitRegimeId,
  type DebrisDensity,
  type CollisionRisk,
  type EventType,
  type OrbitRegimeStatus,
  type ASATCapability,
} from '../../src/components/space-debris-helpers.ts';

// ── debrisSeverityClass ────────────────────────────────────────────────────

test('debrisSeverityClass: severity 10 returns critical colour', () => {
  assert.match(debrisSeverityClass(10), /ef4444/);
});

test('debrisSeverityClass: severity 9 returns critical colour', () => {
  assert.match(debrisSeverityClass(9), /ef4444/);
});

test('debrisSeverityClass: severity 8 returns high colour', () => {
  assert.match(debrisSeverityClass(8), /fb923c/);
});

test('debrisSeverityClass: severity 7 returns high colour', () => {
  assert.match(debrisSeverityClass(7), /fb923c/);
});

test('debrisSeverityClass: severity 5 returns medium colour', () => {
  assert.match(debrisSeverityClass(5), /facc15/);
});

test('debrisSeverityClass: severity 3 returns low colour', () => {
  assert.match(debrisSeverityClass(3), /4caf50/);
});

test('debrisSeverityClass: every severity 1-10 uses a CSS var', () => {
  for (let i = 1; i <= 10; i++) {
    assert.match(debrisSeverityClass(i), /var\(--severity-/);
  }
});

// ── regimeDensityClass ────────────────────────────────────────────────────

test('regimeDensityClass: Critical maps to red', () => {
  assert.match(regimeDensityClass('Critical'), /ef4444/);
});

test('regimeDensityClass: High maps to orange', () => {
  assert.match(regimeDensityClass('High'), /fb923c/);
});

test('regimeDensityClass: Moderate maps to yellow', () => {
  assert.match(regimeDensityClass('Moderate'), /facc15/);
});

test('regimeDensityClass: Low maps to green', () => {
  assert.match(regimeDensityClass('Low'), /4caf50/);
});

test('regimeDensityClass: every density value returns a non-empty string', () => {
  const densities: DebrisDensity[] = ['Low', 'Moderate', 'High', 'Critical'];
  for (const d of densities) assert.ok(regimeDensityClass(d).length > 0);
});

// ── getByOrbitRegime ──────────────────────────────────────────────────────

test('getByOrbitRegime: LEO returns only LEO events', () => {
  const leo = getByOrbitRegime(DEBRIS_EVENTS, 'LEO');
  for (const e of leo) assert.equal(e.orbitRegime, 'LEO');
});

test('getByOrbitRegime: MEO returns only MEO events', () => {
  const meo = getByOrbitRegime(DEBRIS_EVENTS, 'MEO');
  for (const e of meo) assert.equal(e.orbitRegime, 'MEO');
});

test('getByOrbitRegime: GEO returns only GEO events', () => {
  const geo = getByOrbitRegime(DEBRIS_EVENTS, 'GEO');
  for (const e of geo) assert.equal(e.orbitRegime, 'GEO');
});

test('getByOrbitRegime: LEO count is greater than MEO count', () => {
  const leo = getByOrbitRegime(DEBRIS_EVENTS, 'LEO');
  const meo = getByOrbitRegime(DEBRIS_EVENTS, 'MEO');
  assert.ok(leo.length > meo.length);
});

test('getByOrbitRegime: total across LEO+MEO+GEO equals full list', () => {
  const total =
    getByOrbitRegime(DEBRIS_EVENTS, 'LEO').length +
    getByOrbitRegime(DEBRIS_EVENTS, 'MEO').length +
    getByOrbitRegime(DEBRIS_EVENTS, 'GEO').length;
  assert.equal(total, DEBRIS_EVENTS.length);
});

// ── getHighRiskEvents ─────────────────────────────────────────────────────

test('getHighRiskEvents: all returned events have severity >= 7', () => {
  for (const e of getHighRiskEvents(DEBRIS_EVENTS)) {
    assert.ok(e.severity >= 7);
  }
});

test('getHighRiskEvents: Fengyun-1C is high risk', () => {
  const highRisk = getHighRiskEvents(DEBRIS_EVENTS);
  const fy = highRisk.find((e) => e.id === 'fengyun-1c-2007');
  assert.ok(fy !== undefined);
});

test('getHighRiskEvents: count matches manual filter', () => {
  const expected = DEBRIS_EVENTS.filter((e) => e.severity >= 7).length;
  assert.equal(getHighRiskEvents(DEBRIS_EVENTS).length, expected);
});

// ── getASATCapableNations ─────────────────────────────────────────────────

test('getASATCapableNations: confirmed-only returns only confirmed nations', () => {
  for (const cap of getASATCapableNations(ASAT_CAPABILITIES, true)) {
    assert.ok(cap.confirmed);
  }
});

test('getASATCapableNations: confirmed-only count < all count', () => {
  const confirmed = getASATCapableNations(ASAT_CAPABILITIES, true).length;
  const all = getASATCapableNations(ASAT_CAPABILITIES, false).length;
  assert.ok(confirmed < all);
});

test('getASATCapableNations: default is confirmed-only', () => {
  assert.equal(
    getASATCapableNations(ASAT_CAPABILITIES).length,
    getASATCapableNations(ASAT_CAPABILITIES, true).length,
  );
});

test('getASATCapableNations: USA, Russia, China, India all confirmed', () => {
  const confirmed = getASATCapableNations(ASAT_CAPABILITIES, true).map((c) => c.country);
  assert.ok(confirmed.includes('USA'));
  assert.ok(confirmed.includes('Russia'));
  assert.ok(confirmed.includes('China'));
  assert.ok(confirmed.includes('India'));
});

// ── computeKesslerRiskIndex ────────────────────────────────────────────────

test('computeKesslerRiskIndex: returns a number in 0-100', () => {
  const idx = computeKesslerRiskIndex(ORBIT_REGIME_STATUSES, ASAT_CAPABILITIES);
  assert.ok(idx >= 0 && idx <= 100);
});

test('computeKesslerRiskIndex: LEO Critical adds 40 density points', () => {
  const critical: OrbitRegimeStatus[] = [
    {
      regime: 'LEO (200–2,000 km)',
      trackedObjects: 20_000,
      debrisDensity: 'Critical',
      collisionRisk: 'Critical',
      keyThreat: 'test',
    },
  ];
  const idx = computeKesslerRiskIndex(critical, [], 2025);
  assert.equal(idx, 40);
});

test('computeKesslerRiskIndex: recent test boosts score by 10', () => {
  const regimes: OrbitRegimeStatus[] = [
    {
      regime: 'LEO (200–2,000 km)',
      trackedObjects: 100,
      debrisDensity: 'Low',
      collisionRisk: 'Low',
      keyThreat: 'test',
    },
  ];
  const cap: ASATCapability[] = [
    { country: 'TestNation', confirmed: true, testYear: 2023, fragmentsCreated: 500, status: '' },
  ];
  const idx = computeKesslerRiskIndex(regimes, cap, 2025);
  // Low density = 5, 1 confirmed = 5, recent test (2025-2023=2 <= 5) = 10 → 20
  assert.equal(idx, 20);
});

test('computeKesslerRiskIndex: result with default seed data is above 60', () => {
  // With 4 confirmed ASAT nations and one recent test (Russia 2021), score should be high
  const idx = computeKesslerRiskIndex(ORBIT_REGIME_STATUSES, ASAT_CAPABILITIES, 2025);
  assert.ok(idx > 60);
});

test('computeKesslerRiskIndex: never exceeds 100', () => {
  // Create extreme scenario
  const manyRegimes: OrbitRegimeStatus[] = Array.from({ length: 10 }, (_, i) => ({
    regime: `LEO-${i}`,
    trackedObjects: 99_999,
    debrisDensity: 'Critical' as DebrisDensity,
    collisionRisk: 'Critical' as CollisionRisk,
    keyThreat: 'extreme',
  }));
  const manyCaps: ASATCapability[] = Array.from({ length: 20 }, (_, i) => ({
    country: `Nation${i}`,
    confirmed: true,
    testYear: 2024,
    fragmentsCreated: 9999,
    status: '',
  }));
  assert.equal(computeKesslerRiskIndex(manyRegimes, manyCaps, 2025), 100);
});

// ── buildRenderData ───────────────────────────────────────────────────────

test('buildRenderData: returns correct structure', () => {
  const d = buildRenderData();
  assert.ok(Array.isArray(d.events));
  assert.ok(Array.isArray(d.orbitRegimes));
  assert.ok(Array.isArray(d.asatCapabilities));
  assert.ok(typeof d.kesslerRiskIndex === 'number');
  assert.ok(typeof d.totalTrackedObjects === 'number');
  assert.ok(typeof d.activeRemovalMissions === 'number');
});

test('buildRenderData: totalTrackedObjects equals sum of regime trackedObjects', () => {
  const d = buildRenderData();
  const expected = d.orbitRegimes.reduce((s, r) => s + r.trackedObjects, 0);
  assert.equal(d.totalTrackedObjects, expected);
});

test('buildRenderData: activeRemovalMissions is 3', () => {
  assert.equal(buildRenderData().activeRemovalMissions, 3);
});

test('buildRenderData: kesslerRiskIndex matches computeKesslerRiskIndex', () => {
  const d = buildRenderData();
  const expected = computeKesslerRiskIndex(d.orbitRegimes, d.asatCapabilities, 2025);
  assert.equal(d.kesslerRiskIndex, expected);
});

// ── DEBRIS_EVENTS seed data invariants ────────────────────────────────────

test('DEBRIS_EVENTS: exactly 10 events', () => {
  assert.equal(DEBRIS_EVENTS.length, 10);
});

test('DEBRIS_EVENTS: every id is non-empty and unique', () => {
  const ids = new Set(DEBRIS_EVENTS.map((e) => e.id));
  assert.equal(ids.size, DEBRIS_EVENTS.length);
});

test('DEBRIS_EVENTS: every severity is 1-10', () => {
  for (const e of DEBRIS_EVENTS) {
    assert.ok(e.severity >= 1 && e.severity <= 10, `${e.id} severity ${e.severity} out of range`);
  }
});

test('DEBRIS_EVENTS: every fragmentCount is non-negative', () => {
  for (const e of DEBRIS_EVENTS) {
    assert.ok(e.fragmentCount >= 0, `${e.id} fragmentCount negative`);
  }
});

test('DEBRIS_EVENTS: every actor is non-empty', () => {
  for (const e of DEBRIS_EVENTS) assert.ok(e.actor.length > 0);
});

test('DEBRIS_EVENTS: Fengyun-1C has severity 10', () => {
  const fy = DEBRIS_EVENTS.find((e) => e.id === 'fengyun-1c-2007');
  assert.ok(fy !== undefined);
  assert.equal(fy.severity, 10);
});

test('DEBRIS_EVENTS: Cosmos-Iridium collision has severity 9', () => {
  const ci = DEBRIS_EVENTS.find((e) => e.id === 'cosmos-iridium-2009');
  assert.ok(ci !== undefined);
  assert.equal(ci.severity, 9);
});

test('DEBRIS_EVENTS: Russia Cosmos-1408 ASAT has severity 9', () => {
  const ru = DEBRIS_EVENTS.find((e) => e.id === 'cosmos-1408-2021');
  assert.ok(ru !== undefined);
  assert.equal(ru.severity, 9);
  assert.equal(ru.actor, 'Russia');
});

test('DEBRIS_EVENTS: India Mission Shakti mostly decayed', () => {
  const ms = DEBRIS_EVENTS.find((e) => e.id === 'mission-shakti-2019');
  assert.ok(ms !== undefined);
  assert.equal(ms.stillInOrbit, false);
});

test('DEBRIS_EVENTS: Burnt Frost has decayed (low orbit)', () => {
  const bf = DEBRIS_EVENTS.find((e) => e.id === 'burnt-frost-2008');
  assert.ok(bf !== undefined);
  assert.equal(bf.stillInOrbit, false);
});

test('DEBRIS_EVENTS: BeiDou explosion is in MEO', () => {
  const bd = DEBRIS_EVENTS.find((e) => e.id === 'beidou2-explosion-2016');
  assert.ok(bd !== undefined);
  assert.equal(bd.orbitRegime, 'MEO');
});

test('DEBRIS_EVENTS: every description is at least 20 chars', () => {
  for (const e of DEBRIS_EVENTS) {
    assert.ok(e.description.length >= 20, `${e.id} description too short`);
  }
});

// ── ORBIT_REGIME_STATUSES seed data invariants ────────────────────────────

test('ORBIT_REGIME_STATUSES: exactly 5 regimes', () => {
  assert.equal(ORBIT_REGIME_STATUSES.length, 5);
});

test('ORBIT_REGIME_STATUSES: LEO regime has Critical density', () => {
  const leo = ORBIT_REGIME_STATUSES.find((r) => r.regime.startsWith('LEO'));
  assert.ok(leo !== undefined);
  assert.equal(leo.debrisDensity, 'Critical');
});

test('ORBIT_REGIME_STATUSES: every trackedObjects is positive', () => {
  for (const r of ORBIT_REGIME_STATUSES) {
    assert.ok(r.trackedObjects > 0);
  }
});

test('ORBIT_REGIME_STATUSES: every keyThreat is non-empty', () => {
  for (const r of ORBIT_REGIME_STATUSES) assert.ok(r.keyThreat.length > 0);
});

// ── ASAT_CAPABILITIES seed data invariants ────────────────────────────────

test('ASAT_CAPABILITIES: exactly 6 entries', () => {
  assert.equal(ASAT_CAPABILITIES.length, 6);
});

test('ASAT_CAPABILITIES: 4 confirmed, 2 unconfirmed', () => {
  const confirmed = ASAT_CAPABILITIES.filter((c) => c.confirmed).length;
  const unconfirmed = ASAT_CAPABILITIES.filter((c) => !c.confirmed).length;
  assert.equal(confirmed, 4);
  assert.equal(unconfirmed, 2);
});

test('ASAT_CAPABILITIES: confirmed entries have testYear', () => {
  for (const c of ASAT_CAPABILITIES.filter((c) => c.confirmed)) {
    assert.ok(c.testYear !== null);
  }
});

test('ASAT_CAPABILITIES: unconfirmed entries have null testYear', () => {
  for (const c of ASAT_CAPABILITIES.filter((c) => !c.confirmed)) {
    assert.equal(c.testYear, null);
    assert.equal(c.fragmentsCreated, null);
  }
});

test('ASAT_CAPABILITIES: every status is non-empty', () => {
  for (const c of ASAT_CAPABILITIES) assert.ok(c.status.length > 0);
});
