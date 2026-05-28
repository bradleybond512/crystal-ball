// global-conflict-helpers.ts — pure deterministic helpers for GlobalConflictPanel

export type ConflictIntensity = 'war' | 'armed-conflict' | 'crisis' | 'tension' | 'stable';
export type ConflictType = 'interstate' | 'civil-war' | 'insurgency' | 'proxy' | 'hybrid' | 'territorial';
export type Region = 'europe' | 'middle-east' | 'africa' | 'asia-pacific' | 'americas' | 'central-asia';

export interface ActiveConflict {
  id: string;
  name: string;
  country: string;
  region: Region;
  intensity: ConflictIntensity;
  type: ConflictType;
  startYear: number;
  estimatedDeaths: number;
  monthlyDeaths: number;
  displaced: number;
  trend: 'escalating' | 'stable' | 'de-escalating';
  parties: string[];
  lastUpdate: string;
}

export interface ConflictEvent {
  id: string;
  date: string;
  conflictId: string;
  headline: string;
  significance: 'high' | 'medium' | 'low';
  deathToll: number;
}

export interface RegionalSummary {
  region: Region;
  activeConflicts: number;
  totalDisplaced: number;
  escalatingCount: number;
  dominantIntensity: ConflictIntensity;
}

const MOCK_CONFLICTS: ActiveConflict[] = [
  { id: 'ukraine', name: 'Russo-Ukrainian War', country: 'Ukraine', region: 'europe', intensity: 'war', type: 'interstate', startYear: 2022, estimatedDeaths: 500000, monthlyDeaths: 5000, displaced: 10000, trend: 'stable', parties: ['Ukraine', 'Russia'], lastUpdate: '2026-05-20' },
  { id: 'gaza', name: 'Gaza War', country: 'Palestine', region: 'middle-east', intensity: 'war', type: 'interstate', startYear: 2023, estimatedDeaths: 45000, monthlyDeaths: 1200, displaced: 1900, trend: 'stable', parties: ['Israel', 'Hamas'], lastUpdate: '2026-05-21' },
  { id: 'sudan', name: 'Sudan Civil War', country: 'Sudan', region: 'africa', intensity: 'war', type: 'civil-war', startYear: 2023, estimatedDeaths: 150000, monthlyDeaths: 3000, displaced: 10800, trend: 'escalating', parties: ['SAF', 'RSF'], lastUpdate: '2026-05-18' },
  { id: 'myanmar', name: 'Myanmar Civil War', country: 'Myanmar', region: 'asia-pacific', intensity: 'war', type: 'civil-war', startYear: 2021, estimatedDeaths: 50000, monthlyDeaths: 1500, displaced: 2700, trend: 'escalating', parties: ['Junta', 'PDF', 'EAOs'], lastUpdate: '2026-05-19' },
  { id: 'sahel', name: 'Sahel Insurgency', country: 'Mali/Burkina Faso/Niger', region: 'africa', intensity: 'armed-conflict', type: 'insurgency', startYear: 2012, estimatedDeaths: 30000, monthlyDeaths: 400, displaced: 3200, trend: 'escalating', parties: ['JNIM', 'ISGS', 'Government Forces'], lastUpdate: '2026-05-15' },
  { id: 'ethiopia', name: 'Ethiopia-Amhara Conflict', country: 'Ethiopia', region: 'africa', intensity: 'armed-conflict', type: 'civil-war', startYear: 2023, estimatedDeaths: 10000, monthlyDeaths: 300, displaced: 1400, trend: 'stable', parties: ['ENDF', 'Fano'], lastUpdate: '2026-05-10' },
  { id: 'haiti', name: 'Haiti Gang Crisis', country: 'Haiti', region: 'americas', intensity: 'crisis', type: 'insurgency', startYear: 2021, estimatedDeaths: 5000, monthlyDeaths: 200, displaced: 600, trend: 'escalating', parties: ['Gang coalitions', 'HNP', 'MSS'], lastUpdate: '2026-05-16' },
  { id: 'kashmir', name: 'Kashmir Tension', country: 'India/Pakistan', region: 'asia-pacific', intensity: 'tension', type: 'territorial', startYear: 1947, estimatedDeaths: 70000, monthlyDeaths: 20, displaced: 500, trend: 'escalating', parties: ['India', 'Pakistan', 'Militant groups'], lastUpdate: '2026-05-22' },
];

const MOCK_EVENTS: ConflictEvent[] = [
  { id: 'ev1', date: '2026-05-20', conflictId: 'ukraine', headline: 'Major drone strike exchange along Dnipro front', significance: 'high', deathToll: 47 },
  { id: 'ev2', date: '2026-05-21', conflictId: 'gaza', headline: 'Ceasefire talks resume in Cairo', significance: 'high', deathToll: 0 },
  { id: 'ev3', date: '2026-05-19', conflictId: 'sudan', headline: 'RSF advances on El Fasher, UN warns of mass atrocity risk', significance: 'high', deathToll: 200 },
  { id: 'ev4', date: '2026-05-18', conflictId: 'myanmar', headline: 'PDF captures key Sagaing town', significance: 'medium', deathToll: 35 },
  { id: 'ev5', date: '2026-05-17', conflictId: 'sahel', headline: 'JNIM ambush kills 30 Malian soldiers near Gao', significance: 'medium', deathToll: 30 },
  { id: 'ev6', date: '2026-05-16', conflictId: 'haiti', headline: 'Gang takeover of Port-au-Prince district halts aid deliveries', significance: 'high', deathToll: 12 },
  { id: 'ev7', date: '2026-05-22', conflictId: 'kashmir', headline: 'India-Pakistan exchange fire across LoC following militant attack', significance: 'high', deathToll: 8 },
];

export function intensityScore(intensity: ConflictIntensity): number {
  const map: Record<ConflictIntensity, number> = { war: 5, 'armed-conflict': 4, crisis: 3, tension: 2, stable: 1 };
  return map[intensity];
}

export function trendIcon(trend: ActiveConflict['trend']): string {
  if (trend === 'escalating') return 'up';
  if (trend === 'de-escalating') return 'down';
  return 'flat';
}

export function formatDisplaced(thousandsK: number): string {
  if (thousandsK >= 1000) return (thousandsK / 1000).toFixed(1) + 'M';
  return thousandsK + 'K';
}

export function formatDeaths(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}

export function rankConflictsBySeverity(conflicts: ActiveConflict[]): ActiveConflict[] {
  return [...conflicts].sort((a, b) => {
    const scoreDiff = intensityScore(b.intensity) - intensityScore(a.intensity);
    if (scoreDiff !== 0) return scoreDiff;
    return b.monthlyDeaths - a.monthlyDeaths;
  });
}

export function filterByRegion(conflicts: ActiveConflict[], region: Region): ActiveConflict[] {
  return conflicts.filter((c) => c.region === region);
}

export function filterByIntensity(conflicts: ActiveConflict[], min: ConflictIntensity): ActiveConflict[] {
  const minScore = intensityScore(min);
  return conflicts.filter((c) => intensityScore(c.intensity) >= minScore);
}

export function computeRegionalSummary(conflicts: ActiveConflict[]): RegionalSummary[] {
  const regions: Region[] = ['europe', 'middle-east', 'africa', 'asia-pacific', 'americas', 'central-asia'];
  return regions.map((region) => {
    const rc = conflicts.filter((c) => c.region === region);
    const escalating = rc.filter((c) => c.trend === 'escalating');
    const dominated = rc.reduce<ActiveConflict | null>((best, c) =>
      best === null || intensityScore(c.intensity) > intensityScore(best.intensity) ? c : best, null);
    return {
      region,
      activeConflicts: rc.length,
      totalDisplaced: rc.reduce((s, c) => s + c.displaced, 0),
      escalatingCount: escalating.length,
      dominantIntensity: dominated?.intensity ?? 'stable',
    };
  });
}

export function totalGlobalDisplaced(conflicts: ActiveConflict[]): number {
  return conflicts.reduce((s, c) => s + c.displaced, 0);
}

export function totalActiveWars(conflicts: ActiveConflict[]): number {
  return conflicts.filter((c) => c.intensity === 'war').length;
}

export function recentHighSignificanceEvents(events: ConflictEvent[], limit = 5): ConflictEvent[] {
  return [...events]
    .filter((e) => e.significance === 'high')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function conflictDurationYears(conflict: ActiveConflict, currentYear = 2026): number {
  return currentYear - conflict.startYear;
}

export function escalatingConflicts(conflicts: ActiveConflict[]): ActiveConflict[] {
  return conflicts.filter((c) => c.trend === 'escalating');
}

export function buildRenderData(): {
  conflicts: ActiveConflict[];
  recentEvents: ConflictEvent[];
  regionalSummaries: RegionalSummary[];
  totalDisplacedK: number;
  activeWars: number;
  escalatingCount: number;
} {
  const ranked = rankConflictsBySeverity(MOCK_CONFLICTS);
  return {
    conflicts: ranked,
    recentEvents: recentHighSignificanceEvents(MOCK_EVENTS),
    regionalSummaries: computeRegionalSummary(MOCK_CONFLICTS),
    totalDisplacedK: totalGlobalDisplaced(MOCK_CONFLICTS),
    activeWars: totalActiveWars(MOCK_CONFLICTS),
    escalatingCount: escalatingConflicts(MOCK_CONFLICTS).length,
  };
}
