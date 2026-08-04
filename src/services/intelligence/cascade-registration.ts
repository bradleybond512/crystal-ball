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
import {
  mineLeadLag,
  type LeadLagMiningResult,
  type PromotingLeadLagEdge,
} from '@/services/correlation/lead-lag';
import { learnedRulesFromEdges, syncLearnedRules } from '@/services/correlation/learned-rules';
import type { CorrelateEngine } from './correlate-engine';
import {
  INHIBITION_REFRESH_INTERVAL_MS,
  clearInhibitorySnapshot,
  evaluateActiveInhibitionShadow,
  invalidateInhibitorySnapshot,
  readInhibitionEnabled,
  recordInhibitionShadowError,
  replaceInhibitorySnapshot,
} from '@/services/correlation/inhibition';

const REFRESH_TICK_MS = INHIBITION_REFRESH_INTERVAL_MS;

export function computeSignificantEdges(history: readonly DomainEvent[]): PromotingLeadLagEdge[] {
  return [...mineLeadLag(history).promoting];
}

/** "from|to" keys for compound-risk (same contract as the old miner). */
export function computeCascadeKeys(history: readonly DomainEvent[]): string[] {
  return computeSignificantEdges(history).map((e) => `${e.from}|${e.to}`);
}

interface RefreshLearnedCascadeOptions {
  now?: number;
  engine?: Pick<CorrelateEngine, 'registerRule' | 'unregisterRule' | 'getRules'>;
  mine?: (events: readonly DomainEvent[]) => LeadLagMiningResult;
  inhibitionEnabled?: () => boolean;
}

export function refreshLearnedCascades(
  history: readonly DomainEvent[],
  options: RefreshLearnedCascadeOptions = {},
): void {
  const now = options.now ?? Date.now();
  try {
    if (isGhostMode()) {
      evaluateActiveInhibitionShadow(history, now, false);
      clearInhibitorySnapshot();
      return;
    }
    const enabled = (options.inhibitionEnabled ?? readInhibitionEnabled)();
    evaluateActiveInhibitionShadow(history, now, enabled);
    if (!enabled) clearInhibitorySnapshot();
    const result = options.mine
      ? options.mine(history)
      : mineLeadLag(history, { observationEndMs: now });
    const promoting = result.promoting;
    syncLearnedRules(
      options.engine ?? getSituationStoreV2().getEngine(),
      learnedRulesFromEdges(promoting),
    );
    registerLearnedCascadePairs(promoting.map((edge) => `${edge.from}|${edge.to}`));

    if (!enabled) {
      clearInhibitorySnapshot();
      return;
    }
    if (!result.family || result.inhibitory.length === 0) {
      if (Number.isFinite(now)) invalidateInhibitorySnapshot();
      else clearInhibitorySnapshot();
      return;
    }
    if (!Number.isFinite(now)) {
      recordInhibitionShadowError(now);
      clearInhibitorySnapshot();
      return;
    }
    replaceInhibitorySnapshot(
      result.inhibitory,
      result.family.criticalAbsZ,
      now,
    );
  } catch {
    recordInhibitionShadowError(now);
    clearInhibitorySnapshot();
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
