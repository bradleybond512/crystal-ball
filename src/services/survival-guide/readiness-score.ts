/**
 * Pure readiness scoring over a guide's checklist. No state, no storage.
 * Default: weighted ratio of checked-item weight to total weight.
 */

import type { GuideId, GuideReadiness, OverallReadiness, SurvivalGuide } from './guide-types';

export function computeGuideReadiness(
  guide: SurvivalGuide,
  checkedIds: ReadonlySet<string>,
): GuideReadiness | null {
  if (guide.checklist.length === 0) return null;

  let totalWeight = 0;
  let checkedWeight = 0;
  let checkedCount = 0;
  for (const item of guide.checklist) {
    totalWeight += item.weight;
    if (checkedIds.has(item.id)) {
      checkedWeight += item.weight;
      checkedCount += 1;
    }
  }

  const percent = totalWeight === 0 ? 0 : Math.round((checkedWeight / totalWeight) * 100);
  return {
    guideId: guide.id,
    percent,
    checkedWeight,
    totalWeight,
    checkedCount,
    totalCount: guide.checklist.length,
  };
}

export function computeOverallReadiness(
  guides: readonly SurvivalGuide[],
  checkedIds: ReadonlySet<string>,
): OverallReadiness {
  const scored = guides
    .map((g) => computeGuideReadiness(g, checkedIds))
    .filter((r): r is GuideReadiness => r !== null);

  if (scored.length === 0) return { percent: 0, weakest: null };

  const sum = scored.reduce((acc, r) => acc + r.percent, 0);
  const percent = Math.round(sum / scored.length);

  let weakest: GuideId | null = null;
  let lowest = Infinity;
  for (const r of scored) {
    if (r.percent < lowest) {
      lowest = r.percent;
      weakest = r.guideId;
    }
  }
  return { percent, weakest };
}
