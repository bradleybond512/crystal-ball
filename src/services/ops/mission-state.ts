/**
 * Mission state singleton.
 *
 * Mirrors `src/services/algorithms/algorithms-state.ts` — a small
 * accessor that lets feature code open and update missions without
 * having to thread the ledger instance through every layer.
 *
 * The pure ledger module (`mission-ledger.ts`) stays free of side
 * effects; this file owns the live singleton + a reset helper for
 * tests.
 */

import { createMissionLedger, type MissionLedger } from './mission-ledger';

let ledger: MissionLedger | undefined;

export function getMissionLedger(): MissionLedger {
  ledger ??= createMissionLedger();
  return ledger;
}

export function resetMissionState(): void {
  ledger = undefined;
}
