// src/services/survival/comms-contributor.ts
/**
 * Wraps internet-outage detection (IODA country/AS-level blackout scores) as a
 * posture contributor on the `comms` axis. Pure: no fetch/DOM/state — takes the
 * already-fetched `IodaOutage[]` and maps each ONGOING outage to a comms threat.
 * Mirrors `mobility-contributor.ts` / `energy-water-contributor.ts`.
 *
 * This is a WORLD-STATE comms signal (global internet health / shutdown
 * activity), not a geolocated read of the user's own connectivity — the same
 * framing the financial/security axes use with mode-forecast. Only ongoing
 * outages surface; a resolved (past) outage is not a current comms threat.
 *
 * Severity mapping is faithful to IODA's own bands (internet-outages.ts
 * `scoreToSeverity`): low→none, medium→watch, high→advisory, critical→warning.
 * A critical COUNTRY-level ongoing outage escalates to `emergency` — a national
 * internet shutdown is a comms emergency; an AS/region-level critical outage is
 * narrower and stays at `warning`.
 *
 * LIVE: wired in `storm-posture-state.withSupplyPosture` via the synchronous
 * `internet-outages.getCachedIodaOutages(now)` getter. `fetchIodaOutages` now
 * routes through the sidecar `/api/internet-outages` endpoint and is warmed by
 * the scheduled `loadInternetOutages` loader (full build, 3 min — the cadence
 * this axis DEPENDS on: `getCachedIodaOutages` returns [] once its cache is
 * >= 10 min old, and the refetch is lazy, so a slower loader leaves this axis
 * silently reporting no comms threats for part of every cycle). Because that sidecar
 * projection carries a single `datasource` per alert rather than the split
 * BGP/active/darknet sub-scores, comms confidence lands at 'medium' in practice.
 */
import type { IodaOutage } from '../internet-outages.ts';
import type { ThreatLevel } from '../weather/weather-threat-types.ts';
import { threatLevelToSeverity } from './survival-types.ts';
import type { PostureThreat } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';

const SEVERITY_TO_THREAT: Record<IodaOutage['severity'], ThreatLevel> = {
  low: 'none',
  medium: 'watch',
  high: 'advisory',
  critical: 'warning',
};

function outageToThreatLevel(outage: IodaOutage): ThreatLevel {
  const base = SEVERITY_TO_THREAT[outage.severity];
  // A whole-country critical blackout is the comms-axis emergency case.
  if (base === 'warning' && outage.entityType === 'country') return 'emergency';
  return base;
}

/** Count of IODA sub-signals (BGP / active probing / darknet) that reported a
 * value — more corroborating signals ⇒ higher confidence in the outage. */
function corroboratingSignals(outage: IodaOutage): number {
  let n = 0;
  if (outage.bgpScore !== null) n++;
  if (outage.activeScore !== null) n++;
  if (outage.darknetsScore !== null) n++;
  return n;
}

function makeThreat(outage: IodaOutage, threatLevel: ThreatLevel): PostureThreat {
  const scope = outage.entityType === 'asn' ? 'network' : outage.entityType;
  return {
    sourceEventId: outage.id,
    axis: 'comms',
    severity: threatLevelToSeverity(threatLevel),
    threatLevel,
    hazardKind: 'other',
    hazardLabel: `Internet outage: ${outage.entityName}`,
    timeToImpactMins: null,
    arrivalLabel: null,
    why: `${outage.severity} ${scope}-level internet outage (IODA score ${outage.score.toFixed(2)}), ongoing`,
    confidenceLabel: corroboratingSignals(outage) >= 2 ? 'high' : 'medium',
  };
}

export function makeCommsContributor(outages: readonly IodaOutage[]): PostureContributor {
  return {
    id: 'comms',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      const entries: { threat: PostureThreat; score: number }[] = [];
      for (const outage of outages) {
        if (!outage.isOngoing) continue; // resolved outages aren't a current threat
        const level = outageToThreatLevel(outage);
        if (level === 'none') continue;
        entries.push({ threat: makeThreat(outage, level), score: outage.score });
      }
      // Worst-first so the axis headline surfaces the most severe blackout; two
      // outages in the same band share a severity, so tie-break on the raw IODA
      // score, then id for a fully deterministic order.
      entries.sort((a, b) =>
        b.threat.severity - a.threat.severity
        || b.score - a.score
        || a.threat.sourceEventId.localeCompare(b.threat.sourceEventId));
      return entries.map((e) => e.threat);
    },
  };
}
