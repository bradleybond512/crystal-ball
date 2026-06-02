// space-weaponization-helpers.ts — pure deterministic helpers

export type SpacePowerNation = 'USA' | 'China' | 'Russia' | 'India' | 'Japan' | 'ESA' | 'DPRK' | 'Iran';
export type WeaponCategory = 'ASAT-KE' | 'ASAT-DEW' | 'co-orbital' | 'jamming' | 'spoofing' | 'cyber-space' | 'hypersonic';
export type ThreatTier = 'critical' | 'high' | 'medium' | 'low';

export interface SpaceWeaponProgram {
  id: string;
  nation: SpacePowerNation;
  category: WeaponCategory;
  name: string;
  developmentStage: 'operational' | 'testing' | 'development' | 'conceptual';
  orbitThreats: ('LEO' | 'MEO' | 'GEO' | 'all')[];
  debrisRisk: number; // 0-100
  strategicImpact: number; // 0-100
  deterrenceValue: number; // 0-100
  estimatedTestsCompleted: number;
}

export interface SpaceIncident {
  id: string;
  date: string;
  nation: SpacePowerNation;
  category: WeaponCategory;
  description: string;
  debrisGenerated: number; // trackable objects
  severity: ThreatTier;
}

const MOCK_PROGRAMS: SpaceWeaponProgram[] = [
  { id: 'cn-sc19', nation: 'China', category: 'ASAT-KE', name: 'SC-19 / DN-3 ASAT', developmentStage: 'operational', orbitThreats: ['LEO', 'MEO'], debrisRisk: 90, strategicImpact: 95, deterrenceValue: 85, estimatedTestsCompleted: 7 },
  { id: 'ru-nudol', nation: 'Russia', category: 'ASAT-KE', name: 'PL-19 Nudol (A-235)', developmentStage: 'operational', orbitThreats: ['LEO', 'MEO', 'GEO'], debrisRisk: 88, strategicImpact: 92, deterrenceValue: 88, estimatedTestsCompleted: 12 },
  { id: 'cn-coorbital', nation: 'China', category: 'co-orbital', name: 'Shijian-21 / Shiyan-12', developmentStage: 'operational', orbitThreats: ['GEO'], debrisRisk: 30, strategicImpact: 90, deterrenceValue: 80, estimatedTestsCompleted: 5 },
  { id: 'ru-luch', nation: 'Russia', category: 'co-orbital', name: 'Luch/Olymp inspection sat', developmentStage: 'operational', orbitThreats: ['GEO'], debrisRisk: 20, strategicImpact: 85, deterrenceValue: 70, estimatedTestsCompleted: 4 },
  { id: 'us-xb37', nation: 'USA', category: 'co-orbital', name: 'X-37B OTV', developmentStage: 'operational', orbitThreats: ['LEO', 'MEO'], debrisRisk: 10, strategicImpact: 80, deterrenceValue: 75, estimatedTestsCompleted: 6 },
  { id: 'cn-jamming', nation: 'China', category: 'jamming', name: 'GPS / SATCOM jamming network', developmentStage: 'operational', orbitThreats: ['all'], debrisRisk: 0, strategicImpact: 75, deterrenceValue: 65, estimatedTestsCompleted: 20 },
  { id: 'ru-tobol', nation: 'Russia', category: 'jamming', name: 'Tobol EW system (Tira)', developmentStage: 'operational', orbitThreats: ['all'], debrisRisk: 0, strategicImpact: 72, deterrenceValue: 60, estimatedTestsCompleted: 15 },
  { id: 'in-pdv-mk2', nation: 'India', category: 'ASAT-KE', name: 'PDV Mk-2 ASAT', developmentStage: 'testing', orbitThreats: ['LEO', 'MEO'], debrisRisk: 75, strategicImpact: 70, deterrenceValue: 72, estimatedTestsCompleted: 2 },
  { id: 'us-dew-space', nation: 'USA', category: 'ASAT-DEW', name: 'HELIOS / directed energy', developmentStage: 'development', orbitThreats: ['LEO'], debrisRisk: 5, strategicImpact: 85, deterrenceValue: 70, estimatedTestsCompleted: 0 },
  { id: 'dprk-spoofing', nation: 'DPRK', category: 'spoofing', name: 'GPS spoofing network', developmentStage: 'operational', orbitThreats: ['all'], debrisRisk: 0, strategicImpact: 50, deterrenceValue: 35, estimatedTestsCompleted: 30 },
];

const MOCK_INCIDENTS: SpaceIncident[] = [
  { id: 'fengyun-2007', date: '2007-01-11', nation: 'China', category: 'ASAT-KE', description: 'FY-1C ASAT test -- 3,500+ debris fragments', debrisGenerated: 3500, severity: 'critical' },
  { id: 'usa-193-2008', date: '2008-02-21', nation: 'USA', category: 'ASAT-KE', description: 'Operation Burnt Frost -- USA-193 intercept', debrisGenerated: 300, severity: 'high' },
  { id: 'kosmos-2019', date: '2019-07-20', nation: 'Russia', category: 'co-orbital', description: 'Kosmos-2542 inspecting US KH-11 spy sat', debrisGenerated: 0, severity: 'high' },
  { id: 'in-asat-2019', date: '2019-03-27', nation: 'India', category: 'ASAT-KE', description: 'Mission Shakti -- Microsat-R intercept', debrisGenerated: 400, severity: 'high' },
  { id: 'ru-asat-2021', date: '2021-11-15', nation: 'Russia', category: 'ASAT-KE', description: 'Nudol ASAT test -- Kosmos-1408 -- 1,500+ fragments', debrisGenerated: 1500, severity: 'critical' },
  { id: 'cn-inspect-2022', date: '2022-09-15', nation: 'China', category: 'co-orbital', description: 'SJ-21 towed defunct BeiDou sat to graveyard orbit', debrisGenerated: 0, severity: 'medium' },
];

export function scoreProgramThreat(p: SpaceWeaponProgram): number {
  const stageMult = { operational: 1, testing: 0.8, development: 0.5, conceptual: 0.2 }[p.developmentStage];
  const debrisPenalty = p.debrisRisk * 0.2;
  return Math.min(100, Math.round((p.strategicImpact * 0.4 + p.deterrenceValue * 0.3 + debrisPenalty * 0.3) * stageMult));
}

export function classifyThreatTier(score: number): ThreatTier {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function filterByNation(programs: SpaceWeaponProgram[], nation: SpacePowerNation): SpaceWeaponProgram[] {
  return programs.filter(p => p.nation === nation);
}

export function filterByCategory(programs: SpaceWeaponProgram[], category: WeaponCategory): SpaceWeaponProgram[] {
  return programs.filter(p => p.category === category);
}

export function rankProgramsByThreat(programs: SpaceWeaponProgram[]): SpaceWeaponProgram[] {
  return [...programs].sort((a, b) => scoreProgramThreat(b) - scoreProgramThreat(a));
}

export function computeTotalDebrisRisk(incidents: SpaceIncident[]): number {
  return incidents.reduce((s, i) => s + i.debrisGenerated, 0);
}

export function getNationCapabilityScore(programs: SpaceWeaponProgram[], nation: SpacePowerNation): number {
  const nPrograms = filterByNation(programs, nation);
  if (!nPrograms.length) return 0;
  return Math.round(nPrograms.reduce((s, p) => s + scoreProgramThreat(p), 0) / nPrograms.length);
}

export function getCategoryDistribution(programs: SpaceWeaponProgram[]): Record<WeaponCategory, number> {
  const dist: Record<WeaponCategory, number> = { 'ASAT-KE': 0, 'ASAT-DEW': 0, 'co-orbital': 0, 'jamming': 0, 'spoofing': 0, 'cyber-space': 0, 'hypersonic': 0 };
  for (const p of programs) dist[p.category]++;
  return dist;
}

export function getMostAdvancedNation(programs: SpaceWeaponProgram[]): SpacePowerNation {
  const nations: SpacePowerNation[] = ['USA', 'China', 'Russia', 'India', 'Japan', 'ESA', 'DPRK', 'Iran'];
  let best: SpacePowerNation = 'USA';
  let bestScore = -1;
  for (const n of nations) {
    const s = getNationCapabilityScore(programs, n);
    if (s > bestScore) { bestScore = s; best = n; }
  }
  return best;
}

export function buildRenderData(): {
  programs: SpaceWeaponProgram[];
  recentIncidents: SpaceIncident[];
  totalDebrisObjects: number;
  leadingNation: SpacePowerNation;
  categoryDistribution: Record<WeaponCategory, number>;
} {
  return {
    programs: rankProgramsByThreat(MOCK_PROGRAMS),
    recentIncidents: [...MOCK_INCIDENTS].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    totalDebrisObjects: computeTotalDebrisRisk(MOCK_INCIDENTS),
    leadingNation: getMostAdvancedNation(MOCK_PROGRAMS),
    categoryDistribution: getCategoryDistribution(MOCK_PROGRAMS),
  };
}
