import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDoctorReport,
  redactDiagnosticText,
} from './doctor-core.mjs';

const NOW = 1_800_000_000_000;

function healthyInput() {
  return {
    now: NOW,
    durationMs: 125,
    health: {
      ok: true,
      pid: 42,
      uptime_ms: 60_000,
      port: 46_123,
      rss_mb: 52,
      heap_mb: 20,
      keys_configured: 1,
      keys_total: 37,
      feeds: [],
    },
    heartbeat: {
      pid: 42,
      port: 46_123,
      last_heartbeat: new Date(NOW - 1000).toISOString(),
      event_loop_lag_ms: 2,
      rss_mb: 52,
      heap_mb: 20,
    },
    feeds: { feeds: [], asOf: new Date(NOW).toISOString() },
    analyst: {
      available: true,
      ageMs: 1000,
      stale: false,
      debugErrorCounts: {},
      algorithmDiagnostics: {
        health: { status: 'healthy', algorithms: [], recommendations: [] },
        runtime: [],
        forecastCalibration: {
          summary: {
            total: 5,
            resolved: 3,
            pending: 2,
            expired: 0,
            overduePending: 0,
            oldestPendingAt: NOW - 60_000,
            brierScore: 0.18,
          },
          byDomain: [],
          bySource: [],
          evaluation: {
            schemaVersion: 1,
            split: {
              strategy: 'chronological_60_40',
              trainingRecords: 3,
              evaluationRecords: 2,
              evaluationWindowStart: NOW - 60_000,
            },
            resolutionBacklog: {
              pending: 2,
              overduePending: 0,
              expired: 0,
              oldestPendingAt: NOW - 60_000,
            },
            labelOrigins: {
              direct: 1,
              proxy: 1,
              manual: 1,
              unattributed: 0,
            },
            overall: {
              coverage: {
                total: 2,
                resolved: 2,
                expired: 0,
                pending: 0,
                overduePending: 0,
                resolutionCoverage: 1,
                expirationRate: 0,
                closedCoverage: 1,
              },
              trainingSampleSize: 3,
              exclusions: {
                proxyLabels: 0,
                invalidProbabilities: 0,
                trainingWindowOverlap: 0,
                trainingProxyLabels: 0,
                trainingInvalidProbabilities: 0,
              },
              brier: {
                status: 'insufficient_evidence',
                sampleSize: 2,
                minSampleSize: 20,
              },
              logLoss: {
                status: 'insufficient_evidence',
                sampleSize: 2,
                minSampleSize: 20,
              },
              baseRate: {
                status: 'insufficient_evidence',
                sampleSize: 3,
                minSampleSize: 20,
              },
              brierSkill: {
                status: 'insufficient_evidence',
                sampleSize: 2,
                minSampleSize: 20,
                reason: 'training_sample_floor',
              },
              equalMassEce: {
                status: 'insufficient_evidence',
                sampleSize: 2,
                minSampleSize: 20,
              },
              calibrationFit: {
                status: 'insufficient_evidence',
                sampleSize: 2,
                minSampleSize: 50,
                reason: 'sample_floor',
              },
            },
            worstCohorts: [],
            cohortLimit: 10,
            cohortCount: 0,
            omittedCohortCount: 0,
          },
          resolutionQuality: {
            summary: {
              total: 5,
              resolved: 3,
              resolutionCoverage: 0.6,
              origins: { direct: 1, proxy: 1, manual: 1 },
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
            status: 'fresh',
            reportCount: 4,
            validReportCount: 4,
            invalidReportCount: 0,
            pendingWarningPredictions: 0,
            fetchedAt: NOW - 1000,
            ageMs: 1000,
            coverageStart: NOW - 86_401_000,
            coverageEnd: NOW - 1000,
            complete: true,
          },
        },
        ledger: {
          total: 5,
          graded: 3,
          pending: 2,
          persistence: {
            lastLoadStatus: 'ok',
            lastSaveStatus: 'ok',
          },
        },
      },
    },
    selfTest: null,
    logLines: [
      '[1][v1][INFO] SESSION START pid=42 version=2.0.0',
      '[2][v1][INFO] sidecar confirmed port=46123',
    ],
  };
}

test('buildDoctorReport keeps a healthy live session green', () => {
  const report = buildDoctorReport(healthyInput());

  assert.equal(report.status, 'green');
  assert.equal(report.findings.length, 0);
  assert.equal(report.runtime.port, 46_123);
  assert.equal(report.algorithms.ledger.total, 5);
});

test('buildDoctorReport ranks causal failures and points to a next action', () => {
  const input = healthyInput();
  input.heartbeat.last_heartbeat = new Date(NOW - 45_000).toISOString();
  input.heartbeat.event_loop_lag_ms = 3000;
  input.feeds.feeds = [{ id: 'ucdp', status: 'error', lastError: 'HTTP 401' }];
  input.analyst.debugErrorCounts = { correlation: 2 };
  input.analyst.algorithmDiagnostics.health = {
    status: 'failing',
    algorithms: [{
      algorithmId: 'correlator',
      status: 'failing',
      reason: 'Low hit rate',
      recommendedAdjustment: 'Replay recent misses.',
    }],
    recommendations: ['Replay recent misses.'],
  };

  const report = buildDoctorReport(input);

  assert.equal(report.status, 'red');
  assert.equal(report.findings[0]?.id, 'runtime.event_loop_lag');
  assert.ok(report.findings.every((finding) => finding.nextAction.length > 0));
  assert.ok(report.findings.some((finding) => finding.id === 'algorithm.failing.correlator'));
  assert.ok(report.findings.some((finding) => finding.id === 'feed.ucdp'));
});

test('buildDoctorReport warns when active algorithm evidence is not persisted', () => {
  const input = healthyInput();
  input.analyst.algorithmDiagnostics.ledger.persistence = {
    lastLoadStatus: 'idle',
    lastSaveStatus: 'idle',
  };

  const report = buildDoctorReport(input);

  assert.equal(report.status, 'yellow');
  assert.ok(report.findings.some((finding) => finding.id === 'algorithm.ledger_persistence_idle'));
});

test('buildDoctorReport exposes stalled and poorly calibrated forecast truth loops', () => {
  const input = healthyInput();
  input.analyst.algorithmDiagnostics.forecastCalibration.summary = {
    total: 20,
    resolved: 12,
    pending: 6,
    expired: 2,
    overduePending: 3,
    oldestPendingAt: NOW - 86_400_000,
    brierScore: 0.41,
  };
  input.analyst.algorithmDiagnostics.forecastCalibration.evaluation.overall.brier = {
    status: 'ok',
    sampleSize: 20,
    value: 0.39,
  };
  input.analyst.algorithmDiagnostics.forecastCalibration.evaluation.worstCohorts = [{
    sourceId: 'model-bad',
    domain: 'cyber',
    horizon: '1d-7d',
    ...input.analyst.algorithmDiagnostics.forecastCalibration.evaluation.overall,
    brier: {
      status: 'ok',
      sampleSize: 20,
      value: 0.64,
    },
  }];
  input.analyst.algorithmDiagnostics.forecastCalibration.evaluation.cohortCount = 1;

  const report = buildDoctorReport(input);

  assert.equal(report.status, 'yellow');
  assert.equal(report.algorithms.forecastCalibration.summary.overduePending, 3);
  assert.ok(report.findings.some((finding) => finding.id === 'forecast.outcomes_overdue'));
  assert.ok(report.findings.some((finding) => finding.id === 'forecast.calibration_poor'));
  assert.ok(report.findings.some(
    (finding) => finding.id === 'forecast.cohort_underperforming',
  ));
  assert.match(
    report.findings.find(
      (finding) => finding.id === 'forecast.cohort_underperforming',
    )?.evidence ?? '',
    /source=model-bad; domain=cyber; horizon=1d-7d; brier=0.64; sampleSize=20/,
  );
});

test('buildDoctorReport exposes degraded warning-verification evidence', () => {
  const input = healthyInput();
  input.analyst.algorithmDiagnostics.forecastCalibration.weatherReports = {
    status: 'stale',
    reportCount: 2,
    validReportCount: 1,
    invalidReportCount: 1,
    pendingWarningPredictions: 3,
    fetchedAt: NOW - 31 * 60_000,
    ageMs: 31 * 60_000,
    coverageStart: NOW - 25 * 60 * 60_000,
    coverageEnd: NOW - 31 * 60_000,
    complete: false,
  };

  const report = buildDoctorReport(input);

  assert.equal(report.status, 'yellow');
  assert.ok(report.findings.some(
    (finding) => finding.id === 'forecast.weather_reports_stale',
  ));
});

test('buildDoctorReport fails red on invalid resolution labels', () => {
  const input = healthyInput();
  input.analyst.algorithmDiagnostics.forecastCalibration.resolutionQuality.summary = {
    total: 20,
    resolved: 12,
    resolutionCoverage: 0.6,
    origins: { direct: 4, proxy: 3, manual: 5 },
    malformed: 1,
    labelLeakage: 2,
    duplicateOutcomes: 3,
    lateResolutions: 0,
    contradictoryEvidence: 1,
    uncertainProxy: 0,
  };

  const report = buildDoctorReport(input);

  assert.equal(report.status, 'red');
  assert.ok(report.findings.some(
    (finding) => finding.id === 'forecast.resolution_quality_invalid',
  ));
  assert.doesNotMatch(JSON.stringify(report.findings), /prediction-id|fixture claim/);
});

test('buildDoctorReport separates uncertain proxy and late labels', () => {
  const input = healthyInput();
  input.analyst.algorithmDiagnostics.forecastCalibration.resolutionQuality.summary = {
    total: 20,
    resolved: 12,
    resolutionCoverage: 0.6,
    origins: { direct: 4, proxy: 3, manual: 5 },
    malformed: 0,
    labelLeakage: 0,
    duplicateOutcomes: 0,
    lateResolutions: 2,
    contradictoryEvidence: 0,
    uncertainProxy: 1,
  };

  const report = buildDoctorReport(input);

  assert.equal(report.status, 'yellow');
  assert.ok(report.findings.some(
    (finding) => finding.id === 'forecast.proxy_labels_uncertain',
  ));
  assert.ok(report.findings.some(
    (finding) => finding.id === 'forecast.resolutions_late',
  ));
});

test('redactDiagnosticText removes secrets, email, query credentials, and the home username', () => {
  const redacted = redactDiagnosticText(
    'Bearer super-secret user@example.com /Users/bradleybond/file?api_key=abc&token=xyz',
  );

  assert.doesNotMatch(redacted, /super-secret|user@example\.com|bradleybond|api_key=abc|token=xyz/);
  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.match(redacted, /\/Users\/\[USER\]\//);
});

test('buildDoctorReport redacts nested self-test and algorithm strings', () => {
  const input = healthyInput();
  input.selfTest = {
    summary: { total: 1, ok: 1, degraded: 0, fail: 0 },
    results: [{
      route: '/api/example',
      ok: true,
      error: 'Bearer nested-secret at /Users/bradleybond/report',
    }],
  };
  input.analyst.algorithmDiagnostics.health.algorithms = [{
    algorithmId: 'example',
    status: 'healthy',
    reason: 'operator@example.com',
  }];

  const serialized = JSON.stringify(buildDoctorReport(input));

  assert.doesNotMatch(serialized, /nested-secret|bradleybond|operator@example\.com/);
  assert.match(serialized, /Bearer \[REDACTED\]/);
});
