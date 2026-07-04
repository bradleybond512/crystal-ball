/**
 * Ask-the-data live context adapter — wires the pure `answer()` engine
 * (ask-the-data.ts, gap #5) to the running app's diagnostics registries.
 *
 * ask-the-data itself is pure and takes an AskContext snapshot; this module
 * is the one place that assembles that snapshot from the live singletons
 * (feature health, panel health, mission ledger), mirroring how
 * SystemDiagnosticPanel reads the same registries.
 *
 * No DOM, no fetch — safe to import from any panel.
 */

import { answer, type AnswerPacket, type AskContext } from './ask-the-data';
import {
  getFeatureHealthRegistry,
  getPanelHealthRegistry,
} from '@/services/diagnostics/diagnostics-state';
import { getMissionLedger } from '@/services/ops/mission-state';

/** Snapshot the live registries into the pure AskContext shape. */
export function buildLiveAskContext(now: () => number = Date.now): AskContext {
  return {
    features: getFeatureHealthRegistry().all(),
    panels: getPanelHealthRegistry().all(),
    missions: getMissionLedger().all(),
    generatedAt: now(),
  };
}

/** Answer a question against the live app state. */
export function askLive(question: string): AnswerPacket {
  return answer(question, buildLiveAskContext());
}
