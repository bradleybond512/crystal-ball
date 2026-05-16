import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTrustBudgetService,
  STORAGE_KEY,
  DEFAULT_BASE_QUOTA,
  QUOTA_MIN,
  QUOTA_MAX,
  type OutcomeStats,
  type OutcomeStatsProvider,
} from '../../src/services/notifications/trust-budget.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

function stubProvider(map: Record<string, OutcomeStats>): OutcomeStatsProvider {
  return {
    getOutcomeStats(domain: string) { return map[domain] ?? null; },
  };
}

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60_000;

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-trust-budget"', () => {
  assert.equal(STORAGE_KEY, 'wm-trust-budget');
});

test('DEFAULT_BASE_QUOTA is 3', () => {
  assert.equal(DEFAULT_BASE_QUOTA, 3);
});

test('quota bounds: QUOTA_MIN=0.5, QUOTA_MAX=10', () => {
  assert.equal(QUOTA_MIN, 0.5);
  assert.equal(QUOTA_MAX, 10);
});

// ── canSend ──────────────────────────────────────────────────────────────

test('canSend returns true for a fresh domain (seeded on first access)', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  assert.equal(svc.canSend('earthquake'), true);
});

test('canSend returns true while used < currentQuota', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake'); // 1/3
  svc.consume('earthquake'); // 2/3
  assert.equal(svc.canSend('earthquake'), true);
});

test('canSend returns false when used reaches currentQuota', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  svc.consume('earthquake');
  svc.consume('earthquake');
  assert.equal(svc.canSend('earthquake'), false);
});

test('canSend auto-recharges if windowStartMs is > 60min stale', () => {
  let clock = NOW;
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => clock });
  svc.consume('earthquake');
  svc.consume('earthquake');
  svc.consume('earthquake');
  assert.equal(svc.canSend('earthquake'), false);
  clock = NOW + 61 * 60_000;
  assert.equal(svc.canSend('earthquake'), true);
  assert.equal(svc.getBudget('earthquake').used, 0);
});

// ── consume ──────────────────────────────────────────────────────────────

test('consume increments used', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  svc.consume('earthquake');
  assert.equal(svc.getBudget('earthquake').used, 2);
});

test('consume flips exhausted=true when used reaches quota', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  svc.consume('earthquake');
  assert.equal(svc.getBudget('earthquake').exhausted, false);
  svc.consume('earthquake');
  assert.equal(svc.getBudget('earthquake').exhausted, true);
});

test('consume past quota still increments used (sender enforces, store records)', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 5; i++) svc.consume('earthquake');
  assert.equal(svc.getBudget('earthquake').used, 5);
  assert.equal(svc.getBudget('earthquake').exhausted, true);
});

// ── recharge / rechargeAll ───────────────────────────────────────────────

test('recharge resets used to 0', () => {
  let clock = NOW;
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => clock });
  svc.consume('earthquake');
  svc.consume('earthquake');
  clock = NOW + 10 * 60_000;
  svc.recharge('earthquake');
  assert.equal(svc.getBudget('earthquake').used, 0);
});

test('recharge clears exhausted flag', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 3; i++) svc.consume('earthquake');
  assert.equal(svc.getBudget('earthquake').exhausted, true);
  svc.recharge('earthquake');
  assert.equal(svc.getBudget('earthquake').exhausted, false);
});

test('recharge updates windowStartMs to current clock', () => {
  let clock = NOW;
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => clock });
  svc.consume('earthquake');
  clock = NOW + 30 * 60_000;
  svc.recharge('earthquake');
  assert.equal(svc.getBudget('earthquake').windowStartMs, NOW + 30 * 60_000);
});

test('rechargeAll resets all known domains', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  svc.consume('weather');
  svc.rechargeAll();
  assert.equal(svc.getBudget('earthquake').used, 0);
  assert.equal(svc.getBudget('weather').used, 0);
});

test('rechargeAll with no domains is a no-op (no throw)', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.rechargeAll();
  assert.deepEqual(svc.getAllBudgets(), []);
});

// ── adjustQuotas ─────────────────────────────────────────────────────────

test('adjustQuotas: FP rate > 0.6 reduces quota by 0.7 factor', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 10, falsePositives: 8, actedOn: 1 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake'); // seed the domain
  svc.adjustQuotas();
  const b = svc.getBudget('earthquake');
  // base=3 → 3*0.7=2.1
  assert.ok(Math.abs(b.currentQuota - 2.1) < 0.0001, `expected ~2.1, got ${b.currentQuota}`);
  assert.match(b.adjustmentReason, /false-positive|FP/i);
});

test('adjustQuotas: acted-on rate > 0.4 increases quota by 1.3 factor', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 10, falsePositives: 1, actedOn: 6 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  svc.adjustQuotas();
  const b = svc.getBudget('earthquake');
  // 3 * 1.3 = 3.9
  assert.ok(Math.abs(b.currentQuota - 3.9) < 0.0001, `expected ~3.9, got ${b.currentQuota}`);
  assert.match(b.adjustmentReason, /acted|valuable/i);
});

test('adjustQuotas: neutral zone (FP 0.3–0.6, low acted-on) → no change', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 10, falsePositives: 4, actedOn: 2 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  const before = svc.getBudget('earthquake').currentQuota;
  svc.adjustQuotas();
  assert.equal(svc.getBudget('earthquake').currentQuota, before);
});

test('adjustQuotas: <5 outcomes leaves quota unchanged', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 4, falsePositives: 4, actedOn: 0 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  const before = svc.getBudget('earthquake').currentQuota;
  svc.adjustQuotas();
  assert.equal(svc.getBudget('earthquake').currentQuota, before);
});

test('adjustQuotas: no outcome data leaves quota unchanged', () => {
  const provider = stubProvider({});
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  const before = svc.getBudget('earthquake').currentQuota;
  svc.adjustQuotas();
  assert.equal(svc.getBudget('earthquake').currentQuota, before);
});

test('adjustQuotas clamps to QUOTA_MIN on repeated reductions', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 100, falsePositives: 100, actedOn: 0 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  for (let i = 0; i < 20; i++) svc.adjustQuotas();
  assert.equal(svc.getBudget('earthquake').currentQuota, QUOTA_MIN);
});

test('adjustQuotas clamps to QUOTA_MAX on repeated increases', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 100, falsePositives: 0, actedOn: 100 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  for (let i = 0; i < 20; i++) svc.adjustQuotas();
  assert.equal(svc.getBudget('earthquake').currentQuota, QUOTA_MAX);
});

test('adjustQuotas updates lastAdjustedAt when quota changed', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 10, falsePositives: 8, actedOn: 0 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  svc.consume('earthquake');
  const before = svc.getBudget('earthquake').lastAdjustedAt.getTime();
  svc.adjustQuotas();
  const after = svc.getBudget('earthquake').lastAdjustedAt.getTime();
  assert.ok(after >= before);
});

// ── getSnapshot ──────────────────────────────────────────────────────────

test('getSnapshot.exhaustedDomains lists only exhausted domains', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake'); svc.consume('earthquake'); svc.consume('earthquake');
  svc.consume('weather');
  const snap = svc.getSnapshot();
  assert.deepEqual(snap.exhaustedDomains, ['earthquake']);
});

test('getSnapshot.globalUsed sums used across all known domains', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake'); svc.consume('earthquake');
  svc.consume('weather');
  assert.equal(svc.getSnapshot().globalUsed, 3);
});

test('getSnapshot.globalQuota sums currentQuota across known domains', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  svc.consume('weather');
  assert.equal(svc.getSnapshot().globalQuota, DEFAULT_BASE_QUOTA * 2);
});

test('getSnapshot.takenAt is a Date', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  assert.ok(svc.getSnapshot().takenAt instanceof Date);
});

// ── persistence ──────────────────────────────────────────────────────────

test('persist round-trip preserves currentQuota, used, windowStartMs', () => {
  const storage = createMemoryStorage();
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 10, falsePositives: 8, actedOn: 0 },
  });
  const svc1 = createTrustBudgetService({ storage, now: () => NOW, outcomeProvider: provider });
  svc1.consume('earthquake');
  svc1.consume('earthquake');
  svc1.adjustQuotas();
  const expected = svc1.getBudget('earthquake');
  const svc2 = createTrustBudgetService({ storage, now: () => NOW + 1, outcomeProvider: provider });
  const actual = svc2.getBudget('earthquake');
  assert.equal(actual.currentQuota, expected.currentQuota);
  assert.equal(actual.used, expected.used);
  assert.equal(actual.windowStartMs, expected.windowStartMs);
});

test('corrupt storage blob falls back to fresh defaults', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, 'not-json-{');
  const svc = createTrustBudgetService({ storage, now: () => NOW });
  // No prior domains — getAllBudgets is empty until something is touched
  assert.deepEqual(svc.getAllBudgets(), []);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe fires on consume, recharge, adjustQuotas', () => {
  const provider = stubProvider({
    earthquake: { domain: 'earthquake', total: 10, falsePositives: 8, actedOn: 0 },
  });
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW, outcomeProvider: provider });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.consume('earthquake');
  svc.recharge('earthquake');
  svc.adjustQuotas();
  assert.equal(calls, 3);
});

test('subscribe returns unsubscribe function', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.consume('earthquake');
  off();
  svc.consume('earthquake');
  assert.equal(calls, 1);
});

// ── getAllBudgets ────────────────────────────────────────────────────────

test('getAllBudgets returns one entry per seeded domain', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  svc.consume('weather');
  svc.consume('cyber');
  assert.equal(svc.getAllBudgets().length, 3);
});

test('getAllBudgets returns immutable snapshots — caller mutation does not bleed in', () => {
  const svc = createTrustBudgetService({ storage: createMemoryStorage(), now: () => NOW });
  svc.consume('earthquake');
  const all = svc.getAllBudgets();
  all[0]!.currentQuota = 999;
  assert.notEqual(svc.getBudget('earthquake').currentQuota, 999);
});
