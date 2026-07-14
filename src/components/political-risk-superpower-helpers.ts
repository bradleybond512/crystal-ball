/**
 * Pure helper functions and static data for PoliticalRiskSuperpowerPanel.
 *
 * Extracted into a side-effect-free module so unit tests can import them
 * without pulling in the DOM or live services.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type PoliticalSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CoupEventType =
  | 'coup'
  | 'uprising'
  | 'contested_election'
  | 'power_vacuum';

export type GovernmentResponse =
  | 'peaceful'
  | 'dispersal'
  | 'crackdown'
  | 'lethal_force';

export type DiplomaticCrisisType =
  | 'embassy_closure'
  | 'expulsion'
  | 'travel_ban'
  | 'alliance_breakdown'
  | 'sanctions';

export interface CoupWatchEvent {
  country: string;
  countryCode: string;
  eventType: CoupEventType;
  severity: PoliticalSeverity;
  /** Unix ms when the event was reported. */
  timestamp: number;
  detail: string;
}

export interface ElectionRisk {
  country: string;
  electionType: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  daysUntil: number;
  /** 0–100 composite risk score. */
  riskScore: number;
  riskFactors: string[];
}

export interface ProtestEvent {
  country: string;
  movement: string;
  participantsEstimate: string;
  governmentResponse: GovernmentResponse;
  severity: PoliticalSeverity;
}

export interface DiplomaticCrisis {
  /** E.g. "US — China". */
  parties: string;
  crisisType: DiplomaticCrisisType;
  severity: PoliticalSeverity;
  trigger: string;
}

export interface GovernanceRegion {
  region: string;
  /** 0 = stable, 1 = watch, 2 = elevated, 3 = high, 4 = critical. */
  score: number;
}

// ── Static data (module-load timestamps for time-ago display) ─────────────

const _NOW = Date.now();
const _HOUR = 60 * 60_000;
const _DAY = 24 * _HOUR;

export const COUP_WATCH: CoupWatchEvent[] = [
  {
    country: 'Myanmar',
    countryCode: 'MM',
    eventType: 'coup',
    severity: 'critical',
    timestamp: _NOW - 180 * _DAY,
    detail: 'Military junta in power since Feb 2021; armed resistance ongoing',
  },
  {
    country: 'Sudan',
    countryCode: 'SD',
    eventType: 'power_vacuum',
    severity: 'critical',
    timestamp: _NOW - 15 * _DAY,
    detail: 'SAF–RSF war; civilian authority dissolved; humanitarian crisis',
  },
  {
    country: 'Venezuela',
    countryCode: 'VE',
    eventType: 'contested_election',
    severity: 'high',
    timestamp: _NOW - 8 * _DAY,
    detail: 'Electoral results disputed; opposition claims vote manipulation',
  },
  {
    country: 'Georgia',
    countryCode: 'GE',
    eventType: 'contested_election',
    severity: 'high',
    timestamp: _NOW - 3 * _DAY,
    detail: 'Pro-EU protests following disputed parliamentary results',
  },
  {
    country: 'Bolivia',
    countryCode: 'BO',
    eventType: 'uprising',
    severity: 'medium',
    timestamp: _NOW - 6 * _HOUR,
    detail: 'Attempted military uprising suppressed; political fractures persist',
  },
];

export const ELECTION_RISKS: ElectionRisk[] = [
  {
    country: 'Venezuela',
    electionType: 'Presidential',
    date: '2025-07-28',
    daysUntil: 64,
    riskScore: 88,
    riskFactors: ['incumbent manipulation', 'opposition exclusion', 'international isolation'],
  },
  {
    country: 'Nigeria',
    electionType: 'Gubernatorial',
    date: '2025-08-21',
    daysUntil: 88,
    riskScore: 72,
    riskFactors: ['ethnic violence risk', 'INEC credibility concerns', 'voter suppression'],
  },
  {
    country: 'Bangladesh',
    electionType: 'General',
    date: '2025-07-01',
    daysUntil: 37,
    riskScore: 65,
    riskFactors: ['transitional government instability', 'Islamist party surge', 'civil society pressure'],
  },
  {
    country: 'Colombia',
    electionType: 'Presidential',
    date: '2026-05-31',
    daysUntil: 370,
    riskScore: 58,
    riskFactors: ['FARC splinter activity', 'ELN ceasefire uncertainty', 'polarized electorate'],
  },
  {
    country: 'Philippines',
    electionType: 'Mid-term',
    date: '2025-05-12',
    daysUntil: 18,
    riskScore: 54,
    riskFactors: ['Marcos–Duterte family feud', 'gun violence history', 'disinformation campaigns'],
  },
];

export const PROTEST_EVENTS: ProtestEvent[] = [
  {
    country: 'Iran',
    movement: 'Women Life Freedom',
    participantsEstimate: '500K+',
    governmentResponse: 'lethal_force',
    severity: 'critical',
  },
  {
    country: 'Haiti',
    movement: 'Anti-gang / governance collapse',
    participantsEstimate: '100K+',
    governmentResponse: 'lethal_force',
    severity: 'critical',
  },
  {
    country: 'Kenya',
    movement: 'Gen-Z tax protests',
    participantsEstimate: '200K+',
    governmentResponse: 'crackdown',
    severity: 'high',
  },
  {
    country: 'Serbia',
    movement: 'Anti-government / university strike',
    participantsEstimate: '300K+',
    governmentResponse: 'dispersal',
    severity: 'high',
  },
  {
    country: 'France',
    movement: 'Pension / cost-of-living',
    participantsEstimate: '1.5M+',
    governmentResponse: 'peaceful',
    severity: 'medium',
  },
];

export const DIPLOMATIC_CRISES: DiplomaticCrisis[] = [
  {
    parties: 'Russia — NATO states',
    crisisType: 'expulsion',
    severity: 'critical',
    trigger: 'Espionage expulsions + Ukraine military aid',
  },
  {
    parties: 'US — China (Taiwan Strait)',
    crisisType: 'alliance_breakdown',
    severity: 'high',
    trigger: 'Arms sales to Taiwan + FONOPS escalation',
  },
  {
    parties: 'EU — Iran',
    crisisType: 'sanctions',
    severity: 'high',
    trigger: 'Drone supply to Russia + nuclear enrichment',
  },
  {
    parties: 'UK — Belarus',
    crisisType: 'travel_ban',
    severity: 'medium',
    trigger: 'Lukashenko migration instrumentalisation',
  },
  {
    parties: 'Argentina — UK (Falklands)',
    crisisType: 'embassy_closure',
    severity: 'low',
    trigger: 'Milei government diplomatic reset',
  },
];

export const GOVERNANCE_INDEX: GovernanceRegion[] = [
  { region: 'Eastern Europe',    score: 3 },
  { region: 'Middle East',       score: 3 },
  { region: 'Sub-Saharan Africa', score: 3 },
  { region: 'Latin America',     score: 2 },
  { region: 'Central Asia',      score: 2 },
  { region: 'Southeast Asia',    score: 2 },
];

// ── Helper functions ──────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<PoliticalSeverity, string> = {
  low:      '#4caf50',
  medium:   '#ff9800',
  high:     '#ff453a',
  critical: '#b71c1c',
};

export function politicalSeverityColor(sev: PoliticalSeverity): string {
  return SEVERITY_COLOR[sev];
}

const EVENT_TYPE_LABEL: Record<CoupEventType, string> = {
  coup:               '🔴 Coup',
  uprising:           '⚠ Uprising',
  contested_election: '🗳 Contested Election',
  power_vacuum:       '⚡ Power Vacuum',
};

export function eventTypeLabel(type: CoupEventType): string {
  return EVENT_TYPE_LABEL[type] ?? type;
}

export function riskScoreTier(score: number): PoliticalSeverity {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function riskScoreColor(score: number): string {
  return politicalSeverityColor(riskScoreTier(score));
}

const RESPONSE_LABEL: Record<GovernmentResponse, string> = {
  peaceful:     'Peaceful',
  dispersal:    'Dispersal',
  crackdown:    'Crackdown',
  lethal_force: 'Lethal Force',
};

export function responseLabel(response: GovernmentResponse): string {
  return RESPONSE_LABEL[response] ?? response;
}

const RESPONSE_COLOR: Record<GovernmentResponse, string> = {
  peaceful:     '#4caf50',
  dispersal:    '#ff9800',
  crackdown:    '#ff453a',
  lethal_force: '#b71c1c',
};

export function responseColor(response: GovernmentResponse): string {
  return RESPONSE_COLOR[response];
}

const CRISIS_TYPE_LABEL: Record<DiplomaticCrisisType, string> = {
  embassy_closure:    'Embassy Closure',
  expulsion:          'Diplomatic Expulsion',
  travel_ban:         'Travel Ban',
  alliance_breakdown: 'Alliance Breakdown',
  sanctions:          'Sanctions Regime',
};

export function crisisTypeLabel(type: DiplomaticCrisisType): string {
  return CRISIS_TYPE_LABEL[type] ?? type;
}

// Maps governance score 0-4 to CSS variable with inline fallback.
const GOVERNANCE_COLOR = [
  'var(--severity-ok, #4caf50)',       // 0 — stable
  'var(--severity-info, #9e9e9e)',     // 1 — watch
  'var(--severity-medium, #ff9800)',   // 2 — elevated
  'var(--severity-high, #ff453a)',     // 3 — high
  'var(--severity-critical, #b71c1c)', // 4 — critical
] as const;

export function governanceColor(score: number): string {
  const clamped = Math.max(0, Math.min(4, Math.round(score)));
  return GOVERNANCE_COLOR[clamped]!;
}

const GOVERNANCE_TIER_LABEL = ['Stable', 'Watch', 'Elevated', 'High', 'Critical'] as const;

export function governanceTier(score: number): string {
  const clamped = Math.max(0, Math.min(4, Math.round(score)));
  return GOVERNANCE_TIER_LABEL[clamped]!;
}

/**
 * Returns a human-readable relative time string: "3h ago", "2d ago".
 * `now` defaults to Date.now() and is injectable for tests.
 */
export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const diffMs = now - timestamp;
  if (diffMs < 0) return 'just now';
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

/**
 * Count of instability events at high or critical severity.
 * Used for the panel badge count.
 */
export function instabilityCount(events: CoupWatchEvent[]): number {
  return events.filter((e) => e.severity === 'high' || e.severity === 'critical').length;
}
