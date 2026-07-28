// src/services/survival/__tests__/decision-consequence.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionConsequences } from '../decision-consequence.ts';
import type { AxisBranch, AxisBranchSet, WorldBranches } from '../world-branches.ts';
import type { MoveCost, SurvivalAxis, SurvivalMove } from '../survival-types.ts';
import { bandForLevel } from '../survival-types.ts';

function branch(kind: AxisBranch['kind'], probability: number, level: number, axis: SurvivalAxis, horizonId: string): AxisBranch {
  return { axis, horizonId, kind, probability, level, band: bandForLevel(level), rationale: '' };
}

function set(
  axis: SurvivalAxis,
  horizonId: string,
  levels: { escalate: number; hold: number; ease: number },
  probs: { escalate: number; hold: number; ease: number } = { escalate: 0.3, hold: 0.4, ease: 0.3 },
): AxisBranchSet {
  const branches = [
    branch('escalate', probs.escalate, levels.escalate, axis, horizonId),
    branch('hold', probs.hold, levels.hold, axis, horizonId),
    branch('ease', probs.ease, levels.ease, axis, horizonId),
  ];
  const expectedLevel = branches.reduce((m, b) => m + b.probability * b.level, 0);
  return { axis, horizonId, branches, expectedLevel, expectedBand: bandForLevel(expectedLevel), mostLikely: 'hold' };
}

function branches(sets: AxisBranchSet[]): WorldBranches {
  return { capturedAtMs: 1_700_000_000_000, horizons: [], axisSets: sets, headline: '' };
}

function move(p: Partial<SurvivalMove> & { id: string; effect: SurvivalMove['effect'] }): SurvivalMove {
  return {
    label: p.label ?? p.id,
    detail: '',
    affects: p.affects ?? p.effect.map((e) => e.axis),
    cost: p.cost ?? 'low',
    leadTimeMins: p.leadTimeMins ?? 60,
    trigger: '',
    ...p,
  };
}

test('empty branches yields no consequences and an honest headline', () => {
  const d = evaluateDecisionConsequences(branches([]), [move({ id: 'm', effect: [{ axis: 'supply', deltaLevel: -20, rationale: '' }] })]);
  assert.deepEqual(d.consequences, []);
  assert.equal(d.recommendedMoveId, null);
  assert.equal(d.headline, 'No branches to evaluate.');
});

test('no candidate moves yields no consequences and an honest headline', () => {
  const d = evaluateDecisionConsequences(branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 })]), []);
  assert.deepEqual(d.consequences, []);
  assert.equal(d.recommendedMoveId, null);
  assert.equal(d.headline, 'No candidate moves to evaluate.');
});

test('a mitigating move lowers the expected peak and is recommended', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 })]),
    [move({ id: 'stock-up', label: 'Stock up', effect: [{ axis: 'supply', deltaLevel: -20, rationale: '' }] })],
  );
  const c = d.consequences[0]!;
  assert.equal(d.recommendedMoveId, 'stock-up');
  assert.ok(c.expectedReduction > 0, `expectedReduction=${c.expectedReduction}`);
  assert.equal(c.movedExpected, c.baselineExpected - c.expectedReduction);
  assert.ok(d.headline.includes('Stock up'), d.headline);
});

test('baseline expected peak equals the probability-weighted mean of the branch levels', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 }, { escalate: 0.3, hold: 0.4, ease: 0.3 })]),
    [move({ id: 'noop', effect: [] })],
  );
  // 0.3*80 + 0.4*60 + 0.3*40 = 24 + 24 + 12 = 60
  assert.equal(d.consequences[0]!.baselineExpected, 60);
});

test('a move on an axis already at zero earns no credit and is not recommended', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 0, hold: 0, ease: 0 })]),
    [move({ id: 'pointless', effect: [{ axis: 'supply', deltaLevel: -30, rationale: '' }] })],
  );
  assert.equal(d.consequences[0]!.expectedReduction, 0);
  assert.equal(d.recommendedMoveId, null);
  assert.equal(d.headline, 'Hold — no candidate move materially reduces expected peak exposure.');
});

test('a move affecting an axis absent from the branch set scores zero', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 })]),
    [move({ id: 'wrong-axis', effect: [{ axis: 'comms', deltaLevel: -40, rationale: '' }] })],
  );
  assert.equal(d.consequences[0]!.expectedReduction, 0);
  assert.deepEqual(d.consequences[0]!.axisImpacts, []);
  assert.equal(d.recommendedMoveId, null);
});

test('a move that would WORSEN a branch is never recommended', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 60, hold: 40, ease: 20 })]),
    [move({ id: 'bad', effect: [{ axis: 'supply', deltaLevel: +20, rationale: '' }] })],
  );
  assert.ok(d.consequences[0]!.expectedReduction < 0);
  assert.equal(d.recommendedMoveId, null);
});

test('the bigger expected-peak reducer is ranked first and recommended', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 90, hold: 70, ease: 50 })]),
    [
      move({ id: 'small', label: 'Small', effect: [{ axis: 'supply', deltaLevel: -10, rationale: '' }] }),
      move({ id: 'big', label: 'Big', effect: [{ axis: 'supply', deltaLevel: -40, rationale: '' }] }),
    ],
  );
  assert.equal(d.consequences[0]!.moveId, 'big');
  assert.equal(d.recommendedMoveId, 'big');
});

test('at equal reduction the cheaper move wins the tie-break', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 })]),
    [
      move({ id: 'pricey', cost: 'high' as MoveCost, effect: [{ axis: 'supply', deltaLevel: -20, rationale: '' }] }),
      move({ id: 'cheap', cost: 'free' as MoveCost, effect: [{ axis: 'supply', deltaLevel: -20, rationale: '' }] }),
    ],
  );
  assert.equal(d.consequences[0]!.moveId, 'cheap');
});

test('peak follows the worst axis: a move cutting the peak axis yields the new residual peak', () => {
  const d = evaluateDecisionConsequences(
    branches([
      set('supply', '24h', { escalate: 100, hold: 90, ease: 80 }),   // baseline peak ~90
      set('comms', '24h', { escalate: 70, hold: 55, ease: 40 }),     // ~55
    ]),
    [move({ id: 'fix-supply', effect: [{ axis: 'supply', deltaLevel: -50, rationale: '' }] })],
  );
  const c = d.consequences[0]!;
  // supply drops below comms, so comms becomes the residual peak.
  assert.equal(c.residualPeakAxis, 'comms');
  assert.ok(c.expectedReduction > 0);
});

test('tailReduction captures worst-case relief even when the expected peak is unmoved', () => {
  // Move only bites the escalate branch region: with a low escalate probability
  // the expected peak barely moves, but the worst-case tail drops materially.
  const d = evaluateDecisionConsequences(
    branches([set('energy_water', '72h', { escalate: 95, hold: 30, ease: 20 }, { escalate: 0.05, hold: 0.6, ease: 0.35 })]),
    [move({ id: 'harden', effect: [{ axis: 'energy_water', deltaLevel: -40, rationale: '' }] })],
  );
  const c = d.consequences[0]!;
  assert.ok(c.tailReduction > c.expectedReduction, `tail=${c.tailReduction} expected=${c.expectedReduction}`);
  assert.ok(c.tailReduction > 0);
});

test('axisImpacts breaks down every touched-and-changed axis-horizon', () => {
  const d = evaluateDecisionConsequences(
    branches([
      set('supply', '24h', { escalate: 80, hold: 60, ease: 40 }),
      set('supply', '72h', { escalate: 90, hold: 70, ease: 50 }),
    ]),
    [move({ id: 'multi', effect: [{ axis: 'supply', deltaLevel: -20, rationale: '' }] })],
  );
  const impacts = d.consequences[0]!.axisImpacts;
  assert.equal(impacts.length, 2);
  assert.deepEqual(impacts.map((i) => i.horizonId).sort(), ['24h', '72h']);
  for (const i of impacts) assert.ok(i.reduction > 0);
});

test('multiple deltas on the same axis are summed', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 })]),
    [move({ id: 'stacked', effect: [
      { axis: 'supply', deltaLevel: -10, rationale: '' },
      { axis: 'supply', deltaLevel: -10, rationale: '' },
    ] })],
  );
  // net -20 on a 60 baseline expected → moved 40.
  assert.equal(d.consequences[0]!.movedExpected, 40);
});

test('non-finite deltas and levels never leak NaN into output', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: Number.NaN, hold: 60, ease: 40 })]),
    [move({ id: 'nan', effect: [{ axis: 'supply', deltaLevel: Number.POSITIVE_INFINITY, rationale: '' }] })],
  );
  const c = d.consequences[0]!;
  assert.ok(Number.isFinite(c.baselineExpected));
  assert.ok(Number.isFinite(c.movedExpected));
  assert.ok(Number.isFinite(c.expectedReduction));
  assert.ok(Number.isFinite(c.tailReduction));
});

test('a move that lowers the expected peak but worsens the escalate tail is NOT recommended', () => {
  // supply improves (expected peak 60 → 58.5), but comms is pushed up so its
  // worst-case tail (50 + 40 = 90) exceeds the baseline tail peak (80).
  const d = evaluateDecisionConsequences(
    branches([
      set('supply', '24h', { escalate: 80, hold: 60, ease: 40 }),          // exp 60, tail 80
      set('comms', '24h', { escalate: 50, hold: 5, ease: 5 }),             // exp 18.5, tail 50
    ]),
    [move({ id: 'trade-off', effect: [
      { axis: 'supply', deltaLevel: -30, rationale: '' },
      { axis: 'comms', deltaLevel: +40, rationale: '' },
    ] })],
  );
  const c = d.consequences[0]!;
  assert.ok(c.expectedReduction > 0, `expectedReduction=${c.expectedReduction}`);
  assert.ok(c.tailReduction < 0, `tailReduction=${c.tailReduction}`);
  assert.equal(d.recommendedMoveId, null);
  assert.equal(d.headline, 'Hold — no candidate move materially reduces expected peak exposure.');
});

test('a stack of overflowing positive deltas saturates to a worsening move, not a phantom no-op', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 80, hold: 60, ease: 40 })]),
    [move({ id: 'overflow', effect: [
      { axis: 'supply', deltaLevel: 1e308, rationale: '' },
      { axis: 'supply', deltaLevel: 1e308, rationale: '' },
    ] })],
  );
  const c = d.consequences[0]!;
  // Summed delta overflows to Infinity but saturates to +100: every branch
  // floors at 100, so the move WORSENS the peak (never a phantom reduction).
  assert.equal(c.movedExpected, 100);
  assert.ok(c.expectedReduction < 0, `expectedReduction=${c.expectedReduction}`);
  assert.equal(d.recommendedMoveId, null);
});

test('a move is clamped so it cannot drive a branch below zero', () => {
  const d = evaluateDecisionConsequences(
    branches([set('supply', '24h', { escalate: 30, hold: 20, ease: 10 })]),
    [move({ id: 'over', effect: [{ axis: 'supply', deltaLevel: -100, rationale: '' }] })],
  );
  // all branches floor at 0 → moved expected 0.
  assert.equal(d.consequences[0]!.movedExpected, 0);
});
