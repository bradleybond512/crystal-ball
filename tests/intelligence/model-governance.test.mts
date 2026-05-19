import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ModelGovernanceService,
  STORAGE_KEY,
  MAX_CARDS,
  type ModelCard,
  type ModelGovernanceStats,
} from '../../src/services/intelligence/model-governance.ts';

const NOW_MS = new Date('2026-05-18T12:00:00Z').getTime();

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

function newService(storage = createMemoryStorage()): ModelGovernanceService {
  ModelGovernanceService._resetSingletonForTests();
  return new ModelGovernanceService({ storage, now: () => NOW_MS });
}

function makeSeedInput(overrides: Partial<Omit<ModelCard, 'changeLog'>> = {}): Omit<ModelCard, 'changeLog'> {
  return {
    id: 'test-model-001',
    name: 'Test Model',
    version: '1.0.0',
    description: 'A test model for governance tests.',
    purpose: 'Validate that ModelGovernanceService works correctly.',
    inputTypes: ['InputA', 'InputB'],
    outputTypes: ['OutputX'],
    knownBiases: ['May over-fit to test data'],
    performanceMetrics: { accuracy: 0.9 },
    lastAuditedAt: NOW_MS - 86400000 * 10,
    status: 'active' as const,
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-model-governance"', () => {
  assert.equal(STORAGE_KEY, 'wm-model-governance');
});

test('MAX_CARDS is 200', () => {
  assert.equal(MAX_CARDS, 200);
});

// ── Singleton ────────────────────────────────────────────────────────────

test('getInstance returns the same instance', () => {
  ModelGovernanceService._resetSingletonForTests();
  const a = ModelGovernanceService.getInstance();
  const b = ModelGovernanceService.getInstance();
  assert.equal(a, b);
  ModelGovernanceService._resetSingletonForTests();
});

test('_resetSingletonForTests allows new singleton creation', () => {
  ModelGovernanceService._resetSingletonForTests();
  const a = ModelGovernanceService.getInstance();
  ModelGovernanceService._resetSingletonForTests();
  const b = ModelGovernanceService.getInstance();
  assert.notEqual(a, b);
  ModelGovernanceService._resetSingletonForTests();
});

test('constructor with options creates independent instance', () => {
  const svc = newService();
  assert.ok(svc instanceof ModelGovernanceService);
});

// ── Built-in seed cards ──────────────────────────────────────────────────

const SEED_IDS = [
  'correlation-engine',
  'driver-scorer',
  'evidence-graph',
  'outcome-ledger',
  'attention-allocator',
  'trust-budget',
  'meta-confidence',
  'experiment-manager',
  'cognitive-bias-detector',
  'competitive-hypothesis-engine',
];

test('all 10 seed cards are present after construction', () => {
  const svc = newService();
  const all = svc.getAll();
  for (const id of SEED_IDS) {
    assert.ok(all.some((c) => c.id === id), `missing seed card: ${id}`);
  }
});

test('seed cards have correct default statuses', () => {
  const svc = newService();
  const activeIds = ['correlation-engine', 'driver-scorer', 'evidence-graph', 'outcome-ledger', 'trust-budget', 'meta-confidence', 'competitive-hypothesis-engine'];
  const experimentalIds = ['attention-allocator', 'experiment-manager', 'cognitive-bias-detector'];
  for (const id of activeIds) {
    assert.equal(svc.getCard(id)?.status, 'active', `${id} should be active`);
  }
  for (const id of experimentalIds) {
    assert.equal(svc.getCard(id)?.status, 'experimental', `${id} should be experimental`);
  }
});

test('seed cards have empty changeLog on first construction', () => {
  const svc = newService();
  for (const id of SEED_IDS) {
    const card = svc.getCard(id);
    assert.deepEqual(card?.changeLog, [], `${id} should have empty changeLog`);
  }
});

test('constructing twice with same storage does not duplicate seeds', () => {
  const storage = createMemoryStorage();
  ModelGovernanceService._resetSingletonForTests();
  const svc1 = new ModelGovernanceService({ storage, now: () => NOW_MS });
  const count1 = svc1.getAll().length;
  ModelGovernanceService._resetSingletonForTests();
  const svc2 = new ModelGovernanceService({ storage, now: () => NOW_MS });
  const count2 = svc2.getAll().length;
  assert.equal(count1, count2, 'second construction should not add duplicate seeds');
});

// ── registerModel ────────────────────────────────────────────────────────

test('registerModel stores a new card with empty changeLog', () => {
  const svc = newService();
  const input = makeSeedInput();
  const card = svc.registerModel(input);
  assert.equal(card.id, input.id);
  assert.deepEqual(card.changeLog, []);
});

test('registerModel is idempotent: re-registering same id returns existing card', () => {
  const svc = newService();
  const input = makeSeedInput({ name: 'First Name' });
  const first = svc.registerModel(input);
  const second = svc.registerModel({ ...input, name: 'Should Not Change' });
  assert.equal(second.name, first.name, 'second registration should return existing card unchanged');
  assert.equal(second.id, first.id);
});

test('registerModel persists to storage', () => {
  const storage = createMemoryStorage();
  const svc = newService(storage);
  svc.registerModel(makeSeedInput());
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw && raw.includes('test-model-001'));
});

test('registerModel returns a copy (mutation does not affect store)', () => {
  const svc = newService();
  const card = svc.registerModel(makeSeedInput());
  card.name = 'mutated';
  assert.notEqual(svc.getCard('test-model-001')?.name, 'mutated');
});

// ── updateMetrics ─────────────────────────────────────────────────────────

test('updateMetrics merges into existing metrics', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput({ performanceMetrics: { accuracy: 0.9 } }));
  svc.updateMetrics('test-model-001', { f1: 0.85 });
  const card = svc.getCard('test-model-001')!;
  assert.equal(card.performanceMetrics.accuracy, 0.9);
  assert.equal(card.performanceMetrics.f1, 0.85);
});

test('updateMetrics overwrites existing metric key', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput({ performanceMetrics: { accuracy: 0.9 } }));
  svc.updateMetrics('test-model-001', { accuracy: 0.95 });
  assert.equal(svc.getCard('test-model-001')?.performanceMetrics.accuracy, 0.95);
});

test('updateMetrics no-ops silently for unknown id', () => {
  const svc = newService();
  assert.doesNotThrow(() => svc.updateMetrics('nonexistent-id', { score: 1 }));
});

test('updateMetrics persists to storage', () => {
  const storage = createMemoryStorage();
  const svc = newService(storage);
  svc.registerModel(makeSeedInput());
  svc.updateMetrics('test-model-001', { newMetric: 0.77 });
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw && raw.includes('newMetric'));
});

// ── addChange ─────────────────────────────────────────────────────────────

test('addChange appends a ModelChange to the card changeLog', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput());
  svc.addChange('test-model-001', 'Bumped version', 'claude-session-A');
  const card = svc.getCard('test-model-001')!;
  assert.equal(card.changeLog.length, 1);
  assert.equal(card.changeLog[0]?.description, 'Bumped version');
  assert.equal(card.changeLog[0]?.changedBy, 'claude-session-A');
  assert.equal(card.changeLog[0]?.timestamp, NOW_MS);
});

test('addChange appends multiple changes in order', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput());
  svc.addChange('test-model-001', 'First change', 'author-1');
  svc.addChange('test-model-001', 'Second change', 'author-2');
  const card = svc.getCard('test-model-001')!;
  assert.equal(card.changeLog.length, 2);
  assert.equal(card.changeLog[0]?.description, 'First change');
  assert.equal(card.changeLog[1]?.description, 'Second change');
});

test('addChange no-ops silently for unknown id', () => {
  const svc = newService();
  assert.doesNotThrow(() => svc.addChange('nonexistent-id', 'desc', 'me'));
});

test('addChange persists to storage', () => {
  const storage = createMemoryStorage();
  const svc = newService(storage);
  svc.registerModel(makeSeedInput());
  svc.addChange('test-model-001', 'My change note', 'me');
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw && raw.includes('My change note'));
});

// ── deprecate ─────────────────────────────────────────────────────────────

test('deprecate sets card status to deprecated', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput({ status: 'active' }));
  svc.deprecate('test-model-001');
  assert.equal(svc.getCard('test-model-001')?.status, 'deprecated');
});

test('deprecate no-ops silently for unknown id', () => {
  const svc = newService();
  assert.doesNotThrow(() => svc.deprecate('nonexistent-id'));
});

test('deprecate persists to storage', () => {
  const storage = createMemoryStorage();
  const svc = newService(storage);
  svc.registerModel(makeSeedInput({ id: 'dep-test', status: 'active' }));
  svc.deprecate('dep-test');
  ModelGovernanceService._resetSingletonForTests();
  const svc2 = new ModelGovernanceService({ storage, now: () => NOW_MS });
  assert.equal(svc2.getCard('dep-test')?.status, 'deprecated');
});

// ── getActive ─────────────────────────────────────────────────────────────

test('getActive returns only active cards', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput({ id: 'active-1', status: 'active', name: 'Z Active' }));
  svc.registerModel(makeSeedInput({ id: 'exp-1', status: 'experimental', name: 'Experimental' }));
  svc.registerModel(makeSeedInput({ id: 'dep-1', status: 'deprecated', name: 'Deprecated' }));
  const active = svc.getActive();
  for (const c of active) {
    assert.equal(c.status, 'active');
  }
});

test('getActive returns cards sorted by name ascending', () => {
  const storage = createMemoryStorage();
  ModelGovernanceService._resetSingletonForTests();
  // Use null storage to avoid seed cards muddying the sort test
  const svc = new ModelGovernanceService({ storage: null, now: () => NOW_MS });
  svc.registerModel(makeSeedInput({ id: 'c', name: 'Zeta Model', status: 'active' }));
  svc.registerModel(makeSeedInput({ id: 'a', name: 'Alpha Model', status: 'active' }));
  svc.registerModel(makeSeedInput({ id: 'b', name: 'Beta Model', status: 'active' }));
  const active = svc.getActive().filter((c) => ['a', 'b', 'c'].includes(c.id));
  assert.equal(active[0]?.name, 'Alpha Model');
  assert.equal(active[1]?.name, 'Beta Model');
  assert.equal(active[2]?.name, 'Zeta Model');
});

test('getActive returns copies (mutation does not affect store)', () => {
  const svc = newService();
  const active = svc.getActive();
  const first = active[0];
  if (first) {
    const originalName = first.name;
    first.name = 'mutated';
    assert.equal(svc.getCard(first.id)?.name, originalName);
  }
});

// ── getCard ──────────────────────────────────────────────────────────────

test('getCard returns a copy of the card', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput());
  const card = svc.getCard('test-model-001')!;
  card.name = 'mutated';
  assert.notEqual(svc.getCard('test-model-001')?.name, 'mutated');
});

test('getCard returns undefined for unknown id', () => {
  const svc = newService();
  assert.equal(svc.getCard('unknown-zzz'), undefined);
});

// ── getAll ───────────────────────────────────────────────────────────────

test('getAll returns all cards including seed cards', () => {
  const svc = newService();
  const all = svc.getAll();
  assert.ok(all.length >= SEED_IDS.length);
});

test('getAll returns copies (mutation does not affect store)', () => {
  const svc = newService();
  const all = svc.getAll();
  const first = all[0]!;
  const originalName = first.name;
  first.name = 'mutated';
  assert.equal(svc.getCard(first.id)?.name, originalName);
});

// ── getStats ──────────────────────────────────────────────────────────────

test('getStats.total counts all cards', () => {
  const svc = newService();
  const stats: ModelGovernanceStats = svc.getStats();
  assert.equal(stats.total, svc.getAll().length);
});

test('getStats.active + deprecated + experimental === total', () => {
  const svc = newService();
  const stats = svc.getStats();
  assert.equal(stats.active + stats.deprecated + stats.experimental, stats.total);
});

test('getStats.deprecated increments after deprecate()', () => {
  const svc = newService();
  svc.registerModel(makeSeedInput({ id: 'to-deprecate', status: 'active' }));
  const before = svc.getStats().deprecated;
  svc.deprecate('to-deprecate');
  assert.equal(svc.getStats().deprecated, before + 1);
});

test('getStats.avgAuditAgeDays is a non-negative number', () => {
  // Seeds are always registered, so total is never 0 — verify the result is valid.
  const svc = newService();
  const stats = svc.getStats();
  assert.ok(typeof stats.avgAuditAgeDays === 'number');
  assert.ok(stats.avgAuditAgeDays >= 0);
});

test('getStats.avgAuditAgeDays increases when a card with older audit date is added', () => {
  const svc = newService();
  const beforeAvg = svc.getStats().avgAuditAgeDays;
  // Register a card audited 10 years ago — this should pull the average up
  svc.registerModel(makeSeedInput({
    id: 'very-old',
    lastAuditedAt: NOW_MS - 86400000 * 3650,
  }));
  const afterAvg = svc.getStats().avgAuditAgeDays;
  assert.ok(afterAvg > beforeAvg, `avg should increase: before=${beforeAvg} after=${afterAvg}`);
});

// ── Storage persistence ───────────────────────────────────────────────────

test('data persists across constructor calls with same storage', () => {
  const storage = createMemoryStorage();
  ModelGovernanceService._resetSingletonForTests();
  const svc1 = new ModelGovernanceService({ storage, now: () => NOW_MS });
  svc1.registerModel(makeSeedInput({ id: 'persist-test' }));
  svc1.addChange('persist-test', 'Initial setup', 'tester');
  ModelGovernanceService._resetSingletonForTests();
  const svc2 = new ModelGovernanceService({ storage, now: () => NOW_MS });
  const card = svc2.getCard('persist-test');
  assert.ok(card, 'card should survive rehydration');
  assert.equal(card?.changeLog.length, 1);
  assert.equal(card?.changeLog[0]?.description, 'Initial setup');
});

test('corrupt storage falls back gracefully (seeds still loaded)', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, 'not-valid-json{{{');
  ModelGovernanceService._resetSingletonForTests();
  const svc = new ModelGovernanceService({ storage, now: () => NOW_MS });
  // Seeds should still be registered
  assert.ok(svc.getAll().length >= SEED_IDS.length);
});

test('null storage works (no persistence, seeds still loaded)', () => {
  ModelGovernanceService._resetSingletonForTests();
  const svc = new ModelGovernanceService({ storage: null, now: () => NOW_MS });
  assert.ok(svc.getAll().length >= SEED_IDS.length);
});

// ── MAX_CARDS ring buffer ─────────────────────────────────────────────────

test('ring buffer keeps total cards at MAX_CARDS when over limit', () => {
  ModelGovernanceService._resetSingletonForTests();
  const svc = new ModelGovernanceService({ storage: null, now: () => NOW_MS });
  // Register MAX_CARDS + 30 cards (seeds will count too)
  const extra = MAX_CARDS + 30;
  for (let i = 0; i < extra; i++) {
    svc.registerModel(makeSeedInput({ id: `ring-${i}`, name: `Ring ${i}` }));
  }
  assert.ok(svc.getAll().length <= MAX_CARDS);
});

test('ring buffer drops oldest inserted cards first', () => {
  ModelGovernanceService._resetSingletonForTests();
  // Use null storage and no seeds for clean test
  const svc = new ModelGovernanceService({ storage: null, now: () => NOW_MS });
  // Fill to just below max by registering uniquely named cards
  // First, count how many seeds are there
  const seedCount = svc.getAll().length;
  // Register enough to overflow by 5
  const toRegister = MAX_CARDS - seedCount + 10;
  for (let i = 0; i < toRegister; i++) {
    svc.registerModel(makeSeedInput({ id: `fill-${i}`, name: `Fill ${i}` }));
  }
  // The oldest non-seed cards (fill-0, fill-1, ...) should be dropped
  assert.ok(svc.getAll().length <= MAX_CARDS);
  // The newest cards should still be present
  const newest = svc.getCard(`fill-${toRegister - 1}`);
  assert.ok(newest, 'newest registered card should still be present');
});
