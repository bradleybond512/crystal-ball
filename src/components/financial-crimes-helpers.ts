/**
 * Pure helpers for FinancialCrimesPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CaseStatus = 'investigation' | 'indicted' | 'settled' | 'convicted';
export type RansomPaymentTrend = 'rising' | 'stable' | 'falling';
export type FatfStatus = 'compliant' | 'grey-list' | 'black-list' | 'enhanced-monitoring';
export type DeRiskingDirection = 'expanding' | 'easing' | 'reciprocal';
export type ShellRisk = 'low' | 'medium' | 'high' | 'extreme';
export type TbmlPattern =
  | 'over-invoicing'
  | 'under-invoicing'
  | 'multiple-invoicing'
  | 'phantom-shipment'
  | 'misclassification';
export type FiuAlertTrend = 'declining' | 'flat' | 'rising' | 'surging';

export interface LaunderingCase {
  caseName: string;
  jurisdiction: string;
  amountUsdMillions: number;
  status: CaseStatus;
  predicateOffense: string;
  notes: string;
}

export interface CryptoCrimeEvent {
  incidentName: string;
  cryptoAsset: string;
  amountUsdMillions: number;
  attributedActor: string;
  paymentTrend: RansomPaymentTrend;
  notes: string;
}

export interface FatfEntry {
  jurisdiction: string;
  status: FatfStatus;
  effectiveDate: string;
  driver: string;
}

export interface DeRiskingEvent {
  corridor: string;
  direction: DeRiskingDirection;
  affectedBanks: number;
  notes: string;
}

export interface ShellJurisdiction {
  jurisdiction: string;
  risk: ShellRisk;
  beneficialOwnerRegistry: 'public' | 'restricted' | 'private' | 'none';
  notes: string;
}

export interface TbmlSignal {
  corridor: string;
  pattern: TbmlPattern;
  commodity: string;
  estimatedUsdMillions: number;
  notes: string;
}

export interface FiuAlert {
  fiu: string;
  alertCategory: string;
  trend: FiuAlertTrend;
  filingsLast30d: number;
  notes: string;
}

// ── Case status helpers ───────────────────────────────────────────────────

export function caseStatusColor(s: CaseStatus): string {
  const colors: Record<CaseStatus, string> = {
    investigation: 'var(--severity-medium,   #facc15)',
    indicted:      'var(--severity-high,     #fb923c)',
    convicted:     'var(--severity-critical, #ef4444)',
    settled:       'var(--severity-low,      #4caf50)',
  };
  return colors[s];
}

export function caseStatusLabel(s: CaseStatus): string {
  const labels: Record<CaseStatus, string> = {
    investigation: 'Investigation',
    indicted:      'Indicted',
    convicted:     'Convicted',
    settled:       'Settled',
  };
  return labels[s];
}

// ── Ransom payment trend ──────────────────────────────────────────────────

export function ransomTrendColor(t: RansomPaymentTrend): string {
  const colors: Record<RansomPaymentTrend, string> = {
    rising:  'var(--severity-critical, #ef4444)',
    stable:  'var(--severity-medium,   #facc15)',
    falling: 'var(--severity-low,      #4caf50)',
  };
  return colors[t];
}

export function ransomTrendLabel(t: RansomPaymentTrend): string {
  const labels: Record<RansomPaymentTrend, string> = {
    rising:  '↑ Rising',
    stable:  '→ Stable',
    falling: '↓ Falling',
  };
  return labels[t];
}

// ── FATF status helpers ───────────────────────────────────────────────────

export function fatfStatusColor(s: FatfStatus): string {
  const colors: Record<FatfStatus, string> = {
    compliant:             'var(--severity-low,      #4caf50)',
    'enhanced-monitoring': 'var(--severity-medium,   #facc15)',
    'grey-list':           'var(--severity-high,     #fb923c)',
    'black-list':          'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function fatfStatusLabel(s: FatfStatus): string {
  const labels: Record<FatfStatus, string> = {
    compliant:             'Compliant',
    'enhanced-monitoring': 'Enhanced Monitoring',
    'grey-list':           'Grey List',
    'black-list':          'Black List',
  };
  return labels[s];
}

// ── De-risking direction ──────────────────────────────────────────────────

export function deRiskingColor(d: DeRiskingDirection): string {
  const colors: Record<DeRiskingDirection, string> = {
    expanding:  'var(--severity-critical, #ef4444)',
    reciprocal: 'var(--severity-medium,   #facc15)',
    easing:     'var(--severity-low,      #4caf50)',
  };
  return colors[d];
}

export function deRiskingLabel(d: DeRiskingDirection): string {
  const labels: Record<DeRiskingDirection, string> = {
    expanding:  'Expanding',
    reciprocal: 'Reciprocal',
    easing:     'Easing',
  };
  return labels[d];
}

// ── Shell risk ────────────────────────────────────────────────────────────

export function shellRiskColor(r: ShellRisk): string {
  const colors: Record<ShellRisk, string> = {
    low:     'var(--severity-low,      #4caf50)',
    medium:  'var(--severity-medium,   #facc15)',
    high:    'var(--severity-high,     #fb923c)',
    extreme: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function shellRiskLabel(r: ShellRisk): string {
  const labels: Record<ShellRisk, string> = {
    low:     'Low',
    medium:  'Medium',
    high:    'High',
    extreme: 'Extreme',
  };
  return labels[r];
}

// ── TBML pattern ──────────────────────────────────────────────────────────

export function tbmlPatternLabel(p: TbmlPattern): string {
  const labels: Record<TbmlPattern, string> = {
    'over-invoicing':     'Over-Invoicing',
    'under-invoicing':    'Under-Invoicing',
    'multiple-invoicing': 'Multiple-Invoicing',
    'phantom-shipment':   'Phantom Shipment',
    'misclassification':  'Misclassification',
  };
  return labels[p];
}

// ── FIU alert trend ───────────────────────────────────────────────────────

export function fiuTrendColor(t: FiuAlertTrend): string {
  const colors: Record<FiuAlertTrend, string> = {
    declining: 'var(--severity-low,      #4caf50)',
    flat:      'var(--severity-none,     #9e9e9e)',
    rising:    'var(--severity-high,     #fb923c)',
    surging:   'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function fiuTrendLabel(t: FiuAlertTrend): string {
  const labels: Record<FiuAlertTrend, string> = {
    declining: '↓ Declining',
    flat:      '→ Flat',
    rising:    '↑ Rising',
    surging:   '⤴ Surging',
  };
  return labels[t];
}

// ── Count aggregations ────────────────────────────────────────────────────

export function countActiveLaunderingCases(cases: LaunderingCase[]): number {
  return cases.filter((c) => c.status === 'investigation' || c.status === 'indicted').length;
}

export function countRisingCryptoCrimes(events: CryptoCrimeEvent[]): number {
  return events.filter((e) => e.paymentTrend === 'rising').length;
}

export function countListedJurisdictions(entries: FatfEntry[]): number {
  return entries.filter((e) => e.status === 'grey-list' || e.status === 'black-list').length;
}

export function countExpandingDeRisking(events: DeRiskingEvent[]): number {
  return events.filter((e) => e.direction === 'expanding').length;
}

export function countHighShellRisk(jurisdictions: ShellJurisdiction[]): number {
  return jurisdictions.filter((j) => j.risk === 'high' || j.risk === 'extreme').length;
}

export function countSurgingFiuAlerts(alerts: FiuAlert[]): number {
  return alerts.filter((a) => a.trend === 'surging').length;
}

// ── Static datasets (current as of 2026-Q2) ───────────────────────────────

export const LAUNDERING_CASES: LaunderingCase[] = [
  {
    caseName:          '1MDB residual recovery',
    jurisdiction:      'Malaysia / US / Switzerland',
    amountUsdMillions: 4500,
    status:            'settled',
    predicateOffense:  'Sovereign wealth fund embezzlement',
    notes:             'Goldman Sachs DOJ DPA fulfilled; Najib appeals exhausted; outstanding asset traces in Cayman + BVI',
  },
  {
    caseName:          'Danske Bank Estonia',
    jurisdiction:      'Denmark / Estonia / US',
    amountUsdMillions: 230_000,
    status:            'settled',
    predicateOffense:  'Russian/CIS non-resident flow laundering',
    notes:             'DOJ $2B + Danish $470M settlement; FCPA monitor through 2027; Bestseller successor exposure under review',
  },
  {
    caseName:          'Wirecard third-party acquirer trail',
    jurisdiction:      'Germany / Singapore / Philippines',
    amountUsdMillions: 2100,
    status:            'indicted',
    predicateOffense:  'Accounting fraud + acquirer-routed laundering',
    notes:             'Munich trial ongoing into 2026; Jan Marsalek extradition request pending Russia rejection',
  },
  {
    caseName:          'Binance unregistered MSB',
    jurisdiction:      'US / Cayman',
    amountUsdMillions: 4300,
    status:            'settled',
    predicateOffense:  'AML/BSA failures, OFAC violations',
    notes:             'FinCEN+OFAC+CFTC consent; monitor through 2028; Zhao 4-month sentence served',
  },
  {
    caseName:          'TD Bank AML failures',
    jurisdiction:      'US / Canada',
    amountUsdMillions: 3000,
    status:            'convicted',
    predicateOffense:  'Fentanyl proceeds, Sinaloa cartel laundering',
    notes:             'DOJ $1.8B + FinCEN $1.3B; growth restriction order in place; first US bank guilty plea since 1990s',
  },
  {
    caseName:          'Credit Suisse Bulgarian cocaine ring',
    jurisdiction:      'Switzerland',
    amountUsdMillions: 200,
    status:            'convicted',
    predicateOffense:  'Cocaine trafficking proceeds',
    notes:             'First major Swiss bank criminal conviction; UBS post-merger exposure under FINMA review',
  },
];

export const CRYPTO_CRIME_EVENTS: CryptoCrimeEvent[] = [
  {
    incidentName:      'Lazarus Group Bybit hack',
    cryptoAsset:       'ETH',
    amountUsdMillions: 1500,
    attributedActor:   'DPRK Lazarus Group',
    paymentTrend:      'rising',
    notes:             'Largest single crypto theft on record; Tornado Cash + Thorchain laundering chain; FBI flagged 51 wallets',
  },
  {
    incidentName:      'Cl0p MOVEit follow-on extortion',
    cryptoAsset:       'BTC',
    amountUsdMillions: 100,
    attributedActor:   'Cl0p ransomware',
    paymentTrend:      'stable',
    notes:             'CL0P shifted to data-theft only model; payment refusal rate climbing post-CISA guidance',
  },
  {
    incidentName:      'LockBit 4.0 affiliate program',
    cryptoAsset:       'BTC + Monero',
    amountUsdMillions: 320,
    attributedActor:   'LockBit (post-Op Cronos rebuild)',
    paymentTrend:      'stable',
    notes:             'Affiliate count rebuilt to ~120 post-takedown; XMR portion rose from 5% to 28% YoY',
  },
  {
    incidentName:      'Pig-butchering Southeast Asia ring',
    cryptoAsset:       'USDT (TRC-20)',
    amountUsdMillions: 75_000,
    attributedActor:   'Chinese-organized SE Asia syndicates',
    paymentTrend:      'rising',
    notes:             'UN estimates Cambodia/Myanmar compounds; Tether freezing 1.4B USDT YTD; OFAC sanctioning 4 ring leaders',
  },
  {
    incidentName:      'Sanctions evasion via Garantex successor',
    cryptoAsset:       'USDT',
    amountUsdMillions: 20_000,
    attributedActor:   'Russian sanctions-evasion network',
    paymentTrend:      'rising',
    notes:             'Garantex re-emerging as Grinex; OFAC re-designation pending; Tether freeze list expanding',
  },
];

export const FATF_STATUS: FatfEntry[] = [
  {
    jurisdiction:  'United Arab Emirates',
    status:        'compliant',
    effectiveDate: '2024-02-23',
    driver:        'Exited grey list; sustained DNFBP supervision + UBO registry roll-out',
  },
  {
    jurisdiction:  'Türkiye',
    status:        'compliant',
    effectiveDate: '2024-06-28',
    driver:        'Exited grey list after MASAK staffing + sanctioned-asset freezing improvements',
  },
  {
    jurisdiction:  'Nigeria',
    status:        'grey-list',
    effectiveDate: '2023-02-24',
    driver:        'Persistent gaps in DNFBP supervision; beneficial-owner registry adoption stalled',
  },
  {
    jurisdiction:  'South Africa',
    status:        'grey-list',
    effectiveDate: '2023-02-24',
    driver:        'State-capture-era enforcement backlog; NPA AFU under-resourced; FSCA gaps',
  },
  {
    jurisdiction:  'Venezuela',
    status:        'enhanced-monitoring',
    effectiveDate: '2025-10-25',
    driver:        'Gold-trade laundering channels; sanctions evasion via Curaçao + Honduras corridors',
  },
  {
    jurisdiction:  'Iran',
    status:        'black-list',
    effectiveDate: '2020-02-21',
    driver:        'Palermo + TF conventions not ratified; ongoing counter-measures call',
  },
  {
    jurisdiction:  'DPRK',
    status:        'black-list',
    effectiveDate: '2011-02-25',
    driver:        'Lazarus Group state-sponsored crypto theft; continued counter-measures call',
  },
  {
    jurisdiction:  'Myanmar',
    status:        'black-list',
    effectiveDate: '2022-10-21',
    driver:        'No FATF action plan engagement; military-junta misuse of financial system',
  },
];

export const DERISKING_EVENTS: DeRiskingEvent[] = [
  {
    corridor:      'US correspondent banking → Caribbean',
    direction:     'expanding',
    affectedBanks: 14,
    notes:         'JPM, BNY, Citi continuing CBR exits; CARICOM ministerial protest delivered to Treasury',
  },
  {
    corridor:      'EU correspondent → MENA',
    direction:     'expanding',
    affectedBanks: 9,
    notes:         'Deutsche + BNP continued Lebanon / Egypt account closures; trade-finance gap widening',
  },
  {
    corridor:      'UK Russia rouble clearing',
    direction:     'expanding',
    affectedBanks: 6,
    notes:         'HSBC, Barclays terminated remaining rouble nostro accounts; sanctions-driven not commercial',
  },
  {
    corridor:      'US correspondent → Mexico (post-TD)',
    direction:     'expanding',
    affectedBanks: 11,
    notes:         'Post-TD precedent driving CBR reassessment of Sinaloa-adjacent banks; remittance corridor stress rising',
  },
  {
    corridor:      'Singapore correspondent → ASEAN frontier',
    direction:     'reciprocal',
    affectedBanks: 4,
    notes:         'DBS + OCBC selective re-entry under MAS overseen risk-based approach',
  },
];

export const SHELL_JURISDICTIONS: ShellJurisdiction[] = [
  {
    jurisdiction:             'British Virgin Islands',
    risk:                     'extreme',
    beneficialOwnerRegistry:  'private',
    notes:                    'Public UBO access delayed indefinitely; FCDO Order in Council overrule under debate',
  },
  {
    jurisdiction:             'Cayman Islands',
    risk:                     'high',
    beneficialOwnerRegistry:  'restricted',
    notes:                    'Legitimate-interest UBO model only; FATF grey-list exit 2023 but persistent typology concerns',
  },
  {
    jurisdiction:             'Delaware (US LLC)',
    risk:                     'high',
    beneficialOwnerRegistry:  'restricted',
    notes:                    'CTA registry under Treasury at FinCEN; Texas v. Garland enforcement stay extended',
  },
  {
    jurisdiction:             'Hong Kong',
    risk:                     'high',
    beneficialOwnerRegistry:  'restricted',
    notes:                    'Significant Controllers Register filed with Companies Registry but not public; mainland nominee abuse',
  },
  {
    jurisdiction:             'United Kingdom',
    risk:                     'medium',
    beneficialOwnerRegistry:  'public',
    notes:                    'PSC register public + ECCTA verification rolling out; Companies House identity checks operational',
  },
  {
    jurisdiction:             'Singapore',
    risk:                     'medium',
    beneficialOwnerRegistry:  'private',
    notes:                    'ACRA registry private to officials; post S$3B laundering case stricter family-office screening',
  },
  {
    jurisdiction:             'Marshall Islands',
    risk:                     'extreme',
    beneficialOwnerRegistry:  'none',
    notes:                    'Sanctions evasion shipping shell hub; OFAC + UK OFSI continuing designations on registered owners',
  },
];

export const TBML_SIGNALS: TbmlSignal[] = [
  {
    corridor:              'UAE → Hong Kong gold trade',
    pattern:               'over-invoicing',
    commodity:             'Gold',
    estimatedUsdMillions:  6500,
    notes:                 'DMCC-cleared gold value inflation 18% vs LBMA benchmark; sanctions-evasion proxy for Russia + Venezuela',
  },
  {
    corridor:              'China → Mexico manufactured goods',
    pattern:               'multiple-invoicing',
    commodity:             'Electronics + textiles',
    estimatedUsdMillions:  3800,
    notes:                 'Sinaloa + CJNG laundering via repeated commercial invoicing; CBP + SAT cooperation MoU signed',
  },
  {
    corridor:              'Turkey → Russia dual-use components',
    pattern:               'misclassification',
    commodity:             'Semiconductors + machine tools',
    estimatedUsdMillions:  2200,
    notes:                 'HS code mislabeling to bypass EU/UK/US export controls; OFSI + BIS export-enforcement spotlight',
  },
  {
    corridor:              'India → Singapore diamond trade',
    pattern:               'under-invoicing',
    commodity:             'Polished diamonds',
    estimatedUsdMillions:  1100,
    notes:                 'GJEPC scheme review post-Modi/Choksi; PNB-fraud-era patterns recurring at smaller scale',
  },
  {
    corridor:              'West Africa cashew + cocoa',
    pattern:               'phantom-shipment',
    commodity:             'Cashew + cocoa',
    estimatedUsdMillions:  600,
    notes:                 'Côte d\'Ivoire + Ghana terminal records show phantom container movements; GIABA review escalating',
  },
];

export const FIU_ALERTS: FiuAlert[] = [
  {
    fiu:               'FinCEN (US)',
    alertCategory:     'Fentanyl precursor financing',
    trend:             'surging',
    filingsLast30d:    1240,
    notes:             'SAR keyword filings up 340% YoY following 2024 advisory; banks pivoting to chemical-supplier screening',
  },
  {
    fiu:               'NCA UKFIU',
    alertCategory:     'Russian sanctions evasion via crypto',
    trend:             'rising',
    filingsLast30d:    520,
    notes:             'SARs database accepting structured crypto fields; OFSI + NCA joint advisory drove uplift',
  },
  {
    fiu:               'AUSTRAC',
    alertCategory:     'SE Asia pig-butchering',
    trend:             'surging',
    filingsLast30d:    810,
    notes:             'AUSTRAC + AFP joint task force; Aussie victim losses passed A$1B aggregate',
  },
  {
    fiu:               'TRACFIN (France)',
    alertCategory:     'Olympic-corridor real-estate laundering',
    trend:             'rising',
    filingsLast30d:    380,
    notes:             'Paris 2024 legacy surveillance continuing; notaire reporting up 45% YoY',
  },
  {
    fiu:               'FIU India',
    alertCategory:     'Hawala + crypto convergence',
    trend:             'rising',
    filingsLast30d:    690,
    notes:             'ED + DGGI joint cases; Binance + WazirX historical exposure under examination',
  },
  {
    fiu:               'JAFIC (Japan)',
    alertCategory:     'Online-casino proceeds laundering',
    trend:             'flat',
    filingsLast30d:    150,
    notes:             'Cross-border online-gambling-derived JPY flows steady; Yakuza front-company involvement under review',
  },
];
