import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  INHIBITION_TTL_MS,
  MAX_INHIBITION_SHADOW_EVENTS,
  __resetInhibitionShadowDiagnosticsForTests,
  clearInhibitorySnapshot,
  evaluateActiveInhibitionShadow,
  evaluateInhibitionShadow,
  getInhibitionShadowDiagnostics,
  getInhibitorySnapshot,
  readInhibitionEnabled,
  replaceInhibitorySnapshot,
} from '../inhibition.ts';
import type { InhibitoryLeadLagEdge } from '../lead-lag.ts';

const T0 = Date.UTC(2026, 7, 4, 12);

function edge(overrides: Partial<InhibitoryLeadLagEdge> = {}): InhibitoryLeadLagEdge {
  return {
    effect: 'inhibitory',
    from: 'wildfire',
    to: 'infrastructure',
    windowMs: 21_600_000,
    support: 0,
    antecedents: 12,
    followRate: 0,
    expectedRate: 0.5,
    lift: 0,
    zScore: -6,
    strength: 0,
    explanation: 'wildfire suppresses infrastructure',
    ...overrides,
  };
}

beforeEach(() => {
  clearInhibitorySnapshot();
  __resetInhibitionShadowDiagnosticsForTests();
});

test('replace publishes an immutable, deterministically capped snapshot for two cadence intervals', () => {
  const edges = Array.from({ length: 15 }, (_, index) => edge({
    from: `from-${String(index).padStart(2, '0')}`,
    to: `to-${String(index).padStart(2, '0')}`,
    zScore: -(4 + index),
  }));

  const snapshot = replaceInhibitorySnapshot(edges, 4, T0);

  assert.equal(snapshot.evidence.length, 12);
  assert.equal(snapshot.publishedAt, T0);
  assert.equal(snapshot.expiresAt, T0 + INHIBITION_TTL_MS);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.evidence));
  assert.ok(snapshot.evidence.every(Object.isFrozen));
  assert.equal(snapshot.evidence[0]!.from, 'from-14');
  assert.equal(snapshot.evidence.at(-1)!.from, 'from-03');
  assert.equal(getInhibitorySnapshot(T0 + INHIBITION_TTL_MS), snapshot);
  assert.equal(getInhibitorySnapshot(T0 + INHIBITION_TTL_MS + 1), null);
});

test('malformed evidence is neutral and cannot displace valid evidence', () => {
  const snapshot = replaceInhibitorySnapshot([
    edge(),
    edge({ from: '', zScore: -100 }),
    edge({ zScore: Number.NaN }),
    edge({ expectedRate: Number.NaN, zScore: -100 }),
    edge({ effect: 'promoting' } as unknown as Partial<InhibitoryLeadLagEdge>),
  ], 4, T0);

  assert.equal(snapshot.evidence.length, 1);
  assert.equal(snapshot.evidence[0]!.from, 'wildfire');
  assert.equal(snapshot.evidence[0]!.zScore, -6);
});

test('publication rejects evidence that misses any inhibitory statistical gate', () => {
  const invalid = [
    edge({ antecedents: 4 }),
    edge({ expectedRate: 0.19 }),
    edge({ lift: 0.51 }),
    edge({ zScore: -3.99 }),
    edge({ antecedents: 1, lift: 100, zScore: -0.1 }),
  ];

  for (const candidate of invalid) {
    const snapshot = replaceInhibitorySnapshot([candidate], 4, T0);
    assert.deepEqual(snapshot.evidence, [], JSON.stringify(candidate));
  }
});

test('replacement with no admitted evidence clears the active snapshot and shadow diagnostics', () => {
  replaceInhibitorySnapshot([edge()], 4, T0);
  assert.equal(evaluateActiveInhibitionShadow([], T0, true).status, 'fresh');

  const rejected = replaceInhibitorySnapshot([edge({ antecedents: 4 })], 4, T0 + 1);

  assert.deepEqual(rejected.evidence, []);
  assert.equal(getInhibitorySnapshot(T0 + 1), null);
  assert.deepEqual(getInhibitionShadowDiagnostics(), {
    status: 'unavailable',
    evaluatedAt: null,
    snapshotPublishedAt: null,
    evidenceEvaluated: 0,
    confirmed: 0,
    refuted: 0,
    pending: 0,
  });
  assert.deepEqual(evaluateActiveInhibitionShadow([], T0 + 1, true), {
    status: 'unavailable',
    evaluatedAt: T0 + 1,
    snapshotPublishedAt: null,
    evidenceEvaluated: 0,
    confirmed: 0,
    refuted: 0,
    pending: 0,
  });
});

test('shadow evaluation rejects forged snapshots that miss statistical gates or have invalid time bounds', () => {
  const valid = replaceInhibitorySnapshot([edge()], 4, T0);
  const invalidEvidence = [
    { ...valid.evidence[0]!, antecedents: 4 },
    { ...valid.evidence[0]!, expectedRate: 0.19 },
    { ...valid.evidence[0]!, lift: 0.51 },
    { ...valid.evidence[0]!, zScore: -3.99 },
    { ...valid.evidence[0]!, criticalAbsZ: 0.01, zScore: -0.1 },
  ];

  for (const evidence of invalidEvidence) {
    assert.deepEqual(evaluateInhibitionShadow([], {
      ...valid,
      evidence: [evidence],
    }, T0), { evidenceEvaluated: 0, confirmed: 0, refuted: 0, pending: 0 });
  }
  assert.deepEqual(evaluateInhibitionShadow([], {
    ...valid,
    publishedAt: Number.NaN,
  }, T0), { evidenceEvaluated: 0, confirmed: 0, refuted: 0, pending: 0 });
  assert.deepEqual(evaluateInhibitionShadow([], {
    ...valid,
    expiresAt: Number.POSITIVE_INFINITY,
  }, T0), { evidenceEvaluated: 0, confirmed: 0, refuted: 0, pending: 0 });
});

test('non-finite publication time returns a finite neutral snapshot and installs nothing', () => {
  for (const publishedAt of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const snapshot = replaceInhibitorySnapshot([edge()], 4, publishedAt);
    assert.deepEqual(snapshot.evidence, []);
    assert.equal(Number.isFinite(snapshot.publishedAt), true);
    assert.equal(Number.isFinite(snapshot.expiresAt), true);
    assert.equal(getInhibitorySnapshot(T0), null);
  }
});

test('shadow evaluator classifies only B-after-A and returns anonymous aggregate counts', () => {
  const windowMs = 10_000;
  const snapshot = replaceInhibitorySnapshot([edge({
    from: 'a', to: 'b', windowMs,
  })], 4, T0);
  const summary = evaluateInhibitionShadow([
    { domain: 'b', at: T0 + 1_000 },
    { domain: 'a', at: T0 + 2_000 },
    { domain: 'a', at: T0 + 20_000 },
    { domain: 'b', at: T0 + 25_000 },
    { domain: 'a', at: T0 + 40_000 },
  ], snapshot, T0 + 45_000);

  assert.deepEqual(summary, {
    evidenceEvaluated: 1,
    confirmed: 1,
    refuted: 1,
    pending: 1,
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    'confirmed', 'evidenceEvaluated', 'pending', 'refuted',
  ]);
});

test('shadow evaluator is neutral for stale snapshots, malformed events, and pre-publication time', () => {
  const snapshot = replaceInhibitorySnapshot([edge({ from: 'a', to: 'b' })], 4, T0);
  const malformed = [
    { domain: '', at: T0 + 1 },
    { domain: 'a', at: Number.NaN },
    { domain: 'a', at: T0 + INHIBITION_TTL_MS + 10 },
  ];
  const empty = { evidenceEvaluated: 0, confirmed: 0, refuted: 0, pending: 0 };

  assert.deepEqual(evaluateInhibitionShadow(malformed, snapshot, T0 - 1), empty);
  assert.deepEqual(evaluateInhibitionShadow(malformed, snapshot, T0 + INHIBITION_TTL_MS + 1), empty);
  assert.deepEqual(evaluateInhibitionShadow(malformed, snapshot, Number.NaN), empty);
});

test('shadow evaluator bounds work and output counts', () => {
  const snapshot = replaceInhibitorySnapshot([edge({ from: 'a', to: 'b', windowMs: 1 })], 4, T0);
  const events = Array.from({ length: MAX_INHIBITION_SHADOW_EVENTS + 5 }, (_, index) => ({
    domain: 'a',
    at: T0 + index + 1,
  }));
  const summary = evaluateInhibitionShadow(
    events,
    snapshot,
    T0 + MAX_INHIBITION_SHADOW_EVENTS + 10,
  );

  assert.equal(summary.confirmed, MAX_INHIBITION_SHADOW_EVENTS);
  assert.ok(summary.confirmed <= MAX_INHIBITION_SHADOW_EVENTS);
});

test('shadow evaluator retains relevant trials ahead of newer unrelated noise', () => {
  const snapshot = replaceInhibitorySnapshot([edge({ from: 'a', to: 'b', windowMs: 1 })], 4, T0);
  const events = [
    { domain: 'a', at: T0 + 1 },
    ...Array.from({ length: MAX_INHIBITION_SHADOW_EVENTS + 1 }, (_, index) => ({
      domain: 'irrelevant',
      at: T0 + index + 10,
    })),
  ];

  assert.deepEqual(evaluateInhibitionShadow(
    events,
    snapshot,
    T0 + MAX_INHIBITION_SHADOW_EVENTS + 10,
  ), {
    evidenceEvaluated: 1,
    confirmed: 1,
    refuted: 0,
    pending: 0,
  });
});

test('shadow evaluator gives each referenced domain a fair deterministic event budget', () => {
  const snapshot = replaceInhibitorySnapshot([edge({ from: 'a', to: 'b', windowMs: 1 })], 4, T0);
  const events = [
    { domain: 'a', at: T0 + 1 },
    ...Array.from({ length: MAX_INHIBITION_SHADOW_EVENTS + 1 }, (_, index) => ({
      domain: 'b',
      at: T0 + index + 10,
    })),
  ];

  assert.deepEqual(evaluateInhibitionShadow(
    events,
    snapshot,
    T0 + MAX_INHIBITION_SHADOW_EVENTS + 20,
  ), {
    evidenceEvaluated: 1,
    confirmed: 1,
    refuted: 0,
    pending: 0,
  });
});

test('disabled and failed setting reads are fail-safe: explicit false disables, unavailable storage stays on', () => {
  const off = { getItem: () => 'false' } as Pick<Storage, 'getItem'>;
  const missing = { getItem: () => null } as Pick<Storage, 'getItem'>;
  const broken = { getItem: () => { throw new Error('blocked'); } } as Pick<Storage, 'getItem'>;

  assert.equal(readInhibitionEnabled(off), false);
  assert.equal(readInhibitionEnabled(missing), true);
  assert.equal(readInhibitionEnabled(broken), true);
});
