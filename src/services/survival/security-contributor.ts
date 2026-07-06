// src/services/survival/security-contributor.ts
/**
 * Wraps mode-forecast `security` + `cyber` pressure as a posture contributor on
 * the `security` axis. Both threats are tied to the model's own advisories
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
import { formatDurationMinutes } from '../../utils/format-duration.ts';

const MAPPED = [
  { domain: 'security' as const, hazardLabel: 'Security pressure elevated', sourceEventId: 'security-pressure' },
  { domain: 'cyber' as const, hazardLabel: 'Cyber threat pressure elevated', sourceEventId: 'cyber-pressure' },
];

export function makeSecurityContributor(snapshot: ForecastSnapshot): PostureContributor {
  return {
    id: 'security',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      const threats: PostureThreat[] = [];
      for (const entry of MAPPED) {
        const adv = (snapshot.advisories ?? []).find((a) => a.domain === entry.domain);
        if (!adv) continue;
        const severity = Math.max(0, Math.min(100, Math.round(adv.pressure * 100)));
        threats.push({
          sourceEventId: entry.sourceEventId,
          axis: 'security',
          severity,
          threatLevel: severityToThreatLevel(severity),
          hazardKind: 'other',
          hazardLabel: entry.hazardLabel,
          timeToImpactMins: adv.etaMin,
          arrivalLabel: adv.etaMin === null ? null : `~${formatDurationMinutes(adv.etaMin)} to threshold`,
          why: adv.statement,
          confidenceLabel: adv.pressure >= 0.75 ? 'high' : 'medium',
        });
      }
      return threats;
    },
  };
}
