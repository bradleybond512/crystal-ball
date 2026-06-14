// src/services/survival/survival-moves.ts
import { actionsForHazard } from '../weather/preparedness-actions.ts';
import type {
  MoveCost, PostureDelta, SurvivalAxis, SurvivalMove, SurvivalPosture, WorldSnapshot,
} from './survival-types.ts';

export interface MovesOptions {
  now?: number;
  maxMoves?: number;
}

/** Map preparedness priority (1 = critical) to a modeled posture reduction. */
function reductionForPriority(priority: number): number {
  if (priority <= 1) return 25;
  if (priority === 2) return 15;
  if (priority === 3) return 10;
  return 5;
}

function costForMinutes(mins: number): MoveCost {
  if (mins <= 1) return 'free';
  if (mins <= 5) return 'low';
  if (mins <= 15) return 'medium';
  return 'high';
}

export function availableMoves(
  posture: SurvivalPosture,
  _snapshot: WorldSnapshot,
  options: MovesOptions = {},
): SurvivalMove[] {
  const max = options.maxMoves ?? 6;
  const physical = posture.axes.find((a) => a.axis === 'physical_safety');
  if (!physical || physical.threats.length === 0) return [];

  const top = physical.threats[0]!;
  const actions = actionsForHazard(top.hazardKind, { max });

  return actions.map((a) => {
    const effect: PostureDelta[] = [{
      axis: 'physical_safety',
      deltaLevel: -reductionForPriority(a.priority),
      rationale: `${a.label} reduces exposure to ${top.hazardLabel}`,
    }];
    return {
      id: `move-${a.id}`,
      label: a.label,
      detail: a.rationale ?? a.label,
      affects: ['physical_safety'] as SurvivalAxis[],
      cost: costForMinutes(a.estimatedMinutes),
      leadTimeMins: a.estimatedMinutes,
      trigger: `${top.hazardLabel} threatening ${physical.axis}`,
      effect,
      playbookRef: a.id,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function projectMoveEffect(move: SurvivalMove, _posture: SurvivalPosture): PostureDelta[] {
  return move.effect;
}
