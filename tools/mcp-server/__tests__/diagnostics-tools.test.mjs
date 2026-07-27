import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeDiagnosticsTools,
  schemas,
} from '../tools/diagnostics.mjs';

function fakeClient(responses) {
  return {
    async get(route) {
      return responses[route] ?? { error: `missing fixture ${route}` };
    },
  };
}

test('diagnostics MCP schemas describe the runtime and algorithm tools', () => {
  assert.ok(schemas.diagnose_runtime.description.length > 20);
  assert.ok(schemas.get_algorithm_diagnostics.description.length > 20);
});

test('diagnose_runtime combines health, feed, self-test, and renderer evidence', async () => {
  const tools = makeDiagnosticsTools(fakeClient({
    '/api/health': { ok: true, port: 46123, uptime_ms: 20000, rss_mb: 50, heap_mb: 20 },
    '/api/feeds/health': {
      feeds: [
        { id: 'isw', status: 'healthy' },
        { id: 'ucdp', status: 'error', lastError: 'HTTP 401' },
      ],
    },
    '/api/diagnostics/self-test': {
      summary: { passed: 10, degraded: 0, failed: 0 },
      results: [],
    },
    '/api/analyst-state': {
      available: true,
      ageMs: 500,
      stale: false,
      debugErrorCounts: {},
      algorithmDiagnostics: {
        health: { status: 'healthy', algorithms: [] },
        ledger: { total: 2, graded: 1, pending: 1 },
        runtime: [],
      },
    },
  }));

  const result = await tools.diagnose_runtime({ deep: true });

  assert.equal(result.available, true);
  assert.equal(result.status, 'yellow');
  assert.equal(result.sidecar.port, 46123);
  assert.equal(result.selfTest.summary.passed, 10);
  assert.ok(result.findings.some((finding) => finding.id === 'feed.ucdp'));
});

test('get_algorithm_diagnostics returns the mirrored snapshot without unrelated analyst data', async () => {
  const snapshot = {
    health: { status: 'degraded', algorithms: [{ algorithmId: 'x', status: 'degraded' }] },
    ledger: { total: 10, graded: 8, pending: 2 },
    runtime: [],
  };
  const tools = makeDiagnosticsTools(fakeClient({
    '/api/analyst-state': {
      available: true,
      stale: false,
      algorithmDiagnostics: snapshot,
      analyst: { hypotheses: [{ statement: 'not part of diagnostics output' }] },
    },
  }));

  const result = await tools.get_algorithm_diagnostics({});

  assert.equal(result.available, true);
  assert.deepEqual(result.diagnostics, snapshot);
  assert.equal('analyst' in result, false);
});

test('diagnostics tools surface degraded weather ground-truth coverage', async () => {
  const algorithmDiagnostics = {
    health: { status: 'healthy', algorithms: [] },
    ledger: { total: 2, graded: 2, pending: 0 },
    runtime: [],
    forecastCalibration: {
      summary: {
        total: 3,
        resolved: 1,
        pending: 2,
        overduePending: 0,
      },
      weatherReports: {
        status: 'stale',
        reportCount: 10,
        invalidReportCount: 1,
        pendingWarningPredictions: 2,
        ageMs: 1_900_000,
        complete: false,
      },
    },
  };
  const tools = makeDiagnosticsTools(fakeClient({
    '/api/health': { ok: true },
    '/api/feeds/health': { feeds: [] },
    '/api/analyst-state': {
      available: true,
      stale: false,
      algorithmDiagnostics,
    },
  }));

  const runtime = await tools.diagnose_runtime({});
  const algorithms = await tools.get_algorithm_diagnostics({});

  assert.equal(runtime.status, 'yellow');
  assert.ok(runtime.findings.some(
    (finding) => finding.id === 'forecast.weather_reports_stale',
  ));
  assert.match(algorithms.summary, /weather reports stale/);
});
