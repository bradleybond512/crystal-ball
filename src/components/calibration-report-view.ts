import type { ReliabilityCurve } from '@/services/cognition/recalibration';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';

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
