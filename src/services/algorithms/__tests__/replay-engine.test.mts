import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FIXTURE_CAP,
  DEFAULT_REGRESSION_THRESHOLD,
  DEFAULT_SAMPLING_POLICY,
  clearFixtures,
  decisionsEqual,
  exportFixtures,
  fixtureCount,
  importFixtures,
  listFixtures,
  recordFixture,
  runReplay,
  shouldRecordFixture,
} from '../replay-engine';

beforeEach(() => {
  clearFixtures();
});

describe('shouldRecordFixture', () => {
  it('always records when severity exceeds threshold', () => {
    assert.equal(shouldRecordFixture(0.9, () => 0.99), true);
    assert.equal(shouldRecordFixture(0.75, () => 0.99), true);
  });

  it('samples low-severity at the configured rate', () => {
    let recorded = 0;
    let skipped = 0;
    let seed = 0;
    const random = () => {
      const v = (seed * 0.07) % 1;
      seed += 1;
      return v;
    };
    for (let i = 0; i < 100; i += 1) {
      if (shouldRecordFixture(0.2, random)) recorded += 1;
      else skipped += 1;
    }
    // Around 10% expected. Allow some variance.
    assert.ok(recorded > 5 && recorded < 20, `recorded=${recorded}`);
    assert.ok(skipped > 80);
  });

  it('respects custom policy', () => {
    const policy = { lowSeverityRate: 0, highSeverityThreshold: 1.0 };
    assert.equal(shouldRecordFixture(0.99, () => 0, policy), false);
    assert.equal(shouldRecordFixture(1.0, () => 0, policy), true);
  });
});

describe('recordFixture and listFixtures', () => {
  it('stores and returns fixtures per algorithm', () => {
    recordFixture({ algorithmId: 'a', recordedAt: 1, inputs: { x: 1 }, decision: 'hit' });
    recordFixture({ algorithmId: 'a', recordedAt: 2, inputs: { x: 2 }, decision: 'miss' });
    recordFixture({ algorithmId: 'b', recordedAt: 1, inputs: { y: 1 }, decision: 'hit' });
    assert.equal(fixtureCount('a'), 2);
    assert.equal(fixtureCount('b'), 1);
    assert.equal(listFixtures('a').length, 2);
  });

  it('LRU evicts oldest when cap exceeded', () => {
    for (let i = 0; i < 7; i += 1) {
      recordFixture(
        { algorithmId: 'a', recordedAt: i, inputs: { x: i }, decision: i },
        5,
      );
    }
    const fixtures = listFixtures('a');
    assert.equal(fixtures.length, 5);
    assert.equal(fixtures[0]!.recordedAt, 2); // oldest two evicted
    assert.equal(fixtures[4]!.recordedAt, 6);
  });

  it('uses custom id when provided', () => {
    const f = recordFixture({
      algorithmId: 'a',
      recordedAt: 1,
      inputs: {},
      decision: 'x',
      id: 'my-fixture-1',
    });
    assert.equal(f.id, 'my-fixture-1');
  });
});

describe('decisionsEqual', () => {
  it('compares primitives', () => {
    assert.equal(decisionsEqual(1, 1), true);
    assert.equal(decisionsEqual('a', 'a'), true);
    assert.equal(decisionsEqual(1, 2), false);
  });

  it('compares objects by JSON shape', () => {
    assert.equal(decisionsEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
    // Note: JSON.stringify is sensitive to key order. The check is
    // intentionally strict on key order so refactors that re-order
    // record fields are flagged as changes.
    assert.equal(decisionsEqual({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
  });

  it('null vs object', () => {
    assert.equal(decisionsEqual(null, {}), false);
    assert.equal(decisionsEqual(null, null), true);
  });
});

describe('runReplay', () => {
  it('reports zero changes when rerun matches recorded decision', () => {
    for (let i = 0; i < 10; i += 1) {
      recordFixture({
        algorithmId: 'a',
        recordedAt: i,
        inputs: { x: i },
        decision: { score: i * 0.1 },
      });
    }
    const report = runReplay({
      algorithmId: 'a',
      rerun: (inputs) => ({ score: (inputs as { x: number }).x * 0.1 }),
    });
    assert.equal(report.total, 10);
    assert.equal(report.changedCount, 0);
    assert.equal(report.regression, false);
  });

  it('detects regression when many decisions changed', () => {
    for (let i = 0; i < 10; i += 1) {
      recordFixture({
        algorithmId: 'a',
        recordedAt: i,
        inputs: { x: i },
        decision: { score: 0 },
      });
    }
    const report = runReplay({
      algorithmId: 'a',
      rerun: () => ({ score: 1 }),
    });
    assert.equal(report.changedCount, 10);
    assert.equal(report.regression, true);
    assert.ok(report.examples.length > 0);
    assert.equal(report.examples.length, 5); // capped at 5
  });

  it('does not flag regression below threshold', () => {
    for (let i = 0; i < 100; i += 1) {
      recordFixture({
        algorithmId: 'a',
        recordedAt: i,
        inputs: { x: i },
        decision: 'hit',
      });
    }
    let count = 0;
    const report = runReplay({
      algorithmId: 'a',
      rerun: () => {
        count += 1;
        return count <= 5 ? 'miss' : 'hit'; // 5/50 = 0.1, exactly at threshold
      },
      windowSize: 50,
    });
    assert.equal(report.changedFraction, 0.1);
    assert.equal(report.regression, false); // threshold is strict >
  });

  it('only replays the most recent windowSize fixtures', () => {
    for (let i = 0; i < 100; i += 1) {
      recordFixture({
        algorithmId: 'a',
        recordedAt: i,
        inputs: { x: i },
        decision: i,
      });
    }
    const report = runReplay({
      algorithmId: 'a',
      rerun: (inputs) => (inputs as { x: number }).x,
      windowSize: 30,
    });
    assert.equal(report.total, 30);
    assert.equal(report.changedCount, 0);
  });
});

describe('persistence', () => {
  it('exports and imports fixtures', () => {
    recordFixture({ algorithmId: 'a', recordedAt: 1, inputs: {}, decision: 'x' });
    recordFixture({ algorithmId: 'b', recordedAt: 2, inputs: {}, decision: 'y' });
    const exported = exportFixtures();
    clearFixtures();
    assert.equal(fixtureCount('a'), 0);
    importFixtures(exported);
    assert.equal(fixtureCount('a'), 1);
    assert.equal(fixtureCount('b'), 1);
  });
});

describe('default constants', () => {
  it('match plan-spec', () => {
    assert.equal(DEFAULT_FIXTURE_CAP, 500);
    assert.equal(DEFAULT_REGRESSION_THRESHOLD, 0.10);
    assert.equal(DEFAULT_SAMPLING_POLICY.lowSeverityRate, 0.10);
    assert.equal(DEFAULT_SAMPLING_POLICY.highSeverityThreshold, 0.75);
  });
});
