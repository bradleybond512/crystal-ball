export const DEFAULT_ODIN_HISTORY_MAX_SAMPLES = 96;
export const DEFAULT_ODIN_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60_000;

export interface OdinOutageSample {
  countyFips: string;
  customersOut: number;
  customersRestored?: number;
  observedAt: Date;
  expiresAt: Date;
}

export type OdinOutageHistoryUpdate =
  | { kind: 'reported'; sample: OdinOutageSample }
  | { kind: 'empty'; countyFips: string; observedAt: Date }
  | { kind: 'unavailable'; countyFips: string; observedAt: Date };

export type OdinLatestOutcome = 'none' | 'reported' | 'empty-unknown' | 'unavailable-unknown';

export interface OdinOutageHistory {
  countyFips: string;
  samples: OdinOutageSample[];
  watermarkAt: Date | null;
  latestOutcome: OdinLatestOutcome;
  trendBaselineAt: Date | null;
  rejectedOutOfOrder: number;
  rejectedInvalid: number;
}

export type OdinUpdateDisposition =
  | 'accepted-reported'
  | 'accepted-empty-unknown'
  | 'accepted-unavailable-unknown'
  | 'rejected-out-of-order'
  | 'rejected-invalid';

export interface OdinOutageHistoryResult {
  history: OdinOutageHistory;
  disposition: OdinUpdateDisposition;
}

export interface OdinHistoryOptions {
  maxSamples?: number;
  retentionMs?: number;
}

export interface OdinOutageState {
  countyFips: string;
  coverage: 'reported' | 'unknown';
  customersOut: number | null;
  observedAt: Date | null;
  expiresAt: Date | null;
  trend: 'worsening' | 'improving' | 'steady' | 'unknown';
  deltaCustomersOut: number | null;
  reason?: 'no-observation' | 'empty-response' | 'provider-unavailable' | 'expired';
}

function validFips(value: string): boolean {
  return /^\d{5}$/.test(value);
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validRequiredCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || validRequiredCount(value);
}

function cloneSample(sample: OdinOutageSample): OdinOutageSample {
  return {
    ...sample,
    observedAt: new Date(sample.observedAt),
    expiresAt: new Date(sample.expiresAt),
  };
}

function cloneHistory(history: OdinOutageHistory): OdinOutageHistory {
  return {
    ...history,
    samples: history.samples.map(cloneSample),
    watermarkAt: history.watermarkAt ? new Date(history.watermarkAt) : null,
    trendBaselineAt: history.trendBaselineAt ? new Date(history.trendBaselineAt) : null,
  };
}

export function emptyOdinOutageHistory(countyFips: string): OdinOutageHistory {
  if (!validFips(countyFips)) throw new Error('invalid county FIPS');
  return {
    countyFips,
    samples: [],
    watermarkAt: null,
    latestOutcome: 'none',
    trendBaselineAt: null,
    rejectedOutOfOrder: 0,
    rejectedInvalid: 0,
  };
}

function updateTime(update: OdinOutageHistoryUpdate): Date {
  return update.kind === 'reported' ? update.sample.observedAt : update.observedAt;
}

function updateCounty(update: OdinOutageHistoryUpdate): string {
  return update.kind === 'reported' ? update.sample.countyFips : update.countyFips;
}

function validUpdate(history: OdinOutageHistory, update: OdinOutageHistoryUpdate): boolean {
  const observedAt = updateTime(update);
  if (!validFips(history.countyFips) || updateCounty(update) !== history.countyFips || !validDate(observedAt)) return false;
  if (update.kind !== 'reported') return true;
  const sample = update.sample;
  return validDate(sample.expiresAt)
    && sample.expiresAt.getTime() >= sample.observedAt.getTime()
    && validRequiredCount(sample.customersOut)
    && validOptionalCount(sample.customersRestored);
}

function boundedOptions(options: OdinHistoryOptions): { maxSamples: number; retentionMs: number } {
  const maxSamples = Number.isFinite(options.maxSamples)
    ? Math.max(1, Math.min(288, Math.trunc(options.maxSamples as number)))
    : DEFAULT_ODIN_HISTORY_MAX_SAMPLES;
  const retentionMs = Number.isFinite(options.retentionMs)
    ? Math.max(60_000, Math.min(30 * 24 * 60 * 60_000, Math.trunc(options.retentionMs as number)))
    : DEFAULT_ODIN_HISTORY_RETENTION_MS;
  return { maxSamples, retentionMs };
}

/**
 * Apply one normalized ODIN result behind a monotonic observation watermark.
 * Empty and unavailable responses advance knowledge to unknown but never add a
 * fabricated zero sample. Retained samples exist only for descriptive trend.
 */
export function applyOdinOutageUpdate(
  previous: OdinOutageHistory,
  update: OdinOutageHistoryUpdate,
  options: OdinHistoryOptions = {},
): OdinOutageHistoryResult {
  const history = cloneHistory(previous);
  if (!validUpdate(history, update)) {
    history.rejectedInvalid += 1;
    return { history, disposition: 'rejected-invalid' };
  }
  const observedAt = updateTime(update);
  if (history.watermarkAt && observedAt.getTime() <= history.watermarkAt.getTime()) {
    history.rejectedOutOfOrder += 1;
    return { history, disposition: 'rejected-out-of-order' };
  }

  const { maxSamples, retentionMs } = boundedOptions(options);
  history.watermarkAt = new Date(observedAt);
  if (update.kind === 'reported') {
    history.samples.push(cloneSample(update.sample));
    if (history.latestOutcome !== 'reported') history.trendBaselineAt = new Date(observedAt);
    history.latestOutcome = 'reported';
  } else {
    history.latestOutcome = update.kind === 'empty' ? 'empty-unknown' : 'unavailable-unknown';
    history.trendBaselineAt = null;
  }
  const cutoff = observedAt.getTime() - retentionMs;
  history.samples = history.samples
    .filter((sample) => sample.observedAt.getTime() >= cutoff)
    .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime())
    .slice(-maxSamples);
  const disposition: OdinUpdateDisposition = update.kind === 'reported'
    ? 'accepted-reported'
    : update.kind === 'empty'
      ? 'accepted-empty-unknown'
      : 'accepted-unavailable-unknown';
  return { history, disposition };
}

function unknownState(
  history: OdinOutageHistory,
  reason: NonNullable<OdinOutageState['reason']>,
  latest?: OdinOutageSample,
): OdinOutageState {
  return {
    countyFips: history.countyFips,
    coverage: 'unknown',
    customersOut: null,
    observedAt: latest?.observedAt ?? history.watermarkAt,
    expiresAt: latest?.expiresAt ?? null,
    trend: 'unknown',
    deltaCustomersOut: null,
    reason,
  };
}

/** Describe current coverage and recent direction without forecasting restoration. */
export function deriveOdinOutageState(history: OdinOutageHistory, now = Date.now()): OdinOutageState {
  const latest = history.samples[history.samples.length - 1];
  if (history.latestOutcome === 'none') return unknownState(history, 'no-observation');
  if (history.latestOutcome === 'empty-unknown') return unknownState(history, 'empty-response');
  if (history.latestOutcome === 'unavailable-unknown') return unknownState(history, 'provider-unavailable');
  if (!latest || latest.expiresAt.getTime() <= now) return unknownState(history, 'expired', latest);

  const previousCandidate = history.samples[history.samples.length - 2];
  const previous = previousCandidate
    && history.trendBaselineAt
    && previousCandidate.observedAt.getTime() >= history.trendBaselineAt.getTime()
    ? previousCandidate
    : undefined;
  const delta = previous ? latest.customersOut - previous.customersOut : null;
  const trend = delta === null
    ? 'unknown'
    : delta > 0
      ? 'worsening'
      : delta < 0
        ? 'improving'
        : 'steady';
  return {
    countyFips: history.countyFips,
    coverage: 'reported',
    customersOut: latest.customersOut,
    observedAt: latest.observedAt,
    expiresAt: latest.expiresAt,
    trend,
    deltaCustomersOut: delta,
  };
}
