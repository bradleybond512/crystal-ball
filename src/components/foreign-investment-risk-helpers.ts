// foreign-investment-risk-helpers.ts — CFIUS-style FDI screening and strategic acquisition tracking

export type InvestorNation = 'China' | 'Russia' | 'Saudi Arabia' | 'UAE' | 'Qatar' | 'Iran' | 'DPRK' | 'Venezuela';
export type TargetSector = 'semiconductors' | 'telecom' | 'defense' | 'biotech' | 'AI' | 'energy' | 'ports' | 'media' | 'mining' | 'finance';
export type ReviewOutcome = 'approved' | 'blocked' | 'withdrawn' | 'pending' | 'approved-with-mitigation';
export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low';

export interface FDITransaction {
  id: string;
  acquirer: string;
  acquirerNation: InvestorNation;
  targetCompany: string;
  targetNation: string;
  targetSector: TargetSector;
  dealValueBn: number;
  reviewBody: string;
  outcome: ReviewOutcome;
  year: number;
  strategicConcern: string;
  riskScore: number;
}

export interface SectorExposure {
  sector: TargetSector;
  foreignControlledPct: number;
  criticalInfraFlag: boolean;
  dominantInvestorNation: InvestorNation;
  pendingReviewCount: number;
}

const MOCK_TRANSACTIONS: FDITransaction[] = [
  { id: 'broadcom-qualcomm', acquirer: 'Broadcom (Singapore)', acquirerNation: 'China', targetCompany: 'Qualcomm', targetNation: 'USA', targetSector: 'semiconductors', dealValueBn: 117, reviewBody: 'CFIUS', outcome: 'blocked', year: 2018, strategicConcern: 'US 5G semiconductor leadership at risk', riskScore: 95 },
  { id: 'bytedance-tiktok', acquirer: 'ByteDance', acquirerNation: 'China', targetCompany: 'TikTok US Operations', targetNation: 'USA', targetSector: 'media', dealValueBn: 12, reviewBody: 'CFIUS', outcome: 'pending', year: 2020, strategicConcern: 'Mass data collection + influence operations vector', riskScore: 90 },
  { id: 'smic-asml', acquirer: 'SMIC', acquirerNation: 'China', targetCompany: 'ASML Technology licenses', targetNation: 'Netherlands', targetSector: 'semiconductors', dealValueBn: 2, reviewBody: 'Dutch NCTV', outcome: 'blocked', year: 2019, strategicConcern: 'EUV lithography critical to military chip production', riskScore: 92 },
  { id: 'saudi-aramco-petronas', acquirer: 'Saudi Aramco', acquirerNation: 'Saudi Arabia', targetCompany: 'Petronas Downstream', targetNation: 'Malaysia', targetSector: 'energy', dealValueBn: 4.5, reviewBody: 'Malaysian MITI', outcome: 'approved', year: 2023, strategicConcern: 'GCC energy supply chain integration', riskScore: 38 },
  { id: 'china-norsk-hydro', acquirer: 'Chinalco', acquirerNation: 'China', targetCompany: 'Norsk Hydro rare earth assets', targetNation: 'Norway', targetSector: 'mining', dealValueBn: 1.8, reviewBody: 'Norwegian MoD', outcome: 'blocked', year: 2022, strategicConcern: 'Rare earth strategic supply chain control', riskScore: 85 },
  { id: 'huawei-bt', acquirer: 'Huawei', acquirerNation: 'China', targetCompany: 'BT Group 5G contract', targetNation: 'UK', targetSector: 'telecom', dealValueBn: 0.5, reviewBody: 'NCSC/DCMS', outcome: 'blocked', year: 2020, strategicConcern: 'Core network access for intelligence collection', riskScore: 88 },
  { id: 'uae-mclaren', acquirer: 'Mubadala', acquirerNation: 'UAE', targetCompany: 'McLaren Applied', targetNation: 'UK', targetSector: 'AI', dealValueBn: 0.35, reviewBody: 'BEIS', outcome: 'approved-with-mitigation', year: 2023, strategicConcern: 'Advanced telemetry and AI algorithms', riskScore: 45 },
  { id: 'cn-ports-piraeus', acquirer: 'COSCO Shipping', acquirerNation: 'China', targetCompany: 'Piraeus Port Authority', targetNation: 'Greece', targetSector: 'ports', dealValueBn: 1.5, reviewBody: 'EC DG GROW', outcome: 'approved', year: 2016, strategicConcern: 'EU entry port strategic control + dual military use', riskScore: 78 },
  { id: 'cn-globalwafers', acquirer: 'Sino-American Silicon', acquirerNation: 'China', targetCompany: 'GlobalWafers', targetNation: 'USA', targetSector: 'semiconductors', dealValueBn: 5, reviewBody: 'CFIUS', outcome: 'withdrawn', year: 2022, strategicConcern: 'Silicon wafer supply for defense semiconductors', riskScore: 87 },
  { id: 'qatar-heathrow', acquirer: 'Qatar Investment Authority', acquirerNation: 'Qatar', targetCompany: 'Heathrow Airport Holdings', targetNation: 'UK', targetSector: 'ports', dealValueBn: 3.2, reviewBody: 'UK NSI Act', outcome: 'approved-with-mitigation', year: 2023, strategicConcern: 'Critical national infrastructure with dual-use potential', riskScore: 42 },
];

const MOCK_SECTOR_EXPOSURE: SectorExposure[] = [
  { sector: 'semiconductors', foreignControlledPct: 35, criticalInfraFlag: true, dominantInvestorNation: 'China', pendingReviewCount: 4 },
  { sector: 'telecom', foreignControlledPct: 28, criticalInfraFlag: true, dominantInvestorNation: 'China', pendingReviewCount: 2 },
  { sector: 'ports', foreignControlledPct: 42, criticalInfraFlag: true, dominantInvestorNation: 'China', pendingReviewCount: 1 },
  { sector: 'AI', foreignControlledPct: 22, criticalInfraFlag: false, dominantInvestorNation: 'UAE', pendingReviewCount: 3 },
  { sector: 'energy', foreignControlledPct: 18, criticalInfraFlag: true, dominantInvestorNation: 'Saudi Arabia', pendingReviewCount: 2 },
  { sector: 'mining', foreignControlledPct: 31, criticalInfraFlag: true, dominantInvestorNation: 'China', pendingReviewCount: 3 },
  { sector: 'biotech', foreignControlledPct: 15, criticalInfraFlag: false, dominantInvestorNation: 'China', pendingReviewCount: 5 },
  { sector: 'media', foreignControlledPct: 12, criticalInfraFlag: false, dominantInvestorNation: 'China', pendingReviewCount: 1 },
];

export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'moderate';
  return 'low';
}

export function filterByOutcome(transactions: FDITransaction[], outcome: ReviewOutcome): FDITransaction[] {
  return transactions.filter(t => t.outcome === outcome);
}

export function filterByAcquirerNation(transactions: FDITransaction[], nation: InvestorNation): FDITransaction[] {
  return transactions.filter(t => t.acquirerNation === nation);
}

export function filterBySector(transactions: FDITransaction[], sector: TargetSector): FDITransaction[] {
  return transactions.filter(t => t.targetSector === sector);
}

export function rankByRisk(transactions: FDITransaction[]): FDITransaction[] {
  return [...transactions].sort((a, b) => b.riskScore - a.riskScore);
}

export function computeBlockRate(transactions: FDITransaction[]): number {
  if (!transactions.length) return 0;
  const blocked = transactions.filter(t => t.outcome === 'blocked' || t.outcome === 'withdrawn').length;
  return Math.round((blocked / transactions.length) * 100);
}

export function getTotalDealValue(transactions: FDITransaction[]): number {
  return Math.round(transactions.reduce((s, t) => s + t.dealValueBn, 0) * 10) / 10;
}

export function getAcquirerNationDistribution(transactions: FDITransaction[]): Record<InvestorNation, number> {
  const dist: Partial<Record<InvestorNation, number>> = {};
  for (const t of transactions) dist[t.acquirerNation] = (dist[t.acquirerNation] || 0) + 1;
  return dist as Record<InvestorNation, number>;
}

export function getCriticalSectors(exposures: SectorExposure[]): SectorExposure[] {
  return exposures.filter(e => e.criticalInfraFlag).sort((a, b) => b.foreignControlledPct - a.foreignControlledPct);
}

export function getTotalPendingReviews(exposures: SectorExposure[]): number {
  return exposures.reduce((s, e) => s + e.pendingReviewCount, 0);
}

export function buildRenderData(): {
  transactions: FDITransaction[];
  sectorExposures: SectorExposure[];
  blockRate: number;
  totalDealValueBn: number;
  totalPendingReviews: number;
  criticalSectors: SectorExposure[];
  nationDistribution: Record<InvestorNation, number>;
} {
  return {
    transactions: rankByRisk(MOCK_TRANSACTIONS),
    sectorExposures: MOCK_SECTOR_EXPOSURE,
    blockRate: computeBlockRate(MOCK_TRANSACTIONS),
    totalDealValueBn: getTotalDealValue(MOCK_TRANSACTIONS),
    totalPendingReviews: getTotalPendingReviews(MOCK_SECTOR_EXPOSURE),
    criticalSectors: getCriticalSectors(MOCK_SECTOR_EXPOSURE),
    nationDistribution: getAcquirerNationDistribution(MOCK_TRANSACTIONS),
  };
}
