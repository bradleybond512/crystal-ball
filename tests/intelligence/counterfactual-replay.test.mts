/**
 * Tests for CounterfactualReplayEngine — what-if scenario engine.
 *
 * Run with: npx tsx --test tests/intelligence/counterfactual-replay.test.mts
 *
 * Pure-service tests against a localStorage stub. Each test group
 * resets the singleton and clears storage for isolation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem:    (k: string) => __storage.get(k) ?? null,
  setItem:    (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear:      () => { __storage.clear(); },
  get length() { return __storage.size; },
  key:        (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  CounterfactualReplayEngine,
  __resetCounterfactualReplaySingleton,
  __internals,
  type DomainOverride,
  type CounterfactualScenario,
} from '../../src/services/intelligence/counterfactual-replay.ts';

function reset(): void {
  __resetCounterfactualReplaySingleton();
  __storage.clear();
}

const OVERRIDES: DomainOverride[] = [
  { domain: 'weather', severityDelta: 0.5, eventCountDelta: 2 },
  { domain: 'cyber',   severityDelta: 0.3, eventCountDelta: 1 },
];

// ── getInstance ───────────────────────────────────────────────────────

test('getInstance returns same instance on repeated calls', () => {
  reset();
  const a = CounterfactualReplayEngine.getInstance();
  const b = CounterfactualReplayEngine.getInstance();
  assert.equal(a, b);
});

test('getInstance returns new instance after reset', () => {
  reset();
  const a = CounterfactualReplayEngine.getInstance();
  reset();
  const b = CounterfactualReplayEngine.getInstance();
  assert.notEqual(a, b);
});

// ── createScenario ────────────────────────────────────────────────────

test('createScenario returns scenario with correct name', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('No-cyber world', 'snap-001', OVERRIDES);
  assert.equal(s.name, 'No-cyber world');
});

test('createScenario returns scenario with correct baseSnapshotId', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-abc', OVERRIDES);
  assert.equal(s.baseSnapshotId, 'snap-abc');
});

test('createScenario returns scenario with overrides', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  assert.equal(s.overrides.length, 2);
  assert.equal(s.overrides[0]?.domain, 'weather');
});

test('createScenario assigns a unique string id', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const a = eng.createScenario('a', 'snap-1', []);
  const b = eng.createScenario('b', 'snap-1', []);
  assert.ok(typeof a.id === 'string' && a.id.length > 0);
  assert.notEqual(a.id, b.id);
});

test('createScenario sets createdAt to a positive number', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', []);
  assert.ok(s.createdAt > 0);
});

test('createScenario result field is undefined initially', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  assert.equal(s.result, undefined);
});

test('createScenario with empty overrides is valid', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('empty', 'snap-1', []);
  assert.equal(s.overrides.length, 0);
});

// ── runScenario ───────────────────────────────────────────────────────

test('runScenario returns undefined for unknown id', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  assert.equal(eng.runScenario('no-such-id'), undefined);
});

test('runScenario returns a ReplayResult', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.ok(r);
});

test('runScenario result.scenarioId matches the scenario', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.equal(r?.scenarioId, s.id);
});

test('runScenario result.computedAt is positive', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.ok((r?.computedAt ?? 0) > 0);
});

test('runScenario result.affectedDomains lists override domains', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.deepEqual(r?.affectedDomains, ['weather', 'cyber']);
});

test('runScenario result.narrativeSummary is a non-empty string', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.ok(typeof r?.narrativeSummary === 'string' && r.narrativeSummary.length > 0);
});

test('runScenario stores result on the scenario', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  eng.runScenario(s.id);
  const updated = eng.getScenario(s.id);
  assert.ok(updated?.result);
});

// ── cascade score ─────────────────────────────────────────────────────

test('cascadeScore for empty overrides is 0', () => {
  assert.equal(__internals.computeCascadeScore([]), 0);
});

test('cascadeScore equals abs(delta) for single override', () => {
  const score = __internals.computeCascadeScore([
    { domain: 'weather', severityDelta: 0.6, eventCountDelta: 1 },
  ]);
  assert.equal(score, 0.6);
});

test('cascadeScore averages absolute deltas across overrides', () => {
  const score = __internals.computeCascadeScore([
    { domain: 'a', severityDelta: 0.4, eventCountDelta: 0 },
    { domain: 'b', severityDelta: 0.8, eventCountDelta: 0 },
  ]);
  assert.ok(Math.abs(score - 0.6) < 1e-9);
});

test('cascadeScore uses absolute value of negative delta', () => {
  const score = __internals.computeCascadeScore([
    { domain: 'a', severityDelta: -0.5, eventCountDelta: 0 },
  ]);
  assert.equal(score, 0.5);
});

test('cascadeScore is clamped to 1 when mean delta exceeds 1', () => {
  const score = __internals.computeCascadeScore([
    { domain: 'a', severityDelta: 5, eventCountDelta: 0 },
  ]);
  assert.equal(score, 1);
});

test('cascadeScore is between 0 and 1 inclusive', () => {
  const overrides: DomainOverride[] = [
    { domain: 'x', severityDelta: 0.2, eventCountDelta: 3 },
    { domain: 'y', severityDelta: 0.9, eventCountDelta: 0 },
  ];
  const score = __internals.computeCascadeScore(overrides);
  assert.ok(score >= 0 && score <= 1);
});

// ── cascade tier labels ───────────────────────────────────────────────

test('cascadeTier above 0.7 is critical cascade', () => {
  assert.equal(__internals.cascadeTier(0.8), 'critical cascade');
  assert.equal(__internals.cascadeTier(1), 'critical cascade');
});

test('cascadeTier above 0.4 is moderate cascade', () => {
  assert.equal(__internals.cascadeTier(0.5), 'moderate cascade');
  assert.equal(__internals.cascadeTier(0.7), 'moderate cascade');
});

test('cascadeTier above 0.1 is minor cascade', () => {
  assert.equal(__internals.cascadeTier(0.2), 'minor cascade');
  assert.equal(__internals.cascadeTier(0.4), 'minor cascade');
});

test('cascadeTier at or below 0.1 is minimal impact', () => {
  assert.equal(__internals.cascadeTier(0), 'minimal impact');
  assert.equal(__internals.cascadeTier(0.1), 'minimal impact');
});

// ── getScenario ───────────────────────────────────────────────────────

test('getScenario returns undefined for unknown id', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  assert.equal(eng.getScenario('unknown'), undefined);
});

test('getScenario returns scenario after createScenario', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const found = eng.getScenario(s.id);
  assert.ok(found);
  assert.equal(found.id, s.id);
});

test('getScenario returns scenario with correct overrides', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const found = eng.getScenario(s.id);
  assert.equal(found?.overrides[0]?.domain, 'weather');
  assert.equal(found?.overrides[1]?.severityDelta, 0.3);
});

// ── listScenarios ─────────────────────────────────────────────────────

test('listScenarios returns empty array initially', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  assert.deepEqual(eng.listScenarios(), []);
});

test('listScenarios returns all created scenarios', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  eng.createScenario('a', 'snap-1', []);
  eng.createScenario('b', 'snap-2', []);
  assert.equal(eng.listScenarios().length, 2);
});

test('listScenarios preserves creation order', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  eng.createScenario('first', 'snap-1', []);
  eng.createScenario('second', 'snap-2', []);
  const list = eng.listScenarios();
  assert.equal(list[0]?.name, 'first');
  assert.equal(list[1]?.name, 'second');
});

// ── max scenarios cap ─────────────────────────────────────────────────

test('listScenarios never exceeds MAX_SCENARIOS', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  for (let i = 0; i < __internals.MAX_SCENARIOS + 5; i++) {
    eng.createScenario(`s${i}`, 'snap', []);
  }
  assert.ok(eng.listScenarios().length <= __internals.MAX_SCENARIOS);
});

test('oldest scenario is evicted when cap is reached', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  for (let i = 0; i < __internals.MAX_SCENARIOS; i++) {
    eng.createScenario(`s${i}`, 'snap', []);
  }
  const firstId = eng.listScenarios()[0]!.id;
  eng.createScenario('overflow', 'snap', []);
  const list = eng.listScenarios();
  assert.ok(!list.some((s: CounterfactualScenario) => s.id === firstId));
});

// ── persistence ───────────────────────────────────────────────────────

test('scenario survives singleton reset (loaded from localStorage)', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('persist-me', 'snap-42', OVERRIDES);
  // Only reset singleton — keep localStorage so the next instance can reload
  __resetCounterfactualReplaySingleton();
  const eng2 = CounterfactualReplayEngine.getInstance();
  const found = eng2.getScenario(s.id);
  assert.ok(found);
  assert.equal(found.name, 'persist-me');
});

test('runScenario result survives singleton reset', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('persist-result', 'snap-1', OVERRIDES);
  eng.runScenario(s.id);
  // Only reset singleton — keep localStorage so the next instance can reload
  __resetCounterfactualReplaySingleton();
  const eng2 = CounterfactualReplayEngine.getInstance();
  const found = eng2.getScenario(s.id);
  assert.ok(found?.result);
  assert.equal(found.result?.scenarioId, s.id);
});

test('storage key matches expected constant', () => {
  assert.equal(__internals.STORAGE_KEY, 'wm-counterfactual-replay');
});

// ── narrative ─────────────────────────────────────────────────────────

test('narrativeSummary includes the scenario name', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('My Scenario', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.ok(r?.narrativeSummary.includes('My Scenario'));
});

test('narrativeSummary includes affected domain names', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('test', 'snap-1', OVERRIDES);
  const r = eng.runScenario(s.id);
  assert.ok(r?.narrativeSummary.includes('weather'));
  assert.ok(r?.narrativeSummary.includes('cyber'));
});

test('narrativeSummary for empty overrides mentions none', () => {
  reset();
  const eng = CounterfactualReplayEngine.getInstance();
  const s = eng.createScenario('empty', 'snap-1', []);
  const r = eng.runScenario(s.id);
  assert.ok(r?.narrativeSummary.includes('none'));
});
