const FORECAST_COHORT_LIMIT = 10;
const MAX_COUNT = 1_000_000_000;
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,32}$/;
const KNOWN_MODELS = new Set([
  'production',
  'superforecast',
  'hierarchical-base-rate',
  'persistence-baseline',
  'momentum-baseline',
  'unknown',
]);
const KNOWN_DOMAINS = new Set([
  'weather', 'cyber', 'aviation', 'maritime', 'markets', 'conflict',
  'humanitarian', 'space', 'infra', 'macro', 'other',
]);
const EVALUATION_REASONS = new Set([
  'invalid_baseline',
  'zero_baseline_error',
  'training_sample_floor',
  'sample_floor',
  'degenerate_outcomes',
  'degenerate_probabilities',
  'singular_fit',
  'fit_failed',
]);

export function publicAlgorithmDiagnostics(value) {
  const diagnostics = objectValue(value);
  if (!diagnostics) return null;
  const output = { ...diagnostics };
  const forecastCalibration = publicForecastCalibration(
    diagnostics.forecastCalibration,
  );
  if (forecastCalibration) output.forecastCalibration = forecastCalibration;
  return output;
}

export function publicEvaluationReportProjection(value) {
  const input = objectValue(value);
  if (input?.schemaVersion !== 1) return null;
  const generatedAt = epochValue(input.generatedAt);
  const forecast = publicEvaluationForecast(input.forecast);
  const champion = publicEvaluationChampion(input.champion);
  if (generatedAt === null || forecast === null || champion === null) return null;
  return {
    schemaVersion: 1,
    generatedAt,
    forecast,
    champion,
  };
}

function publicEvaluationForecast(value) {
  const input = objectValue(value);
  const metrics = objectValue(input?.metrics);
  if (!input || !metrics) return null;
  const total = exactCount(input.total);
  const resolved = exactCount(input.resolved);
  const pending = exactCount(input.pending);
  const overduePending = exactCount(input.overduePending);
  const expired = exactCount(input.expired);
  const quarantinedCount = exactCount(input.quarantinedCount);
  const resolutionCoverage = exactNullableRatio(input.resolutionCoverage);
  const expirationRate = exactNullableRatio(input.expirationRate);
  const largestVersionLossShare = exactNullableRatio(input.largestVersionLossShare);
  const brier = publicEvaluationMetric(metrics.brier, 0, 1);
  const logLoss = publicEvaluationMetric(metrics.logLoss, 0, 100);
  const brierSkill = publicEvaluationMetric(metrics.brierSkill, -10, 1);
  const equalMassEce = publicEvaluationMetric(metrics.equalMassEce, 0, 1);
  if (
    [total, resolved, pending, overduePending, expired, quarantinedCount]
      .some((entry) => entry === null)
    || [resolutionCoverage, expirationRate, largestVersionLossShare]
      .some((entry) => entry === undefined)
    || [brier, logLoss, brierSkill, equalMassEce].some((entry) => entry === null)
  ) return null;
  if (resolved + pending + expired !== total || overduePending > pending) return null;
  return {
    total,
    resolved,
    pending,
    overduePending,
    expired,
    resolutionCoverage,
    expirationRate,
    metrics: { brier, logLoss, brierSkill, equalMassEce },
    largestVersionLossShare,
    quarantinedCount,
  };
}

function publicEvaluationMetric(value, minimum, maximum) {
  const input = objectValue(value);
  if (!input) return null;
  if (input.status === 'unavailable') return { status: 'unavailable' };
  const sampleSize = exactCount(input.sampleSize);
  if (input.status === 'ok') {
    const metric = exactBoundedNumber(input.value, minimum, maximum);
    return sampleSize === null || metric === null
      ? null
      : { status: 'ok', sampleSize, value: metric };
  }
  if (input.status !== 'insufficient_evidence') return null;
  const minSampleSize = exactCount(input.minSampleSize);
  return sampleSize === null || minSampleSize === null
    ? null
    : { status: 'insufficient_evidence', sampleSize, minSampleSize };
}

function publicEvaluationChampion(value) {
  const input = objectValue(value);
  if (!input || !['available', 'unavailable'].includes(input.availability)) return null;
  const active = publicEvaluationActive(input.active);
  if (active === undefined) return null;
  if (!Array.isArray(input.challengers) || input.challengers.length > 4) return null;
  if (!Array.isArray(input.promotions) || input.promotions.length > 6) return null;
  const challengers = input.challengers.map(publicEvaluationChallenger);
  const promotions = input.promotions.map(publicEvaluationPromotion);
  const rejectionHistory = objectValue(input.rejectionHistory);
  if (
    challengers.some((entry) => entry === null)
    || promotions.some((entry) => entry === null)
    || rejectionHistory?.availability !== 'unavailable'
    || rejectionHistory?.reasonCode !== 'no_runtime_rejection_history'
  ) return null;
  if (
    input.availability === 'unavailable'
    && (active !== null || challengers.length > 0 || promotions.length > 0)
  ) return null;
  return {
    availability: input.availability,
    active,
    challengers,
    promotions,
    rejectionHistory: {
      availability: 'unavailable',
      reasonCode: 'no_runtime_rejection_history',
    },
  };
}

function publicEvaluationActive(value) {
  if (value === null) return null;
  const input = objectValue(value);
  if (!input || !KNOWN_MODELS.has(input.model)) return undefined;
  const activatedAt = epochValue(input.activatedAt);
  const version = input.version === null
    ? null
    : typeof input.version === 'string' && SAFE_VERSION.test(input.version)
      ? input.version
      : undefined;
  return activatedAt === null || version === undefined
    ? undefined
    : { model: input.model, version, activatedAt };
}

function publicEvaluationChallenger(value) {
  const input = objectValue(value);
  if (!input || !KNOWN_MODELS.has(input.model)) return null;
  if (!['promotable', 'rejected', 'insufficient_evidence'].includes(input.status)) return null;
  const evidenceCount = exactCount(input.evidenceCount);
  const proxyShare = exactBoundedNumber(input.proxyShare, 0, 1);
  if (evidenceCount === null || proxyShare === null) return null;
  if (!Array.isArray(input.perDomain) || input.perDomain.length > 11) return null;
  if (!Array.isArray(input.deltas) || input.deltas.length > 2) return null;
  const perDomain = input.perDomain.map(publicEvaluationDomain);
  const deltas = input.deltas.map(publicEvaluationDelta);
  if (perDomain.some((entry) => entry === null) || deltas.some((entry) => entry === null)) return null;
  return {
    model: input.model,
    status: input.status,
    evidenceCount,
    proxyShare,
    perDomain,
    deltas,
  };
}

function publicEvaluationDomain(value) {
  const input = objectValue(value);
  const count = exactCount(input?.count);
  return input && KNOWN_DOMAINS.has(input.domain) && count !== null
    ? { domain: input.domain, count }
    : null;
}

function publicEvaluationDelta(value) {
  const input = objectValue(value);
  if (!input || !['brier', 'logLoss'].includes(input.metric)) return null;
  const delta = exactBoundedNumber(input.delta, -100, 100);
  const ciLow = exactBoundedNumber(input.ciLow, -100, 100);
  const ciHigh = exactBoundedNumber(input.ciHigh, -100, 100);
  return delta === null || ciLow === null || ciHigh === null
    ? null
    : { metric: input.metric, delta, ciLow, ciHigh };
}

function publicEvaluationPromotion(value) {
  const input = objectValue(value);
  const at = epochValue(input?.at);
  if (!input || at === null) return null;
  if (!['initial', 'promotion', 'rollback'].includes(input.kind)) return null;
  return KNOWN_MODELS.has(input.model)
    ? { at, kind: input.kind, model: input.model }
    : null;
}

const RUN_COUNTS = [
  'pending', 'rawOverdueBefore', 'rawOverdueAfter', 'diagnosticOverdueBefore', 'diagnosticOverdueAfter',
  'pastExpiryGrace', 'eligibleOverdueBefore', 'eligibleOverdueAfter', 'opportunities', 'unsupported',
  'invalidCriteria', 'awaitingEvidence', 'windowOpen', 'rejectedWrites', 'expired', 'direct', 'proxy',
  'unattributed', 'persistenceFailures',
];
const BRIDGE_COUNTS = ['shortageExpired', 'advisoryExpired', 'legacyExpired'];
const RUN_STATES = new Set(['ready', 'hidden', 'cognition-disabled', 'not-hydrated', 'disposed', 'coordination-unavailable']);

function publicRunMetrics(raw, kind) {
  if (!objectValue(raw)) return null;
  const metrics = {};
  const bridge = kind === 'bridge';
  for (const key of bridge ? BRIDGE_COUNTS : RUN_COUNTS) {
    const count = exactCount(raw[key]);
    if (count === null) return null;
    metrics[key] = count;
  }
  if (bridge) {
    if (typeof raw.enabled !== 'boolean' || typeof raw.failed !== 'boolean') return null;
    metrics.enabled = raw.enabled;
    metrics.failed = raw.failed;
  }
  return metrics;
}

function publicRunReceipt(value) {
  const run = objectValue(value);
  if (!run) return null;
  const { sequence, kind, dueAt, startedAt, completedAt, readiness, outcome } = run;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !['scheduled', 'catchup', 'bridge'].includes(kind)
    || !RUN_STATES.has(readiness) || !['completed', 'skipped', 'failed'].includes(outcome)
    || ![dueAt, startedAt, completedAt].every(t => Number.isSafeInteger(t) && t >= 0)
    || dueAt > startedAt || startedAt > completedAt) return null;
  return { sequence, kind, dueAt, startedAt, completedAt, readiness, outcome, metrics: publicRunMetrics(run.metrics, kind) };
}

function supportsReportedRunCount(receipts, count) {
  const scheduled = receipts.filter(run => run.kind !== 'bridge');
  if (count === null || count > scheduled.length) return false;
  if (count === 0) return true;
  const interval = 15 * 60_000;
  return scheduled.slice(-count).every((run, index, tail) => {
    const m = run.metrics;
    const previous = tail[index - 1];
    return run.kind === 'scheduled' && run.readiness === 'ready' && run.outcome === 'completed'
      && run.startedAt - run.dueAt < interval && m && m.opportunities > 0 && m.eligibleOverdueAfter === 0
      && m.rejectedWrites === 0 && m.persistenceFailures === 0
      && (!previous || (run.sequence > previous.sequence && run.dueAt - previous.dueAt >= interval
        && run.dueAt - previous.dueAt < 2 * interval));
  });
}

function publicResolverRuns(value) {
  const runs = objectValue(value);
  if (runs?.requiredScheduledRuns !== 7 || !Array.isArray(runs.receipts) || runs.receipts.length > 16) return null;
  const receipts = runs.receipts.map(publicRunReceipt).filter(Boolean);
  const count = exactCount(runs.consecutiveQualifyingScheduledRuns);
  return {
    requiredScheduledRuns: 7,
    historicalLateCauseUnknown: exactCount(runs.historicalLateCauseUnknown),
    consecutiveQualifyingScheduledRuns: receipts.length === runs.receipts.length && supportsReportedRunCount(receipts, count) ? count : null,
    receipts,
  };
}

export function publicForecastCalibration(value) {
  const forecastCalibration = objectValue(value);
  if (!forecastCalibration) return null;
  const output = { ...forecastCalibration };
  delete output.evaluation;
  if (Object.hasOwn(forecastCalibration, 'resolverRuns')) {
    output.resolverRuns = publicResolverRuns(forecastCalibration.resolverRuns);
  }
  const evaluation = publicForecastEvaluation(forecastCalibration.evaluation);
  if (evaluation) output.evaluation = evaluation;
  return output;
}

function publicForecastEvaluation(value) {
  const evaluation = objectValue(value);
  const split = objectValue(evaluation?.split);
  const backlog = objectValue(evaluation?.resolutionBacklog);
  const origins = objectValue(evaluation?.labelOrigins);
  const overall = publicForecastCohort(evaluation?.overall);
  const lossAttribution = publicForecastLossAttribution(
    evaluation?.lossAttribution,
  );
  if (!evaluation || !split || !backlog || !origins || !overall) return null;
  const worstCohorts = Array.isArray(evaluation.worstCohorts)
    ? evaluation.worstCohorts
      .slice(0, FORECAST_COHORT_LIMIT)
      .map((cohort) => publicForecastCohort(cohort, true))
      .filter(Boolean)
    : [];
  return {
    schemaVersion: 1,
    split: {
      strategy: 'chronological_60_40',
      trainingRecords: nonNegativeCount(split.trainingRecords),
      evaluationRecords: nonNegativeCount(split.evaluationRecords),
      evaluationWindowStart: nullableFiniteNumber(split.evaluationWindowStart),
    },
    resolutionBacklog: {
      pending: nonNegativeCount(backlog.pending),
      overduePending: nonNegativeCount(backlog.overduePending),
      expired: nonNegativeCount(backlog.expired),
      oldestPendingAt: nullableFiniteNumber(backlog.oldestPendingAt),
    },
    labelOrigins: {
      direct: nonNegativeCount(origins.direct),
      proxy: nonNegativeCount(origins.proxy),
      manual: nonNegativeCount(origins.manual),
      unattributed: nonNegativeCount(origins.unattributed),
    },
    overall,
    ...(lossAttribution ? { lossAttribution } : {}),
    worstCohorts,
    cohortLimit: FORECAST_COHORT_LIMIT,
    cohortCount: nonNegativeCount(evaluation.cohortCount),
    omittedCohortCount: nonNegativeCount(evaluation.omittedCohortCount),
  };
}

function publicForecastLossAttribution(value) {
  const attribution = objectValue(value);
  if (!attribution) return null;
  const publicRows = (rows) => Array.isArray(rows)
    ? rows
      .slice(0, FORECAST_COHORT_LIMIT)
      .map(publicForecastLossContribution)
      .filter(Boolean)
    : [];
  return {
    sampleSize: nonNegativeCount(attribution.sampleSize),
    totalBrierLoss: nonNegativeNumber(attribution.totalBrierLoss),
    highConfidenceMisses: nonNegativeCount(attribution.highConfidenceMisses),
    groupLimit: FORECAST_COHORT_LIMIT,
    bySource: publicRows(attribution.bySource),
    byDomain: publicRows(attribution.byDomain),
    byHorizon: publicRows(attribution.byHorizon),
    byAlgorithmVersion: publicRows(attribution.byAlgorithmVersion),
  };
}

function publicForecastLossContribution(value) {
  const contribution = objectValue(value);
  if (!contribution) return null;
  return {
    key: boundedLabel(contribution.key),
    sampleSize: nonNegativeCount(contribution.sampleSize),
    totalBrierLoss: nonNegativeNumber(contribution.totalBrierLoss),
    meanBrier: nonNegativeNumber(contribution.meanBrier),
    shareOfBrierLoss: boundedRatio(contribution.shareOfBrierLoss),
    highConfidenceMisses: nonNegativeCount(
      contribution.highConfidenceMisses,
    ),
  };
}

function publicForecastCohort(value, includeKey = false) {
  const cohort = objectValue(value);
  const coverage = objectValue(cohort?.coverage);
  const exclusions = objectValue(cohort?.exclusions);
  const brier = publicForecastMetric(cohort?.brier);
  const logLoss = publicForecastMetric(cohort?.logLoss);
  const baseRate = publicForecastMetric(cohort?.baseRate);
  const brierSkill = publicForecastMetric(cohort?.brierSkill);
  const equalMassEce = publicForecastMetric(cohort?.equalMassEce);
  const calibrationFit = publicForecastCalibrationFit(cohort?.calibrationFit);
  if (
    !cohort
    || !coverage
    || !exclusions
    || !brier
    || !logLoss
    || !baseRate
    || !brierSkill
    || !equalMassEce
    || !calibrationFit
  ) {
    return null;
  }
  return {
    ...(includeKey
      ? {
          sourceId: boundedLabel(cohort.sourceId),
          domain: boundedLabel(cohort.domain),
          horizon: boundedLabel(cohort.horizon),
        }
      : {}),
    coverage: {
      total: nonNegativeCount(coverage.total),
      resolved: nonNegativeCount(coverage.resolved),
      expired: nonNegativeCount(coverage.expired),
      pending: nonNegativeCount(coverage.pending),
      overduePending: nullableFiniteNumber(coverage.overduePending),
      resolutionCoverage: boundedRatio(coverage.resolutionCoverage),
      expirationRate: boundedRatio(coverage.expirationRate),
      closedCoverage: boundedRatio(coverage.closedCoverage),
    },
    trainingSampleSize: nonNegativeCount(cohort.trainingSampleSize),
    exclusions: {
      proxyLabels: nonNegativeCount(exclusions.proxyLabels),
      invalidProbabilities: nonNegativeCount(exclusions.invalidProbabilities),
      trainingWindowOverlap: nonNegativeCount(exclusions.trainingWindowOverlap),
      trainingProxyLabels: nonNegativeCount(exclusions.trainingProxyLabels),
      trainingInvalidProbabilities: nonNegativeCount(
        exclusions.trainingInvalidProbabilities,
      ),
    },
    brier,
    logLoss,
    baseRate,
    brierSkill,
    equalMassEce,
    calibrationFit,
  };
}

function publicForecastMetric(value) {
  const metric = objectValue(value);
  const metricValue = nullableFiniteNumber(metric?.value);
  if (metric?.status === 'ok' && metricValue !== null) {
    return {
      status: 'ok',
      sampleSize: nonNegativeCount(metric.sampleSize),
      value: metricValue,
    };
  }
  if (metric?.status !== 'insufficient_evidence') return null;
  return {
    status: 'insufficient_evidence',
    sampleSize: nonNegativeCount(metric.sampleSize),
    minSampleSize: nonNegativeCount(metric.minSampleSize),
    ...publicEvaluationReason(metric.reason),
  };
}

function publicForecastCalibrationFit(value) {
  const fit = objectValue(value);
  const intercept = nullableFiniteNumber(fit?.intercept);
  const slope = nullableFiniteNumber(fit?.slope);
  if (fit?.status === 'ok' && intercept !== null && slope !== null) {
    return {
      status: 'ok',
      sampleSize: nonNegativeCount(fit.sampleSize),
      intercept,
      slope,
      iterations: nonNegativeCount(fit.iterations),
    };
  }
  if (fit?.status !== 'insufficient_evidence') return null;
  return {
    status: 'insufficient_evidence',
    sampleSize: nonNegativeCount(fit.sampleSize),
    minSampleSize: nonNegativeCount(fit.minSampleSize),
    ...publicEvaluationReason(fit.reason),
  };
}

function publicEvaluationReason(value) {
  return typeof value === 'string' && EVALUATION_REASONS.has(value)
    ? { reason: value }
    : {};
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function boundedLabel(value) {
  const bounded = String(value ?? 'unknown')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 80);
  return bounded || 'unknown';
}

function nonNegativeCount(value) {
  const finite = nullableFiniteNumber(value);
  return finite === null ? 0 : Math.max(0, Math.floor(finite));
}

function nonNegativeNumber(value) {
  const finite = nullableFiniteNumber(value);
  return finite === null ? 0 : Math.max(0, finite);
}

function boundedRatio(value) {
  const finite = nullableFiniteNumber(value);
  return finite === null ? 0 : Math.max(0, Math.min(1, finite));
}

function nullableFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function epochValue(value) {
  return Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function exactCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT
    ? value
    : null;
}

function exactNullableRatio(value) {
  if (value === null) return null;
  const ratio = exactBoundedNumber(value, 0, 1);
  return ratio === null ? undefined : ratio;
}

function exactBoundedNumber(value, minimum, maximum) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}
