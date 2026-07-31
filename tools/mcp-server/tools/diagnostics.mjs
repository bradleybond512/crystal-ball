import { z } from 'zod';
import { publicAlgorithmDiagnostics } from '../forecast-evaluation-public.mjs';
import { quarantinedAlgorithmIds } from '../safety-policy.mjs';

const HEALTHY = new Set(['healthy', 'ok', 'fresh', 'up', 'operational']);

export const schemas = {
  diagnose_runtime: {
    description:
      'Fast live troubleshooting pass across the Crystal Ball sidecar, feed health, renderer state, and optional 10-route self-test. Returns ranked findings and next actions.',
    inputSchema: z.object({
      deep: z.boolean().optional().describe('Run the slower 10-route sidecar self-test (default false).'),
      detail: z.enum(['compact', 'full']).optional().describe('Response detail level (default compact).'),
      sections: z.array(z.enum([
        'sidecar',
        'feeds',
        'renderer',
        'algorithms',
        'selfTest',
        'findings',
      ])).optional().describe('Return only selected sections plus status fields.'),
    }),
  },
  get_algorithm_diagnostics: {
    description:
      'Current algorithm health, leakage-safe chronological holdout metrics, bounded Brier-loss attribution and worst source/domain/horizon cohorts, resolution backlog and label origins, weather ground-truth coverage, evaluation retention, p50/p95 latency, runtime errors, bounded tuning parameters, proposals, and recent tuning decisions from the live renderer.',
    inputSchema: z.object({}),
  },
};

export function makeDiagnosticsTools(client) {
  return {
    async diagnose_runtime(args = {}) {
      const routes = ['/api/health', '/api/feeds/health', '/api/analyst-state'];
      if (args.deep === true) routes.push('/api/diagnostics/self-test');
      const responses = await Promise.all(routes.map((route) => client.get(route)));
      const [health, feeds, analyst, selfTest = null] = responses;
      const findings = [];
      const algorithmDiagnostics = publicAlgorithmDiagnostics(
        analyst?.algorithmDiagnostics,
      );

      if (health?.ok !== true) {
        findings.push(finding(
          'runtime.sidecar_unavailable',
          'red',
          'The local API sidecar is unavailable.',
          'Launch Crystal Ball and inspect desktop.log if the sidecar does not recover.',
        ));
      }

      for (const feed of Array.isArray(feeds?.feeds) ? feeds.feeds : []) {
        const status = String(feed.status ?? feed.state ?? feed.health ?? '').toLowerCase();
        if (!status || HEALTHY.has(status)) continue;
        const id = String(feed.id ?? feed.name ?? feed.feedId ?? 'unknown');
        findings.push(finding(
          `feed.${id}`,
          'yellow',
          `${id} is ${status}.`,
          'Check provider credentials and upstream health before changing resilience thresholds.',
        ));
      }

      if (analyst?.available !== true) {
        findings.push(finding(
          'renderer.mirror_unavailable',
          'yellow',
          'Renderer diagnostics are unavailable.',
          'Keep the Crystal Ball window open for fifteen seconds and retry.',
        ));
      } else if (analyst.stale === true) {
        findings.push(finding(
          'renderer.mirror_stale',
          'yellow',
          'Renderer diagnostics are stale.',
          'Inspect renderer errors and confirm the sidecar diagnostics push loop is ticking.',
        ));
      }

      for (const algorithm of algorithmDiagnostics?.health?.algorithms ?? []) {
        if (!['unsafe', 'failing', 'degraded'].includes(algorithm.status)) continue;
        findings.push(finding(
          `algorithm.${algorithm.status}.${algorithm.algorithmId}`,
          algorithm.status === 'degraded' ? 'yellow' : 'red',
          `${algorithm.algorithmId} is ${algorithm.status}: ${algorithm.reason ?? ''}`.trim(),
          algorithm.recommendedAdjustment || 'Replay recent evaluations before changing a tuning parameter.',
        ));
      }
      const weatherReports = algorithmDiagnostics
        ?.forecastCalibration?.weatherReports;
      const pendingWarnings = Number(
        weatherReports?.pendingWarningPredictions ?? 0,
      );
      const weatherStatus = String(weatherReports?.status ?? 'missing');
      if (pendingWarnings > 0 && weatherStatus !== 'fresh') {
        findings.push(finding(
          `forecast.weather_reports_${weatherStatus}`,
          'yellow',
          `${pendingWarnings} warning forecast(s) are waiting on ${weatherStatus} storm-report evidence.`,
          'Check the Iowa State LSR feed and weatherReports coverage before tuning weather confidence.',
        ));
      }
      inspectResolutionQuality(
        algorithmDiagnostics?.forecastCalibration,
        findings,
      );
      inspectForecastEvaluation(
        algorithmDiagnostics?.forecastCalibration,
        findings,
      );

      const failedSelfTests = Number(selfTest?.summary?.fail ?? selfTest?.summary?.failed ?? 0);
      const degradedSelfTests = Number(selfTest?.summary?.degraded ?? 0);
      if (failedSelfTests > 0) {
        findings.push(finding(
          'self_test.failed',
          'red',
          `${failedSelfTests} deep self-test probe(s) failed.`,
          'Inspect the failed routes and their upstream providers.',
        ));
      } else if (degradedSelfTests > 0) {
        findings.push(finding(
          'self_test.degraded',
          'yellow',
          `${degradedSelfTests} deep self-test probe(s) were degraded.`,
          'Compare route latency with provider status and retry after cooldown.',
        ));
      }

      const status = findings.some((entry) => entry.severity === 'red')
        ? 'red'
        : findings.length > 0
          ? 'yellow'
          : 'green';
      const base = {
        available: health?.ok === true,
        status,
        summary: findings.length === 0
          ? 'No actionable live runtime problems detected.'
          : `${findings.length} ranked finding(s).`,
        timestamp: new Date().toISOString(),
      };
      const renderer = analyst?.available === true
        ? { available: true, stale: analyst.stale === true, ageMs: analyst.ageMs ?? null }
        : { available: false };
      const quarantinedAlgorithms = quarantinedAlgorithmIds(algorithmDiagnostics?.health);
      const compact = {
        ...base,
        sidecar: summarizeSidecar(health),
        feedSummary: summarizeFeeds(feeds?.feeds),
        renderer,
        algorithmSummary: summarizeAlgorithmSnapshot(algorithmDiagnostics),
        quarantinedAlgorithms,
        selfTest: summarizeSelfTest(selfTest),
        findings,
      };
      const full = {
        ...base,
        sidecar: health,
        feedSummary: summarizeFeeds(feeds?.feeds),
        renderer,
        algorithms: algorithmDiagnostics,
        quarantinedAlgorithms,
        selfTest,
        findings,
      };
      const selected = args.detail === 'full' ? full : compact;
      return projectSections(selected, args.sections);
    },

    async get_algorithm_diagnostics() {
      const state = await client.get('/api/analyst-state');
      if (!state?.available) {
        return {
          available: false,
          summary: state?.message || 'Crystal Ball is not running or has not pushed renderer diagnostics yet.',
          timestamp: new Date().toISOString(),
        };
      }
      if (!state.algorithmDiagnostics) {
        return {
          available: false,
          summary: 'The running app has not pushed an algorithm diagnostics snapshot yet.',
          stale: state.stale === true,
          timestamp: new Date().toISOString(),
        };
      }
      const diagnostics = publicAlgorithmDiagnostics(state.algorithmDiagnostics);
      if (!diagnostics) {
        return {
          available: false,
          summary: 'The running app returned an invalid algorithm diagnostics snapshot.',
          stale: state.stale === true,
          timestamp: new Date().toISOString(),
        };
      }
      return {
        available: true,
        summary: summarizeAlgorithms(diagnostics),
        stale: state.stale === true,
        diagnostics,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

function projectSections(result, sections) {
  if (!Array.isArray(sections) || sections.length === 0) return result;
  const projected = {
    available: result.available,
    status: result.status,
    summary: result.summary,
    timestamp: result.timestamp,
  };
  for (const section of sections) {
    if (section === 'feeds' && result.feedSummary) projected.feedSummary = result.feedSummary;
    else if (section === 'algorithms') {
      if (result.algorithms) projected.algorithms = result.algorithms;
      if (result.algorithmSummary) projected.algorithmSummary = result.algorithmSummary;
      projected.quarantinedAlgorithms = result.quarantinedAlgorithms;
    } else if (section in result) {
      projected[section] = result[section];
    }
  }
  return projected;
}

function summarizeSidecar(health) {
  if (!health || typeof health !== 'object') return { ok: false };
  const fields = [
    'ok',
    'pid',
    'uptime_ms',
    'port',
    'rss_mb',
    'heap_mb',
    'ais_connected',
    'ais_vessels',
    'keys_configured',
    'keys_total',
    'keys_missing_count',
  ];
  return Object.fromEntries(fields
    .filter((field) => health[field] !== undefined)
    .map((field) => [field, health[field]]));
}

function summarizeAlgorithmSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { status: 'unavailable', ledger: { total: 0, graded: 0, pending: 0 } };
  }
  const ledger = snapshot.ledger ?? {};
  const health = snapshot.health ?? {};
  return {
    status: health.status ?? 'unknown',
    counts: Object.fromEntries(
      ['healthy', 'degraded', 'failing', 'unsafe', 'unknown']
        .map((status) => [
          status,
          (health.algorithms ?? []).filter((algorithm) => algorithm.status === status).length,
        ]),
    ),
    ledger: {
      total: ledger.total ?? 0,
      graded: ledger.graded ?? 0,
      pending: ledger.pending ?? 0,
    },
    forecasts: snapshot.forecastCalibration?.summary ?? null,
  };
}

function summarizeSelfTest(selfTest) {
  if (!selfTest || typeof selfTest !== 'object') return null;
  return { summary: selfTest.summary ?? null };
}

function finding(id, severity, summary, nextAction) {
  return { id, severity, summary, nextAction };
}

function summarizeFeeds(feeds) {
  const rows = Array.isArray(feeds) ? feeds : [];
  const healthy = rows.filter((feed) =>
    HEALTHY.has(String(feed.status ?? feed.state ?? feed.health ?? '').toLowerCase()),
  ).length;
  return { total: rows.length, healthy, impaired: rows.length - healthy };
}

function summarizeAlgorithms(snapshot) {
  const ledger = snapshot.ledger ?? {};
  const forecasts = snapshot.forecastCalibration?.summary ?? {};
  const status = snapshot.health?.status ?? 'unknown';
  const brier = typeof forecasts.brierScore === 'number'
    ? `; Brier ${forecasts.brierScore.toFixed(3)}`
    : '';
  const criteria = typeof forecasts.criteriaDeclared === 'number'
    ? `; ${forecasts.criteriaDeclared} criteria-declared`
    : '';
  const resolverOutcomes = typeof forecasts.directResolved === 'number'
    ? `; resolver outcomes direct:${forecasts.directResolved} proxy:${forecasts.proxyResolved ?? 0} expired:${forecasts.resolverExpired ?? 0}`
    : '';
  const origins = ledger.outcomeOrigins;
  const runtimeLabels = origins && typeof origins === 'object'
    ? `; runtime labels direct:${origins.direct ?? 0} proxy:${origins.proxy ?? 0} manual:${origins.manual ?? 0} llm:${origins.llm ?? 0}`
    : '';
  const weatherReports = snapshot.forecastCalibration?.weatherReports;
  const weather = typeof weatherReports?.status === 'string'
    ? `; weather reports ${weatherReports.status} (${weatherReports.pendingWarningPredictions ?? 0} pending warnings)`
    : '';
  const quality = snapshot.forecastCalibration?.resolutionQuality?.summary;
  const invalid = resolutionInvalidCount(quality);
  const labelQuality = quality && typeof quality === 'object'
    ? `; label quality direct:${quality.origins?.direct ?? 0} proxy:${quality.origins?.proxy ?? 0} manual:${quality.origins?.manual ?? 0}; invalid:${invalid} uncertain-proxy:${quality.uncertainProxy ?? 0} late:${quality.lateResolutions ?? 0}`
    : '';
  const evaluation = snapshot.forecastCalibration?.evaluation;
  const holdoutMetric = evaluation?.overall?.brier;
  const holdout = holdoutMetric?.status === 'ok'
    ? `; holdout Brier ${holdoutMetric.value.toFixed(3)} (n=${holdoutMetric.sampleSize})`
    : holdoutMetric?.status === 'insufficient_evidence'
      ? `; holdout evidence ${holdoutMetric.sampleSize}/${holdoutMetric.minSampleSize}`
      : '';
  const worst = evaluation?.worstCohorts?.find((cohort) =>
    cohort?.brier?.status === 'ok');
  const worstCohort = worst
    ? `; worst cohort ${worst.sourceId}/${worst.domain}/${worst.horizon} Brier ${worst.brier.value.toFixed(3)} (n=${worst.brier.sampleSize})`
    : '';
  const topLoss = evaluation?.lossAttribution?.bySource?.[0];
  const lossAttribution =
    typeof topLoss?.key === 'string'
    && typeof topLoss.shareOfBrierLoss === 'number'
      ? `; top Brier loss ${topLoss.key} ${(topLoss.shareOfBrierLoss * 100).toFixed(1)}% (${topLoss.highConfidenceMisses ?? 0} high-confidence misses)`
      : '';
  return `${status} algorithm health; ${ledger.graded ?? 0}/${ledger.total ?? 0} runtime evaluations graded${runtimeLabels}; ${forecasts.resolved ?? 0}/${forecasts.total ?? 0} forecasts resolved${brier}${holdout}${worstCohort}${lossAttribution}${criteria}${resolverOutcomes}${labelQuality}${weather}; ${forecasts.overduePending ?? 0} overdue.`;
}

function inspectForecastEvaluation(forecastCalibration, findings) {
  const evaluation = forecastCalibration?.evaluation;
  if (!evaluation || typeof evaluation !== 'object') return;
  const backlog = evaluation.resolutionBacklog;
  const overdue = finiteCount(backlog?.overduePending);
  if (overdue > 0) {
    findings.push(finding(
      'forecast.outcomes_overdue',
      'yellow',
      `${overdue} forecast outcome(s) are overdue for resolution.`,
      'Inspect the resolver backlog and upstream observation cadence before changing model weights.',
    ));
  }
  const overall = evaluation.overall?.brier;
  if (overall?.status === 'ok' && finiteNumber(overall.value) > 0.35) {
    findings.push(finding(
      'forecast.calibration_poor',
      'yellow',
      `Forecast holdout Brier is ${overall.value.toFixed(3)} across ${overall.sampleSize} scored predictions.`,
      'Inspect evaluation.worstCohorts and replay the affected cohort before recalibrating.',
    ));
  }
  const worst = evaluation.worstCohorts?.find((cohort) =>
    cohort?.brier?.status === 'ok');
  if (worst && finiteNumber(worst.brier.value) > 0.35) {
    findings.push(finding(
      'forecast.cohort_underperforming',
      'yellow',
      `${worst.sourceId}/${worst.domain}/${worst.horizon} has holdout Brier ${worst.brier.value.toFixed(3)} (n=${worst.brier.sampleSize}).`,
      'Replay this source/domain/horizon cohort before changing source weights or calibration parameters.',
    ));
  }
  const attribution = evaluation.lossAttribution;
  const topLoss = attribution?.bySource?.[0];
  if (
    finiteCount(attribution?.sampleSize) >= 20
    && finiteNumber(topLoss?.shareOfBrierLoss) >= 0.5
  ) {
    findings.push(finding(
      'forecast.loss_concentrated',
      'yellow',
      `${topLoss.key} contributes ${(topLoss.shareOfBrierLoss * 100).toFixed(1)}% of holdout Brier loss across ${topLoss.sampleSize} scored forecasts.`,
      'Inspect the same source across evaluation.lossAttribution.byDomain, byHorizon, and byAlgorithmVersion before changing its calibration.',
    ));
  }
}

function inspectResolutionQuality(forecastCalibration, findings) {
  const quality = forecastCalibration?.resolutionQuality?.summary;
  if (!quality || typeof quality !== 'object') return;
  const invalid = resolutionInvalidCount(quality);
  if (invalid > 0) {
    findings.push(finding(
      'forecast.resolution_quality_invalid',
      'red',
      `${invalid} invalid forecast resolution label issue(s) were detected.`,
      'Quarantine affected domain labels and inspect resolutionQuality.byDomain before tuning.',
    ));
  }
  const uncertainProxy = finiteCount(quality.uncertainProxy);
  if (uncertainProxy > 0) {
    findings.push(finding(
      'forecast.proxy_labels_uncertain',
      'yellow',
      `${uncertainProxy} proxy resolution label(s) lack strong corroboration.`,
      'Require two independent supporting sources or replace the proxy with direct ground truth.',
    ));
  }
  const late = finiteCount(quality.lateResolutions);
  if (late > 0) {
    findings.push(finding(
      'forecast.resolutions_late',
      'yellow',
      `${late} forecast resolution(s) arrived after their declared horizon.`,
      'Inspect resolver cadence and keep late evidence distinct from in-window model performance.',
    ));
  }
}

function resolutionInvalidCount(quality) {
  if (!quality || typeof quality !== 'object') return 0;
  return finiteCount(quality.malformed)
    + finiteCount(quality.labelLeakage)
    + finiteCount(quality.duplicateOutcomes)
    + finiteCount(quality.contradictoryEvidence);
}

function finiteCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
