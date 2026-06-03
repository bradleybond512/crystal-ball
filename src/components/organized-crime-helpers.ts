// organized-crime-helpers.ts — pure deterministic helpers

export type NetworkType = 'cartel' | 'mafia' | 'triad' | 'gang' | 'hybrid';
export type CrimeActivity = 'drug-trafficking' | 'human-trafficking' | 'extortion' | 'cybercrime' | 'arms-trafficking' | 'money-laundering';

export interface CriminalOrg {
  id: string;
  name: string;
  networkType: NetworkType;
  territory: string[];
  strengthScore: number;
  statePenetration: number;
  transnationalReach: number;
  primaryActivities: CrimeActivity[];
  annualRevenueUSD: number;
}

export interface TerritoryConflict {
  orgs: [string, string];
  region: string;
  intensity: 'high' | 'medium' | 'low';
  startDate: string;
}

const MOCK_ORGS: CriminalOrg[] = [
  { id: 'sinaloa', name: 'Sinaloa Cartel', networkType: 'cartel', territory: ['Mexico', 'USA', 'Central America'], strengthScore: 92, statePenetration: 75, transnationalReach: 88, primaryActivities: ['drug-trafficking', 'money-laundering', 'arms-trafficking'], annualRevenueUSD: 3_000_000_000 },
  { id: 'cjng', name: 'CJNG', networkType: 'cartel', territory: ['Mexico', 'Europe', 'Asia'], strengthScore: 88, statePenetration: 70, transnationalReach: 82, primaryActivities: ['drug-trafficking', 'extortion', 'cybercrime'], annualRevenueUSD: 2_500_000_000 },
  { id: 'ndrangheta', name: 'Ndrangheta', networkType: 'mafia', territory: ['Italy', 'Germany', 'Canada', 'Australia'], strengthScore: 85, statePenetration: 65, transnationalReach: 90, primaryActivities: ['drug-trafficking', 'money-laundering', 'human-trafficking'], annualRevenueUSD: 2_200_000_000 },
  { id: 'sun-yee-on', name: 'Sun Yee On Triad', networkType: 'triad', territory: ['Hong Kong', 'China', 'SE Asia', 'USA'], strengthScore: 78, statePenetration: 55, transnationalReach: 85, primaryActivities: ['drug-trafficking', 'cybercrime', 'human-trafficking'], annualRevenueUSD: 1_800_000_000 },
  { id: 'bratva', name: 'Solntsevskaya Bratva', networkType: 'mafia', territory: ['Russia', 'Eastern Europe', 'Israel'], strengthScore: 80, statePenetration: 72, transnationalReach: 80, primaryActivities: ['cybercrime', 'arms-trafficking', 'money-laundering'], annualRevenueUSD: 2_000_000_000 },
  { id: 'boko-haram-splinter', name: 'ISWAP Criminal Wing', networkType: 'hybrid', territory: ['Nigeria', 'Niger', 'Chad'], strengthScore: 72, statePenetration: 60, transnationalReach: 45, primaryActivities: ['extortion', 'human-trafficking', 'arms-trafficking'], annualRevenueUSD: 400_000_000 },
  { id: 'mara-salvatrucha', name: 'MS-13', networkType: 'gang', territory: ['El Salvador', 'USA', 'Honduras'], strengthScore: 65, statePenetration: 50, transnationalReach: 60, primaryActivities: ['extortion', 'drug-trafficking', 'human-trafficking'], annualRevenueUSD: 200_000_000 },
];

const MOCK_CONFLICTS: TerritoryConflict[] = [
  { orgs: ['sinaloa', 'cjng'], region: 'Northwest Mexico', intensity: 'high', startDate: '2025-01-01' },
  { orgs: ['sinaloa', 'cjng'], region: 'Guanajuato', intensity: 'high', startDate: '2024-06-01' },
  { orgs: ['ndrangheta', 'bratva'], region: 'Eastern Europe', intensity: 'medium', startDate: '2025-08-01' },
];

export function scoreOrganizationStrength(org: CriminalOrg): number {
  return Math.round(
    org.strengthScore * 0.4 +
    org.statePenetration * 0.25 +
    org.transnationalReach * 0.2 +
    Math.min(100, (org.annualRevenueUSD / 30_000_000)) * 0.15
  );
}

export function categorizeNetwork(org: CriminalOrg): NetworkType {
  return org.networkType;
}

export function assessStatePenetration(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function computeTransnationalReach(org: CriminalOrg): number {
  return Math.round((org.transnationalReach + org.territory.length * 5) / 2);
}

export function detectTerritoryConflicts(conflicts: TerritoryConflict[]): TerritoryConflict[] {
  return conflicts.filter(c => c.intensity === 'high');
}

export function estimateRevenue(orgs: CriminalOrg[]): number {
  return orgs.reduce((sum, o) => sum + o.annualRevenueUSD, 0);
}

export function rankOrgs(orgs: CriminalOrg[]): CriminalOrg[] {
  return [...orgs].sort((a, b) => scoreOrganizationStrength(b) - scoreOrganizationStrength(a));
}

export function buildRenderData(): {
  orgs: CriminalOrg[];
  conflicts: TerritoryConflict[];
  totalRevenue: number;
  highIntensityConflicts: number;
} {
  return {
    orgs: rankOrgs(MOCK_ORGS),
    conflicts: MOCK_CONFLICTS,
    totalRevenue: estimateRevenue(MOCK_ORGS),
    highIntensityConflicts: detectTerritoryConflicts(MOCK_CONFLICTS).length,
  };
}
