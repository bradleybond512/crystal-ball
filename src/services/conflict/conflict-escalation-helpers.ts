/**
 * Pure helpers for ConflictEscalationPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type EscalationPhase =
  | 'stable'
  | 'tension'
  | 'crisis'
  | 'active_conflict'
  | 'war';

export type MilestoneType =
  | 'ceasefire'
  | 'mobilization'
  | 'territorial_gain'
  | 'atrocity'
  | 'diplomatic_breakdown'
  | 'third_party_entry';

export type ThreatDomain = 'ground' | 'air' | 'naval' | 'cyber' | 'info_ops' | 'nuclear';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConflictActor {
  name: string;
  country: string;
  capability: number; // 0–100
  motivation: number; // 0–100
  externalSupport: string[];
}

export interface EscalationMilestone {
  id: string;
  type: MilestoneType;
  timestamp: number; // ms epoch
  description: string;
  escalationDelta: number; // +/- change in escalation score
  confidence: ConfidenceLevel;
}

export interface ThreatVector {
  domain: ThreatDomain;
  severity: number; // 0–100
  trend: 'increasing' | 'stable' | 'decreasing';
  indicators: string[];
}

export interface ConflictZone {
  id: string;
  name: string;
  region: string;
  phase: EscalationPhase;
  escalationScore: number; // 0–100
  actors: ConflictActor[];
  milestones: EscalationMilestone[];
  threatVectors: ThreatVector[];
  civilianRisk: number; // 0–100
  updatedAt: number;
}

export interface EscalationForecast {
  zoneId: string;
  currentPhase: EscalationPhase;
  nextPhase: EscalationPhase | null;
  probability30d: number; // 0–1
  keyDrivers: string[];
  deescalationPathways: string[];
}

// ── Phase helpers ─────────────────────────────────────────────────────────

export function phaseLabel(phase: EscalationPhase): string {
  const labels: Record<EscalationPhase, string> = {
    stable:          'Stable',
    tension:         'Tension',
    crisis:          'Crisis',
    active_conflict: 'Active Conflict',
    war:             'War',
  };
  return labels[phase];
}

export function phaseColor(phase: EscalationPhase): string {
  const colors: Record<EscalationPhase, string> = {
    stable:          'var(--severity-low,      #4caf50)',
    tension:         'var(--severity-medium,   #facc15)',
    crisis:          'var(--severity-high,     #fb923c)',
    active_conflict: 'var(--severity-critical, #ef4444)',
    war:             'var(--severity-extreme,  #b71c1c)',
  };
  return colors[phase];
}

export function phaseFromScore(score: number): EscalationPhase {
  if (score < 15) return 'stable';
  if (score < 35) return 'tension';
  if (score < 55) return 'crisis';
  if (score < 75) return 'active_conflict';
  return 'war';
}

// ── Milestone helpers ─────────────────────────────────────────────────────

export function milestoneLabel(type: MilestoneType): string {
  const labels: Record<MilestoneType, string> = {
    ceasefire:            'Ceasefire',
    mobilization:         'Mobilization',
    territorial_gain:     'Territorial Gain',
    atrocity:             'Atrocity',
    diplomatic_breakdown: 'Diplomatic Breakdown',
    third_party_entry:    'Third-Party Entry',
  };
  return labels[type];
}

export function milestoneIcon(type: MilestoneType): string {
  const icons: Record<MilestoneType, string> = {
    ceasefire:            'CF',
    mobilization:         'MB',
    territorial_gain:     'TG',
    atrocity:             'AT',
    diplomatic_breakdown: 'DB',
    third_party_entry:    'TP',
  };
  return icons[type];
}

// ── Threat domain helpers ─────────────────────────────────────────────────

export function domainLabel(domain: ThreatDomain): string {
  const labels: Record<ThreatDomain, string> = {
    ground:   'Ground',
    air:      'Air',
    naval:    'Naval',
    cyber:    'Cyber',
    info_ops: 'Info Ops',
    nuclear:  'Nuclear',
  };
  return labels[domain];
}

export function domainIcon(domain: ThreatDomain): string {
  const icons: Record<ThreatDomain, string> = {
    ground:   'GND',
    air:      'AIR',
    naval:    'NAV',
    cyber:    'CYB',
    info_ops: 'INF',
    nuclear:  'NUC',
  };
  return icons[domain];
}

export function trendArrow(trend: ThreatVector['trend']): string {
  if (trend === 'increasing') return 'up';
  if (trend === 'decreasing') return 'down';
  return 'stable';
}

export function trendColor(trend: ThreatVector['trend']): string {
  if (trend === 'increasing') return '#f44336';
  if (trend === 'decreasing') return '#4caf50';
  return '#9e9e9e';
}

// ── Confidence helpers ────────────────────────────────────────────────────

export function confidenceLabel(c: ConfidenceLevel): string {
  const labels: Record<ConfidenceLevel, string> = {
    low:    'Low',
    medium: 'Medium',
    high:   'High',
  };
  return labels[c];
}

export function confidenceColor(c: ConfidenceLevel): string {
  const colors: Record<ConfidenceLevel, string> = {
    low:    '#9e9e9e',
    medium: '#facc15',
    high:   '#4caf50',
  };
  return colors[c];
}

// ── Score / risk helpers ──────────────────────────────────────────────────

export function escalationScoreColor(score: number): string {
  if (score < 15) return 'var(--severity-low,      #4caf50)';
  if (score < 35) return 'var(--severity-medium,   #facc15)';
  if (score < 55) return 'var(--severity-high,     #fb923c)';
  if (score < 75) return 'var(--severity-critical, #ef4444)';
  return 'var(--severity-extreme, #b71c1c)';
}

/** Returns severity rank 0–4 for sorting (higher = more urgent) */
export function phaseRank(phase: EscalationPhase): number {
  const ranks: Record<EscalationPhase, number> = {
    stable:          0,
    tension:         1,
    crisis:          2,
    active_conflict: 3,
    war:             4,
  };
  return ranks[phase];
}

/** Sort zones by descending escalation score */
export function sortZonesByRisk(zones: ConflictZone[]): ConflictZone[] {
  return [...zones].sort((a, b) => b.escalationScore - a.escalationScore);
}

/** Compute compound civilian risk from escalation score + actor count */
export function computeCivilianRisk(
  escalationScore: number,
  actorCount: number,
): number {
  const actorFactor = Math.min(actorCount * 5, 30);
  return Math.min(100, Math.round(escalationScore * 0.7 + actorFactor));
}

/** Count zones at or above a given phase */
export function countZonesAtPhase(
  zones: ConflictZone[],
  phase: EscalationPhase,
): number {
  const minRank = phaseRank(phase);
  return zones.filter(z => phaseRank(z.phase) >= minRank).length;
}

/** Derive the next escalation phase (one step up) */
export function nextPhase(phase: EscalationPhase): EscalationPhase | null {
  const progression: EscalationPhase[] = [
    'stable',
    'tension',
    'crisis',
    'active_conflict',
    'war',
  ];
  const idx = progression.indexOf(phase);
  if (idx === -1 || idx === progression.length - 1) return null;
  return progression[idx + 1] ?? null;
}

/** Aggregate global risk score: weighted average of top-N zones */
export function aggregateGlobalRisk(
  zones: ConflictZone[],
  topN = 5,
): number {
  if (zones.length === 0) return 0;
  const sorted = sortZonesByRisk(zones);
  const slice = sorted.slice(0, topN);
  const total = slice.reduce((s, z) => s + z.escalationScore, 0);
  return Math.round(total / slice.length);
}

/** Most recent milestone from a zone's list (by timestamp) */
export function latestMilestone(
  milestones: EscalationMilestone[],
): EscalationMilestone | null {
  if (milestones.length === 0) return null;
  return milestones.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
}

/** Total escalation delta from a list of milestones (net change) */
export function netEscalationDelta(milestones: EscalationMilestone[]): number {
  return milestones.reduce((s, m) => s + m.escalationDelta, 0);
}

/** Average actor capability in a zone */
export function avgActorCapability(actors: ConflictActor[]): number {
  if (actors.length === 0) return 0;
  return Math.round(actors.reduce((s, a) => s + a.capability, 0) / actors.length);
}

/** Highest-severity threat vector in a zone */
export function dominantThreat(vectors: ThreatVector[]): ThreatVector | null {
  if (vectors.length === 0) return null;
  return vectors.reduce((a, b) => (b.severity > a.severity ? b : a));
}

/** Format timestamp as relative string (e.g. "3h ago", "2d ago") */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const diffMs = now - ts;
  if (diffMs < 0) return 'just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Static fixture data ───────────────────────────────────────────────────

export const ACTIVE_CONFLICT_ZONES: ConflictZone[] = [
  {
    id: 'ukraine',
    name: 'Ukraine-Russia War',
    region: 'Eastern Europe',
    phase: 'war',
    escalationScore: 92,
    actors: [
      { name: 'Ukraine Armed Forces', country: 'UA', capability: 72, motivation: 95, externalSupport: ['US', 'EU', 'NATO'] },
      { name: 'Russian Armed Forces', country: 'RU', capability: 85, motivation: 80, externalSupport: ['BY', 'IR', 'KP'] },
    ],
    milestones: [
      { id: 'm1', type: 'mobilization', timestamp: 1_645_000_000_000, description: 'Full-scale invasion begins', escalationDelta: 40, confidence: 'high' },
      { id: 'm2', type: 'third_party_entry', timestamp: 1_700_000_000_000, description: 'DPRK troops reported', escalationDelta: 8, confidence: 'medium' },
    ],
    threatVectors: [
      { domain: 'ground', severity: 90, trend: 'stable', indicators: ['Frontline artillery', 'Drone warfare'] },
      { domain: 'air', severity: 75, trend: 'increasing', indicators: ['Missile strikes', 'Air defense saturation'] },
      { domain: 'cyber', severity: 60, trend: 'stable', indicators: ['Critical infrastructure attacks'] },
      { domain: 'nuclear', severity: 25, trend: 'stable', indicators: ['Saber-rattling', 'Doctrine references'] },
    ],
    civilianRisk: 85,
    updatedAt: Date.now() - 3_600_000,
  },
  {
    id: 'middle-east',
    name: 'Middle East Multi-Front',
    region: 'Middle East',
    phase: 'active_conflict',
    escalationScore: 74,
    actors: [
      { name: 'IDF', country: 'IL', capability: 88, motivation: 90, externalSupport: ['US'] },
      { name: 'Hamas', country: 'PS', capability: 35, motivation: 88, externalSupport: ['IR'] },
      { name: 'Hezbollah', country: 'LB', capability: 55, motivation: 75, externalSupport: ['IR'] },
    ],
    milestones: [
      { id: 'm1', type: 'atrocity', timestamp: 1_696_000_000_000, description: 'Oct 7 attack', escalationDelta: 35, confidence: 'high' },
      { id: 'm2', type: 'territorial_gain', timestamp: 1_720_000_000_000, description: 'Northern Gaza operations', escalationDelta: 10, confidence: 'high' },
    ],
    threatVectors: [
      { domain: 'ground', severity: 80, trend: 'stable', indicators: ['Urban warfare', 'Tunnel systems'] },
      { domain: 'air', severity: 70, trend: 'decreasing', indicators: ['Airstrikes', 'Air defense'] },
      { domain: 'naval', severity: 40, trend: 'stable', indicators: ['Houthi maritime threats'] },
    ],
    civilianRisk: 90,
    updatedAt: Date.now() - 7_200_000,
  },
  {
    id: 'myanmar',
    name: 'Myanmar Civil War',
    region: 'Southeast Asia',
    phase: 'active_conflict',
    escalationScore: 65,
    actors: [
      { name: 'Myanmar Military (SAC)', country: 'MM', capability: 60, motivation: 70, externalSupport: ['RU', 'CN'] },
      { name: 'Peoples Defence Forces', country: 'MM', capability: 45, motivation: 88, externalSupport: [] },
    ],
    milestones: [
      { id: 'm1', type: 'mobilization', timestamp: 1_612_000_000_000, description: 'Military coup', escalationDelta: 30, confidence: 'high' },
    ],
    threatVectors: [
      { domain: 'ground', severity: 70, trend: 'increasing', indicators: ['Ethnic armed groups', 'PDFs advancing'] },
      { domain: 'air', severity: 50, trend: 'stable', indicators: ['Junta airstrikes on civilians'] },
    ],
    civilianRisk: 72,
    updatedAt: Date.now() - 14_400_000,
  },
  {
    id: 'sudan',
    name: 'Sudan Civil War',
    region: 'Sub-Saharan Africa',
    phase: 'active_conflict',
    escalationScore: 68,
    actors: [
      { name: 'SAF', country: 'SD', capability: 55, motivation: 75, externalSupport: ['EG'] },
      { name: 'RSF', country: 'SD', capability: 50, motivation: 80, externalSupport: ['AE', 'RU'] },
    ],
    milestones: [
      { id: 'm1', type: 'diplomatic_breakdown', timestamp: 1_681_000_000_000, description: 'Transition talks collapse', escalationDelta: 25, confidence: 'high' },
      { id: 'm2', type: 'atrocity', timestamp: 1_695_000_000_000, description: 'Darfur massacres', escalationDelta: 15, confidence: 'high' },
    ],
    threatVectors: [
      { domain: 'ground', severity: 72, trend: 'increasing', indicators: ['Khartoum urban combat'] },
      { domain: 'info_ops', severity: 40, trend: 'increasing', indicators: ['Disinformation campaigns'] },
    ],
    civilianRisk: 80,
    updatedAt: Date.now() - 21_600_000,
  },
  {
    id: 'taiwan-strait',
    name: 'Taiwan Strait Tensions',
    region: 'East Asia',
    phase: 'crisis',
    escalationScore: 45,
    actors: [
      { name: 'PLA', country: 'CN', capability: 90, motivation: 65, externalSupport: [] },
      { name: 'ROC Armed Forces', country: 'TW', capability: 65, motivation: 85, externalSupport: ['US'] },
    ],
    milestones: [
      { id: 'm1', type: 'mobilization', timestamp: 1_660_000_000_000, description: 'PLA encirclement exercises', escalationDelta: 12, confidence: 'high' },
    ],
    threatVectors: [
      { domain: 'naval', severity: 55, trend: 'stable', indicators: ['PLAN deployments', 'Median line crossings'] },
      { domain: 'air', severity: 50, trend: 'stable', indicators: ['ADIZ incursions'] },
      { domain: 'cyber', severity: 65, trend: 'increasing', indicators: ['Pre-positioning', 'Infrastructure probes'] },
      { domain: 'info_ops', severity: 60, trend: 'increasing', indicators: ['Influence operations'] },
    ],
    civilianRisk: 35,
    updatedAt: Date.now() - 3_600_000,
  },
  {
    id: 'sahel',
    name: 'Sahel Instability',
    region: 'West Africa',
    phase: 'crisis',
    escalationScore: 52,
    actors: [
      { name: 'JNIM / AQ-linked', country: 'ML', capability: 40, motivation: 85, externalSupport: [] },
      { name: 'Wagner/Africa Corps', country: 'RU', capability: 50, motivation: 60, externalSupport: ['RU'] },
    ],
    milestones: [
      { id: 'm1', type: 'third_party_entry', timestamp: 1_680_000_000_000, description: 'Wagner deployment expands', escalationDelta: 10, confidence: 'medium' },
    ],
    threatVectors: [
      { domain: 'ground', severity: 58, trend: 'increasing', indicators: ['Jihadist expansion', 'Coup belt'] },
      { domain: 'info_ops', severity: 45, trend: 'increasing', indicators: ['Anti-Western disinformation'] },
    ],
    civilianRisk: 65,
    updatedAt: Date.now() - 28_800_000,
  },
];

export const ESCALATION_FORECASTS: EscalationForecast[] = [
  {
    zoneId: 'ukraine',
    currentPhase: 'war',
    nextPhase: null,
    probability30d: 0.05,
    keyDrivers: ['Continued attrition', 'Western aid levels', 'Russian mobilization capacity'],
    deescalationPathways: ['Negotiated ceasefire', 'Territorial freeze', 'Sanctions relief'],
  },
  {
    zoneId: 'middle-east',
    currentPhase: 'active_conflict',
    nextPhase: 'war',
    probability30d: 0.3,
    keyDrivers: ['Iranian proxies', 'Hostage negotiations', 'Regional spillover risk'],
    deescalationPathways: ['Hostage deal', 'Gaza ceasefire', 'US-Iran diplomacy'],
  },
  {
    zoneId: 'taiwan-strait',
    currentPhase: 'crisis',
    nextPhase: 'active_conflict',
    probability30d: 0.08,
    keyDrivers: ['Election outcomes', 'Arms sales', 'PLA readiness assessments'],
    deescalationPathways: ['Back-channel talks', 'Military hotlines', 'Economic interdependence'],
  },
];
