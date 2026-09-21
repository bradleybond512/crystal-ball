 
/**
 * Situation feed — wires the SituationEngine to the unified alert store
 * so it produces live OODA-loop output. Feeds high-severity alerts into
 * the engine, which clusters them into Situations, projects Scenarios,
 * and generates ActionCards.
 *
 * Also dispatches `cb:situations-updated` for the CrystalBallSays strip.
 */

import { situationEngine } from './situation-engine';
import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';

/**
 * Alerts the situation engine should observe. `correlation` alerts are the
 * engine's own output (situation-alert-bridge, compound-alert-bridge,
 * threat synthesis). Feeding them back in is a feedback loop: each echo
 * becomes a new pseudo-signal, a new situation with a new id, and a new
 * critical alert — measured live at 286 of 289 critical alerts, one Flood
 * Warning re-emitted 71 times. compound-alert-bridge already applies the
 * same exclusion to its own input.
 */
export function isEngineInput(alert: UnifiedAlert): boolean {
  return alert.source !== 'correlation';
}

let started = false;

export function startSituationFeed(): void {
  if (started) return;
  started = true;

  situationEngine.start();

  // Seed with existing alerts.
  const initial = unifiedAlertStore.getAll();
  const initialInputs = initial.filter((a) => isEngineInput(a));
  if (initialInputs.length > 0) situationEngine.observeAlerts(initialInputs);

  // Subscribe to new alerts.
  let prevIds = new Set(initial.map(a => a.id));
  unifiedAlertStore.subscribe(() => {
    const all = unifiedAlertStore.getAll();
    const newAlerts = all.filter(a => !prevIds.has(a.id) && isEngineInput(a));
    prevIds = new Set(all.map(a => a.id));
    if (newAlerts.length > 0) situationEngine.observeAlerts(newAlerts);
  });

  // Forward situation updates as DOM events for the UI strip.
  situationEngine.subscribe((situations) => {
    document.dispatchEvent(new CustomEvent('cb:situations-updated', {
      detail: { situations },
    }));
  });
}
