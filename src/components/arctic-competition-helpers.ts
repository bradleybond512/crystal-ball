/**
 * Pure helpers for ArcticCompetitionPanel.
 * No DOM, no fetch, no globals — safe to import in Node.js tests.
 *
 * Sections:
 *   1. Arctic nation data
 *   2. Sovereignty disputes
 *   3. Military presence
 *   4. Resource sectors
 *   5. Shipping lanes
 *   6. Sea ice trend
 *   7. Scoring + aggregation
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ArcticNation {
  code: string; // 'RU' | 'CA' | 'US' | 'DK' | 'NO'
  name: string;
  claimStrength: number; // 0-1
  militaryScore: number; // 0-1
  resourceInterest: number; // 0-1
}

export interface SovereigntyDispute {
  region: string;
  claimants: string[]; // nation codes
  contested: boolean;
  legalBasis: string;
  tensionLevel: number; // 0-1
}

export interface MilitaryPresence {
  nation: string;
  bases: number;
  icebreakers: number;
  submarines: number;
  recentExercises: number;
  presenceScore: number; // computed
}

export interface ResourceSector {
  name: string;
  type: 'oil' | 'gas' | 'rare_earth' | 'shipping';
  estimatedValue: number; // billions USD
  controlledBy: string[]; // nation codes
  competitionLevel: number; // 0-1
  developmentStage: 'unexplored' | 'surveyed' | 'contested' | 'developing' | 'producing';
}

export interface ShippingLane {
  name: string;
  route: 'northwest_passage' | 'northern_sea_route' | 'transpolar';
  controlledBy: string;
  openMonthsPerYear: number;
  commercialTransits: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface SeaIceTrend {
  year: number;
  septemberExtentMkm2: number; // million km²
  anomalyPercent: number;
  trend: 'stable' | 'declining' | 'rapid_decline';
}

export interface ArcticRenderData {
  overallTensionScore: number; // 0-100
  tensionLabel: string;
  nations: ArcticNation[];
  disputes: SovereigntyDispute[];
  militaryPresences: MilitaryPresence[];
  resources: ResourceSector[];
  shippingLanes: ShippingLane[];
  seaIceTrend: SeaIceTrend;
  treatyComplianceScore: number; // 0-100
  lastUpdated: string;
}

// ── Nation data ────────────────────────────────────────────────────────────

export function getArcticNations(): ArcticNation[] {
  return [
    {
      code: 'RU',
      name: 'Russia',
      claimStrength: 0.92,
      militaryScore: 0.95,
      resourceInterest: 0.98,
    },
    {
      code: 'CA',
      name: 'Canada',
      claimStrength: 0.78,
      militaryScore: 0.55,
      resourceInterest: 0.72,
    },
    {
      code: 'US',
      name: 'United States',
      claimStrength: 0.65,
      militaryScore: 0.80,
      resourceInterest: 0.76,
    },
    {
      code: 'DK',
      name: 'Denmark (Greenland)',
      claimStrength: 0.70,
      militaryScore: 0.42,
      resourceInterest: 0.68,
    },
    {
      code: 'NO',
      name: 'Norway',
      claimStrength: 0.72,
      militaryScore: 0.48,
      resourceInterest: 0.70,
    },
  ];
}

// ── Sovereignty disputes ───────────────────────────────────────────────────

export function getSovereigntyDisputes(): SovereigntyDispute[] {
  return [
    {
      region: 'Northwest Passage',
      claimants: ['CA', 'US'],
      contested: true,
      legalBasis: 'Canada asserts internal waters; US maintains international strait',
      tensionLevel: 0.55,
    },
    {
      region: 'Hans Island / Tartupaluk',
      claimants: ['CA', 'DK'],
      contested: false,
      legalBasis: 'Resolved by 2022 boundary agreement; still monitoring compliance',
      tensionLevel: 0.12,
    },
    {
      region: 'Lomonosov Ridge',
      claimants: ['RU', 'DK', 'CA'],
      contested: true,
      legalBasis: 'UNCLOS extended continental shelf submissions under review by CLCS',
      tensionLevel: 0.72,
    },
    {
      region: 'Svalbard Archipelago',
      claimants: ['NO', 'RU'],
      contested: true,
      legalBasis: '1920 Svalbard Treaty grants NO sovereignty; RU disputes EEZ interpretation',
      tensionLevel: 0.60,
    },
    {
      region: 'Beaufort Sea',
      claimants: ['CA', 'US'],
      contested: true,
      legalBasis: 'Equidistance vs. extension-of-land-border dispute over ~21,000 km²',
      tensionLevel: 0.45,
    },
    {
      region: 'Northern Sea Route Straits',
      claimants: ['RU', 'US'],
      contested: true,
      legalBasis: 'Russia asserts right to regulate passage; US denies special jurisdiction',
      tensionLevel: 0.68,
    },
  ];
}

// ── Military presence ──────────────────────────────────────────────────────

export function computeMilitaryPresenceScore(
  presence: Omit<MilitaryPresence, 'presenceScore'>,
): number {
  // Weighted: bases 30%, icebreakers 35%, submarines 25%, exercises 10%
  const maxBases = 20;
  const maxIcebreakers = 60;
  const maxSubs = 30;
  const maxExercises = 10;

  const baseScore = Math.min(presence.bases / maxBases, 1) * 0.30;
  const icebreakerScore = Math.min(presence.icebreakers / maxIcebreakers, 1) * 0.35;
  const subScore = Math.min(presence.submarines / maxSubs, 1) * 0.25;
  const exerciseScore = Math.min(presence.recentExercises / maxExercises, 1) * 0.10;

  return Math.min(1, baseScore + icebreakerScore + subScore + exerciseScore);
}

export function getMilitaryPresences(): MilitaryPresence[] {
  const raw: Omit<MilitaryPresence, 'presenceScore'>[] = [
    { nation: 'RU', bases: 18, icebreakers: 54, submarines: 28, recentExercises: 9 },
    { nation: 'CA', bases: 4, icebreakers: 6, submarines: 0, recentExercises: 4 },
    { nation: 'US', bases: 5, icebreakers: 4, submarines: 8, recentExercises: 6 },
    { nation: 'DK', bases: 2, icebreakers: 4, submarines: 0, recentExercises: 2 },
    { nation: 'NO', bases: 3, icebreakers: 5, submarines: 6, recentExercises: 3 },
  ];

  return raw.map((p) => ({
    ...p,
    presenceScore: computeMilitaryPresenceScore(p),
  }));
}

// ── Resource sectors ───────────────────────────────────────────────────────

export function getResourceSectors(): ResourceSector[] {
  return [
    {
      name: 'Barents Sea Oil Fields',
      type: 'oil',
      estimatedValue: 900,
      controlledBy: ['RU', 'NO'],
      competitionLevel: 0.65,
      developmentStage: 'producing',
    },
    {
      name: 'Arctic LNG — Yamal Peninsula',
      type: 'gas',
      estimatedValue: 1200,
      controlledBy: ['RU'],
      competitionLevel: 0.45,
      developmentStage: 'producing',
    },
    {
      name: 'Greenland Rare Earth Deposits',
      type: 'rare_earth',
      estimatedValue: 2500,
      controlledBy: ['DK'],
      competitionLevel: 0.88,
      developmentStage: 'surveyed',
    },
    {
      name: 'Beaufort Sea Offshore Oil',
      type: 'oil',
      estimatedValue: 650,
      controlledBy: ['CA', 'US'],
      competitionLevel: 0.72,
      developmentStage: 'contested',
    },
    {
      name: 'Kara Sea Gas Reserves',
      type: 'gas',
      estimatedValue: 800,
      controlledBy: ['RU'],
      competitionLevel: 0.30,
      developmentStage: 'developing',
    },
    {
      name: 'Norwegian Sea Petroleum',
      type: 'oil',
      estimatedValue: 420,
      controlledBy: ['NO'],
      competitionLevel: 0.35,
      developmentStage: 'producing',
    },
    {
      name: 'Transpolar Shipping Corridor',
      type: 'shipping',
      estimatedValue: 1100,
      controlledBy: ['RU', 'CA', 'US', 'DK', 'NO'],
      competitionLevel: 0.80,
      developmentStage: 'contested',
    },
  ];
}

// ── Shipping lanes ─────────────────────────────────────────────────────────

export function classifyShippingRisk(lane: ShippingLane): 'low' | 'medium' | 'high' | 'critical' {
  // Risk is based on open months (fewer = riskier) and commercial transits
  if (lane.openMonthsPerYear >= 9 && lane.commercialTransits > 50) return 'low';
  if (lane.openMonthsPerYear >= 6 && lane.commercialTransits > 20) return 'medium';
  if (lane.openMonthsPerYear >= 3) return 'high';
  return 'critical';
}

export function getShippingLanes(): ShippingLane[] {
  const raw: Omit<ShippingLane, 'riskLevel'>[] = [
    {
      name: 'Northwest Passage',
      route: 'northwest_passage',
      controlledBy: 'CA',
      openMonthsPerYear: 3,
      commercialTransits: 12,
    },
    {
      name: 'Northern Sea Route',
      route: 'northern_sea_route',
      controlledBy: 'RU',
      openMonthsPerYear: 5,
      commercialTransits: 35,
    },
    {
      name: 'Transpolar Route',
      route: 'transpolar',
      controlledBy: 'International',
      openMonthsPerYear: 2,
      commercialTransits: 5,
    },
  ];

  return raw.map((lane) => ({
    ...lane,
    riskLevel: classifyShippingRisk({ ...lane, riskLevel: 'low' }),
  }));
}

// ── Sea ice trend ──────────────────────────────────────────────────────────

export function getSeaIceTrend(): SeaIceTrend {
  return {
    year: 2026,
    septemberExtentMkm2: 3.8,
    anomalyPercent: -28.4,
    trend: 'declining',
  };
}

// ── Scoring functions ──────────────────────────────────────────────────────

export function computeSovereigntyScore(
  nation: ArcticNation,
  disputes: SovereigntyDispute[],
): number {
  // Base from claimStrength (0-100 scale), adjusted by dispute involvement
  const base = nation.claimStrength * 60;
  const involvedDisputes = disputes.filter((d) => d.claimants.includes(nation.code));
  const disputeBonus = Math.min(involvedDisputes.length * 5, 25);
  const contestedBonus = involvedDisputes.filter((d) => d.contested).length * 3;
  return Math.min(100, Math.round(base + disputeBonus + contestedBonus));
}

export function computeResourceCompetitionIndex(sectors: ResourceSector[]): number {
  if (sectors.length === 0) return 0;
  const avg = sectors.reduce((sum, s) => sum + s.competitionLevel, 0) / sectors.length;
  return Math.min(100, Math.round(avg * 100));
}

export function computeOverallTensionScore(
  nations: ArcticNation[],
  disputes: SovereigntyDispute[],
  military: MilitaryPresence[],
): number {
  // Military component: average presence score (weight 40%)
  const avgMilitary =
    military.length > 0
      ? military.reduce((s, m) => s + m.presenceScore, 0) / military.length
      : 0;

  // Dispute component: average tension level of contested disputes (weight 35%)
  const contested = disputes.filter((d) => d.contested);
  const avgDispute =
    contested.length > 0
      ? contested.reduce((s, d) => s + d.tensionLevel, 0) / contested.length
      : 0;

  // Nation component: average militaryScore (weight 25%)
  const avgNation =
    nations.length > 0
      ? nations.reduce((s, n) => s + n.militaryScore, 0) / nations.length
      : 0;

  const raw = avgMilitary * 0.40 + avgDispute * 0.35 + avgNation * 0.25;
  return Math.min(100, Math.round(raw * 100));
}

export function getTensionLabel(score: number): string {
  if (score < 25) return 'Stable';
  if (score < 50) return 'Elevated';
  if (score < 75) return 'High';
  return 'Critical';
}

export function getTreatyComplianceScore(nations: ArcticNation[]): number {
  // Compliance inversely related to militaryScore; higher military → lower compliance trend
  if (nations.length === 0) return 100;
  const avgMilitary = nations.reduce((s, n) => s + n.militaryScore, 0) / nations.length;
  // Base 85 minus up to 30 for high military activity
  return Math.max(0, Math.min(100, Math.round(85 - avgMilitary * 30)));
}

// ── Aggregation ────────────────────────────────────────────────────────────

export function buildArcticRenderData(): ArcticRenderData {
  const nations = getArcticNations();
  const disputes = getSovereigntyDisputes();
  const militaryPresences = getMilitaryPresences();
  const resources = getResourceSectors();
  const shippingLanes = getShippingLanes();
  const seaIceTrend = getSeaIceTrend();

  const overallTensionScore = computeOverallTensionScore(nations, disputes, militaryPresences);
  const tensionLabel = getTensionLabel(overallTensionScore);
  const treatyComplianceScore = getTreatyComplianceScore(nations);

  return {
    overallTensionScore,
    tensionLabel,
    nations,
    disputes,
    militaryPresences,
    resources,
    shippingLanes,
    seaIceTrend,
    treatyComplianceScore,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function formatScore(score: number): string {
  return `${Math.round(score)}/100`;
}

export function getRiskColor(level: string): string {
  switch (level) {
    case 'low': return '#22c55e';
    case 'medium': return '#f59e0b';
    case 'high': return '#ef4444';
    case 'critical': return '#7c3aed';
    default: return '#6b7280';
  }
}

export function getTopClaimants(disputes: SovereigntyDispute[]): string[] {
  const counts: Record<string, number> = {};
  for (const d of disputes) {
    for (const c of d.claimants) {
      counts[c] = (counts[c] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}

export function filterDisputesByNation(
  disputes: SovereigntyDispute[],
  nationCode: string,
): SovereigntyDispute[] {
  return disputes.filter((d) => d.claimants.includes(nationCode));
}
