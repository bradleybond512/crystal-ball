/**
 * Pure helper: AlgorithmDefinition → AlgorithmParameterSummary[] for the
 * diagnostic export bundle.
 *
 * Kept separate from `algorithm-health.ts` because the diagnostics bundle
 * is conceptually downstream of the registry — it just snapshots the
 * tunables. Pure / no DOM / no fetch.
 */

import type { AlgorithmDefinition } from '@/services/algorithms/algorithm-health';
import type { AlgorithmParameterSummary } from './export-bundle';

export function summarizeAlgorithmParameters(
  defs: readonly AlgorithmDefinition[],
  extras?: Readonly<Record<string, Readonly<Record<string, number | string | boolean>>>>,
): AlgorithmParameterSummary[] {
  return defs.map((d) => {
    const out: AlgorithmParameterSummary = {
      algorithmId: d.algorithmId,
      label: d.label,
      domain: d.domain,
    };
    if (d.minWeightedHitRate !== undefined) out.minWeightedHitRate = d.minWeightedHitRate;
    if (d.minGradedSamples !== undefined) out.minGradedSamples = d.minGradedSamples;
    if (d.maxMeanDurationMs !== undefined) out.maxMeanDurationMs = d.maxMeanDurationMs;
    const extra = extras?.[d.algorithmId];
    if (extra && Object.keys(extra).length > 0) out.extras = { ...extra };
    return out;
  });
}
