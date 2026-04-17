 
/**
 * Situation feed — wires the SituationEngine to the unified alert store
 * so it produces live OODA-loop output. Feeds high-severity alerts into
 * the engine, which clusters them into Situations, projects Scenarios,
 * and generates ActionCards.
 *
 * Also dispatches `cb:situations-updated` for the CrystalBallSays strip.
 */

import { situationEngine } from './situation-engine';
import { unifiedAlertStore } from './unified-alerts';

let started = false;

export function startSituationFeed(): void {
  if (started) return;
  started = true;

  situationEngine.start();

  // Seed with existing alerts.
  const initial = unifiedAlertStore.getAll();
  if (initial.length > 0) situationEngine.observeAlerts(initial);

  // Subscribe to new alerts.
  let prevIds = new Set(initial.map(a => a.id));
  unifiedAlertStore.subscribe(() => {
    const all = unifiedAlertStore.getAll();
    const newAlerts = all.filter(a => !prevIds.has(a.id));
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
