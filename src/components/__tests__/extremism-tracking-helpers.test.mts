import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTREMIST_GROUPS,
  EXTREMISM_EVENTS,
  buildRenderData,
  getByIdeology,
  getByThreatLevel,
  getGrowingGroups,
  getStateSponsoredGroups,
  getMajorEvents,
  computeGlobalExtremismThreatIndex,
  threatLevelClass,
  ideologyClass,
  type ExtremistGroup,
  type ExtremismEvent,
} from '../extremism-tracking-helpers';

const THREAT_LEVELS: ExtremistGroup['threatLevel'][] = ['critical', 'high', 'medium', 'low'];
const IDEOLOGIES: ExtremistGroup['ideology'][] = [
  'jihadist-salafi',
  'far-right',
  'far-left',
  'ethnonationalist',
  'eco-terrorist',
  'religious-cult',
  'anarchist',
];
const FINANCING: ExtremistGroup['financingType'][] = [
  'state-sponsor',
  'self-financing',
  'criminal',
  'donations',
  'mixed',
];
const TRENDS: ExtremistGroup['trend'][] = ['growing', 'stable', 'declining'];
const DESIGNATIONS: ExtremistGroup['designation'][] = ['FTO', 'SDGT', 'proscribed', 'monitored', 'none'];
const ATTACK_TYPES: ExtremismEvent['attackType'][] = [
  'bombing',
  'shooting',
  'stabbing',
  'vehicle',
  'arson',
  'cyber',
  'other',
];
const SIGNIFICANCE: ExtremismEvent['significance'][] = ['major', 'notable', 'minor'];

// ── Fixture shape ──────────────────────────────────────────────────────────

test('EXTREMIST_GROUPS has exactly 12 entries', () => {
  assert.equal(EXTREMIST_GROUPS.length, 12);
});

test('EXTREMISM_EVENTS has exactly 8 entries', () => {
  assert.equal(EXTREMISM_EVENTS.length, 8);
});

test('buildRenderData returns all 12 groups', () => {
  assert.equal(buildRenderData().groups.length, 12);
});

test('buildRenderData returns all 8 events', () => {
  assert.equal(buildRenderData().recentEvents.length, 8);
});

test('all group ids are unique', () => {
  const ids = new Set(EXTREMIST_GROUPS.map((g) => g.id));
  assert.equal(ids.size, 12);
});

test('all group names are unique', () => {
  const names = new Set(EXTREMIST_GROUPS.map((g) => g.name));
  assert.equal(names.size, 12);
});

test('all event ids are unique', () => {
  const ids = new Set(EXTREMISM_EVENTS.map((e) => e.id));
  assert.equal(ids.size, 8);
});

test('buildRenderData lastUpdated is set', () => {
  assert.ok(buildRenderData().lastUpdated.length > 0);
});

test('buildRenderData returns a copy of groups, not the shared array', () => {
  assert.notEqual(buildRenderData().groups, EXTREMIST_GROUPS);
});

test('buildRenderData returns a copy of events, not the shared array', () => {
  assert.notEqual(buildRenderData().recentEvents, EXTREMISM_EVENTS);
});

test('every group has a non-empty id', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(g.id.length > 0, g.name);
});

test('every group has a non-empty name', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(g.name.length > 0, g.id);
});

test('every group has a non-empty primaryRegion', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(g.primaryRegion.length > 0, g.id);
});

test('every group has at least one active country', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(g.activeCountries.length > 0, g.id);
});

test('every group has a non-empty lastMajorAttack', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(g.lastMajorAttack.length > 0, g.id);
});

test('every group has non-empty notes', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(g.notes.length > 0, g.id);
});

test('every event has a non-empty description', () => {
  for (const e of EXTREMISM_EVENTS) assert.ok(e.description.length > 0, e.id);
});

test('every event has a non-empty date', () => {
  for (const e of EXTREMISM_EVENTS) assert.ok(e.date.length > 0, e.id);
});

// ── Specific entries ───────────────────────────────────────────────────────

test('isis-core is present and critical', () => {
  const x = EXTREMIST_GROUPS.find((g) => g.id === 'isis-core');
  assert.ok(x);
  assert.equal(x?.threatLevel, 'critical');
  assert.equal(x?.ideology, 'jihadist-salafi');
});

test('isis-k is growing', () => {
  const x = EXTREMIST_GROUPS.find((g) => g.id === 'isis-k');
  assert.equal(x?.trend, 'growing');
});

test('hezbollah has the largest estimated membership', () => {
  const max = EXTREMIST_GROUPS.reduce((a, b) => (b.estimatedMembers > a.estimatedMembers ? b : a));
  assert.equal(max.id, 'hezbollah');
  assert.equal(max.estimatedMembers, 100000);
});

test('hamas had the highest 12-month attack count', () => {
  const max = EXTREMIST_GROUPS.reduce((a, b) => (b.recentAttacks12Mo > a.recentAttacks12Mo ? b : a));
  assert.equal(max.id, 'hamas');
});

test('wagner-successors are ethnonationalist and state-sponsored', () => {
  const x = EXTREMIST_GROUPS.find((g) => g.id === 'wagner-successors');
  assert.equal(x?.ideology, 'ethnonationalist');
  assert.equal(x?.financingType, 'state-sponsor');
});

test('proud-boys last major attack was Jan 6 2021', () => {
  const x = EXTREMIST_GROUPS.find((g) => g.id === 'proud-boys');
  assert.equal(x?.lastMajorAttackYear, 2021);
});

// ── getByThreatLevel ───────────────────────────────────────────────────────

test('getByThreatLevel critical returns the expected 5 groups', () => {
  const ids = getByThreatLevel(EXTREMIST_GROUPS, 'critical').map((g) => g.id).sort();
  assert.deepEqual(ids, ['hamas', 'hezbollah', 'isis-core', 'isis-k', 'jni-mali']);
});

test('getByThreatLevel high returns 4 groups', () => {
  assert.equal(getByThreatLevel(EXTREMIST_GROUPS, 'high').length, 4);
});

test('getByThreatLevel medium returns proud-boys only', () => {
  const r = getByThreatLevel(EXTREMIST_GROUPS, 'medium');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'proud-boys');
});

test('getByThreatLevel low returns 2 groups', () => {
  assert.equal(getByThreatLevel(EXTREMIST_GROUPS, 'low').length, 2);
});

test('getByThreatLevel on empty array returns []', () => {
  assert.deepEqual(getByThreatLevel([], 'critical'), []);
});

test('getByThreatLevel partitions cover all entries', () => {
  const total = THREAT_LEVELS.reduce((n, l) => n + getByThreatLevel(EXTREMIST_GROUPS, l).length, 0);
  assert.equal(total, EXTREMIST_GROUPS.length);
});

test('getByThreatLevel only returns matching level', () => {
  for (const l of THREAT_LEVELS) {
    for (const g of getByThreatLevel(EXTREMIST_GROUPS, l)) assert.equal(g.threatLevel, l);
  }
});

// ── getByIdeology ──────────────────────────────────────────────────────────

test('getByIdeology jihadist-salafi returns 7 groups', () => {
  assert.equal(getByIdeology(EXTREMIST_GROUPS, 'jihadist-salafi').length, 7);
});

test('getByIdeology far-right returns proud-boys + atomwaffen', () => {
  const ids = getByIdeology(EXTREMIST_GROUPS, 'far-right').map((g) => g.id).sort();
  assert.deepEqual(ids, ['atomwaffen', 'proud-boys']);
});

test('getByIdeology far-left returns raf-successor only', () => {
  const r = getByIdeology(EXTREMIST_GROUPS, 'far-left');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'raf-successor');
});

test('getByIdeology eco-terrorist returns eco-terrorism-eu only', () => {
  const r = getByIdeology(EXTREMIST_GROUPS, 'eco-terrorist');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'eco-terrorism-eu');
});

test('getByIdeology ethnonationalist returns wagner-successors only', () => {
  const r = getByIdeology(EXTREMIST_GROUPS, 'ethnonationalist');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'wagner-successors');
});

test('getByIdeology religious-cult returns []', () => {
  assert.deepEqual(getByIdeology(EXTREMIST_GROUPS, 'religious-cult'), []);
});

test('getByIdeology on empty array returns []', () => {
  assert.deepEqual(getByIdeology([], 'jihadist-salafi'), []);
});

test('getByIdeology only returns matching ideology', () => {
  for (const i of IDEOLOGIES) {
    for (const g of getByIdeology(EXTREMIST_GROUPS, i)) assert.equal(g.ideology, i);
  }
});

// ── getGrowingGroups ───────────────────────────────────────────────────────

test('getGrowingGroups returns the expected 4 groups', () => {
  const ids = getGrowingGroups(EXTREMIST_GROUPS).map((g) => g.id).sort();
  assert.deepEqual(ids, ['eco-terrorism-eu', 'isis-k', 'jni-mali', 'ttp']);
});

test('getGrowingGroups entries all have growing trend', () => {
  for (const g of getGrowingGroups(EXTREMIST_GROUPS)) assert.equal(g.trend, 'growing');
});

test('getGrowingGroups on empty array returns []', () => {
  assert.deepEqual(getGrowingGroups([]), []);
});

// ── getStateSponsoredGroups ────────────────────────────────────────────────

test('getStateSponsoredGroups returns hamas, hezbollah, wagner-successors', () => {
  const ids = getStateSponsoredGroups(EXTREMIST_GROUPS).map((g) => g.id).sort();
  assert.deepEqual(ids, ['hamas', 'hezbollah', 'wagner-successors']);
});

test('getStateSponsoredGroups entries all have state-sponsor financing', () => {
  for (const g of getStateSponsoredGroups(EXTREMIST_GROUPS)) assert.equal(g.financingType, 'state-sponsor');
});

test('getStateSponsoredGroups on empty array returns []', () => {
  assert.deepEqual(getStateSponsoredGroups([]), []);
});

// ── getMajorEvents ─────────────────────────────────────────────────────────

test('getMajorEvents returns exactly 5 events', () => {
  assert.equal(getMajorEvents(EXTREMISM_EVENTS).length, 5);
});

test('getMajorEvents entries all have major significance', () => {
  for (const e of getMajorEvents(EXTREMISM_EVENTS)) assert.equal(e.significance, 'major');
});

test('getMajorEvents on empty array returns []', () => {
  assert.deepEqual(getMajorEvents([]), []);
});

test('oct7-2023 has the highest fatalities (1200)', () => {
  const max = EXTREMISM_EVENTS.reduce((a, b) => (b.fatalities > a.fatalities ? b : a));
  assert.equal(max.id, 'oct7-2023');
  assert.equal(max.fatalities, 1200);
});

test('crocus-2024 has 145 fatalities', () => {
  const x = EXTREMISM_EVENTS.find((e) => e.id === 'crocus-2024');
  assert.equal(x?.fatalities, 145);
});

// ── computeGlobalExtremismThreatIndex ──────────────────────────────────────

test('computeGlobalExtremismThreatIndex returns a number', () => {
  assert.equal(typeof computeGlobalExtremismThreatIndex(EXTREMIST_GROUPS), 'number');
});

test('computeGlobalExtremismThreatIndex is within 0-100', () => {
  const v = computeGlobalExtremismThreatIndex(EXTREMIST_GROUPS);
  assert.ok(v >= 0 && v <= 100, `got ${v}`);
});

test('computeGlobalExtremismThreatIndex of empty array is 0', () => {
  assert.equal(computeGlobalExtremismThreatIndex([]), 0);
});

test('computeGlobalExtremismThreatIndex always returns an integer', () => {
  assert.ok(Number.isInteger(computeGlobalExtremismThreatIndex(EXTREMIST_GROUPS)));
});

test('computeGlobalExtremismThreatIndex of all-critical-growing is 100', () => {
  const sample: ExtremistGroup[] = EXTREMIST_GROUPS.map((g) => ({ ...g, threatLevel: 'critical', trend: 'growing' }));
  assert.equal(computeGlobalExtremismThreatIndex(sample), 100);
});

test('computeGlobalExtremismThreatIndex of all-low-declining is low', () => {
  const sample: ExtremistGroup[] = EXTREMIST_GROUPS.map((g) => ({ ...g, threatLevel: 'low', trend: 'declining' }));
  // low weight 1 over max (4 * 1.3 = 5.2) => round(19.2) = 19
  assert.equal(computeGlobalExtremismThreatIndex(sample), 19);
});

test('growing trend raises the index versus stable', () => {
  const base: ExtremistGroup[] = EXTREMIST_GROUPS.map((g) => ({ ...g, threatLevel: 'high', trend: 'stable' }));
  const hot: ExtremistGroup[] = EXTREMIST_GROUPS.map((g) => ({ ...g, threatLevel: 'high', trend: 'growing' }));
  assert.ok(computeGlobalExtremismThreatIndex(hot) > computeGlobalExtremismThreatIndex(base));
});

test('buildRenderData index matches computeGlobalExtremismThreatIndex(EXTREMIST_GROUPS)', () => {
  assert.equal(
    buildRenderData().globalExtremismThreatIndex,
    computeGlobalExtremismThreatIndex(EXTREMIST_GROUPS),
  );
});

// ── threatLevelClass ───────────────────────────────────────────────────────

test('threatLevelClass returns a non-empty string for all 4 values', () => {
  for (const l of THREAT_LEVELS) assert.ok(threatLevelClass(l).length > 0, l);
});

test('threatLevelClass critical is severity-critical', () => {
  assert.equal(threatLevelClass('critical'), 'severity-critical');
});

test('threatLevelClass values are all distinct', () => {
  const classes = new Set(THREAT_LEVELS.map((l) => threatLevelClass(l)));
  assert.equal(classes.size, 4);
});

// ── ideologyClass ──────────────────────────────────────────────────────────

test('ideologyClass returns a non-empty string for all ideology types', () => {
  for (const i of IDEOLOGIES) assert.ok(ideologyClass(i).length > 0, i);
});

test('ideologyClass jihadist-salafi is non-empty', () => {
  assert.ok(ideologyClass('jihadist-salafi').length > 0);
});

test('ideologyClass values are all distinct', () => {
  const classes = new Set(IDEOLOGIES.map((i) => ideologyClass(i)));
  assert.equal(classes.size, IDEOLOGIES.length);
});

// ── buildRenderData shape ──────────────────────────────────────────────────

test('buildRenderData validates ExtremismData shape', () => {
  const data = buildRenderData();
  assert.ok(Array.isArray(data.groups));
  assert.ok(Array.isArray(data.recentEvents));
  assert.equal(typeof data.lastUpdated, 'string');
  assert.equal(typeof data.globalExtremismThreatIndex, 'number');
});

// ── Field invariants ───────────────────────────────────────────────────────

test('all estimatedMembers are positive integers', () => {
  for (const g of EXTREMIST_GROUPS) {
    assert.ok(Number.isInteger(g.estimatedMembers), g.id);
    assert.ok(g.estimatedMembers > 0, g.id);
  }
});

test('all recentAttacks12Mo are non-negative integers', () => {
  for (const g of EXTREMIST_GROUPS) {
    assert.ok(Number.isInteger(g.recentAttacks12Mo), g.id);
    assert.ok(g.recentAttacks12Mo >= 0, g.id);
  }
});

test('all lastMajorAttackYear values are plausible (2000-2025)', () => {
  for (const g of EXTREMIST_GROUPS) {
    assert.ok(g.lastMajorAttackYear >= 2000 && g.lastMajorAttackYear <= 2025, g.id);
  }
});

test('every threatLevel is a recognized value', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(THREAT_LEVELS.includes(g.threatLevel), g.id);
});

test('every ideology is a recognized value', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(IDEOLOGIES.includes(g.ideology), g.id);
});

test('every financingType is a recognized value', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(FINANCING.includes(g.financingType), g.id);
});

test('every trend is a recognized value', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(TRENDS.includes(g.trend), g.id);
});

test('every designation is a recognized value', () => {
  for (const g of EXTREMIST_GROUPS) assert.ok(DESIGNATIONS.includes(g.designation), g.id);
});

test('all event fatalities are non-negative integers', () => {
  for (const e of EXTREMISM_EVENTS) {
    assert.ok(Number.isInteger(e.fatalities), e.id);
    assert.ok(e.fatalities >= 0, e.id);
  }
});

test('all event injured counts are non-negative integers', () => {
  for (const e of EXTREMISM_EVENTS) {
    assert.ok(Number.isInteger(e.injured), e.id);
    assert.ok(e.injured >= 0, e.id);
  }
});

test('every attackType is a recognized value', () => {
  for (const e of EXTREMISM_EVENTS) assert.ok(ATTACK_TYPES.includes(e.attackType), e.id);
});

test('every significance is a recognized value', () => {
  for (const e of EXTREMISM_EVENTS) assert.ok(SIGNIFICANCE.includes(e.significance), e.id);
});

test('filters never mutate the source arrays', () => {
  const beforeG = EXTREMIST_GROUPS.length;
  const beforeE = EXTREMISM_EVENTS.length;
  getByThreatLevel(EXTREMIST_GROUPS, 'critical');
  getByIdeology(EXTREMIST_GROUPS, 'jihadist-salafi');
  getGrowingGroups(EXTREMIST_GROUPS);
  getStateSponsoredGroups(EXTREMIST_GROUPS);
  getMajorEvents(EXTREMISM_EVENTS);
  assert.equal(EXTREMIST_GROUPS.length, beforeG);
  assert.equal(EXTREMISM_EVENTS.length, beforeE);
});
