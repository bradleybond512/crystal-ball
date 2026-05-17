import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createModelGovernanceService,
  BUILTIN_MODEL_CARDS,
  STORAGE_KEY,
  type ModelCard,
} from '../../src/services/intelligence/model-governance.ts';

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

const REQUIRED_IDS = [
  'correlate-engine',
  'driver-scoring-engine',
  'hypothesis-engine',
  'meta-confidence-estimator',
  'bias-detector',
  'backtest-engine',
  'counterfactual-engine',
  'shadow-runner',
  'failure-prediction-engine',
  'assumption-tracker',
  'algo-eval-ledger',
  'outcome-ledger',
  'attention-allocator',
  'trust-budget',
];

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-model-governance"', () => {
  assert.equal(STORAGE_KEY, 'wm-model-governance');
});

test('BUILTIN_MODEL_CARDS contains 14 cards', () => {
  assert.equal(BUILTIN_MODEL_CARDS.length, 14);
});

test('BUILTIN_MODEL_CARDS includes all 14 required algorithm ids', () => {
  const ids = BUILTIN_MODEL_CARDS.map((c) => c.id).sort();
  assert.deepEqual(ids, [...REQUIRED_IDS].sort());
});

test('BUILTIN_MODEL_CARDS ids are unique', () => {
  const ids = new Set(BUILTIN_MODEL_CARDS.map((c) => c.id));
  assert.equal(ids.size, BUILTIN_MODEL_CARDS.length);
});

test('every built-in card has name, version, purpose, inputs, outputs, limitations, knownFailureModes, status, tags', () => {
  for (const card of BUILTIN_MODEL_CARDS) {
    assert.ok(card.name.length > 0, `${card.id}: missing name`);
    assert.ok(card.version.length > 0, `${card.id}: missing version`);
    assert.ok(card.purpose.length > 0, `${card.id}: missing purpose`);
    assert.ok(Array.isArray(card.inputs) && card.inputs.length > 0, `${card.id}: missing inputs`);
    assert.ok(Array.isArray(card.outputs) && card.outputs.length > 0, `${card.id}: missing outputs`);
    assert.ok(Array.isArray(card.limitations) && card.limitations.length > 0, `${card.id}: missing limitations`);
    assert.ok(Array.isArray(card.knownFailureModes) && card.knownFailureModes.length > 0, `${card.id}: missing knownFailureModes`);
    assert.ok(card.status === 'active' || card.status === 'experimental' || card.status === 'deprecated',
      `${card.id}: invalid status`);
    assert.ok(Array.isArray(card.tags), `${card.id}: missing tags`);
    assert.ok(typeof card.lastAuditDate === 'number', `${card.id}: missing lastAuditDate`);
  }
});

// ── getCard / getAllCards ────────────────────────────────────────────────

test('getAllCards returns all 14 built-in cards on fresh init', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  assert.equal(svc.getAllCards().length, 14);
});

test('getCard returns the right card by id', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const card = svc.getCard('correlate-engine');
  assert.ok(card);
  assert.match(card!.name, /correlate/i);
});

test('getCard returns undefined for unknown id', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  assert.equal(svc.getCard('nonexistent'), undefined);
});

test('getAllCards returns immutable snapshots (caller mutation does not bleed in)', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const all = svc.getAllCards();
  all[0]!.name = 'mutated';
  assert.notEqual(svc.getAllCards()[0]!.name, 'mutated');
});

// ── getByStatus ──────────────────────────────────────────────────────────

test('getByStatus("active") returns only active cards', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const active = svc.getByStatus('active');
  assert.ok(active.length > 0);
  for (const c of active) assert.equal(c.status, 'active');
});

test('getByStatus("experimental") returns only experimental cards', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  for (const c of svc.getByStatus('experimental')) {
    assert.equal(c.status, 'experimental');
  }
});

test('getByStatus("deprecated") returns only deprecated cards', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  for (const c of svc.getByStatus('deprecated')) {
    assert.equal(c.status, 'deprecated');
  }
});

test('getByStatus is partition: active + experimental + deprecated = total', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const sum = svc.getByStatus('active').length
    + svc.getByStatus('experimental').length
    + svc.getByStatus('deprecated').length;
  assert.equal(sum, svc.getAllCards().length);
});

// ── searchCards ──────────────────────────────────────────────────────────

test('searchCards("correlate") finds correlate-engine by name', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const hits = svc.searchCards('correlate');
  assert.ok(hits.some((c) => c.id === 'correlate-engine'));
});

test('searchCards is case-insensitive', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const lower = svc.searchCards('correlate');
  const upper = svc.searchCards('CORRELATE');
  assert.equal(lower.length, upper.length);
});

test('searchCards matches against purpose text', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const biasCard = svc.getCard('bias-detector')!;
  // Search for a word that should appear in the purpose
  const q = biasCard.purpose.split(/\s+/).find((w) => w.length > 5) ?? 'bias';
  const hits = svc.searchCards(q);
  assert.ok(hits.some((c) => c.id === 'bias-detector'));
});

test('searchCards matches against tags', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const all = svc.getAllCards();
  // Pick a card with at least one tag
  const cardWithTags = all.find((c) => c.tags.length > 0)!;
  const tag = cardWithTags.tags[0]!;
  const hits = svc.searchCards(tag);
  assert.ok(hits.some((c) => c.id === cardWithTags.id));
});

test('searchCards with empty query returns all cards', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  assert.equal(svc.searchCards('').length, 14);
});

test('searchCards with no matches returns []', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  assert.deepEqual(svc.searchCards('zzzzzzzzz-no-such-thing'), []);
});

// ── subscribe / unsubscribe ──────────────────────────────────────────────

test('subscribe fires on upsertCard', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.upsertCard({
    ...BUILTIN_MODEL_CARDS[0]!,
    purpose: 'modified',
  });
  assert.equal(calls, 1);
});

test('unsubscribe stops the callback', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.upsertCard({ ...BUILTIN_MODEL_CARDS[0]!, purpose: 'first' });
  svc.unsubscribe(cb);
  svc.upsertCard({ ...BUILTIN_MODEL_CARDS[0]!, purpose: 'second' });
  assert.equal(calls, 1);
});

// ── upsertCard ───────────────────────────────────────────────────────────

test('upsertCard overrides built-in card fields', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  svc.upsertCard({
    ...BUILTIN_MODEL_CARDS[0]!,
    status: 'deprecated',
  });
  assert.equal(svc.getCard(BUILTIN_MODEL_CARDS[0]!.id)!.status, 'deprecated');
});

test('upsertCard adds new card if id is new', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  const before = svc.getAllCards().length;
  svc.upsertCard({
    id: 'custom-engine',
    name: 'Custom Engine',
    version: '0.0.1',
    purpose: 'experimental',
    inputs: ['x'], outputs: ['y'],
    limitations: ['none yet'],
    knownFailureModes: ['none yet'],
    lastAuditDate: Date.now(),
    status: 'experimental',
    tags: ['custom'],
  });
  assert.equal(svc.getAllCards().length, before + 1);
});

// ── persistence ──────────────────────────────────────────────────────────

test('persist + rehydrate round-trip preserves overrides', () => {
  const storage = createMemoryStorage();
  const svc1 = createModelGovernanceService({ storage });
  svc1.upsertCard({
    ...BUILTIN_MODEL_CARDS[0]!,
    status: 'deprecated',
    purpose: 'will-survive-reload',
  });
  const svc2 = createModelGovernanceService({ storage });
  const card = svc2.getCard(BUILTIN_MODEL_CARDS[0]!.id)!;
  assert.equal(card.status, 'deprecated');
  assert.equal(card.purpose, 'will-survive-reload');
});

test('rehydrate does NOT lose built-in cards that were not overridden', () => {
  const storage = createMemoryStorage();
  const svc1 = createModelGovernanceService({ storage });
  svc1.upsertCard({ ...BUILTIN_MODEL_CARDS[0]!, status: 'deprecated' });
  const svc2 = createModelGovernanceService({ storage });
  // All 14 still present
  assert.equal(svc2.getAllCards().length, 14);
});

test('rehydrate from corrupt storage falls back to built-in cards', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, 'not-json-{');
  const svc = createModelGovernanceService({ storage });
  assert.equal(svc.getAllCards().length, 14);
});

test('persist writes to STORAGE_KEY', () => {
  const storage = createMemoryStorage();
  const svc = createModelGovernanceService({ storage });
  svc.upsertCard({ ...BUILTIN_MODEL_CARDS[0]!, purpose: 'persisted' });
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw);
  assert.ok(raw!.includes('persisted'));
});

// ── content quality (a smoke test for spec — failure modes are non-trivial) ─

test('every card has at least 2 limitations', () => {
  for (const c of BUILTIN_MODEL_CARDS) {
    assert.ok(c.limitations.length >= 2, `${c.id}: only ${c.limitations.length} limitations`);
  }
});

test('every card has at least 2 known failure modes', () => {
  for (const c of BUILTIN_MODEL_CARDS) {
    assert.ok(c.knownFailureModes.length >= 2,
      `${c.id}: only ${c.knownFailureModes.length} failure modes`);
  }
});

test('version follows semver-ish pattern', () => {
  for (const c of BUILTIN_MODEL_CARDS) {
    assert.match(c.version, /^\d+\.\d+\.\d+/, `${c.id} version invalid: ${c.version}`);
  }
});

// ── reset() ──────────────────────────────────────────────────────────────

test('reset() restores all overridden cards to their built-in defaults', () => {
  const svc = createModelGovernanceService({ storage: createMemoryStorage() });
  svc.upsertCard({ ...BUILTIN_MODEL_CARDS[0]!, status: 'deprecated' });
  svc.reset();
  assert.equal(svc.getCard(BUILTIN_MODEL_CARDS[0]!.id)!.status, BUILTIN_MODEL_CARDS[0]!.status);
});
