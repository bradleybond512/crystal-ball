import { mineCascades, cascadePairKeys } from './learned-cascades';
import type { DomainEvent } from './learned-cascades';
import { registerLearnedCascadePairs } from './compound-risk';
import { getSituationStoreV2 } from './situation-store-v2';
import { isGhostMode } from '@/services/mode-manager';

const REFRESH_TICK_MS = 60 * 60 * 1000;

export function computeCascadeKeys(history: readonly DomainEvent[]): string[] {
  return [...cascadePairKeys(mineCascades(history))];
}

export function refreshLearnedCascades(history: readonly DomainEvent[]): void {
  try {
    if (isGhostMode()) return;
    registerLearnedCascadePairs(computeCascadeKeys(history));
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
