// global-logistics-chokepoints-helpers.ts
// Pure logic for GlobalLogisticsChokepointsPanel — no DOM, no Panel imports

export type ChokepointType = 'Maritime Strait' | 'Canal' | 'Sea Route' | 'Military Choke';
export type ThreatLevel = 'Low' | 'Elevated' | 'High' | 'Critical';
export type ChokepointStatus = 'Open' | 'Disrupted' | 'Contested';

export interface LogisticsChokepoint {
  id: string;
  name: string;
  type: ChokepointType;
  throughputNote: string;
  threatLevel: ThreatLevel;
  currentStatus: ChokepointStatus;
  controllingActors: string[];
  currentIncident?: string;
  alternatives: string[];
  criticalityScore: number; // 1-10
  region: string;
}

export interface ChokepointRenderData {
  chokepoints: LogisticsChokepoint[];
  globalDisruptionIndex: number;
  criticalCount: number;
  disruptedCount: number;
  mostThreatenedRegion: string;
}

const CHOKEPOINTS: LogisticsChokepoint[] = [
  {
    id: 'C001',
    name: 'Strait of Hormuz',
    type: 'Maritime Strait',
    throughputNote: '21M bbl/day oil (21% global)',
    threatLevel: 'Critical',
    currentStatus: 'Open',
    controllingActors: ['Iran IRGC', 'Iran (both shores)', 'Mine threat'],
    currentIncident: 'IRGC harassment of tankers; mine-laying threat; US carrier presence',
    alternatives: ['None practical for Gulf exports'],
    criticalityScore: 10,
    region: 'Middle East',
  },
  {
    id: 'C002',
    name: 'Suez Canal / Red Sea',
    type: 'Canal',
    throughputNote: '12% world trade',
    threatLevel: 'Critical',
    currentStatus: 'Disrupted',
    controllingActors: ['Egypt', 'US Navy'],
    currentIncident: 'Houthi attacks diverted ~80% of traffic; ships rerouting via Cape of Good Hope',
    alternatives: ['Cape of Good Hope (+14 days)', 'Trans-Sinai pipeline'],
    criticalityScore: 10,
    region: 'Middle East / North Africa',
  },
  {
    id: 'C003',
    name: 'Strait of Malacca',
    type: 'Maritime Strait',
    throughputNote: '100k ships/yr, 40% world trade',
    threatLevel: 'High',
    currentStatus: 'Open',
    controllingActors: ['Singapore', 'Malaysia', 'Indonesia'],
    currentIncident: undefined,
    alternatives: ['Lombok Strait', 'Sunda Strait (capacity-limited)'],
    criticalityScore: 9,
    region: 'Southeast Asia',
  },
  {
    id: 'C004',
    name: 'Taiwan Strait',
    type: 'Maritime Strait',
    throughputNote: '50% container shipping',
    threatLevel: 'Critical',
    currentStatus: 'Contested',
    controllingActors: ['China', 'Taiwan', 'USA'],
    currentIncident: 'PLA air and naval exercises; regular incursions into Taiwan ADIZ',
    alternatives: ['Luzon Strait', 'Philippines Sea routes'],
    criticalityScore: 10,
    region: 'East Asia',
  },
  {
    id: 'C005',
    name: 'Bab-el-Mandeb',
    type: 'Maritime Strait',
    throughputNote: '7% global trade',
    threatLevel: 'Critical',
    currentStatus: 'Disrupted',
    controllingActors: ['Yemen (Houthi)', 'US Navy'],
    currentIncident: 'Houthi anti-ship missile and drone attacks; Operation Prosperity Guardian',
    alternatives: ['Cape of Good Hope', 'Suez land bridge'],
    criticalityScore: 9,
    region: 'Middle East / Horn of Africa',
  },
  {
    id: 'C006',
    name: 'Panama Canal',
    type: 'Canal',
    throughputNote: '5% global trade',
    threatLevel: 'Elevated',
    currentStatus: 'Open',
    controllingActors: ['Panama'],
    currentIncident: 'Drought reduced daily transits from 36 to 24 in 2023-24; near-normal as of 2025',
    alternatives: ['Suez Canal', 'US transcontinental rail'],
    criticalityScore: 8,
    region: 'Latin America',
  },
  {
    id: 'C007',
    name: 'Bosphorus / Turkish Straits',
    type: 'Maritime Strait',
    throughputNote: 'Russia-Ukraine grain and oil',
    threatLevel: 'High',
    currentStatus: 'Open',
    controllingActors: ['Turkey'],
    currentIncident: 'Montreux Convention warship restrictions; Black Sea grain deal collapsed 2023',
    alternatives: ['None for Black Sea access'],
    criticalityScore: 8,
    region: 'Europe / Black Sea',
  },
  {
    id: 'C008',
    name: 'Strait of Gibraltar',
    type: 'Maritime Strait',
    throughputNote: 'Mediterranean access',
    threatLevel: 'Elevated',
    currentStatus: 'Open',
    controllingActors: ['Morocco', 'Spain', 'NATO'],
    currentIncident: undefined,
    alternatives: ['None for Mediterranean entry'],
    criticalityScore: 7,
    region: 'Europe / North Africa',
  },
  {
    id: 'C009',
    name: 'Cape of Good Hope',
    type: 'Sea Route',
    throughputNote: 'Red Sea alternative (+14 days)',
    threatLevel: 'Elevated',
    currentStatus: 'Open',
    controllingActors: ['International'],
    currentIncident: 'Congestion surge as Suez/Red Sea traffic reroutes; port capacity strain',
    alternatives: ['Suez Canal (when safe)'],
    criticalityScore: 6,
    region: 'Sub-Saharan Africa',
  },
  {
    id: 'C010',
    name: 'Arctic Northern Sea Route',
    type: 'Sea Route',
    throughputNote: 'Russia-controlled shortcut',
    threatLevel: 'Elevated',
    currentStatus: 'Open',
    controllingActors: ['Russia'],
    currentIncident: 'Russia restricting foreign naval access; seasonal ice limits window',
    alternatives: ['Suez Canal', 'Trans-Siberian Railway'],
    criticalityScore: 6,
    region: 'Arctic',
  },
  {
    id: 'C011',
    name: 'GIUK Gap',
    type: 'Military Choke',
    throughputNote: 'NATO-Russia ASW contest',
    threatLevel: 'High',
    currentStatus: 'Contested',
    controllingActors: ['NATO vs Russia'],
    currentIncident: 'Russian submarine and surface fleet sorties; NATO IADS and ASW patrols elevated',
    alternatives: ['None for North Atlantic chokepoint'],
    criticalityScore: 8,
    region: 'North Atlantic',
  },
  {
    id: 'C012',
    name: 'South China Sea Lanes',
    type: 'Sea Route',
    throughputNote: '30% world trade',
    threatLevel: 'High',
    currentStatus: 'Contested',
    controllingActors: ['China', 'ASEAN', 'USA'],
    currentIncident: 'Chinese militarized island bases; PLA Coast Guard harassment; FONOPS by US Navy',
    alternatives: ['Lombok Strait', 'Sunda Strait'],
    criticalityScore: 9,
    region: 'Southeast Asia',
  },
];

export function getByThreatLevel(
  chokepoints: LogisticsChokepoint[],
  level: ThreatLevel,
): LogisticsChokepoint[] {
  return chokepoints.filter((c) => c.threatLevel === level);
}

export function getDisrupted(chokepoints: LogisticsChokepoint[]): LogisticsChokepoint[] {
  return chokepoints.filter((c) => c.currentStatus === 'Disrupted');
}

export function getContested(chokepoints: LogisticsChokepoint[]): LogisticsChokepoint[] {
  return chokepoints.filter((c) => c.currentStatus === 'Contested');
}

export function getByRegion(
  chokepoints: LogisticsChokepoint[],
  region: string,
): LogisticsChokepoint[] {
  return chokepoints.filter((c) => c.region.includes(region));
}

/**
 * Weighted disruption index 0-100.
 * Disrupted = full weight (1.0), Contested = half weight (0.5), Open = 0.
 * Weights are proportional to criticalityScore (1-10).
 */
export function computeGlobalDisruptionIndex(chokepoints: LogisticsChokepoint[]): number {
  if (!chokepoints.length) return 0;
  const totalWeight = chokepoints.reduce((s, c) => s + c.criticalityScore, 0);
  if (totalWeight === 0) return 0;
  const weightedDisruption = chokepoints.reduce((s, c) => {
    const statusWeight =
      c.currentStatus === 'Disrupted' ? 1.0 : c.currentStatus === 'Contested' ? 0.5 : 0;
    return s + c.criticalityScore * statusWeight;
  }, 0);
  return Math.round((weightedDisruption / totalWeight) * 100);
}

/**
 * Returns the region name with the highest aggregate threat score.
 * ThreatLevel weights: Low=1, Elevated=2, High=3, Critical=4.
 * Uses the first segment of region (before ' / ') as the key.
 */
export function getMostThreatenedRegion(chokepoints: LogisticsChokepoint[]): string {
  if (!chokepoints.length) return 'Unknown';
  const threatWeights: Record<ThreatLevel, number> = {
    Low: 1,
    Elevated: 2,
    High: 3,
    Critical: 4,
  };
  const regionScores: Record<string, number> = {};
  for (const c of chokepoints) {
    const key = c.region.split(' / ')[0];
    regionScores[key] = (regionScores[key] ?? 0) + threatWeights[c.threatLevel];
  }
  let topRegion = 'Unknown';
  let topScore = -1;
  for (const [region, score] of Object.entries(regionScores)) {
    if (score > topScore) {
      topScore = score;
      topRegion = region;
    }
  }
  return topRegion;
}

export function threatLevelClass(level: ThreatLevel): string {
  const map: Record<ThreatLevel, string> = {
    Low: 'threat-low',
    Elevated: 'threat-elevated',
    High: 'threat-high',
    Critical: 'threat-critical',
  };
  return map[level] ?? 'threat-low';
}

export function statusClass(status: ChokepointStatus): string {
  const map: Record<ChokepointStatus, string> = {
    Open: 'status-open',
    Disrupted: 'status-disrupted',
    Contested: 'status-contested',
  };
  return map[status] ?? 'status-open';
}

export function buildRenderData(): ChokepointRenderData {
  return {
    chokepoints: CHOKEPOINTS,
    globalDisruptionIndex: computeGlobalDisruptionIndex(CHOKEPOINTS),
    criticalCount: getByThreatLevel(CHOKEPOINTS, 'Critical').length,
    disruptedCount: getDisrupted(CHOKEPOINTS).length,
    mostThreatenedRegion: getMostThreatenedRegion(CHOKEPOINTS),
  };
}
