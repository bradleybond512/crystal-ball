import type { AxisState, SurvivalAxis, SurvivalPosture } from '@/services/survival/survival-types.ts';
import { SURVIVAL_AXES } from '@/services/survival/survival-types.ts';

function axisOrder(axis: SurvivalAxis): number {
  return SURVIVAL_AXES.indexOf(axis);
}

export function selectPostureCards(posture: SurvivalPosture): AxisState[] {
  const cards: AxisState[] = [];

  const physical = posture.axes.find((a) => a.axis === 'physical_safety');
  if (physical) cards.push(physical);

  const rest = posture.axes
    .filter((a) => a.axis !== 'physical_safety' && a.threats.length > 0)
    .sort((a, b) => (b.level - a.level) || (axisOrder(a.axis) - axisOrder(b.axis)));

  return [...cards, ...rest];
}
