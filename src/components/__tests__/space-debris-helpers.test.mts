import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getByOrbitRegime,
  getHighRiskEvents,
  getASATCapableNations,
  computeKesslerRiskIndex,
  kesslerRiskLabel,
  debrisSeverityClass,
  riskClass,
  severityColor,
  formatFragments,
  asatStatusLabel,
  missionStatusLabel,
  constellationStatusLabel,
  buildRenderData,
  DEBRIS_EVENTS,
  ORBIT_STATS,
  ASAT_NATIONS,
  REMOVAL_MISSIONS,
  MEGA_CONSTELLATIONS,
  GOVERNANCE_GAPS,
  type DebrisEvent,
  type OrbitStats,
  type ASATNation,
} from '../space-debris-helpers.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeEvent(over: Partial<DebrisEvent> = {}): DebrisEvent {
  return {
    id: over.id ?? 'test-event',
    year: over.year ?? 2020,
    name: over.name ?? 'Test Event',
    actor: over.actor ?? 'TestNation',
    orbit: over.orbit ?? 'LEO',
    trackedFragments: over.trackedFragments ?? 0,
    stillInOrbit: over.stillInOrbit ?? false,
    forcedISSManeuver: over.forcedISSManeuver ?? false,
    geopoliticalNotes: over.geopoliticalNotes ?? 'test notes',
    severity: over.severity ?? 0,
  };
}

function makeOrbitStats(over: Partial<OrbitStats> = {}): OrbitStats {
  return {
    regime: over.regime ?? 'LEO',
    altitudeKmRange: over.altitudeKmRange ?? '200-400 km',
    trackedObjects: over.trackedObjects ?? 1000,
    activeSatellites: over.activeSatellites ?? 100,
    debrisFragments: over.debrisFragments ?? 900,
    kesslerRisk: over.kesslerRisk ?? 'low',
    notes: over.notes ?? '',
  };
}

function makeNation(over: Partial<ASATNation> = {}): ASATNation {
  return {
    code: over.code ?? 'XX',
    name: over.name ?? 'TestLand',
    status: over.status ?? 'none',
    testsPerformed: over.testsPerformed ?? 0,
    latestTestYear: over.latestTestYear ?? null,
    totalDebrisGenerated: over.totalDebrisGenerated ?? 0,
    notes: over.notes ?? '',
  };
}

// ── getByOrbitRegime ────────────────────────────────────────────────────────

test('getByOrbitRegime returns only LEO events', () => {
  const events = [makeEvent({ orbit: 'LEO' }), makeEvent({ orbit: 'GEO' }), makeEvent({ orbit: 'LEO' })];
  const result = getByOrbitRegime(events, 'LEO');
  assert.equal(result.length, 2);
  assert.ok(result.every((e) => e.orbit === 'LEO'));
});

test('getByOrbitRegime returns only GEO events', () => {
  const events = [makeEvent({ orbit: 'GEO' }), makeEvent({ orbit: 'MEO' })];
  const result = getByOrbitRegime(events, 'GEO');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.orbit, 'GEO');
});

test('getByOrbitRegime returns empty array when no match', () => {
  const events = [makeEvent({ orbit: 'LEO' }), makeEvent({ orbit: 'MEO' })];
  assert.deepEqual(getByOrbitRegime(events, 'HEO'), []);
});

test('getByOrbitRegime returns all events when all match', () => {
  const events = [makeEvent({ orbit: 'MEO' }), makeEvent({ orbit: 'MEO' })];
  assert.equal(getByOrbitRegime(events, 'MEO').length, 2);
});

test('getByOrbitRegime returns empty for empty input', () => {
  assert.deepEqual(getByOrbitRegime([], 'LEO'), []);
});

// ── getHighRiskEvents ───────────────────────────────────────────────────────

test('getHighRiskEvents includes severity-3 events', () => {
  const events = [makeEvent({ severity: 3 }), makeEvent({ severity: 2 })];
  const result = getHighRiskEvents(events);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.severity, 3);
});

test('getHighRiskEvents includes severity-4 events', () => {
  const events = [makeEvent({ severity: 4 })];
  assert.equal(getHighRiskEvents(events).length, 1);
});

test('getHighRiskEvents excludes severity-2 events', () => {
  const events = [makeEvent({ severity: 2 }), makeEvent({ severity: 1 }), makeEvent({ severity: 0 })];
  assert.equal(getHighRiskEvents(events).length, 0);
});

test('getHighRiskEvents returns empty for empty input', () => {
  assert.deepEqual(getHighRiskEvents([]), []);
});

test('getHighRiskEvents returns all when all are high-risk', () => {
  const events = [makeEvent({ severity: 3 }), makeEvent({ severity: 4 }), makeEvent({ severity: 3 })];
  assert.equal(getHighRiskEvents(events).length, 3);
});

// ── getASATCapableNations ───────────────────────────────────────────────────

test('getASATCapableNations includes demonstrated nations', () => {
  const nations = [makeNation({ status: 'demonstrated' }), makeNation({ status: 'none' })];
  const result = getASATCapableNations(nations);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.status, 'demonstrated');
});

test('getASATCapableNations includes suspected nations', () => {
  const nations = [makeNation({ status: 'suspected' }), makeNation({ status: 'developing' })];
  const result = getASATCapableNations(nations);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.status, 'suspected');
});

test('getASATCapableNations excludes developing-only nations', () => {
  const nations = [makeNation({ status: 'developing' })];
  assert.equal(getASATCapableNations(nations).length, 0);
});

test('getASATCapableNations excludes none-status nations', () => {
  const nations = [makeNation({ status: 'none' })];
  assert.equal(getASATCapableNations(nations).length, 0);
});

test('getASATCapableNations returns empty for empty input', () => {
  assert.deepEqual(getASATCapableNations([]), []);
});

test('getASATCapableNations includes both demonstrated and suspected in same call', () => {
  const nations = [
    makeNation({ status: 'demonstrated' }),
    makeNation({ status: 'suspected' }),
    makeNation({ status: 'none' }),
  ];
  assert.equal(getASATCapableNations(nations).length, 2);
});

// ── computeKesslerRiskIndex ─────────────────────────────────────────────────

test('computeKesslerRiskIndex returns 0 for empty input', () => {
  assert.equal(computeKesslerRiskIndex([], []), 0);
});

test('computeKesslerRiskIndex returns a number', () => {
  const idx = computeKesslerRiskIndex(ORBIT_STATS, DEBRIS_EVENTS);
  assert.ok(typeof idx === 'number');
});

test('computeKesslerRiskIndex stays within 0-100', () => {
  const idx = computeKesslerRiskIndex(ORBIT_STATS, DEBRIS_EVENTS);
  assert.ok(idx >= 0 && idx <= 100);
});

test('computeKesslerRiskIndex is higher with denser LEO', () => {
  const sparse = [makeOrbitStats({ regime: 'LEO', trackedObjects: 5_000 })];
  const dense  = [makeOrbitStats({ regime: 'LEO', trackedObjects: 25_000 })];
  const events: DebrisEvent[] = [];
  assert.ok(computeKesslerRiskIndex(dense, events) > computeKesslerRiskIndex(sparse, events));
});

test('computeKesslerRiskIndex caps LEO density at 40', () => {
  const hugeObjects = [makeOrbitStats({ regime: 'LEO', trackedObjects: 999_999 })];
  const idx = computeKesslerRiskIndex(hugeObjects, []);
  assert.ok(idx <= 100);
});

test('computeKesslerRiskIndex adds bonus for recent high-fragment in-orbit ASAT', () => {
  const noRecent = [makeEvent({ year: 2010, trackedFragments: 500, stillInOrbit: true, severity: 4 })];
  const withRecent = [
    makeEvent({ year: 2010, trackedFragments: 500, stillInOrbit: true, severity: 4 }),
    makeEvent({ year: 2021, trackedFragments: 1500, stillInOrbit: true, severity: 4 }),
  ];
  const stats = [makeOrbitStats({ regime: 'LEO', trackedObjects: 10_000 })];
  assert.ok(
    computeKesslerRiskIndex(stats, withRecent) > computeKesslerRiskIndex(stats, noRecent),
  );
});

test('computeKesslerRiskIndex ignores events not in orbit for fragment score', () => {
  const inOrbit  = [makeEvent({ trackedFragments: 5000, stillInOrbit: true })];
  const decayed  = [makeEvent({ trackedFragments: 5000, stillInOrbit: false })];
  const stats: OrbitStats[] = [];
  assert.ok(computeKesslerRiskIndex(stats, inOrbit) > computeKesslerRiskIndex(stats, decayed));
});

test('computeKesslerRiskIndex is deterministic with ORBIT_STATS and DEBRIS_EVENTS', () => {
  const a = computeKesslerRiskIndex(ORBIT_STATS, DEBRIS_EVENTS);
  const b = computeKesslerRiskIndex(ORBIT_STATS, DEBRIS_EVENTS);
  assert.equal(a, b);
});

// ── kesslerRiskLabel ────────────────────────────────────────────────────────

test('kesslerRiskLabel returns critical for index >= 80', () => {
  assert.equal(kesslerRiskLabel(80), 'critical');
  assert.equal(kesslerRiskLabel(100), 'critical');
});

test('kesslerRiskLabel returns elevated for index 55-79', () => {
  assert.equal(kesslerRiskLabel(55), 'elevated');
  assert.equal(kesslerRiskLabel(79), 'elevated');
});

test('kesslerRiskLabel returns moderate for index 30-54', () => {
  assert.equal(kesslerRiskLabel(30), 'moderate');
  assert.equal(kesslerRiskLabel(54), 'moderate');
});

test('kesslerRiskLabel returns low for index < 30', () => {
  assert.equal(kesslerRiskLabel(0), 'low');
  assert.equal(kesslerRiskLabel(29), 'low');
});

// ── debrisSeverityClass ─────────────────────────────────────────────────────

test('debrisSeverityClass returns correct class for severity 0', () => {
  assert.equal(debrisSeverityClass(0), 'debris-sev-minimal');
});

test('debrisSeverityClass returns correct class for severity 1', () => {
  assert.equal(debrisSeverityClass(1), 'debris-sev-low');
});

test('debrisSeverityClass returns correct class for severity 2', () => {
  assert.equal(debrisSeverityClass(2), 'debris-sev-moderate');
});

test('debrisSeverityClass returns correct class for severity 3', () => {
  assert.equal(debrisSeverityClass(3), 'debris-sev-high');
});

test('debrisSeverityClass returns correct class for severity 4', () => {
  assert.equal(debrisSeverityClass(4), 'debris-sev-critical');
});

// ── riskClass ───────────────────────────────────────────────────────────────

test('riskClass returns risk-low for low', () => {
  assert.equal(riskClass('low'), 'risk-low');
});

test('riskClass returns risk-moderate for moderate', () => {
  assert.equal(riskClass('moderate'), 'risk-moderate');
});

test('riskClass returns risk-elevated for elevated', () => {
  assert.equal(riskClass('elevated'), 'risk-elevated');
});

test('riskClass returns risk-critical for critical', () => {
  assert.equal(riskClass('critical'), 'risk-critical');
});

// ── severityColor ───────────────────────────────────────────────────────────

test('severityColor returns grey for severity 0', () => {
  assert.equal(severityColor(0), '#9e9e9e');
});

test('severityColor returns green for severity 1', () => {
  assert.equal(severityColor(1), '#4caf50');
});

test('severityColor returns yellow for severity 2', () => {
  assert.equal(severityColor(2), '#ffeb3b');
});

test('severityColor returns orange for severity 3', () => {
  assert.equal(severityColor(3), '#ff9800');
});

test('severityColor returns red for severity 4', () => {
  assert.equal(severityColor(4), '#ff453a');
});

// ── formatFragments ─────────────────────────────────────────────────────────

test('formatFragments returns em-dash for 0', () => {
  assert.equal(formatFragments(0), '\u2014');
});

test('formatFragments returns string for small numbers', () => {
  assert.equal(formatFragments(500), '500');
});

test('formatFragments returns k notation for >= 1000', () => {
  assert.equal(formatFragments(3537), '3.5k');
});

test('formatFragments returns k notation for exactly 1000', () => {
  assert.equal(formatFragments(1000), '1.0k');
});

test('formatFragments returns k notation for 2296', () => {
  assert.equal(formatFragments(2296), '2.3k');
});

// ── asatStatusLabel ─────────────────────────────────────────────────────────

test('asatStatusLabel handles demonstrated', () => {
  assert.equal(asatStatusLabel('demonstrated'), 'Demonstrated');
});

test('asatStatusLabel handles suspected', () => {
  assert.equal(asatStatusLabel('suspected'), 'Suspected');
});

test('asatStatusLabel handles developing', () => {
  assert.equal(asatStatusLabel('developing'), 'Developing');
});

test('asatStatusLabel handles none', () => {
  assert.equal(asatStatusLabel('none'), 'None');
});

// ── missionStatusLabel ──────────────────────────────────────────────────────

test('missionStatusLabel handles operational', () => {
  assert.equal(missionStatusLabel('operational'), 'Operational');
});

test('missionStatusLabel handles planned', () => {
  assert.equal(missionStatusLabel('planned'), 'Planned');
});

test('missionStatusLabel handles development', () => {
  assert.equal(missionStatusLabel('development'), 'In Development');
});

test('missionStatusLabel handles cancelled', () => {
  assert.equal(missionStatusLabel('cancelled'), 'Cancelled');
});

// ── constellationStatusLabel ────────────────────────────────────────────────

test('constellationStatusLabel handles deployed', () => {
  assert.equal(constellationStatusLabel('deployed'), 'Deployed');
});

test('constellationStatusLabel handles deploying', () => {
  assert.equal(constellationStatusLabel('deploying'), 'Deploying');
});

test('constellationStatusLabel handles planned', () => {
  assert.equal(constellationStatusLabel('planned'), 'Planned');
});

test('constellationStatusLabel handles approved', () => {
  assert.equal(constellationStatusLabel('approved'), 'Approved');
});

// ── buildRenderData ─────────────────────────────────────────────────────────

test('buildRenderData returns expected shape', () => {
  const data = buildRenderData();
  assert.ok(Array.isArray(data.events));
  assert.ok(Array.isArray(data.orbitStats));
  assert.ok(Array.isArray(data.asatNations));
  assert.ok(Array.isArray(data.removalMissions));
  assert.ok(Array.isArray(data.megaConstellations));
  assert.ok(Array.isArray(data.governanceGaps));
  assert.ok(typeof data.kesslerRiskIndex === 'number');
  assert.ok(typeof data.globalStats === 'object');
});

test('buildRenderData globalStats has correct tracked-objects count', () => {
  const data = buildRenderData();
  assert.equal(data.globalStats.trackedObjectsAbove10cm, 36_500);
});

test('buildRenderData globalStats has correct active-satellite count', () => {
  const data = buildRenderData();
  assert.equal(data.globalStats.activeSatellites, 9_200);
});

test('buildRenderData kesslerRiskIndex is within 0-100', () => {
  const data = buildRenderData();
  assert.ok(data.kesslerRiskIndex >= 0 && data.kesslerRiskIndex <= 100);
});

// ── Data integrity: DEBRIS_EVENTS ──────────────────────────────────────────

test('DEBRIS_EVENTS has at least 8 entries', () => {
  assert.ok(DEBRIS_EVENTS.length >= 8);
});

test('DEBRIS_EVENTS Fengyun-1C has >3000 tracked fragments', () => {
  const fy = DEBRIS_EVENTS.find((e) => e.id === 'fengyun-1c-2007');
  assert.ok(fy !== undefined);
  assert.ok(fy.trackedFragments > 3000);
});

test('DEBRIS_EVENTS Fengyun-1C is still in orbit', () => {
  const fy = DEBRIS_EVENTS.find((e) => e.id === 'fengyun-1c-2007');
  assert.ok(fy?.stillInOrbit === true);
});

test('DEBRIS_EVENTS Cosmos 1408 forced an ISS maneuver', () => {
  const cosmos = DEBRIS_EVENTS.find((e) => e.id === 'cosmos-1408-2021');
  assert.ok(cosmos?.forcedISSManeuver === true);
});

test('DEBRIS_EVENTS all entries have non-empty ids', () => {
  assert.ok(DEBRIS_EVENTS.every((e) => e.id.length > 0));
});

test('DEBRIS_EVENTS all entries have valid orbit regimes', () => {
  const valid = new Set(['LEO', 'MEO', 'GEO', 'HEO']);
  assert.ok(DEBRIS_EVENTS.every((e) => valid.has(e.orbit)));
});

test('DEBRIS_EVENTS all entries have severity 0-4', () => {
  assert.ok(DEBRIS_EVENTS.every((e) => e.severity >= 0 && e.severity <= 4));
});

// ── Data integrity: ORBIT_STATS ─────────────────────────────────────────────

test('ORBIT_STATS has entries for all four regimes', () => {
  const regimes = new Set(ORBIT_STATS.map((s) => s.regime));
  assert.ok(regimes.has('LEO'));
  assert.ok(regimes.has('MEO'));
  assert.ok(regimes.has('GEO'));
  assert.ok(regimes.has('HEO'));
});

test('ORBIT_STATS LEO has critical kessler risk', () => {
  const leo = ORBIT_STATS.find((s) => s.regime === 'LEO');
  assert.equal(leo?.kesslerRisk, 'critical');
});

// ── Data integrity: ASAT_NATIONS ────────────────────────────────────────────

test('ASAT_NATIONS has at least 4 entries', () => {
  assert.ok(ASAT_NATIONS.length >= 4);
});

test('ASAT_NATIONS all entries have valid status', () => {
  const valid = new Set(['demonstrated', 'suspected', 'developing', 'none']);
  assert.ok(ASAT_NATIONS.every((n) => valid.has(n.status)));
});

test('ASAT_NATIONS China has highest debris generated', () => {
  const china = ASAT_NATIONS.find((n) => n.code === 'CN');
  const maxDebris = Math.max(...ASAT_NATIONS.map((n) => n.totalDebrisGenerated));
  assert.ok(china !== undefined);
  assert.equal(china.totalDebrisGenerated, maxDebris);
});

// ── Data integrity: REMOVAL_MISSIONS ────────────────────────────────────────

test('REMOVAL_MISSIONS has at least 3 entries', () => {
  assert.ok(REMOVAL_MISSIONS.length >= 3);
});

test('REMOVAL_MISSIONS all entries have non-empty names', () => {
  assert.ok(REMOVAL_MISSIONS.every((m) => m.name.length > 0));
});

// ── Data integrity: MEGA_CONSTELLATIONS ─────────────────────────────────────

test('MEGA_CONSTELLATIONS has at least 4 entries', () => {
  assert.ok(MEGA_CONSTELLATIONS.length >= 4);
});

test('MEGA_CONSTELLATIONS Starlink has deployedCount > 5000', () => {
  const sl = MEGA_CONSTELLATIONS.find((c) => c.operator.includes('Starlink'));
  assert.ok(sl !== undefined);
  assert.ok(sl.deployedCount > 5000);
});

// ── Data integrity: GOVERNANCE_GAPS ─────────────────────────────────────────

test('GOVERNANCE_GAPS has at least 4 entries', () => {
  assert.ok(GOVERNANCE_GAPS.length >= 4);
});

test('GOVERNANCE_GAPS all entries have non-empty titles', () => {
  assert.ok(GOVERNANCE_GAPS.every((g) => g.title.length > 0));
});

test('GOVERNANCE_GAPS all entries have severity 0-4', () => {
  assert.ok(GOVERNANCE_GAPS.every((g) => g.severity >= 0 && g.severity <= 4));
});
