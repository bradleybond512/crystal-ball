/**
 * Tests for AssumptionTrackerService (v2) — Phase 4 model-output
 * assumption ledger. Pure-service tests with an injected storage stub
 * + clock; the singleton stays out of these tests.
 *
 * Run with: npx tsx --test tests/intelligence/assumption-tracker-v2.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AssumptionTrackerService,
  STORAGE_KEY_ASSUMPTIONS,
  STORAGE_KEY_VIOLATIONS,
  __internals as serviceInternals,
  __resetAssumptionTrackerServiceSingleton,
  getAssumptionTrackerService,
  type Assumption,
  type AssumptionStorage,
} from '../../src/services/intelligence/assumption-tracker-v2.ts';

const NOW = 1_745_000_000_000;

function makeStorage(): { storage: AssumptionStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: AssumptionStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return { storage, map };
}

function freshService(now = NOW): AssumptionTrackerService {
  const { storage } = makeStorage();
  return new AssumptionTrackerService({ clock: () => now, storage });
}

function makeRegisterInput(overrides: Partial<Omit<Assumption, 'id' | 'status' | 'createdAt'>> = {}): Omit<Assumption, 'id' | 'status' | 'createdAt'> {
  return {
    label: 'sample assumption',
    rationale: 'we assume conditions remain steady',
    algorithmId: 'driver-scorer',
    outputId: 'output-1',
    domain: 'earthquake',
    confidence: 'medium',
    ...overrides,
  };
}

// ── register ──────────────────────────────────────────────────────────

test('register stamps id, status=active, and createdAt from the clock', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  assert.match(a.id, /^asm-/);
  assert.equal(a.status, 'active');
  assert.equal(a.createdAt, NOW);
});

test('register preserves all input fields', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput({ label: 'specific label', confidence: 'high', domain: 'weather' }));
  assert.equal(a.label, 'specific label');
  assert.equal(a.confidence, 'high');
  assert.equal(a.domain, 'weather');
  assert.equal(a.algorithmId, 'driver-scorer');
});

test('register returns a defensive copy', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  a.label = 'mutated';
  const stored = svc.getAssumptions()[0]!;
  assert.notEqual(stored.label, 'mutated');
});

test('register increments idCounter so consecutive ids differ', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  const b = svc.register(makeRegisterInput());
  assert.notEqual(a.id, b.id);
});

// ── confirm ───────────────────────────────────────────────────────────

test('confirm transitions an active assumption to confirmed + stamps validatedAt', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new AssumptionTrackerService({ clock: () => tick, storage });
  const a = svc.register(makeRegisterInput());
  tick = NOW + 5_000;
  svc.confirm(a.id);
  const after = svc.getAssumptions()[0]!;
  assert.equal(after.status, 'confirmed');
  assert.equal(after.validatedAt, NOW + 5_000);
});

test('confirm is a no-op on a confirmed (terminal) assumption', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  svc.confirm(a.id);
  const firstValidatedAt = svc.getAssumptions()[0]!.validatedAt;
  svc.confirm(a.id);
  assert.equal(svc.getAssumptions()[0]!.validatedAt, firstValidatedAt);
});

test('confirm is a no-op on a violated assumption (no resurrection)', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  svc.violate(a.id, 'because X', 'critical');
  svc.confirm(a.id);
  assert.equal(svc.getAssumptions()[0]!.status, 'violated');
});

test('confirm is a no-op for unknown id', () => {
  const svc = freshService();
  svc.confirm('does-not-exist');
  assert.deepEqual(svc.getAssumptions(), []);
});

// ── violate ───────────────────────────────────────────────────────────

test('violate transitions an active assumption to violated + stamps violatedAt', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new AssumptionTrackerService({ clock: () => tick, storage });
  const a = svc.register(makeRegisterInput());
  tick = NOW + 1_000;
  svc.violate(a.id, 'contradicting evidence', 'significant');
  const after = svc.getAssumptions()[0]!;
  assert.equal(after.status, 'violated');
  assert.equal(after.violatedAt, NOW + 1_000);
});

test('violate records a paired AssumptionViolation row', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  svc.violate(a.id, 'M7 hit so chokepoint cleared', 'critical');
  const violations = svc.getViolations();
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.assumptionId, a.id);
  assert.equal(violations[0]!.evidence, 'M7 hit so chokepoint cleared');
  assert.equal(violations[0]!.severity, 'critical');
});

test('violate is a no-op on a confirmed assumption', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  svc.confirm(a.id);
  svc.violate(a.id, 'whatever', 'minor');
  assert.equal(svc.getAssumptions()[0]!.status, 'confirmed');
  assert.equal(svc.getViolations().length, 0);
});

test('violate is a no-op on an already-violated assumption', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  svc.violate(a.id, 'first', 'critical');
  svc.violate(a.id, 'second', 'minor');
  // Second violate is rejected — terminal state.
  assert.equal(svc.getViolations().length, 1);
  assert.equal(svc.getViolations()[0]!.evidence, 'first');
});

test('violate on an expired assumption is a no-op', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new AssumptionTrackerService({ clock: () => tick, storage });
  const a = svc.register(makeRegisterInput({ })); // expiresAt undefined → never expires by sweep
  // Manually mutate via expire path: register a second one that will
  // expire and then try to violate it.
  const b = svc.register({ ...makeRegisterInput(), expiresAt: NOW + 1_000 });
  tick = NOW + 2_000;
  svc.expire(NOW + 1_500);
  assert.equal(svc.getAssumptions().find((x) => x.id === b.id)!.status, 'expired');
  svc.violate(b.id, 'should not fire', 'critical');
  assert.equal(svc.getViolations().length, 0);
  void a;
});

test('violate is a no-op for unknown id', () => {
  const svc = freshService();
  svc.violate('does-not-exist', 'whatever', 'minor');
  assert.deepEqual(svc.getViolations(), []);
});

// ── expire ────────────────────────────────────────────────────────────

test('expire sweeps active assumptions whose expiresAt is below the cutoff', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new AssumptionTrackerService({ clock: () => tick, storage });
  const a = svc.register({ ...makeRegisterInput(), expiresAt: NOW + 1_000 });
  const b = svc.register({ ...makeRegisterInput(), expiresAt: NOW + 10_000 });
  tick = NOW + 2_000;
  svc.expire(NOW + 5_000);
  const byId = new Map(svc.getAssumptions().map((x) => [x.id, x]));
  assert.equal(byId.get(a.id)!.status, 'expired');
  assert.equal(byId.get(b.id)!.status, 'active');
});

test('expire ignores assumptions without expiresAt', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  svc.expire(NOW + 999_999);
  assert.equal(svc.getAssumptions()[0]!.status, 'active');
  void a;
});

test('expire does not touch already-confirmed assumptions', () => {
  const svc = freshService();
  const a = svc.register({ ...makeRegisterInput(), expiresAt: NOW + 1_000 });
  svc.confirm(a.id);
  svc.expire(NOW + 5_000);
  assert.equal(svc.getAssumptions()[0]!.status, 'confirmed');
});

// ── getAssumptions ────────────────────────────────────────────────────

test('getAssumptions returns LIFO (newest first)', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput({ label: 'first' }));
  const b = svc.register(makeRegisterInput({ label: 'second' }));
  const c = svc.register(makeRegisterInput({ label: 'third' }));
  const list = svc.getAssumptions();
  assert.deepEqual(list.map((x) => x.id), [c.id, b.id, a.id]);
});

test('getAssumptions filter by algorithmId narrows the set', () => {
  const svc = freshService();
  svc.register(makeRegisterInput({ algorithmId: 'driver-scorer' }));
  svc.register(makeRegisterInput({ algorithmId: 'correlator' }));
  svc.register(makeRegisterInput({ algorithmId: 'driver-scorer' }));
  const out = svc.getAssumptions({ algorithmId: 'driver-scorer' });
  assert.equal(out.length, 2);
  assert.ok(out.every((a) => a.algorithmId === 'driver-scorer'));
});

test('getAssumptions filter by domain + status combine', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput({ domain: 'earthquake' }));
  svc.register(makeRegisterInput({ domain: 'weather' }));
  svc.violate(a.id, 'failed', 'minor');
  const out = svc.getAssumptions({ domain: 'earthquake', status: 'violated' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, a.id);
});

test('getAssumptions filter by outputId narrows the set', () => {
  const svc = freshService();
  svc.register(makeRegisterInput({ outputId: 'o-1' }));
  svc.register(makeRegisterInput({ outputId: 'o-2' }));
  const out = svc.getAssumptions({ outputId: 'o-1' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.outputId, 'o-1');
});

test('getAssumptions limit caps the result count', () => {
  const svc = freshService();
  for (let i = 0; i < 5; i++) svc.register(makeRegisterInput({ label: `n-${i}` }));
  const out = svc.getAssumptions(undefined, 2);
  assert.equal(out.length, 2);
});

test('getAssumptions empty result for unknown filter', () => {
  const svc = freshService();
  svc.register(makeRegisterInput({ domain: 'earthquake' }));
  assert.deepEqual(svc.getAssumptions({ domain: 'novel' }), []);
});

// ── getViolations ─────────────────────────────────────────────────────

test('getViolations returns LIFO', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  const b = svc.register(makeRegisterInput());
  const c = svc.register(makeRegisterInput());
  svc.violate(a.id, 'first', 'minor');
  svc.violate(b.id, 'second', 'significant');
  svc.violate(c.id, 'third', 'critical');
  const out = svc.getViolations();
  assert.deepEqual(out.map((v) => v.evidence), ['third', 'second', 'first']);
});

test('getViolations filter by assumptionId narrows the set', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  const b = svc.register(makeRegisterInput());
  svc.violate(a.id, 'first', 'critical');
  svc.violate(b.id, 'second', 'minor');
  const out = svc.getViolations(a.id);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.assumptionId, a.id);
});

test('getViolations limit caps the result count', () => {
  const svc = freshService();
  for (let i = 0; i < 5; i++) {
    const a = svc.register(makeRegisterInput());
    svc.violate(a.id, `v-${i}`, 'minor');
  }
  const out = svc.getViolations(undefined, 2);
  assert.equal(out.length, 2);
});

// ── getSummary ────────────────────────────────────────────────────────

test('getSummary on empty store reports zeros + violationRate 0', () => {
  const svc = freshService();
  const s = svc.getSummary();
  assert.equal(s.total, 0);
  assert.equal(s.violationRate, 0);
  assert.deepEqual(s.recentViolations, []);
});

test('getSummary counts by status', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  const b = svc.register(makeRegisterInput());
  svc.register(makeRegisterInput());
  svc.confirm(a.id);
  svc.violate(b.id, 'x', 'minor');
  const s = svc.getSummary();
  assert.equal(s.byStatus.confirmed, 1);
  assert.equal(s.byStatus.violated, 1);
  assert.equal(s.byStatus.active, 1);
  assert.equal(s.byStatus.expired, 0);
});

test('getSummary counts by confidence', () => {
  const svc = freshService();
  svc.register(makeRegisterInput({ confidence: 'high' }));
  svc.register(makeRegisterInput({ confidence: 'medium' }));
  svc.register(makeRegisterInput({ confidence: 'medium' }));
  svc.register(makeRegisterInput({ confidence: 'low' }));
  const s = svc.getSummary();
  assert.equal(s.byConfidence.high, 1);
  assert.equal(s.byConfidence.medium, 2);
  assert.equal(s.byConfidence.low, 1);
});

test('getSummary violationRate = violations.length / max(total, 1)', () => {
  const svc = freshService();
  const a = svc.register(makeRegisterInput());
  const b = svc.register(makeRegisterInput());
  svc.register(makeRegisterInput());
  svc.register(makeRegisterInput());
  svc.violate(a.id, 'x', 'minor');
  svc.violate(b.id, 'y', 'critical');
  const s = svc.getSummary();
  // 2 violations / 4 total = 0.5
  assert.ok(Math.abs(s.violationRate - 0.5) < 1e-9);
});

test('getSummary recentViolations are the 10 most-recent in LIFO order', () => {
  const svc = freshService();
  for (let i = 0; i < 12; i++) {
    const a = svc.register(makeRegisterInput());
    svc.violate(a.id, `v-${i}`, 'minor');
  }
  const s = svc.getSummary();
  assert.equal(s.recentViolations.length, 10);
  assert.equal(s.recentViolations[0]!.evidence, 'v-11');
});

// ── subscribe ─────────────────────────────────────────────────────────

test('subscribe fires on register / confirm / violate / expire', () => {
  let tick = NOW;
  const { storage } = makeStorage();
  const svc = new AssumptionTrackerService({ clock: () => tick, storage });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  const a = svc.register({ ...makeRegisterInput(), expiresAt: NOW + 100 });
  svc.confirm(a.id);
  const b = svc.register(makeRegisterInput());
  svc.violate(b.id, 'x', 'minor');
  const c = svc.register({ ...makeRegisterInput(), expiresAt: NOW + 100 });
  void c;
  tick = NOW + 500;
  svc.expire(NOW + 200);
  // register × 3, confirm × 1, violate × 1, expire × 1 = 6 fires.
  assert.equal(calls, 6);
});

test('subscribe unsubscribe stops further fires', () => {
  const svc = freshService();
  let calls = 0;
  const unsub = svc.subscribe(() => { calls += 1; });
  svc.register(makeRegisterInput());
  unsub();
  svc.register(makeRegisterInput());
  svc.register(makeRegisterInput());
  assert.equal(calls, 1);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  svc.register(makeRegisterInput());
  assert.equal(secondCalled, true);
});

// ── Ring buffers ──────────────────────────────────────────────────────

test('assumptions ring buffer evicts oldest at MAX_ASSUMPTIONS + 1', () => {
  const svc = freshService();
  const max = serviceInternals.MAX_ASSUMPTIONS;
  for (let i = 0; i < max + 3; i++) {
    svc.register(makeRegisterInput({ label: `n-${i}` }));
  }
  // getAssumptions() returns LIFO with no limit → caps to internal store.
  assert.equal(svc.getAssumptions().length, max);
});

test('violations ring buffer evicts oldest at MAX_VIOLATIONS + 1', () => {
  const svc = freshService();
  const max = serviceInternals.MAX_VIOLATIONS;
  for (let i = 0; i < max + 5; i++) {
    const a = svc.register(makeRegisterInput());
    svc.violate(a.id, `v-${i}`, 'minor');
  }
  assert.equal(svc.getViolations().length, max);
});

// ── Persistence ───────────────────────────────────────────────────────

test('assumptions + violations survive across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new AssumptionTrackerService({ clock: () => NOW, storage });
  const reg = a.register(makeRegisterInput({ label: 'persisted' }));
  a.violate(reg.id, 'because', 'critical');
  // Fresh instance pointing at the same storage map.
  const b = new AssumptionTrackerService({ clock: () => NOW, storage });
  assert.equal(b.getAssumptions().length, 1);
  assert.equal(b.getAssumptions()[0]!.label, 'persisted');
  assert.equal(b.getViolations().length, 1);
});

test('corrupt assumptions blob does not crash hydrate', () => {
  const { storage, map } = makeStorage();
  map.set(STORAGE_KEY_ASSUMPTIONS, '{not valid');
  const svc = new AssumptionTrackerService({ clock: () => NOW, storage });
  assert.deepEqual(svc.getAssumptions(), []);
});

test('corrupt violations blob does not crash hydrate', () => {
  const { storage, map } = makeStorage();
  map.set(STORAGE_KEY_VIOLATIONS, '{not valid');
  const svc = new AssumptionTrackerService({ clock: () => NOW, storage });
  assert.deepEqual(svc.getViolations(), []);
});

test('persistence keys are wm-assumptions + wm-assumption-violations', () => {
  const { storage, map } = makeStorage();
  const svc = new AssumptionTrackerService({ clock: () => NOW, storage });
  const a = svc.register(makeRegisterInput());
  svc.violate(a.id, 'x', 'minor');
  assert.ok(map.has('wm-assumptions'));
  assert.ok(map.has('wm-assumption-violations'));
});

// ── Singleton ────────────────────────────────────────────────────────

test('getAssumptionTrackerService returns a stable singleton', () => {
  __resetAssumptionTrackerServiceSingleton();
  const a = getAssumptionTrackerService();
  const b = getAssumptionTrackerService();
  assert.strictEqual(a, b);
});
