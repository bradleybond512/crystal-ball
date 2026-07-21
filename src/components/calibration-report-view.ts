import type { ReliabilityCurve } from '@/services/cognition/recalibration';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';
import { brierScore } from '@/services/intelligence/forecast-calibration';
import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';

/** Below this many resolved predictions a per-domain Brier score is too
 *  noisy to show — the row reports it as null (rendered as "—") instead. */
const MIN_RESOLVED_FOR_BRIER = 5;

export interface CalibrationReportRow {
  predicted: number;
  observed: number;
  count: number;
}

export interface CalibrationReportView {
  headline: string;
  rows: CalibrationReportRow[];
  hasOperatorData: boolean;
  operatorLine?: string;
}

export interface BuildCalibrationReportInput {
  curve: ReliabilityCurve;
  coveragePct: number;
  comparison: CalibrationComparison | null;
}

export function buildCalibrationReport(input: BuildCalibrationReportInput): CalibrationReportView {
  const { curve, coveragePct, comparison } = input;

  const rows: CalibrationReportRow[] = curve.bins.map(bin => ({
    predicted: bin.predictedMean,
    observed: bin.observedRate,
    count: bin.n,
  }));

  const headline = `System calibration · ${coveragePct}% conformal coverage`;

  const hasOperatorData = !!comparison && comparison.operator.n > 0;
  const operatorLine = hasOperatorData
    ? `operator Brier ${comparison!.operator.brier.toFixed(3)} (n=${comparison!.operator.n}) vs system Brier ${comparison!.system.brier.toFixed(3)} (n=${comparison!.system.n})`
    : undefined;

  return { headline, rows, hasOperatorData, operatorLine };
}

// ── Per-domain report card (Prediction Uplift PR A3) ────────────────────────

export interface DomainReportRow {
  domain: string;
  total: number;
  resolved: number;
  brier: number | null;
}

export interface DomainReportCard {
  rows: DomainReportRow[];
}

/**
 * Groups prediction records by domain and summarizes each into a report-card
 * row: total predictions logged, how many resolved, and the resolved-set
 * Brier score (null until MIN_RESOLVED_FOR_BRIER is reached — a handful of
 * resolutions is too noisy to be worth showing). Rows are sorted by resolved
 * count descending so the most-evidenced domains surface first.
 */
export function buildDomainReportCard(records: readonly PredictionRecord[]): DomainReportCard {
  const byDomain = new Map<string, PredictionRecord[]>();
  for (const r of records) {
    const list = byDomain.get(r.domain) ?? [];
    list.push(r);
    byDomain.set(r.domain, list);
  }
  const rows = [...byDomain.entries()]
    .map(([domain, list]) => {
      const resolved = list.filter((r) => r.status === 'resolved_true' || r.status === 'resolved_false');
      return {
        domain,
        total: list.length,
        resolved: resolved.length,
        brier: resolved.length >= MIN_RESOLVED_FOR_BRIER
          ? Math.round(brierScore(resolved).score * 10_000) / 10_000
          : null,
      };
    })
    .sort((a, b) => b.resolved - a.resolved);
  return { rows };
}
