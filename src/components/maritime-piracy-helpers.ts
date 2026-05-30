// maritime-piracy-helpers.ts
// Pure logic for MaritimePiracyPanel -- no DOM, no Panel imports

export type PiracyTrend = 'increasing' | 'stable' | 'decreasing';
export type SeverityLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type AttackType =
  | 'Boarding'
  | 'Hijacking'
  | 'Attempted Boarding'
  | 'Fired Upon'
  | 'Kidnapping'
  | 'Armed Robbery';
export type IncidentOutcome =
  | 'Hijacked'
  | 'Repelled'
  | 'Crew Kidnapped'
  | 'Escaped'
  | 'Fired Upon';

export interface PiracyHotspot {
  id: string;
  region: string;
  annualIncidents: number;
  trend: PiracyTrend;
  primaryTactics: string[];
  severityLevel: SeverityLevel;
  primaryGroups: string[];
  description: string;
  economicImpactBn: number;
}

export interface PiracyIncident {
  id: string;
  date: string;
  region: string;
  shipType: string;
  attackType: AttackType;
  outcome: IncidentOutcome;
  description: string;
  significance: number; // 1-10
}

export interface PiracyData {
  hotspots: PiracyHotspot[];
  incidents: PiracyIncident[];
  globalPiracyIndex: number;
  totalIncidentsYTD: number;
  highRiskRegions: string[];
  crewsAtRisk: number;
}

// -- Static data --

const HOTSPOTS: PiracyHotspot[] = [
  {
    id: 'H001',
    region: 'Red Sea / Gulf of Aden',
    annualIncidents: 60,
    trend: 'increasing',
    primaryTactics: ['Missile attacks', 'Drone strikes', 'Vessel seizure', 'Crew detention'],
    severityLevel: 'Critical',
    primaryGroups: ['Houthi Movement (Ansar Allah)'],
    description: 'Houthi forces escalated attacks from Nov 2023 targeting commercial shipping linked to Israel and Western nations. Hundreds of vessels rerouted around Africa adding $1M+ per voyage.',
    economicImpactBn: 10,
  },
  {
    id: 'H002',
    region: 'Gulf of Guinea',
    annualIncidents: 80,
    trend: 'stable',
    primaryTactics: ['Boarding', 'Crew kidnapping for ransom', 'Cargo theft'],
    severityLevel: 'High',
    primaryGroups: ['Nigerian piracy networks', 'MEND splinter groups'],
    description: 'Global epicenter of maritime kidnapping. Pirates use mother ships to reach tankers and supply vessels far offshore for crew ransom operations.',
    economicImpactBn: 1.2,
  },
  {
    id: 'H003',
    region: 'Malacca Strait',
    annualIncidents: 40,
    trend: 'decreasing',
    primaryTactics: ['Boarding', 'Petty theft', 'Armed robbery at anchor'],
    severityLevel: 'Medium',
    primaryGroups: ['Opportunistic criminal gangs'],
    description: 'Predominantly low-level opportunistic theft targeting anchored or slow-moving vessels. Regional coast guard cooperation has reduced serious incidents.',
    economicImpactBn: 0.4,
  },
  {
    id: 'H004',
    region: 'Somali Basin / Indian Ocean',
    annualIncidents: 15,
    trend: 'stable',
    primaryTactics: ['Vessel hijacking', 'Crew ransom', 'Long-range skiff attacks'],
    severityLevel: 'Medium',
    primaryGroups: ['Somali piracy networks', 'Al-Shabaab affiliated groups'],
    description: 'Classic Somali piracy suppressed by naval patrols but capability remains. Sporadic hijacking attempts target bulk carriers and dhows.',
    economicImpactBn: 0.3,
  },
  {
    id: 'H005',
    region: 'Bangladesh / India East Coast',
    annualIncidents: 25,
    trend: 'stable',
    primaryTactics: ['Armed robbery at anchor', 'Cargo theft', 'Crew assault'],
    severityLevel: 'Low',
    primaryGroups: ['Local criminal gangs'],
    description: 'Low-level opportunistic incidents targeting anchored vessels in port approaches and river mouths. Violence rare but cargo losses persistent.',
    economicImpactBn: 0.2,
  },
  {
    id: 'H006',
    region: 'West Africa Offshore Oil Sector',
    annualIncidents: 30,
    trend: 'stable',
    primaryTactics: ['Oil bunkering', 'Product tanker hijacking', 'Crew robbery'],
    severityLevel: 'High',
    primaryGroups: ['Niger Delta militants', 'Organized bunkering syndicates'],
    description: 'Sophisticated oil bunkering operations targeting product tankers. Single operations steal $50M+ in crude. Linked to onshore militant financing.',
    economicImpactBn: 1.5,
  },
  {
    id: 'H007',
    region: 'Philippines / Sulu-Celebes Sea',
    annualIncidents: 20,
    trend: 'decreasing',
    primaryTactics: ['Crew kidnapping', 'Ransom negotiation', 'Cross-border raids'],
    severityLevel: 'Medium',
    primaryGroups: ['Abu Sayyaf Group', 'Tausug criminal networks'],
    description: 'Abu Sayyaf kidnapping operations target tug boats, fishing vessels, and supply ships. Trilateral Philippine-Malaysian-Indonesian patrols have reduced incidents.',
    economicImpactBn: 0.3,
  },
];

const INCIDENTS: PiracyIncident[] = [
  {
    id: 'I001',
    date: '2023-11-19',
    region: 'Red Sea / Gulf of Aden',
    shipType: 'Car Carrier',
    attackType: 'Hijacking',
    outcome: 'Hijacked',
    description: 'Houthi commandos seized MV Galaxy Leader (Bahamian-flagged, Israeli-linked ownership). 25 crew held; ship became a Houthi propaganda symbol.',
    significance: 9,
  },
  {
    id: 'I002',
    date: '2024-03-06',
    region: 'Red Sea / Gulf of Aden',
    shipType: 'Bulk Carrier',
    attackType: 'Fired Upon',
    outcome: 'Fired Upon',
    description: 'MV True Confidence struck by Houthi missile killing 3 crew -- first confirmed seafarer deaths from Houthi campaign. Vessel abandoned and sank.',
    significance: 9,
  },
  {
    id: 'I003',
    date: '2023-08-14',
    region: 'Gulf of Guinea',
    shipType: 'Supply Vessel',
    attackType: 'Kidnapping',
    outcome: 'Crew Kidnapped',
    description: 'Armed pirates boarded an offshore supply vessel 60nm off Nigeria. Six crew kidnapped and held 28 days before release after ransom payment.',
    significance: 7,
  },
  {
    id: 'I004',
    date: '2024-02-03',
    region: 'Malacca Strait',
    shipType: 'Product Tanker',
    attackType: 'Boarding',
    outcome: 'Repelled',
    description: 'Armed gang of four boarded a product tanker at anchor near Port Klang. Crew activated alarms; pirates fled with minor cargo before coast guard arrived.',
    significance: 5,
  },
  {
    id: 'I005',
    date: '2023-09-21',
    region: 'Somali Basin / Indian Ocean',
    shipType: 'Bulk Carrier',
    attackType: 'Attempted Boarding',
    outcome: 'Repelled',
    description: 'Skiffs attempted boarding 180nm off Bosaso. Vessel deployed LRAD and fire hoses; EU NAVFOR asset responded and pirates fled.',
    significance: 4,
  },
  {
    id: 'I006',
    date: '2023-06-05',
    region: 'Philippines / Sulu-Celebes Sea',
    shipType: 'Fishing Vessel',
    attackType: 'Kidnapping',
    outcome: 'Crew Kidnapped',
    description: 'Abu Sayyaf militants abducted 7 crew from a Malaysian fishing vessel near Tawi-Tawi. Crew held 3 months; released after undisclosed ransom.',
    significance: 7,
  },
  {
    id: 'I007',
    date: '2024-01-15',
    region: 'West Africa Offshore Oil Sector',
    shipType: 'Product Tanker',
    attackType: 'Armed Robbery',
    outcome: 'Hijacked',
    description: 'Bunkering operation hijacked a product tanker 40nm off Port Harcourt. Over $50M in crude cargo transferred to unmarked vessels over 72 hours.',
    significance: 8,
  },
  {
    id: 'I008',
    date: '2024-02-18',
    region: 'Red Sea / Gulf of Aden',
    shipType: 'Container Ship',
    attackType: 'Fired Upon',
    outcome: 'Fired Upon',
    description: 'MV MSC Palatium III struck by Houthi missile while transiting under escort. Ship sustained damage but continued under own power; no crew fatalities.',
    significance: 8,
  },
  {
    id: 'I009',
    date: '2023-07-11',
    region: 'Gulf of Guinea',
    shipType: 'Tanker',
    attackType: 'Hijacking',
    outcome: 'Escaped',
    description: 'MV Monjasa Reformer hijacked 200nm southwest of Sao Tome. Danish frigate intervention forced pirates to release vessel; crew unharmed.',
    significance: 7,
  },
  {
    id: 'I010',
    date: '2024-04-22',
    region: 'Bangladesh / India East Coast',
    shipType: 'General Cargo Vessel',
    attackType: 'Armed Robbery',
    outcome: 'Repelled',
    description: 'Armed gang boarded cargo vessel at anchor in Chittagong outer anchorage. Crew mustered in citadel; pirates stole stores and fled before authorities arrived.',
    significance: 4,
  },
];

// -- Helper functions --

export function computeGlobalPiracyIndex(hotspots: PiracyHotspot[]): number {
  if (!hotspots.length) return 0;
  const severityWeight: Record<SeverityLevel, number> = {
    Critical: 100,
    High: 70,
    Medium: 40,
    Low: 15,
  };
  const trendBonus: Record<PiracyTrend, number> = {
    increasing: 10,
    stable: 0,
    decreasing: -5,
  };
  const total = hotspots.reduce(
    (sum, h) => sum + (severityWeight[h.severityLevel] ?? 0) + (trendBonus[h.trend] ?? 0),
    0,
  );
  return Math.min(100, Math.round(total / hotspots.length));
}

export function getHighSeverity(hotspots: PiracyHotspot[]): PiracyHotspot[] {
  return hotspots.filter(h => h.severityLevel === 'Critical' || h.severityLevel === 'High');
}

export function getIncreasingRegions(hotspots: PiracyHotspot[]): PiracyHotspot[] {
  return hotspots.filter(h => h.trend === 'increasing');
}

export function getByAttackType(incidents: PiracyIncident[], type: AttackType): PiracyIncident[] {
  return incidents.filter(i => i.attackType === type);
}

export function severityClass(level: SeverityLevel): string {
  const map: Record<SeverityLevel, string> = {
    Low: 'sev-low',
    Medium: 'sev-medium',
    High: 'sev-high',
    Critical: 'sev-critical',
  };
  return map[level] ?? 'sev-medium';
}

export function trendClass(trend: PiracyTrend): string {
  const map: Record<PiracyTrend, string> = {
    increasing: 'trend-up',
    stable: 'trend-flat',
    decreasing: 'trend-down',
  };
  return map[trend] ?? 'trend-flat';
}

export function attackTypeClass(type: AttackType): string {
  const map: Record<AttackType, string> = {
    Boarding: 'attack-boarding',
    Hijacking: 'attack-hijacking',
    'Attempted Boarding': 'attack-attempted',
    'Fired Upon': 'attack-fired',
    Kidnapping: 'attack-kidnapping',
    'Armed Robbery': 'attack-robbery',
  };
  return map[type] ?? 'attack-boarding';
}

export function buildRenderData(): PiracyData {
  const globalPiracyIndex = computeGlobalPiracyIndex(HOTSPOTS);
  const totalIncidentsYTD = HOTSPOTS.reduce((sum, h) => sum + h.annualIncidents, 0);
  const highRiskRegions = getHighSeverity(HOTSPOTS).map(h => h.region);
  const crewsAtRisk =
    INCIDENTS.filter(i => i.outcome === 'Crew Kidnapped' || i.outcome === 'Hijacked').length * 15;
  return {
    hotspots: HOTSPOTS,
    incidents: INCIDENTS,
    globalPiracyIndex,
    totalIncidentsYTD,
    highRiskRegions,
    crewsAtRisk,
  };
}
