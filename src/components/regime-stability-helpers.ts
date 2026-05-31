// regime-stability-helpers.ts
// Pure logic for RegimeStabilityPanel — no DOM, no Panel imports

export type StabilityCategory = 'Stable' | 'Fragile' | 'Crisis' | 'Collapsed';
export type StabilityTrend = 'improving' | 'stable' | 'deteriorating' | 'collapsing';
export type GovernmentType = 'Democracy' | 'Hybrid' | 'Autocracy' | 'Military Junta' | 'Failed State';

export interface RegimeState {
  id: string;
  country: string;
  region: string;
  governmentType: GovernmentType;
  fsiScore: number; // Fragile States Index 0-120, higher = more fragile
  stabilityCategory: StabilityCategory;
  trend: StabilityTrend;
  coupRiskScore: number; // 0-10
  eliteCoherenceScore: number; // 0-10, higher = more unified
  economicGrievanceScore: number; // 0-10
  securityApparatusScore: number; // 0-10
  externalInterventionRisk: boolean;
  lastElection: string;
  keyRisk: string;
  population: number; // millions
}

export interface RegimeChangeEvent {
  id: string;
  date: string;
  country: string;
  eventType: 'Coup' | 'Coup Attempt' | 'Mass Protest' | 'Election Disputed' | 'Constitutional Crisis' | 'Civil War Onset' | 'Leadership Change';
  description: string;
  outcome: 'Regime Change' | 'Regime Survived' | 'Ongoing' | 'Negotiated Settlement';
  severity: number; // 1-10
}

export interface RegimeRenderData {
  states: RegimeState[];
  events: RegimeChangeEvent[];
  globalInstabilityIndex: number;
  collapsedCount: number;
  crisisCount: number;
  fragileCount: number;
  highCoupRiskCount: number;
  mostFragile: RegimeState[];
}

const STATES: RegimeState[] = [
  { id: 'R001', country: 'Somalia', region: 'East Africa', governmentType: 'Failed State', fsiScore: 113, stabilityCategory: 'Collapsed', trend: 'stable', coupRiskScore: 9, eliteCoherenceScore: 1, economicGrievanceScore: 10, securityApparatusScore: 9, externalInterventionRisk: true, lastElection: '2022', keyRisk: 'Al-Shabaab control, clan fragmentation, famine', population: 17 },
  { id: 'R002', country: 'Sudan', region: 'North Africa', governmentType: 'Military Junta', fsiScore: 109, stabilityCategory: 'Collapsed', trend: 'collapsing', coupRiskScore: 8, eliteCoherenceScore: 2, economicGrievanceScore: 10, securityApparatusScore: 8, externalInterventionRisk: true, lastElection: '2019 (transitional)', keyRisk: 'SAF-RSF civil war since April 2023, 8M displaced', population: 46 },
  { id: 'R003', country: 'South Sudan', region: 'East Africa', governmentType: 'Hybrid', fsiScore: 108, stabilityCategory: 'Crisis', trend: 'deteriorating', coupRiskScore: 8, eliteCoherenceScore: 2, economicGrievanceScore: 9, securityApparatusScore: 8, externalInterventionRisk: true, lastElection: '2011', keyRisk: 'Ethnic militias, oil revenue disputes, food crisis', population: 11 },
  { id: 'R004', country: 'Syria', region: 'Middle East', governmentType: 'Autocracy', fsiScore: 107, stabilityCategory: 'Collapsed', trend: 'stable', coupRiskScore: 3, eliteCoherenceScore: 5, economicGrievanceScore: 10, securityApparatusScore: 7, externalInterventionRisk: true, lastElection: '2021 (unfree)', keyRisk: 'Post-civil war fragmentation, Russian/Iranian dependence, sanctions', population: 21 },
  { id: 'R005', country: 'Afghanistan', region: 'Central Asia', governmentType: 'Autocracy', fsiScore: 105, stabilityCategory: 'Collapsed', trend: 'stable', coupRiskScore: 4, eliteCoherenceScore: 6, economicGrievanceScore: 10, securityApparatusScore: 6, externalInterventionRisk: false, lastElection: '2019 (pre-Taliban)', keyRisk: 'Taliban legitimacy crisis, humanitarian collapse, IS-K insurgency', population: 42 },
  { id: 'R006', country: 'Yemen', region: 'Middle East', governmentType: 'Failed State', fsiScore: 106, stabilityCategory: 'Collapsed', trend: 'stable', coupRiskScore: 7, eliteCoherenceScore: 2, economicGrievanceScore: 10, securityApparatusScore: 9, externalInterventionRisk: true, lastElection: '2012', keyRisk: "Houthi-Saudi proxy war, world's worst humanitarian crisis", population: 34 },
  { id: 'R007', country: 'Myanmar', region: 'Southeast Asia', governmentType: 'Military Junta', fsiScore: 98, stabilityCategory: 'Crisis', trend: 'deteriorating', coupRiskScore: 2, eliteCoherenceScore: 6, economicGrievanceScore: 8, securityApparatusScore: 7, externalInterventionRisk: false, lastElection: '2020 (nullified by coup)', keyRisk: 'Junta vs. resistance forces; territory loss accelerating in 2024', population: 54 },
  { id: 'R008', country: 'Venezuela', region: 'Latin America', governmentType: 'Autocracy', fsiScore: 88, stabilityCategory: 'Fragile', trend: 'stable', coupRiskScore: 5, eliteCoherenceScore: 6, economicGrievanceScore: 9, securityApparatusScore: 7, externalInterventionRisk: true, lastElection: '2024 (disputed)', keyRisk: 'Economic collapse, Maduro election fraud, mass emigration', population: 28 },
  { id: 'R009', country: 'Haiti', region: 'Caribbean', governmentType: 'Failed State', fsiScore: 102, stabilityCategory: 'Collapsed', trend: 'collapsing', coupRiskScore: 9, eliteCoherenceScore: 1, economicGrievanceScore: 10, securityApparatusScore: 9, externalInterventionRisk: true, lastElection: '2016', keyRisk: 'Gang control of 80% of Port-au-Prince, no functioning government', population: 12 },
  { id: 'R010', country: 'Pakistan', region: 'South Asia', governmentType: 'Hybrid', fsiScore: 79, stabilityCategory: 'Fragile', trend: 'deteriorating', coupRiskScore: 6, eliteCoherenceScore: 4, economicGrievanceScore: 8, securityApparatusScore: 5, externalInterventionRisk: false, lastElection: '2024 (disputed)', keyRisk: 'Military-judiciary-civilian triad instability; Imran Khan arrest; economic crisis', population: 231 },
  { id: 'R011', country: 'Ethiopia', region: 'East Africa', governmentType: 'Hybrid', fsiScore: 91, stabilityCategory: 'Crisis', trend: 'deteriorating', coupRiskScore: 7, eliteCoherenceScore: 3, economicGrievanceScore: 9, securityApparatusScore: 7, externalInterventionRisk: false, lastElection: '2021', keyRisk: 'Amhara conflict, Tigray aftermath, Oromo insurgency', population: 126 },
  { id: 'R012', country: 'Russia', region: 'Europe/Asia', governmentType: 'Autocracy', fsiScore: 72, stabilityCategory: 'Fragile', trend: 'deteriorating', coupRiskScore: 4, eliteCoherenceScore: 6, economicGrievanceScore: 7, securityApparatusScore: 4, externalInterventionRisk: false, lastElection: '2024 (unfree)', keyRisk: 'Ukraine war attrition, Prigozhin precedent, elite defection risk', population: 145 },
  { id: 'R013', country: 'Hungary', region: 'Europe', governmentType: 'Hybrid', fsiScore: 48, stabilityCategory: 'Stable', trend: 'stable', coupRiskScore: 1, eliteCoherenceScore: 8, economicGrievanceScore: 5, securityApparatusScore: 2, externalInterventionRisk: false, lastElection: '2022', keyRisk: 'Democratic backsliding; EU rule-of-law disputes; Orban consolidation', population: 10 },
  { id: 'R014', country: 'Iran', region: 'Middle East', governmentType: 'Autocracy', fsiScore: 82, stabilityCategory: 'Fragile', trend: 'deteriorating', coupRiskScore: 4, eliteCoherenceScore: 5, economicGrievanceScore: 9, securityApparatusScore: 5, externalInterventionRisk: false, lastElection: '2024', keyRisk: 'Post-Mahsa Amini protest wave; economic sanctions; IRGC influence; succession', population: 87 },
  { id: 'R015', country: 'Mali', region: 'West Africa', governmentType: 'Military Junta', fsiScore: 100, stabilityCategory: 'Crisis', trend: 'deteriorating', coupRiskScore: 6, eliteCoherenceScore: 4, economicGrievanceScore: 9, securityApparatusScore: 7, externalInterventionRisk: true, lastElection: '2021 (coup)', keyRisk: 'Junta expelled French/UN forces; Wagner Group presence; jihadist expansion', population: 22 },
];

const EVENTS: RegimeChangeEvent[] = [
  { id: 'E001', date: '2023-04-15', country: 'Sudan', eventType: 'Coup', description: 'SAF-RSF armed conflict erupted in Khartoum; effectively a coup attempt by RSF. Civil war ongoing.', outcome: 'Ongoing', severity: 10 },
  { id: 'E002', date: '2023-09-26', country: 'Gabon', eventType: 'Coup', description: 'Military seized power following disputed election; Bongo family removed after 56 years.', outcome: 'Regime Change', severity: 7 },
  { id: 'E003', date: '2023-07-26', country: 'Niger', eventType: 'Coup', description: 'Presidential Guard detained President Bazoum; ECOWAS intervention threatened but not executed.', outcome: 'Regime Change', severity: 8 },
  { id: 'E004', date: '2024-07-28', country: 'Venezuela', eventType: 'Election Disputed', description: 'Maduro claimed victory despite opposition evidence of fraud; mass protests suppressed.', outcome: 'Regime Survived', severity: 8 },
  { id: 'E005', date: '2024-02-29', country: 'Haiti', eventType: 'Constitutional Crisis', description: 'PM Henry resigned amid gang control of capital; transitional presidential council formed.', outcome: 'Negotiated Settlement', severity: 9 },
  { id: 'E006', date: '2024-10', country: 'Syria', eventType: 'Civil War Onset', description: 'HTS and allied factions launched surprise offensive from Idlib; Assad regime collapsed within weeks.', outcome: 'Regime Change', severity: 10 },
  { id: 'E007', date: '2024-09', country: 'Bangladesh', eventType: 'Mass Protest', description: "Student-led protests against Hasina government's quota system escalated; Hasina fled to India.", outcome: 'Regime Change', severity: 8 },
  { id: 'E008', date: '2024-12', country: 'South Korea', eventType: 'Constitutional Crisis', description: 'President Yoon declared martial law for 6 hours; National Assembly overrode it; Yoon impeached.', outcome: 'Negotiated Settlement', severity: 7 },
];

export function computeGlobalInstabilityIndex(states: RegimeState[]): number {
  if (!states.length) return 0;
  const avg = states.reduce((s, r) => s + r.fsiScore, 0) / states.length;
  return Math.min(100, Math.round((avg / 120) * 100));
}

export function getByCategory(states: RegimeState[], category: StabilityCategory): RegimeState[] {
  return states.filter(s => s.stabilityCategory === category);
}

export function getHighCoupRisk(states: RegimeState[], threshold = 6): RegimeState[] {
  return states.filter(s => s.coupRiskScore >= threshold);
}

export function getMostFragile(states: RegimeState[], n = 5): RegimeState[] {
  return [...states].sort((a, b) => b.fsiScore - a.fsiScore).slice(0, n);
}

export function getDeterioratingStates(states: RegimeState[]): RegimeState[] {
  return states.filter(s => s.trend === "deteriorating" || s.trend === "collapsing");
}

export function getRecentCoupEvents(events: RegimeChangeEvent[]): RegimeChangeEvent[] {
  return events.filter(e => e.eventType === "Coup" || e.eventType === "Coup Attempt");
}

export function stabilityClass(category: StabilityCategory): string {
  const map: Record<StabilityCategory, string> = { Stable: 'stab-stable', Fragile: 'stab-fragile', Crisis: 'stab-crisis', Collapsed: 'stab-collapsed' };
  return map[category] ?? 'stab-fragile';
}

export function trendClass(trend: StabilityTrend): string {
  const map: Record<StabilityTrend, string> = { improving: 'trend-up', stable: 'trend-flat', deteriorating: 'trend-down', collapsing: 'trend-critical' };
  return map[trend] ?? 'trend-flat';
}

export function trendArrow(trend: StabilityTrend): string {
  return { improving: "↑", stable: "→", deteriorating: "↓", collapsing: "↓↓" }[trend] ?? "→";
}

export function outcomeClass(outcome: RegimeChangeEvent["outcome"]): string {
  const map: Record<string, string> = { "Regime Change": "outcome-change", "Regime Survived": "outcome-survived", "Ongoing": "outcome-ongoing", "Negotiated Settlement": "outcome-settled" };
  return map[outcome] ?? "outcome-survived";
}

export function buildRenderData(): RegimeRenderData {
  return {
    states: STATES,
    events: EVENTS,
    globalInstabilityIndex: computeGlobalInstabilityIndex(STATES),
    collapsedCount: getByCategory(STATES, "Collapsed").length,
    crisisCount: getByCategory(STATES, "Crisis").length,
    fragileCount: getByCategory(STATES, "Fragile").length,
    highCoupRiskCount: getHighCoupRisk(STATES).length,
    mostFragile: getMostFragile(STATES, 5),
  };
}
