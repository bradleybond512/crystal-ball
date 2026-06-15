/**
 * Tests for OutcomeLedger + AttentionAllocator — Phase 3 Learn stage.
 *
 * Run with: npx tsx --test tests/intelligence/outcome-ledger.test.mts
 *
 * Pure-service tests against:
 *   - a localStorage stub (codebase convention),
 *   - an injectable clock so "now" stays stable,
 *   - an injectable ledger so AttentionAllocator tests can construct
 *     deterministic fixtures without leaking into the singleton.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// localStorage stub before any imports that may hydrate from it.
const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  OutcomeLedger,
  __resetOutcomeLedgerSingleton,
  getOutcomeLedger,
  __internals as ledgerInternals,
  MIN_CALIBRATION_SAMPLES,
  type OutcomeAction,
  type OutcomeRecord,
} from '../../src/services/intelligence/outcome-ledger.ts';
import {
  AttentionAllocator,
  __resetAttentionAllocatorSingleton,
  getAttentionAllocator,
} from '../../src/services/intelligence/attention-allocator.ts';

const NOW = 1_745_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function freshLedger(now = NOW): OutcomeLedger {
  __storage.clear();
  __resetOutcomeLedgerSingleton();
  __resetAttentionAllocatorSingleton();
  return new OutcomeLedger({ clock: () => now });
}

function record(
  ledger: OutcomeLedger,
  domain: string,
  action: OutcomeAction,
  overrides: Partial<Omit<OutcomeRecord, 'id'>> = {},
): OutcomeRecord {
  return ledger.record({
    domain,
    predictedSeverity: 'medium',
    actualOutcome: action,
    recordedAt: new Date(NOW),
    ...overrides,
  });
}

function recordMany(
  ledger: OutcomeLedger,
  domain: string,
  pattern: Record<OutcomeAction, number>,
): void {
  for (const [action, count] of Object.entries(pattern) as [OutcomeAction, number][]) {
    for (let i = 0; i < count; i++) {
      record(ledger, domain, action);
    }
  }
}

// ── record() basics ───────────────────────────────────────────────────

test('record() assigns id and stamps recordedAt', () => {
  const ledger = freshLedger();
  const out = record(ledger, 'weather', 'acted-on');
  assert.match(out.id, /^oc-/);
  assert.ok(out.recordedAt instanceof Date);
});

test('record() stores into the ledger and shows up in list()', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'dismissed');
  record(ledger, 'cyber', 'acted-on');
  assert.equal(ledger.list().length, 2);
});

test('record() preserves driverScores snapshot and notes', () => {
  const ledger = freshLedger();
  const r = record(ledger, 'weather', 'acted-on', {
    driverScores: { wind: 0.8, hail: 0.4 },
    notes: 'tornado warning',
  });
  assert.deepEqual(r.driverScores, { wind: 0.8, hail: 0.4 });
  assert.equal(r.notes, 'tornado warning');
});

test('record() returns a defensive copy; mutating it does not change the ledger', () => {
  const ledger = freshLedger();
  const r = record(ledger, 'weather', 'acted-on', { driverScores: { wind: 0.5 } });
  r.driverScores!.wind = 999;
  const stored = ledger.list()[0];
  assert.equal(stored.driverScores!.wind, 0.5);
});

test('record() falls back to the ledger clock when recordedAt is omitted', () => {
  const fixedNow = NOW + 12_345;
  const ledger = new OutcomeLedger({ clock: () => fixedNow });
  __storage.clear();
  const r = ledger.record({
    domain: 'weather',
    predictedSeverity: 'medium',
    actualOutcome: 'acted-on',
  } as Omit<OutcomeRecord, 'id'>);
  assert.equal(r.recordedAt.getTime(), fixedNow);
});

// ── getByDomain + getRecent ───────────────────────────────────────────

test('getByDomain returns only matching domain records', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'acted-on');
  record(ledger, 'weather', 'dismissed');
  record(ledger, 'cyber', 'acted-on');
  const weather = ledger.getByDomain('weather');
  assert.equal(weather.length, 2);
  assert.ok(weather.every((r) => r.domain === 'weather'));
});

test('getByDomain returns empty array for unknown domain', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'acted-on');
  assert.deepEqual(ledger.getByDomain('zzz-unknown'), []);
});

test('getRecent applies the default 7-day window', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'acted-on', { recordedAt: new Date(NOW - 2 * ONE_DAY_MS) });
  record(ledger, 'weather', 'dismissed', { recordedAt: new Date(NOW - 10 * ONE_DAY_MS) });
  const recent = ledger.getRecent();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].actualOutcome, 'acted-on');
});

test('getRecent honours a custom window', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'acted-on', { recordedAt: new Date(NOW - 30 * 60 * 1000) });
  record(ledger, 'weather', 'dismissed', { recordedAt: new Date(NOW - 3 * ONE_HOUR_MS) });
  const recent = ledger.getRecent(ONE_HOUR_MS);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].actualOutcome, 'acted-on');
});

test('getRecent(0) returns the full ledger', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'acted-on', { recordedAt: new Date(NOW - 365 * ONE_DAY_MS) });
  assert.equal(ledger.getRecent(0).length, 1);
  assert.equal(ledger.getRecent(-1).length, 1);
});

// ── Calibration math ─────────────────────────────────────────────────

test('getCalibration: false-positive rate = (dismissed + marked-false-positive) / total', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'cyber', {
    dismissed: 3,
    'marked-false-positive': 2,
    'acted-on': 5,
    escalated: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
  });
  const cal = ledger.getCalibration('cyber');
  assert.equal(cal.totalOutcomes, 10);
  assert.equal(cal.falsePositiveRate, 0.5);
});

test('getCalibration: escalation rate = escalated / total', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'weather', {
    escalated: 4,
    'acted-on': 6,
    dismissed: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
    'marked-false-positive': 0,
  });
  const cal = ledger.getCalibration('weather');
  assert.equal(cal.escalationRate, 0.4);
});

test('getCalibration: confirmedRate counts only confirmed-real', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'weather', {
    'confirmed-real': 3,
    'acted-on': 2,
    dismissed: 0,
    escalated: 0,
    'de-escalated': 0,
    'marked-false-positive': 0,
  });
  const cal = ledger.getCalibration('weather');
  assert.equal(cal.confirmedRate, 0.6);
  // acted-on counts toward severityAccuracy but not toward confirmedRate.
  assert.ok(cal.severityAccuracy > cal.confirmedRate);
});

test('getCalibration: severityAccuracy = (confirmed-real + acted-on) / total', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'weather', {
    'confirmed-real': 2,
    'acted-on': 3,
    dismissed: 3,
    escalated: 0,
    'de-escalated': 0,
    'marked-false-positive': 2,
  });
  const cal = ledger.getCalibration('weather');
  assert.equal(cal.severityAccuracy, 0.5);
});

test('getCalibration on unknown domain returns zeroed snapshot', () => {
  const ledger = freshLedger();
  const cal = ledger.getCalibration('nope');
  assert.equal(cal.totalOutcomes, 0);
  assert.equal(cal.falsePositiveRate, 0);
  assert.equal(cal.suggestedWeightDelta, 0);
});

test('getCalibration: suggestedWeightDelta is zero below the sample-size floor', () => {
  const ledger = freshLedger();
  // 4 dismissals — below MIN_CALIBRATION_SAMPLES = 5. Even though every
  // outcome was a false positive, the delta should stay neutral.
  recordMany(ledger, 'noisy', {
    dismissed: 4,
    'acted-on': 0,
    escalated: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
    'marked-false-positive': 0,
  });
  const cal = ledger.getCalibration('noisy');
  assert.equal(cal.totalOutcomes, 4);
  assert.equal(cal.falsePositiveRate, 1);
  assert.equal(cal.suggestedWeightDelta, 0);
});

test('getCalibration: suggestedWeightDelta = escalationRate - falsePositiveRate', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'mixed', {
    escalated: 6,
    dismissed: 2,
    'acted-on': 2,
    'de-escalated': 0,
    'confirmed-real': 0,
    'marked-false-positive': 0,
  });
  const cal = ledger.getCalibration('mixed');
  assert.equal(cal.escalationRate, 0.6);
  assert.equal(cal.falsePositiveRate, 0.2);
  assert.equal(Number(cal.suggestedWeightDelta.toFixed(4)), 0.4);
});

test('getAllCalibrations returns one row per domain, sorted by totalOutcomes desc', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'small', { dismissed: 2, 'acted-on': 0, escalated: 0, 'de-escalated': 0, 'confirmed-real': 0, 'marked-false-positive': 0 });
  recordMany(ledger, 'big',   { dismissed: 0, 'acted-on': 5, escalated: 3, 'de-escalated': 0, 'confirmed-real': 2, 'marked-false-positive': 0 });
  const cals = ledger.getAllCalibrations();
  assert.equal(cals.length, 2);
  assert.equal(cals[0].domain, 'big');
  assert.equal(cals[1].domain, 'small');
});

// ── Weight recommendations ────────────────────────────────────────────

test('getWeightRecommendations: high false-positive domain pushes multiplier below 1', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'spam', {
    dismissed: 6,
    'marked-false-positive': 2,
    'acted-on': 2,
    escalated: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
  });
  const recs = ledger.getWeightRecommendations();
  assert.ok(recs.spam < 1);
});

test('getWeightRecommendations: high escalation domain pushes multiplier above 1', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'hot', {
    escalated: 7,
    'acted-on': 3,
    dismissed: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
    'marked-false-positive': 0,
  });
  const recs = ledger.getWeightRecommendations();
  assert.ok(recs.hot > 1);
});

test('getWeightRecommendations: balanced domain stays at 1.0', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'balanced', {
    escalated: 2,
    dismissed: 2,
    'acted-on': 4,
    'de-escalated': 0,
    'confirmed-real': 2,
    'marked-false-positive': 0,
  });
  const recs = ledger.getWeightRecommendations();
  assert.equal(recs.balanced, 1);
});

test('getWeightRecommendations: domains with <5 outcomes stay neutral', () => {
  const ledger = freshLedger();
  recordMany(ledger, 'tiny', {
    dismissed: 4,
    'acted-on': 0,
    escalated: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
    'marked-false-positive': 0,
  });
  const recs = ledger.getWeightRecommendations();
  assert.equal(recs.tiny, 1);
});

test('getWeightRecommendations: multiplier is clamped to [0, 2]', () => {
  const ledger = freshLedger();
  // 20 escalations and 0 false positives → delta = 1.0 → multiplier = 2.0 (cap).
  for (let i = 0; i < 20; i++) record(ledger, 'cap', 'escalated');
  const recs = ledger.getWeightRecommendations();
  assert.equal(recs.cap, 2);
});

// ── stats() ──────────────────────────────────────────────────────────

test('stats() reports total, byAction, byDomain, and overallFalsePositiveRate', () => {
  const ledger = freshLedger();
  record(ledger, 'weather', 'acted-on');
  record(ledger, 'weather', 'dismissed');
  record(ledger, 'cyber', 'marked-false-positive');
  record(ledger, 'cyber', 'escalated');
  const s = ledger.stats();
  assert.equal(s.total, 4);
  assert.equal(s.byAction['acted-on'], 1);
  assert.equal(s.byAction.dismissed, 1);
  assert.equal(s.byAction.escalated, 1);
  assert.equal(s.byAction['marked-false-positive'], 1);
  assert.equal(s.byDomain.weather, 2);
  assert.equal(s.byDomain.cyber, 2);
  assert.equal(s.overallFalsePositiveRate, 0.5);
});

test('stats() on empty ledger reports zeros', () => {
  const ledger = freshLedger();
  const s = ledger.stats();
  assert.equal(s.total, 0);
  assert.equal(s.overallFalsePositiveRate, 0);
});

// ── Ring buffer + persistence ─────────────────────────────────────────

test('ring buffer at MAX_RECORDS + 1 drops the oldest record', () => {
  const ledger = freshLedger();
  const max = ledgerInternals.MAX_RECORDS;
  for (let i = 0; i < max + 1; i++) {
    record(ledger, 'weather', 'acted-on', { notes: `n-${i}` });
  }
  const all = ledger.list();
  assert.equal(all.length, max);
  // The oldest ("n-0") should have been evicted; the newest is preserved.
  assert.equal(all[0].notes, 'n-1');
  assert.equal(all[all.length - 1].notes, `n-${max}`);
});

test('persisted records survive instantiating a new ledger', () => {
  const a = freshLedger();
  record(a, 'weather', 'acted-on', { notes: 'first' });
  record(a, 'weather', 'dismissed', { notes: 'second' });
  // A second OutcomeLedger sharing the same localStorage stub should
  // hydrate from the persisted blob.
  const b = new OutcomeLedger({ clock: () => NOW });
  const restored = b.list();
  assert.equal(restored.length, 2);
  assert.equal(restored[0].notes, 'first');
});

test('corrupt persisted blob does not crash the hydrate path', () => {
  freshLedger();
  __storage.set(ledgerInternals.STORAGE_KEY, '{not valid json');
  const ledger = new OutcomeLedger({ clock: () => NOW });
  assert.deepEqual(ledger.list(), []);
});

// ── Subscribe ────────────────────────────────────────────────────────

test('subscribe() fires on record() with the latest snapshot', () => {
  const ledger = freshLedger();
  let snapshots: OutcomeRecord[][] = [];
  const unsub = ledger.subscribe((s) => snapshots.push(s));
  record(ledger, 'weather', 'acted-on');
  record(ledger, 'cyber', 'dismissed');
  unsub();
  record(ledger, 'space', 'escalated');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].length, 1);
  assert.equal(snapshots[1].length, 2);
});

test('subscribe() listener exception does not break other listeners', () => {
  const ledger = freshLedger();
  ledger.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  ledger.subscribe(() => { secondCalled = true; });
  record(ledger, 'weather', 'acted-on');
  assert.equal(secondCalled, true);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getOutcomeLedger() returns a stable singleton', () => {
  __resetOutcomeLedgerSingleton();
  __storage.clear();
  const a = getOutcomeLedger();
  const b = getOutcomeLedger();
  assert.strictEqual(a, b);
});

// ── AttentionAllocator ───────────────────────────────────────────────

test('AttentionAllocator.getMultiplier returns 1.0 for unknown domain', () => {
  const ledger = freshLedger();
  const alloc = new AttentionAllocator({ ledger });
  assert.equal(alloc.getMultiplier('nobody'), 1);
});

test('AttentionAllocator.recompute picks up ledger changes', () => {
  const ledger = freshLedger();
  const alloc = new AttentionAllocator({ ledger });
  for (let i = 0; i < 8; i++) record(ledger, 'hot', 'escalated');
  for (let i = 0; i < 2; i++) record(ledger, 'hot', 'acted-on');
  alloc.recompute();
  assert.ok(alloc.getMultiplier('hot') > 1);
});

test('AttentionAllocator.recompute is a no-op once fully converged to target', () => {
  const ledger = freshLedger();
  const alloc = new AttentionAllocator({ ledger });
  for (let i = 0; i < 8; i++) record(ledger, 'hot', 'escalated');
  for (let i = 0; i < 2; i++) record(ledger, 'hot', 'acted-on');
  // Converge fully — rate-limiting caps each step at MAX_RECOMPUTE_STEP (0.1),
  // so target 1.8 needs ≥8 recomputes from neutral 1.0.
  for (let i = 0; i < 20; i++) alloc.recompute();
  let calls = 0;
  alloc.subscribe(() => { calls += 1; });
  alloc.recompute(); // already at target → no change → no notify.
  assert.equal(calls, 0);
});

test('AttentionAllocator.subscribe fires when allocation changes', () => {
  const ledger = freshLedger();
  const alloc = new AttentionAllocator({ ledger });
  let snapshots: Record<string, number>[] = [];
  alloc.subscribe((a) => snapshots.push(a));
  for (let i = 0; i < 8; i++) record(ledger, 'hot', 'escalated');
  for (let i = 0; i < 2; i++) record(ledger, 'hot', 'acted-on');
  alloc.recompute();
  assert.equal(snapshots.length, 1);
  assert.ok(snapshots[0].hot > 1);
});

test('AttentionAllocator allocation persists across instances', () => {
  const ledger = freshLedger();
  const a = new AttentionAllocator({ ledger });
  for (let i = 0; i < 8; i++) record(ledger, 'hot', 'escalated');
  for (let i = 0; i < 2; i++) record(ledger, 'hot', 'acted-on');
  a.recompute();
  const recompMult = a.getMultiplier('hot');
  // New instance with a fresh (empty) ledger — should still read the
  // persisted allocation rather than reset to neutral.
  const emptyLedger = new OutcomeLedger({ clock: () => NOW });
  // Manually wipe records but keep allocation blob intact.
  emptyLedger.resetForTesting();
  const b = new AttentionAllocator({ ledger: emptyLedger });
  assert.equal(b.getMultiplier('hot'), recompMult);
});

test('getAttentionAllocator() returns a stable singleton', () => {
  __resetAttentionAllocatorSingleton();
  const a = getAttentionAllocator();
  const b = getAttentionAllocator();
  assert.strictEqual(a, b);
  assert.ok(MIN_CALIBRATION_SAMPLES > 0); // sanity check on the exported constant
});
