/**
 * Correlation posture contributor — cross-domain compound risk feeds
 * survival axis heat. When correlated situations compose into a
 * compound-risk cluster, the affected domains' axes warm up, and the E4
 * personal lens automatically lifts related board items (axisHeat).
 *
 * Correlation is inference, not observation: severity is capped below
 * the observational ceiling and confidence is never 'high'.
 * Pure: the snapshot is injected. See docs/CORRELATION_NEXTGEN_PLAN.md §D6.
 */

import type { CompoundRiskResult } from '../intelligence/compound-risk';
import type { PostureContributor } from './posture-contributor';
import type { PostureThreat } from './survival-types';
import { severityToThreatLevel } from './survival-types';
import { axisForDomain } from './personal-lens';
import type { SurvivalAxis } from './survival-types';

/** Compound clusters below this score stay off the posture board. */
const MIN_COMPOUND_SCORE = 40;
/** Inference ceiling — BELOW the direct-observation 'warning' severity
 *  (75), so posture's max-severity aggregation can never let a
 *  correlation outrank a directly observed alert on the same axis. */
const SEVERITY_CAP = 70;

export function makeCorrelationContributor(
  results: readonly CompoundRiskResult[] | null | undefined,
): PostureContributor {
  return {
    id: 'correlation',
    contribute(): PostureThreat[] {
      if (!results || results.length === 0) return [];
      const threats: PostureThreat[] = [];
      for (const result of results) {
        if (!Number.isFinite(result.score) || result.score < MIN_COMPOUND_SCORE) continue;
        // A single-situation "cluster" is not a correlation — the direct
        // contributors already cover it; emitting here would double-count.
        if (result.memberIds.length < 2) continue;
        const severity = Math.min(SEVERITY_CAP, Math.round(result.score));
        for (const axis of axesFor(result.affectedDomains)) {
          threats.push(threatFor(result, axis, severity));
        }
      }
      return threats;
    },
  };
}

function axesFor(domains: readonly string[]): SurvivalAxis[] {
  const axes = new Set<SurvivalAxis>();
  for (const domain of domains) axes.add(axisForDomain(domain));
  return [...axes];
}

function threatFor(
  result: CompoundRiskResult,
  axis: SurvivalAxis,
  severity: number,
): PostureThreat {
  const narrative = result.cascadePaths[0]?.narrative;
  return {
    sourceEventId: `compound:${result.id}`,
    axis,
    severity,
    threatLevel: severityToThreatLevel(severity),
    hazardKind: 'other',
    hazardLabel: result.headline,
    timeToImpactMins: null,
    arrivalLabel: null,
    why: narrative
      ? `${result.headline} — ${narrative}`
      : result.headline,
    // Inference from correlation — cap below 'high' by design.
    confidenceLabel: severity >= 70 ? 'medium' : 'low',
  };
}
