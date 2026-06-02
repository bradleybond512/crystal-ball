// election-interference-helpers.ts — pure deterministic helpers

export type InterferenceTactic = 'disinformation' | 'hack-and-leak' | 'social-media-manipulation' | 'voter-suppression' | 'financial-influence' | 'election-infrastructure-attack';
export type ThreatActor = 'Russia' | 'China' | 'Iran' | 'North Korea' | 'domestic';
export type ElectionPhase = 'pre-campaign' | 'campaign' | 'election-day' | 'post-election';

export interface InterferenceOperation {
  id: string;
  actor: ThreatActor;
  targetCountry: string;
  tactics: InterferenceTactic[];
  sophisticationScore: number; // 0-100
  detectionDate: string;
  electionPhase: ElectionPhase;
  confirmed: boolean;
}

export interface ElectionRisk {
  country: string;
  electionDate: string;
  riskScore: number; // 0-100
  primaryThreats: ThreatActor[];
  activeTactics: InterferenceTactic[];
  resilienceScore: number; // 0-100 (higher = more resilient)
}

const MOCK_OPS: InterferenceOperation[] = [
  { id: 'op-ua-2024', actor: 'Russia', targetCountry: 'Ukraine', tactics: ['disinformation', 'hack-and-leak', 'social-media-manipulation'], sophisticationScore: 92, detectionDate: '2026-03-15', electionPhase: 'campaign', confirmed: true },
  { id: 'op-de-2025', actor: 'Russia', targetCountry: 'Germany', tactics: ['disinformation', 'financial-influence'], sophisticationScore: 75, detectionDate: '2026-04-20', electionPhase: 'pre-campaign', confirmed: true },
  { id: 'op-tw-2025', actor: 'China', targetCountry: 'Taiwan', tactics: ['disinformation', 'social-media-manipulation', 'financial-influence'], sophisticationScore: 88, detectionDate: '2026-05-01', electionPhase: 'campaign', confirmed: true },
  { id: 'op-us-midterm', actor: 'Iran', targetCountry: 'USA', tactics: ['social-media-manipulation', 'hack-and-leak'], sophisticationScore: 65, detectionDate: '2026-04-10', electionPhase: 'campaign', confirmed: true },
  { id: 'op-fr-2027', actor: 'Russia', targetCountry: 'France', tactics: ['disinformation', 'social-media-manipulation'], sophisticationScore: 70, detectionDate: '2026-05-15', electionPhase: 'pre-campaign', confirmed: false },
  { id: 'op-sk-2026', actor: 'North Korea', targetCountry: 'South Korea', tactics: ['hack-and-leak', 'election-infrastructure-attack'], sophisticationScore: 78, detectionDate: '2026-05-10', electionPhase: 'election-day', confirmed: true },
  { id: 'op-in-2026', actor: 'China', targetCountry: 'India', tactics: ['disinformation', 'social-media-manipulation'], sophisticationScore: 68, detectionDate: '2026-04-30', electionPhase: 'pre-campaign', confirmed: false },
  { id: 'op-br-2026', actor: 'Russia', targetCountry: 'Brazil', tactics: ['social-media-manipulation', 'financial-influence'], sophisticationScore: 60, detectionDate: '2026-03-28', electionPhase: 'pre-campaign', confirmed: true },
];

const MOCK_RISKS: ElectionRisk[] = [
  { country: 'Taiwan', electionDate: '2026-11-15', riskScore: 92, primaryThreats: ['China'], activeTactics: ['disinformation', 'social-media-manipulation', 'financial-influence'], resilienceScore: 65 },
  { country: 'Germany', electionDate: '2026-09-20', riskScore: 72, primaryThreats: ['Russia'], activeTactics: ['disinformation', 'financial-influence'], resilienceScore: 80 },
  { country: 'South Korea', electionDate: '2026-06-01', riskScore: 78, primaryThreats: ['North Korea', 'China'], activeTactics: ['hack-and-leak', 'election-infrastructure-attack'], resilienceScore: 70 },
  { country: 'France', electionDate: '2027-04-01', riskScore: 68, primaryThreats: ['Russia'], activeTactics: ['disinformation'], resilienceScore: 75 },
  { country: 'USA', electionDate: '2026-11-03', riskScore: 75, primaryThreats: ['Russia', 'China', 'Iran'], activeTactics: ['social-media-manipulation', 'hack-and-leak'], resilienceScore: 72 },
  { country: 'India', electionDate: '2027-05-01', riskScore: 65, primaryThreats: ['China'], activeTactics: ['disinformation'], resilienceScore: 60 },
  { country: 'Brazil', electionDate: '2026-10-01', riskScore: 60, primaryThreats: ['Russia'], activeTactics: ['social-media-manipulation'], resilienceScore: 55 },
];

export function scoreInterferenceSophistication(op: InterferenceOperation): number {
  const tacticBonus = op.tactics.length * 5;
  const confirmationBonus = op.confirmed ? 10 : 0;
  return Math.min(100, op.sophisticationScore + tacticBonus * 0.3 + confirmationBonus * 0.2);
}

export function classifyThreatLevel(riskScore: number): 'critical' | 'high' | 'medium' | 'low' {
  if (riskScore >= 85) return 'critical';
  if (riskScore >= 65) return 'high';
  if (riskScore >= 40) return 'medium';
  return 'low';
}

export function filterByActor(ops: InterferenceOperation[], actor: ThreatActor): InterferenceOperation[] {
  return ops.filter(o => o.actor === actor);
}

export function filterByPhase(ops: InterferenceOperation[], phase: ElectionPhase): InterferenceOperation[] {
  return ops.filter(o => o.electionPhase === phase);
}

export function computeTacticFrequency(ops: InterferenceOperation[]): Record<InterferenceTactic, number> {
  const freq: Record<InterferenceTactic, number> = {
    'disinformation': 0, 'hack-and-leak': 0, 'social-media-manipulation': 0,
    'voter-suppression': 0, 'financial-influence': 0, 'election-infrastructure-attack': 0,
  };
  for (const op of ops) for (const t of op.tactics) freq[t]++;
  return freq;
}

export function rankElectionsByRisk(risks: ElectionRisk[]): ElectionRisk[] {
  return [...risks].sort((a, b) => b.riskScore - a.riskScore);
}

export function computeNetRisk(risk: ElectionRisk): number {
  return Math.max(0, Math.round(risk.riskScore - risk.resilienceScore * 0.3));
}

export function getActiveOperationsByCountry(ops: InterferenceOperation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of ops) counts[op.targetCountry] = (counts[op.targetCountry] ?? 0) + 1;
  return counts;
}

export function buildRenderData(): {
  risks: ElectionRisk[];
  recentOps: InterferenceOperation[];
  tacticFrequency: Record<InterferenceTactic, number>;
  mostActiveActor: ThreatActor;
} {
  const actorCounts: Record<ThreatActor, number> = { Russia: 0, China: 0, Iran: 0, 'North Korea': 0, domestic: 0 };
  for (const op of MOCK_OPS) actorCounts[op.actor]++;
  const sorted = Object.entries(actorCounts).sort(([, a], [, b]) => b - a);
  const mostActiveActor = (sorted[0]?.[0] ?? 'Russia') as ThreatActor;
  return {
    risks: rankElectionsByRisk(MOCK_RISKS),
    recentOps: MOCK_OPS.slice(0, 6),
    tacticFrequency: computeTacticFrequency(MOCK_OPS),
    mostActiveActor,
  };
}
