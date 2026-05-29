// territorial-disputes-helpers.ts — active territorial claim and conflict zone tracking

export type DisputeRegion = 'Asia-Pacific' | 'Europe' | 'Middle East' | 'Africa' | 'Arctic' | 'Americas' | 'South Asia';
export type DisputePhase = 'armed-conflict' | 'militarized' | 'contested' | 'frozen-conflict' | 'diplomatic';
export type ClaimantBlock = 'NATO' | 'China' | 'Russia' | 'Regional' | 'Non-state';

export interface TerritorialDispute {
  id: string;
  name: string;
  region: DisputeRegion;
  claimants: string[];
  primaryAggressor: string;
  phase: DisputePhase;
  escalationTrend: 'escalating' | 'stable' | 'de-escalating';
  militaryPresenceScore: number; // 0-100
  economicStakes: number; // 0-100 (resource value, trade routes)
  resolutionProspect: number; // 0-100 (100 = near-term resolution likely)
  affectedAreaKm2: number;
  keyIssue: string;
  lastIncident: string;
}

export interface DisputeIncident {
  id: string;
  disputeId: string;
  date: string;
  type: 'military-clash' | 'naval-incident' | 'aerial-intrusion' | 'diplomatic-protest' | 'legal-filing' | 'civilian-harm';
  severity: number; // 1-10
  description: string;
}

const MOCK_DISPUTES: TerritorialDispute[] = [
  { id: 'ukraine-russia', name: 'Russia-Ukraine War', region: 'Europe', claimants: ['Russia','Ukraine'], primaryAggressor: 'Russia', phase: 'armed-conflict', escalationTrend: 'stable', militaryPresenceScore: 100, economicStakes: 82, resolutionProspect: 15, affectedAreaKm2: 118000, keyIssue: 'Full-scale invasion + annexed territories (Donetsk, Luhansk, Zaporizhzhia, Kherson, Crimea)', lastIncident: '2024-11-01' },
  { id: 'taiwan-strait', name: 'Taiwan Strait', region: 'Asia-Pacific', claimants: ['China','Taiwan','USA'], primaryAggressor: 'China', phase: 'militarized', escalationTrend: 'escalating', militaryPresenceScore: 88, economicStakes: 95, resolutionProspect: 20, affectedAreaKm2: 180000, keyIssue: 'PRC claims sovereignty; Taiwan de facto independent; US One China policy ambiguity', lastIncident: '2024-10-15' },
  { id: 'scs-spratly', name: 'South China Sea (Spratlys/SCS)', region: 'Asia-Pacific', claimants: ['China','Philippines','Vietnam','Malaysia','Brunei','Taiwan'], primaryAggressor: 'China', phase: 'militarized', escalationTrend: 'escalating', militaryPresenceScore: 82, economicStakes: 88, resolutionProspect: 12, affectedAreaKm2: 3500000, keyIssue: 'Nine-dash line overlapping EEZs; artificial island militarization', lastIncident: '2024-10-22' },
  { id: 'kashmir', name: 'Kashmir (India-Pakistan)', region: 'South Asia', claimants: ['India','Pakistan','China'], primaryAggressor: 'Pakistan', phase: 'frozen-conflict', escalationTrend: 'stable', militaryPresenceScore: 75, economicStakes: 55, resolutionProspect: 10, affectedAreaKm2: 222236, keyIssue: 'LOC de facto border; Azad Kashmir vs Jammu & Kashmir; nuclear-armed rivalry', lastIncident: '2024-08-10' },
  { id: 'senkaku-diaoyu', name: 'Senkaku/Diaoyu Islands', region: 'Asia-Pacific', claimants: ['Japan','China','Taiwan'], primaryAggressor: 'China', phase: 'contested', escalationTrend: 'escalating', militaryPresenceScore: 65, economicStakes: 60, resolutionProspect: 18, affectedAreaKm2: 7, keyIssue: 'Uninhabited islands; US-Japan security treaty trigger risk', lastIncident: '2024-09-20' },
  { id: 'arctic-shelf', name: 'Arctic Continental Shelf', region: 'Arctic', claimants: ['Russia','Canada','Denmark','Norway','USA'], primaryAggressor: 'Russia', phase: 'diplomatic', escalationTrend: 'escalating', militaryPresenceScore: 45, economicStakes: 92, resolutionProspect: 30, affectedAreaKm2: 1200000, keyIssue: 'Lomonosov Ridge oil/gas; Northern Sea Route; militarization', lastIncident: '2024-07-05' },
  { id: 'nagorno-karabakh', name: 'Nagorno-Karabakh', region: 'Europe', claimants: ['Azerbaijan','Armenia'], primaryAggressor: 'Azerbaijan', phase: 'frozen-conflict', escalationTrend: 'de-escalating', militaryPresenceScore: 60, economicStakes: 35, resolutionProspect: 40, affectedAreaKm2: 4400, keyIssue: 'Azerbaijan recaptured region 2023; Armenian population displacement', lastIncident: '2023-09-19' },
  { id: 'sudan-ethiopia', name: 'Ethiopia-Sudan Border (Fashoda)', region: 'Africa', claimants: ['Ethiopia','Sudan'], primaryAggressor: 'Sudan', phase: 'militarized', escalationTrend: 'escalating', militaryPresenceScore: 55, economicStakes: 40, resolutionProspect: 25, affectedAreaKm2: 1800, keyIssue: 'al-Fashaga fertile land; Nile water rights; ethnic militia clashes', lastIncident: '2024-05-18' },
];

const MOCK_INCIDENTS: DisputeIncident[] = [
  { id: 'di1', disputeId: 'scs-spratly', date: '2024-10-22', type: 'naval-incident', severity: 7, description: 'PLAN water cannon and laser attack on Philippine Coast Guard at Second Thomas Shoal' },
  { id: 'di2', disputeId: 'taiwan-strait', date: '2024-10-15', type: 'aerial-intrusion', severity: 6, description: 'PLA aircraft crossed median line — 24 fighters in one sortie' },
  { id: 'di3', disputeId: 'ukraine-russia', date: '2024-11-01', type: 'military-clash', severity: 10, description: 'Drone strikes on Kyiv; Russian advance in Donetsk sector' },
  { id: 'di4', disputeId: 'senkaku-diaoyu', date: '2024-09-20', type: 'naval-incident', severity: 5, description: 'CCG vessels entered territorial waters — 4-day contiguous zone transit' },
  { id: 'di5', disputeId: 'kashmir', date: '2024-08-10', type: 'military-clash', severity: 4, description: 'LOC ceasefire violation — small arms exchange, 2 soldiers injured' },
];

export function scoreDisputeSeverity(d: TerritorialDispute): number {
  const phaseScore = { 'armed-conflict': 50, 'militarized': 35, 'contested': 20, 'frozen-conflict': 15, 'diplomatic': 5 }[d.phase];
  const trendMult = d.escalationTrend === 'escalating' ? 1.2 : d.escalationTrend === 'de-escalating' ? 0.8 : 1.0;
  return Math.min(100, Math.round((phaseScore + d.militaryPresenceScore * 0.3 + d.economicStakes * 0.2) * trendMult));
}

export function filterByPhase(disputes: TerritorialDispute[], phase: DisputePhase): TerritorialDispute[] {
  return disputes.filter(d => d.phase === phase);
}

export function filterByRegion(disputes: TerritorialDispute[], region: DisputeRegion): TerritorialDispute[] {
  return disputes.filter(d => d.region === region);
}

export function filterByTrend(disputes: TerritorialDispute[], trend: 'escalating' | 'stable' | 'de-escalating'): TerritorialDispute[] {
  return disputes.filter(d => d.escalationTrend === trend);
}

export function rankByseverity(disputes: TerritorialDispute[]): TerritorialDispute[] {
  return [...disputes].sort((a, b) => scoreDisputeSeverity(b) - scoreDisputeSeverity(a));
}

export function computeGlobalTensionIndex(disputes: TerritorialDispute[]): number {
  if (!disputes.length) return 0;
  return Math.round(disputes.reduce((s, d) => s + scoreDisputeSeverity(d), 0) / disputes.length);
}

export function getPhaseDistribution(disputes: TerritorialDispute[]): Record<DisputePhase, number> {
  const dist: Record<DisputePhase, number> = { 'armed-conflict': 0, 'militarized': 0, 'contested': 0, 'frozen-conflict': 0, 'diplomatic': 0 };
  for (const d of disputes) dist[d.phase]++;
  return dist;
}

export function getIncidentsForDispute(incidents: DisputeIncident[], disputeId: string): DisputeIncident[] {
  return incidents.filter(i => i.disputeId === disputeId).sort((a, b) => b.date.localeCompare(a.date));
}

export function getRecentHighSeverityIncidents(incidents: DisputeIncident[], minSeverity = 5): DisputeIncident[] {
  return incidents.filter(i => i.severity >= minSeverity).sort((a, b) => b.severity - a.severity || b.date.localeCompare(a.date));
}

export function buildRenderData(): {
  disputes: TerritorialDispute[];
  recentIncidents: DisputeIncident[];
  globalTensionIndex: number;
  escalatingCount: number;
  armedConflictCount: number;
  phaseDistribution: Record<DisputePhase, number>;
} {
  return {
    disputes: rankByseverity(MOCK_DISPUTES),
    recentIncidents: getRecentHighSeverityIncidents(MOCK_INCIDENTS),
    globalTensionIndex: computeGlobalTensionIndex(MOCK_DISPUTES),
    escalatingCount: filterByTrend(MOCK_DISPUTES, 'escalating').length,
    armedConflictCount: filterByPhase(MOCK_DISPUTES, 'armed-conflict').length,
    phaseDistribution: getPhaseDistribution(MOCK_DISPUTES),
  };
}
