// coup-risk-helpers.ts
// Pure logic for CoupRiskPanel — no DOM, no Panel imports

export interface CoupRiskCountry {
  id: string;
  country: string;
  region: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  riskScore: number; // 0-100
  militaryInfluence: number; // 0-10
  economicCrisis: number; // 0-10
  protestIntensity: number; // 0-10
  civilMilitaryTension: number; // 0-10
  recentMutinyAttempt: boolean;
  lastCoupAttempt: number | null; // year
  trend: 'rising' | 'stable' | 'falling';
  keyFactors: string[];
}

export interface RecentCoup {
  id: string;
  country: string;
  year: number;
  type: 'successful' | 'attempted' | 'self-coup';
  method: string;
  outcome: string;
}

export interface CoupRiskData {
  countries: CoupRiskCountry[];
  recentCoups: RecentCoup[];
  lastUpdated: string;
  globalCoupRiskIndex: number; // 0-100
}

export const COUP_RISK_COUNTRIES: CoupRiskCountry[] = [
  { id: 'myanmar', country: 'Myanmar', region: 'Southeast Asia', riskLevel: 'critical', riskScore: 92, militaryInfluence: 10, economicCrisis: 9, protestIntensity: 8, civilMilitaryTension: 10, recentMutinyAttempt: true, lastCoupAttempt: 2021, trend: 'rising', keyFactors: ['Military junta in power since 2021', 'Active civil war', 'International sanctions', 'Economy collapsed 30%'] },
  { id: 'sudan', country: 'Sudan', region: 'East Africa', riskLevel: 'critical', riskScore: 88, militaryInfluence: 9, economicCrisis: 9, protestIntensity: 7, civilMilitaryTension: 9, recentMutinyAttempt: true, lastCoupAttempt: 2021, trend: 'rising', keyFactors: ['SAF-RSF civil war ongoing', 'Civilian government ousted 2021', 'Hyperinflation', 'RSF faction control'] },
  { id: 'burkina-faso', country: 'Burkina Faso', region: 'West Africa', riskLevel: 'critical', riskScore: 85, militaryInfluence: 9, economicCrisis: 8, protestIntensity: 6, civilMilitaryTension: 8, recentMutinyAttempt: false, lastCoupAttempt: 2022, trend: 'stable', keyFactors: ['Two coups in 2022', 'Junta government', 'Jihadist territorial pressure', 'France expelled'] },
  { id: 'mali', country: 'Mali', region: 'West Africa', riskLevel: 'high', riskScore: 75, militaryInfluence: 9, economicCrisis: 7, protestIntensity: 5, civilMilitaryTension: 7, recentMutinyAttempt: false, lastCoupAttempt: 2021, trend: 'stable', keyFactors: ['Junta rule since 2021', 'Transition negotiations stalled', 'ECOWAS sanctions lifted', 'Wagner/Africa Corps presence'] },
  { id: 'niger', country: 'Niger', region: 'West Africa', riskLevel: 'high', riskScore: 72, militaryInfluence: 8, economicCrisis: 7, protestIntensity: 5, civilMilitaryTension: 8, recentMutinyAttempt: false, lastCoupAttempt: 2023, trend: 'stable', keyFactors: ['Coup July 2023', 'ECOWAS threatened intervention', 'US base access revoked', 'Alliance with Mali/Burkina Faso'] },
  { id: 'guinea', country: 'Guinea', region: 'West Africa', riskLevel: 'high', riskScore: 70, militaryInfluence: 8, economicCrisis: 6, protestIntensity: 5, civilMilitaryTension: 7, recentMutinyAttempt: false, lastCoupAttempt: 2021, trend: 'stable', keyFactors: ['Military coup Sept 2021', 'Transition timeline disputed', 'Bauxite wealth contested', 'Political prisoners'] },
  { id: 'venezuela', country: 'Venezuela', region: 'Latin America', riskLevel: 'high', riskScore: 65, militaryInfluence: 7, economicCrisis: 8, protestIntensity: 6, civilMilitaryTension: 6, recentMutinyAttempt: true, lastCoupAttempt: 2019, trend: 'falling', keyFactors: ['Maduro disputed 2024 election', 'Opposition crackdown', 'Military loyalty buying', 'US sanctions'] },
  { id: 'ethiopia', country: 'Ethiopia', region: 'East Africa', riskLevel: 'medium', riskScore: 55, militaryInfluence: 6, economicCrisis: 7, protestIntensity: 6, civilMilitaryTension: 6, recentMutinyAttempt: false, lastCoupAttempt: null, trend: 'stable', keyFactors: ['Amhara Fano rebellion', 'Ethnic tensions', 'IMF debt restructuring', 'Abiy Ahmed consolidating power'] },
  { id: 'pakistan', country: 'Pakistan', region: 'South Asia', riskLevel: 'medium', riskScore: 52, militaryInfluence: 8, economicCrisis: 6, protestIntensity: 6, civilMilitaryTension: 7, recentMutinyAttempt: false, lastCoupAttempt: null, trend: 'stable', keyFactors: ['Imran Khan imprisoned', 'Army-civilian tension', 'Economic crisis 2023', 'IMF bailout dependency'] },
  { id: 'bangladesh', country: 'Bangladesh', region: 'South Asia', riskLevel: 'medium', riskScore: 50, militaryInfluence: 6, economicCrisis: 5, protestIntensity: 7, civilMilitaryTension: 5, recentMutinyAttempt: false, lastCoupAttempt: 2007, trend: 'falling', keyFactors: ['Sheikh Hasina fled Aug 2024', 'Interim government', 'Student protest movement', 'Military caretaker role'] },
  { id: 'bolivia', country: 'Bolivia', region: 'Latin America', riskLevel: 'medium', riskScore: 45, militaryInfluence: 5, economicCrisis: 6, protestIntensity: 5, civilMilitaryTension: 5, recentMutinyAttempt: true, lastCoupAttempt: 2024, trend: 'falling', keyFactors: ['Failed coup attempt June 2024', 'Political polarization', 'Lithium wealth disputes', 'MAS internal split'] },
  { id: 'gabon', country: 'Gabon', region: 'Central Africa', riskLevel: 'medium', riskScore: 42, militaryInfluence: 7, economicCrisis: 4, protestIntensity: 3, civilMilitaryTension: 5, recentMutinyAttempt: false, lastCoupAttempt: 2023, trend: 'falling', keyFactors: ['Coup August 2023', 'Transition committee in place', 'Oil revenue stability', 'France influence reduced'] },
];

export const RECENT_COUPS: RecentCoup[] = [
  { id: 'myanmar-2021', country: 'Myanmar', year: 2021, type: 'successful', method: 'Military takeover, NLD government arrested', outcome: 'Junta rule, civil war ongoing' },
  { id: 'mali-2021', country: 'Mali', year: 2021, type: 'successful', method: 'Second military coup, transitional president ousted', outcome: 'Junta rule, ECOWAS sanctions' },
  { id: 'guinea-2021', country: 'Guinea', year: 2021, type: 'successful', method: 'Special Forces coup, Alpha Condé arrested', outcome: 'Military transition government' },
  { id: 'sudan-2021', country: 'Sudan', year: 2021, type: 'successful', method: 'SAF coup, PM Hamdok arrested', outcome: 'Military council, later civil war' },
  { id: 'burkina-2022a', country: 'Burkina Faso', year: 2022, type: 'successful', method: 'Army mutiny, President Kaboré ousted', outcome: 'Lt Col Damiba as transitional leader' },
  { id: 'burkina-2022b', country: 'Burkina Faso', year: 2022, type: 'successful', method: 'Second coup, Damiba overthrown', outcome: 'Capt Ibrahim Traoré as president' },
  { id: 'niger-2023', country: 'Niger', year: 2023, type: 'successful', method: 'Presidential Guard coup, Bazoum detained', outcome: 'CNSP junta, ECOWAS standoff' },
  { id: 'bolivia-2024', country: 'Bolivia', year: 2024, type: 'attempted', method: 'Military vehicles stormed Plaza Murillo', outcome: 'Failed within hours, general arrested' },
];

export function getByRiskLevel(
  countries: CoupRiskCountry[],
  riskLevel: CoupRiskCountry['riskLevel'],
): CoupRiskCountry[] {
  return countries.filter((c) => c.riskLevel === riskLevel);
}

export function getCriticalRisk(countries: CoupRiskCountry[]): CoupRiskCountry[] {
  return countries.filter((c) => c.riskLevel === 'critical');
}

export function getByRegion(countries: CoupRiskCountry[], region: string): CoupRiskCountry[] {
  return countries.filter((c) => c.region === region);
}

export function getRisingTrend(countries: CoupRiskCountry[]): CoupRiskCountry[] {
  return countries.filter((c) => c.trend === 'rising');
}

export function getRecentCoupsByType(
  coups: RecentCoup[],
  type: RecentCoup['type'],
): RecentCoup[] {
  return coups.filter((c) => c.type === type);
}

export function computeGlobalCoupRiskIndex(countries: CoupRiskCountry[]): number {
  if (!countries.length) return 0;
  const weightFor = (level: CoupRiskCountry['riskLevel']): number => {
    if (level === 'critical') return 2;
    if (level === 'high') return 1.5;
    if (level === 'medium') return 1;
    return 0.5;
  };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of countries) {
    const w = weightFor(c.riskLevel);
    weightedSum += c.riskScore * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(weightedSum / weightTotal)));
}

export function riskLevelClass(level: CoupRiskCountry['riskLevel']): string {
  const map: Record<CoupRiskCountry['riskLevel'], string> = {
    critical: 'coup-critical',
    high: 'coup-high',
    medium: 'coup-medium',
    low: 'coup-low',
  };
  return map[level] ?? 'coup-medium';
}

export function trendClass(trend: CoupRiskCountry['trend']): string {
  const map: Record<CoupRiskCountry['trend'], string> = {
    rising: 'coup-trend-up',
    stable: 'coup-trend-flat',
    falling: 'coup-trend-down',
  };
  return map[trend] ?? 'coup-trend-flat';
}

export function trendArrow(trend: CoupRiskCountry['trend']): string {
  return { rising: '↑', stable: '→', falling: '↓' }[trend] ?? '→';
}

export function buildRenderData(): CoupRiskData {
  return {
    countries: COUP_RISK_COUNTRIES,
    recentCoups: RECENT_COUPS,
    lastUpdated: '2024',
    globalCoupRiskIndex: computeGlobalCoupRiskIndex(COUP_RISK_COUNTRIES),
  };
}
