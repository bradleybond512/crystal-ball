import { z } from 'zod';

const HEALTHY = new Set(['healthy', 'ok', 'fresh', 'up', 'operational']);

export const schemas = {
  diagnose_runtime: {
    description:
      'Fast live troubleshooting pass across the Crystal Ball sidecar, feed health, renderer state, and optional 10-route self-test. Returns ranked findings and next actions.',
    inputSchema: z.object({
      deep: z.boolean().optional().describe('Run the slower 10-route sidecar self-test (default false).'),
    }),
  },
  get_algorithm_diagnostics: {
    description:
      'Current algorithm health, forecast calibration/Brier coverage, weather ground-truth coverage, evaluation retention, p50/p95 latency, runtime errors, bounded tuning parameters, proposals, and recent tuning decisions from the live renderer.',
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

      for (const algorithm of analyst?.algorithmDiagnostics?.health?.algorithms ?? []) {
        if (!['unsafe', 'failing', 'degraded'].includes(algorithm.status)) continue;
        findings.push(finding(
          `algorithm.${algorithm.status}.${algorithm.algorithmId}`,
          algorithm.status === 'degraded' ? 'yellow' : 'red',
          `${algorithm.algorithmId} is ${algorithm.status}: ${algorithm.reason ?? ''}`.trim(),
          algorithm.recommendedAdjustment || 'Replay recent evaluations before changing a tuning parameter.',
        ));
      }
      const weatherReports = analyst?.algorithmDiagnostics
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
      return {
        available: health?.ok === true,
        status,
        summary: findings.length === 0
          ? 'No actionable live runtime problems detected.'
          : `${findings.length} ranked finding(s).`,
        sidecar: health,
        feedSummary: summarizeFeeds(feeds?.feeds),
        renderer: analyst?.available === true
          ? { available: true, stale: analyst.stale === true, ageMs: analyst.ageMs ?? null }
          : { available: false },
        algorithms: analyst?.algorithmDiagnostics ?? null,
        selfTest,
        findings,
        timestamp: new Date().toISOString(),
      };
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
      return {
        available: true,
        summary: summarizeAlgorithms(state.algorithmDiagnostics),
        stale: state.stale === true,
        diagnostics: state.algorithmDiagnostics,
        timestamp: new Date().toISOString(),
      };
    },
  };
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
  const weatherReports = snapshot.forecastCalibration?.weatherReports;
  const weather = typeof weatherReports?.status === 'string'
    ? `; weather reports ${weatherReports.status} (${weatherReports.pendingWarningPredictions ?? 0} pending warnings)`
    : '';
  return `${status} algorithm health; ${ledger.graded ?? 0}/${ledger.total ?? 0} runtime evaluations graded; ${forecasts.resolved ?? 0}/${forecasts.total ?? 0} forecasts resolved${brier}${criteria}${resolverOutcomes}${weather}; ${forecasts.overduePending ?? 0} overdue.`;
}
