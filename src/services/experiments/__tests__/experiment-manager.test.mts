/**
 * Coverage for experiment-manager.ts — verifies:
 *   - Lifecycle: draft → running → paused/resume/complete.
 *   - Safety-stop: fires once, freezes status to 'stopped',
 *     refuses further outcomes.
 *   - Append-only: recording the same caseId twice throws.
 *   - Recommendation engine: continue / promote / keep_control /
 *     manual_review based on sample size + win margin.
 *   - JSON serialization round-trip.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExperimentManager,
  type ExperimentDefinition,
  type ExperimentOutcomeRecord,
} from '../experiment-manager.ts';

function defaultDef(overrides: Partial<ExperimentDefinition> = {}): ExperimentDefinition {
  return {
    id: 'test-exp',
    hypothesis: 'Candidate threshold lowers false negatives',
    domain: 'weather_safety',
    controlVersion: '1.0.0',
    candidateVersion: '1.1.0',
    metrics: ['hit_rate'],
    minSamples: 5,
    safetyStopConditions: ['safety_critical_miss'],
    ...overrides,
  };
}

function outcome(caseId: string, kind: 'control_win' | 'candidate_win' | 'inconclusive', at = 1): ExperimentOutcomeRecord {
  return { caseId, outcome: kind, at };
}

test('define + start: draft → running', () => {
  const mgr = createExperimentManager({ now: () => 1_000 });
  mgr.define(defaultDef());
  const r = mgr.start('test-exp');
  assert.equal(r.status, 'running');
  assert.equal(r.createdAt, 1_000);
});

test('define throws on id collision', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  assert.throws(() => mgr.define(defaultDef()), /already defined/);
});

test('start refuses non-draft non-paused statuses', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  assert.throws(() => mgr.start('test-exp'), /cannot start from running/);
});

test('pause is idempotent on already-paused', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  mgr.pause('test-exp');
  const r = mgr.pause('test-exp');
  assert.equal(r.status, 'paused');
});

test('resume requires paused status', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  assert.throws(() => mgr.resume('test-exp'), /Cannot resume/);
});

// ── Safety stop ────────────────────────────────────────────────────────

test('safety stop flips status to stopped + freezes outcomes', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  mgr.recordOutcome('test-exp', outcome('case-1', 'control_win'));
  mgr.triggerSafetyStop('test-exp', 'safety_critical_miss');
  assert.throws(() => mgr.recordOutcome('test-exp', outcome('case-2', 'candidate_win')), /stopped/);
  assert.throws(() => mgr.start('test-exp'), /cannot start from stopped/);
});

test('safety stop is idempotent (same condition does not duplicate)', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  mgr.triggerSafetyStop('test-exp', 'safety_critical_miss');
  const r = mgr.triggerSafetyStop('test-exp', 'safety_critical_miss');
  assert.deepEqual(r.triggeredSafetyStops, ['safety_critical_miss']);
});

test('safety stop with multiple conditions records each unique one', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  mgr.triggerSafetyStop('test-exp', 'safety_critical_miss');
  const r = mgr.triggerSafetyStop('test-exp', 'user_acknowledged_drop');
  assert.deepEqual(r.triggeredSafetyStops, ['safety_critical_miss', 'user_acknowledged_drop']);
});

// ── Append-only outcomes ──────────────────────────────────────────────

test('recording the same caseId twice throws (append-only)', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef());
  mgr.start('test-exp');
  mgr.recordOutcome('test-exp', outcome('case-1', 'control_win'));
  assert.throws(() => mgr.recordOutcome('test-exp', outcome('case-1', 'candidate_win')), /already recorded/);
});

// ── Recommendation engine ─────────────────────────────────────────────

test('insufficient samples → continue', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef({ minSamples: 5 }));
  mgr.start('test-exp');
  mgr.recordOutcome('test-exp', outcome('a', 'candidate_win'));
  mgr.recordOutcome('test-exp', outcome('b', 'candidate_win'));
  const result = mgr.evaluate('test-exp');
  assert.equal(result.recommendation, 'continue');
  assert.match(result.reason, /3 more/);
});

test('candidate wins by ≥10% margin → promote', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef({ minSamples: 5 }));
  mgr.start('test-exp');
  // 8 candidate wins, 2 control wins → margin 6 ≥ ceil(10*0.1)=1 → promote
  for (let i = 0; i < 8; i++) mgr.recordOutcome('test-exp', outcome(`c${i}`, 'candidate_win'));
  for (let i = 0; i < 2; i++) mgr.recordOutcome('test-exp', outcome(`x${i}`, 'control_win'));
  const result = mgr.evaluate('test-exp');
  assert.equal(result.recommendation, 'promote');
  assert.equal(result.candidateWins, 8);
  assert.equal(result.controlWins, 2);
});

test('control wins decisively → keep_control', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef({ minSamples: 5 }));
  mgr.start('test-exp');
  for (let i = 0; i < 8; i++) mgr.recordOutcome('test-exp', outcome(`c${i}`, 'control_win'));
  for (let i = 0; i < 2; i++) mgr.recordOutcome('test-exp', outcome(`x${i}`, 'candidate_win'));
  const result = mgr.evaluate('test-exp');
  assert.equal(result.recommendation, 'keep_control');
});

test('razor-thin margin → manual_review', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef({ minSamples: 10 }));
  mgr.start('test-exp');
  // 11 candidate vs 10 control → margin 1, threshold ceil(21*0.1)=3 → manual_review
  for (let i = 0; i < 11; i++) mgr.recordOutcome('test-exp', outcome(`c${i}`, 'candidate_win'));
  for (let i = 0; i < 10; i++) mgr.recordOutcome('test-exp', outcome(`x${i}`, 'control_win'));
  const result = mgr.evaluate('test-exp');
  assert.equal(result.recommendation, 'manual_review');
});

test('safety stop overrides recommendation regardless of wins', () => {
  const mgr = createExperimentManager();
  mgr.define(defaultDef({ minSamples: 5 }));
  mgr.start('test-exp');
  for (let i = 0; i < 10; i++) mgr.recordOutcome('test-exp', outcome(`c${i}`, 'candidate_win'));
  mgr.triggerSafetyStop('test-exp', 'safety_critical_miss');
  const result = mgr.evaluate('test-exp');
  assert.equal(result.recommendation, 'keep_control');
  assert.match(result.reason, /Safety-stop fired/);
});

// ── JSON serialization ────────────────────────────────────────────────

test('toJson is round-trippable', () => {
  const mgr = createExperimentManager({ now: () => 1_000 });
  mgr.define(defaultDef());
  mgr.start('test-exp');
  mgr.recordOutcome('test-exp', outcome('case-1', 'candidate_win', 2_000));
  const snapshot = mgr.toJson();
  const round = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(round, snapshot);
});

test('all() returns experiments oldest-first by createdAt', () => {
  let t = 100;
  const mgr = createExperimentManager({ now: () => ++t });
  mgr.define(defaultDef({ id: 'a' }));
  mgr.define(defaultDef({ id: 'b' }));
  mgr.define(defaultDef({ id: 'c' }));
  const ids = mgr.all().map((r) => r.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('determinism: same lifecycle produces same evaluation', () => {
  const m1 = createExperimentManager({ now: () => 1 });
  const m2 = createExperimentManager({ now: () => 1 });
  for (const m of [m1, m2]) {
    m.define(defaultDef({ minSamples: 5 }));
    m.start('test-exp');
    for (let i = 0; i < 6; i++) m.recordOutcome('test-exp', outcome(`c${i}`, 'candidate_win', 100 + i));
    for (let i = 0; i < 1; i++) m.recordOutcome('test-exp', outcome(`x${i}`, 'control_win', 200 + i));
  }
  assert.deepEqual(m1.evaluate('test-exp'), m2.evaluate('test-exp'));
});
