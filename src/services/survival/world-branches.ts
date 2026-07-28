// src/services/survival/world-branches.ts
//
// E5 · World-State Brain — world-branch enumeration.
//
// posture-trajectory.ts projects a SINGLE expected path per axis. Reality
// fans out: an axis heading toward "high" might escalate further, hold where
// projected, or ease off. This module turns each expected projection into a
// small set of plausible BRANCHES — escalate / hold / ease — each carrying a
// probability and a projected level, so downstream planning (E5-PR3) can weigh
// a move against the SPREAD of outcomes rather than a single point estimate.
//
// Honesty rules (inherited):
//   - The spread is driven by the projection's own confidence: when we are
//     confident, the three branches collapse toward the central path (we do
//     NOT invent divergence we have no basis for). When confidence is low, the
//     branches spread wide — the honest expression of "we don't know".
//   - The escalate/ease tilt follows the projected direction: a climbing axis
//     puts more mass on escalate, an easing axis on ease, a steady one splits
//     the residual evenly. No branch is fabricated with more weight than the
//     trajectory's evidence supports.
//   - Probabilities are exact: the three branch probabilities sum to 1 per
//     axis-horizon by construction.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed
// trajectory alone.

import type { SurvivalAxis, SurvivalBand } from './survival-types.ts';
import { axisLabel, bandForLevel } from './survival-types.ts';
import type { AxisProjection, PostureTrajectory, TrajectoryHorizon } from './posture-trajectory.ts';

export type BranchKind = 'escalate' | 'hold' | 'ease';

export interface AxisBranch {
  axis: SurvivalAxis;
  horizonId: string;
  kind: BranchKind;
  /** 0–1; the three branches of an axis-horizon sum to exactly 1. */
  probability: number;
  /** 0–100 projected axis level in this branch. */
  level: number;
  band: SurvivalBand;
  rationale: string;
}

export interface AxisBranchSet {
  axis: SurvivalAxis;
  horizonId: string;
  /** Exactly three, ordered escalate → hold → ease (worst level first). */
  branches: AxisBranch[];
  /** Probability-weighted mean level — a calibrated central estimate. */
  expectedLevel: number;
  expectedBand: SurvivalBand;
  mostLikely: BranchKind;
}

export interface WorldBranches {
  capturedAtMs: number;
  horizons: TrajectoryHorizon[];
  /** Horizon-major, worst-expected-first within each horizon. */
  axisSets: AxisBranchSet[];
  headline: string;
}

export interface WorldBranchOptions {
  /** Widest one-sided level swing (points) a branch can take from the central
   *  path, reached only at zero confidence. Default 35. */
  maxSpread?: number;
}

const DEFAULT_MAX_SPREAD = 35;

/** Central branch keeps at least this share, and at most this share, of the
 *  probability mass — the rest is split between escalate and ease. */
const MIN_HOLD_PROB = 0.4;
const MAX_HOLD_PROB = 0.85;

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

/** Escalate/ease bias in [-0.9, 0.9] from the projected delta: a bigger climb
 *  tilts more mass toward escalate, a bigger drop toward ease. */
function directionTilt(delta: number): number {
  return Math.max(-0.9, Math.min(0.9, finite(delta) / 50));
}

function resolveMaxSpread(maxSpread: number | undefined): number {
  if (maxSpread == null || !Number.isFinite(maxSpread)) return DEFAULT_MAX_SPREAD;
  return Math.max(0, maxSpread);
}

function makeBranch(
  p: AxisProjection, kind: BranchKind, probability: number, level: number, phrase: string,
): AxisBranch {
  const band = bandForLevel(level);
  return {
    axis: p.axis,
    horizonId: p.horizonId,
    kind,
    probability: round2(probability),
    level: round2(level),
    band,
    rationale: `${axisLabel(p.axis)} ${phrase} → ${band} by ${p.horizonId}.`,
  };
}

function branchSetFor(p: AxisProjection, maxSpread: number): AxisBranchSet {
  const hold = clampLevel(p.projectedLevel);
  const confidence = clamp01(p.confidence);
  const spread = (1 - confidence) * maxSpread;
  const escalateLevel = clampLevel(hold + spread);
  const easeLevel = clampLevel(hold - spread);

  // More confidence → more mass on the central path; the residual splits by tilt.
  const pHold = Math.max(MIN_HOLD_PROB, Math.min(MAX_HOLD_PROB, 0.4 + 0.4 * confidence));
  const rem = 1 - pHold;
  const tilt = directionTilt(p.delta);
  const pEscalate = rem * (0.5 + 0.5 * tilt);
  const pEase = rem * (0.5 - 0.5 * tilt);

  // Round the two tails, then let hold absorb the residual so the three
  // DISPLAYED probabilities sum to EXACTLY 1 (the interface contract) instead
  // of drifting when each is rounded independently.
  const escProb = round2(pEscalate);
  const easeProb = round2(pEase);
  const holdProb = round2(1 - escProb - easeProb);
  const branches: AxisBranch[] = [
    makeBranch(p, 'escalate', escProb, escalateLevel, 'worse than expected'),
    makeBranch(p, 'hold', holdProb, hold, 'tracks the expected path'),
    makeBranch(p, 'ease', easeProb, easeLevel, 'better than expected'),
  ];

  // Expected level uses the UN-rounded probabilities/levels so it stays exact.
  const expectedLevel = pEscalate * escalateLevel + pHold * hold + pEase * easeLevel;
  // mostLikely is decided on the UN-rounded probabilities so a sub-cent gap
  // isn't erased by display rounding; exact ties favor the central 'hold'.
  let mostLikely: BranchKind = 'hold';
  let bestProb = pHold;
  if (pEscalate > bestProb) { bestProb = pEscalate; mostLikely = 'escalate'; }
  if (pEase > bestProb) { mostLikely = 'ease'; }

  return {
    axis: p.axis,
    horizonId: p.horizonId,
    branches,
    expectedLevel: round2(expectedLevel),
    expectedBand: bandForLevel(expectedLevel),
    mostLikely,
  };
}

/** The most consequential downside across the whole fan: the escalate branch
 *  with the largest probability-weighted level. Materiality (level ≥ 20) is
 *  filtered BEFORE ranking so a high-probability sub-material branch can't win
 *  the score race and then get rejected, hiding a genuine critical branch that
 *  scored lower behind it. */
function headlineFor(sets: readonly AxisBranchSet[]): string {
  let worst: AxisBranch | null = null;
  let worstScore = 0;
  for (const s of sets) {
    const esc = s.branches.find((b) => b.kind === 'escalate');
    if (!esc || esc.level < 20) continue;
    const score = esc.probability * esc.level;
    if (score > worstScore) {
      worstScore = score;
      worst = esc;
    }
  }
  if (!worst) {
    return sets.length === 0
      ? 'No posture data to branch.'
      : 'No material escalation branch across the projection window.';
  }
  const pct = Math.round(worst.probability * 100);
  return `${axisLabel(worst.axis)} could escalate to ${worst.band} (~${pct}% branch) by ${worst.horizonId}.`;
}

export function buildWorldBranches(
  trajectory: PostureTrajectory,
  options: WorldBranchOptions = {},
): WorldBranches {
  const maxSpread = resolveMaxSpread(options.maxSpread);
  const axisSets = (trajectory.projections ?? []).map((p) => branchSetFor(p, maxSpread));

  // Re-group horizon-major, worst-expected-first within each horizon.
  const byHorizon = new Map<string, AxisBranchSet[]>();
  for (const s of axisSets) {
    const arr = byHorizon.get(s.horizonId) ?? [];
    arr.push(s);
    byHorizon.set(s.horizonId, arr);
  }
  const ordered: AxisBranchSet[] = [];
  for (const horizon of trajectory.horizons ?? []) {
    const arr = byHorizon.get(horizon.id) ?? [];
    arr.sort((a, b) => b.expectedLevel - a.expectedLevel);
    ordered.push(...arr);
  }

  return {
    capturedAtMs: trajectory.capturedAtMs,
    horizons: [...(trajectory.horizons ?? [])],
    axisSets: ordered,
    headline: headlineFor(ordered),
  };
}
