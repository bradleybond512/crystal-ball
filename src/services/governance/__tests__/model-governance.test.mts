/**
 * Coverage for model-governance.ts — verifies append-only history,
 * production-promotion gates, safety-critical require_pr_review
 * enforcement, rollback target requirement, and currentProduction
 * resolution across rollbacks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createModelGovernance,
  type EvidenceSummary,
  type PolicyApprovalRef,
} from '../model-governance.ts';

const goodEvidence: EvidenceSummary = {
  sampleCount: 50,
  hitRate: 0.85,
  replayPassRate: 0.95,
  shadowSafetyClean: true,
};

const allowAuto: PolicyApprovalRef = {
  verdict: 'allow_auto',
  ruleId: 'algo_tuning_gate_high_ready',
  at: 1_000,
};

const prReview: PolicyApprovalRef = {
  verdict: 'require_pr_review',
  ruleId: 'algo_promote_pr_review',
  at: 1_000,
  prRef: { url: 'https://github.com/x/y/pull/1', reviewers: ['codex-bot'] },
};

test('shadow status records without rollback target', () => {
  const g = createModelGovernance();
  const r = g.record({
    algorithmId: 'truth-score',
    version: '1.1.0',
    status: 'shadow',
    promotedBy: 'claude-session-A',
    evidence: { sampleCount: 5, hitRate: 0.3, replayPassRate: 0.6, shadowSafetyClean: true },
    policyApproval: allowAuto,
  });
  assert.equal(r.status, 'shadow');
  assert.ok(!r.rollbackVersion);
});

test('production status requires rollback target', () => {
  const g = createModelGovernance();
  assert.throws(() => g.record({
    algorithmId: 'truth-score',
    version: '1.1.0',
    status: 'production',
    promotedBy: 'claude',
    evidence: goodEvidence,
    policyApproval: allowAuto,
  }), /rollbackVersion/);
});

test('production status requires evidence floor (≥30 samples, ≥0.7 hit, ≥0.8 replay, shadow clean)', () => {
  const g = createModelGovernance();
  assert.throws(() => g.record({
    algorithmId: 'truth-score',
    version: '1.1.0',
    status: 'production',
    promotedBy: 'claude',
    rollbackVersion: '1.0.0',
    evidence: { sampleCount: 10, hitRate: 0.85, replayPassRate: 0.9, shadowSafetyClean: true },
    policyApproval: allowAuto,
  }), /evidence floor/);
});

test('safety-critical algorithms need require_pr_review approval + prRef', () => {
  const g = createModelGovernance();
  assert.throws(() => g.record({
    algorithmId: 'weather-urgency',
    version: '2.0.0',
    status: 'production',
    promotedBy: 'claude',
    rollbackVersion: '1.0.0',
    evidence: goodEvidence,
    policyApproval: allowAuto,  // wrong: needs require_pr_review
  }), /safety-critical promotion of weather-urgency requires require_pr_review/);
});

test('safety-critical promotion succeeds with require_pr_review + prRef + good evidence', () => {
  const g = createModelGovernance();
  const r = g.record({
    algorithmId: 'weather-urgency',
    version: '2.0.0',
    status: 'production',
    promotedBy: 'claude',
    rollbackVersion: '1.0.0',
    evidence: goodEvidence,
    policyApproval: prReview,
    knownLimitations: ['urban-only training data'],
    safetyNotes: ['do not use in coastal flood domains'],
  });
  assert.equal(r.status, 'production');
  assert.equal(r.algorithmId, 'weather-urgency');
});

test('non-safety algorithm production succeeds with allow_auto + good evidence', () => {
  const g = createModelGovernance();
  const r = g.record({
    algorithmId: 'truth-score',
    version: '1.1.0',
    status: 'production',
    promotedBy: 'claude',
    rollbackVersion: '1.0.0',
    evidence: goodEvidence,
    policyApproval: allowAuto,
  });
  assert.equal(r.status, 'production');
});

test('append-only history per algorithm', () => {
  const g = createModelGovernance({ now: (() => { let t = 0; return () => ++t; })() });
  g.record({
    algorithmId: 'truth-score',
    version: '1.0.0',
    status: 'production',
    promotedBy: 'a',
    rollbackVersion: '0.9.0',
    evidence: goodEvidence,
    policyApproval: allowAuto,
  });
  g.record({
    algorithmId: 'truth-score',
    version: '1.0.0',
    status: 'rolled_back',
    promotedBy: 'b',
    evidence: goodEvidence,
    policyApproval: allowAuto,
  });
  const hist = g.historyFor('truth-score');
  assert.equal(hist.length, 2);
  assert.equal(hist[0]!.status, 'production');
  assert.equal(hist[1]!.status, 'rolled_back');
});

test('currentProduction skips rolled-back versions', () => {
  let t = 0;
  const g = createModelGovernance({ now: () => ++t });
  g.record({ algorithmId: 'a', version: '1.0', status: 'production', promotedBy: 'x', rollbackVersion: '0.9', evidence: goodEvidence, policyApproval: allowAuto });
  g.record({ algorithmId: 'a', version: '1.0', status: 'rolled_back', promotedBy: 'x', evidence: goodEvidence, policyApproval: allowAuto });
  g.record({ algorithmId: 'a', version: '1.1', status: 'production', promotedBy: 'x', rollbackVersion: '1.0', evidence: goodEvidence, policyApproval: allowAuto });
  const cur = g.currentProduction('a');
  assert.equal(cur?.version, '1.1');
});

test('currentProduction returns undefined when no production record exists', () => {
  const g = createModelGovernance();
  g.record({
    algorithmId: 'a',
    version: '0.1',
    status: 'shadow',
    promotedBy: 'x',
    evidence: { sampleCount: 5, hitRate: 0.4, replayPassRate: 0.5, shadowSafetyClean: true },
    policyApproval: allowAuto,
  });
  assert.equal(g.currentProduction('a'), undefined);
});

test('toJson is round-trippable', () => {
  const g = createModelGovernance();
  g.record({
    algorithmId: 'truth-score',
    version: '1.1.0',
    status: 'production',
    promotedBy: 'claude',
    rollbackVersion: '1.0.0',
    evidence: goodEvidence,
    policyApproval: allowAuto,
  });
  const json = g.toJson();
  const round = JSON.parse(JSON.stringify(json));
  assert.equal(JSON.stringify(round), JSON.stringify(json));
});
