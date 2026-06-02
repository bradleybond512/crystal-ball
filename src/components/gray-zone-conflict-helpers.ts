// gray-zone-conflict-helpers.ts — pure deterministic helpers

export type GrayActor = 'Russia' | 'China' | 'Iran' | 'North Korea' | 'Turkey' | 'non-state' | 'hybrid';
export type GrayTactic = 'lawfare' | 'economic-coercion' | 'cyber-harassment' | 'proxy-violence' | 'disinformation' | 'espionage' | 'maritime-harassment' | 'election-interference' | 'assassination' | 'sabotage';
export type IntensityLevel = 'extreme' | 'high' | 'moderate' | 'low';
export type TargetDomain = 'political' | 'economic' | 'military' | 'information' | 'cyber' | 'physical';

export interface GrayZoneOperation {
  id: string;
  name: string;
  actor: GrayActor;
  targetNation: string;
  tactics: GrayTactic[];
  domain: TargetDomain;
  startDate: string;
  active: boolean;
  intensity: IntensityLevel;
  escalationPotential: number; // 0-100
  deniabilityScore: number; // 0-100 (high = actor effectively deniable)
  responseConstraint: string; // why target can't respond conventionally
}

export interface GrayIncident {
  id: string;
  date: string;
  actor: GrayActor;
  targetNation: string;
  tactic: GrayTactic;
  description: string;
  escalationDelta: number; // -5 to +10
}

const MOCK_OPERATIONS: GrayZoneOperation[] = [
  { id: 'ru-ukraine-hybrid', name: 'Russia Ukraine Hybrid Campaign', actor: 'Russia', targetNation: 'Ukraine', tactics: ['sabotage','disinformation','proxy-violence','cyber-harassment'], domain: 'military', startDate: '2014-02-27', active: true, intensity: 'extreme', escalationPotential: 95, deniabilityScore: 30, responseConstraint: 'NATO Article 5 ambiguity + nuclear escalation risk' },
  { id: 'cn-taiwan-gray', name: 'PLA Taiwan Strait Gray Zone', actor: 'China', targetNation: 'Taiwan', tactics: ['maritime-harassment','disinformation','economic-coercion','lawfare'], domain: 'military', startDate: '2020-09-01', active: true, intensity: 'high', escalationPotential: 88, deniabilityScore: 45, responseConstraint: 'US One China policy ambiguity + economic interdependence' },
  { id: 'ru-nato-sabotage', name: 'Russia NATO Infrastructure Sabotage', actor: 'Russia', targetNation: 'NATO', tactics: ['sabotage','cyber-harassment','assassination'], domain: 'physical', startDate: '2022-09-01', active: true, intensity: 'high', escalationPotential: 82, deniabilityScore: 55, responseConstraint: 'Attribution difficulty + escalation to war threshold' },
  { id: 'ir-gulf-harassment', name: 'Iran Gulf Maritime Harassment', actor: 'Iran', targetNation: 'USA', tactics: ['maritime-harassment','proxy-violence','lawfare'], domain: 'military', startDate: '2019-05-01', active: true, intensity: 'moderate', escalationPotential: 65, deniabilityScore: 40, responseConstraint: 'JCPOA diplomacy + US domestic war fatigue' },
  { id: 'cn-scs-reclamation', name: 'China SCS Salami Slicing', actor: 'China', targetNation: 'Philippines', tactics: ['maritime-harassment','lawfare','economic-coercion'], domain: 'political', startDate: '2012-01-01', active: true, intensity: 'high', escalationPotential: 75, deniabilityScore: 60, responseConstraint: 'US-Philippines alliance ambiguity + economic ties' },
  { id: 'ru-baltics-pressure', name: 'Russia Baltic Hybrid Pressure', actor: 'Russia', targetNation: 'Baltic States', tactics: ['disinformation','cyber-harassment','economic-coercion','election-interference'], domain: 'information', startDate: '2022-01-01', active: true, intensity: 'moderate', escalationPotential: 55, deniabilityScore: 65, responseConstraint: 'NATO Article 5 gap at sub-threshold — proving attribution' },
  { id: 'dprk-crypto-theft', name: 'DPRK Cyber Financial Operations', actor: 'North Korea', targetNation: 'Global', tactics: ['cyber-harassment','espionage'], domain: 'cyber', startDate: '2018-01-01', active: true, intensity: 'high', escalationPotential: 40, deniabilityScore: 70, responseConstraint: 'DPRK sanctions ceiling already hit; nuclear deterrence' },
  { id: 'ir-assassination', name: 'Iran Assassination Network (Diaspora)', actor: 'Iran', targetNation: 'USA', tactics: ['assassination','espionage'], domain: 'physical', startDate: '2020-01-01', active: true, intensity: 'moderate', escalationPotential: 70, deniabilityScore: 50, responseConstraint: 'JCPOA diplomacy + escalation to Iran war risk' },
];

const MOCK_INCIDENTS: GrayIncident[] = [
  { id: 'gi1', date: '2024-03-15', actor: 'Russia', targetNation: 'Germany', tactic: 'sabotage', description: 'Deutsche Bahn signaling cable cuts attributed to GRU', escalationDelta: 6 },
  { id: 'gi2', date: '2024-04-22', actor: 'China', targetNation: 'Philippines', tactic: 'maritime-harassment', description: 'PLAN water cannon against Philippine supply mission at Second Thomas Shoal', escalationDelta: 5 },
  { id: 'gi3', date: '2024-05-10', actor: 'Iran', targetNation: 'USA', tactic: 'assassination', description: 'FBI disrupts alleged IRGC plot to kill former NSA', escalationDelta: 7 },
  { id: 'gi4', date: '2024-06-02', actor: 'Russia', targetNation: 'Poland', tactic: 'sabotage', description: 'Arson at Warsaw logistics hub tied to GRU Ghost Network', escalationDelta: 6 },
  { id: 'gi5', date: '2024-07-18', actor: 'North Korea', targetNation: 'Global', tactic: 'cyber-harassment', description: 'Lazarus Group $300M DeFi protocol exploit', escalationDelta: 3 },
  { id: 'gi6', date: '2024-09-05', actor: 'China', targetNation: 'Taiwan', tactic: 'disinformation', description: 'Coordinated AI-generated content flooding Taiwanese social media ahead of elections', escalationDelta: 4 },
];

export function scoreOperationSeverity(op: GrayZoneOperation): number {
  const intensityMap: Record<IntensityLevel, number> = { extreme: 40, high: 30, moderate: 20, low: 10 };
  const tacticBonus = Math.min(25, op.tactics.length * 5);
  const deniabilityWeight = (100 - op.deniabilityScore) * 0.35;
  return Math.min(100, Math.round(intensityMap[op.intensity] + tacticBonus + deniabilityWeight));
}

export function classifyIntensity(escalationPotential: number): IntensityLevel {
  if (escalationPotential >= 80) return 'extreme';
  if (escalationPotential >= 60) return 'high';
  if (escalationPotential >= 35) return 'moderate';
  return 'low';
}

export function filterByActor(ops: GrayZoneOperation[], actor: GrayActor): GrayZoneOperation[] {
  return ops.filter(o => o.actor === actor);
}

export function filterActive(ops: GrayZoneOperation[]): GrayZoneOperation[] {
  return ops.filter(o => o.active);
}

export function rankByEscalationPotential(ops: GrayZoneOperation[]): GrayZoneOperation[] {
  return [...ops].sort((a, b) => b.escalationPotential - a.escalationPotential);
}

export function getTacticDistribution(ops: GrayZoneOperation[]): Record<GrayTactic, number> {
  const dist: Record<GrayTactic, number> = { lawfare: 0, 'economic-coercion': 0, 'cyber-harassment': 0, 'proxy-violence': 0, disinformation: 0, espionage: 0, 'maritime-harassment': 0, 'election-interference': 0, assassination: 0, sabotage: 0 };
  for (const o of ops) for (const t of o.tactics) dist[t]++;
  return dist;
}

export function computeGlobalGrayZoneIndex(ops: GrayZoneOperation[]): number {
  const active = filterActive(ops);
  if (!active.length) return 0;
  return Math.round(active.reduce((s, o) => s + o.escalationPotential, 0) / active.length);
}

export function getMostDangerousActor(ops: GrayZoneOperation[]): GrayActor {
  const scores: Record<string, number> = {};
  for (const o of ops) scores[o.actor] = Math.max(scores[o.actor] ?? 0, o.escalationPotential);
  return (Object.entries(scores).sort(([,a],[,b]) => b - a)[0]?.[0] ?? 'Russia') as GrayActor;
}

export function getRecentIncidents(incidents: GrayIncident[], days = 180): GrayIncident[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return incidents.filter(i => i.date >= cutoff).sort((a, b) => b.escalationDelta - a.escalationDelta);
}

export function buildRenderData(): {
  operations: GrayZoneOperation[];
  recentIncidents: GrayIncident[];
  globalGrayZoneIndex: number;
  mostDangerousActor: GrayActor;
  tacticDistribution: Record<GrayTactic, number>;
  activeCount: number;
} {
  return {
    operations: rankByEscalationPotential(MOCK_OPERATIONS),
    recentIncidents: getRecentIncidents(MOCK_INCIDENTS),
    globalGrayZoneIndex: computeGlobalGrayZoneIndex(MOCK_OPERATIONS),
    mostDangerousActor: getMostDangerousActor(MOCK_OPERATIONS),
    tacticDistribution: getTacticDistribution(MOCK_OPERATIONS),
    activeCount: filterActive(MOCK_OPERATIONS).length,
  };
}
