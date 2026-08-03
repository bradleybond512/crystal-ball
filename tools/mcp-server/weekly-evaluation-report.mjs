import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { acquireLocalLock } from './local-lock.mjs';
import { validCommittedMonitorState } from './tools/monitor-events.mjs';

const WEEK_MS = 7 * 24 * 60 * 60_000;
const MAX_COUNT = 1_000_000_000;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_CATCHUP_WEEKS = 8;
const MAX_RETAINED_REPORTS = 8;
const MAX_AGGREGATE_WEEKS = 9;
const MAX_AGGREGATE_PROMOTIONS = 16;
const MAX_REPORT_PROMOTIONS = 8;
const MODEL_DRIFT_BRIER_THRESHOLD = 0.02;
const ACCUMULATOR_PATH = 'monitor/weekly-accumulator.json';
const REPORT_DIRECTORY = 'monitor/evaluation-reports';
const REPORT_LOCK_PATH = 'monitor/report.lock';
const REPORT_FILE = /^weekly-(\d{4})-(\d{2})-(\d{2})\.json$/;

export const MAX_WEEKLY_OBSERVATIONS = 1_008;

const KNOWN_MODELS = [
  'production',
  'superforecast',
  'hierarchical-base-rate',
  'persistence-baseline',
  'momentum-baseline',
  'unknown',
];
const KNOWN_MODEL_SET = new Set(KNOWN_MODELS);
const KNOWN_DOMAINS = new Set([
  'weather', 'cyber', 'aviation', 'maritime', 'markets', 'conflict',
  'humanitarian', 'space', 'infra', 'macro', 'other',
]);
const PROVIDER_ROUTES = Object.freeze({
  acled: '/api/acled-events',
  markets: '/api/market-quotes',
  nws: '/api/nws-alerts',
  threatfox: '/api/threatfox-iocs',
  'cisa-kev': '/api/cisa-kev',
  adsb: '/api/adsb-military',
  ais: '/api/ais-snapshot',
  isw: '/api/isw-reports',
  openweather: '/api/owm-current',
  'fear-greed': '/api/fear-greed',
});
const KNOWN_PROVIDERS = Object.keys(PROVIDER_ROUTES);
const LIMITATION_CODES = new Set([
  'app_closed',
  'diagnostics_stale',
  'partial_week',
  'no_rejection_ledger',
  'roadmap_metadata_unavailable',
  'catchup_truncated',
]);
const RECOMMENDATION_CODES = new Set([
  'restore_monitor',
  'restore_fresh_diagnostics',
  'resolve_overdue_predictions',
  'investigate_model_drift',
  'investigate_provider_drift',
  'collect_more_evidence',
  'prepare_production_proof',
]);
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,32}$/;

export function utcWeekStart(at) {
  const epoch = epochOf(at);
  if (epoch === null) throw new Error('Weekly evaluation timestamp is invalid.');
  const date = new Date(epoch);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return midnight - daysSinceMonday * 24 * 60 * 60_000;
}

export function weeklyEvaluationReportPath(weekStart) {
  if (!validWeekStart(weekStart)) throw new Error('Weekly evaluation report requires a UTC Monday week start.');
  const date = new Date(weekStart);
  const day = `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
  return `${REPORT_DIRECTORY}/weekly-${day}.json`;
}

export function recordWeeklyEvaluation({
  storage,
  at,
  monitorState,
  monitorEvents,
  evaluationProjection,
  diagnosticsStale = false,
  lockOptions,
  writeJSONAtomic = writePrivateJSONAtomic,
} = {}) {
  if (!storage?.resolve || !storage?.readJSON || !storage?.listFiles) {
    throw new Error('Weekly evaluation storage is invalid.');
  }
  if (!validCommittedMonitorState(monitorState, monitorEvents)) {
    throw new Error('Weekly evaluation requires a committed monitor generation.');
  }
  const observedAt = epochOf(at);
  if (observedAt === null || observedAt !== monitorState.lastRunAt) {
    throw new Error('Weekly evaluation timestamp must match the committed monitor generation.');
  }
  const releaseLock = acquireLocalLock(storage.resolve(REPORT_LOCK_PATH), lockOptions);
  try {
    const currentWeekStart = utcWeekStart(observedAt);
    let accumulator = readAccumulator(storage);
    if (accumulator === null) accumulator = emptyAccumulator(currentWeekStart);
    if (currentWeekStart < accumulator.initializedWeekStart) {
      throw new Error('Weekly evaluation cannot move backward before initialization.');
    }

    const finalization = finalizeCompletedWeeks(storage, accumulator, currentWeekStart, observedAt);
    accumulator = finalization.accumulator;
    accumulator = appendObservation(accumulator, currentWeekStart, {
      at: observedAt,
      monitor: monitorState.snapshot,
      diagnosticsStale: diagnosticsStale === true,
      projection: sanitizeProjection(evaluationProjection),
    });
    assertBoundedJSON(accumulator, 'Weekly evaluation accumulator');

    for (const pending of finalization.pendingReports) {
      writeJSONAtomic(storage, pending.path, pending.report);
    }
    writeJSONAtomic(storage, ACCUMULATOR_PATH, accumulator);
    pruneReports(storage);
    return {
      accumulator,
      finalizedReports: finalization.pendingReports.map((entry) => entry.report),
    };
  } finally {
    releaseLock();
  }
}

export function generateWeeklyEvaluationReports({
  storage,
  at = Date.now(),
  lockOptions,
  writeJSONAtomic = writePrivateJSONAtomic,
} = {}) {
  assertStorage(storage);
  const generatedAt = epochOf(at);
  if (generatedAt === null) throw new Error('Weekly evaluation timestamp is invalid.');
  const releaseLock = acquireLocalLock(storage.resolve(REPORT_LOCK_PATH), lockOptions);
  try {
    const source = readAccumulator(storage);
    if (source === null) {
      return {
        available: false,
        reasonCode: 'no_weekly_accumulator',
        finalizedReports: [],
        reports: [],
        accumulator: null,
      };
    }
    const currentWeekStart = utcWeekStart(generatedAt);
    if (currentWeekStart < source.initializedWeekStart) {
      throw new Error('Weekly evaluation cannot move backward before initialization.');
    }
    const finalization = finalizeCompletedWeeks(storage, source, currentWeekStart, generatedAt);
    for (const pending of finalization.pendingReports) {
      writeJSONAtomic(storage, pending.path, pending.report);
    }
    if (finalization.relevantReports.length > 0) {
      writeJSONAtomic(storage, ACCUMULATOR_PATH, finalization.accumulator);
      pruneReports(storage);
    }
    const reports = finalization.relevantReports.length > 0
      ? finalization.relevantReports
      : latestCompletedReports(storage, currentWeekStart);
    return {
      available: true,
      reasonCode: null,
      finalizedReports: finalization.pendingReports.map((entry) => entry.report),
      reports,
      accumulator: accumulatorSummary(finalization.accumulator),
    };
  } finally {
    releaseLock();
  }
}

export function readWeeklyEvaluationReport(storage, options = {}) {
  assertStorage(storage);
  if (!exactRecord(options, options.weekStart === undefined ? [] : ['weekStart'])) {
    throw new Error('Weekly evaluation report options are invalid.');
  }
  const currentWeekStart = utcWeekStart(Date.now());
  if (options.weekStart === undefined) {
    return latestCompletedReports(storage, currentWeekStart).at(-1) ?? null;
  }
  if (!validWeekStart(options.weekStart)) {
    throw new Error('Weekly evaluation report requires a valid numeric UTC week start.');
  }
  if (options.weekStart + WEEK_MS > currentWeekStart) return null;
  const existing = readExistingReport(storage, weeklyEvaluationReportPath(options.weekStart), {
    allowMissing: true,
    expectedWeekStart: options.weekStart,
  });
  return existing?.report ?? null;
}

export function readWeeklyEvaluationReports(storage) {
  assertStorage(storage);
  return reportFiles(storage)
    .map((file) => readExistingReport(storage, `${REPORT_DIRECTORY}/${file}`, {
      expectedWeekStart: weekStartFromReportFile(file),
    }).report)
    .sort((left, right) => left.period.weekStart - right.period.weekStart);
}

export function validateWeeklyEvaluationReport(value) {
  if (!exactRecord(value, [
    'schemaVersion', 'reportType', 'generatedAt', 'period', 'availability', 'coverage',
    'championChallenger', 'predictions', 'drift', 'changes', 'nextRecommendedTask',
    'limitations',
  ])) return false;
  if (value.schemaVersion !== 1 || value.reportType !== 'weekly_evaluation') return false;
  if (epochOf(value.generatedAt) === null || !availabilityOf(value.availability)) return false;
  if (!validPeriod(value.period) || !validCoverage(value.coverage)) return false;
  if (!validChampionReport(value.championChallenger)) return false;
  if (!validPredictionReport(value.predictions) || !validDriftReport(value.drift)) return false;
  if (!validChangesReport(value.changes) || !validRecommendation(value.nextRecommendedTask)) return false;
  if (!Array.isArray(value.limitations) || value.limitations.length > 8) return false;
  if (!value.limitations.every((code) => LIMITATION_CODES.has(code))) return false;
  try {
    assertBoundedJSON(value, 'Weekly evaluation report');
  } catch {
    return false;
  }
  return true;
}

function finalizeCompletedWeeks(storage, source, currentWeekStart, generatedAt) {
  const accumulator = structuredClone(source);
  const firstCandidate = accumulator.lastFinalizedWeekStart === null
    ? accumulator.initializedWeekStart
    : accumulator.lastFinalizedWeekStart + WEEK_MS;
  const candidates = [];
  for (let weekStart = firstCandidate; weekStart < currentWeekStart; weekStart += WEEK_MS) {
    candidates.push(weekStart);
  }
  const omitted = Math.max(0, candidates.length - MAX_CATCHUP_WEEKS);
  const selected = candidates.slice(0, MAX_CATCHUP_WEEKS);
  accumulator.omittedCatchupWeeks = boundedCount(omitted);
  const pendingReports = [];
  const relevantReports = [];
  for (const weekStart of selected) {
    const aggregate = accumulator.weeks.find((week) => week.weekStart === weekStart)
      ?? emptyAggregate(weekStart);
    const report = compileReport(aggregate, generatedAt, accumulator.omittedCatchupWeeks > 0);
    const path = weeklyEvaluationReportPath(weekStart);
    const existing = readExistingReport(storage, path, {
      allowMissing: true,
      expectedWeekStart: weekStart,
    });
    if (existing === null) pendingReports.push({ path, report });
    relevantReports.push(existing?.report ?? report);
    accumulator.lastFinalizedWeekStart = weekStart;
  }
  if (omitted > 0 && selected.length > 0) {
    accumulator.lastFinalizedWeekStart = selected.at(-1);
  } else if (omitted > 0) {
    accumulator.lastFinalizedWeekStart = candidates.at(-1) ?? accumulator.lastFinalizedWeekStart;
  }
  accumulator.weeks = accumulator.weeks
    .filter((week) => week.weekStart >= currentWeekStart)
    .slice(-MAX_AGGREGATE_WEEKS);
  return { accumulator, pendingReports, relevantReports };
}

function appendObservation(accumulator, weekStart, observation) {
  const result = structuredClone(accumulator);
  let aggregate = result.weeks.find((week) => week.weekStart === weekStart);
  if (!aggregate) {
    aggregate = emptyAggregate(weekStart);
    result.weeks.push(aggregate);
    result.weeks.sort((left, right) => left.weekStart - right.weekStart);
    result.weeks = result.weeks.slice(-MAX_AGGREGATE_WEEKS);
  }
  if (aggregate.lastObservedAt !== null) {
    if (observation.at === aggregate.lastObservedAt) return result;
    if (observation.at < aggregate.lastObservedAt) {
      throw new Error('Weekly evaluation observations must remain chronological.');
    }
  }
  if (aggregate.observationCount >= MAX_WEEKLY_OBSERVATIONS) return result;
  aggregate.observationCount += 1;
  aggregate.firstObservedAt ??= observation.at;
  aggregate.lastObservedAt = observation.at;

  const monitorReady = observation.monitor.sidecarAvailable === true
    && observation.monitor.algorithmDiagnosticsAvailable === true;
  if (!monitorReady || observation.projection === null) {
    aggregate.unavailableCount += 1;
    return result;
  }
  if (observation.diagnosticsStale) {
    aggregate.staleCount += 1;
    return result;
  }

  aggregate.freshCount += 1;
  const forecast = forecastValues(observation.projection.forecast);
  aggregate.forecast.firstFresh ??= forecast;
  aggregate.forecast.lastFresh = forecast;
  if (forecast.brier !== null) {
    aggregate.forecast.minBrier = minimum(aggregate.forecast.minBrier, forecast.brier);
    aggregate.forecast.maxBrier = maximum(aggregate.forecast.maxBrier, forecast.brier);
  }
  if (forecast.largestVersionLossShare !== null) {
    aggregate.forecast.maxVersionLossShare = maximum(
      aggregate.forecast.maxVersionLossShare,
      forecast.largestVersionLossShare,
    );
  }

  const champion = championValues(observation.projection.champion);
  aggregate.champion.firstFresh ??= champion;
  aggregate.champion.lastFresh = champion;
  addPromotions(aggregate.champion, observation.projection.champion.promotions, weekStart);
  addProviderStatuses(aggregate.providers, observation.monitor.feeds);
  return result;
}

function compileReport(aggregate, generatedAt, catchupTruncated) {
  const overallAvailability = aggregate.freshCount === 0
    ? 'unavailable'
    : aggregate.freshCount === aggregate.observationCount
      ? 'complete'
      : 'partial';
  const detailAvailability = overallAvailability === 'complete'
    ? 'available'
    : overallAvailability;
  const firstForecast = aggregate.forecast.firstFresh;
  const lastForecast = aggregate.forecast.lastFresh;
  const firstChampion = aggregate.champion.firstFresh;
  const lastChampion = aggregate.champion.lastFresh;
  const providerRows = providerReportRows(aggregate.providers);
  const providerAvailability = providerRows.length === 0
    ? 'unavailable'
    : providerRows.length === KNOWN_PROVIDERS.length && detailAvailability === 'available'
      ? 'available'
      : 'partial';
  const championAvailable = lastChampion?.availability === 'available';
  const championAvailability = !championAvailable
    ? 'unavailable'
    : detailAvailability;
  const forecastAvailability = lastForecast === null ? 'unavailable' : detailAvailability;
  const promotionRows = aggregate.champion.promotions.slice(0, MAX_REPORT_PROMOTIONS);
  const promotionOmitted = boundedCount(
    aggregate.champion.promotionsOmitted
      + Math.max(0, aggregate.champion.promotions.length - MAX_REPORT_PROMOTIONS),
  );
  const promotionCount = forecastAvailability === 'unavailable'
    ? null
    : boundedCount(aggregate.champion.promotions.length + aggregate.champion.promotionsOmitted);
  const modelAvailability = firstForecast === null || lastForecast === null
    ? 'unavailable'
    : detailAvailability === 'available'
      && firstForecast.brier !== null
      && lastForecast.brier !== null
      && firstForecast.resolutionCoverage !== null
      && lastForecast.resolutionCoverage !== null
        ? 'available'
        : 'partial';
  const brierDelta = difference(lastForecast?.brier, firstForecast?.brier);
  const providerDrift = providerRows.some((row) => (
    row.degradedObservations > 0 || row.transitionCount > 0 || row.lastStatus === 'error'
  ));
  const limitations = reportLimitations(aggregate, overallAvailability, catchupTruncated);
  const recommendation = recommendationCode({
    aggregate,
    lastForecast,
    lastChampion,
    brierDelta,
    providerDrift,
  });
  const report = {
    schemaVersion: 1,
    reportType: 'weekly_evaluation',
    generatedAt,
    period: {
      weekStart: aggregate.weekStart,
      weekEnd: aggregate.weekStart + WEEK_MS,
      timezone: 'UTC',
      complete: true,
    },
    availability: overallAvailability,
    coverage: {
      observations: aggregate.observationCount,
      fresh: aggregate.freshCount,
      stale: aggregate.staleCount,
      unavailable: aggregate.unavailableCount,
      firstObservedAt: aggregate.firstObservedAt,
      lastObservedAt: aggregate.lastObservedAt,
    },
    championChallenger: {
      availability: championAvailability,
      active: championAvailable ? lastChampion.active : null,
      challengers: championAvailable ? lastChampion.challengers : [],
    },
    predictions: {
      availability: forecastAvailability,
      endOfWeek: lastForecast === null ? null : {
        pending: lastForecast.pending,
        overduePending: lastForecast.overduePending,
        expired: lastForecast.expired,
      },
      changeDuringWeek: firstForecast === null || lastForecast === null ? null : {
        pending: lastForecast.pending - firstForecast.pending,
        overduePending: lastForecast.overduePending - firstForecast.overduePending,
        expired: lastForecast.expired - firstForecast.expired,
      },
    },
    drift: {
      model: {
        availability: modelAvailability,
        brierStart: firstForecast?.brier ?? null,
        brierEnd: lastForecast?.brier ?? null,
        brierDelta,
        resolutionCoverageStart: firstForecast?.resolutionCoverage ?? null,
        resolutionCoverageEnd: lastForecast?.resolutionCoverage ?? null,
        largestVersionLossShare: aggregate.forecast.maxVersionLossShare,
      },
      providers: {
        availability: providerAvailability,
        rows: providerRows,
      },
    },
    changes: {
      promoted: {
        availability: promotionCount === null ? 'unavailable' : detailAvailability,
        count: promotionCount,
        rows: promotionCount === null ? [] : promotionRows,
        omitted: promotionCount === null ? 0 : promotionOmitted,
      },
      rejected: {
        availability: 'unavailable',
        count: null,
        reasonCode: 'no_runtime_rejection_history',
      },
    },
    nextRecommendedTask: {
      availability: 'available',
      scope: 'operational',
      code: recommendation,
      roadmapTask: null,
    },
    limitations,
  };
  if (!validateWeeklyEvaluationReport(report)) {
    throw new Error('Weekly evaluation report compiler produced an invalid report.');
  }
  return report;
}

function recommendationCode({ aggregate, lastForecast, lastChampion, brierDelta, providerDrift }) {
  if (aggregate.observationCount === 0 || aggregate.unavailableCount > 0) return 'restore_monitor';
  if (aggregate.staleCount > 0) return 'restore_fresh_diagnostics';
  if ((lastForecast?.overduePending ?? 0) > 0) return 'resolve_overdue_predictions';
  if (brierDelta !== null && brierDelta >= MODEL_DRIFT_BRIER_THRESHOLD) {
    return 'investigate_model_drift';
  }
  if (providerDrift) return 'investigate_provider_drift';
  if (
    lastChampion?.availability !== 'available'
    || lastChampion.challengers.length === 0
    || lastChampion.challengers.some((entry) => entry.status === 'insufficient_evidence')
  ) return 'collect_more_evidence';
  return 'prepare_production_proof';
}

function reportLimitations(aggregate, availability, catchupTruncated) {
  const result = [];
  if (aggregate.unavailableCount > 0 || aggregate.observationCount === 0) result.push('app_closed');
  if (aggregate.staleCount > 0) result.push('diagnostics_stale');
  if (availability !== 'complete') result.push('partial_week');
  result.push('no_rejection_ledger', 'roadmap_metadata_unavailable');
  if (catchupTruncated) result.push('catchup_truncated');
  return result;
}

function emptyAccumulator(initializedWeekStart) {
  return {
    schemaVersion: 1,
    initializedWeekStart,
    lastFinalizedWeekStart: null,
    omittedCatchupWeeks: 0,
    weeks: [],
  };
}

function emptyAggregate(weekStart) {
  return {
    weekStart,
    observationCount: 0,
    freshCount: 0,
    staleCount: 0,
    unavailableCount: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    forecast: {
      firstFresh: null,
      lastFresh: null,
      minBrier: null,
      maxBrier: null,
      maxVersionLossShare: null,
    },
    champion: {
      firstFresh: null,
      lastFresh: null,
      promotions: [],
      promotionsOmitted: 0,
    },
    providers: Object.fromEntries(KNOWN_PROVIDERS.map((provider) => [provider, {
      firstStatus: null,
      lastStatus: null,
      degradedObservations: 0,
      transitionCount: 0,
    }])),
  };
}

function forecastValues(forecast) {
  return {
    pending: forecast.pending,
    overduePending: forecast.overduePending,
    expired: forecast.expired,
    resolutionCoverage: forecast.resolutionCoverage,
    brier: forecast.metrics.brier.status === 'ok' ? forecast.metrics.brier.value : null,
    largestVersionLossShare: forecast.largestVersionLossShare,
  };
}

function championValues(champion) {
  return {
    availability: champion.availability,
    active: champion.availability === 'available' ? champion.active : null,
    challengers: champion.availability === 'available' ? champion.challengers : [],
  };
}

function addPromotions(target, promotions, weekStart) {
  const weekEnd = weekStart + WEEK_MS;
  for (const promotion of promotions) {
    if (promotion.at < weekStart || promotion.at >= weekEnd) continue;
    const duplicate = target.promotions.some((existing) => (
      existing.at === promotion.at
      && existing.kind === promotion.kind
      && existing.model === promotion.model
    ));
    if (duplicate) continue;
    if (target.promotions.length >= MAX_AGGREGATE_PROMOTIONS) {
      target.promotionsOmitted = boundedCount(target.promotionsOmitted + 1);
      continue;
    }
    target.promotions.push(promotion);
    target.promotions.sort((left, right) => (
      left.at - right.at || left.kind.localeCompare(right.kind) || left.model.localeCompare(right.model)
    ));
  }
}

function addProviderStatuses(target, feeds) {
  if (!recordOf(feeds)) return;
  for (const provider of KNOWN_PROVIDERS) {
    const status = statusOf(feeds[PROVIDER_ROUTES[provider]]);
    if (status === null) continue;
    const row = target[provider];
    row.firstStatus ??= status;
    if (row.lastStatus !== null && row.lastStatus !== status) row.transitionCount += 1;
    row.lastStatus = status;
    if (status === 'error') row.degradedObservations += 1;
  }
}

function providerReportRows(providers) {
  return KNOWN_PROVIDERS.flatMap((provider) => {
    const row = providers[provider];
    if (row.firstStatus === null || row.lastStatus === null) return [];
    return [{
      provider,
      firstStatus: row.firstStatus,
      lastStatus: row.lastStatus,
      degradedObservations: row.degradedObservations,
      transitionCount: row.transitionCount,
    }];
  });
}

function sanitizeProjection(value) {
  const input = recordOf(value);
  if (!input || input.schemaVersion !== 1 || epochOf(input.generatedAt) === null) return null;
  const forecast = sanitizeForecast(input.forecast);
  const champion = sanitizeChampion(input.champion);
  if (forecast === null || champion === null) return null;
  return { forecast, champion };
}

function sanitizeForecast(value) {
  const input = recordOf(value);
  const metrics = recordOf(input?.metrics);
  if (!input || !metrics) return null;
  const counts = ['total', 'resolved', 'pending', 'overduePending', 'expired', 'quarantinedCount'];
  if (!counts.every((key) => countOf(input[key]) !== null)) return null;
  const sanitizedMetrics = {
    brier: sanitizeMetric(metrics.brier, 0, 1),
    logLoss: sanitizeMetric(metrics.logLoss, 0, 100),
    brierSkill: sanitizeMetric(metrics.brierSkill, -10, 1),
    equalMassEce: sanitizeMetric(metrics.equalMassEce, 0, 1),
  };
  if (Object.values(sanitizedMetrics).some((metric) => metric === null)) return null;
  const resolutionCoverage = nullableRatioOf(input.resolutionCoverage);
  const expirationRate = nullableRatioOf(input.expirationRate);
  const largestVersionLossShare = nullableRatioOf(input.largestVersionLossShare);
  if (resolutionCoverage === undefined || expirationRate === undefined || largestVersionLossShare === undefined) return null;
  return {
    total: input.total,
    resolved: input.resolved,
    pending: input.pending,
    overduePending: input.overduePending,
    expired: input.expired,
    resolutionCoverage,
    expirationRate,
    metrics: sanitizedMetrics,
    largestVersionLossShare,
    quarantinedCount: input.quarantinedCount,
  };
}

function sanitizeMetric(value, minimum, maximum) {
  const input = recordOf(value);
  if (!input) return null;
  if (input.status === 'unavailable') return { status: 'unavailable' };
  if (input.status === 'ok') {
    const sampleSize = countOf(input.sampleSize);
    const metricValue = boundedNumberOf(input.value, minimum, maximum);
    return sampleSize === null || metricValue === null
      ? null
      : { status: 'ok', sampleSize, value: metricValue };
  }
  if (input.status === 'insufficient_evidence') {
    const sampleSize = countOf(input.sampleSize);
    const minSampleSize = countOf(input.minSampleSize);
    return sampleSize === null || minSampleSize === null
      ? null
      : { status: 'insufficient_evidence', sampleSize, minSampleSize };
  }
  return null;
}

function sanitizeChampion(value) {
  const input = recordOf(value);
  if (!input || !['available', 'unavailable'].includes(input.availability)) return null;
  const active = sanitizeActive(input.active);
  if (active === undefined || !Array.isArray(input.challengers) || input.challengers.length > 4) return null;
  if (!Array.isArray(input.promotions) || input.promotions.length > 6) return null;
  const challengers = input.challengers.map(sanitizeChallenger);
  const promotions = input.promotions.map(sanitizePromotion);
  if (challengers.some((entry) => entry === null) || promotions.some((entry) => entry === null)) return null;
  return {
    availability: input.availability,
    active: input.availability === 'available' ? active : null,
    challengers: input.availability === 'available' ? challengers : [],
    promotions,
  };
}

function sanitizeActive(value) {
  if (value === null) return null;
  const input = recordOf(value);
  if (!input || !KNOWN_MODEL_SET.has(input.model) || epochOf(input.activatedAt) === null) return undefined;
  const version = input.version === null
    ? null
    : typeof input.version === 'string' && SAFE_VERSION.test(input.version) ? input.version : undefined;
  if (version === undefined) return undefined;
  return { model: input.model, version };
}

function sanitizeChallenger(value) {
  const input = recordOf(value);
  if (!input || !KNOWN_MODEL_SET.has(input.model)) return null;
  if (!['promotable', 'rejected', 'insufficient_evidence'].includes(input.status)) return null;
  const evidenceCount = countOf(input.evidenceCount);
  const proxyShare = ratioOf(input.proxyShare);
  if (evidenceCount === null || proxyShare === null) return null;
  if (!Array.isArray(input.perDomain) || input.perDomain.length > 11) return null;
  if (!Array.isArray(input.deltas) || input.deltas.length > 2) return null;
  const perDomain = input.perDomain.map((row) => {
    const item = recordOf(row);
    const count = countOf(item?.count);
    return item && KNOWN_DOMAINS.has(item.domain) && count !== null
      ? { domain: item.domain, count }
      : null;
  });
  const deltas = input.deltas.map((row) => {
    const item = recordOf(row);
    const delta = boundedNumberOf(item?.delta, -100, 100);
    const ciLow = boundedNumberOf(item?.ciLow, -100, 100);
    const ciHigh = boundedNumberOf(item?.ciHigh, -100, 100);
    return item && ['brier', 'logLoss'].includes(item.metric)
      && delta !== null && ciLow !== null && ciHigh !== null
      ? { metric: item.metric, delta, ciLow, ciHigh }
      : null;
  });
  if (perDomain.some((row) => row === null) || deltas.some((row) => row === null)) return null;
  return { model: input.model, status: input.status, evidenceCount, proxyShare, perDomain, deltas };
}

function sanitizePromotion(value) {
  const input = recordOf(value);
  if (!input || epochOf(input.at) === null) return null;
  if (!['initial', 'promotion', 'rollback'].includes(input.kind)) return null;
  if (!KNOWN_MODEL_SET.has(input.model)) return null;
  return { at: input.at, kind: input.kind, model: input.model };
}

function readAccumulator(storage) {
  const path = storage.resolve(ACCUMULATOR_PATH);
  if (!existsSync(path)) return null;
  const raw = readBoundedFile(path, 'Weekly evaluation accumulator');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Existing weekly evaluation accumulator is malformed.'); }
  if (!validAccumulator(parsed)) throw new Error('Existing weekly evaluation accumulator is malformed.');
  return parsed;
}

function validAccumulator(value) {
  if (!exactRecord(value, [
    'schemaVersion', 'initializedWeekStart', 'lastFinalizedWeekStart', 'omittedCatchupWeeks', 'weeks',
  ])) return false;
  if (value.schemaVersion !== 1 || !validWeekStart(value.initializedWeekStart)) return false;
  if (value.lastFinalizedWeekStart !== null && !validWeekStart(value.lastFinalizedWeekStart)) return false;
  if (countOf(value.omittedCatchupWeeks) === null) return false;
  if (!Array.isArray(value.weeks) || value.weeks.length > MAX_AGGREGATE_WEEKS) return false;
  return value.weeks.every(validAggregate);
}

function validAggregate(value) {
  if (!exactRecord(value, [
    'weekStart', 'observationCount', 'freshCount', 'staleCount', 'unavailableCount',
    'firstObservedAt', 'lastObservedAt', 'forecast', 'champion', 'providers',
  ])) return false;
  if (!validWeekStart(value.weekStart)) return false;
  for (const key of ['observationCount', 'freshCount', 'staleCount', 'unavailableCount']) {
    if (countOf(value[key]) === null) return false;
  }
  if (value.observationCount > MAX_WEEKLY_OBSERVATIONS) return false;
  if (value.freshCount + value.staleCount + value.unavailableCount !== value.observationCount) return false;
  if (!nullableEpoch(value.firstObservedAt) || !nullableEpoch(value.lastObservedAt)) return false;
  if (!validAggregateForecast(value.forecast) || !validAggregateChampion(value.champion)) return false;
  if (!exactRecord(value.providers, KNOWN_PROVIDERS)) return false;
  return KNOWN_PROVIDERS.every((provider) => validProviderAggregate(value.providers[provider]));
}

function validAggregateForecast(value) {
  return exactRecord(value, [
    'firstFresh', 'lastFresh', 'minBrier', 'maxBrier', 'maxVersionLossShare',
  ])
    && (value.firstFresh === null || validForecastValues(value.firstFresh))
    && (value.lastFresh === null || validForecastValues(value.lastFresh))
    && nullableBounded(value.minBrier, 0, 1)
    && nullableBounded(value.maxBrier, 0, 1)
    && nullableRatio(value.maxVersionLossShare);
}

function validForecastValues(value) {
  return exactRecord(value, [
    'pending', 'overduePending', 'expired', 'resolutionCoverage', 'brier',
    'largestVersionLossShare',
  ])
    && countOf(value.pending) !== null
    && countOf(value.overduePending) !== null
    && countOf(value.expired) !== null
    && nullableRatio(value.resolutionCoverage)
    && nullableBounded(value.brier, 0, 1)
    && nullableRatio(value.largestVersionLossShare);
}

function validAggregateChampion(value) {
  return exactRecord(value, [
    'firstFresh', 'lastFresh', 'promotions', 'promotionsOmitted',
  ])
    && (value.firstFresh === null || validChampionValues(value.firstFresh))
    && (value.lastFresh === null || validChampionValues(value.lastFresh))
    && Array.isArray(value.promotions)
    && value.promotions.length <= MAX_AGGREGATE_PROMOTIONS
    && value.promotions.every(validPromotion)
    && countOf(value.promotionsOmitted) !== null;
}

function validChampionValues(value) {
  return exactRecord(value, ['availability', 'active', 'challengers'])
    && ['available', 'unavailable'].includes(value.availability)
    && (value.active === null || validActive(value.active))
    && Array.isArray(value.challengers)
    && value.challengers.length <= 4
    && value.challengers.every(validChallenger);
}

function validProviderAggregate(value) {
  return exactRecord(value, [
    'firstStatus', 'lastStatus', 'degradedObservations', 'transitionCount',
  ])
    && (value.firstStatus === null || statusOf(value.firstStatus) !== null)
    && (value.lastStatus === null || statusOf(value.lastStatus) !== null)
    && countOf(value.degradedObservations) !== null
    && countOf(value.transitionCount) !== null;
}

function readExistingReport(storage, relPath, {
  allowMissing = false,
  expectedWeekStart,
} = {}) {
  const path = storage.resolve(relPath);
  if (!existsSync(path)) {
    if (allowMissing) return null;
    throw new Error('Weekly evaluation report is missing.');
  }
  const raw = readBoundedFile(path, 'Existing weekly report');
  let report;
  try { report = JSON.parse(raw); } catch { throw new Error('Existing weekly report is malformed.'); }
  if (!validateWeeklyEvaluationReport(report)) throw new Error('Existing weekly report is malformed.');
  if (expectedWeekStart !== undefined && report.period.weekStart !== expectedWeekStart) {
    throw new Error('Existing weekly report filename does not match its period.');
  }
  return { report, raw };
}

function reportFiles(storage) {
  return storage.listFiles(REPORT_DIRECTORY, '*.json')
    .filter((file) => REPORT_FILE.test(file))
    .sort();
}

function latestCompletedReports(storage, currentWeekStart) {
  return readWeeklyEvaluationReports(storage)
    .filter((report) => report.period.weekEnd <= currentWeekStart)
    .slice(-1);
}

function accumulatorSummary(accumulator) {
  return {
    initializedWeekStart: accumulator.initializedWeekStart,
    lastFinalizedWeekStart: accumulator.lastFinalizedWeekStart,
    omittedCatchupWeeks: accumulator.omittedCatchupWeeks,
    retainedWeeks: accumulator.weeks.length,
  };
}

function weekStartFromReportFile(file) {
  const match = REPORT_FILE.exec(file);
  if (!match) throw new Error('Weekly evaluation report filename is invalid.');
  const weekStart = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!validWeekStart(weekStart) || weeklyEvaluationReportPath(weekStart).split('/').at(-1) !== file) {
    throw new Error('Weekly evaluation report filename is invalid.');
  }
  return weekStart;
}

function pruneReports(storage) {
  const files = reportFiles(storage);
  for (const file of files.slice(0, Math.max(0, files.length - MAX_RETAINED_REPORTS))) {
    unlinkSync(storage.resolve(`${REPORT_DIRECTORY}/${file}`));
  }
}

export function writePrivateJSONAtomic(storage, relPath, data, {
  renameSyncFn = renameSync,
} = {}) {
  assertBoundedJSON(data, 'Weekly evaluation file');
  const destination = storage.resolve(relPath);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(destination), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2), {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    renameSyncFn(temporary, destination);
    chmodSync(destination, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function validPeriod(value) {
  return exactRecord(value, ['weekStart', 'weekEnd', 'timezone', 'complete'])
    && validWeekStart(value.weekStart)
    && value.weekEnd === value.weekStart + WEEK_MS
    && value.timezone === 'UTC'
    && value.complete === true;
}

function validCoverage(value) {
  if (!exactRecord(value, [
    'observations', 'fresh', 'stale', 'unavailable', 'firstObservedAt', 'lastObservedAt',
  ])) return false;
  if (countOf(value.observations) === null || value.observations > MAX_WEEKLY_OBSERVATIONS) return false;
  if (countOf(value.fresh) === null || countOf(value.stale) === null || countOf(value.unavailable) === null) return false;
  return value.fresh + value.stale + value.unavailable === value.observations
    && nullableEpoch(value.firstObservedAt)
    && nullableEpoch(value.lastObservedAt);
}

function validChampionReport(value) {
  return exactRecord(value, ['availability', 'active', 'challengers'])
    && detailAvailabilityOf(value.availability)
    && (value.active === null || validActive(value.active))
    && Array.isArray(value.challengers)
    && value.challengers.length <= 4
    && value.challengers.every(validChallenger);
}

function validPredictionReport(value) {
  return exactRecord(value, ['availability', 'endOfWeek', 'changeDuringWeek'])
    && detailAvailabilityOf(value.availability)
    && (value.endOfWeek === null || (
      exactRecord(value.endOfWeek, ['pending', 'overduePending', 'expired'])
      && countOf(value.endOfWeek.pending) !== null
      && countOf(value.endOfWeek.overduePending) !== null
      && countOf(value.endOfWeek.expired) !== null
    ))
    && (value.changeDuringWeek === null || (
      exactRecord(value.changeDuringWeek, ['pending', 'overduePending', 'expired'])
      && integerDelta(value.changeDuringWeek.pending)
      && integerDelta(value.changeDuringWeek.overduePending)
      && integerDelta(value.changeDuringWeek.expired)
    ));
}

function validDriftReport(value) {
  if (!exactRecord(value, ['model', 'providers'])) return false;
  const model = value.model;
  if (!exactRecord(model, [
    'availability', 'brierStart', 'brierEnd', 'brierDelta', 'resolutionCoverageStart',
    'resolutionCoverageEnd', 'largestVersionLossShare',
  ])) return false;
  if (!detailAvailabilityOf(model.availability)) return false;
  if (!nullableBounded(model.brierStart, 0, 1) || !nullableBounded(model.brierEnd, 0, 1)) return false;
  if (!nullableBounded(model.brierDelta, -1, 1)) return false;
  if (!nullableRatio(model.resolutionCoverageStart) || !nullableRatio(model.resolutionCoverageEnd)) return false;
  if (!nullableRatio(model.largestVersionLossShare)) return false;
  const providers = value.providers;
  return exactRecord(providers, ['availability', 'rows'])
    && detailAvailabilityOf(providers.availability)
    && Array.isArray(providers.rows)
    && providers.rows.length <= 10
    && providers.rows.every(validProviderReportRow);
}

function validProviderReportRow(value) {
  return exactRecord(value, [
    'provider', 'firstStatus', 'lastStatus', 'degradedObservations', 'transitionCount',
  ])
    && KNOWN_PROVIDERS.includes(value.provider)
    && statusOf(value.firstStatus) !== null
    && statusOf(value.lastStatus) !== null
    && countOf(value.degradedObservations) !== null
    && countOf(value.transitionCount) !== null;
}

function validChangesReport(value) {
  if (!exactRecord(value, ['promoted', 'rejected'])) return false;
  const promoted = value.promoted;
  const rejected = value.rejected;
  return exactRecord(promoted, ['availability', 'count', 'rows', 'omitted'])
    && detailAvailabilityOf(promoted.availability)
    && (promoted.count === null || countOf(promoted.count) !== null)
    && Array.isArray(promoted.rows)
    && promoted.rows.length <= MAX_REPORT_PROMOTIONS
    && promoted.rows.every(validPromotion)
    && countOf(promoted.omitted) !== null
    && exactRecord(rejected, ['availability', 'count', 'reasonCode'])
    && rejected.availability === 'unavailable'
    && rejected.count === null
    && rejected.reasonCode === 'no_runtime_rejection_history';
}

function validRecommendation(value) {
  return exactRecord(value, ['availability', 'scope', 'code', 'roadmapTask'])
    && ['available', 'unavailable'].includes(value.availability)
    && value.scope === 'operational'
    && RECOMMENDATION_CODES.has(value.code)
    && value.roadmapTask === null;
}

function validActive(value) {
  return exactRecord(value, ['model', 'version'])
    && KNOWN_MODEL_SET.has(value.model)
    && (value.version === null || (typeof value.version === 'string' && SAFE_VERSION.test(value.version)));
}

function validChallenger(value) {
  return exactRecord(value, [
    'model', 'status', 'evidenceCount', 'proxyShare', 'perDomain', 'deltas',
  ])
    && KNOWN_MODEL_SET.has(value.model)
    && ['promotable', 'rejected', 'insufficient_evidence'].includes(value.status)
    && countOf(value.evidenceCount) !== null
    && ratioOf(value.proxyShare) !== null
    && Array.isArray(value.perDomain)
    && value.perDomain.length <= 11
    && value.perDomain.every((row) => exactRecord(row, ['domain', 'count'])
      && KNOWN_DOMAINS.has(row.domain) && countOf(row.count) !== null)
    && Array.isArray(value.deltas)
    && value.deltas.length <= 2
    && value.deltas.every((row) => exactRecord(row, ['metric', 'delta', 'ciLow', 'ciHigh'])
      && ['brier', 'logLoss'].includes(row.metric)
      && boundedNumberOf(row.delta, -100, 100) !== null
      && boundedNumberOf(row.ciLow, -100, 100) !== null
      && boundedNumberOf(row.ciHigh, -100, 100) !== null);
}

function validPromotion(value) {
  return exactRecord(value, ['at', 'kind', 'model'])
    && epochOf(value.at) !== null
    && ['initial', 'promotion', 'rollback'].includes(value.kind)
    && KNOWN_MODEL_SET.has(value.model);
}

function readBoundedFile(path, label) {
  const raw = readFileSync(path, 'utf8');
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error(`${label} exceeds 64 KiB.`);
  return raw;
}

function assertBoundedJSON(value, label) {
  if (Buffer.byteLength(JSON.stringify(value, null, 2)) > MAX_FILE_BYTES) {
    throw new Error(`${label} exceeds 64 KiB.`);
  }
}

function assertStorage(storage) {
  if (!storage?.resolve || !storage?.readJSON || !storage?.listFiles) {
    throw new Error('Weekly evaluation storage is invalid.');
  }
}

function validWeekStart(value) {
  return epochOf(value) !== null && utcWeekStart(value) === value;
}

function exactRecord(value, keys) {
  if (!recordOf(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function epochOf(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function countOf(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT
    ? value
    : null;
}

function boundedCount(value) {
  return Math.min(MAX_COUNT, Math.max(0, Math.trunc(value)));
}

function boundedNumberOf(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function ratioOf(value) {
  return boundedNumberOf(value, 0, 1);
}

function nullableRatioOf(value) {
  if (value === null) return null;
  return ratioOf(value) ?? undefined;
}

function nullableRatio(value) {
  return value === null || ratioOf(value) !== null;
}

function nullableBounded(value, minimum, maximum) {
  return value === null || boundedNumberOf(value, minimum, maximum) !== null;
}

function nullableEpoch(value) {
  return value === null || epochOf(value) !== null;
}

function statusOf(value) {
  return value === 'ok' || value === 'error' ? value : null;
}

function availabilityOf(value) {
  return value === 'complete' || value === 'partial' || value === 'unavailable';
}

function detailAvailabilityOf(value) {
  return value === 'available' || value === 'partial' || value === 'unavailable';
}

function integerDelta(value) {
  return Number.isSafeInteger(value) && value >= -MAX_COUNT && value <= MAX_COUNT;
}

function difference(after, before) {
  if (after === null || after === undefined || before === null || before === undefined) return null;
  return Number((after - before).toFixed(12));
}

function minimum(left, right) {
  return left === null ? right : Math.min(left, right);
}

function maximum(left, right) {
  return left === null ? right : Math.max(left, right);
}

function two(value) {
  return String(value).padStart(2, '0');
}
