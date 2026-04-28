/**
 * Coverage for policy-engine.ts — verifies the deterministic
 * decision flow:
 *   - Safety-critical actions are denied auto-apply (top of chain).
 *   - Private data + notification changes require user approval.
 *   - Fact assertions are denied (truth comes from sources, not clicks).
 *   - Provider configs and algorithm promotions go to PR review.
 *   - Algorithm tuning gate respects criticality + evidence + replay.
 *   - Feature toggles / UI prefs / cache purges auto-apply.
 *   - JSON-serializable output, deterministic same-input = same-output.
 *   - Fallback path is `require_user_approval` (fail-closed).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePolicy, type PolicyContext } from '../policy-engine.ts';

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    actionKind: 'algorithm_tuning',
    targetId: 'truth-score',
    domain: 'intelligence',
    criticality: 'medium',
    evidenceCount: 0,
    replayPassed: false,
    backtestPassed: false,
    affectsNotifications: false,
    affectsPrivateData: false,
    ...overrides,
  };
}

// ── Hard-deny rules ────────────────────────────────────────────────────

test('safety-critical algorithm tuning is denied auto-apply', () => {
  const v = evaluatePolicy(ctx({ criticality: 'safety' }));
  assert.equal(v.decision, 'deny');
  assert.equal(v.ruleId, 'safety_auto_deny');
});

test('safety-critical with full evidence is still denied (hard rule)', () => {
  const v = evaluatePolicy(ctx({
    criticality: 'safety',
    evidenceCount: 1000,
    replayPassed: true,
    backtestPassed: true,
  }));
  assert.equal(v.decision, 'deny', 'hard rules win over evidence');
});

test('fact assertion is denied — truth from sources, not user clicks', () => {
  const v = evaluatePolicy(ctx({ actionKind: 'fact_assertion' }));
  assert.equal(v.decision, 'deny');
  assert.equal(v.ruleId, 'fact_assertion_deny');
});

// ── User approval rules ───────────────────────────────────────────────

test('private data change requires user approval regardless of action kind', () => {
  const v = evaluatePolicy(ctx({
    actionKind: 'algorithm_tuning',
    affectsPrivateData: true,
  }));
  assert.equal(v.decision, 'require_user_approval');
  assert.equal(v.ruleId, 'private_data_user_approval');
});

test('notification setting change requires user approval', () => {
  const v = evaluatePolicy(ctx({
    actionKind: 'notification_setting',
    affectsNotifications: true,
  }));
  assert.equal(v.decision, 'require_user_approval');
  assert.equal(v.ruleId, 'notification_user_approval');
});

// ── PR review rules ───────────────────────────────────────────────────

test('provider config change requires PR review', () => {
  const v = evaluatePolicy(ctx({ actionKind: 'provider_config' }));
  assert.equal(v.decision, 'require_pr_review');
  assert.equal(v.ruleId, 'provider_config_pr_review');
});

test('algorithm promotion lists missing evidence', () => {
  const v = evaluatePolicy(ctx({
    actionKind: 'algorithm_promote',
    evidenceCount: 10,
    replayPassed: false,
    backtestPassed: false,
  }));
  assert.equal(v.decision, 'require_pr_review');
  assert.match(v.requiredEvidence.join(' '), /replay/i);
  assert.match(v.requiredEvidence.join(' '), /backtest/i);
  assert.match(v.requiredEvidence.join(' '), /≥50/);
});

test('algorithm promotion with full evidence still requires PR review', () => {
  const v = evaluatePolicy(ctx({
    actionKind: 'algorithm_promote',
    evidenceCount: 100,
    replayPassed: true,
    backtestPassed: true,
  }));
  assert.equal(v.decision, 'require_pr_review');
  assert.deepEqual(v.requiredEvidence, []);
});

// ── Algorithm tuning gate ─────────────────────────────────────────────

test('high-criticality tuning needs replay + backtest + 30 samples', () => {
  const v = evaluatePolicy(ctx({
    criticality: 'high',
    evidenceCount: 10,
  }));
  assert.equal(v.decision, 'require_user_approval');
  assert.match(v.requiredEvidence.join(' '), /replay/);
  assert.match(v.requiredEvidence.join(' '), /backtest/);
  assert.match(v.requiredEvidence.join(' '), /≥30/);
});

test('high-criticality tuning auto-applies when all gates pass', () => {
  const v = evaluatePolicy(ctx({
    criticality: 'high',
    evidenceCount: 35,
    replayPassed: true,
    backtestPassed: true,
  }));
  assert.equal(v.decision, 'allow_auto');
  assert.equal(v.ruleId, 'algo_tuning_gate_high_ready');
});

test('low/medium tuning needs replay + 20 samples', () => {
  const v = evaluatePolicy(ctx({
    criticality: 'medium',
    evidenceCount: 5,
  }));
  assert.equal(v.decision, 'require_user_approval');
  assert.match(v.requiredEvidence.join(' '), /replay/);
  assert.match(v.requiredEvidence.join(' '), /≥20/);
});

test('low/medium tuning auto-applies once gates clear', () => {
  const v = evaluatePolicy(ctx({
    criticality: 'low',
    evidenceCount: 25,
    replayPassed: true,
  }));
  assert.equal(v.decision, 'allow_auto');
});

// ── Auto-apply rules ──────────────────────────────────────────────────

test('feature toggle auto-applies', () => {
  const v = evaluatePolicy(ctx({ actionKind: 'feature_toggle' }));
  assert.equal(v.decision, 'allow_auto');
});

test('UI preference auto-applies', () => {
  const v = evaluatePolicy(ctx({ actionKind: 'ui_preference' }));
  assert.equal(v.decision, 'allow_auto');
});

test('cache purge auto-applies even at safety criticality (recoverable)', () => {
  const v = evaluatePolicy(ctx({ actionKind: 'cache_purge', criticality: 'safety' }));
  assert.equal(v.decision, 'allow_auto');
});

// ── Rule ordering invariant ───────────────────────────────────────────

test('private data wins over auto-apply (UI preference + private data → user approval)', () => {
  const v = evaluatePolicy(ctx({ actionKind: 'ui_preference', affectsPrivateData: true }));
  assert.equal(v.decision, 'require_user_approval');
});

test('safety-criticality wins over private-data on algo tuning', () => {
  const v = evaluatePolicy(ctx({ criticality: 'safety', affectsPrivateData: true }));
  assert.equal(v.decision, 'deny', 'safety_auto_deny is the first rule');
});

// ── JSON / determinism ────────────────────────────────────────────────

test('verdict is JSON-serializable', () => {
  const v = evaluatePolicy(ctx({ criticality: 'high', evidenceCount: 25, replayPassed: true }));
  const round = JSON.parse(JSON.stringify(v));
  assert.deepEqual(round, v);
});

test('determinism: same input → same verdict twice', () => {
  const c = ctx({ criticality: 'high', evidenceCount: 25, replayPassed: true, backtestPassed: false });
  const a = evaluatePolicy(c);
  const b = evaluatePolicy(c);
  assert.deepEqual(a, b);
});
