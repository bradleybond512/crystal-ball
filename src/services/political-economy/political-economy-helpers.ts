/**
 * Political Economy Helpers — pure deterministic scoring functions.
 * No DOM, no fetch, no globals. All logic is input-output pure.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type BackslidingTrend = 'improving' | 'stable' | 'deteriorating' | 'crisis';
export type KleptocracyRisk = 'low' | 'moderate' | 'high' | 'extreme';
export type SovereignFundOpacity = 'transparent' | 'partial' | 'opaque' | 'unknown';

export interface DemocraticBackslidingScore {
  countryCode: string;
  countryName: string;
  score: number; // 0-100, higher = more democratic
  trend: BackslidingTrend;
  trendDelta: number;
  indicators: {
    electoralIntegrity: number;
    civilLiberties: number;
    ruleOfLaw: number;
    pressFreedorm: number;
    judicialIndependence: number;
  };
  lastUpdated: number;
  confidence: number;
}

export interface StateCapacityScore {
  countryCode: string;
  countryName: string;
  overallScore: number;
  dimensions: {
    fiscalCapacity: number;
    administrativeCapacity: number;
    coerciveCapacity: number;
    legitimacy: number;
  };
  fragileStateRisk: 'stable' | 'warning' | 'alert' | 'critical';
  confidence: number;
}

export interface PoliticalStabilityIndicator {
  countryCode: string;
  countryName: string;
  stabilityScore: number;
  eliteCaptureProbability: number;
  kleptocracyRisk: KleptocracyRisk;
  corruptionPerceptionIndex: number;
  sanctionedEntities: number;
  oligarchNetworkDensity: number;
}

export interface SovereignWealthFundProfile {
  fundName: string;
  country: string;
  estimatedAumBillions: number;
  opacity: SovereignFundOpacity;
  lieqaFundScore: number; // 0-10, Linaburg-Maduell Transparency Index
  geopoliticAlignment: 'western' | 'sino-russian' | 'non-aligned' | 'unknown';
  sanctionRisk: number;
}

export interface PoliticalEconomySnapshot {
  asOf: number;
  globalBackslidingIndex: number;
  highRiskCountries: DemocraticBackslidingScore[];
  stateCapacityAlerts: StateCapacityScore[];
  stabilityIndicators: PoliticalStabilityIndicator[];
  sovereignFunds: SovereignWealthFundProfile[];
  systemConfidence: number;
  dataFreshness: 'fresh' | 'stale' | 'very_stale';
}

export interface PoliticalEconomyAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'backsliding' | 'kleptocracy' | 'state_fragility' | 'elite_capture' | 'swf_opacity';
  title: string;
  detail: string;
  affectedCountries: string[];
  timestamp: number;
}

// ── classifyBackslidingTrend ──────────────────────────────────────────────

/**
 * Classify the trend direction of a democratic backsliding score.
 * - improving: delta > 3
 * - crisis: score < 30 AND delta < 0
 * - deteriorating: delta < -3
 * - stable: otherwise
 */
export function classifyBackslidingTrend(
  currentScore: number,
  priorScore: number,
): BackslidingTrend {
  const delta = currentScore - priorScore;
  if (delta > 3) return 'improving';
  if (currentScore < 30 && delta < 0) return 'crisis';
  if (delta < -3) return 'deteriorating';
  return 'stable';
}

// ── assessKleptocracyRisk ─────────────────────────────────────────────────

/**
 * Combine CPI (Corruption Perceptions Index, 0-100 where 100=clean),
 * count of sanctioned entities, and oligarch network density (0-1)
 * into a four-tier kleptocracy risk label.
 *
 * Raw score: inverted CPI contributes 50%, sanctions 30%, density 20%.
 * 0-25 → low, 26-50 → moderate, 51-75 → high, 76-100 → extreme
 */
export function assessKleptocracyRisk(
  cpi: number,
  sanctionedEntities: number,
  oligarchDensity: number,
): KleptocracyRisk {
  // Normalize each dimension to 0-100
  const cpiInverted = Math.max(0, Math.min(100, 100 - cpi));

  // Cap sanctions contribution: 0 entities = 0, 50+ = 100
  const sanctionScore = Math.min(100, (sanctionedEntities / 50) * 100);

  // Density is already 0-1, scale to 0-100
  const densityScore = Math.max(0, Math.min(100, oligarchDensity * 100));

  const raw = cpiInverted * 0.5 + sanctionScore * 0.3 + densityScore * 0.2;

  if (raw <= 25) return 'low';
  if (raw <= 50) return 'moderate';
  if (raw <= 75) return 'high';
  return 'extreme';
}

// ── evaluateSWFOpacity ────────────────────────────────────────────────────

/**
 * Map the Linaburg-Maduell Transparency Index score (0-10) to an opacity tier.
 * 8-10 → transparent, 5-7 → partial, 1-4 → opaque, 0 → unknown
 */
export function evaluateSWFOpacity(lieqaScore: number): SovereignFundOpacity {
  if (lieqaScore >= 8) return 'transparent';
  if (lieqaScore >= 5) return 'partial';
  if (lieqaScore >= 1) return 'opaque';
  return 'unknown';
}

// ── computeGlobalBackslidingIndex ─────────────────────────────────────────

/**
 * Weighted average of democratic scores, with higher-confidence entries
 * receiving proportionally more weight. Returns 0 for empty input.
 */
export function computeGlobalBackslidingIndex(
  scores: DemocraticBackslidingScore[],
): number {
  if (scores.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of scores) {
    const weight = Math.max(0.01, s.confidence);
    weightedSum += s.score * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ── generateAlerts ────────────────────────────────────────────────────────

/**
 * Generate alerts for:
 *  - Countries with backsliding score < 30 (critical)
 *  - Countries with backsliding score < 50 (warning)
 *  - Extreme kleptocracy risk
 *  - Opaque SWFs with AUM > $50B
 */
export function generateAlerts(
  snapshot: PoliticalEconomySnapshot,
): PoliticalEconomyAlert[] {
  const alerts: PoliticalEconomyAlert[] = [];
  const now = snapshot.asOf;

  // Backsliding alerts
  for (const country of snapshot.highRiskCountries) {
    if (country.score < 30) {
      alerts.push({
        id: `backsliding-critical-${country.countryCode}`,
        severity: 'critical',
        category: 'backsliding',
        title: `Democratic Crisis: ${country.countryName}`,
        detail: `Score ${country.score.toFixed(0)}/100 — regime is in crisis territory (trend: ${country.trend}).`,
        affectedCountries: [country.countryCode],
        timestamp: now,
      });
    } else if (country.score < 50) {
      alerts.push({
        id: `backsliding-warning-${country.countryCode}`,
        severity: 'warning',
        category: 'backsliding',
        title: `Democratic Backsliding: ${country.countryName}`,
        detail: `Score ${country.score.toFixed(0)}/100 — below democratic threshold (trend: ${country.trend}).`,
        affectedCountries: [country.countryCode],
        timestamp: now,
      });
    }
  }

  // Kleptocracy alerts
  for (const indicator of snapshot.stabilityIndicators) {
    if (indicator.kleptocracyRisk === 'extreme') {
      alerts.push({
        id: `kleptocracy-extreme-${indicator.countryCode}`,
        severity: 'critical',
        category: 'kleptocracy',
        title: `Extreme Kleptocracy Risk: ${indicator.countryName}`,
        detail: `CPI ${indicator.corruptionPerceptionIndex}, ${indicator.sanctionedEntities} sanctioned entities, oligarch density ${(indicator.oligarchNetworkDensity * 100).toFixed(0)}%.`,
        affectedCountries: [indicator.countryCode],
        timestamp: now,
      });
    }
  }

  // Opaque SWF alerts
  for (const fund of snapshot.sovereignFunds) {
    if (fund.opacity === 'opaque' && fund.estimatedAumBillions > 50) {
      alerts.push({
        id: `swf-opacity-${fund.fundName.replace(/\s+/g, '-').toLowerCase()}`,
        severity: 'warning',
        category: 'swf_opacity',
        title: `Opaque Sovereign Fund: ${fund.fundName}`,
        detail: `$${fund.estimatedAumBillions.toFixed(0)}B AUM with minimal transparency (LMTI ${fund.lieqaFundScore}/10). Sanction risk: ${(fund.sanctionRisk * 100).toFixed(0)}%.`,
        affectedCountries: [fund.country],
        timestamp: now,
      });
    }
  }

  // State fragility alerts
  for (const cap of snapshot.stateCapacityAlerts) {
    if (cap.fragileStateRisk === 'critical') {
      alerts.push({
        id: `fragility-critical-${cap.countryCode}`,
        severity: 'critical',
        category: 'state_fragility',
        title: `Critical State Fragility: ${cap.countryName}`,
        detail: `Overall capacity score ${cap.overallScore.toFixed(0)}/100 — state institutions near collapse.`,
        affectedCountries: [cap.countryCode],
        timestamp: now,
      });
    }
  }

  return alerts;
}

// ── rankCountriesByRisk ───────────────────────────────────────────────────

const KLEPTOCRACY_WEIGHTS: Record<KleptocracyRisk, number> = {
  low: 0,
  moderate: 25,
  high: 50,
  extreme: 100,
};

/**
 * Rank country codes by combined political risk (inverted backsliding score +
 * kleptocracy weight). Returns sorted array, highest risk first.
 */
export function rankCountriesByRisk(
  scores: DemocraticBackslidingScore[],
  stability: PoliticalStabilityIndicator[],
): string[] {
  const stabilityMap = new Map<string, PoliticalStabilityIndicator>();
  for (const s of stability) stabilityMap.set(s.countryCode, s);

  const ranked = scores.map((s) => {
    const stab = stabilityMap.get(s.countryCode);
    const invertedScore = 100 - s.score; // higher = worse democracy
    const kleptoWeight = stab ? KLEPTOCRACY_WEIGHTS[stab.kleptocracyRisk] : 0;
    const combinedRisk = invertedScore * 0.6 + kleptoWeight * 0.4;
    return { countryCode: s.countryCode, risk: combinedRisk };
  });

  ranked.sort((a, b) => b.risk - a.risk);
  return ranked.map((r) => r.countryCode);
}

// ── computeSystemConfidence ───────────────────────────────────────────────

/**
 * Average confidence of all scores, penalized when data is stale.
 * Stale data (>24h) reduces confidence by 20%; very_stale (>72h) by 40%.
 */
export function computeSystemConfidence(
  scores: DemocraticBackslidingScore[],
): number {
  if (scores.length === 0) return 0;

  const now = Date.now();
  const avgConfidence = scores.reduce((sum, s) => sum + s.confidence, 0) / scores.length;

  // Find the oldest entry to assess staleness penalty
  const oldestUpdated = Math.min(...scores.map((s) => s.lastUpdated));
  const ageMs = now - oldestUpdated;
  const freshness = assessDataFreshness(oldestUpdated, now);

  let penalty = 1;
  if (freshness === 'stale') penalty = 0.8;
  else if (freshness === 'very_stale') penalty = 0.6;

  return Math.max(0, Math.min(1, avgConfidence * penalty));
}

// ── assessDataFreshness ───────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const FRESH_THRESHOLD_MS = 24 * HOUR_MS;
const STALE_THRESHOLD_MS = 72 * HOUR_MS;

/**
 * Determine data freshness based on age.
 * fresh: < 24h, stale: 24-72h, very_stale: > 72h
 */
export function assessDataFreshness(
  asOf: number,
  now: number,
): 'fresh' | 'stale' | 'very_stale' {
  const ageMs = now - asOf;
  if (ageMs < FRESH_THRESHOLD_MS) return 'fresh';
  if (ageMs < STALE_THRESHOLD_MS) return 'stale';
  return 'very_stale';
}

// ── buildEmptySnapshot ────────────────────────────────────────────────────

/**
 * Return a valid zero-state snapshot.
 */
export function buildEmptySnapshot(): PoliticalEconomySnapshot {
  return {
    asOf: Date.now(),
    globalBackslidingIndex: 0,
    highRiskCountries: [],
    stateCapacityAlerts: [],
    stabilityIndicators: [],
    sovereignFunds: [],
    systemConfidence: 0,
    dataFreshness: 'fresh',
  };
}

// ── mergeSnapshots ────────────────────────────────────────────────────────

/**
 * Merge a partial update into a base snapshot, recomputing derived fields.
 */
export function mergeSnapshots(
  base: PoliticalEconomySnapshot,
  update: Partial<PoliticalEconomySnapshot>,
): PoliticalEconomySnapshot {
  const merged: PoliticalEconomySnapshot = {
    ...base,
    ...update,
    asOf: update.asOf ?? Date.now(),
  };

  // Recompute derived fields from merged data
  merged.globalBackslidingIndex = computeGlobalBackslidingIndex(merged.highRiskCountries);
  merged.systemConfidence = computeSystemConfidence(merged.highRiskCountries);
  merged.dataFreshness = assessDataFreshness(merged.asOf, Date.now());

  return merged;
}
