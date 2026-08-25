// src/services/survival/financial-contributor.ts
/**
 * Wraps mode-forecast finance pressure as a posture contributor on the
 * `financial` axis. The threat is tied to the model's own `finance` advisory
 * (which the forecast only emits once its own threshold is crossed), so no
 * thresholds are invented here. Pure: no fetch/DOM/state.
 *
 * The live source is `getForecastSnapshot()` (a synchronous localStorage read,
 * no sidecar), wired in storm-posture-state.ts.
 */
import type { ForecastSnapshot } from '../mode-forecast.ts';
import type { PostureThreat } from './survival-types.ts';
import { severityToThreatLevel } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';
import { MODE_FORECAST_THREAT_SOURCE_IDS } from './mode-forecast-threats.ts';
import { formatDurationMinutes } from '../../utils/format-duration.ts';

export function makeFinancialContributor(snapshot: ForecastSnapshot): PostureContributor {
  return {
    id: 'financial',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      const adv = (snapshot.advisories ?? []).find((a) => a.domain === 'finance');
      if (!adv) return [];
      const severity = Math.max(0, Math.min(100, Math.round(adv.pressure * 100)));
      return [{
        sourceEventId: MODE_FORECAST_THREAT_SOURCE_IDS.finance,
        axis: 'financial',
        severity,
        threatLevel: severityToThreatLevel(severity),
        hazardKind: 'other',
        hazardLabel: 'Financial pressure elevated',
        timeToImpactMins: adv.etaMin,
        arrivalLabel: adv.etaMin === null ? null : `~${formatDurationMinutes(adv.etaMin)} to threshold`,
        why: adv.statement,
        confidenceLabel: adv.pressure >= 0.75 ? 'high' : 'medium',
      }];
    },
  };
}
