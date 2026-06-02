// hybrid-warfare-helpers.ts
// Pure logic for HybridWarfarePanel — no DOM, no Panel imports

export type HybridComponent = 'Cyber' | 'Information Ops' | 'Proxy Forces' | 'Economic Coercion' | 'Lawfare' | 'Sabotage' | 'Political Subversion' | 'Energy Leverage';
export type OperationStatus = 'Active' | 'Escalating' | 'Dormant' | 'Concluded';
export type ThreatSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export interface HybridOperation {
  id: string;
  actor: string;
  target: string;
  components: HybridComponent[];
  status: OperationStatus;
  severity: ThreatSeverity;
  severityScore: number; // 1-10
  description: string;
  startDate: string;
  lastActivity: string;
  attribution: 'Confirmed' | 'High Confidence' | 'Suspected';
}

export interface HybridIncident {
  id: string;
  date: string;
  actor: string;
  target: string;
  component: HybridComponent;
  description: string;
  severity: ThreatSeverity;
}

export interface HybridWarfareData {
  operations: HybridOperation[];
  incidents: HybridIncident[];
  globalHybridIndex: number;
  activeOperationCount: number;
  escalatingCount: number;
  criticalCount: number;
  topActors: string[];
}

const OPERATIONS: HybridOperation[] = [
  { id: 'OP001', actor: 'Russia', target: 'Ukraine + NATO', components: ['Cyber', 'Information Ops', 'Proxy Forces', 'Sabotage', 'Energy Leverage'], status: 'Active', severity: 'Critical', severityScore: 10, description: 'Full-spectrum hybrid campaign: APT attacks on NATO infrastructure, disinformation amplification, energy weaponization, sabotage of European logistics/pipelines, proxy-assisted Wagner remnant operations.', startDate: '2022-02', lastActivity: '2024-11', attribution: 'Confirmed' },
  { id: 'OP002', actor: 'China', target: 'Taiwan + USA', components: ['Cyber', 'Information Ops', 'Economic Coercion', 'Political Subversion', 'Lawfare'], status: 'Active', severity: 'Critical', severityScore: 9, description: 'Integrated campaign: PLA-SSF cyber intrusions (Volt Typhoon), diaspora influence operations, economic dependency leverage, legal claims in SCS, influence in Taiwanese political parties.', startDate: '2020-01', lastActivity: '2024-12', attribution: 'Confirmed' },
  { id: 'OP003', actor: 'Russia', target: 'Germany + France + Italy', components: ['Information Ops', 'Energy Leverage', 'Political Subversion', 'Lawfare'], status: 'Active', severity: 'High', severityScore: 8, description: 'Far-right and far-left amplification, funding of anti-EU parties, energy price manipulation narrative, legal challenges to EU sanctions.', startDate: '2021-01', lastActivity: '2024-10', attribution: 'Confirmed' },
  { id: 'OP004', actor: 'Iran', target: 'Israel + Gulf States', components: ['Cyber', 'Proxy Forces', 'Information Ops'], status: 'Active', severity: 'High', severityScore: 8, description: 'Axis of Resistance proxy network (Hezbollah, Houthis, Hamas, PMF), Israeli infrastructure cyber attacks, disinformation across Arab social media.', startDate: '2019-01', lastActivity: '2024-11', attribution: 'Confirmed' },
  { id: 'OP005', actor: 'China', target: 'Philippines + Vietnam', components: ['Lawfare', 'Economic Coercion', 'Proxy Forces'], status: 'Escalating', severity: 'High', severityScore: 7, description: 'Coast guard harassment, maritime militia operations in SCS, economic pressure on Belt and Road recipients, UNCLOS non-compliance.', startDate: '2020-06', lastActivity: '2024-12', attribution: 'Confirmed' },
  { id: 'OP006', actor: 'Russia', target: 'Baltic States + Poland', components: ['Cyber', 'Sabotage', 'Information Ops', 'Political Subversion'], status: 'Escalating', severity: 'High', severityScore: 8, description: 'GRU sabotage of NATO logistics infrastructure, Baltic undersea cable cuts, Russian-language disinformation, ethnic Russian minority agitation.', startDate: '2023-06', lastActivity: '2024-11', attribution: 'High Confidence' },
  { id: 'OP007', actor: 'North Korea', target: 'South Korea + USA', components: ['Cyber', 'Information Ops', 'Economic Coercion'], status: 'Active', severity: 'Medium', severityScore: 6, description: 'Lazarus Group cryptocurrency theft ($3B+), SWIFT banking attacks, Seoul government network intrusions, propaganda messaging in South Korea.', startDate: '2017-01', lastActivity: '2024-10', attribution: 'Confirmed' },
  { id: 'OP008', actor: 'Wagner/Russia', target: 'Sahel + West Africa', components: ['Proxy Forces', 'Information Ops', 'Economic Coercion', 'Political Subversion'], status: 'Active', severity: 'High', severityScore: 7, description: 'Africa Corps (post-Prigozhin Wagner) in Mali, Burkina Faso, Niger, CAR; anti-French messaging; gold/mineral resource extraction; junta support.', startDate: '2021-01', lastActivity: '2024-11', attribution: 'Confirmed' },
];

const INCIDENTS: HybridIncident[] = [
  { id: 'I001', date: '2024-11-19', actor: 'Russia', target: 'Germany', component: 'Sabotage', description: 'Deutsche Bahn signal cable sabotage disrupted Hamburg rail network. GRU Unit 29155 suspected.', severity: 'High' },
  { id: 'I002', date: '2024-10-08', actor: 'China/Russia (suspected)', target: 'Baltic Sea', component: 'Sabotage', description: 'Estlink-2 power cable and 4 Baltic telecoms cables severed. Chinese vessel Yi Peng 3 detained by Swedish/Finnish authorities.', severity: 'Critical' },
  { id: 'I003', date: '2024-09-25', actor: 'Russia', target: 'USA telecom (via China)', component: 'Cyber', description: 'Salt Typhoon attributed to MSS infiltrated AT&T, Verizon, T-Mobile; accessed wiretap systems. FBI/CISA joint advisory.', severity: 'Critical' },
  { id: 'I004', date: '2024-07-19', actor: 'Russia', target: 'CrowdStrike/global IT', component: 'Information Ops', description: 'Russia amplified Falcon sensor outage as cyberattack narrative; exploited to spread distrust of Western cybersecurity.', severity: 'Medium' },
  { id: 'I005', date: '2024-03-05', actor: 'Russia', target: 'Germany', component: 'Information Ops', description: 'Leaked German Bundeswehr Taurus missile discussion audio. GRU used leaked call to split German political will.', severity: 'High' },
  { id: 'I006', date: '2024-01-15', actor: 'China', target: 'Taiwan', component: 'Information Ops', description: 'Coordinated deepfake disinformation campaign targeting Taiwan presidential election; AI-generated video of candidates.', severity: 'High' },
  { id: 'I007', date: '2023-10-26', actor: 'Iran', target: 'Albania', component: 'Cyber', description: 'MOIS destroyed Albanian government IT infrastructure in retaliation for hosting MEK; full state-level destructive attack.', severity: 'Critical' },
  { id: 'I008', date: '2023-09-18', actor: 'Russia', target: 'Poland logistics', component: 'Sabotage', description: 'Polish arms-to-Ukraine rail logistics node arson. GRU-linked saboteur network arrested in Poland and Germany.', severity: 'High' },
];

export function computeGlobalHybridIndex(ops: HybridOperation[]): number {
  if (!ops.length) return 0;
  const active = ops.filter(o => o.status === 'Active' || o.status === 'Escalating');
  if (!active.length) return 10;
  const score = active.reduce((s, o) => s + o.severityScore, 0);
  return Math.min(100, Math.round((score / (active.length * 10)) * 100));
}

export function getActiveOperations(ops: HybridOperation[]): HybridOperation[] {
  return ops.filter(o => o.status === 'Active' || o.status === 'Escalating');
}

export function getEscalatingOperations(ops: HybridOperation[]): HybridOperation[] {
  return ops.filter(o => o.status === 'Escalating');
}

export function getCriticalOperations(ops: HybridOperation[]): HybridOperation[] {
  return ops.filter(o => o.severity === 'Critical');
}

export function getTopActors(ops: HybridOperation[]): string[] {
  const counts: Record<string, number> = {};
  for (const o of ops) counts[o.actor] = (counts[o.actor] ?? 0) + o.severityScore;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([a]) => a);
}

export function getComponentDistribution(ops: HybridOperation[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const o of ops) for (const c of o.components) dist[c] = (dist[c] ?? 0) + 1;
  return dist;
}

export function severityClass(s: ThreatSeverity): string {
  const m: Record<ThreatSeverity, string> = { Critical: 'sev-critical', High: 'sev-high', Medium: 'sev-medium', Low: 'sev-low' };
  return m[s] ?? 'sev-low';
}

export function statusClass(s: OperationStatus): string {
  const m: Record<OperationStatus, string> = { Active: 'op-active', Escalating: 'op-escalating', Dormant: 'op-dormant', Concluded: 'op-concluded' };
  return m[s] ?? 'op-dormant';
}

export function buildRenderData(): HybridWarfareData {
  return {
    operations: OPERATIONS,
    incidents: INCIDENTS,
    globalHybridIndex: computeGlobalHybridIndex(OPERATIONS),
    activeOperationCount: getActiveOperations(OPERATIONS).length,
    escalatingCount: getEscalatingOperations(OPERATIONS).length,
    criticalCount: getCriticalOperations(OPERATIONS).length,
    topActors: getTopActors(OPERATIONS),
  };
}
