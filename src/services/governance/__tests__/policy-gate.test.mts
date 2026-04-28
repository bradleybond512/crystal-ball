import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  gateAdjustmentProposal,
  gateAdjustmentProposals,
  autoApplyOnly,
  userApprovalOnly,
  type GateInput,
  type GatedProposal,
} from '../policy-gate';
import type { AdjustmentProposal } from '@/services/algorithms/safe-adjustment';

// ── Fixtures ────────────────────────────────────────────────────────────

function applyProposal(algorithmId = 'demo-algo'): AdjustmentProposal {
  return {
    algorithmId,
    generatedAt: 1_700_000_000_000,
    verdict: 'apply',
    parameterId: 'threshold',
    priorValue: 0.5,
    nextValue: 0.55,
    direction: 'increase',
    rationale: 'hit rate below floor',
    predictedEffect: 'expected hit rate +5%',
    rollback: 'set threshold back to 0.5',
  };
}

function noopProposal(algorithmId = 'demo-algo'): AdjustmentProposal {
  return {
    algorithmId,
    generatedAt: 1_700_000_000_000,
    verdict: 'noop',
    rationale: 'algorithm healthy',
    predictedEffect: 'no change',
  };
}

function lowMedReady(): GateInput {
  return {
    proposal: applyProposal(),
    algorithm: { id: 'demo-algo', criticality: 'medium', domain: 'weather' },
    evidenceCount: 25,
    replayPassed: true,
    backtestPassed: true,
  };
}

function lowMedPending(): GateInput {
  return {
    proposal: applyProposal(),
    algorithm: { id: 'demo-algo', criticality: 'low', domain: 'weather' },
    evidenceCount: 5,
    replayPassed: false,
    backtestPassed: false,
  };
}

function safetyTuning(): GateInput {
  return {
    proposal: applyProposal('storm-mode-trigger'),
    algorithm: { id: 'storm-mode-trigger', criticality: 'safety', domain: 'weather' },
    evidenceCount: 100,
    replayPassed: true,
    backtestPassed: true,
  };
}

function highReady(): GateInput {
  return {
    proposal: applyProposal('compound-risk'),
    algorithm: { id: 'compound-risk', criticality: 'high', domain: 'cross_domain' },
    evidenceCount: 50,
    replayPassed: true,
    backtestPassed: true,
  };
}

function highPending(): GateInput {
  return {
    proposal: applyProposal('compound-risk'),
    algorithm: { id: 'compound-risk', criticality: 'high', domain: 'cross_domain' },
    evidenceCount: 5,
    replayPassed: false,
    backtestPassed: false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('gateAdjustmentProposal — safety-critical', () => {
  it('denies safety-critical algorithm tuning regardless of evidence', () => {
    const result = gateAdjustmentProposal(safetyTuning());
    assert.equal(result.verdict.decision, 'deny');
    assert.equal(result.verdict.ruleId, 'safety_auto_deny');
    assert.equal(result.proposal.algorithmId, 'storm-mode-trigger');
  });
});

describe('gateAdjustmentProposal — low/medium tuning', () => {
  it('allows auto-apply when replay passes and ≥20 graded samples', () => {
    const result = gateAdjustmentProposal(lowMedReady());
    assert.equal(result.verdict.decision, 'allow_auto');
    assert.equal(result.verdict.ruleId, 'algo_tuning_gate_lowmed_ready');
    assert.deepEqual(result.verdict.requiredEvidence, []);
  });

  it('requires user approval when evidence is missing', () => {
    const result = gateAdjustmentProposal(lowMedPending());
    assert.equal(result.verdict.decision, 'require_user_approval');
    assert.equal(result.verdict.ruleId, 'algo_tuning_gate_lowmed_pending');
    assert.ok(result.verdict.requiredEvidence.length > 0);
    assert.ok(result.verdict.requiredEvidence.some((e) => e.includes('replay')));
    assert.ok(result.verdict.requiredEvidence.some((e) => e.includes('20 graded')));
  });
});

describe('gateAdjustmentProposal — high-criticality tuning', () => {
  it('allows auto-apply with ≥30 samples + replay + backtest', () => {
    const result = gateAdjustmentProposal(highReady());
    assert.equal(result.verdict.decision, 'allow_auto');
    assert.equal(result.verdict.ruleId, 'algo_tuning_gate_high_ready');
  });

  it('requires user approval when high-criticality evidence is missing', () => {
    const result = gateAdjustmentProposal(highPending());
    assert.equal(result.verdict.decision, 'require_user_approval');
    assert.equal(result.verdict.ruleId, 'algo_tuning_gate_high_pending');
    assert.ok(result.verdict.requiredEvidence.some((e) => e.includes('backtest')));
    assert.ok(result.verdict.requiredEvidence.some((e) => e.includes('30 graded')));
  });
});

describe('gateAdjustmentProposal — sensitive-data flags', () => {
  it('routes notification-affecting proposals to user approval', () => {
    const input: GateInput = {
      ...lowMedReady(),
      affectsNotifications: true,
    };
    const result = gateAdjustmentProposal(input);
    assert.equal(result.verdict.decision, 'require_user_approval');
    assert.equal(result.verdict.ruleId, 'notification_user_approval');
  });

  it('routes private-data-affecting proposals to user approval', () => {
    const input: GateInput = {
      ...lowMedReady(),
      affectsPrivateData: true,
    };
    const result = gateAdjustmentProposal(input);
    assert.equal(result.verdict.decision, 'require_user_approval');
    assert.equal(result.verdict.ruleId, 'private_data_user_approval');
  });
});

describe('gateAdjustmentProposal — missing algorithm metadata', () => {
  it('defaults to medium criticality + unknown domain when algorithm is absent', () => {
    const input: GateInput = {
      proposal: applyProposal(),
      evidenceCount: 25,
      replayPassed: true,
      backtestPassed: true,
    };
    const result = gateAdjustmentProposal(input);
    // medium criticality + replay + ≥20 samples → allow_auto
    assert.equal(result.verdict.decision, 'allow_auto');
    assert.equal(result.verdict.ruleId, 'algo_tuning_gate_lowmed_ready');
  });

  it('still gates without evidence when algorithm metadata is absent', () => {
    const input: GateInput = {
      proposal: applyProposal(),
      evidenceCount: 0,
      replayPassed: false,
      backtestPassed: false,
    };
    const result = gateAdjustmentProposal(input);
    assert.equal(result.verdict.decision, 'require_user_approval');
  });
});

describe('gateAdjustmentProposal — noop proposals', () => {
  it('still emits a verdict for noop proposals', () => {
    const input: GateInput = {
      proposal: noopProposal(),
      algorithm: { id: 'demo-algo', criticality: 'medium', domain: 'weather' },
      evidenceCount: 25,
      replayPassed: true,
      backtestPassed: true,
    };
    const result = gateAdjustmentProposal(input);
    assert.equal(result.proposal.verdict, 'noop');
    // policy verdict is still computed deterministically
    assert.equal(result.verdict.decision, 'allow_auto');
  });

  it('safety-critical noop proposals are denied auto-apply', () => {
    const input: GateInput = {
      proposal: noopProposal('storm-mode-trigger'),
      algorithm: { id: 'storm-mode-trigger', criticality: 'safety', domain: 'weather' },
      evidenceCount: 100,
      replayPassed: true,
      backtestPassed: true,
    };
    const result = gateAdjustmentProposal(input);
    assert.equal(result.verdict.decision, 'deny');
  });
});

describe('gateAdjustmentProposals (batch)', () => {
  it('returns one verdict per input in the same order', () => {
    const inputs = [lowMedReady(), safetyTuning(), highPending()];
    const results = gateAdjustmentProposals(inputs);
    assert.equal(results.length, 3);
    assert.equal(results[0]?.verdict.decision, 'allow_auto');
    assert.equal(results[1]?.verdict.decision, 'deny');
    assert.equal(results[2]?.verdict.decision, 'require_user_approval');
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(gateAdjustmentProposals([]), []);
  });
});

describe('autoApplyOnly filter', () => {
  it('keeps only allow_auto verdicts whose proposal is also apply', () => {
    const gated: GatedProposal[] = [
      // allow_auto + apply → kept
      gateAdjustmentProposal(lowMedReady()),
      // allow_auto + noop → dropped (nothing to apply)
      gateAdjustmentProposal({
        proposal: noopProposal(),
        algorithm: { id: 'demo-algo', criticality: 'medium', domain: 'weather' },
        evidenceCount: 25,
        replayPassed: true,
        backtestPassed: true,
      }),
      // deny → dropped
      gateAdjustmentProposal(safetyTuning()),
      // require_user_approval → dropped
      gateAdjustmentProposal(lowMedPending()),
    ];
    const result = autoApplyOnly(gated);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.verdict.decision, 'allow_auto');
    assert.equal(result[0]?.proposal.verdict, 'apply');
  });
});

describe('userApprovalOnly filter', () => {
  it('keeps only require_user_approval verdicts', () => {
    const gated: GatedProposal[] = [
      gateAdjustmentProposal(lowMedReady()),
      gateAdjustmentProposal(lowMedPending()),
      gateAdjustmentProposal(safetyTuning()),
      gateAdjustmentProposal(highPending()),
    ];
    const result = userApprovalOnly(gated);
    assert.equal(result.length, 2);
    for (const g of result) {
      assert.equal(g.verdict.decision, 'require_user_approval');
    }
  });
});

describe('determinism + JSON serialization', () => {
  it('produces identical verdicts for identical inputs', () => {
    const input = lowMedReady();
    const a = gateAdjustmentProposal(input);
    const b = gateAdjustmentProposal(input);
    assert.deepEqual(a, b);
  });

  it('round-trips through JSON without loss', () => {
    const result = gateAdjustmentProposal(highReady());
    const roundTrip = JSON.parse(JSON.stringify(result));
    assert.deepEqual(roundTrip, result);
  });
});
