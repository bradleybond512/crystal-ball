/**
 * Tests for ACC-404 — first-promotion-decision.ts,
 * champion-rollback-fixture.ts, and the baseline-regression safety
 * adapter added to promotion-gate.ts.
 *
 * Coverage:
 *   1. MONITOR verdict + exact missing evidence when floors unmet.
 *   2. REJECTED verdict + failing gates when floors met but quality fails.
 *   3. PROMOTE verdict + overall PROMOTE with promotedChallengerId.
 *   4. Overall precedence: PROMOTE > REJECTED > MONITOR.
 *   5. Persistence round-trip + corrupt payload → null.
 *   6. Rollback fixture passes end-to-end on an isolated registry.
 *   7. Baseline-regression safety: all-match-baseline → full recall even
 *      when every fixture fails raw; a NEW regression is caught; lead
 *      time only from passing warning expectations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideFirstPromotion,
  persistFirstPromotionDecision,
  loadFirstPromotionDecision,
  FIRST_DECISION_STORAGE_KEY,
} from '../first-promotion-decision.js';
import { runChampionRollbackSelfTestFixture } from '../champion-rollback-fixture.js';
import {
  evaluatePromotionGate,
  safetyEvidenceFromBaselineRegression,
} from '../promotion-gate.js';
import type { SafetyReplayEvidence } from '../promotion-gate.js';
import type { JoinedPairEvidence } from '../shadow-rollout.js';
import { runReplay } from '../../ops/replay-harness.js';
import { buildCatalogReplayFixtures } from '../../ops/replay-fixtures-catalog.js';
import { compareReplayReportToBaseline } from '../../ops/replay-baseline.js';
import type { ReplayBaseline } from '../../ops/replay-baseline.js';
import replayBaseline from '../../ops/replay-baseline.json' with { type: 'json' };

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

const SAFETY_OK: SafetyReplayEvidence = {
  safetyCriticalTotal: 5,
  safetyCriticalPassed: 5,
};

function cohort(n: number, challengerBetter: boolean): JoinedPairEvidence[] {
  const out: JoinedPairEvidence[] = [];
  for (let i = 0; i < n; i += 1) {
    const outcome = i % 2 === 0;
    out.push({
      liveP: challengerBetter ? (outcome ? 0.6 : 0.4) : (outcome ? 0.8 : 0.2),
      shadowP: challengerBetter ? (outcome ? 0.8 : 0.2) : (outcome ? 0.4 : 0.6),
      outcome,
      domain: 'markets',
      resolutionKind: 'direct',
      comparedAt: T0 + i,
    });
  }
  return out;
}

function gateDecision(pairs: JoinedPairEvidence[], safety: SafetyReplayEvidence = SAFETY_OK) {
  return evaluatePromotionGate({
    challengerId: 'challenger', incumbentId: 'production',
    pairs, enabledDomains: [], safety, evaluatedAt: T0,
  });
}

describe('first-promotion-decision', () => {
  it('records MONITOR with the exact missing evidence when floors are unmet', () => {
    const record = decideFirstPromotion({
      slot: 'forecast-primary',
      decidedAt: T0,
      challengers: [
        { runId: 'r1', challengerId: 'baseline-a', decision: gateDecision(cohort(14, true)) },
        { runId: 'r2', challengerId: 'baseline-b', decision: gateDecision([]) },
      ],
    });
    assert.equal(record.outcome, 'MONITOR');
    assert.equal(record.promotedChallengerId, undefined);
    const a = record.verdicts.find((v) => v.challengerId === 'baseline-a')!;
    assert.equal(a.verdict, 'MONITOR');
    assert.equal(a.evidenceCount, 14);
    assert.match(a.missingEvidence[0]!, /14 joined resolved pairs \(need ≥ 200\)/);
    assert.deepEqual(a.failingGates, []);
    assert.match(record.summary, /continue monitoring/);
  });

  it('records REJECTED with failing gates when floors are met but quality fails', () => {
    const record = decideFirstPromotion({
      slot: 'forecast-primary',
      decidedAt: T0,
      challengers: [
        { runId: 'r1', challengerId: 'bad-challenger', decision: gateDecision(cohort(240, false)) },
      ],
    });
    assert.equal(record.outcome, 'REJECTED');
    const v = record.verdicts[0]!;
    assert.equal(v.verdict, 'REJECTED');
    assert.ok(v.failingGates.length > 0, 'quality gate details recorded');
    assert.deepEqual(v.missingEvidence, []);
    assert.match(record.summary, /failed quality\/safety gates/);
  });

  it('records PROMOTE with the promoted challenger id when every gate passes', () => {
    const record = decideFirstPromotion({
      slot: 'forecast-primary',
      decidedAt: T0,
      challengers: [
        { runId: 'r1', challengerId: 'weak', decision: gateDecision([]) },
        { runId: 'r2', challengerId: 'strong', decision: gateDecision(cohort(240, true)) },
      ],
    });
    assert.equal(record.outcome, 'PROMOTE');
    assert.equal(record.promotedChallengerId, 'strong');
    assert.match(record.summary, /Promote 'strong'/);
  });

  it('overall precedence: REJECTED beats MONITOR when both present', () => {
    const record = decideFirstPromotion({
      slot: 'forecast-primary',
      decidedAt: T0,
      challengers: [
        { runId: 'r1', challengerId: 'sparse', decision: gateDecision(cohort(10, true)) },
        { runId: 'r2', challengerId: 'bad', decision: gateDecision(cohort(240, false)) },
      ],
    });
    assert.equal(record.outcome, 'REJECTED');
  });

  it('persists and reloads through injected storage; corrupt payload → null', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
    };
    const record = decideFirstPromotion({
      slot: 'forecast-primary', decidedAt: T0,
      challengers: [{ runId: 'r1', challengerId: 'a', decision: gateDecision([]) }],
    });
    persistFirstPromotionDecision(record, storage);
    assert.deepEqual(loadFirstPromotionDecision(storage), record);
    data.set(FIRST_DECISION_STORAGE_KEY, '{broken');
    assert.equal(loadFirstPromotionDecision(storage), null);
  });
});

describe('champion rollback self-test fixture (ACC-404 phase exit)', () => {
  it('setInitial → promote → rollback restores the previous champion on an isolated registry', () => {
    const result = runChampionRollbackSelfTestFixture();
    assert.equal(result.ok, true, result.reason);
    assert.match(result.reason, /rollback restored the previous champion/);
  });
});

describe('safety evidence — no-new-regressions vs the committed baseline', () => {
  it('the live catalog matches its committed baseline → full safety recall despite raw failures', () => {
    const fixtures = buildCatalogReplayFixtures();
    const report = runReplay({ generatedAt: T0, fixtures });
    // Precondition: baseline equality holds (the smoke gate's own check).
    const cmp = compareReplayReportToBaseline(report, replayBaseline as ReplayBaseline);
    assert.equal(cmp.ok, true, cmp.mismatches.join('; '));
    const evidence = safetyEvidenceFromBaselineRegression(report, fixtures, replayBaseline as ReplayBaseline);
    assert.ok(evidence.safetyCriticalTotal > 0, 'catalog carries safety-critical fixtures');
    assert.equal(evidence.safetyCriticalPassed, evidence.safetyCriticalTotal,
      'matching the accepted baseline is not a regression');
  });

  it('a NEW regression (baseline pass → live fail) is caught', () => {
    const fixtures = buildCatalogReplayFixtures();
    const report = runReplay({ generatedAt: T0, fixtures });
    // Forge a baseline that claims every fixture passed — every live fail
    // then reads as a fresh regression.
    const forged: ReplayBaseline = {
      fixtures: Object.fromEntries(report.results.map((r) => [r.fixtureId, 'pass'])),
    };
    const evidence = safetyEvidenceFromBaselineRegression(report, fixtures, forged);
    assert.ok(evidence.safetyCriticalPassed < evidence.safetyCriticalTotal,
      'live failures against a passing baseline count as regressions');
  });

  it('lead-time evidence comes only from passing warning expectations', () => {
    const fixtures = buildCatalogReplayFixtures();
    const report = runReplay({ generatedAt: T0, fixtures });
    const evidence = safetyEvidenceFromBaselineRegression(report, fixtures, replayBaseline as ReplayBaseline);
    if (evidence.minLeadTimeMinutes !== undefined) {
      assert.ok(evidence.minLeadTimeMinutes >= 0,
        'a historical miss’s negative lead never reaches the gate');
    }
  });
});
