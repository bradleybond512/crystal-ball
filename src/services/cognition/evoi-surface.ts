/**
 * EVOI surface — "What to check next" view-model for the AnalystHUD.
 *
 * The EVOI planner (evoi-planner.ts) is pure math; this module is its
 * stateful entry point: it pulls the real provider-redundancy report and
 * open collection gaps, runs planCollection() across the visible
 * hypotheses, and merges the results into one ranked, deduped list.
 *
 * Kill-switch: `isCognitionEnabled('evoi-planner')` is consulted on every
 * call — turning the switch off empties the HUD section on the next render
 * with no restart. Fail-safe ON (see cognition-settings.ts).
 */

import { planCollection, buildEvoiContext, type CollectionAction } from './evoi-planner';
import { isCognitionEnabled } from './cognition-settings';
import { getProviderRedundancyReport } from '@/services/insights/insights-state';
import { getCollectionGapDiscoveryService } from '@/services/intelligence/collection-gap-discovery';
import type { HypothesisKind } from '@/services/analyst-loop';

export interface CheckNextInput {
  /** Hypothesis kind (analyst-loop Hypothesis['kind']). */
  kind: HypothesisKind;
  statement: string;
  /** Calibrated probability 0–1 (hypothesis-forecast when available). */
  probability: number;
}

const MAX_ITEMS = 5;

/**
 * Rank the highest expected-information-gain checks across the given
 * hypotheses. Deduped by action label (an alternate-source check suggested
 * by three hypotheses appears once, at its highest gain). Returns [] when
 * the kill-switch is off, when there are no hypotheses, or when the
 * planner throws — the HUD renders its empty state in every case.
 */
export function buildCheckNextItems(inputs: readonly CheckNextInput[]): CollectionAction[] {
  if (!isCognitionEnabled('evoi-planner')) return [];
  if (inputs.length === 0) return [];
  try {
    const providerReport = getProviderRedundancyReport();
    const gaps = getCollectionGapDiscoveryService().getGaps();
    const best = new Map<string, CollectionAction>();
    for (const input of inputs) {
      const ctx = buildEvoiContext(input.probability, null, providerReport, gaps);
      const actions = planCollection(
        { kind: input.kind, statement: input.statement, confidence: input.probability },
        ctx,
      );
      for (const action of actions) {
        const existing = best.get(action.label);
        if (!existing || action.expectedInfoGainBits > existing.expectedInfoGainBits) {
          best.set(action.label, action);
        }
      }
    }
    return [...best.values()]
      .sort((a, b) => b.expectedInfoGainBits - a.expectedInfoGainBits)
      .slice(0, MAX_ITEMS);
  } catch {
    // Planner errors must never break the HUD render loop.
    return [];
  }
}
