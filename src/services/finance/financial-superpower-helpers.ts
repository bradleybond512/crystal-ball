/**
 * Pure helper functions and data constants for FinancialSuperpowerPanel.
 * Extracted into a side-effect-free module so unit tests can import them
 * without pulling in the Vite worker chain via Panel.ts.
 */

import type { CommodityRiskTier } from './stress-monitor';

// ── Sanctions data ────────────────────────────────────────────────────

export interface SanctionsRow {
  country: string;
  regime: string;
  /** Estimated GDP drag from OFAC sanctions regime (IMF-derived, 2025 data). */
  estimatedGdpImpactPct: number;
}

export const SANCTIONS_TABLE: SanctionsRow[] = [
  { country: 'Russia',      regime: 'Ukraine conflict',   estimatedGdpImpactPct: 3.2 },
  { country: 'Iran',        regime: 'Nuclear / IRGC',     estimatedGdpImpactPct: 4.8 },
  { country: 'North Korea', regime: 'Weapons / missiles', estimatedGdpImpactPct: 8.1 },
  { country: 'Venezuela',   regime: 'PDVSA / political',  estimatedGdpImpactPct: 2.1 },
  { country: 'Cuba',        regime: 'Embargo',            estimatedGdpImpactPct: 1.4 },
  { country: 'Syria',       regime: 'Caesar Act',         estimatedGdpImpactPct: 5.6 },
  { country: 'Belarus',     regime: 'Human rights',       estimatedGdpImpactPct: 1.7 },
  { country: 'Myanmar',     regime: 'Military junta',     estimatedGdpImpactPct: 2.3 },
];

// ── Currency watch data ───────────────────────────────────────────────

export interface CurrencyWatch {
  code: string;
  name: string;
  /** Approximate depreciation % vs USD over trailing 30 days. Positive = weakened. */
  depreciation30d: number;
  /** True if the currency has a nominal peg. */
  pegged: boolean;
}

export const CURRENCY_WATCH: CurrencyWatch[] = [
  { code: 'ARS', name: 'Argentine Peso',    depreciation30d: 8.7, pegged: false },
  { code: 'ETB', name: 'Ethiopian Birr',    depreciation30d: 5.2, pegged: false },
  { code: 'EGP', name: 'Egyptian Pound',    depreciation30d: 3.1, pegged: false },
  { code: 'TRY', name: 'Turkish Lira',      depreciation30d: 2.3, pegged: false },
  { code: 'PKR', name: 'Pakistani Rupee',   depreciation30d: 1.8, pegged: false },
  { code: 'NGN', name: 'Nigerian Naira',    depreciation30d: 1.4, pegged: false },
  { code: 'HKD', name: 'Hong Kong Dollar',  depreciation30d: 0.1, pegged: true  },
  { code: 'SAR', name: 'Saudi Riyal',       depreciation30d: 0,   pegged: true  },
];

// ── Render helpers ────────────────────────────────────────────────────

export function trendArrow(trend: string): string {
  if (trend === 'rising')  return '↑';
  if (trend === 'falling') return '↓';
  return '→';
}

export function trendColor(trend: string): string {
  if (trend === 'rising')  return '#f44336';
  if (trend === 'falling') return '#4caf50';
  return '#9e9e9e';
}

export function blockBar(level: number, max = 100, width = 10): string {
  const filled = Math.round((level / max) * width);
  return '█'.repeat(Math.min(width, filled)) + '░'.repeat(Math.max(0, width - filled));
}

export function gdpTier(pct: number): CommodityRiskTier {
  if (pct > 6)   return 'critical';
  if (pct > 3)   return 'high';
  if (pct > 1.5) return 'medium';
  return 'low';
}

export function channelTier(avg: number): CommodityRiskTier {
  if (avg > 60) return 'critical';
  if (avg > 40) return 'high';
  if (avg > 20) return 'medium';
  return 'low';
}

export function formatTradeAtRisk(usd: number): string {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(1)}T`;
  if (usd >= 1e9)  return `$${(usd / 1e9).toFixed(0)}B`;
  if (usd > 0)     return `$${(usd / 1e6).toFixed(0)}M`;
  return '—';
}
