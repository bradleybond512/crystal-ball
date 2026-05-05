import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_AUTO_DEMOTE,
  DEFAULT_SHADOW_TIMEOUT_MS,
  autoEvaluate,
  clearLifecycle,
  getLifecycle,
  initLifecycle,
  isValidTransition,
  listInState,
  listLifecycles,
  promote,
  transition,
} from '../promotion-gate';
import { clearShadowState, enableShadowMode, recordShadowDecision, recordShadowOutcome } from '../shadow-mode';

beforeEach(() => {
  clearLifecycle();
  clearShadowState();
});

describe('isValidTransition', () => {
  it('allows draft -> shadow', () => {
    assert.equal(isValidTransition('draft', 'shadow'), true);
  });
  it('allows shadow -> candidate', () => {
    assert.equal(isValidTransition('shadow', 'candidate'), true);
  });
  it('allows candidate -> live', () => {
    assert.equal(isValidTransition('candidate', 'live'), true);
  });
  it('allows live -> shadow (demotion)', () => {
    assert.equal(isValidTransition('live', 'shadow'), true);
  });
  it('disallows draft -> live (must go through shadow)', () => {
    assert.equal(isValidTransition('draft', 'live'), false);
  });
  it('disallows transitions out of deprecated', () => {
    assert.equal(isValidTransition('deprecated', 'live'), false);
    assert.equal(isValidTransition('deprecated', 'shadow'), false);
  });
});

describe('initLifecycle and transition', () => {
  it('initializes in draft by default', () => {
    initLifecycle('a');
    assert.equal(getLifecycle('a')?.state, 'draft');
  });

  it('records transitions in audit trail', () => {
    initLifecycle('a', 'draft', () => 1000);
    transition('a', 'shadow', 'ready for shadow', 'human', () => 2000);
    transition('a', 'candidate', 'auto-promote', 'auto', () => 3000);
    const entry = getLifecycle('a')!;
    assert.equal(entry.state, 'candidate');
    assert.equal(entry.transitions.length, 2);
    assert.equal(entry.transitions[0]!.from, 'draft');
    assert.equal(entry.transitions[0]!.to, 'shadow');
    assert.equal(entry.transitions[1]!.from, 'shadow');
    assert.equal(entry.transitions[1]!.to, 'candidate');
  });

  it('throws on invalid transition', () => {
    initLifecycle('a');
    assert.throws(
      () => transition('a', 'live', 'skipping shadow', 'human'),
      /Invalid transition/,
    );
  });

  it('throws when no lifecycle exists', () => {
    assert.throws(() => transition('missing', 'shadow', 'x'), /No lifecycle/);
  });
});

describe('promote', () => {
  it('moves candidate -> live with human initiator', () => {
    initLifecycle('a', 'candidate', () => 1000);
    promote('a', 'approved by user', () => 2000);
    const entry = getLifecycle('a')!;
    assert.equal(entry.state, 'live');
    assert.equal(entry.transitions[0]!.initiator, 'human');
  });

  it('throws when not in candidate state', () => {
    initLifecycle('a', 'shadow');
    assert.throws(() => promote('a', 'too soon'), /must be candidate/);
  });
});

describe('autoEvaluate', () => {
  it('promotes shadow -> candidate when criteria met', () => {
    enableShadowMode('s');
    for (let i = 0; i < 50; i += 1) {
      const r = recordShadowDecision({
        algorithmId: 's',
        at: i,
        durationMs: 1,
        score: 0.9,
      })!;
      recordShadowOutcome('s', r.id, 'hit', '[TRUE_POSITIVE] ok');
    }
    initLifecycle('s', 'shadow', () => 1000);
    const result = autoEvaluate({
      algorithmId: 's',
      shadowDecisions: [],
      now: () => 2000,
    });
    // Must pass shadow decisions explicitly since lifecycle module doesn't
    // know about the shadow ledger.
    assert.equal(result.changed, false);

    // Now provide them.
    const decisions = [];
    for (let i = 0; i < 50; i += 1) {
      decisions.push({
        algorithmId: 's',
        id: `d${i}`,
        at: i,
        durationMs: 1,
        score: 0.9,
        outcome: 'hit' as const,
        outcomeReason: '[TRUE_POSITIVE] ok',
      });
    }
    const result2 = autoEvaluate({
      algorithmId: 's',
      shadowDecisions: decisions,
      now: () => 2000,
    });
    assert.equal(result2.changed, true);
    assert.equal(result2.newState, 'candidate');
  });

  it('deprecates shadow algorithm after timeout', () => {
    initLifecycle('s', 'shadow', () => 1000);
    const result = autoEvaluate({
      algorithmId: 's',
      shadowDecisions: [],
      now: () => 1000 + DEFAULT_SHADOW_TIMEOUT_MS + 1,
    });
    assert.equal(result.changed, true);
    assert.equal(result.newState, 'deprecated');
  });

  it('demotes live -> shadow when 7-day F1 below floor', () => {
    initLifecycle('s', 'live', () => 1000);
    const result = autoEvaluate({
      algorithmId: 's',
      liveRecentF1: 0.40,
      now: () => 2000,
    });
    assert.equal(result.changed, true);
    assert.equal(result.newState, 'shadow');
    const entry = getLifecycle('s')!;
    assert.equal(entry.state, 'shadow');
    assert.match(entry.transitions[0]!.reason, /auto-demote/);
  });

  it('does not demote when F1 above floor', () => {
    initLifecycle('s', 'live', () => 1000);
    const result = autoEvaluate({
      algorithmId: 's',
      liveRecentF1: 0.80,
      now: () => 2000,
    });
    assert.equal(result.changed, false);
  });

  it('returns unchanged when no lifecycle exists', () => {
    const result = autoEvaluate({
      algorithmId: 'never-init',
      now: () => 1000,
    });
    assert.equal(result.changed, false);
  });
});

describe('listInState', () => {
  it('filters by state', () => {
    initLifecycle('a', 'live');
    initLifecycle('b', 'shadow');
    initLifecycle('c', 'live');
    assert.equal(listInState('live').length, 2);
    assert.equal(listInState('shadow').length, 1);
  });
});

describe('default constants', () => {
  it('match plan-spec', () => {
    assert.equal(DEFAULT_AUTO_DEMOTE.minF1, 0.5);
    assert.equal(DEFAULT_AUTO_DEMOTE.windowMs, 7 * 24 * 60 * 60 * 1000);
    assert.equal(DEFAULT_SHADOW_TIMEOUT_MS, 90 * 24 * 60 * 60 * 1000);
  });
});

describe('listLifecycles', () => {
  it('clones returned entries', () => {
    initLifecycle('a');
    transition('a', 'shadow', 'go');
    const list1 = listLifecycles();
    list1[0]!.transitions.push({
      at: 999,
      from: 'shadow',
      to: 'live',
      reason: 'tampered',
      initiator: 'human',
    });
    const list2 = listLifecycles();
    assert.equal(list2[0]!.transitions.length, 1);
  });
});
