// territorial-disputes-helpers.ts
// Pure logic for TerritorialDisputesPanel — no DOM, no Panel imports

export type DisputePhase = 'Active War' | 'Frozen Conflict' | 'Escalating' | 'Standoff' | 'Negotiation' | 'Latent';
export type DiplomaticTrend = 'escalating' | 'stable' | 'de-escalating';

export interface TerritorialDispute {
  id: string;
  name: string;
  parties: string[];
  region: string;
  phase: DisputePhase;
  trend: DiplomaticTrend;
  severityScore: number;
  nuclearRisk: boolean;
  activeViolence: boolean;
  disputedArea: string;
  description: string;
  keyDevelopment: string;
}

export interface DisputeRenderData {
  disputes: TerritorialDispute[];
  globalTensionIndex: number;
  activeWarCount: number;
  frozenConflictCount: number;
  escalatingCount: number;
  nuclearRiskCount: number;
  mostSevere: TerritorialDispute[];
}

const DISPUTES: TerritorialDispute[] = [
  {
    id: 'D001',
    name: 'Ukraine-Russia War',
    parties: ['Ukraine', 'Russia'],
    region: 'Eastern Europe',
    phase: 'Active War',
    trend: 'stable',
    severityScore: 10,
    nuclearRisk: true,
    activeViolence: true,
    disputedArea: 'Donbas, Crimea, Zaporizhzhia, Kherson, Kharkiv',
    description: 'Full-scale Russian invasion of Ukraine; largest European land war since 1945.',
    keyDevelopment: 'Front lines largely stabilized; ongoing drone/missile exchanges; diplomatic deadlock.',
  },
  {
    id: 'D002',
    name: 'Taiwan Strait',
    parties: ['China (PRC)', 'Taiwan (ROC)', 'USA'],
    region: 'East Asia',
    phase: 'Standoff',
    trend: 'escalating',
    severityScore: 9,
    nuclearRisk: true,
    activeViolence: false,
    disputedArea: 'Taiwan, Taiwan Strait, Kinmen, Matsu',
    description: 'PRC claims sovereignty over Taiwan; US maintains strategic ambiguity and arms sales.',
    keyDevelopment: 'PLA air and naval incursions into Taiwan ADIZ at record frequency.',
  },
  {
    id: 'D003',
    name: 'South China Sea',
    parties: ['China', 'Philippines', 'Vietnam', 'Malaysia', 'Brunei', 'Taiwan'],
    region: 'Southeast Asia',
    phase: 'Escalating',
    trend: 'escalating',
    severityScore: 7,
    nuclearRisk: false,
    activeViolence: true,
    disputedArea: 'Spratly Islands, Paracel Islands, Scarborough Shoal',
    description: 'China claims ~90% of SCS via nine-dash line; Philippines resisting at Second Thomas Shoal.',
    keyDevelopment: 'China coast guard water-cannon attacks on Philippine resupply missions.',
  },
  {
    id: 'D004',
    name: 'Kashmir',
    parties: ['India', 'Pakistan', 'China'],
    region: 'South Asia',
    phase: 'Standoff',
    trend: 'stable',
    severityScore: 8,
    nuclearRisk: true,
    activeViolence: true,
    disputedArea: 'Jammu & Kashmir, Aksai Chin, Siachen Glacier',
    description: 'Disputed since 1947 partition; India revoked Article 370 in 2019.',
    keyDevelopment: 'Pahalgam attack 2025 — India-Pakistan tensions at decade high; LoC exchanges.',
  },
  {
    id: 'D005',
    name: 'Senkaku / Diaoyu Islands',
    parties: ['Japan', 'China', 'Taiwan'],
    region: 'East Asia',
    phase: 'Escalating',
    trend: 'escalating',
    severityScore: 6,
    nuclearRisk: false,
    activeViolence: false,
    disputedArea: 'Senkaku Islands (Diaoyu in Chinese)',
    description: 'Uninhabited islands administered by Japan; claimed by China and Taiwan.',
    keyDevelopment: 'Chinese coast guard vessels in contiguous zone at record frequency in 2025.',
  },
  {
    id: 'D006',
    name: 'Arctic Sovereignty',
    parties: ['Russia', 'USA', 'Canada', 'Norway', 'Denmark'],
    region: 'Arctic',
    phase: 'Latent',
    trend: 'escalating',
    severityScore: 4,
    nuclearRisk: false,
    activeViolence: false,
    disputedArea: 'Northwest Passage, Lomonosov Ridge, Arctic continental shelf',
    description: 'Competing claims over Arctic seabed and shipping routes as ice recedes.',
    keyDevelopment: 'Russia expanded Northern Sea Route militarization; Canada increasing Arctic patrols.',
  },
  {
    id: 'D007',
    name: 'Nagorno-Karabakh',
    parties: ['Azerbaijan', 'Armenia'],
    region: 'South Caucasus',
    phase: 'Frozen Conflict',
    trend: 'de-escalating',
    severityScore: 5,
    nuclearRisk: false,
    activeViolence: false,
    disputedArea: 'Former Nagorno-Karabakh Autonomous Oblast',
    description: 'Azerbaijan seized full control in September 2023; ethnic Armenian exodus complete.',
    keyDevelopment: 'Armenia-Azerbaijan peace treaty negotiations ongoing; border demarcation active.',
  },
  {
    id: 'D008',
    name: 'Sudan-Ethiopia Border',
    parties: ['Sudan', 'Ethiopia'],
    region: 'East Africa',
    phase: 'Active War',
    trend: 'escalating',
    severityScore: 6,
    nuclearRisk: false,
    activeViolence: true,
    disputedArea: 'Al-Fashaga triangle; Blue Nile dam dispute',
    description: 'Disputed fertile borderland; compounded by GERD dam water-rights conflict.',
    keyDevelopment: 'Sudan civil war creates power vacuum; Ethiopian militia control contested zones.',
  },
];

export function computeGlobalTensionIndex(disputes: TerritorialDispute[]): number {
  if (!disputes.length) return 0;
  const weights: Record<DisputePhase, number> = {
    'Active War': 1.0,
    'Escalating': 0.7,
    'Standoff': 0.5,
    'Frozen Conflict': 0.3,
    'Negotiation': 0.15,
    'Latent': 0.1,
  };
  const trendMod: Record<DiplomaticTrend, number> = {
    escalating: 1.1,
    stable: 1.0,
    'de-escalating': 0.9,
  };
  const sum = disputes.reduce((acc, d) => {
    const w = weights[d.phase] ?? 0.3;
    const tm = trendMod[d.trend] ?? 1.0;
    return acc + d.severityScore * w * tm;
  }, 0);
  const max = disputes.length * 10;
  return Math.min(100, Math.round((sum / max) * 100));
}

export function getActiveWars(disputes: TerritorialDispute[]): TerritorialDispute[] {
  return disputes.filter(d => d.phase === 'Active War');
}

export function getFrozenConflicts(disputes: TerritorialDispute[]): TerritorialDispute[] {
  return disputes.filter(d => d.phase === 'Frozen Conflict');
}

export function getEscalatingDisputes(disputes: TerritorialDispute[]): TerritorialDispute[] {
  return disputes.filter(d => d.phase === 'Escalating' || d.trend === 'escalating');
}

export function getNuclearRiskDisputes(disputes: TerritorialDispute[]): TerritorialDispute[] {
  return disputes.filter(d => d.nuclearRisk);
}

export function getMostSevere(disputes: TerritorialDispute[], n = 3): TerritorialDispute[] {
  return [...disputes].sort((a, b) => b.severityScore - a.severityScore).slice(0, n);
}

export function phaseBadgeClass(phase: DisputePhase): string {
  const map: Record<DisputePhase, string> = {
    'Active War': 'phase-war',
    'Escalating': 'phase-escalating',
    'Standoff': 'phase-standoff',
    'Frozen Conflict': 'phase-frozen',
    'Negotiation': 'phase-negotiation',
    'Latent': 'phase-latent',
  };
  return map[phase] ?? 'phase-latent';
}

export function trendArrow(trend: DiplomaticTrend): string {
  const map: Record<DiplomaticTrend, string> = {
    escalating: '\u2191',
    stable: '\u2192',
    'de-escalating': '\u2193',
  };
  return map[trend] ?? '\u2192';
}

export function severityClass(score: number): string {
  if (score >= 9) return 'sev-critical';
  if (score >= 7) return 'sev-high';
  if (score >= 5) return 'sev-medium';
  return 'sev-low';
}

export function buildRenderData(): DisputeRenderData {
  return {
    disputes: DISPUTES,
    globalTensionIndex: computeGlobalTensionIndex(DISPUTES),
    activeWarCount: getActiveWars(DISPUTES).length,
    frozenConflictCount: getFrozenConflicts(DISPUTES).length,
    escalatingCount: DISPUTES.filter(d => d.trend === 'escalating').length,
    nuclearRiskCount: getNuclearRiskDisputes(DISPUTES).length,
    mostSevere: getMostSevere(DISPUTES, 3),
  };
}
