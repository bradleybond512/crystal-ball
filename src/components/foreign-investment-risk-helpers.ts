// foreign-investment-risk-helpers.ts
// Pure logic for ForeignInvestmentRiskPanel — no DOM, no Panel imports

export interface FDITransaction {
  id: string;
  acquirer: string;
  acquirerCountry: string;
  target: string;
  targetSector: string;
  dealValueBn: number;
  status: 'Approved' | 'Blocked' | 'Pending' | 'Withdrawn' | 'Conditioned';
  reviewBody: string;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  year: number;
  notes: string;
}

export interface SectorExposure {
  sector: string;
  foreignOwnershipPct: number;
  sensitivityLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  topForeignActors: string[];
  recentDeals: number;
}

export interface FDIRenderData {
  transactions: FDITransaction[];
  sectorExposures: SectorExposure[];
  blockRate: number;
  approvalRate: number;
  pendingCount: number;
  highRiskCount: number;
  totalValueBn: number;
  totalValueBlockedBn: number;
}

const TRANSACTIONS: FDITransaction[] = [
  { id: 'T001', acquirer: 'Broadcom', acquirerCountry: 'Singapore/US', target: 'Qualcomm', targetSector: 'Semiconductors', dealValueBn: 117, status: 'Blocked', reviewBody: 'CFIUS', riskLevel: 'Critical', year: 2018, notes: 'National security — chip supply chain dominance' },
  { id: 'T002', acquirer: 'ByteDance', acquirerCountry: 'China', target: 'TikTok US', targetSector: 'Social Media', dealValueBn: 0, status: 'Pending', reviewBody: 'CFIUS', riskLevel: 'High', year: 2020, notes: 'Data access to 170M US users; divestiture ordered' },
  { id: 'T003', acquirer: 'Nvidia', acquirerCountry: 'USA', target: 'ARM Holdings', targetSector: 'Semiconductors', dealValueBn: 66, status: 'Withdrawn', reviewBody: 'FTC / EC', riskLevel: 'High', year: 2022, notes: 'Antitrust — would control foundational chip IP' },
  { id: 'T004', acquirer: 'G42 (Abu Dhabi)', acquirerCountry: 'UAE', target: 'US AI startups', targetSector: 'Artificial Intelligence', dealValueBn: 1.5, status: 'Conditioned', reviewBody: 'CFIUS', riskLevel: 'High', year: 2024, notes: 'Microsoft partnership approved; Huawei ties required divestiture' },
  { id: 'T005', acquirer: 'ChemChina', acquirerCountry: 'China', target: 'Syngenta', targetSector: 'Agriculture', dealValueBn: 43, status: 'Conditioned', reviewBody: 'CFIUS', riskLevel: 'Medium', year: 2016, notes: 'Approved; required US ag-data firewall' },
  { id: 'T006', acquirer: 'Mubadala (UAE)', acquirerCountry: 'UAE', target: 'GlobalFoundries', targetSector: 'Semiconductors', dealValueBn: 4.5, status: 'Approved', reviewBody: 'CFIUS', riskLevel: 'Medium', year: 2020, notes: 'Approved with security agreement' },
  { id: 'T007', acquirer: 'HKEX', acquirerCountry: 'Hong Kong', target: 'London Metal Exchange', targetSector: 'Finance', dealValueBn: 2.2, status: 'Blocked', reviewBody: 'UK NSIA', riskLevel: 'High', year: 2012, notes: 'Foreign control of global commodities pricing' },
  { id: 'T008', acquirer: 'Huawei', acquirerCountry: 'China', target: '5G Infrastructure', targetSector: 'Telecom', dealValueBn: 8, status: 'Blocked', reviewBody: 'FCC / Five Eyes', riskLevel: 'Critical', year: 2019, notes: 'Banned from core network across Five Eyes nations' },
  { id: 'T009', acquirer: 'SoftBank', acquirerCountry: 'Japan', target: 'T-Mobile US', targetSector: 'Telecom', dealValueBn: 26, status: 'Approved', reviewBody: 'DOJ / FCC', riskLevel: 'Low', year: 2018, notes: 'Approved after spectrum divestiture commitments' },
  { id: 'T010', acquirer: 'State Grid China', acquirerCountry: 'China', target: 'Ausgrid (Australia)', targetSector: 'Energy', dealValueBn: 7.7, status: 'Blocked', reviewBody: 'FIRB', riskLevel: 'Critical', year: 2016, notes: 'Blocked — critical infrastructure supplying Sydney metro' },
];

const SECTOR_EXPOSURES: SectorExposure[] = [
  { sector: 'Defense / Aerospace', foreignOwnershipPct: 3, sensitivityLevel: 'Critical', topForeignActors: ['UK', 'Australia', 'France'], recentDeals: 2 },
  { sector: 'Semiconductors', foreignOwnershipPct: 28, sensitivityLevel: 'Critical', topForeignActors: ['Taiwan', 'South Korea', 'Japan'], recentDeals: 14 },
  { sector: 'Artificial Intelligence', foreignOwnershipPct: 22, sensitivityLevel: 'High', topForeignActors: ['UAE', 'Saudi Arabia', 'UK'], recentDeals: 31 },
  { sector: 'Telecom / 5G', foreignOwnershipPct: 19, sensitivityLevel: 'High', topForeignActors: ['Japan', 'Sweden', 'Finland'], recentDeals: 9 },
  { sector: 'Biotech / Pharma', foreignOwnershipPct: 38, sensitivityLevel: 'Medium', topForeignActors: ['Switzerland', 'UK', 'Germany'], recentDeals: 22 },
  { sector: 'Agriculture', foreignOwnershipPct: 14, sensitivityLevel: 'Medium', topForeignActors: ['Canada', 'Netherlands', 'China'], recentDeals: 7 },
  { sector: 'Finance / Banking', foreignOwnershipPct: 21, sensitivityLevel: 'Medium', topForeignActors: ['Canada', 'UK', 'Japan'], recentDeals: 18 },
  { sector: 'Energy Infrastructure', foreignOwnershipPct: 11, sensitivityLevel: 'High', topForeignActors: ['Canada', 'Norway', 'Saudi Arabia'], recentDeals: 5 },
];

export function computeBlockRate(txs: FDITransaction[]): number {
  if (!txs.length) return 0;
  return Math.round((txs.filter(t => t.status === 'Blocked').length / txs.length) * 100);
}

export function computeApprovalRate(txs: FDITransaction[]): number {
  if (!txs.length) return 0;
  return Math.round((txs.filter(t => t.status === 'Approved' || t.status === 'Conditioned').length / txs.length) * 100);
}

export function getPendingTransactions(txs: FDITransaction[]): FDITransaction[] {
  return txs.filter(t => t.status === 'Pending');
}

export function getHighRiskTransactions(txs: FDITransaction[]): FDITransaction[] {
  return txs.filter(t => t.riskLevel === 'High' || t.riskLevel === 'Critical');
}

export function getTotalValueBn(txs: FDITransaction[]): number {
  return txs.reduce((s, t) => s + t.dealValueBn, 0);
}

export function getBlockedValueBn(txs: FDITransaction[]): number {
  return txs.filter(t => t.status === 'Blocked').reduce((s, t) => s + t.dealValueBn, 0);
}

export function getCriticalSectors(sectors: SectorExposure[]): SectorExposure[] {
  return sectors.filter(s => s.sensitivityLevel === 'Critical' || s.sensitivityLevel === 'High');
}

export function rankSectorsByExposure(sectors: SectorExposure[]): SectorExposure[] {
  return [...sectors].sort((a, b) => b.foreignOwnershipPct - a.foreignOwnershipPct);
}

export function statusBadgeClass(status: FDITransaction['status']): string {
  const map: Record<string, string> = { Blocked: 'status-critical', Pending: 'status-warn', Conditioned: 'status-medium', Withdrawn: 'status-low', Approved: 'status-ok' };
  return map[status] ?? 'status-low';
}

export function riskClass(level: string): string {
  const map: Record<string, string> = { Critical: 'risk-critical', High: 'risk-high', Medium: 'risk-medium', Low: 'risk-low' };
  return map[level] ?? 'risk-low';
}

export function buildRenderData(): FDIRenderData {
  return {
    transactions: TRANSACTIONS,
    sectorExposures: SECTOR_EXPOSURES,
    blockRate: computeBlockRate(TRANSACTIONS),
    approvalRate: computeApprovalRate(TRANSACTIONS),
    pendingCount: getPendingTransactions(TRANSACTIONS).length,
    highRiskCount: getHighRiskTransactions(TRANSACTIONS).length,
    totalValueBn: getTotalValueBn(TRANSACTIONS),
    totalValueBlockedBn: getBlockedValueBn(TRANSACTIONS),
  };
}
