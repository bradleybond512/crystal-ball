/**
 * Tests for src/services/cognition/evoi-planner.ts — PR 9 (EVOI Collection Planner)
 *
 * Coverage (plan-mandated):
 *   - Entropy math: H(0.5) = 1 bit; H(0) = H(1) = 0 bits.
 *   - Bayesian update correctness with hand-verified LR fixtures.
 *   - Expected info gain: ordering (higher-diagnostic check scores more); known
 *     posterior fixtures hand-verified; p extremes (≈0/≈1 yield ≈0 gain).
 *   - planCollection: top-5 cap; correct sort order; all three candidate source
 *     types (missing signals, provider issues, collection gaps) produce actions.
 *   - Effort labeling: missing-feed gap → 'task'; single-source → 'glance';
 *     provider disagreement → 'minutes'.
 *   - Explanation content: each action's explanation mentions the specific
 *     signal/domain and includes before/after probabilities.
 *   - Injectable context: no DOM, no IDB, no singletons.
 *   - buildEvoiContext adapter: filters to informative verdicts only.
 *
 * All tests use static fixtures. No live fetch, no DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  binaryEntropy,
  bayesianUpdate,
  expectedInfoGain,
  planCollection,
  buildEvoiContext,
  LR_MISSING_SIGNAL_POSITIVE,
  LR_MISSING_SIGNAL_NEGATIVE,
  LR_PROVIDER_DISAGREE_POSITIVE,
  LR_PROVIDER_DISAGREE_NEGATIVE,
  LR_GAP_HIGH_SEVERITY_POSITIVE,
  LR_GAP_HIGH_SEVERITY_NEGATIVE,
} from '../evoi-planner.js';
import type { EvoiContext, CollectionAction } from '../evoi-planner.js';
import type { MissingSignal, PendingSignal } from '../../intelligence/negative-evidence.js';
import type { DomainRedundancy } from '../../diagnostics/provider-redundancy.js';
import type { CollectionGap } from '../../intelligence/collection-gap-discovery.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMissingSignal(label: string, domain = 'markets'): MissingSignal {
  return {
    signal: {
      id: `sig-${label}`,
      label,
      domain: domain as import('../../intelligence/types.js').FactDomain,
      windowStartMs: 0,
      windowEndMs: 3 * 24 * 60 * 60 * 1000,
      absencePenalty: 0.1,
    },
    appliedPenalty: 0.1,
  };
}

function makePendingSignal(label: string, msRemaining = 3_600_000): PendingSignal {
  return {
    signal: {
      id: `pending-${label}`,
      label,
      domain: 'weather' as import('../../intelligence/types.js').FactDomain,
      windowStartMs: 0,
      windowEndMs: 6 * 3_600_000,
      absencePenalty: 0.1,
    },
    msUntilWindowEnd: msRemaining,
  };
}

function makeDisagreement(domain: string): DomainRedundancy {
  return {
    domain,
    verdict: 'redundant_disagreement',
    confidenceMultiplier: 0.6,
    reason: '2 providers up but different fingerprints',
    remediation: `${domain}: open diagnostics to compare fingerprints`,
    providers: [],
  };
}

function makeSingleSource(domain: string): DomainRedundancy {
  return {
    domain,
    verdict: 'single_source',
    confidenceMultiplier: 0.7,
    reason: 'Only one provider configured',
    remediation: `${domain}: configure a backup`,
    providers: [],
  };
}

function makeGap(domain: string, gapType: CollectionGap['gapType'], severity: CollectionGap['severity']): CollectionGap {
  return {
    id: `gap-${domain}-${gapType}`,
    domain,
    gapType,
    description: `${domain} gap: ${gapType}`,
    severity,
    discoveredAt: Date.now() - 3_600_000,
  };
}

const HYPOTHESIS_LIKE = {
  kind: 'cross-domain-cluster' as const,
  statement: 'Refinery outage may cause fuel shortage',
};

// ── Entropy tests ─────────────────────────────────────────────────────────────

describe('binaryEntropy', () => {
  it('H(0.5) = 1 bit (maximum uncertainty)', () => {
    const h = binaryEntropy(0.5);
    assert.ok(Math.abs(h - 1.0) < 1e-9, `Expected 1.0, got ${h}`);
  });

  it('H(0) = 0 bits (no uncertainty)', () => {
    assert.strictEqual(binaryEntropy(0), 0);
  });

  it('H(1) = 0 bits (no uncertainty)', () => {
    assert.strictEqual(binaryEntropy(1), 0);
  });

  it('H(0.25) ≈ 0.811 bits (hand-verified)', () => {
    // H(0.25) = −0.25·log2(0.25) − 0.75·log2(0.75)
    //         = −0.25·(−2) − 0.75·(−0.415)
    //         = 0.5 + 0.311 = 0.811
    const expected = -0.25 * Math.log2(0.25) - 0.75 * Math.log2(0.75);
    const actual = binaryEntropy(0.25);
    assert.ok(Math.abs(actual - expected) < 1e-12, `Got ${actual}`);
  });

  it('H is symmetric: H(p) = H(1-p)', () => {
    for (const p of [0.1, 0.2, 0.3, 0.7]) {
      assert.ok(Math.abs(binaryEntropy(p) - binaryEntropy(1 - p)) < 1e-12);
    }
  });

  it('H is monotone increasing from 0 to 0.5', () => {
    const vals = [0.01, 0.1, 0.2, 0.3, 0.4, 0.5].map(binaryEntropy);
    for (let i = 1; i < vals.length; i++) {
      assert.ok((vals[i] ?? 0) > (vals[i - 1] ?? 0), `Not monotone at index ${i}`);
    }
  });
});

// ── Bayesian update tests ─────────────────────────────────────────────────────

describe('bayesianUpdate', () => {
  it('LR=1 leaves probability unchanged', () => {
    // No diagnostic value: posterior = prior
    const p = 0.4;
    const updated = bayesianUpdate(p, 1);
    assert.ok(Math.abs(updated - p) < 0.001, `Got ${updated}`);
  });

  it('Strong positive LR raises probability (p=0.5, LR=4)', () => {
    // odds_prior = 1, odds_posterior = 4
    // p_posterior = 4/5 = 0.8
    const updated = bayesianUpdate(0.5, 4);
    assert.ok(Math.abs(updated - 0.8) < 0.001, `Got ${updated}`);
  });

  it('LR < 1 reduces probability (p=0.5, LR=0.5)', () => {
    // odds_prior = 1, odds_posterior = 0.5
    // p_posterior = 0.5/1.5 ≈ 0.333
    const updated = bayesianUpdate(0.5, 0.5);
    assert.ok(Math.abs(updated - (1 / 3)) < 0.001, `Got ${updated}`);
  });

  it('p=0.8, LR=3 → correct hand-computed result', () => {
    // odds_prior = 0.8/0.2 = 4
    // odds_posterior = 4 × 3 = 12
    // p_posterior = 12/13 ≈ 0.923
    const updated = bayesianUpdate(0.8, 3);
    assert.ok(Math.abs(updated - 12 / 13) < 0.001, `Got ${updated}`);
  });

  it('output is clamped to [0.01, 0.99]', () => {
    // Very high LR on near-certain hypothesis should not reach 1.0
    const updated = bayesianUpdate(0.99, 1000);
    assert.ok(updated <= 0.99, `Got ${updated}`);
    const reduced = bayesianUpdate(0.01, 0.0001);
    assert.ok(reduced >= 0.01, `Got ${reduced}`);
  });
});

// ── Expected info gain tests ──────────────────────────────────────────────────

describe('expectedInfoGain', () => {
  it('p extremes (≈0) yield ≈0 gain — nothing uncertain to resolve', () => {
    const gain = expectedInfoGain(0.01, LR_MISSING_SIGNAL_POSITIVE, LR_MISSING_SIGNAL_NEGATIVE);
    assert.ok(gain < 0.05, `Expected near-zero gain at p≈0, got ${gain}`);
  });

  it('p extremes (≈1) yield ≈0 gain — nothing uncertain to resolve', () => {
    const gain = expectedInfoGain(0.99, LR_MISSING_SIGNAL_POSITIVE, LR_MISSING_SIGNAL_NEGATIVE);
    assert.ok(gain < 0.05, `Expected near-zero gain at p≈1, got ${gain}`);
  });

  it('p=0.5 yields maximum gain for any given LR pair', () => {
    // Maximum entropy at 0.5 means maximum possible reduction.
    const gainMid = expectedInfoGain(0.5, LR_PROVIDER_DISAGREE_POSITIVE, LR_PROVIDER_DISAGREE_NEGATIVE);
    const gainLow = expectedInfoGain(0.1, LR_PROVIDER_DISAGREE_POSITIVE, LR_PROVIDER_DISAGREE_NEGATIVE);
    const gainHigh = expectedInfoGain(0.9, LR_PROVIDER_DISAGREE_POSITIVE, LR_PROVIDER_DISAGREE_NEGATIVE);
    assert.ok(gainMid > gainLow, `p=0.5 should beat p=0.1 (${gainMid} vs ${gainLow})`);
    assert.ok(gainMid > gainHigh, `p=0.5 should beat p=0.9 (${gainMid} vs ${gainHigh})`);
  });

  it('gain is always >= 0', () => {
    for (const p of [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const gain = expectedInfoGain(p, LR_MISSING_SIGNAL_POSITIVE, LR_MISSING_SIGNAL_NEGATIVE);
      assert.ok(gain >= 0, `Negative gain at p=${p}: ${gain}`);
    }
  });

  it('higher-diagnostic LR pair yields more gain than lower-diagnostic pair', () => {
    const p = 0.5;
    // High-diagnostic: LR+ = 10, LR- = 0.1
    const highGain = expectedInfoGain(p, 10, 0.1);
    // Low-diagnostic: LR+ = 1.2, LR- = 0.9
    const lowGain = expectedInfoGain(p, 1.2, 0.9);
    assert.ok(highGain > lowGain, `High-diagnostic should beat low-diagnostic (${highGain} vs ${lowGain})`);
  });

  it('degenerate LR+=LR- case returns 0 (non-diagnostic check)', () => {
    const gain = expectedInfoGain(0.5, 2.0, 2.0);
    assert.strictEqual(gain, 0);
  });

  it('hand-verified: p=0.5, LR+=4, LR-=0.6', () => {
    // Compute manually:
    // lrDiff = 4 - 0.6 = 3.4
    // pPosGivenFalse = (1 - 0.6) / 3.4 = 0.4/3.4 ≈ 0.1176
    // pPosGivenTrue = 4 × 0.1176 ≈ 0.4706
    // pPos = 0.5 × 0.4706 + 0.5 × 0.1176 = 0.2941
    // pNeg = 0.7059
    // p|+ = Bayes(0.5, 4): odds=1, odds_post=4, p|+ = 4/5 = 0.8
    // p|- = Bayes(0.5, 0.6): odds_post=0.6, p|- = 0.6/1.6 = 0.375
    // H(0.5) = 1.0
    // H(0.8) = -0.8log2(0.8) - 0.2log2(0.2) ≈ 0.7219
    // H(0.375) = -0.375log2(0.375) - 0.625log2(0.625) ≈ 0.9544
    // E[H] = 0.2941×0.7219 + 0.7059×0.9544 ≈ 0.2123 + 0.6738 = 0.8861
    // gain ≈ 1.0 - 0.8861 = 0.1139
    const gain = expectedInfoGain(0.5, 4, 0.6);
    // Allow ±0.005 for floating-point precision.
    assert.ok(Math.abs(gain - 0.1139) < 0.005, `Hand-verified: expected ~0.114, got ${gain}`);
  });

  it('high-severity gap LRs yield more gain than low-severity gap LRs at p=0.5', () => {
    const highGain = expectedInfoGain(0.5, LR_GAP_HIGH_SEVERITY_POSITIVE, LR_GAP_HIGH_SEVERITY_NEGATIVE);
    const lowGain = expectedInfoGain(0.5, 1.5, 0.8);
    assert.ok(highGain > lowGain, `high severity should yield more gain (${highGain} vs ${lowGain})`);
  });
});

// ── planCollection tests ──────────────────────────────────────────────────────

describe('planCollection — basic', () => {
  it('returns empty array when context has no candidates', () => {
    const ctx: EvoiContext = { hypothesisProbability: 0.5 };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.strictEqual(actions.length, 0);
  });

  it('returns at most 5 actions (top-5 cap)', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      missingSignals: [
        makeMissingSignal('signal-a'),
        makeMissingSignal('signal-b'),
        makeMissingSignal('signal-c'),
      ],
      providerIssues: [
        makeDisagreement('weather'),
        makeSingleSource('maritime'),
      ],
      collectionGaps: [
        makeGap('cyber', 'stale-data', 'high'),
        makeGap('health', 'missing-feed', 'high'),
        makeGap('financial', 'no-alerts', 'high'),
      ],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length <= 5, `Expected ≤5 actions, got ${actions.length}`);
  });

  it('actions are sorted descending by expectedInfoGainBits', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      missingSignals: [makeMissingSignal('low-gain-signal')],
      providerIssues: [makeDisagreement('weather')], // higher LR → more gain
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    for (let i = 1; i < actions.length; i++) {
      const prev = actions[i - 1]!;
      const curr = actions[i]!;
      assert.ok(
        prev.expectedInfoGainBits >= curr.expectedInfoGainBits,
        `Order violation at index ${i}: ${prev.expectedInfoGainBits} < ${curr.expectedInfoGainBits}`,
      );
    }
  });

  it('expectedInfoGainBits is >= 0 for all actions', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      missingSignals: [makeMissingSignal('crack spread')],
      providerIssues: [makeDisagreement('weather')],
      collectionGaps: [makeGap('seismic', 'single-source', 'medium')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    for (const action of actions) {
      assert.ok(action.expectedInfoGainBits >= 0, `Negative gain: ${action.expectedInfoGainBits}`);
    }
  });
});

describe('planCollection — candidate source types', () => {
  it('produces actions from missing signals', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.62,
      missingSignals: [makeMissingSignal('crack spread widening')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0, 'Expected at least one action from missing signal');
    const a = actions[0]!;
    assert.ok(a.label.includes('crack spread widening'), `Label: ${a.label}`);
  });

  it('produces actions from pending signals', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      pendingSignals: [makePendingSignal('spotter confirmation', 60 * 60 * 1000)],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0, 'Expected action from pending signal');
    assert.ok(actions[0]!.label.includes('spotter confirmation'));
  });

  it('produces actions from provider disagreements', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      providerIssues: [makeDisagreement('weather')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0, 'Expected action from provider disagreement');
    const a = actions[0]!;
    assert.ok(a.label.toLowerCase().includes('weather'), `Label: ${a.label}`);
    assert.strictEqual(a.panelId, 'system-diagnostic');
  });

  it('produces actions from collection gaps', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      collectionGaps: [makeGap('cyber', 'stale-data', 'high')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0, 'Expected action from collection gap');
    const a = actions[0]!;
    assert.ok(a.label.toLowerCase().includes('cyber'), `Label: ${a.label}`);
  });
});

describe('planCollection — p extremes', () => {
  it('p≈0 produces near-zero or zero info gain actions', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.01,
      missingSignals: [makeMissingSignal('crack spread')],
      providerIssues: [makeDisagreement('weather')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    for (const a of actions) {
      assert.ok(a.expectedInfoGainBits < 0.1, `Unexpectedly high gain at p≈0: ${a.expectedInfoGainBits}`);
    }
  });

  it('p≈1 produces near-zero or zero info gain actions', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.99,
      missingSignals: [makeMissingSignal('crack spread')],
      providerIssues: [makeDisagreement('weather')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    for (const a of actions) {
      assert.ok(a.expectedInfoGainBits < 0.1, `Unexpectedly high gain at p≈1: ${a.expectedInfoGainBits}`);
    }
  });
});

describe('planCollection — effort labeling', () => {
  it('missing-feed gap → effort: task', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      collectionGaps: [makeGap('health', 'missing-feed', 'high')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    assert.strictEqual(actions[0]!.effort, 'task');
  });

  it('single-source provider → effort: glance', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      providerIssues: [makeSingleSource('aviation')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    assert.strictEqual(actions[0]!.effort, 'glance');
  });

  it('provider disagreement → effort: minutes', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      providerIssues: [makeDisagreement('maritime')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    assert.strictEqual(actions[0]!.effort, 'minutes');
  });

  it('missing signal → effort: glance', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      missingSignals: [makeMissingSignal('crack spread')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    assert.strictEqual(actions[0]!.effort, 'glance');
  });

  it('stale-data gap → effort: task', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      collectionGaps: [makeGap('geopolitical', 'stale-data', 'medium')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    assert.strictEqual(actions[0]!.effort, 'task');
  });
});

describe('planCollection — explanation content', () => {
  it('missing signal explanation contains label and before/after probabilities', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.62,
      missingSignals: [makeMissingSignal('crack spread widening')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    const expl = actions[0]!.explanation;
    assert.ok(expl.includes('crack spread widening'), `Missing signal label in explanation: ${expl}`);
    assert.ok(expl.includes('%'), `Expected percentage in explanation: ${expl}`);
    // Should mention both before and after probabilities.
    const percentMatches = expl.match(/\d+%/g) ?? [];
    assert.ok(percentMatches.length >= 2, `Expected ≥2 percentages in explanation: ${expl}`);
  });

  it('provider disagreement explanation references domain and probabilities', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      providerIssues: [makeDisagreement('weather')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    const expl = actions[0]!.explanation;
    assert.ok(expl.toLowerCase().includes('weather'), `Domain in explanation: ${expl}`);
    assert.ok(expl.includes('disagree'), `Disagreement mentioned: ${expl}`);
    const percentMatches = expl.match(/\d+%/g) ?? [];
    assert.ok(percentMatches.length >= 2, `Expected ≥2 percentages in explanation: ${expl}`);
  });

  it('collection gap explanation references domain, gap type, and probabilities', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      collectionGaps: [makeGap('cyber', 'stale-data', 'high')],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    const expl = actions[0]!.explanation;
    assert.ok(expl.includes('cyber'), `Domain in explanation: ${expl}`);
    assert.ok(expl.includes('stale-data'), `Gap type in explanation: ${expl}`);
    const percentMatches = expl.match(/\d+%/g) ?? [];
    assert.ok(percentMatches.length >= 2, `Expected ≥2 percentages in explanation: ${expl}`);
  });

  it('pending signal explanation mentions time remaining', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      pendingSignals: [makePendingSignal('spotter report', 90 * 60_000)],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length > 0);
    const expl = actions[0]!.explanation;
    assert.ok(expl.includes('min remaining'), `Expected minutes remaining in explanation: ${expl}`);
  });
});

describe('planCollection — likelihood ratio ordering', () => {
  it('provider disagreement (LR+=3) scores higher than single-source (LR+=2) at p=0.5', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      providerIssues: [
        makeSingleSource('aviation'),
        makeDisagreement('weather'),
      ],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length >= 2);
    // Disagreement has higher LR+ (3.0 vs 2.0) → should appear first
    assert.ok(
      actions[0]!.expectedInfoGainBits >= actions[1]!.expectedInfoGainBits,
      `Sort order wrong: ${actions[0]!.expectedInfoGainBits} < ${actions[1]!.expectedInfoGainBits}`,
    );
    // The disagreement action has a higher LR so it should score better.
    const disagreeAction = actions.find(a => a.label.toLowerCase().includes('resolve'));
    const singleAction = actions.find(a => a.label.toLowerCase().includes('cross-check'));
    if (disagreeAction && singleAction) {
      assert.ok(
        disagreeAction.expectedInfoGainBits >= singleAction.expectedInfoGainBits,
        `Disagreement (${disagreeAction.expectedInfoGainBits}) should beat single-source (${singleAction.expectedInfoGainBits})`,
      );
    }
  });

  it('high-severity gap scores higher than low-severity gap at same probability', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      collectionGaps: [
        makeGap('health', 'low-coverage', 'low'),
        makeGap('cyber', 'stale-data', 'high'),
      ],
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    assert.ok(actions.length === 2);
    const cyberAction = actions.find(a => a.label.includes('cyber'));
    const healthAction = actions.find(a => a.label.includes('health'));
    assert.ok(cyberAction && healthAction);
    assert.ok(
      cyberAction.expectedInfoGainBits >= healthAction.expectedInfoGainBits,
      `High-severity (${cyberAction.expectedInfoGainBits}) should beat low-severity (${healthAction.expectedInfoGainBits})`,
    );
  });
});

describe('planCollection — LR overrides', () => {
  it('overriding LR to non-diagnostic values yields zero or near-zero gain', () => {
    const ctx: EvoiContext = {
      hypothesisProbability: 0.5,
      missingSignals: [makeMissingSignal('crack spread')],
      likelihoodRatioOverrides: {
        missingSigLrPositive: 1.0001,
        missingSigLrNegative: 0.9999,
      },
    };
    const actions = planCollection(HYPOTHESIS_LIKE, ctx);
    // Either no actions (gain ≤ 0 filtered) or very low gain.
    for (const a of actions) {
      assert.ok(a.expectedInfoGainBits < 0.01, `Expected near-zero gain with near-neutral LR, got ${a.expectedInfoGainBits}`);
    }
  });

  it('overriding LR to more extreme values yields more gain than defaults', () => {
    const p = 0.5;
    const defaultCtx: EvoiContext = {
      hypothesisProbability: p,
      missingSignals: [makeMissingSignal('signal-a')],
    };
    const extremeCtx: EvoiContext = {
      hypothesisProbability: p,
      missingSignals: [makeMissingSignal('signal-b')],
      likelihoodRatioOverrides: {
        missingSigLrPositive: 20,
        missingSigLrNegative: 0.05,
      },
    };
    const defaultActions = planCollection(HYPOTHESIS_LIKE, defaultCtx);
    const extremeActions = planCollection(HYPOTHESIS_LIKE, extremeCtx);
    assert.ok(defaultActions.length > 0 && extremeActions.length > 0);
    assert.ok(
      extremeActions[0]!.expectedInfoGainBits > defaultActions[0]!.expectedInfoGainBits,
      `Extreme LR (${extremeActions[0]!.expectedInfoGainBits}) should beat default (${defaultActions[0]!.expectedInfoGainBits})`,
    );
  });
});

// ── buildEvoiContext tests ─────────────────────────────────────────────────────

describe('buildEvoiContext', () => {
  it('passes through hypothesisProbability', () => {
    const ctx = buildEvoiContext(0.73);
    assert.strictEqual(ctx.hypothesisProbability, 0.73);
  });

  it('filters providerReport to only informative verdicts', () => {
    const report = {
      generatedAt: Date.now(),
      domains: [
        { domain: 'weather', verdict: 'redundant_agreement' as const, confidenceMultiplier: 1, reason: '', remediation: '', providers: [] },
        { domain: 'maritime', verdict: 'redundant_disagreement' as const, confidenceMultiplier: 0.6, reason: '', remediation: '', providers: [] },
        { domain: 'cyber', verdict: 'single_source' as const, confidenceMultiplier: 0.7, reason: '', remediation: '', providers: [] },
        { domain: 'aviation', verdict: 'all_down' as const, confidenceMultiplier: 0, reason: '', remediation: '', providers: [] },
      ],
      summary: '',
      recommendations: [],
    };
    const ctx = buildEvoiContext(0.5, null, report);
    // Only redundant_disagreement, single_source, primary_down_with_backup pass.
    assert.ok(ctx.providerIssues !== undefined);
    const domains = (ctx.providerIssues ?? []).map(d => d.domain);
    assert.ok(domains.includes('maritime'), `Expected maritime: ${domains}`);
    assert.ok(domains.includes('cyber'), `Expected cyber: ${domains}`);
    assert.ok(!domains.includes('weather'), `Should not include weather: ${domains}`);
    assert.ok(!domains.includes('aviation'), `Should not include aviation: ${domains}`);
  });

  it('handles null inputs gracefully', () => {
    const ctx = buildEvoiContext(0.5, null, null, undefined);
    assert.deepStrictEqual(ctx.missingSignals, []);
    assert.deepStrictEqual(ctx.pendingSignals, []);
    assert.deepStrictEqual(ctx.providerIssues, []);
    assert.deepStrictEqual(ctx.collectionGaps, []);
  });

  it('passes through collection gaps', () => {
    const gaps = [makeGap('cyber', 'stale-data', 'high')];
    const ctx = buildEvoiContext(0.5, null, null, gaps);
    assert.strictEqual(ctx.collectionGaps?.length, 1);
    assert.strictEqual(ctx.collectionGaps?.[0]?.domain, 'cyber');
  });

  it('maps negEvidence missing and pending signals', () => {
    const negEvidence = {
      parentFactId: 'fact-1',
      expected: [],
      observed: [],
      pending: [makePendingSignal('spotter')],
      missing: [makeMissingSignal('crack spread')],
      totalAbsencePenalty: 0.1,
      adjustedConfidence: 0.55,
      missingConfirmation: [],
    };
    const ctx = buildEvoiContext(0.65, negEvidence, null);
    assert.strictEqual(ctx.missingSignals?.length, 1);
    assert.strictEqual(ctx.pendingSignals?.length, 1);
  });
});
