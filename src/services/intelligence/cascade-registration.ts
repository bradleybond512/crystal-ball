import { mineCascades, cascadePairKeys } from './learned-cascades';
import type { DomainEvent } from './learned-cascades';
import { registerLearnedCascadePairs } from './compound-risk';
import { isGhostMode } from '@/services/mode-manager';

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
