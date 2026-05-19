import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QualityDebtTracker,
  SCHEMA_VERSION,
  SEEDED_DEBTS,
  STORAGE_KEY,
  STORE_LIMIT,
  isValidDebt,
  severityRank,
  sortBySeverity,
  type CreateDebtInput,
  type QualityDebt,
  type QualityDebtCategory,
} from '../../src/services/intelligence/quality-debt-tracker.ts';

class MemoryStorage {
  public map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  has(key: string): boolean { return this.map.has(key); }
}

function makeTracker(over: Partial<ConstructorParameters<typeof QualityDebtTracker>[0]> = {}) {
  return new QualityDebtTracker({
    storage: over.storage ?? new MemoryStorage(),
    clock: over.clock ?? (() => 1_700_000_000_000),
    skipSeed: over.skipSeed ?? false,
  });
}

function debtInput(over: Partial<CreateDebtInput> = {}): CreateDebtInput {
  return {
    title: over.title ?? 'Sample debt',
    description: over.description ?? 'A test debt entry',
    category: over.category ?? 'data',
    severity: over.severity ?? 'medium',
    domain: over.domain,
    estimatedImpact: over.estimatedImpact ?? 'Test impact',
    ...over,
  };
}

// ── Seed + initial state ──────────────────────────────────────────────────

test('SEEDED_DEBTS exposes 8 well-formed entries', () => {
  assert.equal(SEEDED_DEBTS.length, 8);
  for (const seed of SEEDED_DEBTS) {
    assert.ok(seed.title.length > 0);
    assert.ok(seed.description.length > 0);
    assert.ok(seed.estimatedImpact.length > 0);
    assert.ok(['data', 'model', 'coverage', 'latency', 'accuracy'].includes(seed.category));
    assert.ok(['low', 'medium', 'high', 'critical'].includes(seed.severity));
  }
});

test('SEEDED_DEBTS covers every spec category at least once', () => {
  const categories = new Set(SEEDED_DEBTS.map((d) => d.category));
  for (const c of ['data', 'model', 'coverage', 'latency', 'accuracy']) {
    assert.ok(categories.has(c as QualityDebtCategory), `missing seed for ${c}`);
  }
});

test('constructor seeds 8 debts on first run', () => {
  const t = makeTracker();
  assert.equal(t.getAll().length, 8);
  assert.equal(t.getOpen().length, 8);
});

test('constructor skipSeed: true leaves the tracker empty', () => {
  const t = makeTracker({ skipSeed: true });
  assert.equal(t.getAll().length, 0);
  assert.equal(t.getOpen().length, 0);
});

// ── Singleton ─────────────────────────────────────────────────────────────

test('getInstance returns the same singleton each call', () => {
  QualityDebtTracker.__setInstance(null);
  const a = QualityDebtTracker.getInstance();
  const b = QualityDebtTracker.getInstance();
  assert.equal(a, b);
  QualityDebtTracker.__setInstance(null);
});

test('__setInstance lets tests inject a custom tracker', () => {
  const custom = makeTracker({ skipSeed: true });
  QualityDebtTracker.__setInstance(custom);
  assert.equal(QualityDebtTracker.getInstance(), custom);
  QualityDebtTracker.__setInstance(null);
});

// ── Pure helpers ──────────────────────────────────────────────────────────

test('severityRank: critical > high > medium > low', () => {
  assert.ok(severityRank('critical') > severityRank('high'));
  assert.ok(severityRank('high') > severityRank('medium'));
  assert.ok(severityRank('medium') > severityRank('low'));
});

test('sortBySeverity: returns critical-first, breaks ties by createdAt desc', () => {
  const debts: QualityDebt[] = [
    { id: 'a', title: 'a', description: '', category: 'data', severity: 'low',
      estimatedImpact: '', createdAt: 1000, status: 'open' },
    { id: 'b', title: 'b', description: '', category: 'data', severity: 'critical',
      estimatedImpact: '', createdAt: 2000, status: 'open' },
    { id: 'c', title: 'c', description: '', category: 'data', severity: 'critical',
      estimatedImpact: '', createdAt: 3000, status: 'open' },
    { id: 'd', title: 'd', description: '', category: 'data', severity: 'high',
      estimatedImpact: '', createdAt: 4000, status: 'open' },
  ];
  const sorted = sortBySeverity(debts);
  assert.deepEqual(sorted.map((d) => d.id), ['c', 'b', 'd', 'a']);
});

test('sortBySeverity: does not mutate input', () => {
  const debts: QualityDebt[] = [
    { id: 'a', title: '', description: '', category: 'data', severity: 'low',
      estimatedImpact: '', createdAt: 1, status: 'open' },
    { id: 'b', title: '', description: '', category: 'data', severity: 'critical',
      estimatedImpact: '', createdAt: 2, status: 'open' },
  ];
  const before = debts.map((d) => d.id).join(',');
  sortBySeverity(debts);
  assert.equal(debts.map((d) => d.id).join(','), before);
});

// ── isValidDebt ───────────────────────────────────────────────────────────

test('isValidDebt accepts a well-formed debt', () => {
  const debt: QualityDebt = {
    id: 'debt-1', title: 't', description: 'd', category: 'data', severity: 'low',
    estimatedImpact: 'i', createdAt: 1, status: 'open',
  };
  assert.equal(isValidDebt(debt), true);
});

test('isValidDebt rejects null / primitive / missing fields', () => {
  assert.equal(isValidDebt(null), false);
  assert.equal(isValidDebt(42), false);
  assert.equal(isValidDebt('hello'), false);
  assert.equal(isValidDebt({ id: 'debt-1' }), false);
});

test('isValidDebt rejects invalid category / severity / status', () => {
  const base: QualityDebt = {
    id: 'debt-1', title: 't', description: 'd', category: 'data', severity: 'low',
    estimatedImpact: 'i', createdAt: 1, status: 'open',
  };
  assert.equal(isValidDebt({ ...base, category: 'security' }), false);
  assert.equal(isValidDebt({ ...base, severity: 'severe' }), false);
  assert.equal(isValidDebt({ ...base, status: 'pending' }), false);
});

// ── addDebt ───────────────────────────────────────────────────────────────

test('addDebt: appends a row with auto-generated id and createdAt', () => {
  const t = makeTracker({ skipSeed: true, clock: () => 5000 });
  const debt = t.addDebt(debtInput({ title: 'new', severity: 'high' }));
  assert.match(debt.id, /^debt-/);
  assert.equal(debt.createdAt, 5000);
  assert.equal(debt.status, 'open');
  assert.equal(debt.resolvedAt, undefined);
  assert.equal(t.getAll().length, 1);
});

test('addDebt: trims and clips long titles to 140 chars', () => {
  const t = makeTracker({ skipSeed: true });
  const long = 'X'.repeat(200);
  const debt = t.addDebt(debtInput({ title: `   ${long}   ` }));
  assert.equal(debt.title.length, 140);
  assert.equal(debt.title.startsWith('X'), true);
});

test('addDebt: throws on empty / whitespace-only title', () => {
  const t = makeTracker({ skipSeed: true });
  assert.throws(() => t.addDebt(debtInput({ title: '' })), /title is required/);
  assert.throws(() => t.addDebt(debtInput({ title: '   ' })), /title is required/);
});

test('addDebt: throws on invalid category', () => {
  const t = makeTracker({ skipSeed: true });
  assert.throws(
    () => t.addDebt(debtInput({ category: 'security' as QualityDebtCategory })),
    /invalid category/,
  );
});

test('addDebt: throws on invalid severity', () => {
  const t = makeTracker({ skipSeed: true });
  assert.throws(
    () => t.addDebt({ ...debtInput(), severity: 'nuclear' as never }),
    /invalid severity/,
  );
});

test('addDebt: status=resolved stamps resolvedAt with createdAt', () => {
  const t = makeTracker({ skipSeed: true, clock: () => 7777 });
  const debt = t.addDebt({ ...debtInput(), status: 'resolved' });
  assert.equal(debt.status, 'resolved');
  assert.equal(debt.resolvedAt, 7777);
});

test('addDebt: emits to subscribers with kind="added"', () => {
  const t = makeTracker({ skipSeed: true });
  const calls: { id: string; kind: string }[] = [];
  t.subscribe((d, kind) => calls.push({ id: d.id, kind }));
  const debt = t.addDebt(debtInput());
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.id, debt.id);
  assert.equal(calls[0]?.kind, 'added');
});

// ── updateStatus ──────────────────────────────────────────────────────────

test('updateStatus: open → in-progress preserves createdAt, no resolvedAt', () => {
  const t = makeTracker({ skipSeed: true, clock: () => 100 });
  const debt = t.addDebt(debtInput());
  const updated = t.updateStatus(debt.id, 'in-progress');
  assert.equal(updated.status, 'in-progress');
  assert.equal(updated.createdAt, 100);
  assert.equal(updated.resolvedAt, undefined);
});

test('updateStatus: open → resolved stamps resolvedAt with current clock', () => {
  let now = 100;
  const t = makeTracker({ skipSeed: true, clock: () => now });
  const debt = t.addDebt(debtInput());
  now = 500;
  const updated = t.updateStatus(debt.id, 'resolved');
  assert.equal(updated.status, 'resolved');
  assert.equal(updated.resolvedAt, 500);
});

test('updateStatus: resolved → open clears resolvedAt', () => {
  const t = makeTracker({ skipSeed: true, clock: () => 100 });
  const debt = t.addDebt({ ...debtInput(), status: 'resolved' });
  const updated = t.updateStatus(debt.id, 'open');
  assert.equal(updated.status, 'open');
  assert.equal(updated.resolvedAt, undefined);
});

test('updateStatus: throws on unknown id', () => {
  const t = makeTracker({ skipSeed: true });
  assert.throws(() => t.updateStatus('nonexistent', 'resolved'), /not found/);
});

test('updateStatus: throws on invalid status', () => {
  const t = makeTracker({ skipSeed: true });
  const debt = t.addDebt(debtInput());
  assert.throws(
    () => t.updateStatus(debt.id, 'pending' as never),
    /invalid status/,
  );
});

test('updateStatus: emits to subscribers with kind="updated"', () => {
  const t = makeTracker({ skipSeed: true });
  const debt = t.addDebt(debtInput());
  const calls: { kind: string }[] = [];
  t.subscribe((_d, kind) => calls.push({ kind }));
  t.updateStatus(debt.id, 'resolved');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.kind, 'updated');
});

// ── Queries ───────────────────────────────────────────────────────────────

test('getOpen: returns sorted critical-first, excludes resolved', () => {
  const t = makeTracker({ skipSeed: true });
  const a = t.addDebt(debtInput({ title: 'a', severity: 'low' }));
  const b = t.addDebt(debtInput({ title: 'b', severity: 'critical' }));
  t.addDebt(debtInput({ title: 'c', severity: 'high' }));
  t.updateStatus(a.id, 'resolved');
  const open = t.getOpen();
  assert.equal(open.length, 2);
  assert.equal(open[0]?.severity, 'critical');
  assert.equal(open[0]?.id, b.id);
  assert.equal(open[1]?.severity, 'high');
});

test('getByCategory: filters to matching category, ignores others', () => {
  const t = makeTracker({ skipSeed: true });
  t.addDebt(debtInput({ category: 'data' }));
  t.addDebt(debtInput({ category: 'model' }));
  t.addDebt(debtInput({ category: 'data' }));
  assert.equal(t.getByCategory('data').length, 2);
  assert.equal(t.getByCategory('model').length, 1);
  assert.equal(t.getByCategory('latency').length, 0);
});

test('findByDomain: filters to matching domain hint', () => {
  const t = makeTracker({ skipSeed: true });
  t.addDebt(debtInput({ domain: 'ais' }));
  t.addDebt(debtInput({ domain: 'cyber' }));
  t.addDebt(debtInput({ /* no domain */ }));
  assert.equal(t.findByDomain('ais').length, 1);
  assert.equal(t.findByDomain('cyber').length, 1);
  assert.equal(t.findByDomain('aviation').length, 0);
});

test('getDebt: returns a copy on hit, null on miss', () => {
  const t = makeTracker({ skipSeed: true });
  const debt = t.addDebt(debtInput({ title: 'original' }));
  const hit = t.getDebt(debt.id);
  assert.ok(hit);
  assert.equal(hit.title, 'original');
  // Mutating the copy must not bleed into the store.
  hit.title = 'tampered';
  assert.equal(t.getDebt(debt.id)?.title, 'original');
  assert.equal(t.getDebt('nope'), null);
});

test('getAll / getOpen / getByCategory return independent copies', () => {
  const t = makeTracker({ skipSeed: true });
  t.addDebt(debtInput({ title: 'preserved' }));
  const all = t.getAll();
  all[0]!.title = 'tampered';
  assert.equal(t.getAll()[0]?.title, 'preserved');
});

// ── Stats ─────────────────────────────────────────────────────────────────

test('getStats: empty tracker reports zeros and 0% resolution', () => {
  const t = makeTracker({ skipSeed: true });
  const s = t.getStats();
  assert.equal(s.totalOpen, 0);
  assert.equal(s.resolutionRatePct, 0);
  assert.equal(s.bySeverity.critical, 0);
  assert.equal(s.byCategory.data, 0);
});

test('getStats: counts open debts only, not resolved', () => {
  const t = makeTracker({ skipSeed: true });
  t.addDebt(debtInput({ severity: 'critical', category: 'data' }));
  t.addDebt(debtInput({ severity: 'high', category: 'model' }));
  const resolved = t.addDebt(debtInput({ severity: 'low', category: 'latency' }));
  t.updateStatus(resolved.id, 'resolved');
  const s = t.getStats();
  assert.equal(s.totalOpen, 2);
  assert.equal(s.bySeverity.critical, 1);
  assert.equal(s.bySeverity.high, 1);
  assert.equal(s.bySeverity.low, 0); // resolved one is excluded
  assert.equal(s.byCategory.data, 1);
  assert.equal(s.byCategory.model, 1);
  assert.equal(s.byCategory.latency, 0);
});

test('getStats: resolutionRatePct rounds to nearest integer', () => {
  const t = makeTracker({ skipSeed: true });
  for (let i = 0; i < 3; i += 1) t.addDebt(debtInput());
  const resolvedIds = [
    t.addDebt(debtInput()).id,
    t.addDebt(debtInput()).id,
  ];
  for (const id of resolvedIds) t.updateStatus(id, 'resolved');
  // 2 resolved out of 5 total = 40%
  assert.equal(t.getStats().resolutionRatePct, 40);
});

// ── Persistence ───────────────────────────────────────────────────────────

test('persistence: addDebt writes a v1 envelope to storage', () => {
  const storage = new MemoryStorage();
  const t = makeTracker({ storage, skipSeed: true });
  t.addDebt(debtInput({ title: 'persisted' }));
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { schema: number; debts: unknown[] };
  assert.equal(parsed.schema, SCHEMA_VERSION);
  assert.equal(parsed.debts.length, 1);
});

test('persistence: second tracker hydrates from existing envelope (no re-seed)', () => {
  const storage = new MemoryStorage();
  const t1 = makeTracker({ storage, skipSeed: true });
  t1.addDebt(debtInput({ title: 'survives reload' }));
  const t2 = makeTracker({ storage });
  assert.equal(t2.getAll().length, 1);
  assert.equal(t2.getAll()[0]?.title, 'survives reload');
});

test('persistence: corrupt envelope JSON triggers re-seed', () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, '{not valid json');
  const t = makeTracker({ storage });
  assert.equal(t.getAll().length, 8); // seed kicks in
});

test('persistence: wrong schema version triggers re-seed', () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 99, debts: [] }));
  const t = makeTracker({ storage });
  assert.equal(t.getAll().length, 8);
});

test('persistence: storage host that throws setItem does not crash addDebt', () => {
  const throwing = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { /* noop */ },
  };
  const t = makeTracker({ storage: throwing, skipSeed: true });
  const debt = t.addDebt(debtInput()); // must not throw
  assert.equal(t.getAll().length, 1);
  assert.equal(debt.status, 'open');
});

// ── Ring buffer eviction ──────────────────────────────────────────────────

test('ring buffer: STORE_LIMIT enforces FIFO eviction at 500', () => {
  const t = makeTracker({ skipSeed: true, storage: null });
  for (let i = 0; i < STORE_LIMIT + 10; i += 1) {
    t.addDebt(debtInput({ title: `debt-${i}` }));
  }
  const all = t.getAll();
  assert.equal(all.length, STORE_LIMIT);
  // Oldest 10 evicted; newest debt is at the end.
  assert.equal(all[0]?.title, 'debt-10');
  assert.equal(all[all.length - 1]?.title, `debt-${STORE_LIMIT + 9}`);
});

// ── Subscribe / unsubscribe ───────────────────────────────────────────────

test('subscribe: unsubscribe stops further callbacks', () => {
  const t = makeTracker({ skipSeed: true });
  const calls: string[] = [];
  const unsub = t.subscribe((d) => calls.push(d.id));
  t.addDebt(debtInput({ title: 'first' }));
  unsub();
  t.addDebt(debtInput({ title: 'second' }));
  assert.equal(calls.length, 1);
});

test('subscribe: listener errors do not break the tracker', () => {
  const t = makeTracker({ skipSeed: true });
  t.subscribe(() => { throw new Error('boom'); });
  // Must not throw despite the listener exception.
  const debt = t.addDebt(debtInput());
  assert.equal(t.getDebt(debt.id)?.title, debt.title);
});

// ── __reset ────────────────────────────────────────────────────────────────

test('__reset: clears the store and storage', () => {
  const storage = new MemoryStorage();
  const t = makeTracker({ storage, skipSeed: true });
  t.addDebt(debtInput());
  t.__reset();
  assert.equal(t.getAll().length, 0);
  assert.equal(storage.has(STORAGE_KEY), false);
});
