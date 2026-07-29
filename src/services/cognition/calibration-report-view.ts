/**
 * Calibration Report Card — a pure, DOM-free view-model that surfaces the
 * Closed Calibration Loop (recalibration.ts) as a Command-Center card.
 *
 * The recalibrator already builds per-domain reliability curves and applies
 * them to every emitted probability, but that work is invisible: a user cannot
 * see whether their forecasts run hot (overconfident) or cold (underconfident),
 * how much resolved history backs each domain, or which domains are being
 * actively recalibrated versus falling back to the pooled/identity curve.
 *
 * This module answers "how well-calibrated am I, and where?" from raw
 * PredictionRecords — no singletons, no fetch, no globals. A call-site (the
 * Command Center) passes `getCalibrationStore().all()`; unit tests pass static
 * fixtures. It reuses buildCurve() so the sparkline it renders IS the curve the
 * system applies — one source of truth, not a parallel reimplementation.
 *
 * Plan invariants honored:
 *   - Every row carries an explanation (headline).
 *   - Insufficient history is surfaced (insufficient_data), never faked.
 *   - Contradictions surface: over/underconfidence is stated with direction.
 */

import type { FactDomain } from '@/services/intelligence/types';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import {
  buildCurve,
  MIN_DOMAIN_N,
  MIN_GLOBAL_N,
  type ReliabilityCurve,
} from '@/services/cognition/recalibration';

/** The 11 fact domains the calibration loop tracks. */
const ALL_DOMAINS: readonly FactDomain[] = [
  'weather',
  'cyber',
  'aviation',
  'maritime',
  'markets',
  'conflict',
  'humanitarian',
  'space',
  'infra',
  'macro',
  'other',
];

const DOMAIN_LABELS: Record<FactDomain | 'global', string> = {
  weather: 'Weather',
  cyber: 'Cyber',
  aviation: 'Aviation',
  maritime: 'Maritime',
  markets: 'Markets',
  conflict: 'Conflict',
  humanitarian: 'Humanitarian',
  space: 'Space',
  infra: 'Infrastructure',
  macro: 'Macro',
  other: 'Other',
  global: 'All forecasts',
};

/**
 * Minimum resolved forecasts before a reliability verdict is offered for
 * display. Distinct from — and lower than — MIN_DOMAIN_N / MIN_GLOBAL_N, which
 * gate whether a *curve is applied*. A user should see "you run hot in weather"
 * from a dozen resolved forecasts even before recalibration formally engages.
 */
export const MIN_REPORT_N = 12;

/** |hitRate − meanProbability| at or below this reads as well-calibrated. */
export const WELL_CALIBRATED_BAND = 0.05;

export type CalibrationReliabilityLabel =
  | 'well_calibrated'
  | 'overconfident'
  | 'underconfident'
  | 'insufficient_data';

/**
 * Which curve the recalibrator applies for this domain, following the same
 * fallback ladder as getRecalibrator(): domain-specific → pooled → identity.
 */
export type CalibrationCurveSource = 'domain' | 'global' | 'identity';

/** One reliability-diagram point: predicted vs observed for a probability bin. */
export interface CalibrationSparkPoint {
  binLo: number;
  binHi: number;
  n: number;
  /** Mean predicted probability that landed in this bin (0-1). */
  predicted: number;
  /** PAV-repaired observed materialization rate for this bin (0-1). */
  observed: number;
  /** Signed observed − predicted; positive = materialized more than predicted. */
  gap: number;
}

export interface CalibrationDomainRow {
  domain: FactDomain | 'global';
  label: string;
  /** Resolved forecasts backing this row. */
  sampleSize: number;
  /** Brier score over resolved forecasts (0 perfect, 0.25 coin-flip); null when empty. */
  brier: number | null;
  /** Mean predicted probability over resolved forecasts (0-1); null when empty. */
  meanPredicted: number | null;
  /** Fraction that actually materialized (0-1); null when empty. */
  observedRate: number | null;
  /** Signed observedRate − meanPredicted; null when empty. */
  gap: number | null;
  reliability: CalibrationReliabilityLabel;
  curveSource: CalibrationCurveSource;
  /** One-line plain-language explanation (plan invariant). */
  headline: string;
  /** Non-empty bins only, ready for a mini reliability diagram. */
  sparkline: CalibrationSparkPoint[];
}

export interface CalibrationReportCard {
  generatedAt: number;
  /** The pooled 'All forecasts' row — always present. */
  global: CalibrationDomainRow;
  /** Per-domain rows that have at least one resolved forecast, sampleSize-desc. */
  domains: CalibrationDomainRow[];
  overall: {
    resolvedTotal: number;
    trackedDomains: number;
    label: CalibrationReliabilityLabel;
    summary: string;
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function isResolved(r: PredictionRecord): boolean {
  return r.status === 'resolved_true' || r.status === 'resolved_false';
}

/** Classify calibration from the signed gap (observed − predicted). */
function classify(sampleSize: number, gap: number | null): CalibrationReliabilityLabel {
  if (sampleSize < MIN_REPORT_N || gap === null) return 'insufficient_data';
  if (Math.abs(gap) <= WELL_CALIBRATED_BAND) return 'well_calibrated';
  // Predicted higher than reality → the forecaster runs hot / overconfident.
  return gap < 0 ? 'overconfident' : 'underconfident';
}

function pct(x: number): number {
  return Math.round(x * 100);
}

function buildHeadline(
  label: string,
  reliability: CalibrationReliabilityLabel,
  sampleSize: number,
  meanPredicted: number | null,
  observedRate: number | null,
): string {
  if (reliability === 'insufficient_data' || meanPredicted === null || observedRate === null) {
    if (sampleSize === 0) return `${label} — no resolved forecasts yet`;
    const plural = sampleSize === 1 ? '' : 's';
    return `${label} — only ${sampleSize} resolved forecast${plural}, not enough to grade calibration (need ${MIN_REPORT_N})`;
  }
  const p = pct(meanPredicted);
  const o = pct(observedRate);
  if (reliability === 'well_calibrated') {
    return `${label} are well-calibrated — predicted ~${p}%, materialized ${o}% (n=${sampleSize})`;
  }
  if (reliability === 'overconfident') {
    return `${label} run hot — predicted ~${p}% but only ${o}% materialized (n=${sampleSize})`;
  }
  return `${label} run cold — predicted ~${p}% yet ${o}% materialized (n=${sampleSize})`;
}

function curveSourceNote(source: CalibrationCurveSource, sampleSize: number): string {
  switch (source) {
    case 'domain': {
      return 'recalibrating with domain-specific history';
    }
    case 'global': {
      return `recalibration using pooled history (needs ${MIN_DOMAIN_N} domain-specific, has ${sampleSize})`;
    }
    case 'identity': {
      return `recalibration inactive (needs ${MIN_GLOBAL_N} pooled, has ${sampleSize})`;
    }
  }
}

function sparkFromCurve(curve: ReliabilityCurve): CalibrationSparkPoint[] {
  return curve.bins
    .filter(b => b.n > 0)
    .map(b => ({
      binLo: b.lo,
      binHi: b.hi,
      n: b.n,
      predicted: b.predictedMean,
      observed: b.observedRate,
      gap: round3(b.observedRate - b.predictedMean),
    }));
}

function buildRow(
  domain: FactDomain | 'global',
  records: readonly PredictionRecord[],
  globalCurveActive: boolean,
): CalibrationDomainRow {
  const isGlobal = domain === 'global';
  const curve = isGlobal ? buildCurve(records) : buildCurve(records, domain);
  const resolved = (isGlobal ? records : records.filter(r => r.domain === domain)).filter(r => isResolved(r));
  const sampleSize = resolved.length;

  let meanPredicted: number | null = null;
  let observedRate: number | null = null;
  let gap: number | null = null;
  if (sampleSize > 0) {
    const sumPred = resolved.reduce((s, r) => s + r.probability, 0);
    const trues = resolved.filter(r => r.status === 'resolved_true').length;
    meanPredicted = round3(sumPred / sampleSize);
    observedRate = round3(trues / sampleSize);
    gap = round3(observedRate - meanPredicted);
  }

  const reliability = classify(sampleSize, gap);

  let curveSource: CalibrationCurveSource;
  if (isGlobal) {
    curveSource = sampleSize >= MIN_GLOBAL_N ? 'global' : 'identity';
  } else if (sampleSize >= MIN_DOMAIN_N) {
    curveSource = 'domain';
  } else if (globalCurveActive) {
    curveSource = 'global';
  } else {
    curveSource = 'identity';
  }

  const label = DOMAIN_LABELS[domain];
  const headline = `${buildHeadline(label, reliability, sampleSize, meanPredicted, observedRate)} · ${curveSourceNote(curveSource, sampleSize)}`;

  return {
    domain,
    label,
    sampleSize,
    brier: sampleSize > 0 ? curve.brier : null,
    meanPredicted,
    observedRate,
    gap,
    reliability,
    curveSource,
    headline,
    sparkline: sparkFromCurve(curve),
  };
}

/**
 * Build the calibration report card from raw prediction records.
 *
 * @param records  All prediction records (pending/expired are ignored; only
 *                 resolved_true/resolved_false contribute to reliability).
 * @param options.now  Timestamp for the card (defaults to Date.now()); passed
 *                 explicitly in tests for determinism.
 */
export function buildCalibrationReportCard(
  records: readonly PredictionRecord[],
  options: { now?: number } = {},
): CalibrationReportCard {
  const resolvedTotal = records.filter(r => isResolved(r)).length;
  const globalCurveActive = resolvedTotal >= MIN_GLOBAL_N;

  const global = buildRow('global', records, globalCurveActive);

  const domains = ALL_DOMAINS.map(d => buildRow(d, records, globalCurveActive))
    .filter(row => row.sampleSize > 0)
    .sort((a, b) => b.sampleSize - a.sampleSize);

  const trackedDomains = domains.length;
  const overallLabel = global.reliability;

  let summary: string;
  if (overallLabel === 'insufficient_data') {
    summary = `${resolvedTotal} resolved forecast${resolvedTotal === 1 ? '' : 's'} across ${trackedDomains} domain${trackedDomains === 1 ? '' : 's'} — building calibration history (need ${MIN_REPORT_N} to grade, ${MIN_GLOBAL_N} to recalibrate)`;
  } else {
    const worst = domains
      .filter(d => d.reliability === 'overconfident' || d.reliability === 'underconfident')
      .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0))[0];
    const base = global.reliability === 'well_calibrated'
      ? `Overall well-calibrated across ${resolvedTotal} resolved forecasts`
      : `Overall ${global.reliability} across ${resolvedTotal} resolved forecasts`;
    summary = worst
      ? `${base}; most off-calibration domain: ${worst.label} (${worst.reliability})`
      : `${base}`;
  }

  return {
    generatedAt: options.now ?? Date.now(),
    global,
    domains,
    overall: {
      resolvedTotal,
      trackedDomains,
      label: overallLabel,
      summary,
    },
  };
}
