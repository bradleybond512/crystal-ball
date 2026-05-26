/**
 * Pure helpers for SovereignDebtPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Covers: sovereign CDS spreads, debt-to-GDP ratios, IMF/World Bank
 * risk flags, yield-curve inversions by country, debt restructuring
 * events, currency reserve drawdowns, and a composite contagion risk
 * score per region.
 */

// ── Type unions ───────────────────────────────────────────────────────────

export type CreditTier = 'investment' | 'high-yield' | 'distressed' | 'default-imminent';
export type DistressTier = 'normal' | 'monitoring' | 'program' | 'crisis';
export type YieldCurveState = 'normal' | 'flat' | 'inverted' | 'deeply-inverted';
export type RestructuringStatus =
  | 'announced'
  | 'in-negotiation'
  | 'standstill'
  | 'completed'
  | 'defaulted';
export type ReservePressure = 'stable' | 'declining' | 'critical' | 'depleted';
export type ContagionRisk = 0 | 1 | 2 | 3 | 4;

// ── Section 1 — Sovereign Credit Watch (CDS + debt-to-GDP) ────────────────

export interface SovereignCreditEntry {
  country: string;
  iso3: string;
  /** 5-year sovereign CDS spread, basis points. */
  cdsSpread5y: number;
  /** Debt-to-GDP ratio (e.g. 1.32 → 132%). */
  debtToGdp: number;
  notes: string;
}

export function classifyCreditTier(entry: Pick<SovereignCreditEntry, 'cdsSpread5y' | 'debtToGdp'>): CreditTier {
  if (entry.cdsSpread5y >= 1500 || entry.debtToGdp >= 2) return 'default-imminent';
  if (entry.cdsSpread5y >= 500 || entry.debtToGdp >= 1.2) return 'distressed';
  if (entry.cdsSpread5y >= 150 || entry.debtToGdp >= 0.9) return 'high-yield';
  return 'investment';
}

const CREDIT_TIER_COLORS: Record<CreditTier, string> = {
  investment: '#15803d',
  'high-yield': '#ca8a04',
  distressed: '#ea580c',
  'default-imminent': '#b91c1c',
};

const CREDIT_TIER_LABELS: Record<CreditTier, string> = {
  investment: 'IG',
  'high-yield': 'HY',
  distressed: 'Distressed',
  'default-imminent': 'Default Imminent',
};

export function creditTierColor(tier: CreditTier): string { return CREDIT_TIER_COLORS[tier]; }
export function creditTierLabel(tier: CreditTier): string { return CREDIT_TIER_LABELS[tier]; }

// ── Section 2 — Multilateral Risk Flags (IMF / World Bank) ────────────────

export interface MultilateralFlag {
  country: string;
  iso3: string;
  source: 'IMF' | 'WorldBank' | 'ParisClub';
  programType: string;          // e.g. 'EFF', 'SBA', 'DSSI', 'CCRT'
  tier: DistressTier;
  amountUsdBn: number | null;   // null = signal only, no programme attached
  flaggedAt: number;            // epoch ms
}

const DISTRESS_COLORS: Record<DistressTier, string> = {
  normal: '#4b5563',
  monitoring: '#ca8a04',
  program: '#ea580c',
  crisis: '#b91c1c',
};

const DISTRESS_LABELS: Record<DistressTier, string> = {
  normal: 'Normal',
  monitoring: 'Monitoring',
  program: 'In Programme',
  crisis: 'Crisis',
};

export function distressTierColor(t: DistressTier): string { return DISTRESS_COLORS[t]; }
export function distressTierLabel(t: DistressTier): string { return DISTRESS_LABELS[t]; }

export function countActivePrograms(flags: readonly MultilateralFlag[]): number {
  return flags.filter((f) => f.tier === 'program' || f.tier === 'crisis').length;
}

// ── Section 3 — Yield Curve Watch ─────────────────────────────────────────

export interface YieldCurvePoint {
  country: string;
  iso3: string;
  /** 2y benchmark yield, percent. */
  yield2y: number;
  /** 10y benchmark yield, percent. */
  yield10y: number;
  asOf: number;
}

export function curveSpreadBps(p: Pick<YieldCurvePoint, 'yield2y' | 'yield10y'>): number {
  return Math.round((p.yield10y - p.yield2y) * 100);
}

export function classifyYieldCurve(p: Pick<YieldCurvePoint, 'yield2y' | 'yield10y'>): YieldCurveState {
  const spread = curveSpreadBps(p);
  if (spread <= -100) return 'deeply-inverted';
  if (spread < 0) return 'inverted';
  if (spread < 25) return 'flat';
  return 'normal';
}

const YIELD_CURVE_COLORS: Record<YieldCurveState, string> = {
  normal: '#15803d',
  flat: '#ca8a04',
  inverted: '#ea580c',
  'deeply-inverted': '#b91c1c',
};

const YIELD_CURVE_LABELS: Record<YieldCurveState, string> = {
  normal: 'Normal',
  flat: 'Flat',
  inverted: 'Inverted',
  'deeply-inverted': 'Deeply Inverted',
};

export function yieldCurveColor(s: YieldCurveState): string { return YIELD_CURVE_COLORS[s]; }
export function yieldCurveLabel(s: YieldCurveState): string { return YIELD_CURVE_LABELS[s]; }

export function countInvertedCurves(points: readonly YieldCurvePoint[]): number {
  return points.filter((p) => {
    const s = classifyYieldCurve(p);
    return s === 'inverted' || s === 'deeply-inverted';
  }).length;
}

// ── Section 4 — Debt Stress Events (restructuring + reserves) ─────────────

export interface RestructuringEvent {
  country: string;
  iso3: string;
  status: RestructuringStatus;
  bondsAffectedUsdBn: number;
  haircutPercent: number | null;   // null until terms accepted
  announcedAt: number;
}

export interface ReserveDrawdown {
  country: string;
  iso3: string;
  reservesUsdBn: number;
  changeMonthPct: number;          // negative = drawdown
  importCoverMonths: number;
  pressure: ReservePressure;
}

const RESTRUCT_COLORS: Record<RestructuringStatus, string> = {
  announced: '#ca8a04',
  'in-negotiation': '#ea580c',
  standstill: '#b91c1c',
  completed: '#15803d',
  defaulted: '#7f1d1d',
};

const RESTRUCT_LABELS: Record<RestructuringStatus, string> = {
  announced: 'Announced',
  'in-negotiation': 'In Negotiation',
  standstill: 'Standstill',
  completed: 'Completed',
  defaulted: 'Defaulted',
};

export function restructuringColor(s: RestructuringStatus): string { return RESTRUCT_COLORS[s]; }
export function restructuringLabel(s: RestructuringStatus): string { return RESTRUCT_LABELS[s]; }

const RESERVE_COLORS: Record<ReservePressure, string> = {
  stable: '#15803d',
  declining: '#ca8a04',
  critical: '#ea580c',
  depleted: '#b91c1c',
};

const RESERVE_LABELS: Record<ReservePressure, string> = {
  stable: 'Stable',
  declining: 'Declining',
  critical: 'Critical',
  depleted: 'Depleted',
};

export function reservePressureColor(p: ReservePressure): string { return RESERVE_COLORS[p]; }
export function reservePressureLabel(p: ReservePressure): string { return RESERVE_LABELS[p]; }

/** Derive pressure from import-cover months: 3+ months = stable; 2-3 = declining; 1-2 = critical; <1 = depleted. */
export function classifyReservePressure(importCoverMonths: number): ReservePressure {
  if (importCoverMonths < 1) return 'depleted';
  if (importCoverMonths < 2) return 'critical';
  if (importCoverMonths < 3) return 'declining';
  return 'stable';
}

export function activeRestructurings(events: readonly RestructuringEvent[]): number {
  return events.filter((e) =>
    e.status === 'announced' || e.status === 'in-negotiation' || e.status === 'standstill' || e.status === 'defaulted',
  ).length;
}

// ── Section 5 — Contagion Risk Index ──────────────────────────────────────

export interface ContagionScoreInput {
  region: string;
  countries: number;
  distressedCount: number;            // countries in distressed/default tier
  inProgramCount: number;             // IMF/WB programme countries
  invertedCurves: number;
  activeRestructurings: number;
  averageCdsSpread5y: number;
}

export interface ContagionEntry {
  region: string;
  risk: ContagionRisk;
  drivers: string[];
}

/**
 * Composite scoring rubric:
 *   distressedShare  (≥0.5 → +2, ≥0.25 → +1)
 *   inProgramShare   (≥0.4 → +2, ≥0.2 → +1)
 *   invertedShare    (≥0.5 → +1)
 *   restructurings   (≥3 → +1)
 *   averageCds       (≥800 → +2, ≥400 → +1)
 * Clamped to 0..4.
 */
export function computeContagionScore(input: ContagionScoreInput): ContagionEntry {
  const drivers: string[] = [];
  const total = Math.max(1, input.countries);
  const distressShare = input.distressedCount / total;
  const programShare = input.inProgramCount / total;
  const invertedShare = input.invertedCurves / total;

  let score = 0;
  if (distressShare >= 0.5) { score += 2; drivers.push(`${Math.round(distressShare * 100)}% distressed`); }
  else if (distressShare >= 0.25) { score += 1; drivers.push(`${Math.round(distressShare * 100)}% distressed`); }
  if (programShare >= 0.4) { score += 2; drivers.push(`${Math.round(programShare * 100)}% in programme`); }
  else if (programShare >= 0.2) { score += 1; drivers.push(`${Math.round(programShare * 100)}% in programme`); }
  if (invertedShare >= 0.5) { score += 1; drivers.push(`${Math.round(invertedShare * 100)}% curves inverted`); }
  if (input.activeRestructurings >= 3) { score += 1; drivers.push(`${input.activeRestructurings} active restructurings`); }
  if (input.averageCdsSpread5y >= 800) { score += 2; drivers.push(`avg CDS ${input.averageCdsSpread5y}bp`); }
  else if (input.averageCdsSpread5y >= 400) { score += 1; drivers.push(`avg CDS ${input.averageCdsSpread5y}bp`); }

  const risk = Math.max(0, Math.min(4, score)) as ContagionRisk;
  return { region: input.region, risk, drivers };
}

const CONTAGION_COLORS: Record<ContagionRisk, string> = {
  0: '#15803d',
  1: '#65a30d',
  2: '#ca8a04',
  3: '#ea580c',
  4: '#b91c1c',
};

const CONTAGION_LABELS: Record<ContagionRisk, string> = {
  0: 'Calm',
  1: 'Watch',
  2: 'Elevated',
  3: 'High',
  4: 'Crisis',
};

export function contagionColor(r: ContagionRisk): string { return CONTAGION_COLORS[r]; }
export function contagionLabel(r: ContagionRisk): string { return CONTAGION_LABELS[r]; }

// ── Seed snapshots (illustrative, deterministic fixtures) ────────────────

export const SOVEREIGN_CREDIT: SovereignCreditEntry[] = [
  { country: 'Argentina',  iso3: 'ARG', cdsSpread5y: 2400, debtToGdp: 0.88, notes: 'Restructuring history; FX controls tight' },
  { country: 'Egypt',      iso3: 'EGY', cdsSpread5y: 820,  debtToGdp: 0.93, notes: 'IMF Extended Fund Facility in place' },
  { country: 'Türkiye',    iso3: 'TUR', cdsSpread5y: 280,  debtToGdp: 0.31, notes: 'Disinflation programme stabilising' },
  { country: 'Italy',      iso3: 'ITA', cdsSpread5y: 75,   debtToGdp: 1.37, notes: 'High stock, low flow; ECB backstop' },
  { country: 'Japan',      iso3: 'JPN', cdsSpread5y: 24,   debtToGdp: 2.55, notes: 'Domestically held; YCC unwind ongoing' },
  { country: 'United States', iso3: 'USA', cdsSpread5y: 38, debtToGdp: 1.23, notes: 'Reserve currency premium' },
  { country: 'Pakistan',   iso3: 'PAK', cdsSpread5y: 1100, debtToGdp: 0.74, notes: 'Reserves dangerously thin' },
  { country: 'Sri Lanka',  iso3: 'LKA', cdsSpread5y: 1850, debtToGdp: 1.15, notes: 'Restructured 2024; conditional' },
];

export const MULTILATERAL_FLAGS: MultilateralFlag[] = [
  { country: 'Argentina',  iso3: 'ARG', source: 'IMF',        programType: 'EFF',  tier: 'program',    amountUsdBn: 44, flaggedAt: Date.UTC(2026, 0, 15) },
  { country: 'Egypt',      iso3: 'EGY', source: 'IMF',        programType: 'EFF',  tier: 'program',    amountUsdBn: 8,  flaggedAt: Date.UTC(2026, 1, 3) },
  { country: 'Pakistan',   iso3: 'PAK', source: 'IMF',        programType: 'SBA',  tier: 'program',    amountUsdBn: 7,  flaggedAt: Date.UTC(2026, 2, 12) },
  { country: 'Ethiopia',   iso3: 'ETH', source: 'ParisClub',  programType: 'CCRT', tier: 'crisis',     amountUsdBn: null, flaggedAt: Date.UTC(2026, 2, 28) },
  { country: 'Zambia',     iso3: 'ZMB', source: 'IMF',        programType: 'ECF',  tier: 'program',    amountUsdBn: 1.3, flaggedAt: Date.UTC(2025, 11, 4) },
  { country: 'Türkiye',    iso3: 'TUR', source: 'WorldBank',  programType: 'CPF',  tier: 'monitoring', amountUsdBn: null, flaggedAt: Date.UTC(2026, 1, 18) },
];

export const YIELD_CURVES: YieldCurvePoint[] = [
  { country: 'United States', iso3: 'USA', yield2y: 4.1, yield10y: 4.05, asOf: Date.UTC(2026, 4, 15) },
  { country: 'Germany',       iso3: 'DEU', yield2y: 2.55, yield10y: 2.3, asOf: Date.UTC(2026, 4, 15) },
  { country: 'United Kingdom',iso3: 'GBR', yield2y: 4.3, yield10y: 3.95, asOf: Date.UTC(2026, 4, 15) },
  { country: 'Japan',         iso3: 'JPN', yield2y: 0.75, yield10y: 1.2, asOf: Date.UTC(2026, 4, 15) },
  { country: 'Italy',         iso3: 'ITA', yield2y: 3.05, yield10y: 3.85, asOf: Date.UTC(2026, 4, 15) },
  { country: 'Argentina',     iso3: 'ARG', yield2y: 28.5, yield10y: 16, asOf: Date.UTC(2026, 4, 15) },
];

export const RESTRUCTURING_EVENTS: RestructuringEvent[] = [
  { country: 'Sri Lanka', iso3: 'LKA', status: 'completed',      bondsAffectedUsdBn: 14, haircutPercent: 27, announcedAt: Date.UTC(2024, 5, 1) },
  { country: 'Ghana',     iso3: 'GHA', status: 'completed',      bondsAffectedUsdBn: 13, haircutPercent: 37, announcedAt: Date.UTC(2024, 9, 12) },
  { country: 'Zambia',    iso3: 'ZMB', status: 'in-negotiation', bondsAffectedUsdBn:  3, haircutPercent: null, announcedAt: Date.UTC(2025, 6, 4) },
  { country: 'Ethiopia',  iso3: 'ETH', status: 'in-negotiation', bondsAffectedUsdBn:  1, haircutPercent: null, announcedAt: Date.UTC(2025, 11, 8) },
  { country: 'Lebanon',   iso3: 'LBN', status: 'defaulted',      bondsAffectedUsdBn: 31, haircutPercent: null, announcedAt: Date.UTC(2020, 2, 9) },
];

export const RESERVE_DRAWDOWNS: ReserveDrawdown[] = [
  { country: 'Pakistan',   iso3: 'PAK', reservesUsdBn:  9.2, changeMonthPct: -8.5, importCoverMonths: 1.4, pressure: 'critical' },
  { country: 'Argentina',  iso3: 'ARG', reservesUsdBn: 22.5, changeMonthPct: -3.2, importCoverMonths: 2.5, pressure: 'declining' },
  { country: 'Egypt',      iso3: 'EGY', reservesUsdBn: 41, changeMonthPct: +0.8, importCoverMonths: 5.1, pressure: 'stable' },
  { country: 'Türkiye',    iso3: 'TUR', reservesUsdBn:155, changeMonthPct: +2.1, importCoverMonths: 5.4, pressure: 'stable' },
  { country: 'Ethiopia',   iso3: 'ETH', reservesUsdBn:  1.1, changeMonthPct: -12, importCoverMonths: 0.7, pressure: 'depleted' },
];

export const CONTAGION_REGIONS: ContagionScoreInput[] = [
  {
    region: 'Latin America', countries: 4, distressedCount: 1, inProgramCount: 1,
    invertedCurves: 1, activeRestructurings: 1, averageCdsSpread5y: 720,
  },
  {
    region: 'Sub-Saharan Africa', countries: 5, distressedCount: 2, inProgramCount: 2,
    invertedCurves: 0, activeRestructurings: 3, averageCdsSpread5y: 950,
  },
  {
    region: 'MENA', countries: 5, distressedCount: 1, inProgramCount: 2,
    invertedCurves: 1, activeRestructurings: 0, averageCdsSpread5y: 540,
  },
  {
    region: 'South Asia', countries: 4, distressedCount: 2, inProgramCount: 1,
    invertedCurves: 0, activeRestructurings: 1, averageCdsSpread5y: 880,
  },
  {
    region: 'Eurozone (periphery)', countries: 4, distressedCount: 0, inProgramCount: 0,
    invertedCurves: 0, activeRestructurings: 0, averageCdsSpread5y: 65,
  },
];
