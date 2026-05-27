/**
 * Pure helpers for RegulatoryArbitragePanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Covers:
 *   1. Jurisdiction Opacity Scores    — beneficial ownership opacity, shell company hotspots
 *   2. FATF Status                    — grey/blacklist status and compliance ratings
 *   3. Regulatory Gap Map             — tax haven, crypto, data sovereignty, finance gaps
 *   4. Arbitrage Exposure Metrics     — per-domain exposure score for a given jurisdiction
 *   5. Enforcement Trend Analysis     — enforcement action counts and trend direction
 *   6. Render-data builders           — aggregate summary rows consumed by the panel
 */

// ── Type unions ───────────────────────────────────────────────────────────

export type OpacityTier = 'transparent' | 'low' | 'moderate' | 'high' | 'extreme';
export type FatfStatus = 'compliant' | 'monitored' | 'grey' | 'black' | 'unrated';
export type GapDomain = 'tax' | 'crypto' | 'data-sovereignty' | 'financial-regulation' | 'beneficial-ownership';
export type GapSeverity = 'negligible' | 'minor' | 'moderate' | 'significant' | 'critical';
export type EnforcementTrend = 'decreasing' | 'stable' | 'increasing' | 'surge';
export type ArbitrageRisk = 'low' | 'medium' | 'high' | 'extreme';

// ── Section 1 — Jurisdiction Opacity ─────────────────────────────────────

export interface JurisdictionOpacity {
  jurisdiction: string;
  iso2: string;
  region: string;
  /** 0–100. Higher = more opaque (harder to identify beneficial owners). */
  opacityScore: number;
  shellCompanyCount: number;   // estimated thousands
  nomineeDirectorsAllowed: boolean;
  bearerSharesAllowed: boolean;
  publicRegistryExists: boolean;
}

const OPACITY_TIER_COLORS: Record<OpacityTier, string> = {
  transparent: '#22c55e',
  low:         '#84cc16',
  moderate:    '#eab308',
  high:        '#f97316',
  extreme:     '#ef4444',
};

const OPACITY_TIER_LABELS: Record<OpacityTier, string> = {
  transparent: 'Transparent',
  low:         'Low Opacity',
  moderate:    'Moderate Opacity',
  high:        'High Opacity',
  extreme:     'Extreme Opacity',
};

export function opacityTierColor(t: OpacityTier): string { return OPACITY_TIER_COLORS[t]; }
export function opacityTierLabel(t: OpacityTier): string { return OPACITY_TIER_LABELS[t]; }

export function classifyOpacity(score: number): OpacityTier {
  if (score < 20) return 'transparent';
  if (score < 40) return 'low';
  if (score < 60) return 'moderate';
  if (score < 80) return 'high';
  return 'extreme';
}

export function computeOpacityScore(j: Pick<JurisdictionOpacity,
  'nomineeDirectorsAllowed' | 'bearerSharesAllowed' | 'publicRegistryExists' | 'shellCompanyCount'>): number {
  let score = 0;
  if (j.nomineeDirectorsAllowed) score += 20;
  if (j.bearerSharesAllowed)     score += 25;
  if (!j.publicRegistryExists)   score += 30;
  // Shell company density: 0–25 bonus. Cap at 500k = full 25 pts.
  const densityPts = Math.min(25, Math.floor((j.shellCompanyCount / 500) * 25));
  score += densityPts;
  return Math.min(100, score);
}

export function sortByOpacityDesc(rows: readonly JurisdictionOpacity[]): JurisdictionOpacity[] {
  return [...rows].sort((a, b) => b.opacityScore - a.opacityScore);
}

export function countExtremeOpacityJurisdictions(rows: readonly JurisdictionOpacity[]): number {
  return rows.filter((r) => classifyOpacity(r.opacityScore) === 'extreme').length;
}

// ── Section 2 — FATF Status ───────────────────────────────────────────────

export interface FatfJurisdiction {
  jurisdiction: string;
  iso2: string;
  status: FatfStatus;
  /** Year of last review */
  lastReview: number;
  /** Primary deficiencies cited */
  deficiencies: string[];
  /** Composite compliance rating 0–100 */
  complianceScore: number;
}

const FATF_STATUS_COLORS: Record<FatfStatus, string> = {
  compliant:  '#22c55e',
  monitored:  '#84cc16',
  grey:       '#eab308',
  black:      '#ef4444',
  unrated:    '#6b7280',
};

const FATF_STATUS_LABELS: Record<FatfStatus, string> = {
  compliant:  'Compliant',
  monitored:  'Enhanced Monitoring',
  grey:       'Grey List',
  black:      'Black List',
  unrated:    'Unrated',
};

export function fatfStatusColor(s: FatfStatus): string { return FATF_STATUS_COLORS[s]; }
export function fatfStatusLabel(s: FatfStatus): string { return FATF_STATUS_LABELS[s]; }

export function countFatfByStatus(rows: readonly FatfJurisdiction[], status: FatfStatus): number {
  return rows.filter((r) => r.status === status).length;
}

export function highRiskFatfJurisdictions(rows: readonly FatfJurisdiction[]): FatfJurisdiction[] {
  return rows.filter((r) => r.status === 'grey' || r.status === 'black');
}

export function averageComplianceScore(rows: readonly FatfJurisdiction[]): number {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, r) => sum + r.complianceScore, 0) / rows.length);
}

// ── Section 3 — Regulatory Gap Map ───────────────────────────────────────

export interface RegulatoryGap {
  jurisdiction: string;
  iso2: string;
  domain: GapDomain;
  severity: GapSeverity;
  description: string;
  /** Year gap was first identified */
  identifiedYear: number;
  /** Whether international pressure is mounting to close it */
  closurePressure: boolean;
}

const GAP_SEVERITY_COLORS: Record<GapSeverity, string> = {
  negligible:  '#22c55e',
  minor:       '#84cc16',
  moderate:    '#eab308',
  significant: '#f97316',
  critical:    '#ef4444',
};

const GAP_SEVERITY_LABELS: Record<GapSeverity, string> = {
  negligible:  'Negligible',
  minor:       'Minor',
  moderate:    'Moderate',
  significant: 'Significant',
  critical:    'Critical',
};

const GAP_DOMAIN_LABELS: Record<GapDomain, string> = {
  'tax':                  'Tax Haven',
  'crypto':               'Crypto Regulation',
  'data-sovereignty':     'Data Sovereignty',
  'financial-regulation': 'Financial Regulation',
  'beneficial-ownership': 'Beneficial Ownership',
};

export function gapSeverityColor(s: GapSeverity): string { return GAP_SEVERITY_COLORS[s]; }
export function gapSeverityLabel(s: GapSeverity): string { return GAP_SEVERITY_LABELS[s]; }
export function gapDomainLabel(d: GapDomain): string { return GAP_DOMAIN_LABELS[d]; }

export function countCriticalGaps(gaps: readonly RegulatoryGap[]): number {
  return gaps.filter((g) => g.severity === 'critical' || g.severity === 'significant').length;
}

export function gapsByDomain(gaps: readonly RegulatoryGap[], domain: GapDomain): RegulatoryGap[] {
  return gaps.filter((g) => g.domain === domain);
}

export function gapsUnderPressure(gaps: readonly RegulatoryGap[]): RegulatoryGap[] {
  return gaps.filter((g) => g.closurePressure);
}

export function sortGapsBySeverityDesc(gaps: readonly RegulatoryGap[]): RegulatoryGap[] {
  const order: GapSeverity[] = ['critical', 'significant', 'moderate', 'minor', 'negligible'];
  return [...gaps].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

// ── Section 4 — Arbitrage Exposure Metrics ────────────────────────────────

export interface ArbitrageExposure {
  jurisdiction: string;
  iso2: string;
  /** Tax differential vs OECD average (percentage points) */
  taxDifferentialPct: number;
  /** Crypto regulation gap score 0–100 */
  cryptoGapScore: number;
  /** Data regulation gap score 0–100 */
  dataGapScore: number;
  /** Finance regulation gap score 0–100 */
  financeGapScore: number;
  /** Annual estimated illicit financial flows (USD billions) */
  illicitFlowsUsdBn: number;
}

const ARBIT_RISK_COLORS: Record<ArbitrageRisk, string> = {
  low:     '#22c55e',
  medium:  '#eab308',
  high:    '#f97316',
  extreme: '#ef4444',
};

const ARBIT_RISK_LABELS: Record<ArbitrageRisk, string> = {
  low:     'Low Risk',
  medium:  'Medium Risk',
  high:    'High Risk',
  extreme: 'Extreme Risk',
};

export function arbitrageRiskColor(r: ArbitrageRisk): string { return ARBIT_RISK_COLORS[r]; }
export function arbitrageRiskLabel(r: ArbitrageRisk): string { return ARBIT_RISK_LABELS[r]; }

export function computeArbitrageScore(e: Pick<ArbitrageExposure,
  'taxDifferentialPct' | 'cryptoGapScore' | 'dataGapScore' | 'financeGapScore'>): number {
  // Weighted composite. Tax differential dominates; finance regulation second.
  const taxPts     = Math.min(40, Math.max(0, e.taxDifferentialPct * 1.5));
  const cryptoPts  = (e.cryptoGapScore  / 100) * 20;
  const dataPts    = (e.dataGapScore    / 100) * 15;
  const financePts = (e.financeGapScore / 100) * 25;
  return Math.min(100, Math.round(taxPts + cryptoPts + dataPts + financePts));
}

export function classifyArbitrageRisk(score: number): ArbitrageRisk {
  if (score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'extreme';
}

export function totalIllicitFlowsUsdBn(rows: readonly ArbitrageExposure[]): number {
  return Math.round(rows.reduce((sum, r) => sum + r.illicitFlowsUsdBn, 0) * 10) / 10;
}

export function sortByArbitrageScoreDesc(rows: readonly ArbitrageExposure[]): ArbitrageExposure[] {
  return [...rows].sort((a, b) =>
    computeArbitrageScore(b) - computeArbitrageScore(a));
}

// ── Section 5 — Enforcement Trend Analysis ────────────────────────────────

export interface EnforcementRegion {
  region: string;
  /** Enforcement actions in prior 12-month window */
  actionsLastYear: number;
  /** Enforcement actions in current 12-month window */
  actionsThisYear: number;
  /** USD millions in fines/penalties levied */
  penaltiesUsdM: number;
  trend: EnforcementTrend;
  /** Notable enforcement bodies active in this region */
  activeBodies: string[];
}

const ENFORCEMENT_TREND_COLORS: Record<EnforcementTrend, string> = {
  decreasing: '#ef4444',
  stable:     '#eab308',
  increasing: '#84cc16',
  surge:      '#22c55e',
};

const ENFORCEMENT_TREND_LABELS: Record<EnforcementTrend, string> = {
  decreasing: 'Decreasing',
  stable:     'Stable',
  increasing: 'Increasing',
  surge:      'Surge',
};

export function enforcementTrendColor(t: EnforcementTrend): string { return ENFORCEMENT_TREND_COLORS[t]; }
export function enforcementTrendLabel(t: EnforcementTrend): string { return ENFORCEMENT_TREND_LABELS[t]; }

export function deriveTrend(prior: number, current: number): EnforcementTrend {
  if (prior === 0) return current > 0 ? 'increasing' : 'stable';
  const changePct = (current - prior) / prior;
  if (changePct <= -0.1)  return 'decreasing';
  if (changePct >= 0.5)   return 'surge';
  if (changePct >= 0.1)   return 'increasing';
  return 'stable';
}

export function totalPenaltiesUsdM(rows: readonly EnforcementRegion[]): number {
  return Math.round(rows.reduce((sum, r) => sum + r.penaltiesUsdM, 0));
}

export function sortByPenaltiesDesc(rows: readonly EnforcementRegion[]): EnforcementRegion[] {
  return [...rows].sort((a, b) => b.penaltiesUsdM - a.penaltiesUsdM);
}

export function regionsWithSurgingEnforcement(rows: readonly EnforcementRegion[]): EnforcementRegion[] {
  return rows.filter((r) => r.trend === 'surge' || r.trend === 'increasing');
}

// ── Seed data — deterministic offline snapshots ───────────────────────────

export const REFERENCE_NOW_MS = new Date('2026-05-27T00:00:00Z').getTime();

export const JURISDICTION_OPACITY: readonly JurisdictionOpacity[] = [
  { jurisdiction: 'Cayman Islands',   iso2: 'KY', region: 'Caribbean',    opacityScore: 92, shellCompanyCount: 140,  nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: false },
  { jurisdiction: 'British Virgin Is', iso2: 'VG', region: 'Caribbean',   opacityScore: 89, shellCompanyCount: 500,  nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: false },
  { jurisdiction: 'Delaware (US)',     iso2: 'US', region: 'North America',opacityScore: 71, shellCompanyCount: 1800, nomineeDirectorsAllowed: false, bearerSharesAllowed: false, publicRegistryExists: false },
  { jurisdiction: 'Panama',            iso2: 'PA', region: 'Central Am.',  opacityScore: 85, shellCompanyCount: 370,  nomineeDirectorsAllowed: true,  bearerSharesAllowed: true,  publicRegistryExists: false },
  { jurisdiction: 'Luxembourg',        iso2: 'LU', region: 'Europe',       opacityScore: 58, shellCompanyCount: 80,   nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: true  },
  { jurisdiction: 'Malta',             iso2: 'MT', region: 'Europe',       opacityScore: 55, shellCompanyCount: 30,   nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: true  },
  { jurisdiction: 'Seychelles',        iso2: 'SC', region: 'Africa',       opacityScore: 82, shellCompanyCount: 120,  nomineeDirectorsAllowed: true,  bearerSharesAllowed: true,  publicRegistryExists: false },
  { jurisdiction: 'United Arab Emirates', iso2: 'AE', region: 'Middle East', opacityScore: 74, shellCompanyCount: 240, nomineeDirectorsAllowed: true, bearerSharesAllowed: false, publicRegistryExists: false },
  { jurisdiction: 'Hong Kong',         iso2: 'HK', region: 'Asia-Pac',     opacityScore: 62, shellCompanyCount: 290,  nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: true  },
  { jurisdiction: 'Singapore',         iso2: 'SG', region: 'Asia-Pac',     opacityScore: 42, shellCompanyCount: 150,  nomineeDirectorsAllowed: false, bearerSharesAllowed: false, publicRegistryExists: true  },
  { jurisdiction: 'Bahamas',           iso2: 'BS', region: 'Caribbean',    opacityScore: 78, shellCompanyCount: 90,   nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: false },
  { jurisdiction: 'Netherlands',       iso2: 'NL', region: 'Europe',       opacityScore: 48, shellCompanyCount: 120,  nomineeDirectorsAllowed: true,  bearerSharesAllowed: false, publicRegistryExists: true  },
];

export const FATF_JURISDICTIONS: readonly FatfJurisdiction[] = [
  { jurisdiction: 'North Korea',    iso2: 'KP', status: 'black',     lastReview: 2024, deficiencies: ['AML controls', 'CFT framework', 'International cooperation'], complianceScore: 5  },
  { jurisdiction: 'Iran',           iso2: 'IR', status: 'black',     lastReview: 2024, deficiencies: ['Terrorist financing', 'Proliferation finance', 'AML'], complianceScore: 8  },
  { jurisdiction: 'Myanmar',        iso2: 'MM', status: 'black',     lastReview: 2024, deficiencies: ['Financial intelligence', 'Supervision', 'Investigations'], complianceScore: 12 },
  { jurisdiction: 'UAE',            iso2: 'AE', status: 'monitored', lastReview: 2024, deficiencies: ['Real estate oversight', 'Crypto regulation'], complianceScore: 58 },
  { jurisdiction: 'Nigeria',        iso2: 'NG', status: 'grey',      lastReview: 2023, deficiencies: ['Asset recovery', 'Prosecution rates'], complianceScore: 38 },
  { jurisdiction: 'Philippines',    iso2: 'PH', status: 'grey',      lastReview: 2023, deficiencies: ['Casino sector', 'Virtual asset oversight'], complianceScore: 45 },
  { jurisdiction: 'South Africa',   iso2: 'ZA', status: 'grey',      lastReview: 2023, deficiencies: ['Prosecution', 'Supervisory capacity'], complianceScore: 42 },
  { jurisdiction: 'Vietnam',        iso2: 'VN', status: 'grey',      lastReview: 2024, deficiencies: ['Beneficial ownership', 'DNFBPs'], complianceScore: 40 },
  { jurisdiction: 'Kenya',          iso2: 'KE', status: 'grey',      lastReview: 2024, deficiencies: ['Real estate', 'Precious metals'], complianceScore: 44 },
  { jurisdiction: 'Senegal',        iso2: 'SN', status: 'grey',      lastReview: 2023, deficiencies: ['Supervision', 'Targeted sanctions'], complianceScore: 41 },
  { jurisdiction: 'United Kingdom', iso2: 'GB', status: 'compliant', lastReview: 2023, deficiencies: [], complianceScore: 88 },
  { jurisdiction: 'Germany',        iso2: 'DE', status: 'compliant', lastReview: 2022, deficiencies: [], complianceScore: 85 },
  { jurisdiction: 'France',         iso2: 'FR', status: 'compliant', lastReview: 2022, deficiencies: [], complianceScore: 86 },
  { jurisdiction: 'Singapore',      iso2: 'SG', status: 'compliant', lastReview: 2023, deficiencies: [], complianceScore: 91 },
  { jurisdiction: 'Cayman Islands', iso2: 'KY', status: 'monitored', lastReview: 2024, deficiencies: ['VASP oversight', 'PEP controls'], complianceScore: 55 },
];

export const REGULATORY_GAPS: readonly RegulatoryGap[] = [
  { jurisdiction: 'El Salvador',    iso2: 'SV', domain: 'crypto',               severity: 'critical',    description: 'Bitcoin legal tender with minimal AML oversight',            identifiedYear: 2021, closurePressure: true  },
  { jurisdiction: 'Cayman Islands', iso2: 'KY', domain: 'tax',                  severity: 'critical',    description: 'Zero corporate tax, no CRS enforcement for trusts',          identifiedYear: 2000, closurePressure: true  },
  { jurisdiction: 'Panama',         iso2: 'PA', domain: 'beneficial-ownership',  severity: 'significant', description: 'Nominal beneficial ownership registry, enforcement gaps',      identifiedYear: 2016, closurePressure: true  },
  { jurisdiction: 'Seychelles',     iso2: 'SC', domain: 'beneficial-ownership',  severity: 'significant', description: 'Bearer shares abolished but nominee regime persists',         identifiedYear: 2013, closurePressure: false },
  { jurisdiction: 'Malta',          iso2: 'MT', domain: 'crypto',               severity: 'moderate',    description: 'Crypto hub status exploited for exchange-hopping',            identifiedYear: 2018, closurePressure: false },
  { jurisdiction: 'UAE',            iso2: 'AE', domain: 'financial-regulation', severity: 'significant', description: 'Free zone financial entities evade onshore supervision',       identifiedYear: 2015, closurePressure: true  },
  { jurisdiction: 'Ireland',        iso2: 'IE', domain: 'tax',                  severity: 'moderate',    description: 'Holding company structures allow IP profit shifting',         identifiedYear: 2013, closurePressure: true  },
  { jurisdiction: 'Russia',         iso2: 'RU', domain: 'data-sovereignty',     severity: 'critical',    description: 'Data localisation weaponised for surveillance arbitrage',     identifiedYear: 2019, closurePressure: false },
  { jurisdiction: 'China',          iso2: 'CN', domain: 'data-sovereignty',     severity: 'critical',    description: 'PIPL exploits cross-border data transfer asymmetry',          identifiedYear: 2021, closurePressure: false },
  { jurisdiction: 'Delaware (US)',   iso2: 'US', domain: 'beneficial-ownership', severity: 'significant', description: 'Pre-CTA LLC anonymity; enforcement lagging',                  identifiedYear: 1990, closurePressure: true  },
  { jurisdiction: 'Switzerland',    iso2: 'CH', domain: 'financial-regulation', severity: 'minor',       description: 'Residual banking secrecy for non-CRS jurisdictions',          identifiedYear: 2009, closurePressure: false },
  { jurisdiction: 'Vanuatu',        iso2: 'VU', domain: 'tax',                  severity: 'significant', description: 'Citizenship-by-investment combined with zero income tax',     identifiedYear: 2015, closurePressure: false },
  { jurisdiction: 'Cambodia',       iso2: 'KH', domain: 'crypto',               severity: 'critical',    description: 'Unregulated crypto casinos used for money laundering',        identifiedYear: 2020, closurePressure: true  },
];

export const ARBITRAGE_EXPOSURE: readonly ArbitrageExposure[] = [
  { jurisdiction: 'Cayman Islands',    iso2: 'KY', taxDifferentialPct: 25, cryptoGapScore: 60, dataGapScore: 30, financeGapScore: 55, illicitFlowsUsdBn: 42  },
  { jurisdiction: 'British Virgin Is', iso2: 'VG', taxDifferentialPct: 25, cryptoGapScore: 55, dataGapScore: 28, financeGapScore: 70, illicitFlowsUsdBn: 38  },
  { jurisdiction: 'Panama',            iso2: 'PA', taxDifferentialPct: 18, cryptoGapScore: 45, dataGapScore: 35, financeGapScore: 65, illicitFlowsUsdBn: 25  },
  { jurisdiction: 'UAE',               iso2: 'AE', taxDifferentialPct: 15, cryptoGapScore: 50, dataGapScore: 40, financeGapScore: 60, illicitFlowsUsdBn: 30  },
  { jurisdiction: 'El Salvador',       iso2: 'SV', taxDifferentialPct: 12, cryptoGapScore: 90, dataGapScore: 20, financeGapScore: 45, illicitFlowsUsdBn: 8   },
  { jurisdiction: 'Malta',             iso2: 'MT', taxDifferentialPct: 10, cryptoGapScore: 70, dataGapScore: 35, financeGapScore: 40, illicitFlowsUsdBn: 6   },
  { jurisdiction: 'Singapore',         iso2: 'SG', taxDifferentialPct: 8,  cryptoGapScore: 25, dataGapScore: 30, financeGapScore: 20, illicitFlowsUsdBn: 12  },
  { jurisdiction: 'Luxembourg',        iso2: 'LU', taxDifferentialPct: 6,  cryptoGapScore: 20, dataGapScore: 25, financeGapScore: 35, illicitFlowsUsdBn: 15  },
  { jurisdiction: 'Seychelles',        iso2: 'SC', taxDifferentialPct: 22, cryptoGapScore: 65, dataGapScore: 20, financeGapScore: 75, illicitFlowsUsdBn: 18  },
  { jurisdiction: 'Cambodia',          iso2: 'KH', taxDifferentialPct: 14, cryptoGapScore: 88, dataGapScore: 18, financeGapScore: 55, illicitFlowsUsdBn: 9   },
];

export const ENFORCEMENT_REGIONS: readonly EnforcementRegion[] = [
  { region: 'North America', actionsLastYear: 142, actionsThisYear: 178, penaltiesUsdM: 4200, trend: 'increasing', activeBodies: ['FinCEN', 'DOJ', 'SEC', 'OFAC']              },
  { region: 'Europe',        actionsLastYear: 98,  actionsThisYear: 124, penaltiesUsdM: 2800, trend: 'increasing', activeBodies: ['EBA', 'BaFin', 'FCA', 'AMF']               },
  { region: 'Asia-Pacific',  actionsLastYear: 55,  actionsThisYear: 89,  penaltiesUsdM: 1100, trend: 'surge',      activeBodies: ['MAS', 'JFSA', 'ASIC', 'HKMA']             },
  { region: 'Middle East',   actionsLastYear: 18,  actionsThisYear: 14,  penaltiesUsdM: 220,  trend: 'decreasing', activeBodies: ['CBUAE', 'SAMA']                            },
  { region: 'Caribbean',     actionsLastYear: 12,  actionsThisYear: 13,  penaltiesUsdM: 85,   trend: 'stable',     activeBodies: ['CFATF', 'Local FSCs']                      },
  { region: 'Latin America', actionsLastYear: 28,  actionsThisYear: 34,  penaltiesUsdM: 310,  trend: 'increasing', activeBodies: ['GAFILAT', 'Local FIUs']                    },
  { region: 'Africa',        actionsLastYear: 22,  actionsThisYear: 19,  penaltiesUsdM: 95,   trend: 'decreasing', activeBodies: ['ESAAMLG', 'GIABA']                         },
];

// ── Render-data builders ──────────────────────────────────────────────────

export interface PanelSummary {
  extremeOpacityCount: number;
  fatfHighRiskCount: number;
  criticalGapCount: number;
  totalIllicitFlowsBn: number;
  totalPenaltiesM: number;
  overallArbitrageRisk: ArbitrageRisk;
}

export function buildPanelSummary(
  opacityRows: readonly JurisdictionOpacity[],
  fatfRows:    readonly FatfJurisdiction[],
  gapRows:     readonly RegulatoryGap[],
  exposureRows: readonly ArbitrageExposure[],
  enforcementRows: readonly EnforcementRegion[],
): PanelSummary {
  const extremeOpacityCount = countExtremeOpacityJurisdictions(opacityRows);
  const fatfHighRiskCount   = highRiskFatfJurisdictions(fatfRows).length;
  const criticalGapCount    = countCriticalGaps(gapRows);
  const illicitBn           = totalIllicitFlowsUsdBn(exposureRows);
  const penaltiesM          = totalPenaltiesUsdM(enforcementRows);

  // Composite risk: weight opacity + fatf + gaps equally
  const opacityFraction = Math.min(1, extremeOpacityCount / 5);
  const fatfFraction    = Math.min(1, fatfHighRiskCount / 8);
  const gapFraction     = Math.min(1, criticalGapCount / 6);
  const compositeScore  = Math.round((opacityFraction + fatfFraction + gapFraction) / 3 * 100);

  return {
    extremeOpacityCount,
    fatfHighRiskCount,
    criticalGapCount,
    totalIllicitFlowsBn: illicitBn,
    totalPenaltiesM: penaltiesM,
    overallArbitrageRisk: classifyArbitrageRisk(compositeScore),
  };
}
