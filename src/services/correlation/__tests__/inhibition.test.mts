import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  INHIBITION_TTL_MS,
  clearInhibitorySnapshot,
  getInhibitorySnapshot,
  inhibitionAdjustmentFor,
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

beforeEach(() => clearInhibitorySnapshot());

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
  assert.equal(inhibitionAdjustmentFor(80, ['wildfire', 'infrastructure'], snapshot).score, 71);
  assert.equal(inhibitionAdjustmentFor(80, ['wildfire', 'infrastructure'], {
    ...snapshot,
    evidence: [{ ...snapshot.evidence[0]!, criticalAbsZ: 0 }],
  }).score, 80);
});

test('score dampening uses the strongest single directional inhibitor without stacking and floors at 0.85', () => {
  const snapshot = replaceInhibitorySnapshot([
    edge({ zScore: -4 }),
    edge({ from: 'infrastructure', to: 'wildfire', zScore: -40 }),
    edge({ from: 'wildfire', to: 'markets', zScore: -8 }),
  ], 4, T0);

  const adjusted = inhibitionAdjustmentFor(
    80,
    ['wildfire', 'infrastructure', 'markets'],
    snapshot,
  );

  assert.equal(adjusted.score, 68);
  assert.equal(adjusted.provenance?.factor, 0.85);
  assert.equal(adjusted.provenance?.evidenceStrength, 1);
  assert.equal(adjusted.provenance?.fromDomain, 'infrastructure');
  assert.equal(adjusted.provenance?.toDomain, 'wildfire');
  assert.equal(inhibitionAdjustmentFor(80, ['markets', 'wildfire'], snapshot).score, 68);
  assert.equal(inhibitionAdjustmentFor(80, ['infrastructure'], snapshot).score, 80);
});

test('disabled and failed setting reads are fail-safe: explicit false disables, unavailable storage stays on', () => {
  const off = { getItem: () => 'false' } as Pick<Storage, 'getItem'>;
  const missing = { getItem: () => null } as Pick<Storage, 'getItem'>;
  const broken = { getItem: () => { throw new Error('blocked'); } } as Pick<Storage, 'getItem'>;

  assert.equal(readInhibitionEnabled(off), false);
  assert.equal(readInhibitionEnabled(missing), true);
  assert.equal(readInhibitionEnabled(broken), true);
});
