/**
 * Tests for CounterfactualReasoningService — Phase 4 falsification surface.
 *
 * Run with: npx tsx --test tests/intelligence/counterfactual-reasoning.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CounterfactualReasoningService,
  STORAGE_KEY,
  __internals as serviceInternals,
  __resetCounterfactualReasoningSingleton,
  getCounterfactualReasoningService,
  type CounterfactualStorage,
} from '../../src/services/intelligence/counterfactual-reasoning.ts';

const NOW = 1_745_000_000_000;

function makeStorage(): { storage: CounterfactualStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: CounterfactualStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return { storage, map };
}

function freshService(now = NOW): CounterfactualReasoningService {
  const { storage } = makeStorage();
  return new CounterfactualReasoningService({ clock: () => now, storage });
}

// ── generate() ────────────────────────────────────────────────────────

test('generate creates exactly 3 counterfactuals (one per built-in type)', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7 ground motion drives tsunami warning');
  assert.equal(set.counterfactuals.length, 3);
  const types = new Set(set.counterfactuals.map((c) => c.type));
  assert.ok(types.has('data-quality'));
  assert.ok(types.has('missing-signal'));
  assert.ok(types.has('model-bias'));
});

test('generate stamps situationId / assessmentId / domain on each counterfactual', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'cyber', 'CVE-X is being mass-exploited');
  for (const c of set.counterfactuals) {
    assert.equal(c.situationId, 'sit-1');
    assert.equal(c.assessmentId, 'a-1');
    assert.equal(c.domain, 'cyber');
  }
});

test('generate sets initial plausibility per type', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'weather', 'severe-storm warning');
  const byType = new Map(set.counterfactuals.map((c) => [c.type, c.plausibility]));
  assert.equal(byType.get('data-quality'), 0.3);
  assert.equal(byType.get('missing-signal'), 0.4);
  assert.equal(byType.get('model-bias'), 0.2);
});

test('generate starts every counterfactual in status=open', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'maritime', 'chokepoint disruption');
  assert.ok(set.counterfactuals.every((c) => c.status === 'open'));
});

test('generate emits the domain-specific model-bias template when known', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7 quake near coast');
  const modelBias = set.counterfactuals.find((c) => c.type === 'model-bias')!;
  assert.match(modelBias.falsificationCondition, /magnitude/);
});

test('generate falls back to generic model-bias template on unknown domain', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'novel-domain', 'something happened');
  const modelBias = set.counterfactuals.find((c) => c.type === 'model-bias')!;
  assert.match(modelBias.falsificationCondition, /dominant input feature/);
});

test('generate is idempotent by assessmentId — second call returns existing set unchanged', () => {
  const svc = freshService();
  const first = svc.generate('sit-1', 'a-1', 'cyber', 'CVE exploit chain');
  const second = svc.generate('sit-1', 'a-1', 'cyber', 'CVE exploit chain');
  assert.equal(first.counterfactuals.length, 3);
  assert.equal(second.counterfactuals.length, 3);
  assert.deepEqual(second.counterfactuals.map((c) => c.id), first.counterfactuals.map((c) => c.id));
  assert.equal(svc.getAll().length, 3); // still only 3 records
});

test('generate carries the claim into the rationale text', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'cyber', 'CVE-2026-XYZ ransomware spike');
  for (const c of set.counterfactuals) {
    assert.match(c.rationale, /CVE-2026-XYZ ransomware spike/);
  }
});

// ── investigate ───────────────────────────────────────────────────────

test('investigate transitions an open counterfactual to investigated', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.investigate(target.id);
  assert.equal(svc.getAll().find((c) => c.id === target.id)?.status, 'investigated');
});

test('investigate is a no-op on a non-open counterfactual', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.investigate(target.id);
  svc.investigate(target.id); // already investigated → no-op
  assert.equal(svc.getAll().find((c) => c.id === target.id)?.status, 'investigated');
});

test('investigate is a no-op on a refuted counterfactual', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.refute(target.id, 'evidence cleared');
  svc.investigate(target.id);
  assert.equal(svc.getAll().find((c) => c.id === target.id)?.status, 'refuted');
});

test('investigate is a no-op on unknown id', () => {
  const svc = freshService();
  svc.investigate('does-not-exist');
  assert.deepEqual(svc.getAll(), []);
});

// ── refute ───────────────────────────────────────────────────────────

test('refute sets status=refuted + resolvedAt + resolutionNote on open', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new CounterfactualReasoningService({ clock: () => tick, storage });
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  tick = NOW + 5_000;
  svc.refute(target.id, 'feed verified healthy across the window');
  const after = svc.getAll().find((c) => c.id === target.id)!;
  assert.equal(after.status, 'refuted');
  assert.equal(after.resolvedAt, NOW + 5_000);
  assert.equal(after.resolutionNote, 'feed verified healthy across the window');
});

test('refute transitions investigated → refuted (any non-terminal allowed)', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.investigate(target.id);
  svc.refute(target.id, 'cleared');
  assert.equal(svc.getAll().find((c) => c.id === target.id)?.status, 'refuted');
});

test('refute is a no-op on a confirmed-valid counterfactual', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.confirm(target.id, 'real concern');
  svc.refute(target.id, 'second-thought');
  const after = svc.getAll().find((c) => c.id === target.id)!;
  assert.equal(after.status, 'confirmed-valid');
  assert.equal(after.resolutionNote, 'real concern');
});

test('refute is a no-op on unknown id', () => {
  const svc = freshService();
  svc.refute('nope', 'whatever');
  assert.deepEqual(svc.getAll(), []);
});

// ── confirm ───────────────────────────────────────────────────────────

test('confirm sets status=confirmed-valid + resolvedAt + resolutionNote', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new CounterfactualReasoningService({ clock: () => tick, storage });
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  tick = NOW + 7_000;
  svc.confirm(target.id, 'sensor reported corrupted timestamps');
  const after = svc.getAll().find((c) => c.id === target.id)!;
  assert.equal(after.status, 'confirmed-valid');
  assert.equal(after.resolvedAt, NOW + 7_000);
  assert.equal(after.resolutionNote, 'sensor reported corrupted timestamps');
});

test('confirm is a no-op on a refuted counterfactual', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.refute(target.id, 'cleared');
  svc.confirm(target.id, 'reversal');
  const after = svc.getAll().find((c) => c.id === target.id)!;
  assert.equal(after.status, 'refuted');
  assert.equal(after.resolutionNote, 'cleared');
});

// ── updatePlausibility ────────────────────────────────────────────────

test('updatePlausibility adjusts the value by delta', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals.find((c) => c.type === 'data-quality')!;
  svc.updatePlausibility(target.id, 0.4);
  // 0.3 + 0.4 = 0.7
  assert.ok(Math.abs(svc.getAll().find((c) => c.id === target.id)!.plausibility - 0.7) < 1e-9);
});

test('updatePlausibility clamps to [0, 1] at the upper bound', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.updatePlausibility(target.id, 5);
  assert.equal(svc.getAll().find((c) => c.id === target.id)?.plausibility, 1);
});

test('updatePlausibility clamps to [0, 1] at the lower bound', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const target = set.counterfactuals[0]!;
  svc.updatePlausibility(target.id, -5);
  assert.equal(svc.getAll().find((c) => c.id === target.id)?.plausibility, 0);
});

test('updatePlausibility on unknown id is a no-op', () => {
  const svc = freshService();
  svc.updatePlausibility('nope', 0.5);
  assert.deepEqual(svc.getAll(), []);
});

// ── getSet ────────────────────────────────────────────────────────────

test('getSet returns the set for one assessment with derived counts', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const set = svc.getSet('a-1');
  assert.ok(set);
  assert.equal(set.counterfactuals.length, 3);
  // open: all 3 fresh. high-plausibility (>= 0.5): zero, since defaults
  // are 0.2 / 0.3 / 0.4.
  assert.equal(set.openCount, 3);
  assert.equal(set.highPlausibilityCount, 0);
});

test('getSet returns null for unknown assessmentId', () => {
  const svc = freshService();
  assert.equal(svc.getSet('nope'), null);
});

test('getSet only returns counterfactuals matching the assessmentId', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.generate('sit-2', 'a-2', 'weather', 'storm');
  const set = svc.getSet('a-1');
  assert.ok(set);
  assert.ok(set.counterfactuals.every((c) => c.assessmentId === 'a-1'));
});

test('getSet derived openCount drops as counterfactuals are resolved', () => {
  const svc = freshService();
  const generated = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.refute(generated.counterfactuals[0]!.id, 'cleared');
  const set = svc.getSet('a-1')!;
  assert.equal(set.openCount, 2);
});

test('getSet highPlausibilityCount picks up plausibility bumps', () => {
  const svc = freshService();
  const generated = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  // model-bias (0.2) + 0.4 = 0.6 → counts; data-quality (0.3) + 0.3 = 0.6 → counts.
  svc.updatePlausibility(generated.counterfactuals.find((c) => c.type === 'model-bias')!.id, 0.4);
  svc.updatePlausibility(generated.counterfactuals.find((c) => c.type === 'data-quality')!.id, 0.3);
  const set = svc.getSet('a-1')!;
  assert.equal(set.highPlausibilityCount, 2);
});

// ── getAll ────────────────────────────────────────────────────────────

test('getAll returns counterfactuals in LIFO order', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.generate('sit-2', 'a-2', 'weather', 'storm');
  // 6 total; first 3 are for a-1, last 3 are for a-2. LIFO → a-2 first.
  const all = svc.getAll();
  assert.equal(all.length, 6);
  assert.equal(all[0]!.assessmentId, 'a-2');
  assert.equal(all[5]!.assessmentId, 'a-1');
});

test('getAll filter by status narrows the set', () => {
  const svc = freshService();
  const generated = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.refute(generated.counterfactuals[0]!.id, 'cleared');
  const open = svc.getAll({ status: 'open' });
  const refuted = svc.getAll({ status: 'refuted' });
  assert.equal(open.length, 2);
  assert.equal(refuted.length, 1);
});

test('getAll filter by domain narrows the set', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.generate('sit-2', 'a-2', 'weather', 'storm');
  const earthquakes = svc.getAll({ domain: 'earthquake' });
  assert.equal(earthquakes.length, 3);
});

test('getAll limit caps the result count', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.generate('sit-2', 'a-2', 'weather', 'storm');
  assert.equal(svc.getAll(undefined, 2).length, 2);
});

// ── getSummary ────────────────────────────────────────────────────────

test('getSummary on empty store reports zeros + refutedRate 0', () => {
  const svc = freshService();
  const s = svc.getSummary();
  assert.equal(s.total, 0);
  assert.equal(s.open, 0);
  assert.equal(s.highPlausibility, 0);
  assert.equal(s.refutedRate, 0);
});

test('getSummary refutedRate = refuted / max(total, 1)', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.refute(set.counterfactuals[0]!.id, 'a');
  // 1 refuted / 3 total ≈ 0.333
  const s = svc.getSummary();
  assert.ok(Math.abs(s.refutedRate - 1 / 3) < 1e-9);
});

test('getSummary highPlausibility counts the >= 0.5 entries', () => {
  const svc = freshService();
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.updatePlausibility(set.counterfactuals[0]!.id, 0.5); // becomes 0.5+
  assert.ok(svc.getSummary().highPlausibility >= 1);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe fires on generate / investigate / refute / confirm / updatePlausibility', () => {
  const svc = freshService();
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  const set = svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  svc.investigate(set.counterfactuals[0]!.id);
  svc.refute(set.counterfactuals[1]!.id, 'cleared');
  svc.confirm(set.counterfactuals[2]!.id, 'real');
  svc.updatePlausibility(set.counterfactuals[0]!.id, 0.1);
  assert.equal(calls, 5);
});

test('subscribe unsubscribe stops further fires', () => {
  const svc = freshService();
  let calls = 0;
  const unsub = svc.subscribe(() => { calls += 1; });
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  unsub();
  svc.generate('sit-2', 'a-2', 'weather', 'storm');
  assert.equal(calls, 1);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  assert.equal(secondCalled, true);
});

// ── Ring buffer ───────────────────────────────────────────────────────

test('ring buffer evicts oldest at MAX_COUNTERFACTUALS + N (3 per call)', () => {
  const svc = freshService();
  const max = serviceInternals.MAX_COUNTERFACTUALS;
  // 3 per call; floor((max + 6) / 3) = enough to exceed by 6.
  const calls = Math.ceil((max + 6) / 3);
  for (let i = 0; i < calls; i++) {
    svc.generate(`sit-${i}`, `a-${i}`, 'earthquake', `claim-${i}`);
  }
  assert.equal(svc.getAll().length, max);
});

// ── Persistence ───────────────────────────────────────────────────────

test('counterfactuals survive across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new CounterfactualReasoningService({ clock: () => NOW, storage });
  a.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const b = new CounterfactualReasoningService({ clock: () => NOW, storage });
  const set = b.getSet('a-1');
  assert.ok(set);
  assert.equal(set.counterfactuals.length, 3);
});

test('corrupt persisted blob does not crash hydrate', () => {
  const { storage, map } = makeStorage();
  map.set(STORAGE_KEY, '{not valid');
  const svc = new CounterfactualReasoningService({ clock: () => NOW, storage });
  assert.deepEqual(svc.getAll(), []);
});

test('persistence key is wm-counterfactuals', () => {
  const { storage, map } = makeStorage();
  const svc = new CounterfactualReasoningService({ clock: () => NOW, storage });
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  assert.ok(map.has('wm-counterfactuals'));
});

// ── Singleton ────────────────────────────────────────────────────────

test('getCounterfactualReasoningService returns a stable singleton', () => {
  __resetCounterfactualReasoningSingleton();
  const a = getCounterfactualReasoningService();
  const b = getCounterfactualReasoningService();
  assert.strictEqual(a, b);
});

// ── Defensive copies ──────────────────────────────────────────────────

test('getAll returns defensive copies — mutating result does not affect store', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const a = svc.getAll();
  a[0]!.plausibility = 99;
  const b = svc.getAll();
  assert.notEqual(b[0]!.plausibility, 99);
});

test('getSet returns defensive copies', () => {
  const svc = freshService();
  svc.generate('sit-1', 'a-1', 'earthquake', 'M7');
  const a = svc.getSet('a-1')!;
  a.counterfactuals[0]!.status = 'refuted';
  const b = svc.getSet('a-1')!;
  assert.notEqual(b.counterfactuals[0]!.status, 'refuted');
});
