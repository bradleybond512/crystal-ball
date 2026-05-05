import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROMOTION_CRITERIA,
  clearShadowState,
  disableShadowMode,
  enableShadowMode,
  evaluatePromotion,
  isShadowAlgorithm,
  listShadowAlgorithms,
  listShadowDecisions,
  recordShadowDecision,
  recordShadowOutcome,
} from '../shadow-mode';

beforeEach(() => {
  clearShadowState();
});

describe('shadow registration', () => {
  it('isShadowAlgorithm reflects enable/disable', () => {
    assert.equal(isShadowAlgorithm('a1'), false);
    enableShadowMode('a1');
    assert.equal(isShadowAlgorithm('a1'), true);
    disableShadowMode('a1');
    assert.equal(isShadowAlgorithm('a1'), false);
  });

  it('lists shadow algorithms sorted', () => {
    enableShadowMode('z1');
    enableShadowMode('a1');
    enableShadowMode('m1');
    assert.deepEqual(listShadowAlgorithms(), ['a1', 'm1', 'z1']);
  });
});

describe('isolation', () => {
  it('recordShadowDecision returns null for non-shadow algorithm', () => {
    const result = recordShadowDecision({
      algorithmId: 'live-algo',
      at: 1,
      durationMs: 1,
      score: 0.9,
    });
    assert.equal(result, null);
  });

  it('recordShadowDecision stores when shadow', () => {
    enableShadowMode('shadow-algo');
    const r = recordShadowDecision({
      algorithmId: 'shadow-algo',
      at: 1,
      durationMs: 1,
      score: 0.9,
    });
    assert.ok(r);
    assert.match(r!.id, /^shadow-/);
    assert.equal(listShadowDecisions('shadow-algo').length, 1);
  });

  it('different algorithms have separate decision lists', () => {
    enableShadowMode('a');
    enableShadowMode('b');
    recordShadowDecision({ algorithmId: 'a', at: 1, durationMs: 1, score: 0.9 });
    recordShadowDecision({ algorithmId: 'b', at: 1, durationMs: 1, score: 0.5 });
    recordShadowDecision({ algorithmId: 'a', at: 1, durationMs: 1, score: 0.7 });
    assert.equal(listShadowDecisions('a').length, 2);
    assert.equal(listShadowDecisions('b').length, 1);
  });
});

describe('outcomes', () => {
  it('records outcome and prevents double-grade', () => {
    enableShadowMode('s');
    const r = recordShadowDecision({ algorithmId: 's', at: 1, durationMs: 1, score: 0.9 })!;
    recordShadowOutcome('s', r.id, 'hit', '[TRUE_POSITIVE] ok');
    assert.throws(
      () => recordShadowOutcome('s', r.id, 'miss', 'try again'),
      /already graded/,
    );
  });

  it('throws on unknown decision id', () => {
    enableShadowMode('s');
    assert.throws(
      () => recordShadowOutcome('s', 'missing', 'hit', 'x'),
      /Unknown shadow decision/,
    );
  });
});

describe('evaluatePromotion', () => {
  it('blocks when below the graded count floor', () => {
    enableShadowMode('s');
    const decisions = [];
    for (let i = 0; i < 10; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: 1,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'hit', '[TRUE_POSITIVE] ok');
      decisions.push(r);
    }
    const result = evaluatePromotion('s', listShadowDecisions('s'));
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some((r) => r.includes('graded events')));
  });

  it('passes when all metrics meet the floor', () => {
    enableShadowMode('s');
    // 50 events: 40 TP, 5 FP, 5 FN -> P=40/45=0.89, R=40/45=0.89, F1=0.89
    for (let i = 0; i < 40; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: i,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'hit', '[TRUE_POSITIVE] ok');
    }
    for (let i = 0; i < 5; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: 100 + i,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'miss', '[FALSE_POSITIVE] alert without event');
    }
    for (let i = 0; i < 5; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: 200 + i,
        durationMs: 1,
        score: 0.2,
      })!;
      recordShadowOutcome('s', r.id, 'miss', '[FALSE_NEGATIVE] event missed');
    }
    const result = evaluatePromotion('s', listShadowDecisions('s'));
    assert.equal(result.eligible, true);
    assert.equal(result.graded, 50);
    assert.ok(result.precision > 0.85);
    assert.ok(result.recall > 0.85);
    assert.ok(result.f1 > 0.85);
  });

  it('blocks when precision below floor', () => {
    enableShadowMode('s');
    // 50 events: 25 TP, 25 FP -> P = 0.5, below 0.7 floor
    for (let i = 0; i < 25; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: i,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'hit', '[TRUE_POSITIVE] ok');
    }
    for (let i = 0; i < 25; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: 100 + i,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'miss', '[FALSE_POSITIVE] noise');
    }
    const result = evaluatePromotion('s', listShadowDecisions('s'));
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some((r) => r.includes('precision')));
  });

  it('uses custom criteria when provided', () => {
    enableShadowMode('s');
    for (let i = 0; i < 5; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: i,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'hit', '[TRUE_POSITIVE] ok');
    }
    const result = evaluatePromotion('s', listShadowDecisions('s'), {
      minPrecision: 0.5,
      minRecall: 0.5,
      minF1: 0.5,
      minGradedEvents: 5,
    });
    assert.equal(result.eligible, true);
  });
});

describe('default criteria', () => {
  it('matches plan-spec floors', () => {
    assert.equal(DEFAULT_PROMOTION_CRITERIA.minPrecision, 0.7);
    assert.equal(DEFAULT_PROMOTION_CRITERIA.minRecall, 0.6);
    assert.equal(DEFAULT_PROMOTION_CRITERIA.minF1, 0.65);
    assert.equal(DEFAULT_PROMOTION_CRITERIA.minGradedEvents, 50);
  });
});
