const FORECAST_COHORT_LIMIT = 10;
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

export function publicForecastCalibration(value) {
  const forecastCalibration = objectValue(value);
  if (!forecastCalibration) return null;
  const output = { ...forecastCalibration };
  delete output.evaluation;
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
    worstCohorts,
    cohortLimit: FORECAST_COHORT_LIMIT,
    cohortCount: nonNegativeCount(evaluation.cohortCount),
    omittedCohortCount: nonNegativeCount(evaluation.omittedCohortCount),
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

function boundedRatio(value) {
  const finite = nullableFiniteNumber(value);
  return finite === null ? 0 : Math.max(0, Math.min(1, finite));
}

function nullableFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
