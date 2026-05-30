/**
 * disinformation-networks-helpers.ts
 *
 * Pure functions and reference data for DisinformationNetworksPanel.
 * No DOM dependencies — safe to import in unit tests.
 *
 * Covers:
 *   - CIBTakedown / ActiveNetwork / CIBRenderData interfaces
 *   - 10 documented platform takedowns (2022-2024)
 *   - 5 known active coordinated-inauthentic-behaviour networks
 *   - Helper functions: filtering, aggregation, classification, rendering
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CIBSignificance = 'Low' | 'Medium' | 'High' | 'Critical';
export type NetworkStatus   = 'Active' | 'Disrupted' | 'Dismantled';

export interface CIBTakedown {
  id:               string;
  date:             string;          // ISO date string (YYYY-MM-DD)
  platform:         string;
  actor:            string;
  accountsRemoved:  number;
  targetNarrative:  string;
  significance:     CIBSignificance;
  description:      string;
  ongoing:          boolean;
}

export interface ActiveNetwork {
  id:                string;
  name:              string;
  actor:             string;
  platforms:         string[];
  estimatedAccounts: number;
  primaryNarratives: string[];
  status:            NetworkStatus;
}

export interface CIBRenderData {
  takedowns:          CIBTakedown[];
  activeNetworks:     ActiveNetwork[];
  globalCIBIndex:     number;    // composite 0–100
  totalAccountsRemoved: number;
  mostActiveActor:    string;
}

// ── Reference data: 10 documented CIB takedowns 2022–2024 ─────────────────

export const CIB_TAKEDOWNS: CIBTakedown[] = [
  {
    id: 'td-001',
    date: '2024-08-16',
    platform: 'Meta (Facebook/Instagram)',
    actor: 'China (state-linked)',
    accountsRemoved: 7700,
    targetNarrative: 'Pro-China geopolitics, anti-US narratives across 50+ topics',
    significance: 'Critical',
    description:
      'Meta took down the largest ever single Chinese-origin CIB operation — ' +
      'Dragonbridge — spanning 7,700+ accounts across Facebook, Instagram, and ' +
      '15 other platforms. The network pushed pro-Beijing narratives and anti-US ' +
      'content in English and Chinese, targeting audiences globally.',
    ongoing: false,
  },
  {
    id: 'td-002',
    date: '2024-09-04',
    platform: 'Meta (Facebook/Instagram)',
    actor: 'Russia (IRA successor)',
    accountsRemoved: 60000,
    targetNarrative: '2024 US elections, anti-Ukraine sentiment, Western divisions',
    significance: 'Critical',
    description:
      'Meta disrupted a Russian network — successor to the Internet Research Agency ' +
      '— of 60,000+ fake accounts. Operating as Doppelganger, the network impersonated ' +
      'Western media outlets, ran paid ads, and targeted US and European voters ahead ' +
      'of the 2024 US presidential election.',
    ongoing: false,
  },
  {
    id: 'td-003',
    date: '2023-05-22',
    platform: 'Meta (Facebook/Instagram)',
    actor: 'Iran (MOIS-linked)',
    accountsRemoved: 1400,
    targetNarrative: 'Israeli government criticism, US foreign policy, Gaza conflict framing',
    significance: 'High',
    description:
      'Meta removed 1,400 accounts linked to the Iranian Ministry of Intelligence ' +
      'and Security running coordinated influence operations targeting Israeli and US ' +
      'audiences. Networks shared anti-Israel content, amplified protests, and ' +
      'attempted to manipulate discourse around the Israel-Gaza conflict.',
    ongoing: false,
  },
  {
    id: 'td-004',
    date: '2023-12-11',
    platform: 'Meta (Facebook/Instagram)',
    actor: 'Russia',
    accountsRemoved: 4000,
    targetNarrative: 'Anti-Ukraine sentiment, weakening European support for Ukraine',
    significance: 'High',
    description:
      'Meta removed 4,000 Russian-origin accounts running coordinated inauthentic ' +
      'behaviour across Europe. The operation amplified anti-Ukraine narratives, ' +
      'impersonated local activists in Germany, France, and Italy, and attempted ' +
      'to erode public support for continued military aid to Ukraine.',
    ongoing: false,
  },
  {
    id: 'td-005',
    date: '2023-07-31',
    platform: 'Twitter / X',
    actor: 'China (state-linked)',
    accountsRemoved: 900,
    targetNarrative: 'Tibet, Xinjiang human-rights deflection, Taiwan sovereignty',
    significance: 'Medium',
    description:
      'Twitter (now X) suspended 900+ accounts linked to Chinese state actors ' +
      'pushing pro-Beijing narratives on Tibet and Xinjiang. The network used ' +
      'coordinated hashtag amplification to drown out independent reporting ' +
      'and deflect human-rights criticism toward Western countries.',
    ongoing: false,
  },
  {
    id: 'td-006',
    date: '2022-03-29',
    platform: 'Google / YouTube',
    actor: 'Russia',
    accountsRemoved: 1000,
    targetNarrative: 'Pro-Kremlin Ukraine war narratives, anti-NATO framing',
    significance: 'High',
    description:
      'Google terminated 1,000+ YouTube channels in the largest single Russian ' +
      'takedown at the time, following the February 2022 invasion of Ukraine. ' +
      'Channels pushed Kremlin-approved justifications for the invasion and ' +
      'spread anti-NATO disinformation to Russian-speaking audiences worldwide.',
    ongoing: false,
  },
  {
    id: 'td-007',
    date: '2022-06-09',
    platform: 'Meta (Facebook/Instagram)',
    actor: 'Myanmar military (Tatmadaw)',
    accountsRemoved: 0,
    targetNarrative: 'Rohingya community targeting, military propaganda, anti-opposition framing',
    significance: 'High',
    description:
      'Meta imposed ongoing restrictions and coordinated monitoring of Myanmar ' +
      'military-linked networks following the 2021 coup. Thousands of accounts ' +
      'previously removed; residual network detected in 2022 continued pushing ' +
      'ethnic-nationalist framing and discrediting the National Unity Government.',
    ongoing: true,
  },
  {
    id: 'td-008',
    date: '2024-04-05',
    platform: 'TikTok',
    actor: 'China (state-linked)',
    accountsRemoved: 1900,
    targetNarrative: 'Taiwan independence opposition, cross-strait reunification, anti-DPP sentiment',
    significance: 'High',
    description:
      'TikTok removed 1,900+ accounts in a coordinated network targeting Taiwanese ' +
      'users ahead of the January 2024 Taiwan presidential election. The network ' +
      'amplified pro-unification content, discredited the Democratic Progressive ' +
      'Party, and pushed narratives favourable to cross-strait reunification.',
    ongoing: false,
  },
  {
    id: 'td-009',
    date: '2024-02-19',
    platform: 'Meta (Facebook/Instagram)',
    actor: 'Bangladesh (domestic actors)',
    accountsRemoved: 1300,
    targetNarrative: 'Domestic political opposition discrediting, pro-Awami League amplification',
    significance: 'Medium',
    description:
      'Meta removed a Bangladesh-origin influence network of 1,300 accounts ' +
      'running coordinated domestic political operations. The network impersonated ' +
      'journalists, created fake news sites, and amplified pro-government narratives ' +
      'while attacking opposition politicians ahead of January 2024 elections.',
    ongoing: false,
  },
  {
    id: 'td-010',
    date: '2024-07-22',
    platform: 'X (Twitter) — EU DSA Enforcement',
    actor: 'Russia',
    accountsRemoved: 2800,
    targetNarrative: 'Russia-Ukraine war framing, EU unity erosion, anti-sanctions messaging',
    significance: 'High',
    description:
      'EU Digital Services Act enforcement action compelled X to address 2,800+ ' +
      'Russian-state-linked accounts spreading disinformation about the Ukraine ' +
      'conflict. Separate from voluntary takedowns, this marked the first binding ' +
      'DSA enforcement related to state-actor influence operations.',
    ongoing: false,
  },
];

// ── Reference data: 5 known active CIB networks ───────────────────────────

export const ACTIVE_NETWORKS: ActiveNetwork[] = [
  {
    id: 'net-001',
    name: 'Doppelganger / IRA Successor Network',
    actor: 'Russia',
    platforms: ['Facebook', 'Instagram', 'X', 'Telegram', 'YouTube'],
    estimatedAccounts: 50000,
    primaryNarratives: [
      'Western policy failure narratives',
      'NATO dissolution advocacy',
      'Ukraine-fatigue amplification',
      'US electoral interference claims',
    ],
    status: 'Active',
  },
  {
    id: 'net-002',
    name: 'Dragonbridge (SpamouflageNetwork)',
    actor: 'China (state-linked)',
    platforms: ['Facebook', 'Instagram', 'YouTube', 'TikTok', 'X', 'Reddit', 'Medium'],
    estimatedAccounts: 9000,
    primaryNarratives: [
      'Pro-CCP global governance framing',
      'Anti-US foreign policy content',
      'Taiwan re-unification narratives',
      'Xinjiang / Tibet deflection',
    ],
    status: 'Disrupted',
  },
  {
    id: 'net-003',
    name: 'Iranian MOIS Influence Network',
    actor: 'Iran (MOIS-linked)',
    platforms: ['Facebook', 'Instagram', 'X', 'Telegram'],
    estimatedAccounts: 3500,
    primaryNarratives: [
      'Anti-Israel content amplification',
      'US foreign policy criticism',
      'Pro-resistance axis framing',
      'Gaza conflict disinformation',
    ],
    status: 'Active',
  },
  {
    id: 'net-004',
    name: '50-Cent Army (Wumao) Digital Operations',
    actor: 'China (state-linked)',
    platforms: ['Weibo', 'WeChat', 'X', 'Facebook', 'YouTube'],
    estimatedAccounts: 2000000,
    primaryNarratives: [
      'Domestic dissent suppression',
      'CCP legitimacy reinforcement',
      'International image management',
      'COVID-19 origin deflection',
    ],
    status: 'Active',
  },
  {
    id: 'net-005',
    name: 'North Korean Narrative Operations',
    actor: 'DPRK (state-linked)',
    platforms: ['X', 'Facebook', 'YouTube', 'LinkedIn'],
    estimatedAccounts: 1200,
    primaryNarratives: [
      'Kim regime legitimacy',
      'US-Korea military exercise opposition',
      'Cryptocurrency / sanctions evasion framing',
      'DPRK economic success narratives',
    ],
    status: 'Active',
  },
];

// ── Pure helpers ──────────────────────────────────────────────────────────

/** Numeric rank for sorting by significance (higher = more significant). */
export function significanceRank(sig: CIBSignificance): number {
  switch (sig) {
    case 'Critical': return 4;
    case 'High':     return 3;
    case 'Medium':   return 2;
    case 'Low':      return 1;
  }
}

/** CSS colour for significance level. */
export function significanceColor(sig: CIBSignificance): string {
  switch (sig) {
    case 'Critical': return '#ef4444';
    case 'High':     return '#f97316';
    case 'Medium':   return '#eab308';
    case 'Low':      return '#4caf50';
  }
}

/** CSS colour for network operational status. */
export function statusColor(status: NetworkStatus): string {
  switch (status) {
    case 'Active':     return '#ef4444';
    case 'Disrupted':  return '#f97316';
    case 'Dismantled': return '#4caf50';
  }
}

/** Format an account count for display (e.g. 7000 → 7,000). */
export function formatAccountCount(n: number): string {
  if (n <= 0) return 'N/A';
  return n.toLocaleString('en-US');
}

/** Scale classification for a network by estimated account count. */
export function networkScaleClass(
  estimatedAccounts: number,
): 'small' | 'medium' | 'large' | 'massive' {
  if (estimatedAccounts >= 100_000) return 'massive';
  if (estimatedAccounts >= 10_000)  return 'large';
  if (estimatedAccounts >= 1_000)   return 'medium';
  return 'small';
}

/** Classify the actor type from actor string. */
export function actorClass(actor: string): 'state' | 'unknown' {
  const statePhrases = [
    'russia', 'china', 'iran', 'dprk', 'north korea',
    'myanmar', 'bangladesh', 'state-linked', 'mois', 'tatmadaw',
  ];
  const lower = actor.toLowerCase();
  return statePhrases.some((p) => lower.includes(p)) ? 'state' : 'unknown';
}

/** Filter takedowns to those from a specific actor (case-insensitive substring). */
export function getByActor(
  takedowns: CIBTakedown[],
  actor: string,
): CIBTakedown[] {
  const lower = actor.toLowerCase();
  return takedowns.filter((t) => t.actor.toLowerCase().includes(lower));
}

/** Filter networks with estimated account count above threshold (default 1 000). */
export function getLargeNetworks(
  networks: ActiveNetwork[],
  threshold = 1_000,
): ActiveNetwork[] {
  return networks.filter((n) => n.estimatedAccounts > threshold);
}

/** Filter networks that are currently Active. */
export function getActiveNetworks(networks: ActiveNetwork[]): ActiveNetwork[] {
  return networks.filter((n) => n.status === 'Active');
}

/**
 * Filter takedowns whose targetNarrative contains the given keyword
 * (case-insensitive).
 */
export function getByTargetNarrative(
  takedowns: CIBTakedown[],
  keyword: string,
): CIBTakedown[] {
  const lower = keyword.toLowerCase();
  return takedowns.filter((t) => t.targetNarrative.toLowerCase().includes(lower));
}

/** Return the actor with the most takedowns in the dataset. */
export function mostActiveActor(takedowns: CIBTakedown[]): string {
  if (takedowns.length === 0) return 'Unknown';
  const counts = new Map<string, number>();
  for (const t of takedowns) {
    counts.set(t.actor, (counts.get(t.actor) ?? 0) + 1);
  }
  let topActor = '';
  let topCount = 0;
  for (const [actor, count] of counts) {
    if (count > topCount) { topCount = count; topActor = actor; }
  }
  return topActor;
}

/** Sum all accountsRemoved across takedowns. */
export function totalAccountsRemoved(takedowns: CIBTakedown[]): number {
  return takedowns.reduce((sum, t) => sum + t.accountsRemoved, 0);
}

/**
 * Compute a composite Global CIB Index (0–100).
 *
 * Formula weighs:
 *   - Fraction of Critical/High takedowns (50 pts)
 *   - Number of Active networks / total networks (30 pts)
 *   - Normalised total accounts removed (20 pts, cap at 100k)
 */
export function computeGlobalCIBIndex(
  takedowns: CIBTakedown[],
  activeNets: ActiveNetwork[],
): number {
  if (takedowns.length === 0) return 0;

  // Severity score (0–50)
  const highPlusCrit = takedowns.filter(
    (t) => t.significance === 'High' || t.significance === 'Critical',
  ).length;
  const severityScore = (highPlusCrit / takedowns.length) * 50;

  // Active network score (0–30)
  const activeCount = getActiveNetworks(activeNets).length;
  const networkScore = activeNets.length > 0
    ? (activeCount / activeNets.length) * 30
    : 0;

  // Volume score (0–20), capped at 100k accounts
  const total = totalAccountsRemoved(takedowns);
  const volumeScore = Math.min(total / 100_000, 1) * 20;

  return Math.min(100, Math.round(severityScore + networkScore + volumeScore));
}

/** Assemble a CIBRenderData snapshot from the canonical datasets. */
export function buildRenderData(
  takedowns: CIBTakedown[],
  activeNetworks: ActiveNetwork[],
): CIBRenderData {
  return {
    takedowns: [...takedowns].sort(
      (a, b) => significanceRank(b.significance) - significanceRank(a.significance),
    ),
    activeNetworks,
    globalCIBIndex:     computeGlobalCIBIndex(takedowns, activeNetworks),
    totalAccountsRemoved: totalAccountsRemoved(takedowns),
    mostActiveActor:    mostActiveActor(takedowns),
  };
}
