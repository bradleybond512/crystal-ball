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

  const result = await tools.diagnose_runtime({ deep: true, detail: 'full' });

  assert.equal(result.available, true);
  assert.equal(result.status, 'yellow');
  assert.equal(result.sidecar.port, 46123);
  assert.equal(result.selfTest.summary.passed, 10);
  assert.ok(result.findings.some((finding) => finding.id === 'feed.ucdp'));
});

test('diagnose_runtime defaults to compact output', async () => {
  const tools = makeDiagnosticsTools(fakeClient({
    '/api/health': { ok: true, port: 46123, keys_missing: ['DO_NOT_EXPOSE'] },
    '/api/feeds/health': { feeds: [] },
    '/api/analyst-state': {
      available: true,
      stale: false,
      algorithmDiagnostics: {
        health: {
          status: 'unsafe',
          algorithms: [
            {
              algorithmId: 'warning-verification',
              criticality: 'safety',
              status: 'unsafe',
              reason: 'below floor',
            },
          ],
        },
        ledger: { total: 2000, graded: 300, pending: 1700 },
        runtime: Array.from({ length: 100 }, (_, index) => ({ id: index })),
      },
    },
  }));

  const result = await tools.diagnose_runtime({});

  assert.equal('algorithms' in result, false);
  assert.equal(result.algorithmSummary.status, 'unsafe');
  assert.equal(result.algorithmSummary.ledger.total, 2000);
  assert.deepEqual(result.quarantinedAlgorithms, ['warning-verification']);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPOSE/);
});

test('diagnose_runtime supports explicit section projection', async () => {
  const tools = makeDiagnosticsTools(fakeClient({
    '/api/health': { ok: true, port: 46123 },
    '/api/feeds/health': { feeds: [] },
    '/api/analyst-state': { available: false },
  }));

  const result = await tools.diagnose_runtime({ sections: ['findings'] });

  assert.deepEqual(
    Object.keys(result).sort(),
    ['available', 'findings', 'status', 'summary', 'timestamp'],
  );
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

test('get_algorithm_diagnostics bounds and strips unexpected cohort detail', async () => {
  const lossRows = Array.from({ length: 12 }, (_, index) => ({
    key: `source-${index}\u0000`,
    sampleSize: index + 1,
    totalBrierLoss: 12 - index,
    meanBrier: 0.5,
    shareOfBrierLoss: index === 0 ? 0.75 : 0.025,
    highConfidenceMisses: index,
    evidence: `SECRET-LOSS-EVIDENCE-${index}`,
  }));
  const snapshot = {
    health: { status: 'healthy', algorithms: [] },
    ledger: { total: 30, graded: 30, pending: 0 },
    runtime: [],
    forecastCalibration: {
      evaluation: {
        schemaVersion: 1,
        split: {
          strategy: 'chronological_60_40',
          trainingRecords: 18,
          evaluationRecords: 12,
          evaluationWindowStart: 200,
        },
        resolutionBacklog: {
          pending: 0,
          overduePending: 0,
          expired: 0,
          oldestPendingAt: null,
        },
        labelOrigins: {
          direct: 30,
          proxy: 0,
          manual: 0,
          unattributed: 0,
        },
        overall: {
          coverage: {
            total: 12,
            resolved: 12,
            expired: 0,
            pending: 0,
            overduePending: 0,
            resolutionCoverage: 1,
            expirationRate: 0,
            closedCoverage: 1,
          },
          trainingSampleSize: 18,
          exclusions: {
            proxyLabels: 0,
            invalidProbabilities: 0,
            trainingWindowOverlap: 0,
            trainingProxyLabels: 0,
            trainingInvalidProbabilities: 0,
          },
          brier: {
            status: 'insufficient_evidence',
            sampleSize: 12,
            minSampleSize: 20,
          },
          logLoss: {
            status: 'insufficient_evidence',
            sampleSize: 12,
            minSampleSize: 20,
          },
          baseRate: {
            status: 'insufficient_evidence',
            sampleSize: 18,
            minSampleSize: 20,
          },
          brierSkill: {
            status: 'insufficient_evidence',
            sampleSize: 12,
            minSampleSize: 20,
            reason: 'training_sample_floor',
          },
          equalMassEce: {
            status: 'insufficient_evidence',
            sampleSize: 12,
            minSampleSize: 20,
          },
          calibrationFit: {
            status: 'insufficient_evidence',
            sampleSize: 12,
            minSampleSize: 50,
            reason: 'sample_floor',
          },
          claim: 'SECRET-OVERALL-CLAIM',
        },
        lossAttribution: {
          sampleSize: 12,
          totalBrierLoss: 6,
          highConfidenceMisses: 3,
          groupLimit: 10,
          bySource: lossRows,
          byDomain: lossRows.slice(0, 2),
          byHorizon: lossRows.slice(0, 2),
          byAlgorithmVersion: lossRows.slice(0, 2),
          evidence: 'SECRET-LOSS-ROOT',
        },
        worstCohorts: Array.from({ length: 12 }, (_, index) => ({
          sourceId: `model-${index}`,
          domain: 'cyber',
          horizon: '1d-7d',
          coverage: {
            total: 1,
            resolved: 1,
            expired: 0,
            pending: 0,
            overduePending: 0,
            resolutionCoverage: 1,
            expirationRate: 0,
            closedCoverage: 1,
          },
          trainingSampleSize: 1,
          exclusions: {
            proxyLabels: 0,
            invalidProbabilities: 0,
            trainingWindowOverlap: 0,
            trainingProxyLabels: 0,
            trainingInvalidProbabilities: 0,
          },
          brier: {
            status: 'insufficient_evidence',
            sampleSize: 1,
            minSampleSize: 20,
          },
          logLoss: {
            status: 'insufficient_evidence',
            sampleSize: 1,
            minSampleSize: 20,
          },
          baseRate: {
            status: 'insufficient_evidence',
            sampleSize: 1,
            minSampleSize: 20,
          },
          brierSkill: {
            status: 'insufficient_evidence',
            sampleSize: 1,
            minSampleSize: 20,
            reason: 'training_sample_floor',
          },
          equalMassEce: {
            status: 'insufficient_evidence',
            sampleSize: 1,
            minSampleSize: 20,
          },
          calibrationFit: {
            status: 'insufficient_evidence',
            sampleSize: 1,
            minSampleSize: 50,
            reason: 'sample_floor',
          },
          claim: `SECRET-COHORT-CLAIM-${index}`,
          evidence: { reference: `SECRET-EVIDENCE-${index}` },
        })),
        cohortLimit: 10,
        cohortCount: 12,
        omittedCohortCount: 2,
      },
    },
  };
  const tools = makeDiagnosticsTools(fakeClient({
    '/api/analyst-state': {
      available: true,
      stale: false,
      algorithmDiagnostics: snapshot,
    },
  }));

  const result = await tools.get_algorithm_diagnostics({});
  const evaluation = result.diagnostics.forecastCalibration.evaluation;

  assert.equal(evaluation.worstCohorts.length, 10);
  assert.equal(evaluation.lossAttribution.bySource.length, 10);
  assert.deepEqual(evaluation.lossAttribution.bySource[0], {
    key: 'source-0',
    sampleSize: 1,
    totalBrierLoss: 12,
    meanBrier: 0.5,
    shareOfBrierLoss: 0.75,
    highConfidenceMisses: 0,
  });
  assert.match(
    result.summary,
    /top Brier loss source-0 75\.0% \(0 high-confidence misses\)/,
  );
  assert.doesNotMatch(
    JSON.stringify(evaluation),
    /SECRET|"(?:claim|evidence|reference)"/,
  );
});

test('diagnostics tools surface degraded weather ground-truth coverage', async () => {
  const algorithmDiagnostics = {
    health: { status: 'healthy', algorithms: [] },
    ledger: {
      total: 2,
      graded: 2,
      pending: 0,
      outcomeOrigins: { direct: 1, proxy: 0, manual: 1, llm: 0 },
    },
    runtime: [],
    forecastCalibration: {
      summary: {
        total: 3,
        resolved: 1,
        pending: 2,
        overduePending: 0,
      },
      resolutionQuality: {
        summary: {
          total: 3,
          resolved: 1,
          resolutionCoverage: 0.333,
          origins: { direct: 1, proxy: 0, manual: 0 },
          malformed: 0,
          labelLeakage: 0,
          duplicateOutcomes: 0,
          lateResolutions: 0,
          contradictoryEvidence: 0,
          uncertainProxy: 0,
        },
        byDomain: [],
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
  assert.match(
    algorithms.summary,
    /runtime labels direct:1 proxy:0 manual:1 llm:0/,
  );
  assert.match(
    algorithms.summary,
    /label quality direct:1 proxy:0 manual:0; invalid:0 uncertain-proxy:0 late:0/,
  );
});

test('diagnostics tools rank invalid and uncertain resolution labels', async () => {
  const algorithmDiagnostics = {
    health: { status: 'healthy', algorithms: [] },
    ledger: { total: 4, graded: 4, pending: 0 },
    runtime: [],
    forecastCalibration: {
      summary: { total: 4, resolved: 4, pending: 0, overduePending: 0 },
      resolutionQuality: {
        summary: {
          total: 4,
          resolved: 4,
          resolutionCoverage: 1,
          origins: { direct: 1, proxy: 2, manual: 1 },
          malformed: 0,
          labelLeakage: 1,
          duplicateOutcomes: 0,
          lateResolutions: 1,
          contradictoryEvidence: 0,
          uncertainProxy: 1,
        },
        byDomain: [],
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

  assert.equal(runtime.status, 'red');
  assert.ok(runtime.findings.some(
    (finding) => finding.id === 'forecast.resolution_quality_invalid',
  ));
  assert.ok(runtime.findings.some(
    (finding) => finding.id === 'forecast.proxy_labels_uncertain',
  ));
  assert.ok(runtime.findings.some(
    (finding) => finding.id === 'forecast.resolutions_late',
  ));
});
