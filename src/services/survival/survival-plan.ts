// src/services/survival/survival-plan.ts
import type {
  AxisState, CommittedMove, SurvivalAxis, SurvivalMove, SurvivalPlan, SurvivalPosture,
} from './survival-types.ts';
import { axisLabel, bandForLevel, buildHeadline } from './survival-types.ts';

export function emptyPlan(): SurvivalPlan {
  return { committed: [] };
}

export function commitMove(plan: SurvivalPlan, move: SurvivalMove, now: number): SurvivalPlan {
  if (plan.committed.some((c) => c.moveId === move.id)) return plan;
  return { committed: [...plan.committed, { moveId: move.id, committedAtMs: now, status: 'planned' }] };
}

export function moveStatus(plan: SurvivalPlan, moveId: string): CommittedMove['status'] | 'none' {
  return plan.committed.find((c) => c.moveId === moveId)?.status ?? 'none';
}

/** Re-project posture with committed move effects applied. This closes the
 *  loop: world threatens → you commit moves → posture responds. */
export function applyPlanToPosture(
  posture: SurvivalPosture,
  plan: SurvivalPlan,
  moves: readonly SurvivalMove[],
): SurvivalPosture {
  const deltaByAxis = new Map<SurvivalAxis, number>();
  for (const c of plan.committed) {
    if (c.status === 'skipped') continue;
    const move = moves.find((m) => m.id === c.moveId);
    if (!move) continue;
    for (const d of move.effect) {
      deltaByAxis.set(d.axis, (deltaByAxis.get(d.axis) ?? 0) + d.deltaLevel);
    }
  }

  const axes: AxisState[] = posture.axes.map((a) => {
    const delta = deltaByAxis.get(a.axis) ?? 0;
    if (delta === 0) return a;
    const level = Math.max(0, Math.min(100, a.level + delta));
    const band = bandForLevel(level);
    return {
      ...a,
      level,
      band,
      trend: level < a.level ? 'improving' : a.trend,
      drivers: [...a.drivers, `Planned moves change exposure by ${delta}`],
      confidence: {
        total: level,
        max: 100,
        items: [{ label: a.threats[0]?.hazardLabel ?? 'Mitigated exposure', value: level, max: 100, polarity: 'negative' as const }],
      },
      explanation: { ...a.explanation, headline: `${axisLabel(a.axis)}: ${band}` },
    };
  });

  const worst = axes.reduce((w, a) => (a.level > w.level ? a : w), axes[0]!);
  return {
    ...posture,
    axes,
    overallLevel: worst.level,
    overallBand: bandForLevel(worst.level),
    worstAxis: worst.axis,
    headline: buildHeadline(worst),
  };
}
