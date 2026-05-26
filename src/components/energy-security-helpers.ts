/**
 * Pure helpers for EnergySecurityPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type Commodity = 'oil' | 'gas' | 'lng' | 'coal';
export type DisruptionCause =
  | 'attack'
  | 'sanction'
  | 'accident'
  | 'weather'
  | 'maintenance'
  | 'labor';
export type Severity = 0 | 1 | 2 | 3 | 4;
export type AttackType = 'cyber' | 'physical' | 'sabotage';
export type AttackStatus = 'suspected' | 'confirmed';
export type GridThreat =
  | 'demand spike'
  | 'wildfire'
  | 'storm'
  | 'cold snap'
  | 'cyber'
  | 'aging infrastructure';
export type Redundancy = 'low' | 'medium' | 'high';
export type PriceBenchmark = 'Brent' | 'WTI' | 'TTF' | 'HenryHub' | 'JKM';
export type PriceLevel = 'normal' | 'elevated' | 'shock' | 'crisis';
export type OPECStatus = 'compliant' | 'over' | 'under';
export type LNGRole = 'import' | 'export';
export type LNGStatus = 'operational' | 'reduced' | 'offline';
export type SanctionsRegime = 'G7 price cap' | 'EU embargo' | 'US OFAC' | 'UK' | 'UN';

export interface DisruptionEvent {
  facility: string;
  country: string;
  commodity: Commodity;
  cause: DisruptionCause;
  severity: Severity;
  durationDays: number;
  /** Lost throughput in millions of barrels/day equivalent (gas converted to bbl-equivalent for ranking). */
  lostMbblPerDay: number;
}

export interface PipelineAttackIndicator {
  pipeline: string;
  country: string;
  type: AttackType;
  /** Analyst confidence 0–3. 3 = confirmed by multiple sources. */
  confidence: 0 | 1 | 2 | 3;
  status: AttackStatus;
}

export interface GridVulnerability {
  region: string;
  riskLevel: Severity;
  primaryThreat: GridThreat;
  redundancy: Redundancy;
}

export interface PriceShockSignal {
  benchmark: PriceBenchmark;
  /** Last 24h percent change. Positive = price up. */
  changePercent24h: number;
  /** Percent threshold above which we call it a shock. */
  shockThreshold: number;
  level: PriceLevel;
}

export interface OPECComplianceEntry {
  country: string;
  quotaMbblPerDay: number;
  productionMbblPerDay: number;
  /** 100 = exactly on quota. >100 = over-producing. <100 = under-producing. */
  compliancePercent: number;
  status: OPECStatus;
}

export interface LNGTerminal {
  terminal: string;
  country: string;
  role: LNGRole;
  status: LNGStatus;
  /** Capacity in million tonnes per annum. */
  capacityMtpa: number;
}

export interface SanctionsImpact {
  target: string;
  regime: SanctionsRegime;
  /** 0–100 composite score. Higher = more squeeze on the target. */
  impactScore: number;
  /** Affected exports in million barrels/day (or bbl-equivalent for gas). */
  affectedMbblPerDay: number;
  /** Estimated evasion (dark fleet, transhipment). */
  evadedMbblPerDay: number;
}

// ── Severity helpers (0–4 scale, shared across sections) ─────────────────

export function severityColor(s: Severity): string {
  const colors: Record<Severity, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function severityLabel(s: Severity): string {
  const labels: Record<Severity, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Critical',
  };
  return labels[s];
}

// ── Commodity / cause labels ──────────────────────────────────────────────

export function commodityLabel(c: Commodity): string {
  const labels: Record<Commodity, string> = {
    oil: 'Oil',
    gas: 'Gas',
    lng: 'LNG',
    coal: 'Coal',
  };
  return labels[c];
}

export function causeLabel(c: DisruptionCause): string {
  const labels: Record<DisruptionCause, string> = {
    attack:      'Attack',
    sanction:    'Sanction',
    accident:    'Accident',
    weather:     'Weather',
    maintenance: 'Maintenance',
    labor:       'Labor',
  };
  return labels[c];
}

// ── Pipeline attack helpers ───────────────────────────────────────────────

export function attackTypeLabel(t: AttackType): string {
  const labels: Record<AttackType, string> = {
    cyber:    'Cyber',
    physical: 'Physical',
    sabotage: 'Sabotage',
  };
  return labels[t];
}

export function attackTypeColor(t: AttackType): string {
  const colors: Record<AttackType, string> = {
    cyber:    'var(--severity-medium,   #facc15)',
    physical: 'var(--severity-high,     #fb923c)',
    sabotage: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function attackStatusColor(s: AttackStatus): string {
  return s === 'confirmed'
    ? 'var(--severity-critical, #ef4444)'
    : 'var(--severity-medium,   #facc15)';
}

// ── Grid vulnerability helpers ────────────────────────────────────────────

export function gridThreatLabel(t: GridThreat): string {
  const labels: Record<GridThreat, string> = {
    'demand spike':          'Demand Spike',
    wildfire:                'Wildfire',
    storm:                   'Storm',
    'cold snap':             'Cold Snap',
    cyber:                   'Cyber',
    'aging infrastructure':  'Aging Infrastructure',
  };
  return labels[t];
}

export function redundancyColor(r: Redundancy): string {
  const colors: Record<Redundancy, string> = {
    low:    'var(--severity-critical, #ef4444)',
    medium: 'var(--severity-medium,   #facc15)',
    high:   'var(--severity-low,      #4caf50)',
  };
  return colors[r];
}

// ── Price shock helpers ───────────────────────────────────────────────────

export function priceLevelColor(l: PriceLevel): string {
  const colors: Record<PriceLevel, string> = {
    normal:   'var(--severity-low,      #4caf50)',
    elevated: 'var(--severity-medium,   #facc15)',
    shock:    'var(--severity-high,     #fb923c)',
    crisis:   'var(--severity-critical, #ef4444)',
  };
  return colors[l];
}

export function classifyPriceLevel(changePct: number, shockThresholdPct: number): PriceLevel {
  const abs = Math.abs(changePct);
  if (abs >= shockThresholdPct * 2)   return 'crisis';
  if (abs >= shockThresholdPct)        return 'shock';
  if (abs >= shockThresholdPct / 2)    return 'elevated';
  return 'normal';
}

export function formatPercentChange(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ── OPEC+ compliance helpers ──────────────────────────────────────────────

export function opecStatusColor(s: OPECStatus): string {
  const colors: Record<OPECStatus, string> = {
    compliant: 'var(--severity-low,      #4caf50)',
    over:      'var(--severity-high,     #fb923c)',
    under:     'var(--severity-medium,   #facc15)',
  };
  return colors[s];
}

export function classifyOpecStatus(compliancePercent: number): OPECStatus {
  // ±2% tolerance band around 100% is treated as compliant.
  if (compliancePercent > 102) return 'over';
  if (compliancePercent < 98)  return 'under';
  return 'compliant';
}

// ── LNG terminal helpers ──────────────────────────────────────────────────

export function lngRoleLabel(r: LNGRole): string {
  return r === 'import' ? 'Import' : 'Export';
}

export function lngStatusColor(s: LNGStatus): string {
  const colors: Record<LNGStatus, string> = {
    operational: 'var(--severity-low,      #4caf50)',
    reduced:     'var(--severity-medium,   #facc15)',
    offline:     'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

// ── Sanctions helpers ─────────────────────────────────────────────────────

export function sanctionsImpactColor(score: number): string {
  if (score >= 75) return 'var(--severity-critical, #ef4444)';
  if (score >= 50) return 'var(--severity-high,     #fb923c)';
  if (score >= 25) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low, #4caf50)';
}

export function sanctionsImpactLabel(score: number): string {
  if (score >= 75) return 'Severe';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Limited';
}

/** Net effective impact after evasion is netted out (0–100, never negative). */
export function netImpactScore(entry: SanctionsImpact): number {
  if (entry.affectedMbblPerDay <= 0) return 0;
  const slipRatio = Math.min(1, entry.evadedMbblPerDay / entry.affectedMbblPerDay);
  const effective = entry.impactScore * (1 - slipRatio);
  return Math.max(0, Math.min(100, Math.round(effective)));
}

// ── Formatting helpers ────────────────────────────────────────────────────

export function formatMbblPerDay(mbbl: number): string {
  if (mbbl >= 1)   return `${mbbl.toFixed(2)} Mb/d`;
  if (mbbl >= 0.1) return `${(mbbl * 1000).toFixed(0)} kb/d`;
  return `${(mbbl * 1000).toFixed(1)} kb/d`;
}

export function formatMtpa(mtpa: number): string {
  return `${mtpa.toFixed(1)} MTPA`;
}

export function formatDuration(days: number): string {
  if (days < 1)    return '<1 day';
  if (days < 30)   return `${Math.round(days)}d`;
  if (days < 365)  return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

// ── Count / ranking helpers ───────────────────────────────────────────────

export function countActiveDisruptions(events: DisruptionEvent[]): number {
  return events.filter((e) => e.severity >= 3).length;
}

export function countConfirmedAttacks(indicators: PipelineAttackIndicator[]): number {
  return indicators.filter((i) => i.status === 'confirmed').length;
}

export function countCriticalGrids(grids: GridVulnerability[]): number {
  return grids.filter((g) => g.riskLevel >= 3).length;
}

export function countShockBenchmarks(signals: PriceShockSignal[]): number {
  return signals.filter((s) => s.level === 'shock' || s.level === 'crisis').length;
}

export function countOffshoreOfflineTerminals(terminals: LNGTerminal[]): number {
  return terminals.filter((t) => t.status === 'offline').length;
}

/** Compose the overall panel badge count: anything that should make an
 *  analyst look. Sums critical disruptions + confirmed attacks + critical
 *  grids + price shocks + offline terminals. Used for the panel chip. */
export function composeBadgeCount(
  disruptions: DisruptionEvent[],
  attacks: PipelineAttackIndicator[],
  grids: GridVulnerability[],
  prices: PriceShockSignal[],
  terminals: LNGTerminal[],
): number {
  return (
    countActiveDisruptions(disruptions)
    + countConfirmedAttacks(attacks)
    + countCriticalGrids(grids)
    + countShockBenchmarks(prices)
    + countOffshoreOfflineTerminals(terminals)
  );
}

// ── Static demo data ──────────────────────────────────────────────────────

export const DISRUPTION_EVENTS: DisruptionEvent[] = [
  { facility: 'Druzhba Pipeline (northern)', country: 'Russia / Belarus', commodity: 'oil', cause: 'attack',      severity: 4, durationDays: 14,  lostMbblPerDay: 0.6 },
  { facility: 'Abqaiq Processing Facility',  country: 'Saudi Arabia',     commodity: 'oil', cause: 'attack',      severity: 3, durationDays: 7,   lostMbblPerDay: 5.7 },
  { facility: 'Nord Stream 1 + 2',           country: 'Baltic Sea',       commodity: 'gas', cause: 'attack',      severity: 4, durationDays: 999, lostMbblPerDay: 1.2 },
  { facility: 'Texas grid spillover',        country: 'USA',              commodity: 'gas', cause: 'weather',     severity: 3, durationDays: 5,   lostMbblPerDay: 0.4 },
  { facility: 'Kazakh CPC pipeline',         country: 'Kazakhstan',       commodity: 'oil', cause: 'maintenance', severity: 2, durationDays: 21,  lostMbblPerDay: 0.15 },
  { facility: 'Bab el-Mandeb tanker route',  country: 'Yemen / Red Sea',  commodity: 'oil', cause: 'attack',      severity: 3, durationDays: 60,  lostMbblPerDay: 0.3 },
];

export const PIPELINE_ATTACKS: PipelineAttackIndicator[] = [
  { pipeline: 'Druzhba (Friendship)',     country: 'Russia / Poland',  type: 'physical', confidence: 3, status: 'confirmed' },
  { pipeline: 'Colonial Pipeline',        country: 'USA',              type: 'cyber',    confidence: 3, status: 'confirmed' },
  { pipeline: 'Nord Stream 1+2',          country: 'Baltic Sea',       type: 'sabotage', confidence: 3, status: 'confirmed' },
  { pipeline: 'TurkStream',               country: 'Türkiye / Russia', type: 'cyber',    confidence: 1, status: 'suspected' },
  { pipeline: 'Trans-Israel pipeline',    country: 'Israel',           type: 'physical', confidence: 2, status: 'suspected' },
];

export const GRID_VULNERABILITIES: GridVulnerability[] = [
  { region: 'Texas (ERCOT)',           riskLevel: 3, primaryThreat: 'cold snap',            redundancy: 'low'    },
  { region: 'California (CAISO)',      riskLevel: 3, primaryThreat: 'wildfire',             redundancy: 'medium' },
  { region: 'Germany / Central Europe', riskLevel: 2, primaryThreat: 'demand spike',         redundancy: 'medium' },
  { region: 'India (Northern Grid)',   riskLevel: 4, primaryThreat: 'demand spike',         redundancy: 'low'    },
  { region: 'Ukraine',                 riskLevel: 4, primaryThreat: 'cyber',                redundancy: 'low'    },
  { region: 'UK (National Grid)',      riskLevel: 2, primaryThreat: 'aging infrastructure', redundancy: 'high'   },
];

export const PRICE_SHOCKS: PriceShockSignal[] = [
  { benchmark: 'Brent',     changePercent24h:  2.1, shockThreshold: 5, level: classifyPriceLevel(2.1, 5)  },
  { benchmark: 'WTI',       changePercent24h:  1.8, shockThreshold: 5, level: classifyPriceLevel(1.8, 5)  },
  { benchmark: 'TTF',       changePercent24h: 12.4, shockThreshold: 8, level: classifyPriceLevel(12.4, 8) },
  { benchmark: 'HenryHub',  changePercent24h: -0.8, shockThreshold: 6, level: classifyPriceLevel(-0.8, 6) },
  { benchmark: 'JKM',       changePercent24h:  9.2, shockThreshold: 8, level: classifyPriceLevel(9.2, 8)  },
];

export const OPEC_COMPLIANCE: OPECComplianceEntry[] = [
  { country: 'Saudi Arabia',        quotaMbblPerDay: 10.5, productionMbblPerDay: 10.4, compliancePercent:  99, status: classifyOpecStatus(99)  },
  { country: 'Russia (OPEC+)',      quotaMbblPerDay: 9.8,  productionMbblPerDay: 10, compliancePercent: 102, status: classifyOpecStatus(102) },
  { country: 'UAE',                 quotaMbblPerDay: 3,  productionMbblPerDay:  3.2, compliancePercent: 107, status: classifyOpecStatus(107) },
  { country: 'Iraq',                quotaMbblPerDay: 4.4,  productionMbblPerDay:  4.6, compliancePercent: 105, status: classifyOpecStatus(105) },
  { country: 'Kuwait',              quotaMbblPerDay: 2.5,  productionMbblPerDay:  2.5, compliancePercent: 100, status: classifyOpecStatus(100) },
  { country: 'Nigeria',             quotaMbblPerDay: 1.8,  productionMbblPerDay:  1.4, compliancePercent:  78, status: classifyOpecStatus(78)  },
];

export const LNG_TERMINALS: LNGTerminal[] = [
  { terminal: 'Sabine Pass',         country: 'USA',            role: 'export', status: 'operational', capacityMtpa: 30 },
  { terminal: 'Cameron LNG',         country: 'USA',            role: 'export', status: 'operational', capacityMtpa: 12 },
  { terminal: 'Ras Laffan',          country: 'Qatar',          role: 'export', status: 'operational', capacityMtpa: 77 },
  { terminal: 'Yamal LNG',           country: 'Russia',         role: 'export', status: 'reduced',     capacityMtpa: 17.4 },
  { terminal: 'Freeport LNG',        country: 'USA',            role: 'export', status: 'reduced',     capacityMtpa: 15 },
  { terminal: 'Gate Terminal',       country: 'Netherlands',    role: 'import', status: 'operational', capacityMtpa: 12 },
  { terminal: 'Adriatic LNG',        country: 'Italy',          role: 'import', status: 'operational', capacityMtpa:  8 },
  { terminal: 'Wilhelmshaven FSRU',  country: 'Germany',        role: 'import', status: 'operational', capacityMtpa:  5 },
];

export const SANCTIONS_IMPACT: SanctionsImpact[] = [
  { target: 'Russia',     regime: 'G7 price cap', impactScore: 65, affectedMbblPerDay: 3.2, evadedMbblPerDay: 1.4 },
  { target: 'Russia',     regime: 'EU embargo',   impactScore: 70, affectedMbblPerDay: 2.1, evadedMbblPerDay: 0.5 },
  { target: 'Iran',       regime: 'US OFAC',      impactScore: 80, affectedMbblPerDay: 1.8, evadedMbblPerDay: 1.1 },
  { target: 'Venezuela',  regime: 'US OFAC',      impactScore: 60, affectedMbblPerDay: 0.7, evadedMbblPerDay: 0.2 },
  { target: 'DPRK',       regime: 'UN',           impactScore: 50, affectedMbblPerDay: 0.1, evadedMbblPerDay: 0.05 },
];
