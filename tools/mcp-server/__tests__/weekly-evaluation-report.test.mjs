import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createStorage } from '../storage.mjs';
import { monitorGenerationId, reconcileMonitorEvents } from '../tools/monitor-events.mjs';
import {
  generateWeeklyEvaluationReports,
  MAX_WEEKLY_OBSERVATIONS,
  readWeeklyEvaluationReport,
  readWeeklyEvaluationReports,
  recordWeeklyEvaluation,
  utcWeekStart,
  validateWeeklyEvaluationReport,
  weeklyEvaluationReportPath,
} from '../weekly-evaluation-report.mjs';

const MONDAY = Date.UTC(2026, 6, 27);
const WEEK_MS = 7 * 24 * 60 * 60_000;
const CADENCE_MS = 15 * 60_000;
const EXPECTED_WEEKLY_OBSERVATIONS = 672;

function projection(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: MONDAY + 60_000,
    forecast: {
      total: 100,
      resolved: 70,
      pending: 20,
      overduePending: 2,
      expired: 10,
      resolutionCoverage: 0.7,
      expirationRate: 0.1,
      metrics: {
        brier: { status: 'ok', sampleSize: 70, value: 0.2 },
        logLoss: { status: 'ok', sampleSize: 70, value: 0.4 },
        brierSkill: { status: 'ok', sampleSize: 70, value: 0.1 },
        equalMassEce: { status: 'ok', sampleSize: 70, value: 0.05 },
      },
      largestVersionLossShare: 0.3,
      quarantinedCount: 0,
    },
    champion: {
      availability: 'available',
      active: { model: 'production', version: '1.2.3', activatedAt: MONDAY - WEEK_MS },
      challengers: [{
        model: 'superforecast',
        status: 'insufficient_evidence',
        evidenceCount: 80,
        proxyShare: 0.1,
        perDomain: [{ domain: 'weather', count: 40 }],
        deltas: [{ metric: 'brier', delta: -0.01, ciLow: -0.03, ciHigh: 0.01 }],
      }],
      promotions: [{ at: MONDAY + 2 * 60_000, kind: 'promotion', model: 'production' }],
      rejectionHistory: {
        availability: 'unavailable',
        reasonCode: 'no_runtime_rejection_history',
      },
    },
    ...overrides,
  };
}

function committedMonitor(at, { sidecarAvailable = true, diagnosticsAvailable = true, feeds } = {}) {
  const snapshot = {
    at,
    sidecarAvailable,
    algorithmDiagnosticsAvailable: diagnosticsAvailable,
    feeds: feeds ?? {
      '/api/acled-events': 'ok',
      '/api/market-quotes': 'ok',
      '/api/nws-alerts': 'ok',
      '/api/threatfox-iocs': 'ok',
      '/api/cisa-kev': 'ok',
      '/api/adsb-military': 'ok',
      '/api/ais-snapshot': 'ok',
      '/api/isw-reports': 'ok',
      '/api/owm-current': 'ok',
      '/api/fear-greed': 'ok',
    },
    brier: 0.2,
    resolutionCoverage: 0.7,
    predictionVolume: 100,
    missingness: 0,
    versionLoss: {},
    quarantinedAlgorithms: [],
  };
  const events = reconcileMonitorEvents(null, [], at, { expectedIntervalMs: 900_000 });
  return {
    state: {
      schemaVersion: 1,
      generationId: monitorGenerationId(at),
      available: true,
      lastRunAt: at,
      status: 'green',
      summary: 'ok',
      findings: [],
      newlyTriggered: [],
      recovered: [],
      activeIds: [],
      snapshot,
    },
    events,
  };
}

function record(storage, at, options = {}) {
  const committed = committedMonitor(at, options.monitor);
  return recordWeeklyEvaluation({
    storage,
    at,
    monitorState: committed.state,
    monitorEvents: committed.events,
    evaluationProjection: options.projection === undefined
      ? projection({ generatedAt: at })
      : options.projection,
    diagnosticsStale: options.diagnosticsStale ?? false,
    lockOptions: options.lockOptions,
    writeJSONAtomic: options.writeJSONAtomic,
  });
}

function withStorage(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cb-weekly-report-'));
  const storage = createStorage(dir);
  try {
    return fn(storage, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('uses Monday 00:00 UTC boundaries across year and leap-day rollovers', () => {
  assert.equal(utcWeekStart(Date.UTC(2027, 0, 1, 23, 59)), Date.UTC(2026, 11, 28));
  assert.equal(utcWeekStart(Date.UTC(2024, 1, 29, 12)), Date.UTC(2024, 1, 26));
  assert.equal(utcWeekStart(Date.UTC(2024, 2, 4)), Date.UTC(2024, 2, 4));
  assert.equal(weeklyEvaluationReportPath(MONDAY), 'monitor/evaluation-reports/weekly-2026-07-27.json');
  assert.throws(() => weeklyEvaluationReportPath(MONDAY + 1), /week start/i);
});

test('first install initializes only the current week without fabricated backfill', () => withStorage((storage) => {
  const at = MONDAY + 3 * 24 * 60 * 60_000;
  const result = record(storage, at);
  assert.equal(result.accumulator.initializedWeekStart, MONDAY);
  assert.equal(result.accumulator.lastFinalizedWeekStart, null);
  assert.deepEqual(result.finalizedReports, []);
  assert.equal(result.accumulator.weeks.length, 1);
  assert.equal(result.accumulator.weeks[0].observationCount, 1);
  assert.deepEqual(readWeeklyEvaluationReports(storage), []);
}));

test('manual generation returns no-data without initializing or fabricating backfill', () => withStorage((storage) => {
  const result = generateWeeklyEvaluationReports({ storage, at: MONDAY + 20 * WEEK_MS });
  assert.deepEqual(result, {
    available: false,
    reasonCode: 'no_weekly_accumulator',
    finalizedReports: [],
    reports: [],
    accumulator: null,
  });
  assert.equal(storage.readJSON('monitor/weekly-accumulator.json'), null);
  assert.deepEqual(storage.listFiles('monitor/evaluation-reports', '*.json'), []);
  assert.throws(() => generateWeeklyEvaluationReports({ storage, at: '2026-08-03' }), /timestamp/i);
}));

test('manual generation finalizes an existing week without recording an observation', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  const generated = generateWeeklyEvaluationReports({ storage, at: MONDAY + WEEK_MS });
  assert.equal(generated.available, true);
  assert.equal(generated.reasonCode, null);
  assert.equal(generated.finalizedReports.length, 1);
  assert.equal(generated.reports.length, 1);
  assert.equal(generated.reports[0].period.weekStart, MONDAY);
  assert.deepEqual(generated.accumulator, {
    initializedWeekStart: MONDAY,
    lastFinalizedWeekStart: MONDAY,
    omittedCatchupWeeks: 0,
    retainedWeeks: 0,
  });
  assert.equal(generated.reports[0].coverage.observations, 1);
  assert.equal(storage.readJSON('monitor/weekly-accumulator.json').weeks.length, 0);
}));

test('manual generation is byte-idempotent and reads latest or exact validated weeks', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  const first = generateWeeklyEvaluationReports({ storage, at: MONDAY + WEEK_MS });
  const path = storage.resolve(weeklyEvaluationReportPath(MONDAY));
  const before = readFileSync(path);
  const second = generateWeeklyEvaluationReports({ storage, at: MONDAY + WEEK_MS });
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(second.finalizedReports, []);
  assert.deepEqual(second.reports, first.reports);
  assert.deepEqual(readWeeklyEvaluationReport(storage), first.reports[0]);
  assert.deepEqual(readWeeklyEvaluationReport(storage, { weekStart: MONDAY }), first.reports[0]);
  assert.equal(readWeeklyEvaluationReport(storage, { weekStart: MONDAY - WEEK_MS }), null);
  assert.throws(() => readWeeklyEvaluationReport(storage, { weekStart: '../private' }), /week start/i);
  assert.throws(() => readWeeklyEvaluationReport(storage, { weekStart: MONDAY, path: '../private' }), /options/i);
}));

test('manual generation respects the shared report lock', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  mkdirSync(storage.resolve('monitor'), { recursive: true });
  writeFileSync(storage.resolve('monitor/report.lock'), JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
  }), { mode: 0o600 });
  assert.throws(() => generateWeeklyEvaluationReports({
    storage,
    at: MONDAY + WEEK_MS,
  }), /already running/i);
}));

test('deduplicates a repeated committed generation and rejects temporal reversal', () => withStorage((storage) => {
  const at = MONDAY + 60_000;
  record(storage, at);
  const repeated = record(storage, at);
  assert.equal(repeated.accumulator.weeks[0].observationCount, 1);
  assert.throws(() => record(storage, at - 1), /chronological/i);
}));

test('finalizes immutable idempotent reports with exact privacy-safe recursive keys', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  const result = record(storage, MONDAY + WEEK_MS);
  assert.equal(result.finalizedReports.length, 1);
  const report = result.finalizedReports[0];
  assert.equal(report.availability, 'partial');
  assert.equal(report.predictions.availability, 'partial');
  assert.equal(report.championChallenger.availability, 'partial');
  assert.equal(report.changes.promoted.availability, 'partial');
  assert.deepEqual(Object.keys(report), [
    'schemaVersion', 'reportType', 'generatedAt', 'period', 'availability', 'coverage',
    'championChallenger', 'predictions', 'drift', 'changes', 'nextRecommendedTask', 'limitations',
  ]);
  assert.deepEqual(Object.keys(report.period), ['weekStart', 'weekEnd', 'timezone', 'complete']);
  assert.deepEqual(Object.keys(report.coverage), [
    'observations', 'fresh', 'stale', 'unavailable', 'firstObservedAt', 'lastObservedAt',
  ]);
  assert.deepEqual(Object.keys(report.changes.rejected), ['availability', 'count', 'reasonCode']);
  assert.equal(report.nextRecommendedTask.roadmapTask, null);
  assert.equal(validateWeeklyEvaluationReport(report), true);

  const path = storage.resolve(weeklyEvaluationReportPath(MONDAY));
  const before = readFileSync(path);
  record(storage, MONDAY + WEEK_MS + 60_000);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(storage.resolve('monitor/weekly-accumulator.json')).mode & 0o777, 0o600);
}));

test('requires complete installed cadence and derives promotion evidence from champion availability', () => withStorage((storage) => {
  const unavailableChampion = {
    availability: 'unavailable',
    active: null,
    challengers: [],
    promotions: [],
    rejectionHistory: {
      availability: 'unavailable',
      reasonCode: 'no_runtime_rejection_history',
    },
  };
  for (let index = 0; index < EXPECTED_WEEKLY_OBSERVATIONS; index += 1) {
    const at = MONDAY + index * CADENCE_MS;
    record(storage, at, {
      projection: projection({ generatedAt: at, champion: unavailableChampion }),
    });
  }
  const beforeFinalization = storage.readJSON('monitor/weekly-accumulator.json');
  assert.equal(beforeFinalization.weeks[0].maxObservationGapMs, CADENCE_MS);
  const report = generateWeeklyEvaluationReports({
    storage,
    at: MONDAY + WEEK_MS,
  }).finalizedReports[0];
  assert.equal(report.coverage.observations, EXPECTED_WEEKLY_OBSERVATIONS);
  assert.ok(report.coverage.observations < MAX_WEEKLY_OBSERVATIONS);
  assert.equal(report.availability, 'complete');
  assert.equal(report.predictions.availability, 'available');
  assert.equal(report.championChallenger.availability, 'unavailable');
  assert.deepEqual(report.changes.promoted, {
    availability: 'unavailable',
    count: null,
    rows: [],
    omitted: 0,
  });
  const aggregate = storage.readJSON('monitor/weekly-accumulator.json');
  assert.deepEqual(aggregate.weeks, []);
}));

test('rejects burst-filled cadence with a multi-day internal observation gap', () => withStorage((storage) => {
  const burstSize = EXPECTED_WEEKLY_OBSERVATIONS / 2;
  const finalBurstEnd = MONDAY + WEEK_MS - CADENCE_MS;
  for (let index = 0; index < burstSize; index += 1) {
    const at = MONDAY + index;
    record(storage, at, { projection: projection({ generatedAt: at }) });
  }
  for (let index = 0; index < burstSize; index += 1) {
    const at = finalBurstEnd - burstSize + 1 + index;
    record(storage, at, { projection: projection({ generatedAt: at }) });
  }
  const accumulator = storage.readJSON('monitor/weekly-accumulator.json');
  assert.equal(accumulator.weeks[0].observationCount, EXPECTED_WEEKLY_OBSERVATIONS);
  assert.ok(accumulator.weeks[0].maxObservationGapMs > 24 * 60 * 60_000);
  const report = generateWeeklyEvaluationReports({
    storage,
    at: MONDAY + WEEK_MS,
  }).finalizedReports[0];
  assert.equal(report.availability, 'partial');
  assert.equal(report.predictions.availability, 'partial');
}));

test('fails closed when persisted aggregates omit max observation gap evidence', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  const accumulator = storage.readJSON('monitor/weekly-accumulator.json');
  delete accumulator.weeks[0].maxObservationGapMs;
  storage.writeJSON('monitor/weekly-accumulator.json', accumulator);
  assert.throws(() => generateWeeklyEvaluationReports({
    storage,
    at: MONDAY + WEEK_MS,
  }), /accumulator is malformed/i);
}));

test('fails closed for mismatched monitor generations and malformed existing reports', () => withStorage((storage) => {
  const at = MONDAY + 60_000;
  const committed = committedMonitor(at);
  committed.events.generationId = monitorGenerationId(at + 1);
  assert.throws(() => recordWeeklyEvaluation({
    storage,
    at,
    monitorState: committed.state,
    monitorEvents: committed.events,
    evaluationProjection: projection({ generatedAt: at }),
  }), /committed monitor/i);

  record(storage, at);
  mkdirSync(storage.resolve('monitor/evaluation-reports'), { recursive: true });
  writeFileSync(storage.resolve(weeklyEvaluationReportPath(MONDAY)), '{bad json', { mode: 0o600 });
  assert.throws(() => record(storage, MONDAY + WEEK_MS), /existing weekly report/i);
}));

test('rejects a valid report stored under the wrong immutable week filename', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  const report = record(storage, MONDAY + WEEK_MS).finalizedReports[0];
  const wrongPath = storage.resolve(weeklyEvaluationReportPath(MONDAY + WEEK_MS));
  writeFileSync(wrongPath, JSON.stringify(report), { mode: 0o600 });
  assert.throws(() => readWeeklyEvaluationReports(storage), /filename.*period/i);
}));

test('classifies stale and app-closed observations without ingesting their metrics', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000, {
    diagnosticsStale: true,
    projection: projection({
      generatedAt: MONDAY + 60_000,
      forecast: { ...projection().forecast, pending: 999, overduePending: 999 },
    }),
  });
  record(storage, MONDAY + 2 * 60_000, {
    monitor: { sidecarAvailable: false, diagnosticsAvailable: false },
    projection: null,
  });
  const result = record(storage, MONDAY + WEEK_MS, {
    monitor: { sidecarAvailable: false, diagnosticsAvailable: false },
    projection: null,
  });
  const report = result.finalizedReports[0];
  assert.equal(report.availability, 'unavailable');
  assert.deepEqual(report.coverage, {
    observations: 2,
    fresh: 0,
    stale: 1,
    unavailable: 1,
    firstObservedAt: MONDAY + 60_000,
    lastObservedAt: MONDAY + 2 * 60_000,
  });
  assert.equal(report.predictions.endOfWeek, null);
  assert.equal(report.drift.model.brierEnd, null);
  assert.deepEqual(report.drift.providers.rows, []);
  assert.deepEqual(report.limitations, [
    'app_closed', 'diagnostics_stale', 'partial_week', 'no_rejection_ledger',
    'roadmap_metadata_unavailable',
  ]);
  assert.equal(report.nextRecommendedTask.code, 'restore_monitor');
}));

test('treats preserved old projections as stale and future-invalid projections as unavailable', () => withStorage((storage) => {
  const oldAt = MONDAY + 31 * 60_000;
  record(storage, oldAt, {
    projection: projection({
      generatedAt: MONDAY,
      forecast: { ...projection().forecast, pending: 777 },
    }),
  });
  const futureAt = MONDAY + 32 * 60_000;
  record(storage, futureAt, {
    projection: projection({
      generatedAt: futureAt + 5 * 60_000 + 1,
      forecast: { ...projection().forecast, pending: 888 },
    }),
  });
  const report = generateWeeklyEvaluationReports({
    storage,
    at: MONDAY + WEEK_MS,
  }).finalizedReports[0];
  assert.deepEqual(report.coverage, {
    observations: 2,
    fresh: 0,
    stale: 1,
    unavailable: 1,
    firstObservedAt: oldAt,
    lastObservedAt: futureAt,
  });
  assert.equal(report.predictions.endOfWeek, null);
  assert.equal(report.championChallenger.active, null);
  assert.deepEqual(report.changes.promoted, {
    availability: 'unavailable', count: null, rows: [], omitted: 0,
  });
  assert.equal(report.drift.model.brierEnd, null);
  assert.deepEqual(report.drift.providers.rows, []);
}));

test('reports bookend prediction/model deltas and allowlisted provider transitions', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000, {
    projection: projection({ generatedAt: MONDAY + 60_000 }),
  });
  const feeds = {
    '/api/acled-events': 'error',
    '/api/market-quotes': 'ok',
    '/api/nws-alerts': 'ok',
    '/api/threatfox-iocs': 'ok',
    '/api/cisa-kev': 'ok',
    '/api/adsb-military': 'ok',
    '/api/ais-snapshot': 'ok',
    '/api/isw-reports': 'ok',
    '/api/owm-current': 'ok',
    '/api/fear-greed': 'ok',
    '/api/private-token-route': 'error',
  };
  const second = projection({
    generatedAt: MONDAY + 2 * 60_000,
    forecast: {
      ...projection().forecast,
      pending: 15,
      overduePending: 0,
      expired: 15,
      resolutionCoverage: 0.75,
      metrics: { ...projection().forecast.metrics, brier: { status: 'ok', sampleSize: 75, value: 0.23 } },
      largestVersionLossShare: 0.6,
    },
  });
  record(storage, MONDAY + 2 * 60_000, { monitor: { feeds }, projection: second });
  const report = record(storage, MONDAY + WEEK_MS).finalizedReports[0];
  assert.deepEqual(report.predictions.changeDuringWeek, { pending: -5, overduePending: -2, expired: 5 });
  assert.equal(report.drift.model.brierDelta, 0.03);
  assert.equal(report.drift.model.resolutionCoverageStart, 0.7);
  assert.equal(report.drift.model.resolutionCoverageEnd, 0.75);
  assert.equal(report.drift.model.largestVersionLossShare, 0.6);
  assert.equal(report.drift.providers.rows.length, 10);
  assert.deepEqual(report.drift.providers.rows[0], {
    provider: 'acled', firstStatus: 'ok', lastStatus: 'error',
    degradedObservations: 1, transitionCount: 1,
  });
  assert.equal(JSON.stringify(report).includes('private-token-route'), false);
  assert.equal(report.nextRecommendedTask.code, 'investigate_model_drift');
}));

test('marks mixed fresh/stale coverage partial and prioritizes provider drift after freshness recovers', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  record(storage, MONDAY + 2 * 60_000, { diagnosticsStale: true });
  let report = record(storage, MONDAY + WEEK_MS).finalizedReports[0];
  assert.equal(report.availability, 'partial');
  assert.equal(report.predictions.availability, 'partial');
  assert.equal(report.drift.providers.availability, 'partial');

  const nextWeek = MONDAY + WEEK_MS;
  record(storage, nextWeek + 60_000, {
    projection: projection({
      generatedAt: nextWeek + 60_000,
      forecast: { ...projection().forecast, overduePending: 0 },
    }),
  });
  record(storage, nextWeek + 2 * 60_000, {
    monitor: {
      feeds: { ...committedMonitor(nextWeek).state.snapshot.feeds, '/api/acled-events': 'error' },
    },
    projection: projection({
      generatedAt: nextWeek + 2 * 60_000,
      forecast: { ...projection().forecast, overduePending: 0 },
    }),
  });
  report = record(storage, nextWeek + WEEK_MS, {
    projection: projection({
      generatedAt: nextWeek + WEEK_MS,
      forecast: { ...projection().forecast, overduePending: 0 },
      champion: {
        ...projection().champion,
        challengers: [{ ...projection().champion.challengers[0], status: 'promotable' }],
      },
    }),
  }).finalizedReports[0];
  assert.equal(report.nextRecommendedTask.code, 'investigate_provider_drift');
}));

test('uses deterministic recommendation precedence', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000, { diagnosticsStale: true });
  let report = record(storage, MONDAY + WEEK_MS).finalizedReports[0];
  assert.equal(report.nextRecommendedTask.code, 'restore_fresh_diagnostics');

  const nextWeek = MONDAY + WEEK_MS;
  const overdue = projection({
    generatedAt: nextWeek + 60_000,
    forecast: { ...projection().forecast, overduePending: 4 },
  });
  record(storage, nextWeek + 60_000, { projection: overdue });
  report = record(storage, nextWeek + WEEK_MS).finalizedReports[0];
  assert.equal(report.nextRecommendedTask.code, 'resolve_overdue_predictions');
}));

test('continues oldest-first catch-up across invocations without skipping unavailable gaps', () => withStorage((storage) => {
  record(storage, MONDAY + 60_000);
  const first = record(storage, MONDAY + 13 * WEEK_MS, {
    monitor: { sidecarAvailable: false, diagnosticsAvailable: false },
    projection: null,
  });
  assert.deepEqual(first.finalizedReports.map((report) => report.period.weekStart),
    Array.from({ length: 8 }, (_, index) => MONDAY + index * WEEK_MS));
  assert.equal(first.accumulator.lastFinalizedWeekStart, MONDAY + 7 * WEEK_MS);
  assert.equal(first.accumulator.omittedCatchupWeeks, 5);
  assert.equal(first.finalizedReports.filter((report) => report.availability === 'unavailable').length, 7);
  assert.ok(first.finalizedReports.every((report) => report.limitations.includes('catchup_truncated')));

  const second = record(storage, MONDAY + 13 * WEEK_MS, {
    monitor: { sidecarAvailable: false, diagnosticsAvailable: false },
    projection: null,
  });
  assert.deepEqual(second.finalizedReports.map((report) => report.period.weekStart),
    Array.from({ length: 5 }, (_, index) => MONDAY + (index + 8) * WEEK_MS));
  assert.equal(second.accumulator.lastFinalizedWeekStart, MONDAY + 12 * WEEK_MS);
  assert.equal(second.accumulator.omittedCatchupWeeks, 0);
  assert.ok(second.finalizedReports.every((report) => report.availability === 'unavailable'));
  assert.ok(second.finalizedReports.every((report) => !report.limitations.includes('catchup_truncated')));

  const reports = readWeeklyEvaluationReports(storage);
  assert.equal(readdirSync(storage.resolve('monitor/evaluation-reports')).length, 8);
  assert.deepEqual(reports.map((report) => report.period.weekStart),
    Array.from({ length: 8 }, (_, index) => MONDAY + (index + 5) * WEEK_MS));
  assert.ok(reports.every((report) => report.availability === 'unavailable'));
}));

test('caps observations, promotion rows, privacy fields, and file size', () => withStorage((storage) => {
  const promotions = Array.from({ length: 6 }, (_, index) => ({
    at: MONDAY + (index + 1) * 1_000,
    kind: index % 2 === 0 ? 'promotion' : 'rollback',
    model: 'superforecast',
  }));
  const unsafe = projection({
    generatedAt: MONDAY + 60_000,
    claims: 'SECRET CLAIM',
    targetKey: 'PRIVATE_TARGET',
    forecast: { ...projection().forecast, rawError: 'TOKEN_VALUE' },
    champion: { ...projection().champion, promotions, evidenceRef: '/private/path' },
  });
  for (let index = 0; index < MAX_WEEKLY_OBSERVATIONS + 5; index += 1) {
    record(storage, MONDAY + 60_000 + index, { projection: unsafe });
  }
  const report = record(storage, MONDAY + WEEK_MS).finalizedReports[0];
  assert.equal(report.coverage.observations, MAX_WEEKLY_OBSERVATIONS);
  assert.ok(report.changes.promoted.rows.length <= 8);
  const serialized = JSON.stringify(report);
  for (const sentinel of ['SECRET CLAIM', 'PRIVATE_TARGET', 'TOKEN_VALUE', '/private/path']) {
    assert.equal(serialized.includes(sentinel), false);
  }
  assert.ok(Buffer.byteLength(serialized) <= 64 * 1024);
  assert.ok(statSync(storage.resolve('monitor/weekly-accumulator.json')).size <= 64 * 1024);
}));

test('caps unique promotion history and records omitted rows without changing decisions', () => withStorage((storage) => {
  for (let batch = 0; batch < 3; batch += 1) {
    const promotions = Array.from({ length: 6 }, (_, index) => ({
      at: MONDAY + 1_000 + batch * 10_000 + index,
      kind: 'promotion',
      model: index % 2 === 0 ? 'superforecast' : 'production',
    }));
    record(storage, MONDAY + 60_000 + batch, {
      projection: projection({
        generatedAt: MONDAY + 60_000 + batch,
        champion: { ...projection().champion, promotions },
      }),
    });
  }
  const report = record(storage, MONDAY + WEEK_MS).finalizedReports[0];
  assert.equal(report.changes.promoted.count, 18);
  assert.equal(report.changes.promoted.rows.length, 8);
  assert.equal(report.changes.promoted.omitted, 10);
}));

test('promoted changes exclude initial activation and rollback rows', () => withStorage((storage) => {
  const promotions = [
    { at: MONDAY + 1_000, kind: 'initial', model: 'production' },
    { at: MONDAY + 2_000, kind: 'promotion', model: 'superforecast' },
    { at: MONDAY + 3_000, kind: 'rollback', model: 'production' },
  ];
  record(storage, MONDAY + 60_000, {
    projection: projection({
      generatedAt: MONDAY + 60_000,
      champion: { ...projection().champion, promotions },
    }),
  });
  const report = generateWeeklyEvaluationReports({
    storage,
    at: MONDAY + WEEK_MS,
  }).finalizedReports[0];
  assert.equal(report.changes.promoted.count, 1);
  assert.deepEqual(report.changes.promoted.rows, [promotions[1]]);
  assert.equal(report.changes.promoted.omitted, 0);
  assert.equal(validateWeeklyEvaluationReport({
    ...report,
    changes: {
      ...report.changes,
      promoted: {
        ...report.changes.promoted,
        rows: [promotions[2]],
      },
    },
  }), false);
}));

test('serializes concurrent writers and preserves the prior accumulator on atomic failure', () => withStorage((storage) => {
  const release = record(storage, MONDAY + 60_000, {
    lockOptions: {
      pid: process.pid,
    },
  });
  assert.equal(release.accumulator.weeks[0].observationCount, 1);

  mkdirSync(storage.resolve('monitor'), { recursive: true });
  writeFileSync(storage.resolve('monitor/report.lock'), JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
  }), { mode: 0o600 });
  assert.throws(() => record(storage, MONDAY + 2 * 60_000), /already running/i);
  rmSync(storage.resolve('monitor/report.lock'));

  const before = readFileSync(storage.resolve('monitor/weekly-accumulator.json'));
  assert.throws(() => record(storage, MONDAY + 2 * 60_000, {
    writeJSONAtomic(_storage, path) {
      if (path.endsWith('weekly-accumulator.json')) throw new Error('simulated atomic failure');
    },
  }), /simulated atomic failure/);
  assert.deepEqual(readFileSync(storage.resolve('monitor/weekly-accumulator.json')), before);
}));

test('rejects oversized or recursively non-exact reports', () => {
  const base = {
    schemaVersion: 1,
    reportType: 'weekly_evaluation',
    generatedAt: MONDAY + WEEK_MS,
    period: { weekStart: MONDAY, weekEnd: MONDAY + WEEK_MS, timezone: 'UTC', complete: true },
    availability: 'unavailable',
    coverage: { observations: 0, fresh: 0, stale: 0, unavailable: 0, firstObservedAt: null, lastObservedAt: null },
    championChallenger: { availability: 'unavailable', active: null, challengers: [] },
    predictions: { availability: 'unavailable', endOfWeek: null, changeDuringWeek: null },
    drift: {
      model: { availability: 'unavailable', brierStart: null, brierEnd: null, brierDelta: null, resolutionCoverageStart: null, resolutionCoverageEnd: null, largestVersionLossShare: null },
      providers: { availability: 'unavailable', rows: [] },
    },
    changes: {
      promoted: { availability: 'unavailable', count: null, rows: [], omitted: 0 },
      rejected: { availability: 'unavailable', count: null, reasonCode: 'no_runtime_rejection_history' },
    },
    nextRecommendedTask: { availability: 'available', scope: 'operational', code: 'restore_monitor', roadmapTask: null },
    limitations: ['app_closed', 'partial_week', 'no_rejection_ledger', 'roadmap_metadata_unavailable'],
  };
  assert.equal(validateWeeklyEvaluationReport(base), true);
  assert.equal(validateWeeklyEvaluationReport({ ...base, token: 'secret' }), false);
  assert.equal(validateWeeklyEvaluationReport({
    ...base,
    limitations: Array.from({ length: 9 }, () => 'app_closed'),
  }), false);
});
