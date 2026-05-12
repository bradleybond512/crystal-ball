/**
 * Pure helpers for the Shortage Radar table view.
 *
 * Separated from the DOM so the sort/format logic can be unit-tested without
 * a renderer. Kept tiny on purpose — anything that needs `document` lives in
 * the panel component, anything that's data shape lives here.
 */

import type { ShortageSummaryEntry, RiskLevel, Trend, FullSetCommodity } from './shortage-fullset';

export interface OverviewRow {
  commodity: FullSetCommodity;
  displayName: string;
  riskScore: number;
  riskLevel: RiskLevel;
  topDriver: string;
  trend: Trend;
  trendArrow: '↑' | '↓' | '→';
}

const DISPLAY_NAMES: Record<FullSetCommodity, string> = {
  'wheat':       'Wheat',
  'corn':        'Corn',
  'rice':        'Rice',
  'soybeans':    'Soybeans',
  'diesel':      'Diesel',
  'gasoline':    'Gasoline',
  'natural-gas': 'Natural Gas',
  'jet-fuel':    'Jet Fuel',
};

const TREND_ARROW: Record<Trend, OverviewRow['trendArrow']> = {
  deteriorating: '↑',
  improving:     '↓',
  stable:        '→',
};

const RISK_RANK: Record<RiskLevel, number> = {
  CRITICAL: 0,
  HIGH:     1,
  MODERATE: 2,
  LOW:      3,
};

/**
 * Convert raw summary entries into table rows sorted by riskScore desc.
 * Ties broken by alphabetical commodity name (so the order is stable across
 * renders when scores are identical).
 */
export function buildOverviewRows(entries: readonly ShortageSummaryEntry[]): OverviewRow[] {
  return entries
    .map((e) => toRow(e))
    .sort((a, b) => (
      (RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel])
      || (b.riskScore - a.riskScore)
      || a.displayName.localeCompare(b.displayName)
    ));
}

function toRow(e: ShortageSummaryEntry): OverviewRow {
  return {
    commodity: e.commodity,
    displayName: DISPLAY_NAMES[e.commodity],
    riskScore: Math.round(e.riskScore),
    riskLevel: e.riskLevel,
    topDriver: e.primaryDrivers[0] ?? '—',
    trend: e.trend,
    trendArrow: TREND_ARROW[e.trend],
  };
}

/** Count entries by risk band — used by the panel header summary. */
export function countByRiskLevel(rows: readonly OverviewRow[]): Record<RiskLevel, number> {
  const out: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
  for (const r of rows) out[r.riskLevel] += 1;
  return out;
}
