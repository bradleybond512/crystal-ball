/**
 * Pure helpers for DigitalCurrencyGeopoliticsPanel.
 *
 * Tracks three interlocking dimensions of digital-currency geopolitics:
 *
 *   1. CBDC Status Matrix       — 12+ country CBDC development status
 *   2. De-dollarization Signals — USD reserve share decline, BRICS+ moves,
 *                                  petrodollar cracks, CNY internationalisation
 *   3. Sanctions Evasion via Crypto — Russia, Iran, North Korea, Venezuela
 *
 * No DOM, no fetch, no globals — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CbdcStatus =
  | 'live-scaling'
  | 'live-limited'
  | 'piloting'
  | 'research'
  | 'research-opposed'
  | 'cancelled'
  | 'failed';

export type CbdcScope = 'retail' | 'wholesale' | 'both' | 'cross-border';

export type DedollarizationTrend = 'accelerating' | 'stable' | 'reversing' | 'nascent';

export type SanctionsEvasionConfidence = 'confirmed' | 'high' | 'moderate' | 'suspected';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

// ── Section 1: CBDC Status Matrix ────────────────────────────────────────

export interface CbdcEntry {
  country: string;
  iso2: string;
  name: string;
  status: CbdcStatus;
  scope: CbdcScope;
  launchYear: number | null;
  walletsMillion: number | null;
  transactionsBn: number | null;
  crossBorderPartners: string[];
  sanctionsEvasionGoal: boolean;
  notes: string;
}

export const CBDC_ENTRIES: readonly CbdcEntry[] = [
  {
    country: 'China',
    iso2: 'CN',
    name: 'e-CNY (Digital Yuan)',
    status: 'live-scaling',
    scope: 'both',
    launchYear: 2020,
    walletsMillion: 260,
    transactionsBn: 250,
    crossBorderPartners: ['Hong Kong', 'UAE', 'Thailand', 'Saudi Arabia'],
    sanctionsEvasionGoal: false,
    notes: 'Largest CBDC deployment globally; mBridge cross-border testing active.',
  },
  {
    country: 'USA',
    iso2: 'US',
    name: 'Digital Dollar',
    status: 'research-opposed',
    scope: 'retail',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: [],
    sanctionsEvasionGoal: false,
    notes: 'Fed studying; Congress blocked under Trump; Executive Order 2025 opposed retail CBDC.',
  },
  {
    country: 'EU',
    iso2: 'EU',
    name: 'Digital Euro',
    status: 'piloting',
    scope: 'retail',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: [],
    sanctionsEvasionGoal: false,
    notes: 'ECB pilot 2024; legislation pending European Parliament approval.',
  },
  {
    country: 'India',
    iso2: 'IN',
    name: 'e-Rupee',
    status: 'live-scaling',
    scope: 'both',
    launchYear: 2022,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: ['UAE', 'Singapore', 'UK', 'Malaysia', 'Bahrain', 'Nepal', 'Sri Lanka', 'Bhutan', 'Mauritius'],
    sanctionsEvasionGoal: false,
    notes: 'RBI cross-border pilots with 9 countries; wholesale launched Nov 2022, retail Dec 2022.',
  },
  {
    country: 'UK',
    iso2: 'GB',
    name: 'Digital Pound (Britcoin)',
    status: 'research',
    scope: 'retail',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: [],
    sanctionsEvasionGoal: false,
    notes: 'Consultation concluded 2024; no decision on issuance; sandbox testing continues.',
  },
  {
    country: 'Brazil',
    iso2: 'BR',
    name: 'DREX',
    status: 'piloting',
    scope: 'both',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: [],
    sanctionsEvasionGoal: false,
    notes: 'Wholesale + retail pilot; tokenized securities settlement use case; BCB leading.',
  },
  {
    country: 'Russia',
    iso2: 'RU',
    name: 'Digital Ruble',
    status: 'live-limited',
    scope: 'retail',
    launchYear: 2023,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: ['China', 'Iran'],
    sanctionsEvasionGoal: true,
    notes: 'Deployed Aug 2023; limited rollout; explicit sanctions-evasion strategic goal vs SWIFT exclusion.',
  },
  {
    country: 'Nigeria',
    iso2: 'NG',
    name: 'eNaira',
    status: 'live-limited',
    scope: 'retail',
    launchYear: 2021,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: [],
    sanctionsEvasionGoal: false,
    notes: 'First Sub-Saharan CBDC (Oct 2021); adoption <0.5% population; redesign underway.',
  },
  {
    country: 'Bahamas',
    iso2: 'BS',
    name: 'Sand Dollar',
    status: 'live-limited',
    scope: 'retail',
    launchYear: 2020,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: [],
    sanctionsEvasionGoal: false,
    notes: "World's first CBDC (Oct 2020); limited adoption; financial inclusion focus.",
  },
  {
    country: 'Saudi Arabia',
    iso2: 'SA',
    name: 'mBridge / Project Aber',
    status: 'piloting',
    scope: 'cross-border',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: ['China', 'UAE', 'Hong Kong', 'Thailand'],
    sanctionsEvasionGoal: false,
    notes: 'mBridge participant (joined 2023); petrodollar diversification signal; bilateral CNY oil deals.',
  },
  {
    country: 'UAE',
    iso2: 'AE',
    name: 'Digital Dirham / mBridge',
    status: 'piloting',
    scope: 'cross-border',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: ['China', 'Hong Kong', 'Thailand', 'Saudi Arabia'],
    sanctionsEvasionGoal: false,
    notes: 'mBridge founding member; CBUAE digital dirham pilot running domestically.',
  },
  {
    country: 'Thailand',
    iso2: 'TH',
    name: 'mBridge Participant',
    status: 'piloting',
    scope: 'cross-border',
    launchYear: null,
    walletsMillion: null,
    transactionsBn: null,
    crossBorderPartners: ['China', 'Hong Kong', 'UAE'],
    sanctionsEvasionGoal: false,
    notes: 'mBridge participant; BOT exploring retail CBDC in parallel.',
  },
];

// ── CBDC status helpers ───────────────────────────────────────────────────

const CBDC_STATUS_COLORS: Record<CbdcStatus, string> = {
  'live-scaling':     '#22c55e',
  'live-limited':     '#84cc16',
  'piloting':         '#facc15',
  'research':         '#60a5fa',
  'research-opposed': '#94a3b8',
  'cancelled':        '#6b7280',
  'failed':           '#ef4444',
};

const CBDC_STATUS_LABELS: Record<CbdcStatus, string> = {
  'live-scaling':     'Live / Scaling',
  'live-limited':     'Live (Limited)',
  'piloting':         'Piloting',
  'research':         'Research',
  'research-opposed': 'Research (Opposed)',
  'cancelled':        'Cancelled',
  'failed':           'Failed',
};

export function cbdcStatusColor(s: CbdcStatus): string {
  return CBDC_STATUS_COLORS[s];
}

export function cbdcStatusLabel(s: CbdcStatus): string {
  return CBDC_STATUS_LABELS[s];
}

export function getByStatus(entries: readonly CbdcEntry[], status: CbdcStatus): CbdcEntry[] {
  return entries.filter((e) => e.status === status);
}

export function getLiveCBDCs(entries: readonly CbdcEntry[]): CbdcEntry[] {
  return entries.filter((e) => e.status === 'live-scaling' || e.status === 'live-limited');
}

export function getSanctionsEvasionActors(entries: readonly CbdcEntry[]): CbdcEntry[] {
  return entries.filter((e) => e.sanctionsEvasionGoal);
}

// ── Section 2: De-dollarization Signals ──────────────────────────────────

export interface DedollarizationSignal {
  id: string;
  label: string;
  trend: DedollarizationTrend;
  currentValuePct: number | null;
  peakValuePct: number | null;
  peakYear: number | null;
  riskLevel: RiskLevel;
  description: string;
}

export const DEDOLLARIZATION_SIGNALS: readonly DedollarizationSignal[] = [
  {
    id: 'usd-fx-reserves',
    label: 'USD Share of Global FX Reserves',
    trend: 'accelerating',
    currentValuePct: 58.4,
    peakValuePct: 71.5,
    peakYear: 2000,
    riskLevel: 'high',
    description: 'IMF COFER data: USD fell from 71% (2000) to ~58% (2025). Decline accelerated post-2022 Russia sanctions.',
  },
  {
    id: 'brics-currency',
    label: 'BRICS+ Reserve Currency Initiative',
    trend: 'nascent',
    currentValuePct: null,
    peakValuePct: null,
    peakYear: null,
    riskLevel: 'medium',
    description: 'Kazan 2024 summit: BRICS+ common currency proposal failed; BRICS Pay settlement system advancing.',
  },
  {
    id: 'russia-china-cny-rub',
    label: 'Russia-China Trade in CNY/RUB',
    trend: 'accelerating',
    currentValuePct: 90,
    peakValuePct: null,
    peakYear: null,
    riskLevel: 'high',
    description: '>90% of bilateral Russia-China trade settled in CNY or RUB, up from <5% pre-2022.',
  },
  {
    id: 'petrodollar-cracks',
    label: 'Petrodollar System Erosion',
    trend: 'accelerating',
    currentValuePct: null,
    peakValuePct: null,
    peakYear: null,
    riskLevel: 'high',
    description: 'Saudi Arabia selling oil to China in CNY. Saudi-US Petrodollar accord not renewed June 2024.',
  },
  {
    id: 'mbridge',
    label: 'BIS mBridge Cross-Border CBDC',
    trend: 'accelerating',
    currentValuePct: null,
    peakValuePct: null,
    peakYear: null,
    riskLevel: 'high',
    description: 'China, UAE, Hong Kong, Thailand, Saudi Arabia transacting without USD correspondent banks.',
  },
  {
    id: 'gold-accumulation',
    label: 'Central Bank Gold Accumulation',
    trend: 'accelerating',
    currentValuePct: null,
    peakValuePct: null,
    peakYear: null,
    riskLevel: 'medium',
    description: 'Central bank gold purchases hit 50-year record 2022-2024; China, India, Turkey, Poland leading.',
  },
  {
    id: 'cny-internationalisation',
    label: 'CNY International Payment Share',
    trend: 'stable',
    currentValuePct: 4.7,
    peakValuePct: 4.7,
    peakYear: 2024,
    riskLevel: 'medium',
    description: 'SWIFT data: CNY ~4.7% of global payments (2024). Rising but plateauing; capital controls limit share.',
  },
];

// ── De-dollarization helpers ──────────────────────────────────────────────

const TREND_COLORS: Record<DedollarizationTrend, string> = {
  accelerating: '#ef4444',
  stable:       '#facc15',
  reversing:    '#22c55e',
  nascent:      '#60a5fa',
};

const TREND_LABELS: Record<DedollarizationTrend, string> = {
  accelerating: 'Accelerating',
  stable:       'Stable',
  reversing:    'Reversing',
  nascent:      'Nascent',
};

export function trendColor(t: DedollarizationTrend): string {
  return TREND_COLORS[t];
}

export function trendLabel(t: DedollarizationTrend): string {
  return TREND_LABELS[t];
}

// ── Section 3: Crypto Sanctions Evasion ──────────────────────────────────

export interface SanctionsEvasionActor {
  country: string;
  iso2: string;
  actor: string;
  cryptoType: string;
  estimatedUsdBn: number;
  confidence: SanctionsEvasionConfidence;
  method: string;
  lastActivityYear: number;
  notes: string;
}

export const SANCTIONS_EVASION_ACTORS: readonly SanctionsEvasionActor[] = [
  {
    country: 'North Korea',
    iso2: 'KP',
    actor: 'Lazarus Group (DPRK RGB)',
    cryptoType: 'BTC, ETH, USDT',
    estimatedUsdBn: 3.0,
    confidence: 'confirmed',
    method: 'Exchange hacks, DeFi exploits, mixer obfuscation, OTC laundering via China',
    lastActivityYear: 2025,
    notes: 'UN Panel: $3B+ stolen 2017-2023; funds WMD programs. Record $1.5B Bybit hack Feb 2025.',
  },
  {
    country: 'Russia',
    iso2: 'RU',
    actor: 'State-Linked OTC Networks',
    cryptoType: 'USDT (TRC-20), BTC',
    estimatedUsdBn: 2.0,
    confidence: 'confirmed',
    method: 'USDT for oil payments, dark-net markets, Garantex exchange (sanctioned), peer-to-peer',
    lastActivityYear: 2024,
    notes: 'Garantex processed $100B+ before 2024 US/EU sanctions; digital ruble parallel track.',
  },
  {
    country: 'Iran',
    iso2: 'IR',
    actor: 'IRGC & State Oil Sector',
    cryptoType: 'BTC, Rial-backed tokens',
    estimatedUsdBn: 1.0,
    confidence: 'high',
    method: 'BTC mining (state-subsidized energy), oil barter via crypto intermediaries',
    lastActivityYear: 2024,
    notes: 'Iran mines ~3% of global BTC using subsidized electricity; uses crypto to purchase imports.',
  },
  {
    country: 'Venezuela',
    iso2: 'VE',
    actor: 'PDVSA / Maduro Government',
    cryptoType: 'Petro (defunct), USDT',
    estimatedUsdBn: 0.2,
    confidence: 'moderate',
    method: 'Oil sales via USDT intermediaries, Petro crypto (failed)',
    lastActivityYear: 2023,
    notes: 'Petro CBDC failed; government uses crypto OTC for sanctions-evading oil sales.',
  },
];

// ── Evasion helpers ────────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<SanctionsEvasionConfidence, string> = {
  confirmed: '#ef4444',
  high:      '#fb923c',
  moderate:  '#facc15',
  suspected: '#60a5fa',
};

const CONFIDENCE_LABELS: Record<SanctionsEvasionConfidence, string> = {
  confirmed: 'Confirmed',
  high:      'High Confidence',
  moderate:  'Moderate',
  suspected: 'Suspected',
};

export function confidenceColor(c: SanctionsEvasionConfidence): string {
  return CONFIDENCE_COLORS[c];
}

export function confidenceLabel(c: SanctionsEvasionConfidence): string {
  return CONFIDENCE_LABELS[c];
}

// ── Risk level helpers ────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, string> = {
  critical: '#ef4444',
  high:     '#fb923c',
  medium:   '#facc15',
  low:      '#4ade80',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

export function riskColor(r: RiskLevel): string {
  return RISK_COLORS[r];
}

export function riskClass(r: RiskLevel): string {
  return `risk-${r}`;
}

export function riskLabel(r: RiskLevel): string {
  return RISK_LABELS[r];
}

// ── Dollar Hegemony Index ─────────────────────────────────────────────────

export interface DollarHegemonyIndex {
  /** 0 = USD collapse, 100 = USD unchallenged dominance */
  score: number;
  trend: DedollarizationTrend;
  components: {
    reserveShareScore: number;
    tradeInvoicingScore: number;
    cbdcThreatScore: number;
    sanctionsEvasionScore: number;
  };
  interpretation: string;
}

/**
 * Compute a composite Dollar Hegemony Index.
 * Score 0-100: higher = stronger USD hegemony.
 */
export function computeDollarHegemonyIndex(
  signals: readonly DedollarizationSignal[],
  cbdcEntries: readonly CbdcEntry[],
  evasionActors: readonly SanctionsEvasionActor[],
): DollarHegemonyIndex {
  // Reserve share (0-30)
  const reserveSignal     = signals.find((s) => s.id === 'usd-fx-reserves');
  const reservePct        = reserveSignal?.currentValuePct ?? 60;
  const reserveShareScore = Math.round((reservePct / 71.5) * 30);

  // Trade invoicing (0-25)
  const acceleratingCount   = signals.filter((s) => s.trend === 'accelerating').length;
  const tradeInvoicingScore = Math.max(0, 25 - acceleratingCount * 4);

  // CBDC cross-border threat (0-25)
  const cbdcThreat      = cbdcEntries.filter(
    (e) => (e.status === 'live-scaling' || e.status === 'piloting') && e.crossBorderPartners.length > 0,
  ).length;
  const cbdcThreatScore = Math.max(0, 25 - cbdcThreat * 4);

  // Sanctions evasion (0-20)
  const confirmedEvasion      = evasionActors.filter((a) => a.confidence === 'confirmed').length;
  const sanctionsEvasionScore = Math.max(0, 20 - confirmedEvasion * 5);

  const score = reserveShareScore + tradeInvoicingScore + cbdcThreatScore + sanctionsEvasionScore;

  const trend: DedollarizationTrend =
    score < 40 ? 'accelerating'
    : score < 60 ? 'stable'
    : 'reversing';

  const interpretation =
    score >= 70
      ? 'USD hegemony intact — challenges remain structural but not acute.'
      : score >= 50
      ? 'USD hegemony under moderate stress — diversification trends real but gradual.'
      : 'USD hegemony significantly eroded — alternative infrastructure maturing.';

  return {
    score,
    trend,
    components: { reserveShareScore, tradeInvoicingScore, cbdcThreatScore, sanctionsEvasionScore },
    interpretation,
  };
}

// ── Render data bundle ────────────────────────────────────────────────────

export interface RenderData {
  cbdcEntries: readonly CbdcEntry[];
  liveCbdcCount: number;
  pilotingCount: number;
  mBridgeParticipants: number;
  dedollarizationSignals: readonly DedollarizationSignal[];
  acceleratingSignalCount: number;
  evasionActors: readonly SanctionsEvasionActor[];
  totalEvasionUsdBn: number;
  dollarHegemonyIndex: DollarHegemonyIndex;
}

export function buildRenderData(
  cbdcEntries: readonly CbdcEntry[],
  signals: readonly DedollarizationSignal[],
  evasionActors: readonly SanctionsEvasionActor[],
): RenderData {
  const liveCbdcCount       = getLiveCBDCs(cbdcEntries).length;
  const pilotingCount       = getByStatus(cbdcEntries, 'piloting').length;
  const mBridgeParticipants = cbdcEntries.filter(
    (e) => e.name.toLowerCase().includes('mbridge') || e.crossBorderPartners.length >= 3,
  ).length;
  const acceleratingSignalCount = signals.filter((s) => s.trend === 'accelerating').length;
  const totalEvasionUsdBn       = evasionActors.reduce((sum, a) => sum + a.estimatedUsdBn, 0);
  const dollarHegemonyIndex     = computeDollarHegemonyIndex(signals, cbdcEntries, evasionActors);

  return {
    cbdcEntries,
    liveCbdcCount,
    pilotingCount,
    mBridgeParticipants,
    dedollarizationSignals: signals,
    acceleratingSignalCount,
    evasionActors,
    totalEvasionUsdBn,
    dollarHegemonyIndex,
  };
}
