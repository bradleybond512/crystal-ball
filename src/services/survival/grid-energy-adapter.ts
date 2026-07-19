// src/services/survival/grid-energy-adapter.ts
/**
 * Adapts the live power-grid alert feed (`power-grid-alerts` `PowerGridAlert`)
 * into the `PowerPostureInput` the energy_water posture contributor consumes.
 *
 * The energy_water contributor scores three inputs: grid utilization %, nearby
 * outage count, and grid alerts. Only the grid-alert feed has a sync-readable
 * live source today — there is no live feed for grid utilization or a
 * location-scoped outage count — so those are left `null` (which the contributor's
 * `levelForUtil`/`levelForOutage` treat as 'normal', i.e. no threat). Grid alerts
 * are the acute energy signal, so this is a meaningful partial live wiring, not a
 * degraded stand-in.
 *
 * Pure: no fetch/DOM/state.
 */
import type { PowerGridAlert } from '../power-grid-alerts';
import type { PowerPostureInput } from '../datacenter/power-posture.ts';
import type { GridAlert } from '../power-grid.ts';

// PowerGridAlert carries a scored severity (critical/high/medium/low); map it to
// the GridAlert severity band the energy_water contributor understands.
const SEVERITY_MAP: Record<PowerGridAlert['severity'], GridAlert['severity']> = {
  critical: 'emergency',
  high: 'warning',
  medium: 'watch',
  low: 'info',
};

function toGridAlert(a: PowerGridAlert): GridAlert {
  return {
    id: a.id,
    severity: SEVERITY_MAP[a.severity],
    title: a.title,
    description: a.description,
    region: a.region,
    timestamp: a.pubDate.getTime(),
  };
}

/** Map the live grid-alert feed to the energy_water contributor's input. Grid
 * utilization and nearby-outage count have no live source → null (no threat). */
export function adaptPowerGridAlertsToInput(alerts: readonly PowerGridAlert[]): PowerPostureInput {
  return {
    gridUtilizationPct: null,
    nearbyOutageCount: null,
    gridAlerts: alerts.map((a) => toGridAlert(a)),
  };
}
