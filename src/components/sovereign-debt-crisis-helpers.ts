/**
 * sovereign-debt-crisis-helpers.ts
 *
 * Pure, deterministic helpers for the SovereignDebtCrisisPanel.
 * No DOM, no fetch, no globals — input/output pure.
 *
 * Tracks: IMF debt-sustainability tiers, default probability,
 * credit-rating trends, creditor composition, and systemic risk.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type DistressTier = 'in-default' | 'high-distress' | 'elevated' | 'moderate' | 'low';

export type ImfProgramStatus =
  | 'active_ecf'
  | 'active_eff'
  | 'active_sba'
  | 'precautionary'
  | 'negotiations'
  | 'completed'
  | 'none';

export type RatingAgency = 'moodys' | 'sp' | 'fitch';

export type RatingTrend = 'downgrade' | 'stable' | 'upgrade' | 'no_data';

export type CreditorType = 'china' | 'paris_club' | 'bondholders' | 'multilateral' | 'commercial';

export interface CreditRating {
  agency: RatingAgency;
  rating: string;
  outlook: 'positive' | 'stable' | 'negative' | 'watch_negative' | 'default';
  updatedAt: string; // ISO date string
}

export interface CreditorShare {
  type: CreditorType;
  sharePct: number; // 0-100
}

export interface CountryDebtData {
  code: string; // ISO-3166 alpha-3
  name: string;
  debtToGdpPct: number;
  debtServiceToRevenuePct: number;
  externalDebtToGdpPct: number;
  hasDefaultHistory: boolean;
  imfProgramStatus: ImfProgramStatus;
  ratings: CreditRating[];
  creditors: CreditorShare[];
  reservesCoverMonths: number; // import cover in months
  currentAccountBalancePct: number; // % of GDP, negative = deficit
  notes: string;
}

export interface DebtRatioAssessment {
  debtToGdpSeverity: 'low' | 'moderate' | 'high' | 'critical';
  debtServiceSeverity: 'low' | 'moderate' | 'high' | 'critical';
  overallSeverity: 'low' | 'moderate' | 'high' | 'critical';
  summary: string;
}

export interface CountryRenderData {
  code: string;
  name: string;
  tier: DistressTier;
  tierColor: string;
  tierLabel: string;
  defaultProbability: number;
  defaultProbabilityLabel: string;
  imfStatusLabel: string;
  imfStatusColor: string;
  debtToGdpPct: number;
  debtServiceToRevenuePct: number;
  externalDebtToGdpPct: number;
  ratingTrend: RatingTrend;
  ratingTrendLabel: string;
  creditorSummary: string;
  topCreditor: CreditorType | null;
  reservesCoverMonths: number;
  ratioAssessment: DebtRatioAssessment;
  notes: string;
}

export interface PanelSummary {
  totalCountries: number;
  inDefault: number;
  highDistress: number;
  elevated: number;
  moderate: number;
  low: number;
  systemicRiskScore: number;
  systemicRiskLabel: string;
  activeImfPrograms: number;
}

// ── Mock data ──────────────────────────────────────────────────────────────

export const MOCK_COUNTRIES: CountryDebtData[] = [
  {
    code: 'ARG',
    name: 'Argentina',
    debtToGdpPct: 89,
    debtServiceToRevenuePct: 62,
    externalDebtToGdpPct: 47,
    hasDefaultHistory: true,
    imfProgramStatus: 'active_eff',
    ratings: [
      { agency: 'moodys', rating: 'Ca', outlook: 'negative', updatedAt: '2025-11-01' },
      { agency: 'sp', rating: 'CCC', outlook: 'watch_negative', updatedAt: '2025-10-15' },
      { agency: 'fitch', rating: 'CC', outlook: 'negative', updatedAt: '2025-11-10' },
    ],
    creditors: [
      { type: 'bondholders', sharePct: 42 },
      { type: 'multilateral', sharePct: 35 },
      { type: 'paris_club', sharePct: 12 },
      { type: 'commercial', sharePct: 11 },
    ],
    reservesCoverMonths: 4.1,
    currentAccountBalancePct: -3.2,
    notes: 'Fourth restructuring since 2001; IMF EFF program ongoing. Peso devaluation pressures.',
  },
  {
    code: 'LBN',
    name: 'Lebanon',
    debtToGdpPct: 283,
    debtServiceToRevenuePct: 95,
    externalDebtToGdpPct: 180,
    hasDefaultHistory: true,
    imfProgramStatus: 'negotiations',
    ratings: [
      { agency: 'moodys', rating: 'C', outlook: 'default', updatedAt: '2025-09-01' },
      { agency: 'sp', rating: 'SD', outlook: 'default', updatedAt: '2025-09-01' },
      { agency: 'fitch', rating: 'RD', outlook: 'default', updatedAt: '2025-09-01' },
    ],
    creditors: [
      { type: 'bondholders', sharePct: 55 },
      { type: 'commercial', sharePct: 25 },
      { type: 'multilateral', sharePct: 20 },
    ],
    reservesCoverMonths: 0.9,
    currentAccountBalancePct: -26.4,
    notes: 'Defaulted March 2020. IMF staff-level agreement repeatedly delayed by political deadlock.',
  },
  {
    code: 'SRL',
    name: 'Sri Lanka',
    debtToGdpPct: 128,
    debtServiceToRevenuePct: 78,
    externalDebtToGdpPct: 62,
    hasDefaultHistory: true,
    imfProgramStatus: 'active_ecf',
    ratings: [
      { agency: 'moodys', rating: 'Caa3', outlook: 'stable', updatedAt: '2025-08-01' },
      { agency: 'sp', rating: 'CCC+', outlook: 'stable', updatedAt: '2025-07-15' },
      { agency: 'fitch', rating: 'CCC', outlook: 'stable', updatedAt: '2025-08-10' },
    ],
    creditors: [
      { type: 'bondholders', sharePct: 38 },
      { type: 'china', sharePct: 28 },
      { type: 'multilateral', sharePct: 22 },
      { type: 'paris_club', sharePct: 12 },
    ],
    reservesCoverMonths: 2.8,
    currentAccountBalancePct: -1.8,
    notes: 'Defaulted April 2022. Restructuring nearing completion. IMF ECF program active.',
  },
  {
    code: 'ZMB',
    name: 'Zambia',
    debtToGdpPct: 141,
    debtServiceToRevenuePct: 52,
    externalDebtToGdpPct: 93,
    hasDefaultHistory: true,
    imfProgramStatus: 'active_ecf',
    ratings: [
      { agency: 'moodys', rating: 'Caa2', outlook: 'stable', updatedAt: '2025-06-01' },
      { agency: 'sp', rating: 'CCC+', outlook: 'positive', updatedAt: '2025-09-01' },
    ],
    creditors: [
      { type: 'china', sharePct: 42 },
      { type: 'bondholders', sharePct: 30 },
      { type: 'multilateral', sharePct: 18 },
      { type: 'paris_club', sharePct: 10 },
    ],
    reservesCoverMonths: 3.2,
    currentAccountBalancePct: 0.5,
    notes: 'First sub-Saharan default Nov 2020. Debt restructuring agreed 2023 under G20 Common Framework.',
  },
  {
    code: 'GHA',
    name: 'Ghana',
    debtToGdpPct: 98,
    debtServiceToRevenuePct: 70,
    externalDebtToGdpPct: 55,
    hasDefaultHistory: true,
    imfProgramStatus: 'active_ecf',
    ratings: [
      { agency: 'moodys', rating: 'Caa2', outlook: 'stable', updatedAt: '2025-07-01' },
      { agency: 'sp', rating: 'CCC', outlook: 'stable', updatedAt: '2025-06-15' },
      { agency: 'fitch', rating: 'CCC', outlook: 'stable', updatedAt: '2025-07-01' },
    ],
    creditors: [
      { type: 'bondholders', sharePct: 48 },
      { type: 'multilateral', sharePct: 25 },
      { type: 'china', sharePct: 15 },
      { type: 'paris_club', sharePct: 12 },
    ],
    reservesCoverMonths: 3.6,
    currentAccountBalancePct: -2.1,
    notes: 'Defaulted Dec 2022. Domestic debt exchange completed 2023; external restructuring in progress.',
  },
  {
    code: 'PAK',
    name: 'Pakistan',
    debtToGdpPct: 78,
    debtServiceToRevenuePct: 54,
    externalDebtToGdpPct: 30,
    hasDefaultHistory: false,
    imfProgramStatus: 'active_sba',
    ratings: [
      { agency: 'moodys', rating: 'Caa3', outlook: 'stable', updatedAt: '2025-10-01' },
      { agency: 'sp', rating: 'CCC+', outlook: 'stable', updatedAt: '2025-09-20' },
      { agency: 'fitch', rating: 'CCC+', outlook: 'stable', updatedAt: '2025-10-05' },
    ],
    creditors: [
      { type: 'china', sharePct: 35 },
      { type: 'multilateral', sharePct: 30 },
      { type: 'paris_club', sharePct: 20 },
      { type: 'bondholders', sharePct: 15 },
    ],
    reservesCoverMonths: 2.1,
    currentAccountBalancePct: -1.5,
    notes: '25th IMF program. Forex reserves critically low. CPEC debt rollover critical in 2026.',
  },
  {
    code: 'EGY',
    name: 'Egypt',
    debtToGdpPct: 95,
    debtServiceToRevenuePct: 48,
    externalDebtToGdpPct: 38,
    hasDefaultHistory: false,
    imfProgramStatus: 'active_eff',
    ratings: [
      { agency: 'moodys', rating: 'B3', outlook: 'negative', updatedAt: '2025-09-01' },
      { agency: 'sp', rating: 'B-', outlook: 'negative', updatedAt: '2025-08-15' },
      { agency: 'fitch', rating: 'B-', outlook: 'negative', updatedAt: '2025-09-10' },
    ],
    creditors: [
      { type: 'multilateral', sharePct: 35 },
      { type: 'bondholders', sharePct: 32 },
      { type: 'paris_club', sharePct: 20 },
      { type: 'china', sharePct: 13 },
    ],
    reservesCoverMonths: 5.4,
    currentAccountBalancePct: -3.8,
    notes: 'IMF $8B EFF program 2024. Large subsidy bill and military spending constrain fiscal space.',
  },
  {
    code: 'ETH',
    name: 'Ethiopia',
    debtToGdpPct: 56,
    debtServiceToRevenuePct: 42,
    externalDebtToGdpPct: 28,
    hasDefaultHistory: true,
    imfProgramStatus: 'active_ecf',
    ratings: [
      { agency: 'moodys', rating: 'Caa3', outlook: 'stable', updatedAt: '2025-05-01' },
    ],
    creditors: [
      { type: 'china', sharePct: 47 },
      { type: 'multilateral', sharePct: 30 },
      { type: 'paris_club', sharePct: 15 },
      { type: 'bondholders', sharePct: 8 },
    ],
    reservesCoverMonths: 1.8,
    currentAccountBalancePct: -4.5,
    notes: 'Defaulted Dec 2023. G20 Common Framework talks ongoing; China bilateral terms critical.',
  },
  {
    code: 'KEN',
    name: 'Kenya',
    debtToGdpPct: 72,
    debtServiceToRevenuePct: 39,
    externalDebtToGdpPct: 35,
    hasDefaultHistory: false,
    imfProgramStatus: 'precautionary',
    ratings: [
      { agency: 'moodys', rating: 'B3', outlook: 'stable', updatedAt: '2025-06-01' },
      { agency: 'sp', rating: 'B', outlook: 'stable', updatedAt: '2025-05-15' },
    ],
    creditors: [
      { type: 'bondholders', sharePct: 38 },
      { type: 'multilateral', sharePct: 32 },
      { type: 'china', sharePct: 20 },
      { type: 'paris_club', sharePct: 10 },
    ],
    reservesCoverMonths: 4.5,
    currentAccountBalancePct: -4.2,
    notes: '2024 eurobond refinanced; near-default averted. IMF precautionary SBA in place.',
  },
  {
    code: 'BRA',
    name: 'Brazil',
    debtToGdpPct: 88,
    debtServiceToRevenuePct: 35,
    externalDebtToGdpPct: 22,
    hasDefaultHistory: false,
    imfProgramStatus: 'none',
    ratings: [
      { agency: 'moodys', rating: 'Ba1', outlook: 'stable', updatedAt: '2025-07-01' },
      { agency: 'sp', rating: 'BB', outlook: 'stable', updatedAt: '2025-06-15' },
      { agency: 'fitch', rating: 'BB', outlook: 'stable', updatedAt: '2025-07-05' },
    ],
    creditors: [
      { type: 'bondholders', sharePct: 55 },
      { type: 'multilateral', sharePct: 25 },
      { type: 'commercial', sharePct: 20 },
    ],
    reservesCoverMonths: 14.2,
    currentAccountBalancePct: -1.4,
    notes: 'Elevated domestic debt; large primary deficit under Lula II administration.',
  },
];

// ── Classifier functions ──────────────────────────────────────────────────

/**
 * Classify a country's debt distress tier based on IMF DSA methodology.
 */
export function classifyDistressTier(
  debtToGdp: number,
  debtServiceRatio: number,
  hasDefaultHistory: boolean,
): DistressTier {
  // In-default: extreme ratios AND default history, or debt service consuming near-all revenue
  if (debtServiceRatio >= 90 || (debtToGdp >= 200 && hasDefaultHistory)) return 'in-default';

  // High-distress: elevated ratios with default history or very high debt service
  if (
    (debtToGdp >= 120 && hasDefaultHistory) ||
    (debtServiceRatio >= 65 && hasDefaultHistory) ||
    debtServiceRatio >= 75
  ) {
    return 'high-distress';
  }

  // Elevated: meaningful stress but manageable
  if (
    debtToGdp >= 85 ||
    debtServiceRatio >= 45 ||
    (debtToGdp >= 60 && hasDefaultHistory)
  ) {
    return 'elevated';
  }

  // Moderate: below elevated thresholds
  if (debtToGdp >= 45 || debtServiceRatio >= 25) return 'moderate';

  return 'low';
}

/**
 * Estimate default probability (0–1) from country-level debt metrics.
 * Based on IMF debt sustainability analysis weighting scheme.
 */
export function estimateDefaultProbability(country: CountryDebtData): number {
  let score = 0;

  // Debt-to-GDP component (max 0.35)
  if (country.debtToGdpPct >= 200) score += 0.35;
  else if (country.debtToGdpPct >= 120) score += 0.25;
  else if (country.debtToGdpPct >= 80) score += 0.15;
  else if (country.debtToGdpPct >= 60) score += 0.08;
  else score += 0.02;

  // Debt service component (max 0.30)
  if (country.debtServiceToRevenuePct >= 90) score += 0.30;
  else if (country.debtServiceToRevenuePct >= 70) score += 0.22;
  else if (country.debtServiceToRevenuePct >= 50) score += 0.14;
  else if (country.debtServiceToRevenuePct >= 35) score += 0.08;
  else score += 0.02;

  // Reserves cover component (max 0.15)
  if (country.reservesCoverMonths < 1.5) score += 0.15;
  else if (country.reservesCoverMonths < 3) score += 0.10;
  else if (country.reservesCoverMonths < 5) score += 0.05;
  else score += 0.01;

  // Default history component (max 0.10)
  if (country.hasDefaultHistory) score += 0.10;

  // Current account deficit (max 0.05)
  if (country.currentAccountBalancePct < -5) score += 0.05;
  else if (country.currentAccountBalancePct < -3) score += 0.03;
  else if (country.currentAccountBalancePct < 0) score += 0.01;

  // IMF program status component (max 0.05)
  if (country.imfProgramStatus === 'negotiations') score += 0.05;
  else if (country.imfProgramStatus === 'none' && country.debtToGdpPct > 80) score += 0.03;

  return Math.min(1, Math.max(0, score));
}

/**
 * Assess severity of debt ratios using IMF benchmark thresholds.
 */
export function assessDebtRatios(
  debtToGdp: number,
  debtServiceToRevenue: number,
): DebtRatioAssessment {
  const debtToGdpSeverity: DebtRatioAssessment['debtToGdpSeverity'] =
    debtToGdp >= 120 ? 'critical' :
    debtToGdp >= 80  ? 'high' :
    debtToGdp >= 50  ? 'moderate' : 'low';

  const debtServiceSeverity: DebtRatioAssessment['debtServiceSeverity'] =
    debtServiceToRevenue >= 70 ? 'critical' :
    debtServiceToRevenue >= 45 ? 'high' :
    debtServiceToRevenue >= 25 ? 'moderate' : 'low';

  const severityRank = (s: string): number =>
    s === 'critical' ? 3 : s === 'high' ? 2 : s === 'moderate' ? 1 : 0;

  const overallRank = Math.max(severityRank(debtToGdpSeverity), severityRank(debtServiceSeverity));
  const overallSeverity = (['low', 'moderate', 'high', 'critical'] as const)[overallRank]!;

  const summary =
    overallSeverity === 'critical' ? 'Both debt load and service burden exceed IMF sustainability thresholds' :
    overallSeverity === 'high'     ? 'Debt ratios above IMF benchmark; refinancing risk elevated' :
    overallSeverity === 'moderate' ? 'Debt ratios within manageable range; monitoring required' :
                                     'Debt ratios well within IMF sustainability benchmarks';

  return { debtToGdpSeverity, debtServiceSeverity, overallSeverity, summary };
}

/**
 * Analyze rating trend direction from an array of credit ratings.
 * Returns 'downgrade' if any agency has negative/watch_negative outlook,
 * 'upgrade' if any has positive without offsetting negatives, 'stable' otherwise.
 */
export function analyzeRatingTrend(ratings: CreditRating[]): RatingTrend {
  if (ratings.length === 0) return 'no_data';

  let negativeCount = 0;
  let positiveCount = 0;
  let defaultCount = 0;

  for (const r of ratings) {
    if (r.outlook === 'default') defaultCount++;
    else if (r.outlook === 'negative' || r.outlook === 'watch_negative') negativeCount++;
    else if (r.outlook === 'positive') positiveCount++;
  }

  if (defaultCount > 0) return 'downgrade';
  if (negativeCount > 0) return 'downgrade';
  if (positiveCount > 0 && negativeCount === 0) return 'upgrade';
  return 'stable';
}

/**
 * Format creditor composition into a display-ready summary string.
 */
export function formatCreditorComposition(creditors: CreditorShare[]): string {
  if (creditors.length === 0) return 'No data';

  const sorted = [...creditors].sort((a, b) => b.sharePct - a.sharePct);
  const labels: Record<CreditorType, string> = {
    china: 'China',
    paris_club: 'Paris Club',
    bondholders: 'Bondholders',
    multilateral: 'Multilateral',
    commercial: 'Commercial',
  };

  return sorted
    .filter((c) => c.sharePct > 0)
    .map((c) => `${labels[c.type]} ${c.sharePct}%`)
    .join(' · ');
}

/**
 * Return the dominant (highest-share) creditor type.
 */
export function getDominantCreditor(creditors: CreditorShare[]): CreditorType | null {
  if (creditors.length === 0) return null;
  const sorted = [...creditors].sort((a, b) => b.sharePct - a.sharePct);
  return sorted[0]?.type ?? null;
}

/**
 * Build a render-ready object for a country card.
 */
export function buildCountryRenderData(country: CountryDebtData): CountryRenderData {
  const tier = classifyDistressTier(
    country.debtToGdpPct,
    country.debtServiceToRevenuePct,
    country.hasDefaultHistory,
  );
  const defaultProbability = estimateDefaultProbability(country);
  const ratingTrend = analyzeRatingTrend(country.ratings);
  const ratioAssessment = assessDebtRatios(
    country.debtToGdpPct,
    country.debtServiceToRevenuePct,
  );

  return {
    code: country.code,
    name: country.name,
    tier,
    tierColor: getDistressTierColor(tier),
    tierLabel: getDistressTierLabel(tier),
    defaultProbability,
    defaultProbabilityLabel: formatDefaultProbability(defaultProbability),
    imfStatusLabel: getImfStatusLabel(country.imfProgramStatus),
    imfStatusColor: getImfStatusColor(country.imfProgramStatus),
    debtToGdpPct: country.debtToGdpPct,
    debtServiceToRevenuePct: country.debtServiceToRevenuePct,
    externalDebtToGdpPct: country.externalDebtToGdpPct,
    ratingTrend,
    ratingTrendLabel: getRatingTrendLabel(ratingTrend),
    creditorSummary: formatCreditorComposition(country.creditors),
    topCreditor: getDominantCreditor(country.creditors),
    reservesCoverMonths: country.reservesCoverMonths,
    ratioAssessment,
    notes: country.notes,
  };
}

/**
 * Build summary statistics for all countries.
 */
export function buildPanelSummary(countries: CountryDebtData[]): PanelSummary {
  const renderData = countries.map(buildCountryRenderData);

  const counts = {
    inDefault: 0,
    highDistress: 0,
    elevated: 0,
    moderate: 0,
    low: 0,
  };

  for (const d of renderData) {
    if (d.tier === 'in-default') counts.inDefault++;
    else if (d.tier === 'high-distress') counts.highDistress++;
    else if (d.tier === 'elevated') counts.elevated++;
    else if (d.tier === 'moderate') counts.moderate++;
    else counts.low++;
  }

  const activeImfPrograms = countries.filter((c) =>
    c.imfProgramStatus !== 'none' && c.imfProgramStatus !== 'completed',
  ).length;

  return {
    totalCountries: countries.length,
    ...counts,
    systemicRiskScore: computeSystemicRiskScore(countries),
    systemicRiskLabel: getSystemicRiskLabel(computeSystemicRiskScore(countries)),
    activeImfPrograms,
  };
}

// ── Color and label helpers ───────────────────────────────────────────────

export function getDistressTierColor(tier: DistressTier): string {
  switch (tier) {
    case 'in-default':  return '#ef4444';
    case 'high-distress': return '#f97316';
    case 'elevated':    return '#eab308';
    case 'moderate':    return '#3b82f6';
    case 'low':         return '#22c55e';
  }
}

export function getDistressTierLabel(tier: DistressTier): string {
  switch (tier) {
    case 'in-default':  return 'In Default';
    case 'high-distress': return 'High Distress';
    case 'elevated':    return 'Elevated';
    case 'moderate':    return 'Moderate';
    case 'low':         return 'Low';
  }
}

export function getImfStatusLabel(status: ImfProgramStatus): string {
  switch (status) {
    case 'active_ecf':      return 'IMF ECF Active';
    case 'active_eff':      return 'IMF EFF Active';
    case 'active_sba':      return 'IMF SBA Active';
    case 'precautionary':   return 'Precautionary SBA';
    case 'negotiations':    return 'IMF Negotiations';
    case 'completed':       return 'Program Completed';
    case 'none':            return 'No IMF Program';
  }
}

export function getImfStatusColor(status: ImfProgramStatus): string {
  switch (status) {
    case 'active_ecf':
    case 'active_eff':
    case 'active_sba':    return '#22c55e';
    case 'precautionary': return '#3b82f6';
    case 'negotiations':  return '#eab308';
    case 'completed':     return '#6b7280';
    case 'none':          return '#9ca3af';
  }
}

export function getRatingTrendLabel(trend: RatingTrend): string {
  switch (trend) {
    case 'downgrade': return 'Downgrade Trend';
    case 'stable':    return 'Stable';
    case 'upgrade':   return 'Upgrade Trend';
    case 'no_data':   return 'No Rating Data';
  }
}

export function getRatingTrendColor(trend: RatingTrend): string {
  switch (trend) {
    case 'downgrade': return '#ef4444';
    case 'stable':    return '#6b7280';
    case 'upgrade':   return '#22c55e';
    case 'no_data':   return '#9ca3af';
  }
}

export function getCreditorTypeLabel(type: CreditorType): string {
  switch (type) {
    case 'china':       return 'China';
    case 'paris_club':  return 'Paris Club';
    case 'bondholders': return 'Bondholders';
    case 'multilateral': return 'Multilateral';
    case 'commercial':  return 'Commercial Banks';
  }
}

export function formatDefaultProbability(prob: number): string {
  const pct = Math.round(prob * 100);
  if (pct >= 70) return `${pct}% — Very High`;
  if (pct >= 45) return `${pct}% — High`;
  if (pct >= 25) return `${pct}% — Moderate`;
  if (pct >= 10) return `${pct}% — Low`;
  return `${pct}% — Very Low`;
}

// ── Systemic risk ─────────────────────────────────────────────────────────

/**
 * Compute a 0–100 systemic risk score from the full country set.
 * Weights: in-default × 20, high-distress × 10, elevated × 4, moderate × 1.
 * Capped at 100 and normalized for country count.
 */
export function computeSystemicRiskScore(countries: CountryDebtData[]): number {
  if (countries.length === 0) return 0;

  let rawScore = 0;
  for (const c of countries) {
    const tier = classifyDistressTier(
      c.debtToGdpPct,
      c.debtServiceToRevenuePct,
      c.hasDefaultHistory,
    );
    if (tier === 'in-default')   rawScore += 20;
    else if (tier === 'high-distress') rawScore += 10;
    else if (tier === 'elevated') rawScore += 4;
    else if (tier === 'moderate') rawScore += 1;
  }

  // Normalize: assume a fully-stressed 10-country set would score ~100
  const normalized = (rawScore / Math.max(countries.length, 1)) * (10 / 2);
  return Math.min(100, Math.round(normalized));
}

export function getSystemicRiskLabel(score: number): string {
  if (score >= 80) return 'Systemic Crisis';
  if (score >= 60) return 'High Systemic Risk';
  if (score >= 40) return 'Elevated Risk';
  if (score >= 20) return 'Moderate Risk';
  return 'Low Risk';
}

export function getSystemicRiskColor(score: number): string {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f97316';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#3b82f6';
  return '#22c55e';
}

// ── Sort helpers ──────────────────────────────────────────────────────────

const TIER_RANK: Record<DistressTier, number> = {
  'in-default':   0,
  'high-distress': 1,
  'elevated':     2,
  'moderate':     3,
  'low':          4,
};

export function sortByDistressTierDesc(
  a: CountryRenderData,
  b: CountryRenderData,
): number {
  const rankDiff = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (rankDiff !== 0) return rankDiff;
  return b.defaultProbability - a.defaultProbability;
}

export function sortByDefaultProbabilityDesc(
  a: CountryRenderData,
  b: CountryRenderData,
): number {
  return b.defaultProbability - a.defaultProbability;
}

// ── Render section helpers ─────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCountryCard(country: CountryRenderData): string {
  const tierBorderColor = country.tierColor;
  return `<div
    data-country-card="${esc(country.code)}"
    style="border-left:3px solid ${tierBorderColor};padding:10px 12px;margin-bottom:8px;background:var(--bg-elevated,rgba(255,255,255,0.03));border-radius:0 4px 4px 0;"
  >
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <span style="font-weight:700;font-size:13px;">${esc(country.name)}</span>
      <span style="font-size:10px;font-weight:700;color:${tierBorderColor};text-transform:uppercase;letter-spacing:0.06em;padding:1px 5px;border:1px solid ${tierBorderColor};border-radius:2px;">${esc(country.tierLabel)}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;margin-bottom:6px;">
      <div>
        <span style="color:var(--text-secondary,#888);">Debt/GDP</span><br>
        <strong>${country.debtToGdpPct}%</strong>
      </div>
      <div>
        <span style="color:var(--text-secondary,#888);">Debt Svc/Rev</span><br>
        <strong>${country.debtServiceToRevenuePct}%</strong>
      </div>
      <div>
        <span style="color:var(--text-secondary,#888);">Default Prob</span><br>
        <strong style="color:${tierBorderColor};">${Math.round(country.defaultProbability * 100)}%</strong>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px;margin-bottom:4px;">
      <span style="color:${country.imfStatusColor};padding:1px 4px;border:1px solid ${country.imfStatusColor};border-radius:2px;">${esc(country.imfStatusLabel)}</span>
      <span style="color:${getRatingTrendColor(country.ratingTrend)};">${esc(country.ratingTrendLabel)}</span>
    </div>
    <div style="font-size:10px;color:var(--text-secondary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(country.creditorSummary)}">
      ${esc(country.creditorSummary)}
    </div>
  </div>`;
}

export function renderSummaryHeader(summary: PanelSummary): string {
  const riskColor = getSystemicRiskColor(summary.systemicRiskScore);
  return `<div data-section="debt-summary" style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:11px;">
    <span style="font-weight:700;color:${riskColor};">Systemic Risk: ${summary.systemicRiskScore}/100 — ${esc(summary.systemicRiskLabel)}</span>
    <span style="color:#ef4444;">${summary.inDefault} in default</span>
    <span style="color:#f97316;">${summary.highDistress} high distress</span>
    <span style="color:#eab308;">${summary.elevated} elevated</span>
    <span style="color:var(--text-secondary,#888);">${summary.activeImfPrograms} IMF programs active</span>
  </div>`;
}
