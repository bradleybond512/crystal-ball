import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CorrelateEngine,
  type CorrelationRule,
} from '../../intelligence/correlate-engine';
import type { ObservationEvent } from '../../../types/intelligence';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

function obs(overrides: Partial<ObservationEvent> & { id: string }): ObservationEvent {
  return {
    sourceId: 'test-source',
    domain: 'seismic',
    timestamp: T0,
    severity: 'MEDIUM',
    title: 'test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

const anyPairRule: CorrelationRule = {
  id: 'test-rule',
  name: 'Test rule',
  description: 'matches everything in window',
  domains: [],
  timeWindowMs: 6 * HOUR,
  matchFn: () => true,
  edgeType: 'temporally-adjacent',
};

test('pair confidence equals its confidenceDetail.value', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const result = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b', timestamp: T0 + HOUR })],
    new Date(T0 + 2 * HOUR),
  );
  assert.equal(result.pairs.length, 1);
  const pair = result.pairs[0]!;
  assert.ok(pair.confidenceDetail);
  assert.equal(pair.confidence, pair.confidenceDetail.value);
  assert.ok(pair.confidenceDetail.explanation.length > 0);
});

test('closer-in-time pairs score higher than distant ones', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const tight = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b', timestamp: T0 + 10 * 60_000 })],
    new Date(T0 + HOUR),
  ).pairs[0]!;
  const loose = engine.correlate(
    [obs({ id: 'c' }), obs({ id: 'd', timestamp: T0 + 5 * HOUR })],
    new Date(T0 + 6 * HOUR),
  ).pairs[0]!;
  assert.ok(tight.confidence > loose.confidence);
});

test('shared entities raise confidence for otherwise-identical pairs', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const plain = engine.correlate(
    [obs({ id: 'a', timestamp: T0 }), obs({ id: 'b', timestamp: T0 + 2 * HOUR })],
    new Date(T0 + 3 * HOUR),
  ).pairs[0]!;
  const linked = engine.correlate(
    [
      obs({ id: 'c', timestamp: T0, entityIds: ['ent-1'] }),
      obs({ id: 'd', timestamp: T0 + 2 * HOUR, entityIds: ['ent-1'] }),
    ],
    new Date(T0 + 3 * HOUR),
  ).pairs[0]!;
  assert.ok(linked.confidence > plain.confidence);
  assert.equal(linked.confidenceDetail!.factors.entity, 1.15);
});

test('co-located pairs outrank far-separated pairs', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const near = engine.correlate(
    [
      obs({ id: 'a', location: { lat: 40, lon: -86 } }),
      obs({ id: 'b', timestamp: T0 + HOUR, location: { lat: 40.05, lon: -86.05 } }),
    ],
    new Date(T0 + 2 * HOUR),
  ).pairs[0]!;
  const far = engine.correlate(
    [
      obs({ id: 'c', location: { lat: 40, lon: -86 } }),
      obs({ id: 'd', timestamp: T0 + HOUR, location: { lat: 30, lon: -60 } }),
    ],
    new Date(T0 + 2 * HOUR),
  ).pairs[0]!;
  assert.ok(near.confidence > far.confidence);
});

test('unlocated pairs are not penalized relative to co-located ones', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const unlocated = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b', timestamp: T0 + HOUR })],
    new Date(T0 + 2 * HOUR),
  ).pairs[0]!;
  assert.equal(unlocated.confidenceDetail!.factors.spatial, 1);
});

test('baseConfidence rule keeps conviction across the whole window', () => {
  const engine = new CorrelateEngine();
  engine.registerRule({
    ...anyPairRule,
    id: 'conviction-rule',
    timeWindowMs: 7 * 24 * HOUR,
    baseConfidence: 0.75,
  });
  const early = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b', timestamp: T0 + HOUR })],
    new Date(T0 + 2 * HOUR),
  ).pairs[0]!;
  const late = engine.correlate(
    [obs({ id: 'c' }), obs({ id: 'd', timestamp: T0 + 6 * 24 * HOUR })],
    new Date(T0 + 7 * 24 * HOUR),
  ).pairs[0]!;
  assert.equal(early.confidence, 0.75);
  assert.equal(late.confidence, 0.75);
});

test('injected reliabilityFor modulates confidence per rule', () => {
  const engine = new CorrelateEngine({
    reliabilityFor: (ruleId) => (ruleId === 'test-rule' ? 0.6 : 1),
  });
  engine.registerRule(anyPairRule);
  const pair = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b' })],
    new Date(T0 + HOUR),
  ).pairs[0]!;
  assert.equal(pair.confidence, 0.6);
  assert.equal(pair.confidenceDetail!.factors.reliability, 0.6);
});

test('injected regimeFactorFor boosts pairs and shows in the breakdown', () => {
  const engine = new CorrelateEngine({ regimeFactorFor: () => 1.15 });
  engine.registerRule(anyPairRule);
  const pair = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b', timestamp: T0 + 3 * HOUR })],
    new Date(T0 + 4 * HOUR),
  ).pairs[0]!;
  assert.equal(pair.confidenceDetail!.factors.regime, 1.15);
  assert.ok(Math.abs(pair.confidence - 0.575) < 1e-3);
});

test('no-options engine behaves neutrally (back-compat construction)', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const pair = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b' })],
    new Date(T0),
  ).pairs[0]!;
  assert.equal(pair.confidenceDetail!.factors.reliability, 1);
  assert.equal(pair.confidenceDetail!.factors.regime, 1);
  assert.equal(pair.confidence, 1);
});

test('injected timer makes the full CorrelationResult deterministic', () => {
  const makeEngine = () => {
    const engine = new CorrelateEngine({ timer: () => 0 });
    engine.registerRule(anyPairRule);
    return engine;
  };
  const input = [obs({ id: 'a' }), obs({ id: 'b', timestamp: T0 + HOUR })];
  const r1 = makeEngine().correlate(input, new Date(T0 + 2 * HOUR));
  const r2 = makeEngine().correlate(input, new Date(T0 + 2 * HOUR));
  assert.deepEqual(r1, r2);
  assert.equal(r1.processingMs, 0);
});

test('a regime provider returning 0 is neutralized, not a penalty', () => {
  const engine = new CorrelateEngine({ regimeFactorFor: () => 0 });
  engine.registerRule(anyPairRule);
  const pair = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b' })],
    new Date(T0),
  ).pairs[0]!;
  assert.equal(pair.confidenceDetail!.factors.regime, 1);
  assert.equal(pair.confidence, 1);
});

test('a reliability provider returning NaN is neutralized end-to-end', () => {
  const engine = new CorrelateEngine({ reliabilityFor: () => Number.NaN });
  engine.registerRule(anyPairRule);
  const pair = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b' })],
    new Date(T0),
  ).pairs[0]!;
  assert.equal(pair.confidenceDetail!.factors.reliability, 1);
  assert.ok(Number.isFinite(pair.confidence));
});

test('dedup: the same pair is not emitted twice across rules with same id', () => {
  const engine = new CorrelateEngine();
  engine.registerRule(anyPairRule);
  const result = engine.correlate(
    [obs({ id: 'a' }), obs({ id: 'b' }), obs({ id: 'a' })],
    new Date(T0),
  );
  const keys = result.pairs.map((p) => `${p.ruleId}|${p.eventA.id}|${p.eventB.id}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('domain pruning still applies before scoring', () => {
  const engine = new CorrelateEngine();
  engine.registerRule({ ...anyPairRule, id: 'seismic-only', domains: ['seismic'] });
  const result = engine.correlate(
    [obs({ id: 'a', domain: 'markets' }), obs({ id: 'b', domain: 'cyber' })],
    new Date(T0),
  );
  assert.equal(result.pairs.length, 0);
});
