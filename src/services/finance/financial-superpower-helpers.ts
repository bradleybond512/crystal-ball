/**
 * Pure helper functions and data constants for FinancialSuperpowerPanel.
 * Extracted into a side-effect-free module so unit tests can import them
 * without pulling in the Vite worker chain via Panel.ts.
 */

import type { CommodityRiskTier } from './stress-monitor';

// ── Sanctions data ────────────────────────────────────────────────────
// Kept for backward compatibility; used by tests and re-exported from panel.

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
  /** Price-action trajectory over the trailing 7 days. */
  trajectory: 'worsening' | 'stabilizing' | 'stable';
  /** True if the country has active capital controls in place. */
  capitalControls: boolean;
}

export const CURRENCY_WATCH: CurrencyWatch[] = [
  { code: 'ARS', name: 'Argentine Peso',   depreciation30d: 8.7, pegged: false, trajectory: 'stabilizing', capitalControls: true  },
  { code: 'ETB', name: 'Ethiopian Birr',   depreciation30d: 5.2, pegged: false, trajectory: 'worsening',   capitalControls: true  },
  { code: 'EGP', name: 'Egyptian Pound',   depreciation30d: 3.1, pegged: false, trajectory: 'stabilizing', capitalControls: false },
  { code: 'TRY', name: 'Turkish Lira',     depreciation30d: 2.3, pegged: false, trajectory: 'stable',      capitalControls: false },
  { code: 'PKR', name: 'Pakistani Rupee',  depreciation30d: 1.8, pegged: false, trajectory: 'worsening',   capitalControls: true  },
  { code: 'NGN', name: 'Nigerian Naira',   depreciation30d: 1.4, pegged: false, trajectory: 'stabilizing', capitalControls: true  },
  { code: 'HKD', name: 'Hong Kong Dollar', depreciation30d: 0.1, pegged: true,  trajectory: 'stable',      capitalControls: false },
  { code: 'SAR', name: 'Saudi Riyal',      depreciation30d: 0,   pegged: true,  trajectory: 'stable',      capitalControls: false },
];

// ── Drawdown signal data ──────────────────────────────────────────────

export type DrawdownPhase = 'deepening' | 'plateauing' | 'recovering';

export interface DrawdownSignal {
  /** Index name displayed to the user. */
  index: string;
  /** Region label. */
  region: string;
  /** Peak-to-current decline expressed as a positive percentage. */
  declinePct: number;
  /** Trading days elapsed since peak. */
  durationDays: number;
  /** Current phase of the drawdown. */
  phase: DrawdownPhase;
}

export const DRAWDOWN_SIGNALS: DrawdownSignal[] = [
  { index: 'MSCI EM',    region: 'Emerging Mkts', declinePct: 8.3,  durationDays: 42, phase: 'plateauing' },
  { index: 'Shanghai',   region: 'China',          declinePct: 11.2, durationDays: 67, phase: 'plateauing' },
  { index: 'Euro Stoxx', region: 'Europe',         declinePct: 4.1,  durationDays: 18, phase: 'deepening'  },
  { index: 'Nikkei',     region: 'Japan',          declinePct: 2.8,  durationDays: 12, phase: 'recovering' },
  { index: 'S&P 500',    region: 'US',             declinePct: 0.9,  durationDays:  5, phase: 'recovering' },
];

// ── Systemic risk indicator data ──────────────────────────────────────

export type SystemicCategory = 'interbank' | 'central_bank' | 'exchange';
export type SystemicSeverity = 'normal' | 'elevated' | 'severe';

export interface SystemicIndicator {
  name: string;
  category: SystemicCategory;
  severity: SystemicSeverity;
  detail: string;
}

export const SYSTEMIC_INDICATORS: SystemicIndicator[] = [
  { name: 'Repo Market',        category: 'interbank',    severity: 'normal',   detail: 'Overnight rates within normal band' },
  { name: 'LIBOR-OIS Spread',   category: 'interbank',    severity: 'elevated', detail: 'Spread widening +18bp vs 3-month avg' },
  { name: 'Dollar Swap Lines',  category: 'central_bank', severity: 'normal',   detail: 'Standby — not yet activated' },
  { name: 'Emergency Lending',  category: 'central_bank', severity: 'normal',   detail: 'No active emergency facilities' },
  { name: 'Circuit Breakers',   category: 'exchange',     severity: 'normal',   detail: 'No market halts triggered' },
  { name: 'Exchange Suspensions', category: 'exchange',   severity: 'normal',   detail: 'All major exchanges operating normally' },
];

// ── Gauge helpers (Section 1: Market Stress Gauge 0–100) ─────────────

/** Channel labels that map to the gauge's three components. */
const GAUGE_CHANNEL_LABELS: Record<string, 'equity' | 'credit' | 'fx'> = {
  'vix spike':             'equity',
  'credit spread widening': 'credit',
  'currency crisis':        'fx',
};

export type GaugeTier = 'calm' | 'normal' | 'elevated' | 'severe';

/**
 * Compute 0–100 composite stress score from channel stress levels.
 * Specifically weights VIX (equity), credit spreads, and currency crisis.
 * Falls back to simple average if named channels are absent.
 */
export function computeGaugeScore(
  channels: readonly { channel: string; stressLevel: number }[],
): number {
  const buckets: Record<'equity' | 'credit' | 'fx', number[]> = { equity: [], credit: [], fx: [] };
  for (const c of channels) {
    const key = GAUGE_CHANNEL_LABELS[c.channel.toLowerCase()];
    if (key) buckets[key].push(c.stressLevel);
  }

  const equity = buckets.equity.length > 0
    ? buckets.equity.reduce((s, v) => s + v, 0) / buckets.equity.length : -1;
  const credit = buckets.credit.length > 0
    ? buckets.credit.reduce((s, v) => s + v, 0) / buckets.credit.length : -1;
  const fx     = buckets.fx.length > 0
    ? buckets.fx.reduce((s, v) => s + v, 0) / buckets.fx.length : -1;

  const valid = [equity, credit, fx].filter((v) => v >= 0);
  if (valid.length === 0) {
    if (channels.length === 0) return 0;
    const total = channels.reduce((s, c) => s + c.stressLevel, 0);
    return Math.min(100, Math.round(total / channels.length));
  }
  return Math.min(100, Math.round(valid.reduce((s, v) => s + v, 0) / valid.length));
}

export function gaugeTier(score: number): GaugeTier {
  if (score >= 75) return 'severe';
  if (score >= 50) return 'elevated';
  if (score >= 25) return 'normal';
  return 'calm';
}

export function gaugeColor(tier: GaugeTier): string {
  const MAP: Record<GaugeTier, string> = {
    calm: '#4caf50', normal: '#9e9e9e', elevated: '#ff9800', severe: '#ff453a',
  };
  return MAP[tier];
}

// ── Drawdown helpers ─────────────────────────────────────────────────

export function drawdownTier(pct: number): CommodityRiskTier {
  if (pct >= 20) return 'critical';
  if (pct >= 10) return 'high';
  if (pct >= 5)  return 'medium';
  return 'low';
}

export function phaseLabel(phase: DrawdownPhase): string {
  if (phase === 'deepening')  return '↘ Deepening';
  if (phase === 'plateauing') return '→ Plateauing';
  return '↗ Recovering';
}

export function phaseColor(phase: DrawdownPhase): string {
  if (phase === 'deepening')  return '#ff453a';
  if (phase === 'plateauing') return '#ff9800';
  return '#4caf50';
}

// ── Currency helpers ─────────────────────────────────────────────────

export function trajectoryLabel(trajectory: CurrencyWatch['trajectory']): string {
  if (trajectory === 'worsening')   return '↘ Worsening';
  if (trajectory === 'stabilizing') return '→ Stabilizing';
  return '→ Stable';
}

export function trajectoryColor(trajectory: CurrencyWatch['trajectory']): string {
  if (trajectory === 'worsening')   return '#ff453a';
  if (trajectory === 'stabilizing') return '#ff9800';
  return '#9e9e9e';
}

// ── Systemic helpers ─────────────────────────────────────────────────

export function systemicColor(severity: SystemicSeverity): string {
  if (severity === 'severe')   return '#ff453a';
  if (severity === 'elevated') return '#ff9800';
  return '#4caf50';
}

export function systemicIcon(severity: SystemicSeverity): string {
  if (severity === 'severe')   return '✖';
  if (severity === 'elevated') return '⚠';
  return '✔';
}

// ── Shared tier / render helpers ─────────────────────────────────────

export function trendArrow(trend: string): string {
  if (trend === 'rising')  return '↑';
  if (trend === 'falling') return '↓';
  return '→';
}

export function trendColor(trend: string): string {
  if (trend === 'rising')  return '#ef4444';
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
