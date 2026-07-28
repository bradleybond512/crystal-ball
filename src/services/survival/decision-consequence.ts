// src/services/survival/decision-consequence.ts
//
// E5 · World-State Brain — decision-consequence what-if simulation.
//
// world-branches.ts (PR2) fans each expected projection into escalate / hold /
// ease branches with probabilities. This module answers the operator's actual
// question: "given this spread of possible futures, which move should I make?"
//
// For each candidate SurvivalMove we apply its modeled per-axis effect to EVERY
// branch level, recompute the probability-weighted expected exposure, and
// compare it to doing nothing. The move that most reduces the PEAK expected
// exposure — the worst axis-horizon the operator actually cares about — wins.
//
// Honesty rules (inherited):
//   - A move only earns credit where its effect genuinely lowers a branch that
//     is actually elevated. Applying a move to an axis already at 0, or to an
//     axis absent from the branch set, moves nothing and scores nothing.
//   - Benefit is measured against the SAME branch spread for baseline and moved
//     (both recomputed from the branches) so the reduction is apples-to-apples.
//   - A move that would WORSEN a branch (positive delta) reduces its own score
//     and is never recommended. When nothing materially helps, we say so rather
//     than inventing a recommendation.
//   - We surface both the expected-case reduction AND the worst-case (escalate
//     tail) reduction — a move that only helps the already-fine branches is not
//     the same as one that cuts the critical tail.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed
// branches + candidate moves alone.

import type { MoveCost, SurvivalAxis, SurvivalMove } from './survival-types.ts';
import { axisLabel, bandForLevel } from './survival-types.ts';
import type { AxisBranchSet, WorldBranches } from './world-branches.ts';

export interface MoveAxisImpact {
  axis: SurvivalAxis;
  horizonId: string;
  /** Probability-weighted expected level of this axis-horizon, do-nothing. */
  baselineExpectedLevel: number;
  /** Same, with this move's delta applied to every branch (clamped 0..100). */
  movedExpectedLevel: number;
  /** baselineExpectedLevel − movedExpectedLevel; positive = improvement. */
  reduction: number;
}

export interface MoveConsequence {
  moveId: string;
  moveLabel: string;
  cost: MoveCost;
  leadTimeMins: number;
  /** Highest expected exposure across all axis-horizons, do-nothing. */
  baselineExpected: number;
  /** Highest expected exposure after applying this move everywhere. */
  movedExpected: number;
  /** baselineExpected − movedExpected; positive = the peak was lowered. */
  expectedReduction: number;
  /** Same peak comparison on the escalate (worst-case) branch levels. */
  tailReduction: number;
  /** Which axis-horizon holds the moved peak (what still hurts most after). */
  residualPeakAxis: SurvivalAxis | null;
  /** Per-axis-horizon breakdown, only where the move touches an elevated axis. */
  axisImpacts: MoveAxisImpact[];
  rationale: string;
}

export interface DecisionConsequence {
  capturedAtMs: number;
  /** Best-first: expectedReduction, then tailReduction, then cheaper, then faster. */
  consequences: MoveConsequence[];
  recommendedMoveId: string | null;
  headline: string;
}

const COST_RANK: Record<MoveCost, number> = { free: 0, low: 1, medium: 2, high: 3 };

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, finite(n)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, finite(n)));
}

function round2(n: number): number {
  return Math.round(finite(n) * 100) / 100;
}

/** Net signed level change this move applies to `axis` (sum of its deltas;
 *  negative improves posture). Non-finite deltas are treated as zero, and the
 *  summed total is clamped to ±100 — levels live in 0..100, so anything beyond
 *  fully saturates a branch, and the clamp preserves the sign that a naive sum
 *  could otherwise overflow to Infinity (which would read as a no-op). */
function deltaForAxis(move: SurvivalMove, axis: SurvivalAxis): number {
  let sum = 0;
  for (const d of move.effect ?? []) {
    // Clamp the running total each step so a stack of huge deltas saturates to
    // ±100 with the correct sign rather than overflowing to Infinity (which
    // finite() would then flip to a no-op zero, masking a worsening move).
    if (d.axis === axis) sum = Math.max(-100, Math.min(100, sum + finite(d.deltaLevel)));
  }
  return sum;
}

/** Probability-weighted mean of the three branch levels, recomputed from the
 *  branches so baseline and moved are measured the same way. */
function expectedLevelOf(set: AxisBranchSet, delta: number): number {
  let sum = 0;
  for (const b of set.branches) {
    sum += clamp01(b.probability) * clampLevel(b.level + delta);
  }
  return sum;
}

/** Escalate (worst-case) branch level after a delta — the tail the operator
 *  is buying down. Falls back to the set's expected shift if no escalate branch. */
function escalateLevelOf(set: AxisBranchSet, delta: number): number {
  const esc = set.branches.find((b) => b.kind === 'escalate');
  if (!esc) return clampLevel(expectedLevelOf(set, delta));
  return clampLevel(esc.level + delta);
}

interface Peak {
  level: number;
  axis: SurvivalAxis | null;
}

function peakBy(sets: readonly AxisBranchSet[], levelOf: (s: AxisBranchSet) => number): Peak {
  let level = 0;
  let axis: SurvivalAxis | null = null;
  for (const s of sets) {
    const v = levelOf(s);
    if (v > level) {
      level = v;
      axis = s.axis;
    }
  }
  return { level, axis };
}

function consequenceFor(move: SurvivalMove, sets: readonly AxisBranchSet[]): MoveConsequence {
  const baselinePeak = peakBy(sets, (s) => expectedLevelOf(s, 0));
  const movedPeak = peakBy(sets, (s) => expectedLevelOf(s, deltaForAxis(move, s.axis)));
  const baselineTail = peakBy(sets, (s) => escalateLevelOf(s, 0));
  const movedTail = peakBy(sets, (s) => escalateLevelOf(s, deltaForAxis(move, s.axis)));

  const axisImpacts: MoveAxisImpact[] = [];
  for (const s of sets) {
    const delta = deltaForAxis(move, s.axis);
    if (delta === 0) continue;
    const baseline = expectedLevelOf(s, 0);
    const moved = expectedLevelOf(s, delta);
    if (baseline === moved) continue; // move touches this axis but changes nothing (already floored)
    axisImpacts.push({
      axis: s.axis,
      horizonId: s.horizonId,
      baselineExpectedLevel: round2(baseline),
      movedExpectedLevel: round2(moved),
      reduction: round2(baseline - moved),
    });
  }

  const expectedReduction = round2(baselinePeak.level - movedPeak.level);
  const tailReduction = round2(baselineTail.level - movedTail.level);

  let rationale: string;
  if (expectedReduction > 0) {
    const from = round2(baselinePeak.level);
    const to = round2(movedPeak.level);
    rationale = `Cuts expected ${axisLabel(baselinePeak.axis ?? move.affects[0] ?? 'physical_safety')} peak from ${from} to ${to} (−${expectedReduction}).`;
  } else if (tailReduction > 0) {
    rationale = `No change to the expected peak, but trims the worst-case tail by ${tailReduction}.`;
  } else {
    rationale = 'No material effect on the projected exposure.';
  }

  return {
    moveId: move.id,
    moveLabel: move.label,
    cost: move.cost,
    leadTimeMins: finite(move.leadTimeMins),
    baselineExpected: round2(baselinePeak.level),
    movedExpected: round2(movedPeak.level),
    expectedReduction,
    tailReduction,
    residualPeakAxis: movedPeak.axis,
    axisImpacts,
    rationale,
  };
}

/** Best-first ordering: bigger expected-peak reduction wins; ties break on the
 *  worst-case tail reduction, then the cheaper move, then the faster one. */
function rankConsequences(a: MoveConsequence, b: MoveConsequence): number {
  if (b.expectedReduction !== a.expectedReduction) return b.expectedReduction - a.expectedReduction;
  if (b.tailReduction !== a.tailReduction) return b.tailReduction - a.tailReduction;
  if (COST_RANK[a.cost] !== COST_RANK[b.cost]) return COST_RANK[a.cost] - COST_RANK[b.cost];
  return a.leadTimeMins - b.leadTimeMins;
}

export function evaluateDecisionConsequences(
  branches: WorldBranches,
  candidateMoves: readonly SurvivalMove[],
): DecisionConsequence {
  const sets = branches.axisSets ?? [];
  const capturedAtMs = branches.capturedAtMs;

  if (sets.length === 0) {
    return { capturedAtMs, consequences: [], recommendedMoveId: null, headline: 'No branches to evaluate.' };
  }
  if (candidateMoves.length === 0) {
    return { capturedAtMs, consequences: [], recommendedMoveId: null, headline: 'No candidate moves to evaluate.' };
  }

  const consequences = candidateMoves.map((m) => consequenceFor(m, sets)).sort(rankConsequences);

  // A move is only worth recommending if it materially lowers the expected peak
  // AND does not worsen the worst-case (escalate) tail — a move that trades the
  // expected case for a heavier tail is not a recommendation we stand behind.
  const best = consequences[0]!;
  const recommend = best.expectedReduction > 0 && best.tailReduction >= 0 ? best : null;

  let headline: string;
  if (recommend) {
    const band = bandForLevel(recommend.movedExpected);
    headline = `Recommend "${recommend.moveLabel}": expected peak ${recommend.baselineExpected} → ${recommend.movedExpected} (${band}).`;
  } else {
    headline = 'Hold — no candidate move materially reduces expected peak exposure.';
  }

  return { capturedAtMs, consequences, recommendedMoveId: recommend ? recommend.moveId : null, headline };
}
