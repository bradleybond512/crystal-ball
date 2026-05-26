/**
 * Pure helpers for ElectionMonitoringPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ElectionType = 'presidential' | 'parliamentary' | 'referendum' | 'regional' | 'primary';
export type Stakes = 'low' | 'medium' | 'high' | 'critical';
export type ResultStatus = 'called' | 'disputed' | 'pending' | 'runoff-required' | 'annulled';
export type DisinfoCampaignType =
  | 'deepfake'
  | 'bot-network'
  | 'hack-and-leak'
  | 'foreign-amplification'
  | 'narrative-flooding';
export type DisinfoIntensity = 'low' | 'medium' | 'high' | 'critical';
export type ObserverVerdict =
  | 'free-and-fair'
  | 'generally-credible'
  | 'concerns-noted'
  | 'significant-irregularities'
  | 'rejected';
export type IntegrityRisk = 0 | 1 | 2 | 3 | 4;

export interface ElectionEvent {
  nation: string;
  date: string;
  daysUntil: number;
  electionType: ElectionType;
  stakes: Stakes;
  description: string;
}

export interface IntegrityIndicator {
  nation: string;
  riskScore: IntegrityRisk;
  concerns: string[];
  observerPresence: boolean;
}

export interface ElectionResult {
  nation: string;
  date: string;
  winner: string;
  marginPct: number;
  turnoutPct: number;
  status: ResultStatus;
  notes: string;
}

export interface TurnoutAnomaly {
  region: string;
  expectedPct: number;
  actualPct: number;
  anomalyScore: number;
  signal: string;
}

export interface DisinfoSignal {
  platform: string;
  campaignType: DisinfoCampaignType;
  targetNation: string;
  intensity: DisinfoIntensity;
  description: string;
}

export interface ObserverReport {
  nation: string;
  organization: string;
  date: string;
  verdict: ObserverVerdict;
  findings: string;
}

// ── Election type helpers ─────────────────────────────────────────────────

export function electionTypeColor(t: ElectionType): string {
  const colors: Record<ElectionType, string> = {
    presidential:  'var(--severity-critical, #ef4444)',
    parliamentary: 'var(--severity-high,     #fb923c)',
    referendum:    'var(--severity-medium,   #facc15)',
    regional:      'var(--severity-low,      #4caf50)',
    primary:       'var(--severity-none,     #9e9e9e)',
  };
  return colors[t];
}

export function electionTypeLabel(t: ElectionType): string {
  const labels: Record<ElectionType, string> = {
    presidential:  'Presidential',
    parliamentary: 'Parliamentary',
    referendum:    'Referendum',
    regional:      'Regional',
    primary:       'Primary',
  };
  return labels[t];
}

// ── Stakes helpers ────────────────────────────────────────────────────────

export function stakesColor(s: Stakes): string {
  const colors: Record<Stakes, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function stakesLabel(s: Stakes): string {
  const labels: Record<Stakes, string> = {
    low:      'Low',
    medium:   'Medium',
    high:     'High',
    critical: 'Critical',
  };
  return labels[s];
}

// ── Integrity risk helpers ────────────────────────────────────────────────

export function integrityRiskColor(r: IntegrityRisk): string {
  const colors: Record<IntegrityRisk, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function integrityRiskLabel(r: IntegrityRisk): string {
  const labels: Record<IntegrityRisk, string> = {
    0: 'Clean',
    1: 'Minor Concerns',
    2: 'Moderate Risk',
    3: 'High Risk',
    4: 'Compromised',
  };
  return labels[r];
}

// ── Result status helpers ─────────────────────────────────────────────────

export function resultStatusColor(s: ResultStatus): string {
  const colors: Record<ResultStatus, string> = {
    called:           'var(--severity-low,      #4caf50)',
    pending:          'var(--severity-none,     #9e9e9e)',
    'runoff-required': 'var(--severity-medium,   #facc15)',
    disputed:         'var(--severity-high,     #fb923c)',
    annulled:         'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function resultStatusLabel(s: ResultStatus): string {
  const labels: Record<ResultStatus, string> = {
    called:           'Called',
    pending:          'Pending',
    'runoff-required': 'Runoff Required',
    disputed:         'Disputed',
    annulled:         'Annulled',
  };
  return labels[s];
}

// ── Turnout anomaly helpers ───────────────────────────────────────────────

export function turnoutAnomalyColor(score: number): string {
  if (score >= 4) return 'var(--severity-critical, #ef4444)';
  if (score >= 3) return 'var(--severity-high,     #fb923c)';
  if (score >= 2) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low, #4caf50)';
}

export function turnoutAnomalyLabel(score: number): string {
  if (score >= 4) return 'Severe';
  if (score >= 3) return 'High';
  if (score >= 2) return 'Moderate';
  return 'Low';
}

// ── Disinformation campaign helpers ──────────────────────────────────────

export function disinfoCampaignTypeColor(t: DisinfoCampaignType): string {
  const colors: Record<DisinfoCampaignType, string> = {
    deepfake:              'var(--severity-critical, #ef4444)',
    'hack-and-leak':       'var(--severity-critical, #ef4444)',
    'bot-network':         'var(--severity-high,     #fb923c)',
    'foreign-amplification': 'var(--severity-high,   #fb923c)',
    'narrative-flooding':  'var(--severity-medium,   #facc15)',
  };
  return colors[t];
}

export function disinfoCampaignTypeLabel(t: DisinfoCampaignType): string {
  const labels: Record<DisinfoCampaignType, string> = {
    deepfake:              'Deepfake',
    'hack-and-leak':       'Hack & Leak',
    'bot-network':         'Bot Network',
    'foreign-amplification': 'Foreign Amplification',
    'narrative-flooding':  'Narrative Flooding',
  };
  return labels[t];
}

export function disinfoIntensityColor(i: DisinfoIntensity): string {
  const colors: Record<DisinfoIntensity, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[i];
}

// ── Observer verdict helpers ──────────────────────────────────────────────

export function observerVerdictColor(v: ObserverVerdict): string {
  const colors: Record<ObserverVerdict, string> = {
    'free-and-fair':            'var(--severity-low,      #4caf50)',
    'generally-credible':       'var(--severity-medium,   #facc15)',
    'concerns-noted':           'var(--severity-high,     #fb923c)',
    'significant-irregularities': 'var(--severity-critical, #ef4444)',
    rejected:                   'var(--severity-critical, #ef4444)',
  };
  return colors[v];
}

export function observerVerdictLabel(v: ObserverVerdict): string {
  const labels: Record<ObserverVerdict, string> = {
    'free-and-fair':            'Free & Fair',
    'generally-credible':       'Generally Credible',
    'concerns-noted':           'Concerns Noted',
    'significant-irregularities': 'Significant Irregularities',
    rejected:                   'Rejected',
  };
  return labels[v];
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countImminentElections(events: ElectionEvent[], withinDays = 30): number {
  return events.filter((e) => e.daysUntil >= 0 && e.daysUntil <= withinDays).length;
}

export function countHighIntegrityRisk(indicators: IntegrityIndicator[]): number {
  return indicators.filter((i) => i.riskScore >= 3).length;
}

export function countDisputedResults(results: ElectionResult[]): number {
  return results.filter((r) => r.status === 'disputed' || r.status === 'annulled').length;
}

export function countHighIntensityDisinfo(signals: DisinfoSignal[]): number {
  return signals.filter((s) => s.intensity === 'high' || s.intensity === 'critical').length;
}

export function countCriticalStakesElections(events: ElectionEvent[]): number {
  return events.filter((e) => e.stakes === 'critical').length;
}

// ── Static data ───────────────────────────────────────────────────────────

export const ELECTION_CALENDAR: ElectionEvent[] = [
  {
    nation:       'Mexico',
    date:         '2026-06-07',
    daysUntil:    12,
    electionType: 'parliamentary',
    stakes:       'high',
    description:  'Federal midterms — full Chamber of Deputies renewal; Morena coalition majority at stake',
  },
  {
    nation:       'France',
    date:         '2026-06-14',
    daysUntil:    19,
    electionType: 'parliamentary',
    stakes:       'critical',
    description:  'Legislative elections — fragmented assembly; RN surge testing Fifth Republic stability',
  },
  {
    nation:       'Iran',
    date:         '2026-06-28',
    daysUntil:    33,
    electionType: 'presidential',
    stakes:       'high',
    description:  'Presidential election; reformist vs. hardliner dynamics under sanctions pressure',
  },
  {
    nation:       'Germany',
    date:         '2026-09-27',
    daysUntil:    124,
    electionType: 'parliamentary',
    stakes:       'critical',
    description:  'Federal election — coalition collapse aftermath; AfD polling second; NATO posture implications',
  },
  {
    nation:       'Brazil',
    date:         '2026-10-04',
    daysUntil:    131,
    electionType: 'regional',
    stakes:       'medium',
    description:  'Municipal runoffs and state assembly votes; bellwether for 2026 federal cycle',
  },
  {
    nation:       'Colombia',
    date:         '2026-10-25',
    daysUntil:    152,
    electionType: 'regional',
    stakes:       'medium',
    description:  'Departmental and municipal elections; security conditions in FARC splinter areas a concern',
  },
];

export const INTEGRITY_INDICATORS: IntegrityIndicator[] = [
  {
    nation:           'Venezuela',
    riskScore:        4,
    concerns:         ['CNE structural bias', 'opposition exclusion', 'media censorship', 'voter intimidation'],
    observerPresence: false,
  },
  {
    nation:           'Nicaragua',
    riskScore:        4,
    concerns:         ['opposition leaders imprisoned', 'no independent press', 'rubber-stamp institutions'],
    observerPresence: false,
  },
  {
    nation:           'Georgia',
    riskScore:        3,
    concerns:         ['ruling party misuse of state resources', 'judicial pressure', 'foreign agent law chill'],
    observerPresence: true,
  },
  {
    nation:           'Mexico',
    riskScore:        2,
    concerns:         ['cartel intimidation in Guerrero / Michoacán', 'INE funding dispute'],
    observerPresence: true,
  },
  {
    nation:           'France',
    riskScore:        1,
    concerns:         ['foreign disinformation campaigns targeting Macron coalition'],
    observerPresence: true,
  },
];

export const ELECTION_RESULTS: ElectionResult[] = [
  {
    nation:     'Philippines',
    date:       '2026-05-12',
    winner:     'Marcos coalition',
    marginPct:  8.3,
    turnoutPct: 82.1,
    status:     'called',
    notes:      'Senate midterms; 12 of 12 Marcos-aligned senators elected; COMELEC certified results',
  },
  {
    nation:     'Australia',
    date:       '2026-05-03',
    winner:     'Labor (Albanese)',
    marginPct:  2.1,
    turnoutPct: 91.4,
    status:     'called',
    notes:      'Hung parliament averted; majority secured on preferences; Coalition suffered historic losses',
  },
  {
    nation:     'Serbia',
    date:       '2026-03-02',
    winner:     'SNS (Vučić bloc)',
    marginPct:  11,
    turnoutPct: 58.7,
    status:     'disputed',
    notes:      'OSCE/ODIHR flagged vote-count irregularities; opposition rejected results; ongoing protests',
  },
  {
    nation:     'Ecuador',
    date:       '2026-04-21',
    winner:     'No vote',
    marginPct:  4.7,
    turnoutPct: 70.2,
    status:     'called',
    notes:      'Constitutional referendum on security measures; result accepted by all parties',
  },
  {
    nation:     'Belarus',
    date:       '2026-02-09',
    winner:     'Lukashenko bloc',
    marginPct:  79,
    turnoutPct: 87.3,
    status:     'disputed',
    notes:      'Opposition-in-exile and UN rejected results; no independent observers admitted',
  },
];

export const TURNOUT_ANOMALIES: TurnoutAnomaly[] = [
  {
    region:      'Belarus — Eastern oblasts',
    expectedPct: 68,
    actualPct:   95,
    anomalyScore: 4,
    signal:      'State-coercion pattern: workplace polling with supervisor oversight reported',
  },
  {
    region:      'Serbia — Eastern Serbia precincts',
    expectedPct: 61,
    actualPct:   87,
    anomalyScore: 3,
    signal:      'Precinct-level jump inconsistent with demographics; vote-stuffing allegations',
  },
  {
    region:      'Ecuador — Rural Sierra',
    expectedPct: 65,
    actualPct:   73,
    anomalyScore: 2,
    signal:      'Community mobilization by indigenous organizations; within plausible range',
  },
  {
    region:      'Philippines — NCR (Metro Manila)',
    expectedPct: 57,
    actualPct:   49,
    anomalyScore: 1,
    signal:      'Urban voter suppression signal; heat wave + long queues cited as factors',
  },
];

export const DISINFO_SIGNALS: DisinfoSignal[] = [
  {
    platform:     'TikTok / Meta',
    campaignType: 'deepfake',
    targetNation: 'Mexico',
    intensity:    'critical',
    description:  'AI-generated candidate video viral before June 7 vote; 12M views; UNAM lab attribution',
  },
  {
    platform:     'X (Twitter)',
    campaignType: 'bot-network',
    targetNation: 'France',
    intensity:    'high',
    description:  '340_000 synthetic accounts amplifying RN messaging; EU DSA takedown request filed',
  },
  {
    platform:     'Telegram',
    campaignType: 'hack-and-leak',
    targetNation: 'Germany',
    intensity:    'high',
    description:  'SPD internal docs dumped 48h pre-election; GRU-linked infrastructure (BfV advisory)',
  },
  {
    platform:     'Facebook',
    campaignType: 'foreign-amplification',
    targetNation: 'Philippines',
    intensity:    'high',
    description:  'PRC-linked accounts boosting pro-Marcos content; Graphika report confirmed',
  },
  {
    platform:     'Telegram / VKontakte',
    campaignType: 'narrative-flooding',
    targetNation: 'Georgia',
    intensity:    'medium',
    description:  'Anti-EU narratives coordinated across platforms; IRI/NDI documented IO campaign',
  },
];

export const OBSERVER_REPORTS: ObserverReport[] = [
  {
    nation:       'Belarus',
    organization: 'UN Special Rapporteur',
    date:         '2026-02-09',
    verdict:      'rejected',
    findings:     'Fundamental freedoms systematically violated; no independent observers admitted; results not credible',
  },
  {
    nation:       'Serbia',
    organization: 'OSCE/ODIHR',
    date:         '2026-03-02',
    verdict:      'significant-irregularities',
    findings:     'Vote-count manipulation in ~12% of observed precincts; ruling party misused state resources',
  },
  {
    nation:       'Ecuador',
    organization: 'EU Electoral Observation Mission',
    date:         '2026-04-21',
    verdict:      'generally-credible',
    findings:     'Process credible; campaign finance transparency gaps noted; minor tabulation issues',
  },
  {
    nation:       'Australia',
    organization: 'Commonwealth Observer Group',
    date:         '2026-05-03',
    verdict:      'free-and-fair',
    findings:     'Election well-administered; AEC independence maintained; high confidence in results',
  },
  {
    nation:       'Philippines',
    organization: 'Carter Center',
    date:         '2026-05-12',
    verdict:      'generally-credible',
    findings:     'COMELEC process credible; technology reliability issues in 3 provinces; no systematic fraud',
  },
];
