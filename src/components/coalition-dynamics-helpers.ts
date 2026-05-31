// coalition-dynamics-helpers.ts
// Pure logic for CoalitionDynamicsPanel — no DOM, no Panel imports

export type CoalitionType = 'Security Alliance' | 'Ad Hoc Coalition' | 'Economic Bloc' | 'Diplomatic Grouping' | 'Intelligence Partnership' | 'Military Coalition';
export type CoalitionHealth = 'Strengthening' | 'Stable' | 'Stressed' | 'Fracturing' | 'Collapsed';
export type DefectionRisk = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Coalition {
  id: string;
  name: string;
  type: CoalitionType;
  members: string[];
  formedYear: number;
  health: CoalitionHealth;
  cohesionScore: number; // 0-10
  purposeAchieved: number; // 0-10, how well purpose is being fulfilled
  defectionRisk: DefectionRisk;
  keyFaultLine: string;
  recentDevelopment: string;
  aggressorFocus: string; // who/what the coalition is against or for
}

export interface CoalitionEvent {
  id: string;
  date: string;
  coalition: string;
  eventType: 'New Member' | 'Member Defection' | 'Summit' | 'Joint Operation' | 'Internal Dispute' | 'Expansion' | 'Dissolution' | 'Leadership Change';
  description: string;
  impact: 'Positive' | 'Negative' | 'Neutral';
  severity: number; // 1-10
}

export interface CoalitionData {
  coalitions: Coalition[];
  events: CoalitionEvent[];
  globalCoalitionIndex: number;
  strengtheningCount: number;
  fracturingCount: number;
  criticalDefectionCount: number;
  totalMembers: number;
}

const COALITIONS: Coalition[] = [
  { id: 'C001', name: 'NATO', type: 'Security Alliance', members: ['USA','UK','France','Germany','Poland','Turkey','Canada','Italy','Spain','Netherlands','Norway','Denmark','Belgium','Portugal','Greece','Czechia','Hungary','Romania','Bulgaria','Slovakia','Albania','Montenegro','N.Macedonia','Croatia','Estonia','Latvia','Lithuania','Slovenia','Finland','Sweden'], formedYear: 1949, health: 'Strengthening', cohesionScore: 7, purposeAchieved: 8, defectionRisk: 'Medium', keyFaultLine: 'Turkey-Sweden/Finland tensions; Hungary blocking Ukraine aid; burden-sharing disputes', recentDevelopment: 'Finland joined 2023, Sweden 2024; Nordic-Baltic cohesion strongest ever; 32 members', aggressorFocus: 'Russia + hybrid threats' },
  { id: 'C002', name: 'AUKUS', type: 'Intelligence Partnership', members: ['Australia','UK','USA'], formedYear: 2021, health: 'Strengthening', cohesionScore: 9, purposeAchieved: 7, defectionRisk: 'Low', keyFaultLine: 'Nuclear submarine delivery timeline slipping; cost overruns', recentDevelopment: 'Pillar II AI/cyber cooperation expanded; Japan and South Korea pursuing associate status', aggressorFocus: 'China (Indo-Pacific deterrence)' },
  { id: 'C003', name: 'QUAD', type: 'Diplomatic Grouping', members: ['USA','Japan','Australia','India'], formedYear: 2017, health: 'Stable', cohesionScore: 6, purposeAchieved: 6, defectionRisk: 'Medium', keyFaultLine: 'India refuses to name China; India-Pakistan tensions (Pahalgam 2025); India ties to Russia', recentDevelopment: 'QUAD Summit 2024 reaffirmed; Indo-Pacific maritime domain awareness sharing expanded', aggressorFocus: 'China (Indo-Pacific stability)' },
  { id: 'C004', name: 'Five Eyes', type: 'Intelligence Partnership', members: ['USA','UK','Canada','Australia','New Zealand'], formedYear: 1946, health: 'Stable', cohesionScore: 10, purposeAchieved: 9, defectionRisk: 'Low', keyFaultLine: 'NZ excluded from AUKUS submarine track; occasional sovereignty disputes', recentDevelopment: 'Salt Typhoon joint attribution; Volt Typhoon advisory; expanded SIGINT cooperation on AI surveillance', aggressorFocus: 'China + Russia signals intelligence' },
  { id: 'C005', name: 'Ukraine Support Coalition (Ramstein)', type: 'Ad Hoc Coalition', members: ['USA','UK','Germany','France','Poland','Canada','Netherlands','Denmark','Australia','Japan'], formedYear: 2022, health: 'Stressed', cohesionScore: 6, purposeAchieved: 6, defectionRisk: 'High', keyFaultLine: 'USA reliability under Trump 2.0; European divergence on weapons escalation; fatigue risk; F-16 delivery delays', recentDevelopment: 'European members pledged $20B+ 2024; Trump threatened aid cuts; Germany 2% GDP defense push', aggressorFocus: 'Russia (Ukraine defense)' },
  { id: 'C006', name: 'Axis of Resistance', type: 'Military Coalition', members: ['Iran','Hezbollah','Hamas','Houthis','Iraqi PMF','Syrian government'], formedYear: 1982, health: 'Stressed', cohesionScore: 6, purposeAchieved: 5, defectionRisk: 'High', keyFaultLine: 'Hezbollah degraded by Israeli strikes 2024; Hamas leadership eliminated; Assad fell Dec 2024', recentDevelopment: 'Syria fell Dec 2024 -- major Axis setback; Iran regrouping; Houthis still active Red Sea ops', aggressorFocus: 'Israel + USA + Gulf states' },
  { id: 'C007', name: 'SCO (Shanghai Cooperation Organisation)', type: 'Diplomatic Grouping', members: ['China','Russia','India','Pakistan','Iran','Kazakhstan','Kyrgyzstan','Tajikistan','Uzbekistan','Belarus'], formedYear: 2001, health: 'Stable', cohesionScore: 5, purposeAchieved: 5, defectionRisk: 'Low', keyFaultLine: 'India-Pakistan antagonism; India-China border disputes; diverse strategic interests', recentDevelopment: 'Iran joined 2023; Belarus joined 2024; Belarus + Iran + Russia deepened security cooperation inside SCO', aggressorFocus: 'Western-led order (loosely)' },
  { id: 'C008', name: 'Abraham Accords Coalition', type: 'Diplomatic Grouping', members: ['Israel','UAE','Bahrain','Morocco','Sudan'], formedYear: 2020, health: 'Stressed', cohesionScore: 5, purposeAchieved: 5, defectionRisk: 'High', keyFaultLine: 'Gaza war strained Gulf-Israel ties; Saudi normalization paused; Arab street pressure', recentDevelopment: 'Saudi normalization negotiations frozen post-Oct 7; UAE quietly maintained ties; Morocco relations stable', aggressorFocus: 'Iran + regional stability' },
  { id: 'C009', name: 'G7', type: 'Economic Bloc', members: ['USA','UK','France','Germany','Italy','Japan','Canada'], formedYear: 1975, health: 'Stressed', cohesionScore: 6, purposeAchieved: 6, defectionRisk: 'Medium', keyFaultLine: 'Trump trade wars; tariff disputes with Canada/EU; divergence on China economic strategy', recentDevelopment: 'G7 Apulia summit 2024 pledged $50B Ukraine loan; agreed AI governance framework; G7 vs BRICS competition', aggressorFocus: 'Russia (Ukraine) + China (trade)' },
  { id: 'C010', name: 'BRICS+', type: 'Economic Bloc', members: ['Brazil','Russia','India','China','South Africa','UAE','Saudi Arabia','Iran','Ethiopia','Egypt','Indonesia (candidate)'], formedYear: 2009, health: 'Strengthening', cohesionScore: 5, purposeAchieved: 5, defectionRisk: 'Low', keyFaultLine: 'Divergent interests; India-China rivalry; dollar-alternative currency aspirations stalled', recentDevelopment: 'Expanded to 11 members 2024; dedollarization push; New Development Bank challenged by political disputes', aggressorFocus: 'Western-led financial order' },
];

const EVENTS: CoalitionEvent[] = [
  { id: 'E001', date: '2024-03-07', coalition: 'NATO', eventType: 'New Member', description: "Sweden became NATO's 32nd member, completing Nordic-Baltic security arc.", impact: 'Positive', severity: 8 },
  { id: 'E002', date: '2024-12-08', coalition: 'Axis of Resistance', eventType: 'Member Defection', description: 'Assad regime collapsed in Syria after HTS offensive; Iran lost key transit corridor and forward base.', impact: 'Negative', severity: 10 },
  { id: 'E003', date: '2024-11-05', coalition: 'Ukraine Support Coalition (Ramstein)', eventType: 'Internal Dispute', description: 'Trump election victory raised acute doubts about US commitment to Ukraine coalition funding.', impact: 'Negative', severity: 9 },
  { id: 'E004', date: '2024-09', coalition: 'Abraham Accords Coalition', eventType: 'Internal Dispute', description: 'Saudi-Israel normalization formally suspended; MBS demanded Palestinian state path before any normalization.', impact: 'Negative', severity: 7 },
  { id: 'E005', date: '2024-07', coalition: 'QUAD', eventType: 'Summit', description: 'Biden hosted QUAD summit; Indo-Pacific maritime domain awareness initiative expanded; joint coast guard exercises.', impact: 'Positive', severity: 6 },
  { id: 'E006', date: '2024-05', coalition: 'BRICS+', eventType: 'Expansion', description: 'New Development Bank paused new loans amid Russia sanctions concerns; dedollarization stalled without US dollar alternative.', impact: 'Negative', severity: 5 },
  { id: 'E007', date: '2024-02', coalition: 'NATO', eventType: 'Internal Dispute', description: 'Hungary blocked EUR50B Ukraine aid package for months; Orban met Putin; NATO unity threatened.', impact: 'Negative', severity: 7 },
  { id: 'E008', date: '2024-01', coalition: 'Five Eyes', eventType: 'Joint Operation', description: 'Five Eyes joint advisory on Volt Typhoon PRC pre-positioning in US critical infrastructure.', impact: 'Positive', severity: 8 },
];

export function computeGlobalCoalitionIndex(coalitions: Coalition[]): number {
  if (!coalitions.length) return 50;
  const avg = coalitions.reduce((s, c) => s + c.cohesionScore, 0) / coalitions.length;
  return Math.round(avg * 10);
}

export function getByHealth(coalitions: Coalition[], health: CoalitionHealth): Coalition[] {
  return coalitions.filter(c => c.health === health);
}

export function getFracturingCoalitions(coalitions: Coalition[]): Coalition[] {
  return coalitions.filter(c => c.health === 'Fracturing' || c.health === 'Collapsed' || c.health === 'Stressed');
}

export function getCriticalDefectionRisk(coalitions: Coalition[]): Coalition[] {
  return coalitions.filter(c => c.defectionRisk === 'Critical' || c.defectionRisk === 'High');
}

export function computeTotalMembers(coalitions: Coalition[]): number {
  const all = new Set<string>();
  for (const c of coalitions) for (const m of c.members) all.add(m);
  return all.size;
}

export function rankByCohesion(coalitions: Coalition[]): Coalition[] {
  return [...coalitions].sort((a, b) => b.cohesionScore - a.cohesionScore);
}

export function healthClass(health: CoalitionHealth): string {
  const m: Record<CoalitionHealth, string> = { Strengthening: 'health-strong', Stable: 'health-stable', Stressed: 'health-stressed', Fracturing: 'health-fracturing', Collapsed: 'health-collapsed' };
  return m[health] ?? 'health-stable';
}

export function defectionClass(risk: DefectionRisk): string {
  const m: Record<DefectionRisk, string> = { Low: 'def-low', Medium: 'def-medium', High: 'def-high', Critical: 'def-critical' };
  return m[risk] ?? 'def-low';
}

export function impactClass(impact: CoalitionEvent['impact']): string {
  return impact === 'Positive' ? 'impact-pos' : impact === 'Negative' ? 'impact-neg' : 'impact-neutral';
}

export function buildRenderData(): CoalitionData {
  return {
    coalitions: COALITIONS,
    events: EVENTS,
    globalCoalitionIndex: computeGlobalCoalitionIndex(COALITIONS),
    strengtheningCount: getByHealth(COALITIONS, 'Strengthening').length,
    fracturingCount: getFracturingCoalitions(COALITIONS).length,
    criticalDefectionCount: getCriticalDefectionRisk(COALITIONS).length,
    totalMembers: computeTotalMembers(COALITIONS),
  };
}
