import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORAGE_KEY,
  __resetIdCounter,
  createRule,
  deleteRuleById,
  evaluate,
  evaluateCondition,
  extractContainment,
  extractMagnitude,
  haversineKm,
  isValidRule,
  loadRules,
  parseLatLon,
  runRuleActions,
  ruleMatches,
  saveRules,
  upsertRule,
  type CreateRuleInput,
} from '../rules-engine.ts';
import type { AlertRule, ObservationEvent, RuleCondition } from '@/types/intelligence';

const NOW = Date.parse('2026-05-11T12:00:00Z');

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  has(key: string): boolean { return this.map.has(key); }
}

function observation(over: Partial<ObservationEvent> = {}): ObservationEvent {
  const location = 'location' in over ? over.location : { lat: 41.6, lon: -86.7, radiusKm: 30 };
  return {
    id: over.id ?? 'obs-1',
    sourceId: over.sourceId ?? 'usgs-earthquake',
    domain: over.domain ?? 'natural',
    timestamp: over.timestamp ?? NOW,
    location,
    severity: over.severity ?? 'HIGH',
    title: over.title ?? 'M5.8 earthquake near Tokyo',
    raw: over.raw ?? { magnitude: 5.8 },
    entityIds: over.entityIds ?? [],
    tags: over.tags ?? ['earthquake'],
  };
}

function rule(over: Partial<CreateRuleInput> = {}): AlertRule {
  return createRule({
    name: over.name ?? 'test rule',
    enabled: over.enabled ?? true,
    conditions: over.conditions ?? [{ field: 'domain', operator: 'equals', value: 'natural' }],
    conditionOperator: over.conditionOperator ?? 'AND',
    actions: over.actions ?? [{ type: 'notify' }],
  }, NOW);
}

// ── Geo + parsing helpers ─────────────────────────────────────────────────

test('haversineKm ~111 km per degree along the equator', () => {
  assert.ok(haversineKm(0, 0, 0, 1) > 110 && haversineKm(0, 0, 0, 1) < 112);
});

test('parseLatLon parses well-formed strings, rejects garbage', () => {
  assert.deepEqual(parseLatLon('41.6,-86.7'), { lat: 41.6, lon: -86.7 });
  assert.deepEqual(parseLatLon('  41.6 , -86.7  '), { lat: 41.6, lon: -86.7 });
  assert.equal(parseLatLon('not a coord'), null);
  assert.equal(parseLatLon('200,0'), null);   // out of range
  assert.equal(parseLatLon(42), null);
  assert.equal(parseLatLon(null), null);
});

test('extractMagnitude pulls from raw / tag / title in priority order', () => {
  assert.equal(extractMagnitude(observation({ raw: { magnitude: 6.4 } })), 6.4);
  assert.equal(extractMagnitude(observation({ raw: {}, tags: ['mag:5.5', 'earthquake'] })), 5.5);
  assert.equal(extractMagnitude(observation({ raw: {}, tags: [],
    title: 'M7.2 earthquake near Honshu' })), 7.2);
  assert.equal(extractMagnitude(observation({ raw: {}, tags: [],
    title: 'minor tremor' })), null);
});

test('extractContainment pulls from raw / tag / title', () => {
  assert.equal(extractContainment(observation({ raw: { containment: 35 } })), 35);
  assert.equal(extractContainment(observation({ raw: {}, tags: ['containment:5'] })), 5);
  assert.equal(extractContainment(observation({ raw: {}, tags: [],
    title: 'Caldor Fire — 22% contained' })), 22);
  assert.equal(extractContainment(observation({ raw: {}, tags: [], title: 'new fire' })), null);
});

// ── Per-field condition matchers ──────────────────────────────────────────

test('evaluateCondition: domain equals + contains (case-insensitive)', () => {
  const evt = observation({ domain: 'natural' });
  assert.equal(evaluateCondition(evt, { field: 'domain', operator: 'equals', value: 'NATURAL' }), true);
  assert.equal(evaluateCondition(evt, { field: 'domain', operator: 'contains', value: 'nat' }), true);
  assert.equal(evaluateCondition(evt, { field: 'domain', operator: 'equals', value: 'finance' }), false);
});

test('evaluateCondition: keyword scans title + tags', () => {
  const evt = observation({ title: 'M5.8 earthquake near Tokyo', tags: ['tsunami-risk'] });
  assert.equal(evaluateCondition(evt, { field: 'keyword', operator: 'contains', value: 'tsunami' }), true);
  assert.equal(evaluateCondition(evt, { field: 'keyword', operator: 'contains', value: 'tokyo' }), true);
  assert.equal(evaluateCondition(evt, { field: 'keyword', operator: 'contains', value: 'sydney' }), false);
});

test('evaluateCondition: severity equals and gt / lt ladder', () => {
  const evt = observation({ severity: 'HIGH' });
  assert.equal(evaluateCondition(evt, { field: 'severity', operator: 'equals', value: 'HIGH' }), true);
  assert.equal(evaluateCondition(evt, { field: 'severity', operator: 'gt', value: 'MEDIUM' }), true);
  assert.equal(evaluateCondition(evt, { field: 'severity', operator: 'lt', value: 'CRITICAL' }), true);
  assert.equal(evaluateCondition(evt, { field: 'severity', operator: 'gt', value: 'CRITICAL' }), false);
});

test('evaluateCondition: magnitude gt / lt / equals against extracted value', () => {
  const evt = observation({ raw: { magnitude: 6.2 } });
  assert.equal(evaluateCondition(evt, { field: 'magnitude', operator: 'gt', value: 5 }), true);
  assert.equal(evaluateCondition(evt, { field: 'magnitude', operator: 'lt', value: 7 }), true);
  assert.equal(evaluateCondition(evt, { field: 'magnitude', operator: 'equals', value: 6.2 }), true);
  assert.equal(evaluateCondition(evt, { field: 'magnitude', operator: 'gt', value: 10 }), false);
});

test('evaluateCondition: magnitude returns false when none extractable', () => {
  const evt = observation({ raw: {}, tags: [], title: 'no magnitude here' });
  assert.equal(evaluateCondition(evt, { field: 'magnitude', operator: 'gt', value: 0 }), false);
});

test('evaluateCondition: containment lt for "needs attention" rules', () => {
  const evt = observation({ raw: { containment: 5 } });
  assert.equal(evaluateCondition(evt, { field: 'containment', operator: 'lt', value: 10 }), true);
  assert.equal(evaluateCondition(evt, { field: 'containment', operator: 'gt', value: 50 }), false);
});

test('evaluateCondition: location near with haversine + radiusKm', () => {
  // La Porte, IN at (41.6, -86.7)
  const evt = observation({ location: { lat: 41.6, lon: -86.7 } });
  // Same coords with 50 km radius
  const cond: RuleCondition = { field: 'location', operator: 'near',
    value: '41.6,-86.7', radiusKm: 50 };
  assert.equal(evaluateCondition(evt, cond), true);
  // Sydney — should fail
  const sydney: RuleCondition = { field: 'location', operator: 'near',
    value: '-33,151', radiusKm: 50 };
  assert.equal(evaluateCondition(evt, sydney), false);
});

test('evaluateCondition: location near requires positive radiusKm + valid coords', () => {
  const evt = observation();
  assert.equal(evaluateCondition(evt,
    { field: 'location', operator: 'near', value: '41,-86' /* no radius */ }), false);
  assert.equal(evaluateCondition(evt,
    { field: 'location', operator: 'near', value: '41,-86', radiusKm: 0 }), false);
  assert.equal(evaluateCondition(evt,
    { field: 'location', operator: 'near', value: 'not-a-coord', radiusKm: 50 }), false);
});

test('evaluateCondition: location near returns false when event has no location', () => {
  const evt = observation({ location: undefined });
  assert.equal(evaluateCondition(evt,
    { field: 'location', operator: 'near', value: '41,-86', radiusKm: 50 }), false);
});

// ── Rule-level AND / OR composition ──────────────────────────────────────

test('ruleMatches: AND requires every condition to pass', () => {
  const evt = observation({ domain: 'natural', severity: 'HIGH', raw: { magnitude: 6.4 } });
  const passes = rule({
    conditionOperator: 'AND',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'natural' },
      { field: 'magnitude', operator: 'gt', value: 5 },
    ],
  });
  const fails = rule({
    conditionOperator: 'AND',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'natural' },
      { field: 'magnitude', operator: 'gt', value: 9 },
    ],
  });
  assert.equal(ruleMatches(evt, passes), true);
  assert.equal(ruleMatches(evt, fails), false);
});

test('ruleMatches: OR passes when any condition matches', () => {
  const evt = observation({ domain: 'natural', severity: 'HIGH', raw: { magnitude: 4.2 } });
  const r = rule({
    conditionOperator: 'OR',
    conditions: [
      { field: 'magnitude', operator: 'gt', value: 6 }, // false
      { field: 'severity', operator: 'equals', value: 'HIGH' }, // true
    ],
  });
  assert.equal(ruleMatches(evt, r), true);
});

test('ruleMatches: disabled rules never match', () => {
  const evt = observation();
  const r = rule({ enabled: false,
    conditions: [{ field: 'domain', operator: 'equals', value: 'natural' }] });
  assert.equal(ruleMatches(evt, r), false);
});

test('ruleMatches: empty conditions list never matches (defensive)', () => {
  const evt = observation();
  const r = rule({ conditions: [] });
  assert.equal(ruleMatches(evt, r), false);
});

test('evaluate: returns every matching rule, in declaration order', () => {
  const evt = observation({ severity: 'HIGH' });
  const r1 = rule({ name: 'r1',
    conditions: [{ field: 'severity', operator: 'equals', value: 'HIGH' }] });
  const r2 = rule({ name: 'r2',
    conditions: [{ field: 'severity', operator: 'equals', value: 'CRITICAL' }] });
  const r3 = rule({ name: 'r3', conditions: [{ field: 'domain', operator: 'equals', value: 'natural' }] });
  const triggered = evaluate(evt, [r1, r2, r3]);
  assert.deepEqual(triggered.map((r) => r.name), ['r1', 'r3']);
});

// ── Action dispatch ──────────────────────────────────────────────────────

test('runRuleActions: increments triggerCount and stamps lastTriggered', () => {
  const r = rule({ actions: [{ type: 'notify' }] });
  const { rule: after, dispatched } = runRuleActions(r, observation(),
    { dispatch: null, log: null });
  assert.equal(dispatched, 1);
  assert.equal(after.triggerCount, 1);
  assert.ok(after.lastTriggered && after.lastTriggered > 0);
});

test('runRuleActions: dispatches one wm:rule-triggered event per action', () => {
  const calls: { name: string; ruleId: string; eventId: string }[] = [];
  const r = rule({ actions: [{ type: 'notify' }, { type: 'log' }, { type: 'escalate' }] });
  const evt = observation({ id: 'obs-9' });
  const result = runRuleActions(r, evt, {
    dispatch: (name, detail) =>
      calls.push({ name, ruleId: detail.rule.id, eventId: detail.event.id }),
    log: null,
  });
  assert.equal(result.dispatched, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.name === 'wm:rule-triggered'));
  assert.ok(calls.every((c) => c.ruleId === r.id && c.eventId === 'obs-9'));
});

test('runRuleActions: log action writes a single line per action', () => {
  const lines: string[] = [];
  const r = rule({ name: 'logger', actions: [{ type: 'log' }] });
  runRuleActions(r, observation({ id: 'obs-log' }),
    { dispatch: null, log: (line) => lines.push(line) });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /logger matched event obs-log/);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('saveRules + loadRules round-trips through localStorage shape', () => {
  __resetIdCounter();
  const storage = new MemoryStorage();
  const r = rule();
  saveRules([r], storage);
  assert.ok(storage.has(STORAGE_KEY));
  const loaded = loadRules(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.id, r.id);
});

test('loadRules returns [] on corrupt JSON / missing entry / non-array', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadRules(storage), []);
  storage.setItem(STORAGE_KEY, '{not valid json');
  assert.deepEqual(loadRules(storage), []);
  storage.setItem(STORAGE_KEY, JSON.stringify({ rules: [] }));
  assert.deepEqual(loadRules(storage), []);
});

test('loadRules drops entries that fail isValidRule', () => {
  const storage = new MemoryStorage();
  const r = rule();
  storage.setItem(STORAGE_KEY, JSON.stringify([
    r,
    { id: 'broken', name: 'no fields' },  // invalid
    null,
    'not an object',
  ]));
  const loaded = loadRules(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.id, r.id);
});

test('saveRules tolerates a storage host that throws on setItem', () => {
  const r = rule();
  const throwing: { getItem: () => null; setItem: () => never; removeItem: () => void } = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => { /* noop */ },
  };
  // Should not throw.
  saveRules([r], throwing);
});

test('upsertRule / deleteRuleById produce new arrays with merge semantics', () => {
  const a = rule({ name: 'a' });
  const b = rule({ name: 'b' });
  let arr = [a];
  arr = upsertRule(b, arr);
  assert.equal(arr.length, 2);
  // Update existing by id replaces it.
  const updated = { ...a, name: 'a-updated' };
  arr = upsertRule(updated, arr);
  assert.equal(arr.length, 2);
  assert.ok(arr.find((r) => r.id === a.id)?.name === 'a-updated');
  arr = deleteRuleById(a.id, arr);
  assert.equal(arr.length, 1);
  assert.equal(arr[0]?.id, b.id);
});

// ── Validation ───────────────────────────────────────────────────────────

test('isValidRule accepts a well-formed AlertRule', () => {
  assert.equal(isValidRule(rule()), true);
});

test('isValidRule rejects unknown field / operator / action type', () => {
  const base = rule();
  assert.equal(isValidRule({ ...base, conditionOperator: 'XOR' }), false);
  assert.equal(isValidRule({ ...base,
    conditions: [{ field: 'unknown', operator: 'equals', value: 1 }] }), false);
  assert.equal(isValidRule({ ...base,
    conditions: [{ field: 'domain', operator: 'matches', value: 'x' }] }), false);
  assert.equal(isValidRule({ ...base,
    actions: [{ type: 'launch_missile' }] }), false);
});

test('isValidRule rejects non-object / missing fields', () => {
  assert.equal(isValidRule(null), false);
  assert.equal(isValidRule({ id: 'x' }), false);
  assert.equal(isValidRule({ ...rule(), enabled: 'yes' as unknown as boolean }), false);
});
