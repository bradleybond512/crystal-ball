/**
 * Pure helpers for AllianceCohesionPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type NatoStatus = 'compliant' | 'below-target' | 'non-compliant' | 'pledge-made';
export type SpendingTrend = 'rising' | 'stable' | 'falling';
export type AllianceHealth = 'strong' | 'strained' | 'fragile' | 'fractured';
export type AgreementStatus = 'active' | 'under-review' | 'suspended' | 'renegotiating' | 'terminated';
export type CredibilitySignal = 'positive' | 'neutral' | 'negative' | 'critical';
export type BlocTensionLevel = 0 | 1 | 2 | 3 | 4;

export interface NatoMember {
  nation: string;
  gdpPct: number;
  status: NatoStatus;
  trend: SpendingTrend;
  notes: string;
}

export interface AllianceCohesionScore {
  name: string;
  members: string[];
  health: AllianceHealth;
  cohesionScore: number;
  keyTension: string;
  keyStrength: string;
}

export interface BilateralAgreement {
  nations: [string, string];
  agreementType: string;
  status: AgreementStatus;
  signedYear: number;
  notes: string;
}

export interface CredibilityEvent {
  date: string;
  alliance: string;
  signal: CredibilitySignal;
  description: string;
  impactNation: string;
}

export interface DefectionRisk {
  nation: string;
  primaryAlliance: string;
  riskScore: number;
  riskFactors: string[];
  trajectory: SpendingTrend;
}

export interface BlocTension {
  nation: string;
  bloc1: string;
  bloc2: string;
  tensionLevel: BlocTensionLevel;
  description: string;
}

// ── NATO status helpers ───────────────────────────────────────────────────

export function natoStatusColor(s: NatoStatus): string {
  const colors: Record<NatoStatus, string> = {
    compliant:      'var(--severity-low,      #4caf50)',
    'pledge-made':  'var(--severity-medium,   #facc15)',
    'below-target': 'var(--severity-high,     #fb923c)',
    'non-compliant': 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function natoStatusLabel(s: NatoStatus): string {
  const labels: Record<NatoStatus, string> = {
    compliant:      'Compliant',
    'pledge-made':  'Pledge Made',
    'below-target': 'Below Target',
    'non-compliant': 'Non-Compliant',
  };
  return labels[s];
}

// ── Spending trend helpers ────────────────────────────────────────────────

export function spendingTrendColor(t: SpendingTrend): string {
  const colors: Record<SpendingTrend, string> = {
    rising:  'var(--severity-low,    #4caf50)',
    stable:  'var(--severity-none,   #9e9e9e)',
    falling: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function spendingTrendLabel(t: SpendingTrend): string {
  const labels: Record<SpendingTrend, string> = {
    rising:  '↑ Rising',
    stable:  '→ Stable',
    falling: '↓ Falling',
  };
  return labels[t];
}

// ── Alliance health helpers ───────────────────────────────────────────────

export function allianceHealthColor(h: AllianceHealth): string {
  const colors: Record<AllianceHealth, string> = {
    strong:    'var(--severity-low,      #4caf50)',
    strained:  'var(--severity-medium,   #facc15)',
    fragile:   'var(--severity-high,     #fb923c)',
    fractured: 'var(--severity-critical, #ef4444)',
  };
  return colors[h];
}

export function allianceHealthLabel(h: AllianceHealth): string {
  const labels: Record<AllianceHealth, string> = {
    strong:    'Strong',
    strained:  'Strained',
    fragile:   'Fragile',
    fractured: 'Fractured',
  };
  return labels[h];
}

// ── Cohesion score color (high = good) ───────────────────────────────────

export function cohesionScoreColor(score: number): string {
  if (score >= 8) return 'var(--severity-low,      #4caf50)';
  if (score >= 6) return 'var(--severity-medium,   #facc15)';
  if (score >= 4) return 'var(--severity-high,     #fb923c)';
  return 'var(--severity-critical, #ef4444)';
}

// ── Agreement status helpers ──────────────────────────────────────────────

export function agreementStatusColor(s: AgreementStatus): string {
  const colors: Record<AgreementStatus, string> = {
    active:         'var(--severity-low,      #4caf50)',
    'under-review': 'var(--severity-medium,   #facc15)',
    renegotiating:  'var(--severity-medium,   #facc15)',
    suspended:      'var(--severity-high,     #fb923c)',
    terminated:     'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function agreementStatusLabel(s: AgreementStatus): string {
  const labels: Record<AgreementStatus, string> = {
    active:         'Active',
    'under-review': 'Under Review',
    renegotiating:  'Renegotiating',
    suspended:      'Suspended',
    terminated:     'Terminated',
  };
  return labels[s];
}

// ── Credibility signal helpers ────────────────────────────────────────────

export function credibilitySignalColor(s: CredibilitySignal): string {
  const colors: Record<CredibilitySignal, string> = {
    positive: 'var(--severity-low,      #4caf50)',
    neutral:  'var(--severity-none,     #9e9e9e)',
    negative: 'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function credibilitySignalLabel(s: CredibilitySignal): string {
  const labels: Record<CredibilitySignal, string> = {
    positive: 'Positive',
    neutral:  'Neutral',
    negative: 'Negative',
    critical: 'Critical',
  };
  return labels[s];
}

// ── Defection risk color (high = bad) ────────────────────────────────────

export function defectionRiskColor(score: number): string {
  if (score >= 7) return 'var(--severity-critical, #ef4444)';
  if (score >= 5) return 'var(--severity-high,     #fb923c)';
  if (score >= 3) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low, #4caf50)';
}

// ── Bloc tension level helpers ────────────────────────────────────────────

export function blocTensionColor(l: BlocTensionLevel): string {
  const colors: Record<BlocTensionLevel, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[l];
}

export function blocTensionLabel(l: BlocTensionLevel): string {
  const labels: Record<BlocTensionLevel, string> = {
    0: 'None',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Severe',
  };
  return labels[l];
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countNonCompliantNato(members: NatoMember[]): number {
  return members.filter(
    (m) => m.status === 'non-compliant' || m.status === 'below-target',
  ).length;
}

export function countFracturedAlliances(alliances: AllianceCohesionScore[]): number {
  return alliances.filter(
    (a) => a.health === 'fractured' || a.health === 'fragile',
  ).length;
}

export function countSuspendedAgreements(agreements: BilateralAgreement[]): number {
  return agreements.filter(
    (a) => a.status === 'suspended' || a.status === 'terminated',
  ).length;
}

export function countNegativeCredibilityEvents(events: CredibilityEvent[]): number {
  return events.filter(
    (e) => e.signal === 'negative' || e.signal === 'critical',
  ).length;
}

export function countHighDefectionRisk(risks: DefectionRisk[]): number {
  return risks.filter((r) => r.riskScore >= 6).length;
}

// ── Static data ───────────────────────────────────────────────────────────

export const NATO_SPENDING: NatoMember[] = [
  {
    nation:  'Poland',
    gdpPct:  4.12,
    status:  'compliant',
    trend:   'rising',
    notes:   'Eastern flank build-up; F-35 deliveries; 15th Mechanised Brigade expansion',
  },
  {
    nation:  'USA',
    gdpPct:  3.49,
    status:  'compliant',
    trend:   'stable',
    notes:   'Largest absolute contributor; USSF expansion; Ukraine aid additionality debate',
  },
  {
    nation:  'UK',
    gdpPct:  2.32,
    status:  'compliant',
    trend:   'stable',
    notes:   'Defence review committed to 2.5% by 2027; AUKUS obligations factor in',
  },
  {
    nation:  'Germany',
    gdpPct:  2.12,
    status:  'compliant',
    trend:   'rising',
    notes:   'Zeitenwende Sondervermögen €100B fund nearly exhausted; new baseline disputed',
  },
  {
    nation:  'France',
    gdpPct:  2.06,
    status:  'compliant',
    trend:   'stable',
    notes:   'Nuclear deterrent counted; EU autonomy doctrine creates NATO command tensions',
  },
  {
    nation:  'Italy',
    gdpPct:  1.49,
    status:  'below-target',
    trend:   'rising',
    notes:   'Defence white paper commits to 2% by 2028; domestic fiscal constraint',
  },
  {
    nation:  'Canada',
    gdpPct:  1.37,
    status:  'below-target',
    trend:   'rising',
    notes:   'NORAD modernisation C$38.6B; sustained US pressure; 2% pledge under review',
  },
  {
    nation:  'Spain',
    gdpPct:  1.28,
    status:  'non-compliant',
    trend:   'stable',
    notes:   'Coalition government fiscal constraints; no credible pathway to 2% near-term',
  },
];

export const ALLIANCE_COHESION_SCORES: AllianceCohesionScore[] = [
  {
    name:         'AUKUS',
    members:      ['Australia', 'UK', 'USA'],
    health:       'strong',
    cohesionScore: 8.5,
    keyTension:   'SSN delivery timeline slippage; Pillar 2 technology export controls',
    keyStrength:  'Submarine basing confirmed at HMAS Stirling; US patrols commenced',
  },
  {
    name:         'Five Eyes',
    members:      ['Australia', 'Canada', 'New Zealand', 'UK', 'USA'],
    health:       'strong',
    cohesionScore: 8.1,
    keyTension:   'NZ China economic dependency creating SIGINT sharing sensitivities',
    keyStrength:  'Expanded AI/ML intelligence sharing; Huawei common exclusion policy',
  },
  {
    name:         'NATO',
    members:      ['32 member states'],
    health:       'strained',
    cohesionScore: 6.2,
    keyTension:   'Trump 2nd term spending ultimatum; Hungary vetoes; Eastern vs. Western flank priorities',
    keyStrength:  'Russia threat unifies Eastern members; Steadfast Defender 2026 full participation',
  },
  {
    name:         'QUAD',
    members:      ['Australia', 'India', 'Japan', 'USA'],
    health:       'strained',
    cohesionScore: 5.8,
    keyTension:   'India non-alignment doctrine; Indian abstention on SCS freedom of navigation',
    keyStrength:  'Indo-Pacific maritime domain awareness; vaccine/infrastructure initiatives',
  },
  {
    name:         'EU Common Security',
    members:      ['27 EU member states'],
    health:       'fragile',
    cohesionScore: 4.3,
    keyTension:   'Hungary vetoes blocking aid packages; strategic autonomy vs. NATO primacy debate',
    keyStrength:  'European Defence Fund operational; PESCO projects expanding capacity',
  },
];

export const BILATERAL_AGREEMENTS: BilateralAgreement[] = [
  {
    nations:       ['USA', 'Philippines'],
    agreementType: 'Mutual Defence Treaty',
    status:        'active',
    signedYear:    1951,
    notes:         'VFA expanded; US access to 9 bases; South China Sea patrols resumed',
  },
  {
    nations:       ['USA', 'South Korea'],
    agreementType: 'Mutual Defence Treaty',
    status:        'active',
    signedYear:    1953,
    notes:         'EDPP extended; THAAD operational; combined exercises restored post-Trump 1',
  },
  {
    nations:       ['France', 'Germany'],
    agreementType: 'Élysée Treaty Successor',
    status:        'renegotiating',
    signedYear:    1963,
    notes:         'Aachen Treaty follow-on stalled; EU autonomy vs. NATO primacy unresolved',
  },
  {
    nations:       ['USA', 'Saudi Arabia'],
    agreementType: 'Security Partnership',
    status:        'under-review',
    signedYear:    1974,
    notes:         'Israel normalisation precondition; MBS nuclear enrichment demand unresolved',
  },
  {
    nations:       ['UK', 'Australia'],
    agreementType: 'Defence Cooperation Agreement',
    status:        'active',
    signedYear:    2024,
    notes:         'AUKUS-aligned; Astute-class patrols from HMAS Stirling commenced',
  },
];

export const CREDIBILITY_EVENTS: CredibilityEvent[] = [
  {
    date:         '2026-04-15',
    alliance:     'NATO',
    signal:       'positive',
    description:  'Steadfast Defender 2026 achieved full 32-member participation; largest exercise since Cold War',
    impactNation: 'All NATO',
  },
  {
    date:         '2026-04-02',
    alliance:     'AUKUS',
    signal:       'positive',
    description:  'UK Astute-class submarine conducted first operational patrol from HMAS Stirling, Western Australia',
    impactNation: 'Australia',
  },
  {
    date:         '2026-03-18',
    alliance:     'NATO',
    signal:       'negative',
    description:  'Trump threatened US withdrawal if member states fail to reach 2% GDP by end-2026',
    impactNation: 'Canada, Spain, Belgium',
  },
  {
    date:         '2026-02-10',
    alliance:     'QUAD',
    signal:       'neutral',
    description:  'India abstained from QUAD joint statement on South China Sea freedom of navigation',
    impactNation: 'India',
  },
  {
    date:         '2026-01-22',
    alliance:     'USA',
    signal:       'critical',
    description:  'Senate resolution introduced questioning automatic Article 5 trigger; 12 co-sponsors',
    impactNation: 'All NATO',
  },
];

export const DEFECTION_RISKS: DefectionRisk[] = [
  {
    nation:          'Hungary',
    primaryAlliance: 'NATO / EU',
    riskScore:       8.1,
    riskFactors:     ['Orbán pro-Putin stance', 'Paks II nuclear deal with Russia', 'NATO veto weaponization', 'Fidesz media state capture'],
    trajectory:      'rising',
  },
  {
    nation:          'Turkey',
    primaryAlliance: 'NATO',
    riskScore:       7.4,
    riskFactors:     ['S-400 retention blocking F-16 upgrade path', 'Kurdish policy conflict with allies', 'F-16 leverage vs. Sweden admission', 'Gaza ceasefire divergence'],
    trajectory:      'stable',
  },
  {
    nation:          'Saudi Arabia',
    primaryAlliance: 'US Partnership',
    riskScore:       5.8,
    riskFactors:     ['OPEC+ coordination with Russia', 'China oil payment in yuan', 'Nuclear enrichment demand', 'MBS autonomy assertion'],
    trajectory:      'rising',
  },
  {
    nation:          'India',
    primaryAlliance: 'QUAD',
    riskScore:       5.2,
    riskFactors:     ['Non-alignment doctrine', 'Russian arms dependency (60% of inventory)', 'SCO full member', 'BRICS chair 2025'],
    trajectory:      'stable',
  },
  {
    nation:          'Philippines',
    primaryAlliance: 'US Alliance',
    riskScore:       4.1,
    riskFactors:     ['China economic dependency', 'Domestic nationalist pressure', 'West PHL Sea flashpoint fatigue'],
    trajectory:      'falling',
  },
];

export const BLOC_TENSIONS: BlocTension[] = [
  {
    nation:       'Hungary',
    bloc1:        'NATO / EU',
    bloc2:        'Russia-aligned',
    tensionLevel: 4,
    description:  'Orbán positioned as pro-Kremlin veto within NATO; Paks II energy dependency locks Russia influence',
  },
  {
    nation:       'Turkey',
    bloc1:        'NATO',
    bloc2:        'Russia (S-400 / TurkStream)',
    tensionLevel: 3,
    description:  'S-400 operationally deployed; TurkStream gas transit revenue; Gaza / Kurdish divergence from NATO line',
  },
  {
    nation:       'India',
    bloc1:        'QUAD / Western tech',
    bloc2:        'SCO / BRICS / Russia arms',
    tensionLevel: 3,
    description:  'Simultaneous SCO + QUAD membership; Russian arms embargo risk; US tech decoupling pressure',
  },
  {
    nation:       'Serbia',
    bloc1:        'EU aspirant',
    bloc2:        'Russia / China aligned',
    tensionLevel: 2,
    description:  'Vucic dual-alignment strategy; Chinese JF-17 and FK-3 SAM acquisition; EU progress stalled',
  },
  {
    nation:       'Kazakhstan',
    bloc1:        'CSTO',
    bloc2:        'China BRI / SCO',
    tensionLevel: 2,
    description:  'CSTO credibility collapse post-2022 crisis non-response; China BRI debt dependency increasing',
  },
];
