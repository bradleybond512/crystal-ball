/**
 * Tests for src/services/cognition/promotion-gate.ts — ACC-402.
 *
 * Coverage:
 *   1. All-green cohort → 'promote' with every gate explained.
 *   2. min-pairs-overall — 199 pairs hold.
 *   3. min-pairs-per-domain — one under-evidenced enabled domain holds.
 *   4. brier-skill — a challenger no better than the base rate holds.
 *   5. log-loss — tail-confidence regression holds even when Brier improves.
 *   6. bootstrap-floor — noisy, non-robust improvement holds; determinism
 *      (same seed → identical bound; different seed → same verdict shape).
 *   7. safety-replay — zero fixtures fails closed; failing recall holds;
 *      lead-time floor enforced.
 *   8. direct-outcomes — proxy-only cohort can never promote.
 *   9. safetyEvidenceFromReplayReport distills the harness report.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePromotionGate,
  pairedBootstrapLowerBound,
  safetyEvidenceFromReplayReport,
  DEFAULT_PROMOTION_THRESHOLDS,
} from '../promotion-gate.js';
import type { PromotionGateInput, SafetyReplayEvidence } from '../promotion-gate.js';
import type { JoinedPairEvidence } from '../shadow-rollout.js';
import { runReplay } from '../../ops/replay-harness.js';
import type { ReplayFixture } from '../../ops/replay-fixtures.js';
import type { MissionRecord } from '../../ops/mission-types.js';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

function pair(overrides: Partial<JoinedPairEvidence> = {}): JoinedPairEvidence {
  return {
    liveP: 0.6,
    shadowP: 0.8,
    outcome: true,
    domain: 'markets',
    resolutionKind: 'direct',
    comparedAt: T0,
    ...overrides,
  };
}

/** A cohort where the challenger (shadowP) is systematically sharper
 *  than the incumbent (liveP): challenger says 0.8 on true outcomes and
 *  0.2 on false ones; incumbent says 0.6/0.4. Half of each domain true. */
function strongCohort(perDomain: number, domains: readonly string[]): JoinedPairEvidence[] {
  const out: JoinedPairEvidence[] = [];
  for (const domain of domains) {
    for (let i = 0; i < perDomain; i += 1) {
      const outcome = i % 2 === 0;
      out.push(pair({
        domain,
        outcome,
        liveP: outcome ? 0.6 : 0.4,
        shadowP: outcome ? 0.8 : 0.2,
        comparedAt: T0 + i,
      }));
    }
  }
  return out;
}

const PASSING_SAFETY: SafetyReplayEvidence = {
  safetyCriticalTotal: 4,
  safetyCriticalPassed: 4,
  minLeadTimeMinutes: 12,
};

function baseInput(overrides: Partial<PromotionGateInput> = {}): PromotionGateInput {
  return {
    challengerId: 'challenger-v2',
    incumbentId: 'incumbent-v1',
    pairs: strongCohort(120, ['markets', 'weather']),
    enabledDomains: ['markets', 'weather'],
    safety: PASSING_SAFETY,
    evaluatedAt: T0,
    ...overrides,
  };
}

describe('promotion-gate — decision', () => {
  it('all-green cohort promotes with every gate passing and explained', () => {
    const decision = evaluatePromotionGate(baseInput());
    assert.equal(decision.recommendation, 'promote');
    assert.equal(decision.gates.length, 7);
    for (const g of decision.gates) {
      assert.equal(g.pass, true, `gate ${g.id} should pass: ${g.detail}`);
      assert.ok(g.detail.length > 0, `gate ${g.id} carries an explanation`);
    }
    assert.equal(decision.pairCount, 240);
    assert.deepEqual(decision.perDomainCounts, { markets: 120, weather: 120 });
    // Challenger 0.8/0.2 on a half-true cohort → Brier 0.04; incumbent 0.6/0.4 → 0.16.
    assert.ok(Math.abs(decision.brierChallenger! - 0.04) < 1e-9);
    assert.ok(Math.abs(decision.brierIncumbent! - 0.16) < 1e-9);
    // Base rate 0.5 → Brier 0.25.
    assert.ok(Math.abs(decision.brierBaseRate! - 0.25) < 1e-9);
    assert.equal(decision.proxyShare, 0);
    assert.equal(decision.evaluatedAt, T0);
  });

  it('holds at 199 pairs even when every quality gate would pass', () => {
    const pairs = strongCohort(120, ['markets', 'weather']).slice(0, 199);
    const decision = evaluatePromotionGate(baseInput({ pairs, enabledDomains: [] }));
    assert.equal(decision.recommendation, 'hold');
    const gate = decision.gates.find((g) => g.id === 'min-pairs-overall')!;
    assert.equal(gate.pass, false);
    assert.equal(gate.value, 199);
    assert.equal(gate.threshold, 200);
  });

  it('holds when one enabled domain is under-evidenced and names it', () => {
    const pairs = [
      ...strongCohort(150, ['markets']),
      ...strongCohort(99, ['weather']),
    ];
    const decision = evaluatePromotionGate(baseInput({ pairs }));
    assert.equal(decision.recommendation, 'hold');
    const gate = decision.gates.find((g) => g.id === 'min-pairs-per-domain')!;
    assert.equal(gate.pass, false);
    assert.match(gate.detail, /weather \(99\/100\)/);
  });

  it('per-domain gate is inapplicable-pass when no enabled domains are declared', () => {
    const decision = evaluatePromotionGate(baseInput({ enabledDomains: [] }));
    const gate = decision.gates.find((g) => g.id === 'min-pairs-per-domain')!;
    assert.equal(gate.pass, true);
    assert.match(gate.detail, /not applicable/);
  });

  it('holds when the challenger has no skill over the base-rate forecaster', () => {
    // Challenger always says 0.5 on a half-true cohort → Brier 0.25 ==
    // base-rate Brier 0.25: NOT strictly better, no skill.
    const pairs = strongCohort(120, ['markets', 'weather']).map((e) => ({ ...e, shadowP: 0.5 }));
    const decision = evaluatePromotionGate(baseInput({ pairs }));
    assert.equal(decision.recommendation, 'hold');
    const gate = decision.gates.find((g) => g.id === 'brier-skill')!;
    assert.equal(gate.pass, false);
  });

  it('holds on log-loss regression even when Brier improves', () => {
    // Challenger is sharper on most pairs but catastrophically
    // overconfident (p≈0) on 10 true outcomes: Brier still beats the
    // base rate (0.08 < 0.25), log loss explodes past the incumbent's
    // (each clamped pair costs -ln(1e-6) ≈ 13.8 nats).
    const pairs = strongCohort(120, ['markets', 'weather']).map((e, i) =>
      i < 20 && e.outcome ? { ...e, shadowP: 1e-9 } : e,
    );
    const decision = evaluatePromotionGate(baseInput({ pairs }));
    const brierGate = decision.gates.find((g) => g.id === 'brier-skill')!;
    const llGate = decision.gates.find((g) => g.id === 'log-loss')!;
    assert.equal(brierGate.pass, true, 'Brier still beats the base rate');
    assert.equal(llGate.pass, false, 'log loss catches the tail-confidence regression');
    assert.equal(decision.recommendation, 'hold');
  });

  it('bootstrap floor holds a noisy non-robust improvement', () => {
    // Challenger better on exactly half the pairs and worse on the other
    // half by the same margin — mean improvement 0, lower bound < 0.
    const pairs = strongCohort(120, ['markets', 'weather']).map((e, i) =>
      i % 2 === 0
        ? e
        : { ...e, shadowP: e.outcome ? 0.4 : 0.6, liveP: e.outcome ? 0.8 : 0.2 },
    );
    const decision = evaluatePromotionGate(baseInput({ pairs }));
    const gate = decision.gates.find((g) => g.id === 'bootstrap-floor')!;
    assert.equal(gate.pass, false);
    assert.ok(decision.bootstrapLowerBound! < 0);
    assert.equal(decision.recommendation, 'hold');
  });

  it('bootstrap is deterministic: same seed → identical lower bound', () => {
    const pairs = strongCohort(120, ['markets', 'weather']);
    const a = pairedBootstrapLowerBound(pairs, 500, 0.95, 42);
    const b = pairedBootstrapLowerBound(pairs, 500, 0.95, 42);
    const c = pairedBootstrapLowerBound(pairs, 500, 0.95, 43);
    assert.equal(a, b, 'same seed reproduces exactly');
    // A uniformly-better cohort keeps a positive bound under any seed.
    assert.ok(a > 0);
    assert.ok(c > 0);
  });

  it('fails closed when zero safety-critical replay expectations ran', () => {
    const decision = evaluatePromotionGate(baseInput({
      safety: { safetyCriticalTotal: 0, safetyCriticalPassed: 0 },
    }));
    const gate = decision.gates.find((g) => g.id === 'safety-replay')!;
    assert.equal(gate.pass, false);
    assert.match(gate.detail, /fails closed/);
    assert.equal(decision.recommendation, 'hold');
  });

  it('holds on a safety replay recall miss', () => {
    const decision = evaluatePromotionGate(baseInput({
      safety: { safetyCriticalTotal: 4, safetyCriticalPassed: 3, minLeadTimeMinutes: 12 },
    }));
    const gate = decision.gates.find((g) => g.id === 'safety-replay')!;
    assert.equal(gate.pass, false);
    assert.match(gate.detail, /3\/4/);
  });

  it('enforces the lead-time floor and fails closed when no lead-time exists', () => {
    const short = evaluatePromotionGate(baseInput({
      safety: { safetyCriticalTotal: 4, safetyCriticalPassed: 4, minLeadTimeMinutes: 2 },
      thresholds: { minLeadTimeMinutes: 5 },
    }));
    assert.equal(short.gates.find((g) => g.id === 'safety-replay')!.pass, false);

    const missing = evaluatePromotionGate(baseInput({
      safety: { safetyCriticalTotal: 4, safetyCriticalPassed: 4 },
      thresholds: { minLeadTimeMinutes: 5 },
    }));
    const gate = missing.gates.find((g) => g.id === 'safety-replay')!;
    assert.equal(gate.pass, false);
    assert.match(gate.detail, /fails closed/);
  });

  it('a proxy-only cohort can never promote', () => {
    const pairs = strongCohort(120, ['markets', 'weather'])
      .map((e) => ({ ...e, resolutionKind: 'proxy' as const }));
    const decision = evaluatePromotionGate(baseInput({ pairs }));
    const gate = decision.gates.find((g) => g.id === 'direct-outcomes')!;
    assert.equal(gate.pass, false);
    assert.equal(decision.proxyShare, 1);
    assert.equal(decision.recommendation, 'hold');
    // Every other quality gate passes — the proxy block alone must hold it.
    const others = decision.gates.filter((g) => g.id !== 'direct-outcomes');
    assert.ok(others.every((g) => g.pass), 'proxy-only is the sole failing gate');
  });

  it('an empty cohort fails closed on every evidence gate', () => {
    const decision = evaluatePromotionGate(baseInput({ pairs: [] }));
    assert.equal(decision.recommendation, 'hold');
    for (const id of ['min-pairs-overall', 'brier-skill', 'log-loss', 'bootstrap-floor', 'direct-outcomes'] as const) {
      assert.equal(decision.gates.find((g) => g.id === id)!.pass, false, `${id} fails closed`);
    }
    assert.equal(decision.brierChallenger, undefined);
  });

  it('default thresholds match the roadmap deliverable', () => {
    assert.equal(DEFAULT_PROMOTION_THRESHOLDS.minPairsOverall, 200);
    assert.equal(DEFAULT_PROMOTION_THRESHOLDS.minPairsPerDomain, 100);
    assert.equal(DEFAULT_PROMOTION_THRESHOLDS.noRegressionFloor, 0);
    assert.equal(DEFAULT_PROMOTION_THRESHOLDS.minSafetyRecall, 1);
  });
});

describe('promotion-gate — safety replay adapter', () => {
  function mission(events: { kind: string; at: number }[]): MissionRecord {
    return {
      id: 'm1',
      domain: 'weather',
      title: 'test mission',
      openedAt: T0,
      status: 'closed',
      events: events.map((e, i) => ({
        id: `e${i}`,
        kind: e.kind,
        at: e.at,
        note: '',
      })),
    } as unknown as MissionRecord;
  }

  function fixture(events: { kind: string; at: number }[], minLeadTimeMs: number): ReplayFixture {
    return {
      schemaVersion: 1,
      fixtureId: 'fx1',
      generatedAt: T0,
      mission: mission(events),
      rationale: 'test',
      pivots: {},
      expectations: [
        {
          id: 'warn-before',
          description: 'warn before impact',
          check: { kind: 'warning_before_impact', minLeadTimeMs },
        },
        {
          id: 'user-acted',
          description: 'user acted',
          check: { kind: 'user_action_observed' },
        },
      ],
    };
  }

  it('counts only safety-critical kinds and extracts the worst lead-time', () => {
    const fx = fixture(
      [
        { kind: 'user_notified', at: T0 },
        { kind: 'actual_impact', at: T0 + 10 * 60_000 },
      ],
      5 * 60_000,
    );
    const report = runReplay({ generatedAt: T0, fixtures: [fx] });
    const evidence = safetyEvidenceFromReplayReport(report, [fx]);
    assert.equal(evidence.safetyCriticalTotal, 1, 'user_action_observed is not safety-critical');
    assert.equal(evidence.safetyCriticalPassed, 1);
    assert.ok(Math.abs(evidence.minLeadTimeMinutes! - 10) < 1e-9);
  });

  it('a missed warning shows up as a failed safety expectation', () => {
    const fx = fixture([{ kind: 'actual_impact', at: T0 }], 5 * 60_000);
    const report = runReplay({ generatedAt: T0, fixtures: [fx] });
    const evidence = safetyEvidenceFromReplayReport(report, [fx]);
    assert.equal(evidence.safetyCriticalTotal, 1);
    assert.equal(evidence.safetyCriticalPassed, 0);
  });
});
