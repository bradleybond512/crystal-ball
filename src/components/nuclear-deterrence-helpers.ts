// nuclear-deterrence-helpers.ts — pure deterministic helpers (doctrine + posture tracking only)

export type NuclearPower = "USA" | "Russia" | "China" | "UK" | "France" | "India" | "Pakistan" | "Israel" | "DPRK";
export type AlertLevel = "DEFCON-1" | "DEFCON-2" | "DEFCON-3" | "DEFCON-4" | "DEFCON-5" | "elevated" | "normal";
export type DoctrinePillar = "no-first-use" | "ambiguous" | "first-use-reserved" | "launch-on-warning" | "massive-retaliation";
export type TriadLeg = "land-based" | "sea-based" | "air-based";

export interface NuclearPosture {
  nation: NuclearPower;
  estimatedWarheads: number;
  deployedWarheads: number;
  doctrine: DoctrinePillar;
  alertLevel: AlertLevel;
  triadLegs: TriadLeg[];
  modernizationActive: boolean;
  treatyStatus: string;
  stabilityScore: number;
  escalationRisk: number;
}

export interface DeterrenceEvent {
  id: string;
  date: string;
  nations: NuclearPower[];
  eventType: "rhetoric-escalation" | "posture-change" | "exercise" | "near-miss" | "treaty-violation" | "arms-reduction";
  description: string;
  escalationImpact: number;
}

export interface NuclearTreaty {
  name: string;
  status: "in-force" | "withdrawn" | "expired" | "suspended" | "negotiating";
  parties: NuclearPower[];
  keyProvision: string;
  expiryYear?: number;
}

const MOCK_POSTURES: NuclearPosture[] = [
  { nation: "USA", estimatedWarheads: 5550, deployedWarheads: 1700, doctrine: "ambiguous", alertLevel: "DEFCON-4", triadLegs: ["land-based","sea-based","air-based"], modernizationActive: true, treatyStatus: "NPT member", stabilityScore: 78, escalationRisk: 25 },
  { nation: "Russia", estimatedWarheads: 6257, deployedWarheads: 1588, doctrine: "launch-on-warning", alertLevel: "elevated", triadLegs: ["land-based","sea-based","air-based"], modernizationActive: true, treatyStatus: "NPT member", stabilityScore: 45, escalationRisk: 72 },
  { nation: "China", estimatedWarheads: 500, deployedWarheads: 350, doctrine: "no-first-use", alertLevel: "normal", triadLegs: ["land-based","sea-based","air-based"], modernizationActive: true, treatyStatus: "NPT member", stabilityScore: 62, escalationRisk: 45 },
  { nation: "UK", estimatedWarheads: 225, deployedWarheads: 120, doctrine: "ambiguous", alertLevel: "DEFCON-5", triadLegs: ["sea-based"], modernizationActive: true, treatyStatus: "NPT member", stabilityScore: 88, escalationRisk: 12 },
  { nation: "France", estimatedWarheads: 290, deployedWarheads: 280, doctrine: "ambiguous", alertLevel: "DEFCON-5", triadLegs: ["sea-based","air-based"], modernizationActive: false, treatyStatus: "NPT member", stabilityScore: 85, escalationRisk: 10 },
  { nation: "India", estimatedWarheads: 164, deployedWarheads: 0, doctrine: "no-first-use", alertLevel: "normal", triadLegs: ["land-based","sea-based","air-based"], modernizationActive: true, treatyStatus: "NPT member", stabilityScore: 68, escalationRisk: 38 },
  { nation: "Pakistan", estimatedWarheads: 170, deployedWarheads: 0, doctrine: "first-use-reserved", alertLevel: "normal", triadLegs: ["land-based","air-based"], modernizationActive: true, treatyStatus: "NPT member", stabilityScore: 42, escalationRisk: 58 },
  { nation: "Israel", estimatedWarheads: 90, deployedWarheads: 0, doctrine: "ambiguous", alertLevel: "normal", triadLegs: ["land-based","sea-based","air-based"], modernizationActive: false, treatyStatus: "Non-signatory", stabilityScore: 70, escalationRisk: 35 },
  { nation: "DPRK", estimatedWarheads: 50, deployedWarheads: 0, doctrine: "first-use-reserved", alertLevel: "elevated", triadLegs: ["land-based"], modernizationActive: true, treatyStatus: "NPT-withdrawn", stabilityScore: 22, escalationRisk: 85 },
];

const MOCK_EVENTS: DeterrenceEvent[] = [
  { id: "ev1", date: "2024-02-24", nations: ["Russia"], eventType: "rhetoric-escalation", description: "Putin suspends New START participation", escalationImpact: 8 },
  { id: "ev2", date: "2024-03-18", nations: ["Russia", "USA"], eventType: "posture-change", description: "Russia announces tactical nuclear exercise near Ukraine border", escalationImpact: 7 },
  { id: "ev3", date: "2024-04-12", nations: ["DPRK"], eventType: "exercise", description: "DPRK simulated nuclear counterattack exercise", escalationImpact: 5 },
  { id: "ev4", date: "2024-06-01", nations: ["China"], eventType: "posture-change", description: "PLA Rocket Force expands DF-41 ICBM silo count by 35%", escalationImpact: 6 },
  { id: "ev5", date: "2024-09-10", nations: ["India", "Pakistan"], eventType: "rhetoric-escalation", description: "India-Pakistan heightened border tensions after cross-border incident", escalationImpact: 4 },
  { id: "ev6", date: "2024-11-05", nations: ["USA", "Russia"], eventType: "arms-reduction", description: "Informal New START compliance dialogue resumes in Geneva", escalationImpact: -3 },
];

const MOCK_TREATIES: NuclearTreaty[] = [
  { name: "New START", status: "suspended", parties: ["USA", "Russia"], keyProvision: "Limits deployed strategic warheads to 1,550 per side", expiryYear: 2026 },
  { name: "NPT", status: "in-force", parties: ["USA", "Russia", "China", "UK", "France", "India", "Pakistan", "Israel"], keyProvision: "Non-proliferation + disarmament obligations" },
  { name: "INF Treaty", status: "withdrawn", parties: ["USA", "Russia"], keyProvision: "Banned ground-launched missiles 500-5,500km range" },
  { name: "TPNW", status: "in-force", parties: [], keyProvision: "Total prohibition on nuclear weapons — no NWS parties" },
  { name: "Open Skies", status: "withdrawn", parties: ["USA", "Russia"], keyProvision: "Aerial surveillance flights over member territories" },
];

export function computeGlobalEscalationIndex(postures: NuclearPosture[]): number {
  const avg = postures.reduce((s, p) => s + p.escalationRisk, 0) / postures.length;
  return Math.round(avg);
}

export function rankByEscalationRisk(postures: NuclearPosture[]): NuclearPosture[] {
  return [...postures].sort((a, b) => b.escalationRisk - a.escalationRisk);
}

export function filterByAlertLevel(postures: NuclearPosture[], levels: AlertLevel[]): NuclearPosture[] {
  return postures.filter(p => levels.includes(p.alertLevel));
}

export function getTotalDeployedWarheads(postures: NuclearPosture[]): number {
  return postures.reduce((s, p) => s + p.deployedWarheads, 0);
}

export function getTotalEstimatedWarheads(postures: NuclearPosture[]): number {
  return postures.reduce((s, p) => s + p.estimatedWarheads, 0);
}

export function getDoctrineSummary(postures: NuclearPosture[]): Record<DoctrinePillar, number> {
  const dist: Record<DoctrinePillar, number> = { "no-first-use": 0, "ambiguous": 0, "first-use-reserved": 0, "launch-on-warning": 0, "massive-retaliation": 0 };
  for (const p of postures) dist[p.doctrine]++;
  return dist;
}

export function getHighRiskDyads(postures: NuclearPosture[], threshold = 55): [NuclearPower, NuclearPower][] {
  const highRisk = postures.filter(p => p.escalationRisk >= threshold);
  const dyads: [NuclearPower, NuclearPower][] = [];
  for (let i = 0; i < highRisk.length; i++) {
    for (let j = i + 1; j < highRisk.length; j++) {
      const a = highRisk[i];
      const b = highRisk[j];
      if (a && b) dyads.push([a.nation, b.nation]);
    }
  }
  return dyads;
}

export function getRecentEscalations(events: DeterrenceEvent[], days = 180): DeterrenceEvent[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return events.filter(e => e.date >= cutoff && e.escalationImpact > 0).sort((a, b) => b.escalationImpact - a.escalationImpact);
}

export function getTreatyHealth(treaties: NuclearTreaty[]): { active: number; degraded: number; collapsed: number } {
  return {
    active: treaties.filter(t => t.status === "in-force").length,
    degraded: treaties.filter(t => ["suspended", "negotiating"].includes(t.status)).length,
    collapsed: treaties.filter(t => ["withdrawn", "expired"].includes(t.status)).length,
  };
}

export function buildRenderData(): {
  postures: NuclearPosture[];
  recentEvents: DeterrenceEvent[];
  treaties: NuclearTreaty[];
  globalEscalationIndex: number;
  totalDeployed: number;
  totalEstimated: number;
  treatyHealth: { active: number; degraded: number; collapsed: number };
  doctrineSummary: Record<DoctrinePillar, number>;
} {
  return {
    postures: rankByEscalationRisk(MOCK_POSTURES),
    recentEvents: [...MOCK_EVENTS].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    treaties: MOCK_TREATIES,
    globalEscalationIndex: computeGlobalEscalationIndex(MOCK_POSTURES),
    totalDeployed: getTotalDeployedWarheads(MOCK_POSTURES),
    totalEstimated: getTotalEstimatedWarheads(MOCK_POSTURES),
    treatyHealth: getTreatyHealth(MOCK_TREATIES),
    doctrineSummary: getDoctrineSummary(MOCK_POSTURES),
  };
}
