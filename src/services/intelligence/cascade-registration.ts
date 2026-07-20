/**
 * Learned-cascade cadence — hourly mining of empirical domain couplings
 * from situation history, feeding BOTH consumers:
 *
 *   1. compound-risk's cascade-pair table (existing key contract), and
 *   2. the live CorrelateEngine as capped `learned:*` rules (PR 3) — so
 *      discovered couplings actually correlate future events.
 *
 * Mining is statistically honest since PR 3: `mineLeadLag` normalizes
 * against the consequent's base rate (lift + z gates) instead of raw
 * follow-counting. See docs/CORRELATION_NEXTGEN_PLAN.md §D4.
 */

import type { DomainEvent } from './learned-cascades';
import { registerLearnedCascadePairs } from './compound-risk';
import { getSituationStoreV2 } from './situation-store-v2';
import { isGhostMode } from '@/services/mode-manager';
import { mineLeadLag, significantEdges, type LeadLagEdge } from '@/services/correlation/lead-lag';
import { learnedRulesFromEdges, syncLearnedRules } from '@/services/correlation/learned-rules';

const REFRESH_TICK_MS = 60 * 60 * 1000;

export function computeSignificantEdges(history: readonly DomainEvent[]): LeadLagEdge[] {
  return significantEdges(mineLeadLag(history));
}

/** "from|to" keys for compound-risk (same contract as the old miner). */
export function computeCascadeKeys(history: readonly DomainEvent[]): string[] {
  return computeSignificantEdges(history).map((e) => `${e.from}|${e.to}`);
}

export function refreshLearnedCascades(history: readonly DomainEvent[]): void {
  try {
    if (isGhostMode()) return;
    const edges = computeSignificantEdges(history);
    registerLearnedCascadePairs(edges.map((e) => `${e.from}|${e.to}`));
    syncLearnedRules(getSituationStoreV2().getEngine(), learnedRulesFromEdges(edges));
  } catch {
    // Never let cascade mining crash the caller.
  }
}

function situationHistoryToDomainEvents(): DomainEvent[] {
  return getSituationStoreV2()
    .list()
    .flatMap(s => s.observations.map(o => ({ domain: o.domain, at: o.timestamp })));
}

export function startLearnedCascadeCadence(): void {
  setInterval(() => {
    try {
      refreshLearnedCascades(situationHistoryToDomainEvents());
    } catch {
      // Never let the cadence timer crash the app.
    }
  }, REFRESH_TICK_MS);
}
