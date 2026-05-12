/**
 * Wires the custom alert rules engine into the ObservationStore ingest
 * stream. Called once during app boot (panel-layout `start*` sequence).
 *
 * The bootstrapper:
 *   1. Loads the persisted rules from localStorage.
 *   2. Subscribes to ObservationStore.onIngest.
 *   3. On every ingested event, runs evaluate(event, rules) and fires
 *      runRuleActions for each matching rule.
 *   4. Re-persists the rules with bumped triggerCount + lastTriggered
 *      timestamps so the panel reflects fresh activity.
 *
 * Pure side effect — no UI, no DOM. The panel reads the same localStorage
 * key, so user edits and ingest-triggered counter bumps converge on the
 * next render.
 */

import { onIngest } from './observation-store';
import {
  evaluate,
  loadRules,
  runRuleActions,
  saveRules,
} from './rules-engine';
import type { AlertRule, ObservationEvent } from '@/types/intelligence';

let _started = false;
let _unsubscribe: (() => void) | null = null;

export function startRulesEngineBootstrap(): void {
  if (_started) return;
  _started = true;
  _unsubscribe = onIngest((event: ObservationEvent) => {
    const rules = loadRules();
    if (rules.length === 0) return;
    const triggered = evaluate(event, rules);
    if (triggered.length === 0) return;
    const updated: AlertRule[] = rules.map((r) => {
      const match = triggered.find((t) => t.id === r.id);
      if (!match) return r;
      const result = runRuleActions(r, event);
      return result.rule;
    });
    saveRules(updated);
  });
}

/** Test seam — stops the listener and resets internal state. */
export function stopRulesEngineBootstrap(): void {
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = null;
  _started = false;
}
