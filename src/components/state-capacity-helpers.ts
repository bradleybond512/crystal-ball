/**
 * State Capacity Panel — pure helpers.
 *
 * No DOM, no fetch, no globals. All functions are deterministic over their
 * inputs. Unit-testable with static fixtures.
 *
 * Tracks government effectiveness, rule-of-law, institutional resilience,
 * service delivery, and overall fragility for 15 fragile/failing states.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CapacityTier = 'collapsed' | 'fragile' | 'weak' | 'moderate' | 'functional';

export interface CountryCapacityData {
  /** ISO 3166-1 alpha-3 code */
  countryCode: string;
  countryName: string;
  region: string;
  /** 0–10 */
  governmentEffectiveness: number;
  /** 0–10 */
  bureaucraticQuality: number;
  /** 0–10 */
  ruleOfLaw: number;
  /** 0–10 */
  taxCollectionCapacity: number;
  /** 0–10: state's ability to control use of force within its territory */
  monopolyOnViolence: number;
  /** 0–10 */
  serviceDelivery: number;
  /** 0–10 */
  institutionalResilience: number;
  /** Optional short note on trend direction */
  trendNote?: string;
}

export interface CountryRenderData {
  countryCode: string;
  countryName: string;
  region: string;
  tier: CapacityTier;
  tierLabel: string;
  tierColor: string;
  fragility: number;
  governanceScore: number;
  ruleOfLawScore: number;
  serviceDeliveryScore: number;
  institutionalResilienceScore: number;
  trend: 'deteriorating' | 'stable' | 'improving';
  trendNote: string;
  formattedFragility: string;
}

export interface RegionalRiskSummary {
  region: string;
  countryCount: number;
  averageFragility: number;
  collapsedCount: number;
  fragileCount: number;
  weakCount: number;
  dominantTier: CapacityTier;
}

// ── Static country data ───────────────────────────────────────────────────

export const COUNTRY_DATA: Map<string, CountryCapacityData> = new Map([
  ['SYR', {
    countryCode: 'SYR',
    countryName: 'Syria',
    region: 'Middle East',
    governmentEffectiveness: 1.2,
    bureaucraticQuality: 1.0,
    ruleOfLaw: 0.8,
    taxCollectionCapacity: 0.9,
    monopolyOnViolence: 0.5,
    serviceDelivery: 1.1,
    institutionalResilience: 0.7,
    trendNote: 'Fragmented authority; partial recovery in regime-held areas',
  }],
  ['YEM', {
    countryCode: 'YEM',
    countryName: 'Yemen',
    region: 'Middle East',
    governmentEffectiveness: 1.0,
    bureaucraticQuality: 0.9,
    ruleOfLaw: 0.7,
    taxCollectionCapacity: 0.8,
    monopolyOnViolence: 0.4,
    serviceDelivery: 0.9,
    institutionalResilience: 0.6,
    trendNote: 'Dual-government structure; Houthi control of northwest',
  }],
  ['SOM', {
    countryCode: 'SOM',
    countryName: 'Somalia',
    region: 'Sub-Saharan Africa',
    governmentEffectiveness: 1.4,
    bureaucraticQuality: 1.1,
    ruleOfLaw: 1.0,
    taxCollectionCapacity: 1.2,
    monopolyOnViolence: 0.8,
    serviceDelivery: 1.3,
    institutionalResilience: 1.1,
    trendNote: 'Federal institutions slowly consolidating',
  }],
  ['AFG', {
    countryCode: 'AFG',
    countryName: 'Afghanistan',
    region: 'South Asia',
    governmentEffectiveness: 1.3,
    bureaucraticQuality: 1.0,
    ruleOfLaw: 0.9,
    taxCollectionCapacity: 1.1,
    monopolyOnViolence: 1.5,
    serviceDelivery: 1.0,
    institutionalResilience: 0.9,
    trendNote: 'Taliban administration lacks international recognition',
  }],
  ['HTI', {
    countryCode: 'HTI',
    countryName: 'Haiti',
    region: 'Latin America',
    governmentEffectiveness: 1.6,
    bureaucraticQuality: 1.3,
    ruleOfLaw: 1.2,
    taxCollectionCapacity: 1.4,
    monopolyOnViolence: 0.9,
    serviceDelivery: 1.5,
    institutionalResilience: 1.2,
    trendNote: 'Gang control of Port-au-Prince undermining governance',
  }],
  ['CAF', {
    countryCode: 'CAF',
    countryName: 'Central African Republic',
    region: 'Sub-Saharan Africa',
    governmentEffectiveness: 1.8,
    bureaucraticQuality: 1.5,
    ruleOfLaw: 1.4,
    taxCollectionCapacity: 1.3,
    monopolyOnViolence: 1.2,
    serviceDelivery: 1.6,
    institutionalResilience: 1.5,
    trendNote: 'Wagner-backed stabilization; nominal central control',
  }],
  ['COD', {
    countryCode: 'COD',
    countryName: 'DRC',
    region: 'Sub-Saharan Africa',
    governmentEffectiveness: 2.0,
    bureaucraticQuality: 1.8,
    ruleOfLaw: 1.6,
    taxCollectionCapacity: 1.7,
    monopolyOnViolence: 1.4,
    serviceDelivery: 1.9,
    institutionalResilience: 1.8,
    trendNote: 'Eastern DRC conflict ongoing; M23 resurgence',
  }],
  ['SDN', {
    countryCode: 'SDN',
    countryName: 'Sudan',
    region: 'Sub-Saharan Africa',
    governmentEffectiveness: 1.5,
    bureaucraticQuality: 1.4,
    ruleOfLaw: 1.3,
    taxCollectionCapacity: 1.5,
    monopolyOnViolence: 1.0,
    serviceDelivery: 1.4,
    institutionalResilience: 1.1,
    trendNote: 'Civil war between SAF and RSF since April 2023',
  }],
  ['LBY', {
    countryCode: 'LBY',
    countryName: 'Libya',
    region: 'North Africa',
    governmentEffectiveness: 2.2,
    bureaucraticQuality: 2.0,
    ruleOfLaw: 1.8,
    taxCollectionCapacity: 2.5,
    monopolyOnViolence: 1.6,
    serviceDelivery: 2.1,
    institutionalResilience: 1.9,
    trendNote: 'Parallel administrations in Tripoli and east',
  }],
  ['VEN', {
    countryCode: 'VEN',
    countryName: 'Venezuela',
    region: 'Latin America',
    governmentEffectiveness: 2.5,
    bureaucraticQuality: 2.3,
    ruleOfLaw: 2.0,
    taxCollectionCapacity: 2.8,
    monopolyOnViolence: 3.0,
    serviceDelivery: 2.4,
    institutionalResilience: 2.6,
    trendNote: 'Contested legitimacy; economic recovery from hyperinflation trough',
  }],
  ['MMR', {
    countryCode: 'MMR',
    countryName: 'Myanmar',
    region: 'Southeast Asia',
    governmentEffectiveness: 2.3,
    bureaucraticQuality: 2.1,
    ruleOfLaw: 1.9,
    taxCollectionCapacity: 2.2,
    monopolyOnViolence: 1.8,
    serviceDelivery: 2.2,
    institutionalResilience: 2.0,
    trendNote: 'Military losing territorial control to resistance forces',
  }],
  ['IRQ', {
    countryCode: 'IRQ',
    countryName: 'Iraq',
    region: 'Middle East',
    governmentEffectiveness: 3.2,
    bureaucraticQuality: 3.0,
    ruleOfLaw: 2.8,
    taxCollectionCapacity: 3.5,
    monopolyOnViolence: 3.2,
    serviceDelivery: 3.1,
    institutionalResilience: 3.0,
    trendNote: 'Oil revenues sustain state but corruption is endemic',
  }],
  ['ZWE', {
    countryCode: 'ZWE',
    countryName: 'Zimbabwe',
    region: 'Sub-Saharan Africa',
    governmentEffectiveness: 2.8,
    bureaucraticQuality: 2.6,
    ruleOfLaw: 2.4,
    taxCollectionCapacity: 2.7,
    monopolyOnViolence: 3.5,
    serviceDelivery: 2.7,
    institutionalResilience: 2.8,
    trendNote: 'Formal institutions intact but repressive; economic dysfunction',
  }],
  ['PRK', {
    countryCode: 'PRK',
    countryName: 'North Korea',
    region: 'East Asia',
    governmentEffectiveness: 3.0,
    bureaucraticQuality: 2.8,
    ruleOfLaw: 2.0,
    taxCollectionCapacity: 3.2,
    monopolyOnViolence: 7.5,
    serviceDelivery: 2.5,
    institutionalResilience: 4.0,
    trendNote: 'Highly centralized; state capacity dedicated to regime survival',
  }],
  ['TCD', {
    countryCode: 'TCD',
    countryName: 'Chad',
    region: 'Sub-Saharan Africa',
    governmentEffectiveness: 2.4,
    bureaucraticQuality: 2.2,
    ruleOfLaw: 2.1,
    taxCollectionCapacity: 2.0,
    monopolyOnViolence: 2.6,
    serviceDelivery: 2.3,
    institutionalResilience: 2.2,
    trendNote: 'Transition authority after 2021 coup; Sahel security pressure',
  }],
]);

// ── Tier classification ───────────────────────────────────────────────────

/**
 * Classifies a 0–10 fragility score (higher = more fragile) into a CapacityTier.
 */
export function classifyCapacityTier(score: number): CapacityTier {
  if (score >= 8.0) return 'collapsed';
  if (score >= 6.0) return 'fragile';
  if (score >= 4.0) return 'weak';
  if (score >= 2.5) return 'moderate';
  return 'functional';
}

// ── Individual scorers ────────────────────────────────────────────────────

/** Returns a 0–10 governance effectiveness score (higher = more effective). */
export function scoreGovernanceEffectiveness(data: CountryCapacityData): number {
  const raw = (data.governmentEffectiveness + data.bureaucraticQuality) / 2;
  return Math.min(10, Math.max(0, raw));
}

/** Returns a 0–10 rule-of-law score (higher = stronger rule of law). */
export function scoreRuleOfLaw(data: CountryCapacityData): number {
  const raw = (data.ruleOfLaw * 0.6 + data.monopolyOnViolence * 0.4);
  return Math.min(10, Math.max(0, raw));
}

/** Returns a 0–10 service delivery score. */
export function scoreServiceDelivery(data: CountryCapacityData): number {
  const raw = (data.serviceDelivery * 0.7 + data.taxCollectionCapacity * 0.3);
  return Math.min(10, Math.max(0, raw));
}

/** Returns a 0–10 institutional resilience score. */
export function scoreInstitutionalResilience(data: CountryCapacityData): number {
  return Math.min(10, Math.max(0, data.institutionalResilience));
}

/**
 * Builds a fragility index (0–10, higher = more fragile) as a weighted composite.
 *
 * Raw indicator scores are inverted (10 - score) because higher raw values
 * mean MORE effective governance; fragility increases as effectiveness falls.
 *
 * Weights:
 *  - Security apparatus capacity: 25%
 *  - State legitimacy / rule of law: 25%
 *  - Public services / delivery: 20%
 *  - Governance effectiveness: 20%
 *  - Institutional resilience: 10%
 */
export function buildFragilityIndex(data: CountryCapacityData): number {
  const securityCapacity = 10 - ((data.monopolyOnViolence + data.ruleOfLaw) / 2);
  const legitimacy = 10 - ((data.ruleOfLaw + data.governmentEffectiveness) / 2);
  const services = 10 - ((data.serviceDelivery + data.taxCollectionCapacity) / 2);
  const governance = 10 - ((data.governmentEffectiveness + data.bureaucraticQuality) / 2);
  const resilience = 10 - data.institutionalResilience;

  const composite =
    securityCapacity * 0.25 +
    legitimacy * 0.25 +
    services * 0.20 +
    governance * 0.20 +
    resilience * 0.10;

  return Math.min(10, Math.max(0, composite));
}

// ── Color / label helpers ─────────────────────────────────────────────────

const TIER_COLORS: Record<CapacityTier, string> = {
  collapsed:  '#ef4444',
  fragile:    '#f97316',
  weak:       '#eab308',
  moderate:   '#3b82f6',
  functional: '#22c55e',
};

const TIER_LABELS: Record<CapacityTier, string> = {
  collapsed:  'Collapsed',
  fragile:    'Fragile',
  weak:       'Weak',
  moderate:   'Moderate',
  functional: 'Functional',
};

export function getCapacityTierColor(tier: CapacityTier): string {
  return TIER_COLORS[tier];
}

export function getCapacityTierLabel(tier: CapacityTier): string {
  return TIER_LABELS[tier];
}

// ── Trend assessment ──────────────────────────────────────────────────────

/**
 * Assesses instability trend.
 * Returns 'deteriorating' when coercive capacity markedly outpaces legitimate
 * institutions, 'improving' when the inverse holds, 'stable' otherwise.
 */
export function assessInstabilityTrend(
  data: CountryCapacityData,
): 'deteriorating' | 'stable' | 'improving' {
  const coercive = data.monopolyOnViolence;
  const legitimate = (data.ruleOfLaw + data.institutionalResilience) / 2;
  const delta = coercive - legitimate;

  if (delta > 1.5) return 'deteriorating';
  if (delta < -1.0) return 'improving';
  return 'stable';
}

// ── Format helpers ────────────────────────────────────────────────────────

/** Formats a score as "X.X/10". */
export function formatCapacityScore(score: number): string {
  return `${score.toFixed(1)}/10`;
}

// ── Render data builders ──────────────────────────────────────────────────

/**
 * Builds a fully-derived render data object for one country.
 * Returns null if the country code is not in COUNTRY_DATA.
 */
export function buildCountryRenderData(countryCode: string): CountryRenderData | null {
  const data = COUNTRY_DATA.get(countryCode);
  if (!data) return null;

  const fragility = buildFragilityIndex(data);
  const tier = classifyCapacityTier(fragility);

  return {
    countryCode: data.countryCode,
    countryName: data.countryName,
    region: data.region,
    tier,
    tierLabel: getCapacityTierLabel(tier),
    tierColor: getCapacityTierColor(tier),
    fragility,
    governanceScore: scoreGovernanceEffectiveness(data),
    ruleOfLawScore: scoreRuleOfLaw(data),
    serviceDeliveryScore: scoreServiceDelivery(data),
    institutionalResilienceScore: scoreInstitutionalResilience(data),
    trend: assessInstabilityTrend(data),
    trendNote: data.trendNote ?? '',
    formattedFragility: formatCapacityScore(fragility),
  };
}

/**
 * Returns render data for all 15 countries, sorted by fragility descending
 * (most fragile first).
 */
export function buildAllCountriesRenderData(): CountryRenderData[] {
  const results: CountryRenderData[] = [];
  for (const code of COUNTRY_DATA.keys()) {
    const rd = buildCountryRenderData(code);
    if (rd) results.push(rd);
  }
  results.sort((a, b) => b.fragility - a.fragility);
  return results;
}

/**
 * Returns the top N most fragile countries.
 */
export function getTopFragileStates(count: number): CountryRenderData[] {
  return buildAllCountriesRenderData().slice(0, count);
}

// ── Regional risk aggregation ─────────────────────────────────────────────

/**
 * Computes an aggregate risk summary for all countries in a given region.
 * Region must match the `region` field in CountryCapacityData exactly.
 */
export function computeRegionalRisk(region: string): RegionalRiskSummary {
  const all = buildAllCountriesRenderData().filter((r) => r.region === region);

  if (all.length === 0) {
    return {
      region,
      countryCount: 0,
      averageFragility: 0,
      collapsedCount: 0,
      fragileCount: 0,
      weakCount: 0,
      dominantTier: 'functional',
    };
  }

  const avgFragility = all.reduce((s, r) => s + r.fragility, 0) / all.length;
  const collapsedCount = all.filter((r) => r.tier === 'collapsed').length;
  const fragileCount = all.filter((r) => r.tier === 'fragile').length;
  const weakCount = all.filter((r) => r.tier === 'weak').length;

  const tierCounts: Record<CapacityTier, number> = {
    collapsed:  collapsedCount,
    fragile:    fragileCount,
    weak:       weakCount,
    moderate:   all.filter((r) => r.tier === 'moderate').length,
    functional: all.filter((r) => r.tier === 'functional').length,
  };

  const tierOrder: CapacityTier[] = ['collapsed', 'fragile', 'weak', 'moderate', 'functional'];
  let dominantTier: CapacityTier = 'functional';
  let dominantCount = 0;
  for (const tier of tierOrder) {
    if (tierCounts[tier] > dominantCount) {
      dominantCount = tierCounts[tier];
      dominantTier = tier;
    }
  }

  return {
    region,
    countryCount: all.length,
    averageFragility: avgFragility,
    collapsedCount,
    fragileCount,
    weakCount,
    dominantTier,
  };
}
