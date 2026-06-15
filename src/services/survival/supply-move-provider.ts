// src/services/survival/supply-move-provider.ts
import type { PostureDelta, SurvivalAxis, SurvivalMove, SurvivalPosture } from './survival-types.ts';
import type { MoveProvider } from './move-provider.ts';

interface SupplyMoveSpec {
  id: string;
  label: string;
  detail: string;
  deltaLevel: number;
  cost: SurvivalMove['cost'];
  leadTimeMins: number;
  playbookRef: string;
}

const SUPPLY_MOVES: readonly SupplyMoveSpec[] = [
  {
    id: 'supply-stock-essentials',
    label: 'Stock ~2 weeks of essentials',
    detail: 'Build a two-week buffer of shelf-stable food, water, and household staples before shortages bite.',
    deltaLevel: -20,
    cost: 'medium',
    leadTimeMins: 120,
    playbookRef: 'supply.stock-essentials',
  },
  {
    id: 'supply-top-off-fuel',
    label: 'Top off fuel + propane',
    detail: 'Fill vehicle tanks, jerry cans, and propane while supply is steady.',
    deltaLevel: -15,
    cost: 'low',
    leadTimeMins: 30,
    playbookRef: 'supply.top-off-fuel',
  },
  {
    id: 'supply-fill-prescriptions',
    label: 'Refill prescriptions early',
    detail: 'Request early refills on essential medications so a supply gap does not cut you off.',
    deltaLevel: -10,
    cost: 'low',
    leadTimeMins: 60,
    playbookRef: 'supply.fill-prescriptions',
  },
];

/** Proposes supply-resilience moves when the supply axis is threatened. Pure. */
export function makeSupplyMoveProvider(): MoveProvider {
  return {
    id: 'supply',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    provide(posture: SurvivalPosture, _now: number): SurvivalMove[] {
      const supply = posture.axes.find((a) => a.axis === 'supply');
      if (!supply || supply.threats.length === 0) return [];

      const top = supply.threats[0]!;
      return SUPPLY_MOVES.map((spec) => {
        const effect: PostureDelta[] = [{
          axis: 'supply',
          deltaLevel: spec.deltaLevel,
          rationale: `${spec.label} reduces exposure to ${top.hazardLabel}`,
        }];
        return {
          id: spec.id,
          label: spec.label,
          detail: spec.detail,
          affects: ['supply'] as SurvivalAxis[],
          cost: spec.cost,
          leadTimeMins: spec.leadTimeMins,
          trigger: `${top.hazardLabel} threatening supply`,
          effect,
          playbookRef: spec.playbookRef,
        };
      });
    },
  };
}
