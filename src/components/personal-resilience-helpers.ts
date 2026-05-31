/**
 * Pure helpers backing PersonalResiliencePanel.
 *
 * Lives next to the panel so unit tests can pull these in without
 * dragging the DOM-bound Panel base class through Vite-only imports.
 *
 * The PersonalResilienceModel service is the source of truth for the
 * underlying scoring (resilience = 1 − mean(domain exposure)). These
 * helpers shape that data for display: convert resilience → risk,
 * pick the recommendation tier, build per-section view-models.
 */

import type {
  DomainExposure,
  ResilienceProfile,
  AlertHistoryEntry,
} from '@/services/intelligence/personal-resilience-model';

// ── Risk-from-resilience ────────────────────────────────────────────────────

export type RiskTier = 'none' | 'monitor' | 'review' | 'action';

/** Risk = 1 − resilience, clamped to [0, 1]. */
export function riskFromResilience(resilience: number): number {
  if (!Number.isFinite(resilience)) return 0;
  if (resilience <= 0) return 1;
  if (resilience >= 1) return 0;
  return 1 - resilience;
}

/**
 * Map a 0–1 risk score to a recommendation tier.
 *  < 0.30 → none (nothing to do)
 *  < 0.50 → monitor (passive watching)
 *  < 0.70 → review (review kit / plan)
 *  ≥ 0.70 → action (consider action plan)
 */
export function riskTier(riskScore: number): RiskTier {
  const r = clampUnit(riskScore);
  if (r < 0.3) return 'none';
  if (r < 0.5) return 'monitor';
  if (r < 0.7) return 'review';
  return 'action';
}

const TIER_LABEL: Record<RiskTier, string | null> = {
  none: null,
  monitor: 'Monitor local alerts',
  review: 'Review emergency kit',
  action: 'Consider action plan',
};

/** Top-level recommendation string for a given risk score. Null = none. */
export function recommendationForRisk(riskScore: number): string | null {
  return TIER_LABEL[riskTier(riskScore)];
}

/** Display percentage (0–100) rounded to integer. */
export function riskAsPercentage(riskScore: number): number {
  return Math.round(clampUnit(riskScore) * 100);
}

// ── Risk factor breakdown ───────────────────────────────────────────────────

export type FactorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  domain: string;
  severity: FactorSeverity;
  /** Weight share of this factor in the overall score (sums to ~1 across factors). */
  weight: number;
  /** Absolute contribution to the composite risk (weight × exposureLevel). */
  contribution: number;
  exposureLevel: number;
  alertsReceived: number;
}

const SEVERITY_THRESHOLDS: { min: number; label: FactorSeverity }[] = [
  { min: 0.85, label: 'critical' },
  { min: 0.6, label: 'high' },
  { min: 0.3, label: 'medium' },
  { min: 0, label: 'low' },
];

export function severityForExposure(exposureLevel: number): FactorSeverity {
  const e = clampUnit(exposureLevel);
  for (const t of SEVERITY_THRESHOLDS) {
    if (e >= t.min) return t.label;
  }
  return 'low';
}

/**
 * Build the "Active Risk Factors" rows from a profile. Each row reflects
 * one domain's contribution to the composite. Sorted by contribution
 * desc and capped at 5 so the section stays scannable.
 */
export function buildRiskFactors(profile: ResilienceProfile | undefined): RiskFactor[] {
  if (!profile || profile.riskExposure.length === 0) return [];
  const totalExposure = profile.riskExposure.reduce((s, e) => s + e.exposureLevel, 0);
  const denom = totalExposure > 0 ? totalExposure : 1;
  const rows = profile.riskExposure.map((e): RiskFactor => {
    const weight = e.exposureLevel / denom;
    return {
      domain: e.domain,
      severity: severityForExposure(e.exposureLevel),
      weight,
      contribution: e.exposureLevel,
      exposureLevel: e.exposureLevel,
      alertsReceived: e.alertsReceived,
    };
  });
  rows.sort((a, b) => b.contribution - a.contribution);
  return rows.slice(0, 5);
}

// ── Regional context ────────────────────────────────────────────────────────

export type RegionThreatLevel = 'calm' | 'watch' | 'elevated' | 'critical';

export interface RegionContextRow {
  region: string;
  threatLevel: RegionThreatLevel;
  inUserRegion: boolean;
  matchingAlertCount: number;
  topDomain: string | null;
}

/**
 * Build per-region context rows. Threat level rises with the number of
 * recent alerts whose `severity` clears successive thresholds; `topDomain`
 * is the highest-severity alert's domain so the user can scan "what
 * kind of thing is happening here." A region is "in user region" if it
 * appears in any of the profile's domain exposures.
 */
export function buildRegionalContext(
  profile: ResilienceProfile | undefined,
  userRegions: readonly string[],
  alertHistory: readonly AlertHistoryEntry[],
  alertRegionLookup: (entry: AlertHistoryEntry, index: number) => string | undefined = () => undefined,
): RegionContextRow[] {
  const userRegionSet = new Set(userRegions.filter((r) => typeof r === 'string' && r.length > 0));
  if (profile) {
    for (const e of profile.riskExposure) {
      for (const r of e.relevantRegions) userRegionSet.add(r);
    }
  }
  const regions = [...userRegionSet];
  const byRegion = new Map<string, { count: number; topDomain: string | null; topSev: number }>();
  alertHistory.forEach((alert, i) => {
    const region = alertRegionLookup(alert, i);
    if (!region || !userRegionSet.has(region)) return;
    const slot = byRegion.get(region) ?? { count: 0, topDomain: null, topSev: -1 };
    slot.count += 1;
    if (alert.severity > slot.topSev) {
      slot.topSev = alert.severity;
      slot.topDomain = alert.domain;
    }
    byRegion.set(region, slot);
  });
  const rows = regions.map((region): RegionContextRow => {
    const slot = byRegion.get(region) ?? { count: 0, topDomain: null, topSev: 0 };
    return {
      region,
      threatLevel: regionThreatLevel(slot.count, slot.topSev),
      inUserRegion: true,
      matchingAlertCount: slot.count,
      topDomain: slot.topDomain,
    };
  });
  const RANK: Record<RegionThreatLevel, number> = { critical: 3, elevated: 2, watch: 1, calm: 0 };
  rows.sort((a, b) => RANK[b.threatLevel] - RANK[a.threatLevel]);
  return rows;
}

function regionThreatLevel(count: number, topSeverity: number): RegionThreatLevel {
  if (topSeverity >= 0.85 || count >= 8) return 'critical';
  if (topSeverity >= 0.6 || count >= 4) return 'elevated';
  if (topSeverity >= 0.3 || count >= 1) return 'watch';
  return 'calm';
}

// ── Domain interest rows ────────────────────────────────────────────────────

export interface DomainInterestRow {
  domain: string;
  interestWeight: number;
  exposureLevel: number;
  alertsReceived: number;
  scoreContribution: number;
}

/**
 * Render the domain-interest table. `interestWeight` is the user's
 * declared importance for that domain (defaults to 1.0 each, normalized
 * across the set). `scoreContribution` is `interestWeight * exposure`
 * so the user can see how the domain shapes their score even when
 * exposure is the same across domains.
 */
export function buildDomainInterestRows(
  profile: ResilienceProfile | undefined,
  declaredWeights: Readonly<Record<string, number>> = {},
): DomainInterestRow[] {
  if (!profile || profile.riskExposure.length === 0) return [];
  const totalDeclared = profile.riskExposure.reduce(
    (s, e) => s + Math.max(0, declaredWeights[e.domain] ?? 1),
    0,
  );
  const denom = totalDeclared > 0 ? totalDeclared : 1;
  const rows = profile.riskExposure.map((e: DomainExposure): DomainInterestRow => {
    const weight = Math.max(0, declaredWeights[e.domain] ?? 1) / denom;
    return {
      domain: e.domain,
      interestWeight: weight,
      exposureLevel: e.exposureLevel,
      alertsReceived: e.alertsReceived,
      scoreContribution: weight * e.exposureLevel,
    };
  });
  rows.sort((a, b) => b.scoreContribution - a.scoreContribution);
  return rows;
}

// ── Internal ────────────────────────────────────────────────────────────────

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
