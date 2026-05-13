import assert from 'node:assert/strict';
import test from 'node:test';

import {
  _clearRegistryForTests,
  allEntities,
  canonicalRegistrySize,
  getByDomain,
  getByType,
  getLinkedObservations,
  link,
  register,
  resolve,
  topByRisk,
  updateRiskScore,
} from '../entity-registry.ts';

function reset(): void { _clearRegistryForTests(); }

// ── register / merge ──────────────────────────────────────────────────────

test('register: creates a new entity with defaults for omitted fields', () => {
  reset();
  const e = register({
    id: 'ship:mmsi:111111111',
    type: 'ship',
    canonicalName: 'MV Horizon',
  });
  assert.equal(e.id, 'ship:mmsi:111111111');
  assert.equal(e.type, 'ship');
  assert.deepEqual(e.aliases, []);
  assert.deepEqual(e.identifiers, {});
  assert.deepEqual(e.domains, []);
  assert.equal(e.riskScore, 0);
  assert.deepEqual(e.attributes, {});
  assert.ok(e.lastSeen > 0);
});

test('register: clamps riskScore into [0,1]', () => {
  reset();
  const high = register({ id: 'a', type: 'person', canonicalName: 'A', riskScore: 5 });
  const low = register({ id: 'b', type: 'person', canonicalName: 'B', riskScore: -3 });
  assert.equal(high.riskScore, 1);
  assert.equal(low.riskScore, 0);
});

test('register: merging dedupes aliases + domains, max-wins on risk', () => {
  reset();
  register({
    id: 'ship:mmsi:111111111', type: 'ship', canonicalName: 'MV Horizon',
    aliases: ['HORIZON'], identifiers: { mmsi: '111111111' },
    domains: ['maritime'], riskScore: 0.3,
  });
  const merged = register({
    id: 'ship:mmsi:111111111', type: 'ship', canonicalName: 'MV Horizon',
    aliases: ['HORIZON', 'Mv Horizon'], identifiers: { imo: '1234567' },
    domains: ['maritime', 'sanctions'], riskScore: 0.7,
  });
  assert.deepEqual(merged.aliases, ['HORIZON', 'Mv Horizon']);
  assert.deepEqual(merged.identifiers, { mmsi: '111111111', imo: '1234567' });
  assert.deepEqual(merged.domains, ['maritime', 'sanctions']);
  assert.equal(merged.riskScore, 0.7);
});

test('register: merging never lowers riskScore', () => {
  reset();
  register({ id: 'p1', type: 'person', canonicalName: 'P', riskScore: 0.8 });
  const merged = register({ id: 'p1', type: 'person', canonicalName: 'P', riskScore: 0.1 });
  assert.equal(merged.riskScore, 0.8);
});

// ── resolve ────────────────────────────────────────────────────────────────

test('resolve: exact id match returns the entity', () => {
  reset();
  register({ id: 'ship:mmsi:111111111', type: 'ship', canonicalName: 'MV Horizon' });
  const hit = resolve('ship:mmsi:111111111');
  assert.equal(hit?.canonicalName, 'MV Horizon');
});

test('resolve: exact identifier value across any namespace', () => {
  reset();
  register({
    id: 'ship:mmsi:111111111', type: 'ship', canonicalName: 'MV Horizon',
    identifiers: { mmsi: '111111111', imo: '7654321' },
  });
  assert.equal(resolve('7654321')?.canonicalName, 'MV Horizon');
});

test('resolve: case-insensitive canonical name', () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  assert.equal(resolve('ual123')?.id, 'a1');
});

test('resolve: case-insensitive alias match', () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123', aliases: ['United 123'] });
  assert.equal(resolve('united 123')?.id, 'a1');
});

test('resolve: fuzzy normalization handles punctuation + spaces', () => {
  reset();
  register({ id: 's1', type: 'ship', canonicalName: 'M.V. Horizon' });
  assert.equal(resolve('mv horizon')?.id, 's1');
  assert.equal(resolve('MVHORIZON')?.id, 's1');
});

test('resolve: fuzzy substring on canonical name', () => {
  reset();
  register({ id: 's1', type: 'ship', canonicalName: 'MV Pacific Horizon' });
  assert.equal(resolve('horizon')?.id, 's1');
});

test('resolve: empty / whitespace query returns undefined', () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  assert.equal(resolve(''), undefined);
  assert.equal(resolve('   '), undefined);
});

test('resolve: returns undefined when nothing matches', () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  assert.equal(resolve('something-else-entirely'), undefined);
});

// ── getByType / getByDomain ────────────────────────────────────────────────

test('getByType: filters by entity type', () => {
  reset();
  register({ id: 's1', type: 'ship', canonicalName: 'Ship' });
  register({ id: 'a1', type: 'aircraft', canonicalName: 'Aircraft' });
  register({ id: 'p1', type: 'person', canonicalName: 'Person' });
  const ships = getByType('ship');
  assert.equal(ships.length, 1);
  assert.equal(ships[0]!.id, 's1');
});

test('getByDomain: returns entities whose domains include the query', () => {
  reset();
  register({ id: 's1', type: 'ship', canonicalName: 'Ship', domains: ['maritime'] });
  register({ id: 'a1', type: 'aircraft', canonicalName: 'Aircraft', domains: ['aviation', 'conflict'] });
  assert.equal(getByDomain('conflict').length, 1);
  assert.equal(getByDomain('maritime').length, 1);
  assert.equal(getByDomain('cyber').length, 0);
});

// ── link / getLinkedObservations ───────────────────────────────────────────

test('link: associates an observation with an entity and is queryable', () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  link('a1', 'obs-1');
  const linked = getLinkedObservations('a1');
  assert.equal(linked.length, 1);
  assert.equal(linked[0]!.observationId, 'obs-1');
});

test('link: idempotent on same (entity, observation) pair', () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  link('a1', 'obs-1');
  link('a1', 'obs-1', 'sit-1');
  const linked = getLinkedObservations('a1');
  assert.equal(linked.length, 1);
  assert.equal(linked[0]!.situationId, 'sit-1');
});

test('link: returns undefined when the entity does not exist', () => {
  reset();
  assert.equal(link('ghost', 'obs-1'), undefined);
});

test('getLinkedObservations: sorted newest first', async () => {
  reset();
  register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  link('a1', 'obs-1');
  await new Promise((r) => setTimeout(r, 2));
  link('a1', 'obs-2');
  await new Promise((r) => setTimeout(r, 2));
  link('a1', 'obs-3');
  const linked = getLinkedObservations('a1');
  assert.equal(linked[0]!.observationId, 'obs-3');
  assert.equal(linked[2]!.observationId, 'obs-1');
});

test('link: updates entity.lastSeen', async () => {
  reset();
  const created = register({ id: 'a1', type: 'aircraft', canonicalName: 'UAL123' });
  const before = created.lastSeen;
  await new Promise((r) => setTimeout(r, 5));
  link('a1', 'obs-1');
  const after = allEntities().find((e) => e.id === 'a1')!;
  assert.ok(after.lastSeen > before);
});

// ── updateRiskScore ────────────────────────────────────────────────────────

test('updateRiskScore: stores the new score (clamped) and returns the entity', () => {
  reset();
  register({ id: 'p1', type: 'person', canonicalName: 'P' });
  const updated = updateRiskScore('p1', 0.42);
  assert.equal(updated?.riskScore, 0.42);
  const overshoot = updateRiskScore('p1', 9);
  assert.equal(overshoot?.riskScore, 1);
});

test('updateRiskScore: returns undefined when the entity does not exist', () => {
  reset();
  assert.equal(updateRiskScore('nope', 0.5), undefined);
});

// ── topByRisk + housekeeping ───────────────────────────────────────────────

test('topByRisk: returns highest scores first, capped at limit', () => {
  reset();
  register({ id: 'a', type: 'person', canonicalName: 'A', riskScore: 0.1 });
  register({ id: 'b', type: 'person', canonicalName: 'B', riskScore: 0.9 });
  register({ id: 'c', type: 'person', canonicalName: 'C', riskScore: 0.5 });
  const top = topByRisk(2);
  assert.equal(top.length, 2);
  assert.equal(top[0]!.id, 'b');
  assert.equal(top[1]!.id, 'c');
});

test('canonicalRegistrySize + allEntities reflect inserts', () => {
  reset();
  assert.equal(canonicalRegistrySize(), 0);
  register({ id: 'a', type: 'person', canonicalName: 'A' });
  register({ id: 'b', type: 'organization', canonicalName: 'B' });
  assert.equal(canonicalRegistrySize(), 2);
  assert.equal(allEntities().length, 2);
});
