/**
 * energy-geopolitics-helpers.ts
 *
 * Pure deterministic helpers for EnergyGeopoliticsPanel.
 * No DOM, no fetch, no globals — safe for unit tests.
 *
 * Covers:
 *   - Oil/gas chokepoints (Hormuz, Bab-el-Mandeb, Bosphorus, Suez, Malacca)
 *   - OPEC+ compliance and cohesion
 *   - Pipeline disruption incidents
 *   - LNG supply chain stress
 *   - Energy sanctions leverage
 *   - Strategic reserve levels
 *   - Energy weaponization risk per producer nation
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type OPECStatus = 'compliant' | 'over_producing' | 'under_producing' | 'suspended';
export type PipelineStatus = 'operational' | 'degraded' | 'disrupted' | 'offline';
export type LNGStressLevel = 'normal' | 'elevated' | 'stressed' | 'crisis';
export type WeaponizationTier = 'low' | 'moderate' | 'high' | 'extreme';
export type ReserveStatus = 'adequate' | 'watch' | 'warning' | 'critical';

export type ChokepointId =
  | 'hormuz'
  | 'bab_el_mandeb'
  | 'bosphorus'
  | 'suez'
  | 'malacca';

export interface ChokepointRisk {
  id: ChokepointId;
  name: string;
  location: string;
  /** Mb/d of oil throughput */
  oilFlowMbpd: number;
  /** Bcf/d of gas throughput (LNG + pipeline) */
  gasFlowBcfd: number;
  /** 0–1 */
  tensionScore: number;
  riskLevel: RiskLevel;
  activeIncidents: number;
  closureProbability90d: number; // 0–1
  alternateRouteAvailable: boolean;
  alternateRouteCostMultiplier: number; // 1x = no extra cost
  keyThreats: string[];
}

export interface OPECMember {
  name: string;
  code: string;
  quotaMbpd: number;
  actualMbpd: number;
  status: OPECStatus;
  complianceRate: number; // 0–1 (1 = fully compliant)
  strategicAlignment: 'core' | 'swing' | 'fringe';
}

export interface OPECCompliance {
  members: OPECMember[];
  overallComplianceRate: number; // 0–1
  cohesionScore: number; // 0–100
  productionGapMbpd: number; // actual – quota total
  nextMeetingDaysAway: number;
  cohesionTrend: 'improving' | 'stable' | 'deteriorating';
}

export interface PipelineIncident {
  id: string;
  name: string;
  region: string;
  status: PipelineStatus;
  capacityMbpd: number;
  affectedCapacityMbpd: number;
  causeCategory: 'sabotage' | 'technical' | 'political' | 'weather' | 'conflict';
  daysSinceOnset: number;
  expectedResolutionDays: number | null;
  severityScore: number; // 0–100
}

export interface LNGStressResult {
  overallStressLevel: LNGStressLevel;
  stressScore: number; // 0–100
  spotPremiumMultiplier: number; // 1x = no premium
  majorSuppliers: { country: string; stressContribution: number }[];
  terminalBottlenecks: number;
  shippingDelayDays: number;
  drivers: string[];
}

export interface SanctionsLeverage {
  targetNation: string;
  energySector: 'oil' | 'gas' | 'both';
  exportVolumeMbpd: number;
  replacementDifficulty: RiskLevel; // how hard to replace this supply
  bypassMechanismsActive: number;
  leverageScore: number; // 0–100: how much leverage sanctions give imposers
  evadedPercentage: number; // 0–1
  keyBuyers: string[];
}

export interface WeaponizationRisk {
  nation: string;
  code: string;
  exportShareOfWorldSupply: number; // 0–1
  politicalWillScore: number; // 0–1
  economicDependenceOnExports: number; // 0–1
  historicalPrecedent: boolean;
  tier: WeaponizationTier;
  weaponizationScore: number; // 0–100
  primaryLeverage: string[];
}

export interface StrategicReserve {
  nation: string;
  coverageDays: number;
  iea_member: boolean;
  fillLevelPercent: number; // 0–100
  status: ReserveStatus;
  trend: 'building' | 'stable' | 'drawing_down';
}

export interface EnergyGeopoliticsRenderData {
  chokepoints: ChokepointRisk[];
  opec: OPECCompliance;
  pipelines: PipelineIncident[];
  lng: LNGStressResult;
  sanctions: SanctionsLeverage[];
  reserves: StrategicReserve[];
  weaponization: WeaponizationRisk[];
  overallRiskScore: number; // 0–100
  overallRiskLevel: RiskLevel;
  topRisks: string[];
  asOf: string;
}

// ── Static mock data ─────────────────────────────────────────────────────────

const CHOKEPOINT_DATA: ChokepointRisk[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    location: 'Persian Gulf / Gulf of Oman',
    oilFlowMbpd: 21,
    gasFlowBcfd: 3.7,
    tensionScore: 0.74,
    riskLevel: 'high',
    activeIncidents: 3,
    closureProbability90d: 0.12,
    alternateRouteAvailable: true,
    alternateRouteCostMultiplier: 2.4,
    keyThreats: ['Iran military exercises', 'tanker seizures', 'mine placement risk'],
  },
  {
    id: 'bab_el_mandeb',
    name: 'Bab-el-Mandeb',
    location: 'Red Sea / Gulf of Aden',
    oilFlowMbpd: 6.2,
    gasFlowBcfd: 1.1,
    tensionScore: 0.82,
    riskLevel: 'critical',
    activeIncidents: 7,
    closureProbability90d: 0.22,
    alternateRouteAvailable: true,
    alternateRouteCostMultiplier: 3.1,
    keyThreats: ['Houthi missile attacks', 'drone strikes on tankers', 'naval blockade risk'],
  },
  {
    id: 'bosphorus',
    name: 'Turkish Straits (Bosphorus)',
    location: 'Black Sea / Marmara Sea',
    oilFlowMbpd: 3,
    gasFlowBcfd: 0.6,
    tensionScore: 0.45,
    riskLevel: 'medium',
    activeIncidents: 1,
    closureProbability90d: 0.04,
    alternateRouteAvailable: false,
    alternateRouteCostMultiplier: 4.2,
    keyThreats: ['Turkey transit disputes', 'Russian Black Sea fleet activity', 'environmental closures'],
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    location: 'Egypt — Red Sea / Mediterranean',
    oilFlowMbpd: 5.5,
    gasFlowBcfd: 2.2,
    tensionScore: 0.38,
    riskLevel: 'medium',
    activeIncidents: 0,
    closureProbability90d: 0.06,
    alternateRouteAvailable: true,
    alternateRouteCostMultiplier: 2.8,
    keyThreats: ['Red Sea conflict spillover', 'Egyptian political instability', 'navigation incidents'],
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    location: 'Southeast Asia — Indian Ocean / Pacific',
    oilFlowMbpd: 16,
    gasFlowBcfd: 2.9,
    tensionScore: 0.35,
    riskLevel: 'medium',
    activeIncidents: 2,
    closureProbability90d: 0.03,
    alternateRouteAvailable: true,
    alternateRouteCostMultiplier: 1.9,
    keyThreats: ['South China Sea tensions', 'piracy activity', 'Chinese naval exercises'],
  },
];

const OPEC_MEMBERS: OPECMember[] = [
  { name: 'Saudi Arabia', code: 'SA', quotaMbpd: 9, actualMbpd: 9, status: 'compliant', complianceRate: 1, strategicAlignment: 'core' },
  { name: 'Russia', code: 'RU', quotaMbpd: 9.5, actualMbpd: 9.8, status: 'over_producing', complianceRate: 0.84, strategicAlignment: 'swing' },
  { name: 'UAE', code: 'AE', quotaMbpd: 3.2, actualMbpd: 3.3, status: 'over_producing', complianceRate: 0.91, strategicAlignment: 'core' },
  { name: 'Iraq', code: 'IQ', quotaMbpd: 4.2, actualMbpd: 4.4, status: 'over_producing', complianceRate: 0.85, strategicAlignment: 'swing' },
  { name: 'Kuwait', code: 'KW', quotaMbpd: 2.5, actualMbpd: 2.5, status: 'compliant', complianceRate: 1, strategicAlignment: 'core' },
  { name: 'Iran', code: 'IR', quotaMbpd: 3, actualMbpd: 3.2, status: 'suspended', complianceRate: 0, strategicAlignment: 'fringe' },
  { name: 'Kazakhstan', code: 'KZ', quotaMbpd: 1.6, actualMbpd: 1.8, status: 'over_producing', complianceRate: 0.78, strategicAlignment: 'fringe' },
  { name: 'Qatar', code: 'QA', quotaMbpd: 0.6, actualMbpd: 0.6, status: 'compliant', complianceRate: 1, strategicAlignment: 'core' },
];

const PIPELINE_INCIDENTS: PipelineIncident[] = [
  {
    id: 'nordstream-remnant',
    name: 'Nord Stream remnant (Baltic)',
    region: 'Baltic Sea',
    status: 'offline',
    capacityMbpd: 0,
    affectedCapacityMbpd: 0,
    causeCategory: 'sabotage',
    daysSinceOnset: 620,
    expectedResolutionDays: null,
    severityScore: 72,
  },
  {
    id: 'druzhba-south',
    name: 'Druzhba Southern Branch',
    region: 'Eastern Europe',
    status: 'degraded',
    capacityMbpd: 0.4,
    affectedCapacityMbpd: 0.1,
    causeCategory: 'political',
    daysSinceOnset: 180,
    expectedResolutionDays: 90,
    severityScore: 38,
  },
  {
    id: 'kirkuk-ceyhan',
    name: 'Kirkuk–Ceyhan Pipeline',
    region: 'Iraq / Turkey',
    status: 'disrupted',
    capacityMbpd: 0.45,
    affectedCapacityMbpd: 0.45,
    causeCategory: 'political',
    daysSinceOnset: 420,
    expectedResolutionDays: null,
    severityScore: 61,
  },
  {
    id: 'transarabian-partial',
    name: 'Trans-Arabian Pipeline (partial)',
    region: 'Arabian Peninsula',
    status: 'degraded',
    capacityMbpd: 0.5,
    affectedCapacityMbpd: 0.15,
    causeCategory: 'technical',
    daysSinceOnset: 45,
    expectedResolutionDays: 30,
    severityScore: 25,
  },
];

const SANCTIONS_DATA: SanctionsLeverage[] = [
  {
    targetNation: 'Russia',
    energySector: 'both',
    exportVolumeMbpd: 7.5,
    replacementDifficulty: 'high',
    bypassMechanismsActive: 4,
    leverageScore: 58,
    evadedPercentage: 0.42,
    keyBuyers: ['China', 'India', 'Turkey'],
  },
  {
    targetNation: 'Iran',
    energySector: 'oil',
    exportVolumeMbpd: 1.8,
    replacementDifficulty: 'medium',
    bypassMechanismsActive: 5,
    leverageScore: 41,
    evadedPercentage: 0.65,
    keyBuyers: ['China', 'Syria', 'Venezuela'],
  },
  {
    targetNation: 'Venezuela',
    energySector: 'oil',
    exportVolumeMbpd: 0.9,
    replacementDifficulty: 'low',
    bypassMechanismsActive: 3,
    leverageScore: 28,
    evadedPercentage: 0.35,
    keyBuyers: ['China', 'Cuba', 'Belarus'],
  },
];

const STRATEGIC_RESERVES: StrategicReserve[] = [
  { nation: 'United States (SPR)', coverageDays: 17, iea_member: true, fillLevelPercent: 38, status: 'warning', trend: 'stable' },
  { nation: 'European IEA members', coverageDays: 89, iea_member: true, fillLevelPercent: 61, status: 'watch', trend: 'stable' },
  { nation: 'Japan', coverageDays: 145, iea_member: true, fillLevelPercent: 87, status: 'adequate', trend: 'stable' },
  { nation: 'China (SPR)', coverageDays: 90, iea_member: false, fillLevelPercent: 72, status: 'adequate', trend: 'building' },
  { nation: 'India', coverageDays: 12, iea_member: false, fillLevelPercent: 25, status: 'critical', trend: 'drawing_down' },
];

const WEAPONIZATION_DATA: WeaponizationRisk[] = [
  {
    nation: 'Russia',
    code: 'RU',
    exportShareOfWorldSupply: 0.12,
    politicalWillScore: 0.88,
    economicDependenceOnExports: 0.46,
    historicalPrecedent: true,
    tier: 'extreme',
    weaponizationScore: 88,
    primaryLeverage: ['Europe gas dependency', 'pipeline infrastructure control', 'LNG market disruption'],
  },
  {
    nation: 'Saudi Arabia',
    code: 'SA',
    exportShareOfWorldSupply: 0.11,
    politicalWillScore: 0.55,
    economicDependenceOnExports: 0.62,
    historicalPrecedent: true,
    tier: 'high',
    weaponizationScore: 67,
    primaryLeverage: ['OPEC+ swing producer', 'refinery capacity control', 'petrodollar positioning'],
  },
  {
    nation: 'Iran',
    code: 'IR',
    exportShareOfWorldSupply: 0.04,
    politicalWillScore: 0.92,
    economicDependenceOnExports: 0.35,
    historicalPrecedent: true,
    tier: 'high',
    weaponizationScore: 72,
    primaryLeverage: ['Hormuz closure threat', 'tanker harassment', 'Hezbollah proxy leverage'],
  },
  {
    nation: 'UAE',
    code: 'AE',
    exportShareOfWorldSupply: 0.04,
    politicalWillScore: 0.28,
    economicDependenceOnExports: 0.38,
    historicalPrecedent: false,
    tier: 'moderate',
    weaponizationScore: 34,
    primaryLeverage: ['LNG diversification hub', 'ADNOC strategic reserves'],
  },
  {
    nation: 'Qatar',
    code: 'QA',
    exportShareOfWorldSupply: 0.04,
    politicalWillScore: 0.22,
    economicDependenceOnExports: 0.58,
    historicalPrecedent: false,
    tier: 'moderate',
    weaponizationScore: 30,
    primaryLeverage: ['LNG market share', 'long-term contract leverage'],
  },
  {
    nation: 'Kazakhstan',
    code: 'KZ',
    exportShareOfWorldSupply: 0.02,
    politicalWillScore: 0.35,
    economicDependenceOnExports: 0.41,
    historicalPrecedent: false,
    tier: 'low',
    weaponizationScore: 18,
    primaryLeverage: ['CPC pipeline chokepoint exposure'],
  },
];

// ── Pure helper functions ─────────────────────────────────────────────────────

/**
 * Score a chokepoint's risk level from its tension score and incident count.
 * Returns a 0–100 integer risk score.
 */
export function scoreChokepointRisk(chokepoint: ChokepointRisk): number {
  const tensionComponent = chokepoint.tensionScore * 50;
  const incidentComponent = Math.min(chokepoint.activeIncidents * 8, 30);
  const closureComponent = chokepoint.closureProbability90d * 20;
  const raw = tensionComponent + incidentComponent + closureComponent;
  return Math.min(100, Math.round(raw));
}

/**
 * Calculate overall OPEC compliance metrics from member data.
 */
export function calculateOPECCompliance(members: OPECMember[]): OPECCompliance {
  if (members.length === 0) {
    return {
      members: [],
      overallComplianceRate: 1,
      cohesionScore: 100,
      productionGapMbpd: 0,
      nextMeetingDaysAway: 60,
      cohesionTrend: 'stable',
    };
  }

  const activeMembers = members.filter((m) => m.status !== 'suspended');
  const overallComplianceRate =
    activeMembers.length > 0
      ? activeMembers.reduce((sum, m) => sum + m.complianceRate, 0) / activeMembers.length
      : 1;

  const totalQuota = members.reduce((sum, m) => sum + m.quotaMbpd, 0);
  const totalActual = members.reduce((sum, m) => sum + m.actualMbpd, 0);
  const productionGapMbpd = totalActual - totalQuota;

  // Cohesion: penalize non-compliant members and fringe alignments
  const fringeCount = members.filter((m) => m.strategicAlignment === 'fringe').length;
  const overProducingCount = members.filter((m) => m.status === 'over_producing').length;
  const cohesionScore = Math.max(
    0,
    Math.round(overallComplianceRate * 90 - fringeCount * 5 - overProducingCount * 3),
  );

  let cohesionTrend: OPECCompliance['cohesionTrend'] = 'deteriorating';
  if (cohesionScore >= 75) cohesionTrend = 'improving';
  else if (cohesionScore >= 55) cohesionTrend = 'stable';

  return {
    members,
    overallComplianceRate,
    cohesionScore,
    productionGapMbpd: Math.round(productionGapMbpd * 100) / 100,
    nextMeetingDaysAway: 42,
    cohesionTrend,
  };
}

/**
 * Assess pipeline disruption severity for a set of incidents.
 * Returns total affected capacity (Mb/d) and average severity score.
 */
export function assessPipelineDisruption(incidents: PipelineIncident[]): {
  totalAffectedMbpd: number;
  averageSeverity: number;
  activeDisruptionCount: number;
  criticalIncidents: PipelineIncident[];
} {
  const active = incidents.filter((i) => i.status !== 'operational');
  const totalAffectedMbpd = active.reduce((sum, i) => sum + i.affectedCapacityMbpd, 0);
  const averageSeverity =
    active.length > 0
      ? active.reduce((sum, i) => sum + i.severityScore, 0) / active.length
      : 0;
  const criticalIncidents = active.filter((i) => i.severityScore >= 60);

  return {
    totalAffectedMbpd: Math.round(totalAffectedMbpd * 100) / 100,
    averageSeverity: Math.round(averageSeverity),
    activeDisruptionCount: active.length,
    criticalIncidents,
  };
}

/**
 * Estimate LNG supply chain stress based on key inputs.
 */
export function estimateLNGStress(params: {
  chokepoints: ChokepointRisk[];
  pipelineDisruptions: PipelineIncident[];
  seasonalDemandMultiplier: number; // 1.0 = normal; 1.3 = winter peak
}): LNGStressResult {
  const { chokepoints, pipelineDisruptions, seasonalDemandMultiplier } = params;

  // High-tension chokepoints drive LNG spot premium
  const criticalChokepoints = chokepoints.filter((c) => c.riskLevel === 'critical' || c.riskLevel === 'high');
  const chokepointStress = criticalChokepoints.length * 12;

  // Pipeline disruptions push supply to LNG
  const disrupted = pipelineDisruptions.filter((p) => p.status !== 'operational');
  const pipelineStress = disrupted.reduce((sum, p) => sum + p.severityScore * 0.3, 0);

  const seasonalStress = (seasonalDemandMultiplier - 1) * 40;
  const rawScore = Math.min(100, chokepointStress + pipelineStress + seasonalStress);
  const stressScore = Math.round(rawScore);

  let stressLevel: LNGStressLevel = 'normal';
  if (stressScore >= 75) stressLevel = 'crisis';
  else if (stressScore >= 50) stressLevel = 'stressed';
  else if (stressScore >= 25) stressLevel = 'elevated';

  const spotPremiumMultiplier = 1 + rawScore / 100 * 2.5;

  const drivers: string[] = [];
  if (criticalChokepoints.length > 0) drivers.push(`${criticalChokepoints.length} critical chokepoint(s) elevated`);
  if (disrupted.length > 0) drivers.push(`${disrupted.length} pipeline(s) disrupted — LNG substitution demand`);
  if (seasonalDemandMultiplier > 1.1) drivers.push('Seasonal heating/cooling demand spike');

  return {
    overallStressLevel: stressLevel,
    stressScore,
    spotPremiumMultiplier: Math.round(spotPremiumMultiplier * 100) / 100,
    majorSuppliers: [
      { country: 'Qatar', stressContribution: Math.round(stressScore * 0.35) },
      { country: 'Australia', stressContribution: Math.round(stressScore * 0.25) },
      { country: 'USA', stressContribution: Math.round(stressScore * 0.2) },
    ],
    terminalBottlenecks: criticalChokepoints.length,
    shippingDelayDays: Math.round(rawScore / 20),
    drivers,
  };
}

/**
 * Score the leverage that energy sanctions give to the imposing coalition.
 * Higher score = more effective leverage.
 */
export function scoreSanctionsLeverage(entry: SanctionsLeverage): number {
  // Effectiveness = leverage score net of evasion
  const evadedPenalty = entry.evadedPercentage * 40;
  const bypassPenalty = entry.bypassMechanismsActive * 4;
  const raw = entry.leverageScore - evadedPenalty - bypassPenalty;
  return Math.max(0, Math.round(raw));
}

/**
 * Classify weaponization risk tier from raw scores.
 */
export function classifyWeaponizationRisk(params: {
  exportShare: number; // 0–1
  politicalWill: number; // 0–1
  economicDependence: number; // 0–1
  historicalPrecedent: boolean;
}): { tier: WeaponizationTier; score: number } {
  const { exportShare, politicalWill, economicDependence, historicalPrecedent } = params;

  let score =
    exportShare * 35 +
    politicalWill * 40 +
    economicDependence * 15 +
    (historicalPrecedent ? 10 : 0);

  // Normalize to 0–100
  score = Math.min(100, Math.round(score * 100));

  let tier: WeaponizationTier = 'low';
  if (score >= 70) tier = 'extreme';
  else if (score >= 50) tier = 'high';
  else if (score >= 25) tier = 'moderate';

  return { tier, score };
}

/**
 * Determine strategic reserve status from coverage days and fill level.
 */
export function classifyReserveStatus(reserve: StrategicReserve): ReserveStatus {
  if (reserve.coverageDays >= 90 && reserve.fillLevelPercent >= 70) return 'adequate';
  if (reserve.coverageDays >= 60 && reserve.fillLevelPercent >= 50) return 'watch';
  if (reserve.coverageDays >= 30 && reserve.fillLevelPercent >= 30) return 'warning';
  return 'critical';
}

/**
 * Build the full render data bundle used by EnergyGeopoliticsPanel.
 */
export function buildEnergyGeopoliticsRenderData(): EnergyGeopoliticsRenderData {
  const chokepoints = CHOKEPOINT_DATA;
  const opec = calculateOPECCompliance(OPEC_MEMBERS);
  const pipelines = PIPELINE_INCIDENTS;
  const lng = estimateLNGStress({
    chokepoints,
    pipelineDisruptions: pipelines,
    seasonalDemandMultiplier: 1,
  });
  const sanctions = SANCTIONS_DATA;
  const reserves = STRATEGIC_RESERVES;
  const weaponization = WEAPONIZATION_DATA;

  // Compute overall risk score
  const chokepointRiskAvg =
    chokepoints.reduce((sum, c) => sum + scoreChokepointRisk(c), 0) / chokepoints.length;
  const weaponizationAvg =
    weaponization.reduce((sum, w) => sum + w.weaponizationScore, 0) / weaponization.length;
  const pipelineAssessment = assessPipelineDisruption(pipelines);

  const overallRiskScore = Math.min(
    100,
    Math.round(
      chokepointRiskAvg * 0.35 +
        weaponizationAvg * 0.25 +
        pipelineAssessment.averageSeverity * 0.2 +
        lng.stressScore * 0.2,
    ),
  );

  let overallRiskLevel: RiskLevel = 'low';
  if (overallRiskScore >= 75) overallRiskLevel = 'critical';
  else if (overallRiskScore >= 50) overallRiskLevel = 'high';
  else if (overallRiskScore >= 25) overallRiskLevel = 'medium';

  const topRisks: string[] = [];
  const criticalChokepoints = chokepoints.filter((c) => c.riskLevel === 'critical');
  if (criticalChokepoints.length > 0) {
    topRisks.push(`${criticalChokepoints.map((c) => c.name).join(', ')} at critical risk`);
  }
  if (pipelineAssessment.criticalIncidents.length > 0) {
    topRisks.push(`${pipelineAssessment.criticalIncidents.length} critical pipeline disruption(s)`);
  }
  if (lng.overallStressLevel === 'crisis' || lng.overallStressLevel === 'stressed') {
    topRisks.push(`LNG supply chain ${lng.overallStressLevel}`);
  }
  const extremeWeaponizers = weaponization.filter((w) => w.tier === 'extreme');
  if (extremeWeaponizers.length > 0) {
    topRisks.push(`${extremeWeaponizers.map((w) => w.nation).join(', ')} extreme weaponization risk`);
  }

  return {
    chokepoints,
    opec,
    pipelines,
    lng,
    sanctions,
    reserves,
    weaponization,
    overallRiskScore,
    overallRiskLevel,
    topRisks,
    asOf: new Date().toISOString(),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function getRiskColor(level: string): string {
  switch (level) {
    case 'low': { return '#22c55e';
    }
    case 'medium': { return '#f59e0b';
    }
    case 'high': { return '#ef4444';
    }
    case 'critical': { return '#dc2626';
    }
    default: { return '#6b7280';
    }
  }
}

export function getWeaponizationColor(tier: string): string {
  switch (tier) {
    case 'low': { return '#22c55e';
    }
    case 'moderate': { return '#f59e0b';
    }
    case 'high': { return '#ef4444';
    }
    case 'extreme': { return '#dc2626';
    }
    default: { return '#6b7280';
    }
  }
}

export function getLNGStressColor(level: string): string {
  switch (level) {
    case 'normal': { return '#22c55e';
    }
    case 'elevated': { return '#f59e0b';
    }
    case 'stressed': { return '#ef4444';
    }
    case 'crisis': { return '#dc2626';
    }
    default: { return '#6b7280';
    }
  }
}

export function getReserveStatusColor(status: string): string {
  switch (status) {
    case 'adequate': { return '#22c55e';
    }
    case 'watch': { return '#f59e0b';
    }
    case 'warning': { return '#ef4444';
    }
    case 'critical': { return '#dc2626';
    }
    default: { return '#6b7280';
    }
  }
}

export function formatMbpd(value: number): string {
  return `${value.toFixed(1)} Mb/d`;
}

export function formatScore(score: number): string {
  return `${Math.round(score)}/100`;
}

export function formatComplianceRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Get active (non-compliant) OPEC members sorted by deviation */
export function getNonCompliantMembers(members: OPECMember[]): OPECMember[] {
  return members
    .filter((m) => m.status !== 'compliant')
    .sort((a, b) => a.complianceRate - b.complianceRate);
}

/** Get chokepoints sorted by risk score descending */
export function getChokepointsByRisk(chokepoints: ChokepointRisk[]): ChokepointRisk[] {
  return [...chokepoints].sort((a, b) => scoreChokepointRisk(b) - scoreChokepointRisk(a));
}

/** Get weaponization risks sorted by score descending */
export function getWeaponizationByScore(risks: WeaponizationRisk[]): WeaponizationRisk[] {
  return [...risks].sort((a, b) => b.weaponizationScore - a.weaponizationScore);
}

/** Compute total daily oil volume at risk across all chokepoints */
export function totalOilAtRisk(chokepoints: ChokepointRisk[]): number {
  return Math.round(
    chokepoints
      .filter((c) => c.riskLevel === 'high' || c.riskLevel === 'critical')
      .reduce((sum, c) => sum + c.oilFlowMbpd, 0) * 10,
  ) / 10;
}

export { CHOKEPOINT_DATA, OPEC_MEMBERS, PIPELINE_INCIDENTS, SANCTIONS_DATA, STRATEGIC_RESERVES, WEAPONIZATION_DATA };
