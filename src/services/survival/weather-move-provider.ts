// src/services/survival/weather-move-provider.ts
import { actionsForHazard } from '../weather/preparedness-actions.ts';
import type { MoveCost, PostureDelta, SurvivalAxis, SurvivalPosture } from './survival-types.ts';
import type { MoveProvider } from './move-provider.ts';

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

export function makeWeatherMoveProvider(options?: { maxMoves?: number }): MoveProvider {
  const max = options?.maxMoves ?? 6;
  return {
    id: 'weather',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    provide(posture: SurvivalPosture, _now: number) {
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
    },
  };
}
