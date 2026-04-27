/**
 * Weather miss diagnostics — per
 * docs/WEATHER_WARNING_REMEDIATION_PLAN.md PR 4 (lines 357-364) and
 * section 12 (lines 291-321).
 *
 * The plan calls this section "important because the app failed the
 * user." Every missed or late weather alert should be diagnosable.
 *
 * This module produces "Why didn't I get warned?" debug packets that
 * trace the alert through the pipeline:
 *   - did NWS alert arrive?
 *   - did the sidecar fetch it?
 *   - did the alert normalize?
 *   - did saved-place matching work?
 *   - did notification routing suppress it?
 *   - did quiet hours block it?
 *   - was location missing?
 *   - was polygon matching too broad or too narrow?
 *   - was the alert treated as low relevance?
 *
 * Pure deterministic. Inputs are explicit pipeline traces; output is
 * a structured diagnostic that the UI / Claude can render.
 *
 * Plan invariant: "Every suppression should be diagnosable."
 */

import type {
  PolygonMatchResult,
  SavedPlace,
  ThreatLevel,
} from './weather-threat-types';

// ── Pipeline stage types ─────────────────────────────────────────────────

/** Outcome of one pipeline stage. */
export type StageOutcome = 'ok' | 'skipped' | 'failed' | 'unknown';

export interface PipelineStage {
  /** Stable id ("alert-fetched", "polygon-matched", "router-decision"). */
  id: string;
  /** Display label. */
  label: string;
  outcome: StageOutcome;
  /** Free-text reason — used in the rendered explanation. */
  reason: string;
  /** Optional structured details for the inspector tab. */
  detail?: Record<string, unknown>;
  /** ms timestamp when this stage ran. */
  at?: number;
}

// ── Trace input the diagnostic builder consumes ─────────────────────────

export interface DiagnosticTrace {
  /** Stable id of the alert being diagnosed. */
  alertId: string;
  /** Did the NWS API return this alert at all? */
  alertReceived: boolean;
  alertReceivedAt?: number;
  /** Did the sidecar/cache successfully store it? */
  sidecarStored?: boolean;
  /** Was the alert normalized into NwsAlertMinimal? */
  normalized?: boolean;
  normalizationError?: string;
  /** Polygon-matching result (PR 1). When undefined, polygon matching
   *  did not run (typically because there was no polygon). */
  polygonMatch?: PolygonMatchResult;
  /** Place(s) compared during matching. Used to surface "you have no
   *  saved places" type errors. */
  placesEvaluated?: readonly SavedPlace[];
  /** Did the notification router decide to dispatch? */
  routerDispatched?: boolean;
  /** Reason the router gave (passed through from the dispatcher). */
  routerReason?: string;
  /** Was the user in quiet hours / Do Not Disturb at the time? */
  quietHoursActive?: boolean;
  /** Did the user have weather quiet-hours bypass enabled? */
  quietHoursBypassEnabled?: boolean;
  /** Was the saved-place location missing or invalid? */
  locationMissing?: boolean;
  /** Did the relevance engine downscore this alert below threshold? */
  relevanceBelowThreshold?: boolean;
  /** Optional relevance score for the inspector. */
  relevanceScore?: number;
}

// ── Diagnostic result ────────────────────────────────────────────────────

export type DiagnosticVerdict =
  | 'delivered'             // alert reached the user as expected
  | 'suppressed'            // alert reached the pipeline but was filtered
  | 'undelivered_pipeline'  // pipeline failed to ingest the alert
  | 'undelivered_no_match'  // alert ingested, didn't match any place
  | 'unknown';

export interface WeatherDiagnostic {
  alertId: string;
  verdict: DiagnosticVerdict;
  /** Plain-text headline for the UI. */
  headline: string;
  /** Ordered pipeline stages with outcomes. */
  stages: PipelineStage[];
  /** Concrete suggestion the user can act on. */
  remediation: string[];
}

// ── Builder ──────────────────────────────────────────────────────────────

export function diagnoseAlert(trace: DiagnosticTrace): WeatherDiagnostic {
  const stages: PipelineStage[] = [
    buildAlertReceivedStage(trace),
    buildSidecarStage(trace),
    buildNormalizationStage(trace),
    buildPolygonStage(trace),
    buildRouterStage(trace),
    buildQuietHoursStage(trace),
    buildRelevanceStage(trace),
  ];

  const verdict = computeVerdict(stages, trace);
  const headline = buildHeadline(verdict, trace);
  const remediation = buildRemediation(verdict, trace, stages);

  return {
    alertId: trace.alertId,
    verdict,
    headline,
    stages,
    remediation,
  };
}

// ── Per-stage builders ──────────────────────────────────────────────────

function buildAlertReceivedStage(trace: DiagnosticTrace): PipelineStage {
  if (!trace.alertReceived) {
    return {
      id: 'alert-received',
      label: 'NWS alert received',
      outcome: 'failed',
      reason: 'NWS API did not return this alert during the polling window',
      at: trace.alertReceivedAt,
    };
  }
  return {
    id: 'alert-received',
    label: 'NWS alert received',
    outcome: 'ok',
    reason: 'Alert returned by NWS API',
    at: trace.alertReceivedAt,
  };
}

function buildSidecarStage(trace: DiagnosticTrace): PipelineStage {
  if (trace.sidecarStored === undefined) {
    return { id: 'sidecar-stored', label: 'Sidecar persistence', outcome: 'unknown', reason: 'Stage not traced' };
  }
  return {
    id: 'sidecar-stored',
    label: 'Sidecar persistence',
    outcome: trace.sidecarStored ? 'ok' : 'failed',
    reason: trace.sidecarStored ? 'Stored in sidecar cache' : 'Sidecar did not persist the alert',
  };
}

function buildNormalizationStage(trace: DiagnosticTrace): PipelineStage {
  if (trace.normalized === undefined) {
    return { id: 'normalized', label: 'Alert normalization', outcome: 'unknown', reason: 'Stage not traced' };
  }
  if (!trace.normalized) {
    return {
      id: 'normalized',
      label: 'Alert normalization',
      outcome: 'failed',
      reason: trace.normalizationError ?? 'Normalization failed (NwsAlertMinimal not produced)',
    };
  }
  return { id: 'normalized', label: 'Alert normalization', outcome: 'ok', reason: 'Normalized to NwsAlertMinimal' };
}

function buildPolygonStage(trace: DiagnosticTrace): PipelineStage {
  if (trace.locationMissing) {
    return {
      id: 'polygon-match',
      label: 'Polygon matching',
      outcome: 'skipped',
      reason: 'No saved place location — polygon matching could not run',
    };
  }
  if (trace.placesEvaluated?.length === 0) {
    return {
      id: 'polygon-match',
      label: 'Polygon matching',
      outcome: 'skipped',
      reason: 'No saved places configured — nothing to match against',
    };
  }
  if (!trace.polygonMatch) {
    return {
      id: 'polygon-match',
      label: 'Polygon matching',
      outcome: 'unknown',
      reason: 'Polygon match result not present in trace',
    };
  }
  const match = trace.polygonMatch;
  if (match.matchKind === 'no_match') {
    return {
      id: 'polygon-match',
      label: 'Polygon matching',
      outcome: 'skipped',
      reason: match.reason,
      detail: { matchKind: match.matchKind, distanceKm: match.distanceKm },
    };
  }
  return {
    id: 'polygon-match',
    label: 'Polygon matching',
    outcome: 'ok',
    reason: match.reason,
    detail: { matchKind: match.matchKind, threatLevel: match.threatLevel as ThreatLevel },
  };
}

function buildRouterStage(trace: DiagnosticTrace): PipelineStage {
  if (trace.routerDispatched === undefined) {
    return { id: 'router-decision', label: 'Notification router decision', outcome: 'unknown', reason: 'Stage not traced' };
  }
  if (trace.routerDispatched) {
    return {
      id: 'router-decision',
      label: 'Notification router decision',
      outcome: 'ok',
      reason: trace.routerReason ?? 'Notification dispatched',
    };
  }
  return {
    id: 'router-decision',
    label: 'Notification router decision',
    outcome: 'failed',
    reason: trace.routerReason ?? 'Notification suppressed by router',
  };
}

function buildQuietHoursStage(trace: DiagnosticTrace): PipelineStage {
  if (trace.quietHoursActive === undefined) {
    return { id: 'quiet-hours', label: 'Quiet hours check', outcome: 'unknown', reason: 'Stage not traced' };
  }
  if (!trace.quietHoursActive) {
    return { id: 'quiet-hours', label: 'Quiet hours check', outcome: 'ok', reason: 'Quiet hours not active' };
  }
  if (trace.quietHoursBypassEnabled) {
    return {
      id: 'quiet-hours',
      label: 'Quiet hours check',
      outcome: 'ok',
      reason: 'Quiet hours active but weather bypass is enabled',
    };
  }
  return {
    id: 'quiet-hours',
    label: 'Quiet hours check',
    outcome: 'failed',
    reason: 'Quiet hours active and weather bypass is disabled — notification suppressed',
  };
}

function buildRelevanceStage(trace: DiagnosticTrace): PipelineStage {
  if (trace.relevanceBelowThreshold === undefined) {
    return { id: 'relevance', label: 'Relevance threshold', outcome: 'unknown', reason: 'Stage not traced' };
  }
  if (!trace.relevanceBelowThreshold) {
    return {
      id: 'relevance',
      label: 'Relevance threshold',
      outcome: 'ok',
      reason: trace.relevanceScore === undefined
        ? 'Cleared relevance threshold'
        : `Relevance score ${trace.relevanceScore} cleared the threshold`,
    };
  }
  return {
    id: 'relevance',
    label: 'Relevance threshold',
    outcome: 'failed',
    reason: trace.relevanceScore === undefined
      ? 'Below relevance threshold — suppressed'
      : `Relevance score ${trace.relevanceScore} below threshold — suppressed`,
  };
}

// ── Verdict + headline ─────────────────────────────────────────────────

function computeVerdict(stages: readonly PipelineStage[], trace: DiagnosticTrace): DiagnosticVerdict {
  if (!trace.alertReceived) return 'undelivered_pipeline';
  // Pipeline failures up to + including normalization.
  for (const id of ['sidecar-stored', 'normalized']) {
    const s = stages.find((x) => x.id === id);
    if (s?.outcome === 'failed') return 'undelivered_pipeline';
  }
  const polygon = stages.find((s) => s.id === 'polygon-match')!;
  if (polygon.outcome === 'skipped' && /no saved place/i.test(polygon.reason)) return 'undelivered_pipeline';
  if (polygon.outcome === 'skipped') return 'undelivered_no_match';
  // Pipeline got past matching; determine if router suppressed.
  const router = stages.find((s) => s.id === 'router-decision')!;
  const quiet = stages.find((s) => s.id === 'quiet-hours')!;
  const relev = stages.find((s) => s.id === 'relevance')!;
  if (router.outcome === 'ok') return 'delivered';
  if (router.outcome === 'failed' || quiet.outcome === 'failed' || relev.outcome === 'failed') {
    return 'suppressed';
  }
  return 'unknown';
}

function buildHeadline(verdict: DiagnosticVerdict, trace: DiagnosticTrace): string {
  switch (verdict) {
    case 'delivered': {
      return `Notification delivered for ${trace.alertId}`;
    }
    case 'suppressed': {
      return `Suppressed: ${trace.alertId} reached the pipeline but was filtered`;
    }
    case 'undelivered_pipeline': {
      return `Undelivered: pipeline did not ingest ${trace.alertId}`;
    }
    case 'undelivered_no_match': {
      return `Undelivered: ${trace.alertId} did not match any saved place`;
    }
    case 'unknown': {
      return `Diagnostic incomplete for ${trace.alertId}`;
    }
  }
}

// ── Remediation hints ───────────────────────────────────────────────────

function buildRemediation(
  verdict: DiagnosticVerdict,
  trace: DiagnosticTrace,
  stages: readonly PipelineStage[],
): string[] {
  const out: string[] = [];

  if (!trace.alertReceived) {
    out.push('Verify NWS API connectivity and the polling interval — the alert never arrived.');
  }

  const polygon = stages.find((s) => s.id === 'polygon-match');
  if (polygon?.outcome === 'skipped') {
    if (/no saved place/i.test(polygon.reason)) {
      out.push('Add a saved place so the matcher has a target to compare against.');
    } else if (/no UGC zone overlap/i.test(polygon.reason)) {
      out.push('Configure UGC zones for your saved place(s) so polygon-less alerts can fall back to zone matching.');
    } else if (polygon.detail && typeof polygon.detail.distanceKm === 'number') {
      const km = polygon.detail.distanceKm as number;
      out.push(`Saved place was ${km.toFixed(0)} km from the polygon. If you want broader coverage, add a buffer radius to your place.`);
    } else {
      out.push('Polygon matching skipped — review the saved-place coordinates and alert polygon geometry.');
    }
  }

  const quiet = stages.find((s) => s.id === 'quiet-hours');
  if (quiet?.outcome === 'failed') {
    out.push('Enable "Bypass quiet hours for severe weather" in Settings so future tornado / flash flood / severe-TS warnings break through DND.');
  }

  const router = stages.find((s) => s.id === 'router-decision');
  if (router?.outcome === 'failed' && quiet?.outcome !== 'failed') {
    out.push(`Router suppressed: ${router.reason}. Review notification rules.`);
  }

  const relev = stages.find((s) => s.id === 'relevance');
  if (relev?.outcome === 'failed') {
    out.push('Relevance threshold filtered this alert. Either raise the alert\'s severity weighting or tag the affected entity in your watchlist.');
  }

  if (out.length === 0 && verdict === 'delivered') {
    out.push('Pipeline operated as designed — no remediation needed.');
  } else if (out.length === 0) {
    out.push('No specific remediation identified — check the inspector tab for stage details.');
  }

  return out;
}
