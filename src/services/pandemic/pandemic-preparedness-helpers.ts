/**
 * pandemic-preparedness-helpers.ts
 *
 * Pure deterministic logic for the Pandemic Preparedness panel.
 * No DOM, no fetch, no globals — input-output pure.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface GhsIndexScore {
  country: string;
  iso3: string;
  overallScore: number;
  prevention: number;
  detection: number;
  response: number;
  health: number;
  norms: number;
  risk: number;
  lastUpdated: string;
}

export interface VaccineStockpile {
  pathogen: string;
  dosesCoverage: number;
  daysOfStock: number;
  adequate: boolean;
  expiryRisk: 'low' | 'medium' | 'high';
}

export interface SurgeCapacity {
  region: string;
  icuBedsPerMillion: number;
  ventilatorsPer100k: number;
  healthWorkersPerThousand: number;
  surgeReadinessScore: number;
}

export interface IhrCompliance {
  country: string;
  iso3: string;
  capacityScore: number;
  legislationScore: number;
  coordinationScore: number;
  surveillanceScore: number;
  responseScore: number;
  lastReportYear: number;
}

export interface EarlyWarningCoverage {
  region: string;
  sentinelSitesCoverage: number;
  labNetworkCoverage: number;
  reportingTimelinessScore: number;
  zoonoticSurveillance: boolean;
  eventBasedSurveillance: boolean;
}

export interface CrossBorderCoordination {
  region: string;
  jointExercisesLast2Years: number;
  informationSharingAgreements: number;
  rapidResponseTeamAvailable: boolean;
  coordinationScore: number;
}

export type PandemicRiskTier = 'critical' | 'high' | 'moderate' | 'low' | 'minimal';

export interface PandemicPreparednessAssessment {
  globalReadinessScore: number;
  riskTier: PandemicRiskTier;
  topVulnerabilities: string[];
  ghsLeaders: GhsIndexScore[];
  ghsLaggards: GhsIndexScore[];
  vaccineAdequacy: VaccineStockpile[];
  surgeCapacities: SurgeCapacity[];
  ihrCompliance: IhrCompliance[];
  earlyWarningCoverage: EarlyWarningCoverage[];
  crossBorderCoordination: CrossBorderCoordination[];
  lastUpdated: string;
}

export interface PandemicInput {
  ghsScores?: GhsIndexScore[];
  stockpiles?: VaccineStockpile[];
  surgeData?: SurgeCapacity[];
  ihrData?: IhrCompliance[];
  warningData?: EarlyWarningCoverage[];
  coordinationData?: CrossBorderCoordination[];
  asOf?: string;
}

// ── Pure functions declared before use in default data ────────────────────

export function computeSurgeReadinessScore(
  capacity: Omit<SurgeCapacity, 'surgeReadinessScore'>,
): number {
  const icuNorm  = Math.min(capacity.icuBedsPerMillion / 500, 1);
  const ventNorm = Math.min(capacity.ventilatorsPer100k / 40, 1);
  const hwNorm   = Math.min(capacity.healthWorkersPerThousand / 20, 1);
  const composite = icuNorm * 0.4 + ventNorm * 0.3 + hwNorm * 0.3;
  return Math.round(composite * 100);
}

export function computeIhrCapacityScore(
  ihr: Omit<IhrCompliance, 'capacityScore'>,
): number {
  const { legislationScore, coordinationScore, surveillanceScore, responseScore } = ihr;
  return Math.round((legislationScore + coordinationScore + surveillanceScore + responseScore) / 4);
}

// ── Default static data ───────────────────────────────────────────────────

const DEFAULT_GHS_SCORES: GhsIndexScore[] = [
  { country: 'United Kingdom', iso3: 'GBR', overallScore: 77, prevention: 78, detection: 79, response: 75, health: 76, norms: 72, risk: 35, lastUpdated: '2023-10-01' },
  { country: 'United States',  iso3: 'USA', overallScore: 75.4, prevention: 83, detection: 78, response: 79, health: 73, norms: 65, risk: 37, lastUpdated: '2023-10-01' },
  { country: 'Canada',         iso3: 'CAN', overallScore: 74.8, prevention: 72, detection: 77, response: 75, health: 76, norms: 74, risk: 33, lastUpdated: '2023-10-01' },
  { country: 'Australia',      iso3: 'AUS', overallScore: 71.3, prevention: 70, detection: 73, response: 69, health: 72, norms: 70, risk: 32, lastUpdated: '2023-10-01' },
  { country: 'Finland',        iso3: 'FIN', overallScore: 68.1, prevention: 67, detection: 70, response: 65, health: 71, norms: 68, risk: 30, lastUpdated: '2023-10-01' },
  { country: 'Germany',        iso3: 'DEU', overallScore: 65.5, prevention: 64, detection: 67, response: 63, health: 70, norms: 64, risk: 31, lastUpdated: '2023-10-01' },
  { country: 'South Korea',    iso3: 'KOR', overallScore: 64.2, prevention: 65, detection: 68, response: 62, health: 65, norms: 62, risk: 29, lastUpdated: '2023-10-01' },
  { country: 'Sweden',         iso3: 'SWE', overallScore: 63.8, prevention: 63, detection: 66, response: 61, health: 68, norms: 63, risk: 28, lastUpdated: '2023-10-01' },
  { country: 'Nigeria',        iso3: 'NGA', overallScore: 33.1, prevention: 30, detection: 35, response: 32, health: 34, norms: 28, risk: 62, lastUpdated: '2023-10-01' },
  { country: 'Haiti',          iso3: 'HTI', overallScore: 28.4, prevention: 25, detection: 30, response: 27, health: 28, norms: 25, risk: 70, lastUpdated: '2023-10-01' },
  { country: 'Yemen',          iso3: 'YEM', overallScore: 20.2, prevention: 18, detection: 22, response: 19, health: 20, norms: 17, risk: 78, lastUpdated: '2023-10-01' },
  { country: 'Burundi',        iso3: 'BDI', overallScore: 22.1, prevention: 20, detection: 24, response: 21, health: 22, norms: 18, risk: 75, lastUpdated: '2023-10-01' },
  { country: 'Somalia',        iso3: 'SOM', overallScore: 18.4, prevention: 16, detection: 20, response: 17, health: 18, norms: 15, risk: 82, lastUpdated: '2023-10-01' },
];

const DEFAULT_STOCKPILES: VaccineStockpile[] = [
  { pathogen: 'Influenza (H5N1)',   dosesCoverage: 0.45, daysOfStock: 90,  adequate: false, expiryRisk: 'medium' },
  { pathogen: 'Smallpox / Mpox',   dosesCoverage: 0.3, daysOfStock: 120, adequate: false, expiryRisk: 'low'    },
  { pathogen: 'Ebola (rVSV-ZEBOV)',dosesCoverage: 0.15, daysOfStock: 60,  adequate: false, expiryRisk: 'high'   },
  { pathogen: 'COVID-19 (XBB booster)', dosesCoverage: 0.62, daysOfStock: 180, adequate: true, expiryRisk: 'low' },
  { pathogen: 'Cholera (OCV)',     dosesCoverage: 0.25, daysOfStock: 45,  adequate: false, expiryRisk: 'medium' },
  { pathogen: 'Yellow Fever',      dosesCoverage: 0.38, daysOfStock: 90,  adequate: false, expiryRisk: 'low'    },
];

const DEFAULT_SURGE_DATA: SurgeCapacity[] = (
  [
    { region: 'North America',      icuBedsPerMillion: 340, ventilatorsPer100k: 28, healthWorkersPerThousand: 14.2, surgeReadinessScore: 0 },
    { region: 'Western Europe',     icuBedsPerMillion: 280, ventilatorsPer100k: 24, healthWorkersPerThousand: 12.8, surgeReadinessScore: 0 },
    { region: 'East Asia',          icuBedsPerMillion: 220, ventilatorsPer100k: 18, healthWorkersPerThousand: 10.5, surgeReadinessScore: 0 },
    { region: 'Latin America',      icuBedsPerMillion: 120, ventilatorsPer100k: 8,  healthWorkersPerThousand: 6.3,  surgeReadinessScore: 0 },
    { region: 'Sub-Saharan Africa', icuBedsPerMillion: 15,  ventilatorsPer100k: 1,  healthWorkersPerThousand: 1.6,  surgeReadinessScore: 0 },
    { region: 'South Asia',         icuBedsPerMillion: 55,  ventilatorsPer100k: 4,  healthWorkersPerThousand: 3.5,  surgeReadinessScore: 0 },
    { region: 'Middle East',        icuBedsPerMillion: 160, ventilatorsPer100k: 12, healthWorkersPerThousand: 8.2,  surgeReadinessScore: 0 },
  ] as SurgeCapacity[]
).map((r) => ({ ...r, surgeReadinessScore: computeSurgeReadinessScore(r) }));

const DEFAULT_IHR_DATA: IhrCompliance[] = (
  [
    { country: 'United States', iso3: 'USA', capacityScore: 0, legislationScore: 88, coordinationScore: 84, surveillanceScore: 86, responseScore: 82, lastReportYear: 2023 },
    { country: 'Japan',         iso3: 'JPN', capacityScore: 0, legislationScore: 85, coordinationScore: 80, surveillanceScore: 84, responseScore: 79, lastReportYear: 2023 },
    { country: 'Brazil',        iso3: 'BRA', capacityScore: 0, legislationScore: 68, coordinationScore: 62, surveillanceScore: 64, responseScore: 60, lastReportYear: 2022 },
    { country: 'India',         iso3: 'IND', capacityScore: 0, legislationScore: 60, coordinationScore: 55, surveillanceScore: 58, responseScore: 54, lastReportYear: 2022 },
    { country: 'Nigeria',       iso3: 'NGA', capacityScore: 0, legislationScore: 42, coordinationScore: 38, surveillanceScore: 40, responseScore: 36, lastReportYear: 2022 },
    { country: 'DRC',           iso3: 'COD', capacityScore: 0, legislationScore: 32, coordinationScore: 28, surveillanceScore: 30, responseScore: 26, lastReportYear: 2021 },
  ] as IhrCompliance[]
).map((r) => ({ ...r, capacityScore: computeIhrCapacityScore(r) }));

const DEFAULT_WARNING_DATA: EarlyWarningCoverage[] = [
  { region: 'North America',      sentinelSitesCoverage: 0.85, labNetworkCoverage: 0.9, reportingTimelinessScore: 88, zoonoticSurveillance: true,  eventBasedSurveillance: true  },
  { region: 'Western Europe',     sentinelSitesCoverage: 0.8, labNetworkCoverage: 0.88, reportingTimelinessScore: 85, zoonoticSurveillance: true,  eventBasedSurveillance: true  },
  { region: 'East Asia',          sentinelSitesCoverage: 0.7, labNetworkCoverage: 0.75, reportingTimelinessScore: 72, zoonoticSurveillance: true,  eventBasedSurveillance: true  },
  { region: 'Latin America',      sentinelSitesCoverage: 0.5, labNetworkCoverage: 0.55, reportingTimelinessScore: 58, zoonoticSurveillance: false, eventBasedSurveillance: true  },
  { region: 'Sub-Saharan Africa', sentinelSitesCoverage: 0.25, labNetworkCoverage: 0.3, reportingTimelinessScore: 40, zoonoticSurveillance: false, eventBasedSurveillance: false },
  { region: 'South Asia',         sentinelSitesCoverage: 0.4, labNetworkCoverage: 0.45, reportingTimelinessScore: 50, zoonoticSurveillance: false, eventBasedSurveillance: true  },
  { region: 'Middle East',        sentinelSitesCoverage: 0.45, labNetworkCoverage: 0.5, reportingTimelinessScore: 55, zoonoticSurveillance: false, eventBasedSurveillance: false },
];

const DEFAULT_COORDINATION_DATA: CrossBorderCoordination[] = [
  { region: 'North America',      jointExercisesLast2Years: 4, informationSharingAgreements: 8,  rapidResponseTeamAvailable: true,  coordinationScore: 82 },
  { region: 'Western Europe',     jointExercisesLast2Years: 6, informationSharingAgreements: 14, rapidResponseTeamAvailable: true,  coordinationScore: 88 },
  { region: 'East Asia',          jointExercisesLast2Years: 2, informationSharingAgreements: 5,  rapidResponseTeamAvailable: true,  coordinationScore: 65 },
  { region: 'Latin America',      jointExercisesLast2Years: 1, informationSharingAgreements: 3,  rapidResponseTeamAvailable: false, coordinationScore: 45 },
  { region: 'Sub-Saharan Africa', jointExercisesLast2Years: 1, informationSharingAgreements: 2,  rapidResponseTeamAvailable: false, coordinationScore: 30 },
  { region: 'South Asia',         jointExercisesLast2Years: 1, informationSharingAgreements: 3,  rapidResponseTeamAvailable: false, coordinationScore: 38 },
  { region: 'Middle East',        jointExercisesLast2Years: 1, informationSharingAgreements: 2,  rapidResponseTeamAvailable: false, coordinationScore: 35 },
];

export const DEFAULT_PANDEMIC_INPUT: PandemicInput = {
  ghsScores: DEFAULT_GHS_SCORES,
  stockpiles: DEFAULT_STOCKPILES,
  surgeData: DEFAULT_SURGE_DATA,
  ihrData: DEFAULT_IHR_DATA,
  warningData: DEFAULT_WARNING_DATA,
  coordinationData: DEFAULT_COORDINATION_DATA,
  asOf: '2024-01-01',
};

// ── Remaining pure functions ───────────────────────────────────────────────

export function computeRiskTier(score: number): PandemicRiskTier {
  if (score <= 20) return 'critical';
  if (score <= 40) return 'high';
  if (score <= 60) return 'moderate';
  if (score <= 80) return 'low';
  return 'minimal';
}

export function scoreLabel(score: number): string {
  const clamped = Math.round(Math.min(100, Math.max(0, score)));
  if (clamped >= 81) return `Excellent (${clamped}/100)`;
  if (clamped >= 61) return `Good (${clamped}/100)`;
  if (clamped >= 41) return `Moderate (${clamped}/100)`;
  if (clamped >= 21) return `Poor (${clamped}/100)`;
  return `Critical (${clamped}/100)`;
}

export function isStockpileConcerning(stockpile: VaccineStockpile): boolean {
  return !stockpile.adequate || stockpile.expiryRisk === 'high' || stockpile.dosesCoverage < 0.5;
}

export function aggregateCoordinationScore(regions: CrossBorderCoordination[]): number {
  if (regions.length === 0) return 0;
  return Math.round(regions.reduce((s, r) => s + r.coordinationScore, 0) / regions.length);
}

export function getGhsLeaders(scores: GhsIndexScore[], n = 5): GhsIndexScore[] {
  return [...scores]
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, n);
}

export function getGhsLaggards(scores: GhsIndexScore[], n = 5): GhsIndexScore[] {
  return [...scores]
    .sort((a, b) => a.overallScore - b.overallScore)
    .slice(0, n);
}

// ── computeGlobalReadinessScore sub-helpers ───────────────────────────────

function ghsAvgScore(ghs: GhsIndexScore[]): number {
  if (ghs.length === 0) return 0;
  return ghs.reduce((s, g) => s + g.overallScore, 0) / ghs.length;
}

function surgeAvgScore(surge: SurgeCapacity[]): number {
  if (surge.length === 0) return 0;
  return surge.reduce((s, r) => {
    const score = r.surgeReadinessScore > 0 ? r.surgeReadinessScore : computeSurgeReadinessScore(r);
    return s + score;
  }, 0) / surge.length;
}

function ihrAvgScore(ihr: IhrCompliance[]): number {
  if (ihr.length === 0) return 0;
  return ihr.reduce((s, r) => {
    const score = r.capacityScore > 0 ? r.capacityScore : computeIhrCapacityScore(r);
    return s + score;
  }, 0) / ihr.length;
}

function vaccineAvgScore(stockpiles: VaccineStockpile[]): number {
  if (stockpiles.length === 0) return 0;
  return (stockpiles.reduce((s, v) => s + v.dosesCoverage, 0) / stockpiles.length) * 100;
}

function warningAvgScore(warning: EarlyWarningCoverage[]): number {
  if (warning.length === 0) return 0;
  return warning.reduce((s, w) => {
    const cov = ((w.sentinelSitesCoverage + w.labNetworkCoverage) / 2) * 100;
    return s + (cov * 0.5 + w.reportingTimelinessScore * 0.5);
  }, 0) / warning.length;
}

export function computeGlobalReadinessScore(input: PandemicInput): number {
  const ghs      = input.ghsScores        ?? DEFAULT_PANDEMIC_INPUT.ghsScores!;
  const surge    = input.surgeData        ?? DEFAULT_PANDEMIC_INPUT.surgeData!;
  const ihr      = input.ihrData          ?? DEFAULT_PANDEMIC_INPUT.ihrData!;
  const stocks   = input.stockpiles       ?? DEFAULT_PANDEMIC_INPUT.stockpiles!;
  const warning  = input.warningData      ?? DEFAULT_PANDEMIC_INPUT.warningData!;
  const coord    = input.coordinationData ?? DEFAULT_PANDEMIC_INPUT.coordinationData!;

  const weighted =
    ghsAvgScore(ghs)        * 0.3 +
    surgeAvgScore(surge)    * 0.2 +
    ihrAvgScore(ihr)        * 0.2 +
    vaccineAvgScore(stocks) * 0.15 +
    warningAvgScore(warning)* 0.1 +
    aggregateCoordinationScore(coord) * 0.05;

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

// ── identifyTopVulnerabilities sub-helpers ────────────────────────────────

interface ScoredVuln { score: number; label: string }

function ghsVulnerabilities(ghs: GhsIndexScore[]): ScoredVuln[] {
  const result: ScoredVuln[] = [];
  if (ghs.length === 0) return result;
  const avg = ghs.reduce((s, g) => s + g.overallScore, 0) / ghs.length;
  if (avg < 40) {
    result.push({ score: 100 - avg, label: 'Global GHS Index scores critically low — most countries lack basic pandemic capacity' });
  } else if (avg < 55) {
    result.push({ score: 100 - avg, label: 'Majority of countries show inadequate pandemic preparedness (GHS < 55)' });
  }
  const laggards = getGhsLaggards(ghs, 3);
  if (laggards.length > 0 && laggards[0]!.overallScore < 30) {
    result.push({ score: 100 - laggards[0]!.overallScore, label: `Extreme preparedness gaps in ${laggards.map((l) => l.country).join(', ')}` });
  }
  return result;
}

function stockpileVulnerabilities(stockpiles: VaccineStockpile[]): ScoredVuln[] {
  const concerning = stockpiles.filter((s) => isStockpileConcerning(s));
  if (concerning.length >= 3) {
    return [{ score: 85, label: `${concerning.length} of ${stockpiles.length} vaccine stockpiles inadequate or at expiry risk` }];
  }
  if (concerning.length > 0) {
    return [{ score: 60, label: `${concerning.length} vaccine stockpile(s) below adequate threshold` }];
  }
  return [];
}

function surgeVulnerabilities(surge: SurgeCapacity[]): ScoredVuln[] {
  const lowSurge = surge.filter((r) => {
    const s = r.surgeReadinessScore > 0 ? r.surgeReadinessScore : computeSurgeReadinessScore(r);
    return s < 20;
  });
  if (lowSurge.length > 0) {
    return [{ score: 80, label: `Critical ICU/ventilator shortfall in: ${lowSurge.map((r) => r.region).join(', ')}` }];
  }
  return [];
}

function warningVulnerabilities(warning: EarlyWarningCoverage[]): ScoredVuln[] {
  const noZoonotic = warning.filter((w) => !w.zoonoticSurveillance);
  if (noZoonotic.length > warning.length / 2) {
    return [{ score: 75, label: `Zoonotic surveillance absent in ${noZoonotic.length} regions — early detection risk` }];
  }
  return [];
}

function coordVulnerabilities(coord: CrossBorderCoordination[]): ScoredVuln[] {
  const noRRT = coord.filter((c) => !c.rapidResponseTeamAvailable);
  if (noRRT.length > coord.length / 2) {
    return [{ score: 65, label: `No rapid response team in ${noRRT.length} regions — cross-border response limited` }];
  }
  return [];
}

function ihrVulnerabilities(ihr: IhrCompliance[]): ScoredVuln[] {
  const lowIhr = ihr.filter((r) => {
    const s = r.capacityScore > 0 ? r.capacityScore : computeIhrCapacityScore(r);
    return s < 40;
  });
  if (lowIhr.length > 0) {
    return [{ score: 70, label: `Low IHR compliance in ${lowIhr.map((r) => r.country).join(', ')}` }];
  }
  return [];
}

export function identifyTopVulnerabilities(input: PandemicInput): string[] {
  const ghs      = input.ghsScores        ?? DEFAULT_PANDEMIC_INPUT.ghsScores!;
  const stocks   = input.stockpiles       ?? DEFAULT_PANDEMIC_INPUT.stockpiles!;
  const surge    = input.surgeData        ?? DEFAULT_PANDEMIC_INPUT.surgeData!;
  const warning  = input.warningData      ?? DEFAULT_PANDEMIC_INPUT.warningData!;
  const coord    = input.coordinationData ?? DEFAULT_PANDEMIC_INPUT.coordinationData!;
  const ihr      = input.ihrData          ?? DEFAULT_PANDEMIC_INPUT.ihrData!;

  const vulnerabilities: ScoredVuln[] = [
    ...ghsVulnerabilities(ghs),
    ...stockpileVulnerabilities(stocks),
    ...surgeVulnerabilities(surge),
    ...warningVulnerabilities(warning),
    ...coordVulnerabilities(coord),
    ...ihrVulnerabilities(ihr),
  ];

  const sorted = [...vulnerabilities].sort((a, b) => b.score - a.score);
  return sorted.slice(0, 5).map((v) => v.label);
}

export function assessPandemicPreparedness(input: PandemicInput): PandemicPreparednessAssessment {
  const ghsScores  = input.ghsScores        ?? DEFAULT_PANDEMIC_INPUT.ghsScores!;
  const stockpiles = input.stockpiles       ?? DEFAULT_PANDEMIC_INPUT.stockpiles!;
  const surgeData  = (input.surgeData       ?? DEFAULT_PANDEMIC_INPUT.surgeData!).map((r) => ({
    ...r,
    surgeReadinessScore: r.surgeReadinessScore > 0 ? r.surgeReadinessScore : computeSurgeReadinessScore(r),
  }));
  const ihrData    = (input.ihrData         ?? DEFAULT_PANDEMIC_INPUT.ihrData!).map((r) => ({
    ...r,
    capacityScore: r.capacityScore > 0 ? r.capacityScore : computeIhrCapacityScore(r),
  }));
  const warningData = input.warningData      ?? DEFAULT_PANDEMIC_INPUT.warningData!;
  const coordData   = input.coordinationData ?? DEFAULT_PANDEMIC_INPUT.coordinationData!;
  const asOf        = input.asOf             ?? DEFAULT_PANDEMIC_INPUT.asOf!;

  const globalReadinessScore = computeGlobalReadinessScore(input);

  return {
    globalReadinessScore,
    riskTier: computeRiskTier(globalReadinessScore),
    topVulnerabilities: identifyTopVulnerabilities(input),
    ghsLeaders: getGhsLeaders(ghsScores, 5),
    ghsLaggards: getGhsLaggards(ghsScores, 5),
    vaccineAdequacy: stockpiles,
    surgeCapacities: surgeData,
    ihrCompliance: ihrData,
    earlyWarningCoverage: warningData,
    crossBorderCoordination: coordData,
    lastUpdated: asOf,
  };
}
