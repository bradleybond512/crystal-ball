import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSURGENCIES,
  buildRenderData,
  getByStatus,
  getByStrength,
  getByRegion,
  getEscalating,
  computeGlobalInsurgencyIndex,
  strengthClass,
  statusClass,
  type Insurgency,
} from '../insurgency-tracker-helpers';

const STATUSES: Insurgency['status'][] = ['active', 'declining', 'escalating', 'ceasefire'];
const STRENGTHS: Insurgency['strength'][] = ['low', 'medium', 'high', 'very-high'];

// ── Fixture shape ──────────────────────────────────────────────────────────

test('buildRenderData returns all 10 insurgencies', () => {
  assert.equal(buildRenderData().insurgencies.length, 10);
});

test('INSURGENCIES const has exactly 10 entries', () => {
  assert.equal(INSURGENCIES.length, 10);
});

test('all insurgency ids are unique', () => {
  const ids = new Set(INSURGENCIES.map((i) => i.id));
  assert.equal(ids.size, 10);
});

test('all insurgency names are unique', () => {
  const names = new Set(INSURGENCIES.map((i) => i.name));
  assert.equal(names.size, 10);
});

test('buildRenderData lastUpdated is set', () => {
  assert.ok(buildRenderData().lastUpdated.length > 0);
});

test('buildRenderData returns a copy, not the shared array', () => {
  assert.notEqual(buildRenderData().insurgencies, INSURGENCIES);
});

test('every insurgency has a non-empty id', () => {
  for (const i of INSURGENCIES) assert.ok(i.id.length > 0, i.name);
});

test('every insurgency has a non-empty name', () => {
  for (const i of INSURGENCIES) assert.ok(i.name.length > 0, i.id);
});

test('every insurgency has a non-empty country', () => {
  for (const i of INSURGENCIES) assert.ok(i.country.length > 0, i.id);
});

test('every insurgency has a non-empty region', () => {
  for (const i of INSURGENCIES) assert.ok(i.region.length > 0, i.id);
});

test('every insurgency has a non-empty group', () => {
  for (const i of INSURGENCIES) assert.ok(i.group.length > 0, i.id);
});

test('every insurgency has a non-empty territory', () => {
  for (const i of INSURGENCIES) assert.ok(i.territory.length > 0, i.id);
});

test('every insurgency has a non-empty lastUpdate', () => {
  for (const i of INSURGENCIES) assert.ok(i.lastUpdate.length > 0, i.id);
});

// ── Specific entries ───────────────────────────────────────────────────────

test('Russia-Ukraine has the highest annualFatalities', () => {
  const max = INSURGENCIES.reduce((a, b) => (b.annualFatalities > a.annualFatalities ? b : a));
  assert.equal(max.id, 'ukraine-russia-war');
  assert.equal(max.annualFatalities, 45_000);
});

test('Philippine CPP-NPA has the lowest annualFatalities', () => {
  const min = INSURGENCIES.reduce((a, b) => (b.annualFatalities < a.annualFatalities ? b : a));
  assert.equal(min.id, 'philippines-npa');
});

test('isis-sahel is present and escalating', () => {
  const x = INSURGENCIES.find((i) => i.id === 'isis-sahel');
  assert.ok(x);
  assert.equal(x?.status, 'escalating');
  assert.equal(x?.trend, 'intensifying');
});

test('myanmar-civil-war started in 2021', () => {
  const x = INSURGENCIES.find((i) => i.id === 'myanmar-civil-war');
  assert.equal(x?.startYear, 2021);
});

test('colombia-eln is the oldest insurgency (1964)', () => {
  const oldest = INSURGENCIES.reduce((a, b) => (b.startYear < a.startYear ? b : a));
  assert.equal(oldest.id, 'colombia-eln');
  assert.equal(oldest.startYear, 1964);
});

test('ukraine-russia-war has external support', () => {
  const x = INSURGENCIES.find((i) => i.id === 'ukraine-russia-war');
  assert.equal(x?.externalSupport, 'Russia state-sponsored');
});

test('somalia-al-shabaab has no external support', () => {
  const x = INSURGENCIES.find((i) => i.id === 'somalia-al-shabaab');
  assert.equal(x?.externalSupport, null);
});

// ── getByStatus ────────────────────────────────────────────────────────────

test('getByStatus declining returns philippines-npa only', () => {
  const r = getByStatus(INSURGENCIES, 'declining');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'philippines-npa');
});

test('getByStatus escalating returns isis-sahel + myanmar', () => {
  const ids = getByStatus(INSURGENCIES, 'escalating').map((i) => i.id).sort();
  assert.deepEqual(ids, ['isis-sahel', 'myanmar-civil-war']);
});

test('getByStatus ceasefire returns empty', () => {
  assert.deepEqual(getByStatus(INSURGENCIES, 'ceasefire'), []);
});

test('getByStatus active returns 7 insurgencies', () => {
  assert.equal(getByStatus(INSURGENCIES, 'active').length, 7);
});

test('getByStatus on empty array returns []', () => {
  assert.deepEqual(getByStatus([], 'active'), []);
});

test('getByStatus partitions cover all entries', () => {
  const total = STATUSES.reduce((n, s) => n + getByStatus(INSURGENCIES, s).length, 0);
  assert.equal(total, INSURGENCIES.length);
});

test('getByStatus only returns matching status', () => {
  for (const s of STATUSES) {
    for (const i of getByStatus(INSURGENCIES, s)) assert.equal(i.status, s);
  }
});

// ── getByStrength ──────────────────────────────────────────────────────────

test('getByStrength very-high returns ukraine-russia-war only', () => {
  const r = getByStrength(INSURGENCIES, 'very-high');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'ukraine-russia-war');
});

test('getByStrength high returns 4 insurgencies', () => {
  assert.equal(getByStrength(INSURGENCIES, 'high').length, 4);
});

test('getByStrength medium returns 4 insurgencies', () => {
  assert.equal(getByStrength(INSURGENCIES, 'medium').length, 4);
});

test('getByStrength low returns philippines-npa only', () => {
  const r = getByStrength(INSURGENCIES, 'low');
  assert.equal(r.length, 1);
  assert.equal(r[0]?.id, 'philippines-npa');
});

test('getByStrength on empty array returns []', () => {
  assert.deepEqual(getByStrength([], 'high'), []);
});

test('getByStrength partitions cover all entries', () => {
  const total = STRENGTHS.reduce((n, s) => n + getByStrength(INSURGENCIES, s).length, 0);
  assert.equal(total, INSURGENCIES.length);
});

test('getByStrength only returns matching strength', () => {
  for (const s of STRENGTHS) {
    for (const i of getByStrength(INSURGENCIES, s)) assert.equal(i.strength, s);
  }
});

// ── getByRegion ────────────────────────────────────────────────────────────

test('getByRegion East Africa returns somalia + ethiopia', () => {
  const ids = getByRegion(INSURGENCIES, 'East Africa').map((i) => i.id).sort();
  assert.deepEqual(ids, ['ethiopia-amhara', 'somalia-al-shabaab']);
});

test('getByRegion West Africa returns isis-sahel + nigeria', () => {
  const ids = getByRegion(INSURGENCIES, 'West Africa').map((i) => i.id).sort();
  assert.deepEqual(ids, ['isis-sahel', 'nigeria-boko-haram']);
});

test('getByRegion Southeast Asia returns myanmar + philippines', () => {
  const ids = getByRegion(INSURGENCIES, 'Southeast Asia').map((i) => i.id).sort();
  assert.deepEqual(ids, ['myanmar-civil-war', 'philippines-npa']);
});

test('getByRegion unknown region returns []', () => {
  assert.deepEqual(getByRegion(INSURGENCIES, 'Antarctica'), []);
});

test('getByRegion on empty array returns []', () => {
  assert.deepEqual(getByRegion([], 'East Africa'), []);
});

test('getByRegion only returns matching region', () => {
  for (const i of getByRegion(INSURGENCIES, 'Middle East')) assert.equal(i.region, 'Middle East');
});

// ── getEscalating ──────────────────────────────────────────────────────────

test('getEscalating returns exactly isis-sahel + myanmar-civil-war', () => {
  const ids = getEscalating(INSURGENCIES).map((i) => i.id).sort();
  assert.deepEqual(ids, ['isis-sahel', 'myanmar-civil-war']);
});

test('getEscalating entries all have intensifying trend', () => {
  for (const i of getEscalating(INSURGENCIES)) assert.equal(i.trend, 'intensifying');
});

test('getEscalating on empty array returns []', () => {
  assert.deepEqual(getEscalating([]), []);
});

// ── computeGlobalInsurgencyIndex ───────────────────────────────────────────

test('computeGlobalInsurgencyIndex returns a number', () => {
  assert.equal(typeof computeGlobalInsurgencyIndex(INSURGENCIES), 'number');
});

test('computeGlobalInsurgencyIndex is within 0-100', () => {
  const v = computeGlobalInsurgencyIndex(INSURGENCIES);
  assert.ok(v >= 0 && v <= 100, `got ${v}`);
});

test('computeGlobalInsurgencyIndex of empty array is 0', () => {
  assert.equal(computeGlobalInsurgencyIndex([]), 0);
});

test('computeGlobalInsurgencyIndex of all-low/waning is low', () => {
  const sample: Insurgency[] = INSURGENCIES.map((i) => ({ ...i, strength: 'low', trend: 'waning' }));
  // low weight 1 over max 6 => round(16.67) = 17
  assert.equal(computeGlobalInsurgencyIndex(sample), 17);
});

test('computeGlobalInsurgencyIndex of all very-high intensifying is 100', () => {
  const sample: Insurgency[] = INSURGENCIES.map((i) => ({ ...i, strength: 'very-high', trend: 'intensifying' }));
  assert.equal(computeGlobalInsurgencyIndex(sample), 100);
});

test('intensifying trend raises the index versus stable', () => {
  const base: Insurgency[] = INSURGENCIES.map((i) => ({ ...i, strength: 'high', trend: 'stable' }));
  const hot: Insurgency[] = INSURGENCIES.map((i) => ({ ...i, strength: 'high', trend: 'intensifying' }));
  assert.ok(computeGlobalInsurgencyIndex(hot) > computeGlobalInsurgencyIndex(base));
});

test('computeGlobalInsurgencyIndex always returns an integer', () => {
  assert.ok(Number.isInteger(computeGlobalInsurgencyIndex(INSURGENCIES)));
});

test('buildRenderData index matches computeGlobalInsurgencyIndex(INSURGENCIES)', () => {
  assert.equal(buildRenderData().globalInsurgencyIndex, computeGlobalInsurgencyIndex(INSURGENCIES));
});

// ── strengthClass ──────────────────────────────────────────────────────────

test('strengthClass returns a non-empty string for all 4 values', () => {
  for (const s of STRENGTHS) assert.ok(strengthClass(s).length > 0, s);
});

test('strengthClass very-high is severity-critical', () => {
  assert.equal(strengthClass('very-high'), 'severity-critical');
});

test('strengthClass high is severity-high', () => {
  assert.equal(strengthClass('high'), 'severity-high');
});

test('strengthClass medium is severity-medium', () => {
  assert.equal(strengthClass('medium'), 'severity-medium');
});

test('strengthClass low is severity-low', () => {
  assert.equal(strengthClass('low'), 'severity-low');
});

test('strengthClass values are all distinct', () => {
  const classes = new Set(STRENGTHS.map((s) => strengthClass(s)));
  assert.equal(classes.size, 4);
});

// ── statusClass ────────────────────────────────────────────────────────────

test('statusClass returns a non-empty string for all 4 values', () => {
  for (const s of STATUSES) assert.ok(statusClass(s).length > 0, s);
});

test('statusClass escalating is status-escalating', () => {
  assert.equal(statusClass('escalating'), 'status-escalating');
});

test('statusClass active is status-active', () => {
  assert.equal(statusClass('active'), 'status-active');
});

test('statusClass declining is status-declining', () => {
  assert.equal(statusClass('declining'), 'status-declining');
});

test('statusClass ceasefire is status-ceasefire', () => {
  assert.equal(statusClass('ceasefire'), 'status-ceasefire');
});

test('statusClass values are all distinct', () => {
  const classes = new Set(STATUSES.map((s) => statusClass(s)));
  assert.equal(classes.size, 4);
});

// ── Field invariants ───────────────────────────────────────────────────────

test('all annualFatalities are positive integers', () => {
  for (const i of INSURGENCIES) {
    assert.ok(Number.isInteger(i.annualFatalities), i.id);
    assert.ok(i.annualFatalities > 0, i.id);
  }
});

test('all displacedPersons are non-negative integers', () => {
  for (const i of INSURGENCIES) {
    assert.ok(Number.isInteger(i.displacedPersons), i.id);
    assert.ok(i.displacedPersons >= 0, i.id);
  }
});

test('all governmentControl values are within 0-100', () => {
  for (const i of INSURGENCIES) {
    assert.ok(i.governmentControl >= 0 && i.governmentControl <= 100, i.id);
  }
});

test('all startYear values are plausible (1900-2025)', () => {
  for (const i of INSURGENCIES) {
    assert.ok(i.startYear >= 1900 && i.startYear <= 2025, i.id);
  }
});

test('every status is a recognized value', () => {
  for (const i of INSURGENCIES) assert.ok(STATUSES.includes(i.status), i.id);
});

test('every strength is a recognized value', () => {
  for (const i of INSURGENCIES) assert.ok(STRENGTHS.includes(i.strength), i.id);
});

test('every trend is a recognized value', () => {
  const trends = new Set<Insurgency['trend']>(['intensifying', 'stable', 'waning']);
  for (const i of INSURGENCIES) assert.ok(trends.has(i.trend), i.id);
});

test('every ideologyType is a recognized value', () => {
  const ideologies = new Set<Insurgency['ideologyType']>([
    'jihadist', 'separatist', 'communist', 'nationalist', 'criminal', 'mixed',
  ]);
  for (const i of INSURGENCIES) assert.ok(ideologies.has(i.ideologyType), i.id);
});

test('externalSupport is either a non-empty string or null', () => {
  for (const i of INSURGENCIES) {
    if (i.externalSupport !== null) assert.ok(i.externalSupport.length > 0, i.id);
  }
});

test('filters never mutate the source array', () => {
  const before = INSURGENCIES.length;
  getByStatus(INSURGENCIES, 'active');
  getByStrength(INSURGENCIES, 'high');
  getByRegion(INSURGENCIES, 'East Africa');
  getEscalating(INSURGENCIES);
  assert.equal(INSURGENCIES.length, before);
});
