/**
 * Tests for src/services/cognition/champion-status-view.ts — ACC-403.
 *
 * Coverage:
 *   1. Active champion + version surfaced; no-champion view is honest.
 *   2. Promotable challenger: status, evidence counts, pass reasons.
 *   3. Rejected challenger: failing-gate reasons verbatim.
 *   4. Insufficient-evidence mapping (min-pairs gates dominate).
 *   5. Metric deltas: Brier + log-loss point deltas match the decision,
 *      CIs are deterministic, ordered, and straddle the point estimate
 *      for a uniform cohort.
 *   6. Empty cohort → no deltas.
 *   7. proxyShare surfaced.
 *   8. Activity history: newest-first, promotion/rollback/initial
 *      summaries, capped.
 *   9. pairedBootstrapInterval determinism + two-sided ordering.
 *  10. logLossImprovementDiffs clamps extreme probabilities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChampionStatusView,
} from '../champion-status-view.js';
import type { ChampionStatusViewInput } from '../champion-status-view.js';
import {
  evaluatePromotionGate,
  pairedBootstrapInterval,
  logLossImprovementDiffs,
  brierImprovementDiffs,
} from '../promotion-gate.js';
import type { SafetyReplayEvidence } from '../promotion-gate.js';
import type { ChampionEntry } from '../champion-registry.js';
import type { JoinedPairEvidence } from '../shadow-rollout.js';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

const SAFETY: SafetyReplayEvidence = {
  safetyCriticalTotal: 4,
  safetyCriticalPassed: 4,
  minLeadTimeMinutes: 12,
};

function cohort(n: number, opts: { challengerBetter?: boolean; proxy?: boolean } = {}): JoinedPairEvidence[] {
  const better = opts.challengerBetter ?? true;
  const out: JoinedPairEvidence[] = [];
  for (let i = 0; i < n; i += 1) {
    const outcome = i % 2 === 0;
    out.push({
      liveP: outcome ? 0.6 : 0.4,
      shadowP: better ? (outcome ? 0.8 : 0.2) : (outcome ? 0.4 : 0.6),
      outcome,
      domain: 'markets',
      resolutionKind: opts.proxy ? 'proxy' : 'direct',
      comparedAt: T0 + i,
    });
  }
  return out;
}

function decisionFor(pairs: JoinedPairEvidence[], safety: SafetyReplayEvidence = SAFETY) {
  return evaluatePromotionGate({
    challengerId: 'challenger-v2',
    incumbentId: 'incumbent-v1',
    pairs,
    enabledDomains: [],
    safety,
    evaluatedAt: T0,
  });
}

function champion(overrides: Partial<ChampionEntry> = {}): ChampionEntry {
  return {
    slot: 'forecast-primary',
    modelId: 'incumbent-v1',
    version: '1.0.0',
    activatedAt: T0,
    reason: 'initial',
    ...overrides,
  };
}

function viewInput(overrides: Partial<ChampionStatusViewInput> = {}): ChampionStatusViewInput {
  const pairs = cohort(240);
  return {
    slot: 'forecast-primary',
    active: champion(),
    history: [champion()],
    challengers: [{
      runId: 'production-vs-persistence-baseline',
      challengerId: 'challenger-v2',
      pairs,
      decision: decisionFor(pairs),
    }],
    ...overrides,
  };
}

describe('champion-status-view', () => {
  it('surfaces the active champion, version, and activation reason', () => {
    const view = buildChampionStatusView(viewInput());
    assert.equal(view.championId, 'incumbent-v1');
    assert.equal(view.championVersion, '1.0.0');
    assert.equal(view.championActivatedAt, T0);
    assert.match(view.championActivationReason!, /Initial champion/);
  });

  it('no-champion view leaves champion fields absent', () => {
    const view = buildChampionStatusView(viewInput({ active: undefined, history: [] }));
    assert.equal(view.championId, undefined);
    assert.equal(view.championVersion, undefined);
    assert.deepEqual(view.recentActivity, []);
  });

  it('a promotable challenger reports status, evidence, and pass reasons', () => {
    const view = buildChampionStatusView(viewInput());
    const row = view.challengers[0]!;
    assert.equal(row.status, 'promotable');
    assert.equal(row.evidenceCount, 240);
    assert.deepEqual(row.perDomainCounts, { markets: 240 });
    assert.equal(row.reasons[0], 'All promotion gates pass.');
    assert.equal(row.reasons.length, 8, 'pass summary + all 7 gate details');
  });

  it('a rejected challenger carries the failing gate details verbatim', () => {
    const pairs = cohort(240, { challengerBetter: false });
    const view = buildChampionStatusView(viewInput({
      challengers: [{
        runId: 'r', challengerId: 'challenger-v2', pairs, decision: decisionFor(pairs),
      }],
    }));
    const row = view.challengers[0]!;
    assert.equal(row.status, 'rejected');
    assert.ok(row.reasons.length > 0);
    assert.ok(row.reasons.every((r) => r.length > 0));
    assert.ok(row.reasons.some((r) => /log loss/.test(r) || /Brier/.test(r) || /bootstrap/.test(r)));
  });

  it('short evidence maps to insufficient-evidence even when quality gates also fail', () => {
    const pairs = cohort(50, { challengerBetter: false });
    const view = buildChampionStatusView(viewInput({
      challengers: [{
        runId: 'r', challengerId: 'challenger-v2', pairs, decision: decisionFor(pairs),
      }],
    }));
    assert.equal(view.challengers[0]!.status, 'insufficient-evidence');
  });

  it('metric deltas match the decision point estimates and carry ordered CIs', () => {
    const view = buildChampionStatusView(viewInput());
    const row = view.challengers[0]!;
    assert.equal(row.deltas.length, 2);
    const brier = row.deltas.find((d) => d.metric === 'brier')!;
    // Incumbent 0.16 − challenger 0.04 = 0.12 improvement.
    assert.ok(Math.abs(brier.delta - 0.12) < 1e-9);
    assert.ok(brier.ciLow <= brier.delta + 1e-9 && brier.delta <= brier.ciHigh + 1e-9, 'CI straddles the point estimate');
    assert.equal(brier.better, true, 'uniformly-better cohort clears zero');
    const ll = row.deltas.find((d) => d.metric === 'log-loss')!;
    assert.ok(ll.delta > 0);
    assert.ok(ll.ciLow <= ll.ciHigh);
    assert.match(brier.explanation, /90% CI/);
  });

  it('deltas are deterministic across rebuilds', () => {
    const a = buildChampionStatusView(viewInput()).challengers[0]!.deltas;
    const b = buildChampionStatusView(viewInput()).challengers[0]!.deltas;
    assert.deepEqual(a, b);
  });

  it('an empty cohort produces no deltas', () => {
    const view = buildChampionStatusView(viewInput({
      challengers: [{
        runId: 'r', challengerId: 'challenger-v2', pairs: [], decision: decisionFor([]),
      }],
    }));
    assert.deepEqual(view.challengers[0]!.deltas, []);
    assert.equal(view.challengers[0]!.evidenceCount, 0);
  });

  it('proxy share is surfaced on the row', () => {
    const pairs = cohort(240, { proxy: true });
    const view = buildChampionStatusView(viewInput({
      challengers: [{
        runId: 'r', challengerId: 'challenger-v2', pairs, decision: decisionFor(pairs),
      }],
    }));
    assert.equal(view.challengers[0]!.proxyShare, 1);
    assert.equal(view.challengers[0]!.status, 'rejected', 'proxy-only block is a rejection, not missing evidence');
  });

  it('recent activity is newest-first with promotion and rollback summaries, capped at 6', () => {
    const history: ChampionEntry[] = [champion()];
    for (let i = 0; i < 8; i += 1) {
      history.push(champion({
        modelId: `model-${i}`,
        activatedAt: T0 + (i + 1) * 1000,
        reason: 'promotion',
        decision: decisionFor(cohort(240)),
      }));
    }
    history.push(champion({ modelId: 'model-6', activatedAt: T0 + 10_000, reason: 'rollback', version: undefined }));
    const view = buildChampionStatusView(viewInput({ history }));
    assert.equal(view.recentActivity.length, 6, 'capped');
    assert.equal(view.recentActivity[0]!.kind, 'rollback');
    assert.match(view.recentActivity[0]!.summary, /Rolled back to 'model-6'/);
    assert.match(view.recentActivity[1]!.summary, /Promoted 'model-7'.*240 joined pairs/);
    assert.ok(view.recentActivity[0]!.at >= view.recentActivity[1]!.at, 'newest first');
  });
});

describe('promotion-gate — ACC-403 bootstrap additions', () => {
  it('pairedBootstrapInterval is deterministic and ordered', () => {
    const diffs = brierImprovementDiffs(cohort(240));
    const a = pairedBootstrapInterval(diffs, 500, 0.9, 7);
    const b = pairedBootstrapInterval(diffs, 500, 0.9, 7);
    assert.deepEqual(a, b);
    assert.ok(a.low <= a.high);
    // Uniformly-better cohort: whole interval above zero.
    assert.ok(a.low > 0);
  });

  it('a mixed cohort yields an interval spanning zero', () => {
    // Swap live/shadow on alternating PAIRS of pairs so the worse half
    // is balanced across both outcomes — mean improvement exactly 0.
    const pairs = cohort(240).map((e, i) =>
      Math.floor(i / 2) % 2 === 0 ? e : { ...e, liveP: e.shadowP, shadowP: e.liveP },
    );
    const { low, high } = pairedBootstrapInterval(brierImprovementDiffs(pairs), 500, 0.9, 7);
    assert.ok(low < 0 && high > 0, `expected straddle, got [${low}, ${high}]`);
  });

  it('logLossImprovementDiffs clamps extreme probabilities to finite values', () => {
    const pairs: JoinedPairEvidence[] = [{
      liveP: 1, shadowP: 0, outcome: true, domain: 'markets', resolutionKind: 'direct', comparedAt: T0,
    }];
    const [diff] = logLossImprovementDiffs(pairs);
    assert.ok(Number.isFinite(diff), 'clamped, never ±Infinity');
    // Incumbent clamped near-certain-right, challenger clamped
    // certain-wrong on a true outcome → strongly negative improvement.
    assert.ok(diff! < -10);
  });
});
