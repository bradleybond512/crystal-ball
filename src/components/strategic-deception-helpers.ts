// strategic-deception-helpers.ts — pure deterministic helpers

export type DeceptionType = 'camouflage' | 'decoy' | 'diversion' | 'feint' | 'maskirovka' | 'false-flag' | 'cover-story';
export type DeceptionActor = 'Russia' | 'China' | 'Iran' | 'North Korea' | 'USA' | 'Israel' | 'non-state';
export type OperationalDomain = 'military' | 'diplomatic' | 'economic' | 'cyber' | 'information' | 'hybrid';

export interface DeceptionOperation {
  id: string;
  name: string;
  actor: DeceptionActor;
  type: DeceptionType;
  domain: OperationalDomain;
  targetNations: string[];
  startDate: string;
  active: boolean;
  effectivenessScore: number; // 0-100
  detectionDifficulty: number; // 0-100
  strategicObjective: string;
  successIndicators: string[];
}

export interface DeceptionIndicator {
  id: string;
  operationId: string;
  type: 'anomaly' | 'pattern-break' | 'implausible-action' | 'known-playbook';
  description: string;
  confidence: number; // 0-100
  detectedDate: string;
}

const MOCK_OPERATIONS: DeceptionOperation[] = [
  { id: 'maskirovka-ukraine', name: 'Russia Ukraine Pre-Invasion Maskirovka', actor: 'Russia', type: 'maskirovka', domain: 'military', targetNations: ['Ukraine', 'NATO', 'USA'], startDate: '2021-10-01', active: false, effectivenessScore: 72, detectionDifficulty: 65, strategicObjective: 'Conceal invasion timing and axis of advance', successIndicators: ['Achieved surprise on Kyiv axis', 'Delayed NATO response by 72h'] },
  { id: 'cn-taiwan-feint', name: 'PLA Taiwan Strait Feints', actor: 'China', type: 'feint', domain: 'military', targetNations: ['Taiwan', 'USA', 'Japan'], startDate: '2022-08-01', active: true, effectivenessScore: 65, detectionDifficulty: 70, strategicObjective: 'Test allied response and normalize military presence', successIndicators: ['Established new status quo crossing median line', 'Gauged US carrier response time'] },
  { id: 'ir-nuclear-cover', name: 'Iran Nuclear Cover Story', actor: 'Iran', type: 'cover-story', domain: 'diplomatic', targetNations: ['IAEA', 'EU3', 'USA'], startDate: '2003-01-01', active: true, effectivenessScore: 60, detectionDifficulty: 75, strategicObjective: 'Maintain ambiguity on weapons intent while advancing program', successIndicators: ['Successive JCPOA negotiations delayed breakout', 'Continued enrichment to 60%'] },
  { id: 'dprk-decoy', name: 'DPRK Decoy Launch Ops', actor: 'North Korea', type: 'decoy', domain: 'military', targetNations: ['South Korea', 'Japan', 'USA'], startDate: '2022-03-01', active: true, effectivenessScore: 55, detectionDifficulty: 58, strategicObjective: 'Mask actual ICBM test sequence with sub-payload decoys', successIndicators: ['Uncertainty about actual ICBM payload mass', 'Degraded BMD assessment confidence'] },
  { id: 'ru-false-flag-syria', name: 'Russian False Flag Chemical Ops Syria', actor: 'Russia', type: 'false-flag', domain: 'information', targetNations: ['UN', 'UK', 'EU', 'USA'], startDate: '2018-04-01', active: false, effectivenessScore: 45, detectionDifficulty: 60, strategicObjective: 'Deflect blame for Douma chemical attack onto rebels', successIndicators: ['Temporary uncertainty in Security Council', 'Russia/China UNSC veto blocked resolution'] },
  { id: 'cn-economic-diversion', name: 'China Belt-Road Strategic Diversion', actor: 'China', type: 'diversion', domain: 'economic', targetNations: ['USA', 'EU', 'Africa', 'Asia'], startDate: '2013-01-01', active: true, effectivenessScore: 78, detectionDifficulty: 80, strategicObjective: 'Obscure strategic port acquisition within development framing', successIndicators: ['Hambantota port 99yr lease', 'Djibouti PLA base access'] },
  { id: 'il-camouflage-strike', name: 'IDF Shadow Campaign (Syria)', actor: 'Israel', type: 'camouflage', domain: 'military', targetNations: ['Iran', 'Syria', 'Hezbollah'], startDate: '2017-01-01', active: true, effectivenessScore: 88, detectionDifficulty: 85, strategicObjective: 'Degrade Iranian force buildup while maintaining deniability', successIndicators: ['500+ airstrikes with minimal escalation', 'Iran unable to establish SAM umbrella'] },
  { id: 'ru-hybrid-baltics', name: 'Russia Baltic Hybrid Pressure', actor: 'Russia', type: 'maskirovka', domain: 'hybrid', targetNations: ['Estonia', 'Latvia', 'Lithuania', 'Finland'], startDate: '2023-01-01', active: true, effectivenessScore: 50, detectionDifficulty: 62, strategicObjective: 'Test NATO Article 5 threshold via below-threshold actions', successIndicators: ['GPS spoofing in Finnish airspace', 'Migrant weaponization pressure'] },
];

const MOCK_INDICATORS: DeceptionIndicator[] = [
  { id: 'ind1', operationId: 'cn-taiwan-feint', type: 'pattern-break', description: 'PLA exercise patterns no longer follow historical NOTAM sequencing', confidence: 78, detectedDate: '2024-05-15' },
  { id: 'ind2', operationId: 'ir-nuclear-cover', type: 'anomaly', description: 'Unexplained enrichment centrifuge cascade reconfigurations at Fordow', confidence: 65, detectedDate: '2024-04-02' },
  { id: 'ind3', operationId: 'dprk-decoy', type: 'known-playbook', description: 'DPRK pre-launch logistics signature matches Hwasong-17 not Hwasong-15', confidence: 71, detectedDate: '2024-03-20' },
  { id: 'ind4', operationId: 'ru-hybrid-baltics', type: 'implausible-action', description: 'Coordinated GPS degradation in civilian corridors inconsistent with claimed exercises', confidence: 82, detectedDate: '2024-06-01' },
  { id: 'ind5', operationId: 'cn-economic-diversion', type: 'pattern-break', description: 'Port development contracts include unusual sovereignty clauses buried in annex', confidence: 88, detectedDate: '2023-11-10' },
];

export function scoreDeceptionThreat(op: DeceptionOperation): number {
  const activeMult = op.active ? 1 : 0.5;
  return Math.min(100, Math.round((op.effectivenessScore * 0.45 + op.detectionDifficulty * 0.35 + (op.targetNations.length * 5)) * activeMult));
}

export function filterByActor(ops: DeceptionOperation[], actor: DeceptionActor): DeceptionOperation[] {
  return ops.filter(o => o.actor === actor);
}

export function filterByDomain(ops: DeceptionOperation[], domain: OperationalDomain): DeceptionOperation[] {
  return ops.filter(o => o.domain === domain);
}

export function filterActive(ops: DeceptionOperation[]): DeceptionOperation[] {
  return ops.filter(o => o.active);
}

export function rankByThreat(ops: DeceptionOperation[]): DeceptionOperation[] {
  return [...ops].sort((a, b) => scoreDeceptionThreat(b) - scoreDeceptionThreat(a));
}

export function getTypeDistribution(ops: DeceptionOperation[]): Record<DeceptionType, number> {
  const dist: Record<DeceptionType, number> = { camouflage: 0, decoy: 0, diversion: 0, feint: 0, maskirovka: 0, 'false-flag': 0, 'cover-story': 0 };
  for (const o of ops) dist[o.type]++;
  return dist;
}

export function getIndicatorsForOp(indicators: DeceptionIndicator[], opId: string): DeceptionIndicator[] {
  return indicators.filter(i => i.operationId === opId);
}

export function getHighConfidenceIndicators(indicators: DeceptionIndicator[], minConfidence = 75): DeceptionIndicator[] {
  return indicators.filter(i => i.confidence >= minConfidence).sort((a, b) => b.confidence - a.confidence);
}

export function getMostActiveActor(ops: DeceptionOperation[]): DeceptionActor {
  const counts: Record<string, number> = {};
  for (const o of ops) counts[o.actor] = (counts[o.actor] ?? 0) + 1;
  return (Object.entries(counts).sort(([,a],[,b]) => b - a)[0]?.[0] ?? 'Russia') as DeceptionActor;
}

export function buildRenderData(): {
  operations: DeceptionOperation[];
  recentIndicators: DeceptionIndicator[];
  activeCount: number;
  mostActiveActor: DeceptionActor;
  typeDistribution: Record<DeceptionType, number>;
} {
  return {
    operations: rankByThreat(MOCK_OPERATIONS),
    recentIndicators: getHighConfidenceIndicators(MOCK_INDICATORS),
    activeCount: filterActive(MOCK_OPERATIONS).length,
    mostActiveActor: getMostActiveActor(MOCK_OPERATIONS),
    typeDistribution: getTypeDistribution(MOCK_OPERATIONS),
  };
}
