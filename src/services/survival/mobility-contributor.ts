// src/services/survival/mobility-contributor.ts
/**
 * Wraps maritime chokepoint stress (closure risk from incidents + military
 * density) as a posture contributor on the `mobility` axis. Pure: no
 * fetch/DOM/state — takes the already-computed `ChokepointStatus[]` from
 * `monitorChokepoints`/`aggregateChokepointStatus` and maps each stressed
 * chokepoint to a mobility threat. Mirrors `energy-water-contributor.ts`.
 *
 * Threat mapping is faithful to the monitor's own bands (chokepoint-monitor.ts
 * `thresholdLevel`): green→none, yellow→watch, orange→advisory, red→warning.
 * A red chokepoint escalates to `emergency` only at `closureRisk >= 90` — a
 * near-certain closure of a strategic strait is a mobility emergency; anything
 * short of that stays at `warning` because the model scores closure RISK, not
 * confirmed closure.
 *
 * LIVE: wired in `storm-posture-state.withSupplyPosture`. The intended
 * incident + military `aggregateChokepointStatus` model has no sync-readable live
 * source (its GDACS/ACLED/AIS feeds aren't cached synchronously), so the live
 * path adapts the sidecar's throughput chokepoint feed via
 * `chokepoint-mobility-adapter.ts` (`disruptionScore → closureRisk`) read through
 * `supply-chain.getCachedChokepointInfo`, kept warm by the shortage supply loader.
 * Because that source has no incident history, live mobility threats land at
 * 'medium' confidence. This contributor still accepts a full `ChokepointStatus[]`,
 * so a future incident-driven source can feed it directly with no changes here.
 */
import type { ChokepointStatus } from '../maritime/chokepoint-monitor.ts';
import type { ThreatLevel } from '../weather/weather-threat-types.ts';
import { threatLevelToSeverity } from './survival-types.ts';
import type { PostureThreat } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';

/** closureRisk at/above which a `red` chokepoint is treated as a mobility emergency. */
const EMERGENCY_CLOSURE_RISK = 90;

function chokepointToThreatLevel(status: ChokepointStatus): ThreatLevel {
  switch (status.threatLevel) {
    case 'green': {
      return 'none';
    }
    case 'yellow': {
      return 'watch';
    }
    case 'orange': {
      return 'advisory';
    }
    case 'red': {
      return status.closureRisk >= EMERGENCY_CLOSURE_RISK ? 'emergency' : 'warning';
    }
  }
}

function makeThreat(status: ChokepointStatus, threatLevel: ThreatLevel): PostureThreat {
  const driver = status.drivers[0] ?? 'Elevated closure risk';
  const why = `${driver} — ${status.globalTradePctNote} (closure risk ${status.closureRisk}/100)`;
  // Real incidents in the window are direct evidence; a score driven only by
  // military-vessel density is a softer, model-derived signal.
  const confidenceLabel = status.incidentCount7d > 0 ? 'high' : 'medium';
  return {
    sourceEventId: `chokepoint-${status.id}`,
    axis: 'mobility',
    severity: threatLevelToSeverity(threatLevel),
    threatLevel,
    hazardKind: 'other',
    hazardLabel: `Chokepoint disruption: ${status.name}`,
    timeToImpactMins: null,
    arrivalLabel: null,
    why,
    confidenceLabel,
  };
}

export function makeMobilityContributor(statuses: readonly ChokepointStatus[]): PostureContributor {
  return {
    id: 'mobility',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      const entries: { threat: PostureThreat; closureRisk: number }[] = [];
      for (const status of statuses) {
        const level = chokepointToThreatLevel(status);
        if (level === 'none') continue;
        entries.push({ threat: makeThreat(status, level), closureRisk: status.closureRisk });
      }
      // Worst-first so the axis headline surfaces the most-stressed chokepoint.
      // Two chokepoints in the same band (e.g. both `warning`) share a survival
      // severity, so tie-break on raw closure risk — the higher-risk strait
      // should lead — then on id for a fully deterministic order.
      entries.sort((a, b) =>
        b.threat.severity - a.threat.severity
        || b.closureRisk - a.closureRisk
        || a.threat.sourceEventId.localeCompare(b.threat.sourceEventId));
      return entries.map((e) => e.threat);
    },
  };
}
