/**
 * Calibration self-eval report — Wave 4 ("rolling self-eval surface") of the
 * CRYSTAL_BALL_OVERHAUL_ROADMAP.md, built on the `proper-scoring.ts` math.
 *
 * `forecast-calibration.ts` is the prediction *ledger* (record → resolve →
 * Brier). `proper-scoring.ts` is the *math* (Brier decomposition, reliability
 * bins, ECE/MCE, CRPS). This module is the *view model* between them: it turns
 * a ledger into a single, explainable "how well-calibrated am I?" report an
 * operator surface can render — overall + per-domain + per-source, each with a
 * plain-English verdict ("overconfident in the 0.7–0.9 band").
 *
 * Distinct from `meta-confidence.ts`, which calibrates the *meta-confidence
 * estimator*; this calibrates the *forecast prediction ledger* itself.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 */

import type { FactDomain } from './types';
import type { PredictionRecord } from './forecast-calibration';
import {
  brierScore,
  brierDecomposition,
  calibrationError,
  reliabilityBins,
  binaryForecastsFromRecords,
  meanCrpsGaussian,
  type BinaryForecast,
  type BrierDecomposition,
  type CalibrationError,
  type ReliabilityBin,
  type CrpsResult,
  type GaussianForecast,
} from './proper-scoring';

// ── Public types ───────────────────────────────────────────────────────────

export type CalibrationVerdict =
  | 'well_calibrated'
  | 'overconfident'
  | 'underconfident'
  | 'insufficient_data';

export interface CalibrationAssessment {
  verdict: CalibrationVerdict;
  /** Count-weighted signed gap Σ wᵢ(predictedᵢ − observedᵢ) across populated
   *  bins. Positive ⇒ predicts higher than reality (overconfident);
   *  negative ⇒ underconfident. */
  signedBias: number;
  /** The single most-miscalibrated populated bin, if any. */
  worstBand?: {
    lowerEdge: number;
    upperEdge: number;
    predictedMean: number;
    observedFrequency: number;
    gap: number;
    count: number;
  };
  /** One-line plain-English summary. */
  summary: string;
}

export interface CalibrationGroupReport {
  /** Group key — a domain or a sourceId, depending on the rollup. */
  key: string;
  resolvedCount: number;
  brier: number;
  ece: number;
  assessment: CalibrationAssessment;
}

export interface CalibrationReport {
  /** Total ledger rows considered (any status). */
  totalRecords: number;
  /** Rows that carry ground truth (resolved_true | resolved_false). */
  resolvedCount: number;
  brier: BrierDecomposition;
  calibration: CalibrationError;
  reliability: ReliabilityBin[];
  assessment: CalibrationAssessment;
  byDomain: CalibrationGroupReport[];
  bySource: CalibrationGroupReport[];
  /** Optional continuous-forecast CRPS rollup, when Gaussian forecasts are
   *  supplied alongside the binary ledger. */
  crps?: CrpsResult;
}

export interface BuildCalibrationReportOptions {
  /** Reliability-diagram granularity. Default 10. */
  binCount?: number;
  /** Below this many resolved predictions a group is "insufficient_data".
   *  Default 10. */
  minResolvedForVerdict?: number;
  /** |signedBias| at or below this counts as well-calibrated. Default 0.05. */
  wellCalibratedTolerance?: number;
  /** Optional continuous Gaussian forecasts to fold a CRPS rollup in. */
  gaussianForecasts?: readonly GaussianForecast[];
}

// ── Builder ────────────────────────────────────────────────────────────────

export function buildCalibrationReport(
  records: readonly PredictionRecord[],
  options: BuildCalibrationReportOptions = {},
): CalibrationReport {
  const binCount = options.binCount ?? 10;
  const minResolved = options.minResolvedForVerdict ?? 10;
  const tolerance = options.wellCalibratedTolerance ?? 0.05;

  const forecasts = binaryForecastsFromRecords(records);

  const report: CalibrationReport = {
    totalRecords: records.length,
    resolvedCount: forecasts.length,
    brier: brierDecomposition(forecasts, binCount),
    calibration: calibrationError(forecasts, binCount),
    reliability: reliabilityBins(forecasts, binCount),
    assessment: assess(forecasts, binCount, minResolved, tolerance),
    byDomain: rollup(records, (r) => r.domain, binCount, minResolved, tolerance),
    bySource: rollup(records, (r) => r.sourceId, binCount, minResolved, tolerance),
  };

  if (options.gaussianForecasts && options.gaussianForecasts.length > 0) {
    report.crps = meanCrpsGaussian(options.gaussianForecasts);
  }
  return report;
}

// ── Assessment ─────────────────────────────────────────────────────────────

function assess(
  forecasts: readonly BinaryForecast[],
  binCount: number,
  minResolved: number,
  tolerance: number,
): CalibrationAssessment {
  if (forecasts.length < minResolved) {
    return {
      verdict: 'insufficient_data',
      signedBias: 0,
      summary: `Only ${forecasts.length} resolved prediction(s) — need ${minResolved} to assess calibration.`,
    };
  }

  const bins = reliabilityBins(forecasts, binCount);
  const populated = bins.filter((b) => b.count > 0);
  const total = populated.reduce((s, b) => s + b.count, 0);

  let signedBias = 0;
  let worst: CalibrationAssessment['worstBand'];
  for (const b of populated) {
    const gap = b.predictedMean - b.observedFrequency;
    signedBias += (b.count / total) * gap;
    if (!worst || Math.abs(gap) > Math.abs(worst.gap)) {
      worst = {
        lowerEdge: b.lowerEdge,
        upperEdge: b.upperEdge,
        predictedMean: b.predictedMean,
        observedFrequency: b.observedFrequency,
        gap: round4(gap),
        count: b.count,
      };
    }
  }
  signedBias = round4(signedBias);

  let verdict: CalibrationVerdict;
  if (Math.abs(signedBias) <= tolerance) verdict = 'well_calibrated';
  else if (signedBias > 0) verdict = 'overconfident';
  else verdict = 'underconfident';

  return { verdict, signedBias, worstBand: worst, summary: summarize(verdict, signedBias, worst) };
}

function summarize(
  verdict: CalibrationVerdict,
  signedBias: number,
  worst: CalibrationAssessment['worstBand'],
): string {
  if (verdict === 'well_calibrated') {
    return `Well-calibrated (signed bias ${fmtSigned(signedBias)}).`;
  }
  const dir = verdict === 'overconfident' ? 'overconfident' : 'underconfident';
  const band = worst
    ? ` worst in the ${pct(worst.lowerEdge)}–${pct(worst.upperEdge)} band ` +
      `(predicted ${pct(worst.predictedMean)}, observed ${pct(worst.observedFrequency)})`
    : '';
  return `Systematically ${dir} (signed bias ${fmtSigned(signedBias)})${band}.`;
}

// ── Per-group rollup ─────────────────────────────────────────────────────────

function rollup(
  records: readonly PredictionRecord[],
  key: (r: PredictionRecord) => string,
  binCount: number,
  minResolved: number,
  tolerance: number,
): CalibrationGroupReport[] {
  const groups = new Map<string, PredictionRecord[]>();
  for (const r of records) {
    const k = key(r);
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }

  const out: CalibrationGroupReport[] = [];
  for (const [k, items] of groups) {
    const forecasts = binaryForecastsFromRecords(items);
    out.push({
      key: k,
      resolvedCount: forecasts.length,
      brier: brierScore(forecasts).score,
      ece: calibrationError(forecasts, binCount).ece,
      assessment: assess(forecasts, binCount, minResolved, tolerance),
    });
  }
  // Worst-calibrated (highest ECE) first; ties broken by more data.
  out.sort((a, b) => b.ece - a.ece || b.resolvedCount - a.resolvedCount);
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function fmtSigned(x: number): string {
  return x >= 0 ? `+${x}` : `${x}`;
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

// Re-export the domain type so a renderer can narrow group keys when it knows
// a rollup is by-domain.
export type { FactDomain };
