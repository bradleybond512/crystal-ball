// src/services/survival/health-contributor.ts
/**
 * Wraps disease intelligence (WHO Disease Outbreak News + ReliefWeb epidemic
 * events) as a posture contributor on the `health` axis. Pure: no fetch/DOM/state
 * — takes the already-fetched `DiseaseIntelData` and maps the acute-outbreak
 * signals to health threats. Mirrors `mobility-contributor.ts`.
 *
 * This is a WORLD-STATE health signal (active outbreaks worldwide), not a
 * geolocated read of the user's exposure — the same framing the financial /
 * security / comms axes use.
 *
 * Two acute signals drive the axis:
 *  - WHO DON alerts — the WHO formally issuing a Disease Outbreak News is a
 *    significant event → `advisory` each.
 *  - ReliefWeb epidemic events — status `alert` (escalating) → `advisory`,
 *    `ongoing` (active) → `watch`, `past` (resolved) → dropped.
 *
 * Endemic COVID counts (`covidCountries`) are intentionally NOT mapped: the field
 * is a cumulative, ambiguous per-capita figure that would fire the axis
 * constantly rather than flag an acute change. Acute outbreak signals are the
 * health-axis drivers; a covid-surge signal can be added later with a clear
 * daily-change threshold.
 *
 * LIVE: wired in `storm-posture-state.withSupplyPosture` via the synchronous
 * `disease-intel.getCachedDiseaseIntel()` getter — the module cache is kept warm
 * by the scheduled `loadDiseaseIntel` loader (full build). A null cache yields no
 * health threats (fail-safe) until the first fetch resolves.
 */
import type { DiseaseIntelData, WhoDonAlert, EpidemicEvent } from '../disease-intel.ts';
import type { ThreatLevel } from '../weather/weather-threat-types.ts';
import { threatLevelToSeverity } from './survival-types.ts';
import type { PostureThreat } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';

const EPIDEMIC_STATUS_TO_THREAT: Record<EpidemicEvent['status'], ThreatLevel> = {
  alert: 'advisory',
  ongoing: 'watch',
  past: 'none',
};

function whoDonThreat(alert: WhoDonAlert): PostureThreat {
  const threatLevel: ThreatLevel = 'advisory';
  const disease = alert.disease || 'disease outbreak';
  const where = alert.country ? ` in ${alert.country}` : '';
  return {
    sourceEventId: `whodon-${alert.id}`,
    axis: 'health',
    severity: threatLevelToSeverity(threatLevel),
    threatLevel,
    hazardKind: 'other',
    hazardLabel: `WHO outbreak alert: ${disease}`,
    timeToImpactMins: null,
    arrivalLabel: null,
    why: `WHO Disease Outbreak News: ${disease}${where}`,
    confidenceLabel: 'high', // a formal WHO DON is a high-confidence source
  };
}

function epidemicThreat(event: EpidemicEvent, threatLevel: ThreatLevel): PostureThreat {
  const where = event.country ? ` (${event.country})` : '';
  return {
    sourceEventId: `epidemic-${event.id}`,
    axis: 'health',
    severity: threatLevelToSeverity(threatLevel),
    threatLevel,
    hazardKind: 'other',
    hazardLabel: `Epidemic ${event.status}: ${event.name}`,
    timeToImpactMins: null,
    arrivalLabel: null,
    why: `ReliefWeb epidemic ${event.status}: ${event.name}${where}`,
    confidenceLabel: 'medium',
  };
}

export function makeHealthContributor(data: DiseaseIntelData | null): PostureContributor {
  return {
    id: 'health',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      const threats: PostureThreat[] = [];
      if (!data) return threats;

      for (const alert of data.whoDon) {
        threats.push(whoDonThreat(alert));
      }
      for (const event of data.epidemicEvents) {
        const level = EPIDEMIC_STATUS_TO_THREAT[event.status];
        if (level === 'none') continue;
        threats.push(epidemicThreat(event, level));
      }

      // Worst-first; ties broken by id for a deterministic order.
      threats.sort((a, b) =>
        b.severity - a.severity || a.sourceEventId.localeCompare(b.sourceEventId));
      return threats;
    },
  };
}
