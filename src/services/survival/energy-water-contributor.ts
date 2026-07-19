// src/services/survival/energy-water-contributor.ts
/**
 * Wraps grid/power stress (utilization, nearby outages, grid alerts) as a
 * posture contributor on the `energy_water` axis. Pure: no fetch/DOM/state.
 * Reuses the datacenter power-posture level helpers so thresholds stay DRY.
 *
 * LIVE (partial): wired in `storm-posture-state.withSupplyPosture` via
 * `grid-energy-adapter.ts` reading `power-grid-alerts.getCachedPowerGridAlerts`
 * (kept warm by the shortage supply loader). Only the grid-alert input has a
 * sync-readable live source; grid utilization % and nearby-outage count have no
 * live feed today, so they stay `null` (→ 'normal' → no threat). Grid alerts are
 * the acute energy signal, so the axis surfaces real threats; adding a utilization
 * or outage-count feed later only needs the adapter to populate those fields.
 */
import type { PowerPostureInput } from '../datacenter/power-posture.ts';
import { levelForUtil, levelForOutage, levelForAlert } from '../datacenter/power-posture.ts';
import type { DcLevel } from '../datacenter/datacenter-types.ts';
import type { ThreatLevel } from '../weather/weather-threat-types.ts';
import { threatLevelToSeverity } from './survival-types.ts';
import type { PostureThreat } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';

const DC_TO_THREAT: Record<DcLevel, ThreatLevel> = {
  normal: 'none',
  watch: 'watch',
  advisory: 'advisory',
  warning: 'warning',
  critical: 'emergency',
};

function makeThreat(
  sourceEventId: string,
  dcLevel: DcLevel,
  hazardLabel: string,
  why: string,
  confidenceLabel: 'low' | 'medium' | 'high',
): PostureThreat {
  const threatLevel = DC_TO_THREAT[dcLevel];
  return {
    sourceEventId,
    axis: 'energy_water',
    severity: threatLevelToSeverity(threatLevel),
    threatLevel,
    hazardKind: 'other',
    hazardLabel,
    timeToImpactMins: null,
    arrivalLabel: null,
    why,
    confidenceLabel,
  };
}

export function makeEnergyWaterContributor(input: PowerPostureInput): PostureContributor {
  return {
    id: 'energy_water',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      const threats: PostureThreat[] = [];

      const u = levelForUtil(input.gridUtilizationPct);
      if (u !== 'normal') {
        threats.push(makeThreat(
          'grid-util',
          u,
          'Grid capacity strain',
          `Grid at ${input.gridUtilizationPct}% of capacity`,
          'medium',
        ));
      }

      const o = levelForOutage(input.nearbyOutageCount);
      if (o !== 'normal') {
        threats.push(makeThreat(
          'grid-outage',
          o,
          'Power outage nearby',
          `${(input.nearbyOutageCount! / 1000).toFixed(1)}k customers out nearby`,
          'high',
        ));
      }

      for (const a of input.gridAlerts) {
        const l = levelForAlert(a.severity);
        if (l !== 'normal') {
          threats.push(makeThreat(
            `grid-alert-${a.id}`,
            l,
            `Grid alert: ${a.title}`,
            `${a.severity} grid alert in ${a.region}`,
            'high',
          ));
        }
      }

      return threats;
    },
  };
}
