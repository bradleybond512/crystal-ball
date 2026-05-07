// Earthquake Early Warning tier constants.
//
// Placeholder magnitude bands until the real EEW engine lands. These give
// notification triggers a stable vocabulary to dispatch against.
/* eslint-disable sonarjs/todo-tag -- intentional placeholders pending the real EEW engine */

export const EEW_TIERS = {
  TIER_2: { min: 5, max: 6 },
  TIER_3: { min: 6, max: 7 },
  TIER_4: { min: 7, max: 8 },
  TIER_5: { min: 8, max: Number.POSITIVE_INFINITY },
} as const;

export type EewTier = keyof typeof EEW_TIERS;

const TIER_ORDER: EewTier[] = ['TIER_2', 'TIER_3', 'TIER_4', 'TIER_5'];

export function tierForMagnitude(magnitude: number): EewTier | null {
  if (typeof magnitude !== 'number' || Number.isNaN(magnitude)) return null;
  if (magnitude < EEW_TIERS.TIER_2.min) return null;
  for (const tier of TIER_ORDER) {
    const { min, max } = EEW_TIERS[tier];
    if (magnitude >= min && magnitude < max) return tier;
  }
  return 'TIER_5';
}

export function compareTiers(a: EewTier, b: EewTier): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
}

export function tierAtLeast(tier: EewTier, threshold: EewTier): boolean {
  return compareTiers(tier, threshold) >= 0;
}
