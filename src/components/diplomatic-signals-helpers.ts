/**
 * Diplomatic Signals — pure helpers (no DOM, no fetch, no globals).
 *
 * Diplomatic signals are the non-verbal language of statecraft — expulsions,
 * recalls, joint statements, visits, and trade actions are read by intelligence
 * services to detect relationship shifts before they become public crises.
 *
 * A static, fixture-tested model of 15 recent signals (2022-2024) and 10 key
 * bilateral relationships. The panel layer (DiplomaticSignalsPanel.ts) renders
 * the output of buildRenderData(); every function here is input-output pure so
 * it can be unit-tested with the static fixtures below.
 */

export type SignalType =
  | 'ambassador-recall' // recalling ambassador for consultations
  | 'expulsion' // expelling diplomats
  | 'embassy-closure' // closing or suspending embassy
  | 'visa-restriction' // imposing visa bans
  | 'state-visit' // high-level state visit (warming signal)
  | 'joint-statement' // issuing joint statement (alignment signal)
  | 'hotline-established' // establishing direct communication line (de-escalation)
  | 'sanctions-waiver' // granting sanctions relief (warming)
  | 'trade-suspension' // suspending trade (cooling)
  | 'military-attache-expulsion'; // expelling military attache (escalation)

export type SignalSentiment = 'escalatory' | 'cooling' | 'warming' | 'neutral';

export interface DiplomaticSignal {
  id: string;
  date: string; // YYYY-MM
  initiatingCountry: string;
  targetCountry: string;
  signalType: SignalType;
  sentiment: SignalSentiment;
  intensity: 'critical' | 'high' | 'medium' | 'low'; // diplomatic weight
  context: string;
  bilateralRelationship: 'hostile' | 'tense' | 'neutral' | 'cooperative' | 'allied';
  notes: string;
}

export interface BilateralRelationship {
  id: string;
  country1: string;
  country2: string;
  currentStatus: 'hostile' | 'tense' | 'neutral' | 'cooperative' | 'allied';
  trend: 'deteriorating' | 'stable' | 'improving';
  keyTensions: string[];
  recentSignalsCount: number;
  latestSignalDate: string;
  relationshipScore: number; // -100 (hostile) to +100 (allied)
}

export interface DiplomaticSignalsData {
  signals: DiplomaticSignal[];
  relationships: BilateralRelationship[];
  lastUpdated: string;
  globalDiplomaticTensionIndex: number; // 0-100
}

export const DIPLOMATIC_SIGNALS: DiplomaticSignal[] = [
  {
    id: 'russia-uk-expulsion-2023',
    date: '2023-03',
    initiatingCountry: 'United Kingdom',
    targetCountry: 'Russia',
    signalType: 'expulsion',
    sentiment: 'escalatory',
    intensity: 'high',
    context:
      'UK expelled 23 Russian diplomats following Salisbury assassination attempt follow-up investigations',
    bilateralRelationship: 'hostile',
    notes: 'Part of ongoing diplomatic degradation post-Salisbury and Ukraine invasion',
  },
  {
    id: 'china-us-hotline-2023',
    date: '2023-11',
    initiatingCountry: 'United States',
    targetCountry: 'China',
    signalType: 'hotline-established',
    sentiment: 'warming',
    intensity: 'medium',
    context:
      'Biden-Xi Woodside summit; military hotline re-established after China suspended it following Pelosi Taiwan visit',
    bilateralRelationship: 'tense',
    notes: 'Positive signal after Taiwan Strait tensions; POTUS-Xi call hotline and mil-mil channels restored',
  },
  {
    id: 'saudi-iran-embassy-2023',
    date: '2023-06',
    initiatingCountry: 'Saudi Arabia',
    targetCountry: 'Iran',
    signalType: 'state-visit',
    sentiment: 'warming',
    intensity: 'critical',
    context:
      'Saudi Arabia and Iran reopen embassies after 7-year diplomatic rupture, brokered by China in March 2023',
    bilateralRelationship: 'neutral',
    notes: 'China-brokered normalization; major Middle East realignment; Houthi conflict complicates',
  },
  {
    id: 'sweden-nato-accession',
    date: '2024-03',
    initiatingCountry: 'Sweden',
    targetCountry: 'Turkey',
    signalType: 'joint-statement',
    sentiment: 'warming',
    intensity: 'critical',
    context:
      "Turkey ratifies Swedish NATO accession after 20 months; Sweden agreed to support Turkey's EU bid and extradition requests",
    bilateralRelationship: 'cooperative',
    notes: 'Ended last obstacle to Swedish NATO membership; Hungary had already ratified Feb 2024',
  },
  {
    id: 'niger-usa-base-2024',
    date: '2024-03',
    initiatingCountry: 'Niger',
    targetCountry: 'United States',
    signalType: 'embassy-closure',
    sentiment: 'escalatory',
    intensity: 'critical',
    context:
      'Niger junta ordered US military to vacate Agadez drone base (Air Base 201); revoked access agreement',
    bilateralRelationship: 'tense',
    notes: 'Immediate aftermath: US moved some assets to Chad; Russia/Wagner filling security vacuum',
  },
  {
    id: 'india-canada-expulsion-2023',
    date: '2023-10',
    initiatingCountry: 'India',
    targetCountry: 'Canada',
    signalType: 'expulsion',
    sentiment: 'escalatory',
    intensity: 'critical',
    context:
      'India ordered Canada to remove 40 diplomats after Trudeau accused India of involvement in killing of Sikh activist Hardeep Singh Nijjar in Canada',
    bilateralRelationship: 'tense',
    notes: 'Unprecedented diplomatic crisis between India and Five Eyes member; India denied involvement',
  },
  {
    id: 'taiwan-diplomatic-switches-2023',
    date: '2023-03',
    initiatingCountry: 'Honduras',
    targetCountry: 'Taiwan',
    signalType: 'embassy-closure',
    sentiment: 'escalatory',
    intensity: 'high',
    context:
      "Honduras switched recognition from Taiwan to China, reducing Taiwan's formal allies to 12",
    bilateralRelationship: 'hostile',
    notes: 'China-Honduras economic inducements prevailed; Taiwan retains only 12 formal diplomatic allies',
  },
  {
    id: 'us-china-sanctions-2024',
    date: '2024-02',
    initiatingCountry: 'United States',
    targetCountry: 'China',
    signalType: 'sanctions-waiver',
    sentiment: 'cooling',
    intensity: 'medium',
    context:
      'US Treasury issued licenses exempting certain Chinese semiconductor firms from full sanctions to avoid supply chain disruption',
    bilateralRelationship: 'tense',
    notes: 'Tactical de-escalation within broader chip war; pragmatic carve-outs for legacy nodes',
  },
  {
    id: 'russia-germany-recall-2022',
    date: '2022-04',
    initiatingCountry: 'Germany',
    targetCountry: 'Russia',
    signalType: 'ambassador-recall',
    sentiment: 'escalatory',
    intensity: 'high',
    context:
      'Germany recalled ambassador following Bucha massacre revelations; all major EU states did similar',
    bilateralRelationship: 'hostile',
    notes: 'Post-Bucha diplomatic break; ambassador later returned at lower level',
  },
  {
    id: 'china-philippines-confrontation-2024',
    date: '2024-02',
    initiatingCountry: 'Philippines',
    targetCountry: 'China',
    signalType: 'ambassador-recall',
    sentiment: 'escalatory',
    intensity: 'high',
    context:
      'Philippines recalled ambassador for consultations after Chinese coast guard water cannon attacks on Philippine supply vessels at Second Thomas Shoal',
    bilateralRelationship: 'tense',
    notes: 'South China Sea flashpoint; US treaty obligations triggered consultations; multiple incidents monthly',
  },
  {
    id: 'israel-turkey-ambassador-2024',
    date: '2024-05',
    initiatingCountry: 'Turkey',
    targetCountry: 'Israel',
    signalType: 'trade-suspension',
    sentiment: 'escalatory',
    intensity: 'critical',
    context:
      'Turkey halted all trade with Israel over Gaza, citing humanitarian concerns; bilateral trade was $7B annually',
    bilateralRelationship: 'hostile',
    notes: 'Erdogan positioned as Arab world advocate; Turkey-Israel normalization (2022) fully reversed',
  },
  {
    id: 'us-iran-prisoner-swap-2023',
    date: '2023-09',
    initiatingCountry: 'United States',
    targetCountry: 'Iran',
    signalType: 'sanctions-waiver',
    sentiment: 'warming',
    intensity: 'medium',
    context:
      '$6B Iranian assets unfrozen in Qatar in exchange for 5 American prisoners; deal brokered via Oman',
    bilateralRelationship: 'hostile',
    notes: 'Limited humanitarian deal; assets subsequently re-frozen after Oct 7; fragile back-channel',
  },
  {
    id: 'china-russia-joint-2023',
    date: '2023-03',
    initiatingCountry: 'China',
    targetCountry: 'Russia',
    signalType: 'joint-statement',
    sentiment: 'warming',
    intensity: 'critical',
    context:
      'Xi Jinping state visit to Moscow; joint statement on "no limits partnership" and multipolar world order; 12-point peace plan for Ukraine',
    bilateralRelationship: 'allied',
    notes: 'Deepened strategic alignment; Xi 3rd term consolidating Russia relationship; West concerned about arms transfers',
  },
  {
    id: 'australia-china-thaw-2023',
    date: '2023-11',
    initiatingCountry: 'Australia',
    targetCountry: 'China',
    signalType: 'state-visit',
    sentiment: 'warming',
    intensity: 'critical',
    context:
      'PM Albanese visited Beijing — first Australian PM visit in 7 years; trade bans on barley/wine lifted; Coal ban under negotiation',
    bilateralRelationship: 'cooperative',
    notes: 'Full diplomatic rehabilitation after Morrison era tensions; AUKUS not discussed; economic ties normalizing',
  },
  {
    id: 'venezuela-us-oil-waiver-2023',
    date: '2023-10',
    initiatingCountry: 'United States',
    targetCountry: 'Venezuela',
    signalType: 'sanctions-waiver',
    sentiment: 'warming',
    intensity: 'medium',
    context:
      'US granted 6-month oil sanctions waiver after Maduro agreed to hold credible elections; revoked when conditions unmet',
    bilateralRelationship: 'tense',
    notes: 'Carrot-and-stick on democratic conditions; Maduro claimed 2024 election victory despite evidence of fraud; waiver revoked',
  },
];

export const BILATERAL_RELATIONSHIPS: BilateralRelationship[] = [
  {
    id: 'us-china',
    country1: 'United States',
    country2: 'China',
    currentStatus: 'tense',
    trend: 'stable',
    keyTensions: [
      'Taiwan independence',
      'South China Sea',
      'Technology export controls',
      'Trade deficit',
      'Human rights (Xinjiang/Hong Kong)',
    ],
    recentSignalsCount: 8,
    latestSignalDate: '2024-04',
    relationshipScore: -40,
  },
  {
    id: 'russia-west',
    country1: 'Russia',
    country2: 'Western Alliance (EU/NATO)',
    currentStatus: 'hostile',
    trend: 'stable',
    keyTensions: [
      'Ukraine war',
      'Energy cutoff',
      'Sanctions regime',
      'Nuclear threats',
      'Cyberattacks',
    ],
    recentSignalsCount: 25,
    latestSignalDate: '2024-05',
    relationshipScore: -85,
  },
  {
    id: 'india-pakistan',
    country1: 'India',
    country2: 'Pakistan',
    currentStatus: 'hostile',
    trend: 'stable',
    keyTensions: [
      'Kashmir dispute',
      'Cross-border terrorism',
      'Nuclear rivalry',
      'Water rights (Indus)',
      'LOC violations',
    ],
    recentSignalsCount: 6,
    latestSignalDate: '2024-03',
    relationshipScore: -70,
  },
  {
    id: 'saudi-iran',
    country1: 'Saudi Arabia',
    country2: 'Iran',
    currentStatus: 'neutral',
    trend: 'improving',
    keyTensions: [
      'Yemen proxy war (Houthis)',
      'Regional influence',
      'Sectarian divide',
      'Oil production competition',
    ],
    recentSignalsCount: 5,
    latestSignalDate: '2024-04',
    relationshipScore: -10,
  },
  {
    id: 'usa-israel',
    country1: 'United States',
    country2: 'Israel',
    currentStatus: 'allied',
    trend: 'deteriorating',
    keyTensions: [
      'Gaza civilian casualties',
      'Two-state solution',
      'Settlement expansion',
      'Rafah offensive disagreements',
    ],
    recentSignalsCount: 7,
    latestSignalDate: '2024-05',
    relationshipScore: 60,
  },
  {
    id: 'china-russia',
    country1: 'China',
    country2: 'Russia',
    currentStatus: 'allied',
    trend: 'stable',
    keyTensions: [
      'Historical border disputes (settled)',
      'Central Asia influence',
      'Energy pricing',
      'Technology dependency imbalance',
    ],
    recentSignalsCount: 4,
    latestSignalDate: '2024-03',
    relationshipScore: 75,
  },
  {
    id: 'india-canada',
    country1: 'India',
    country2: 'Canada',
    currentStatus: 'tense',
    trend: 'deteriorating',
    keyTensions: [
      'Sikh separatist groups',
      'Assassination allegations',
      'Diplomatic expulsions',
      'Trade negotiations stalled',
    ],
    recentSignalsCount: 4,
    latestSignalDate: '2024-02',
    relationshipScore: -30,
  },
  {
    id: 'turkey-west',
    country1: 'Turkey',
    country2: 'Western Alliance (EU/NATO)',
    currentStatus: 'tense',
    trend: 'stable',
    keyTensions: [
      'NATO expansion veto leverage',
      'F-16 sales conditions',
      'S-400 purchase',
      'Erdogan democratic backsliding',
    ],
    recentSignalsCount: 5,
    latestSignalDate: '2024-04',
    relationshipScore: -15,
  },
  {
    id: 'china-philippines',
    country1: 'China',
    country2: 'Philippines',
    currentStatus: 'tense',
    trend: 'deteriorating',
    keyTensions: [
      'South China Sea (Second Thomas Shoal)',
      'Exclusive Economic Zone incursions',
      'Fishing fleet harassment',
      'US-Philippines alliance',
    ],
    recentSignalsCount: 7,
    latestSignalDate: '2024-05',
    relationshipScore: -45,
  },
  {
    id: 'australia-china',
    country1: 'Australia',
    country2: 'China',
    currentStatus: 'cooperative',
    trend: 'improving',
    keyTensions: [
      'AUKUS nuclear submarines',
      'Huawei 5G exclusion',
      'Trade war legacy (coal/wine)',
      'Five Eyes intelligence sharing',
    ],
    recentSignalsCount: 3,
    latestSignalDate: '2024-01',
    relationshipScore: 20,
  },
];

const INTENSITY_WEIGHT: Record<DiplomaticSignal['intensity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const STATUS_TENSION_WEIGHT: Record<BilateralRelationship['currentStatus'], number> = {
  hostile: 4,
  tense: 3,
  neutral: 2,
  cooperative: 1,
  allied: 0,
};

const SENTIMENT_CLASS: Record<SignalSentiment, string> = {
  escalatory: 'sentiment-escalatory',
  cooling: 'sentiment-cooling',
  warming: 'sentiment-warming',
  neutral: 'sentiment-neutral',
};

const INTENSITY_CLASS: Record<DiplomaticSignal['intensity'], string> = {
  critical: 'severity-critical',
  high: 'severity-high',
  medium: 'severity-medium',
  low: 'severity-low',
};

const RELATIONSHIP_STATUS_CLASS: Record<BilateralRelationship['currentStatus'], string> = {
  hostile: 'status-hostile',
  tense: 'status-tense',
  neutral: 'status-neutral',
  cooperative: 'status-cooperative',
  allied: 'status-allied',
};

export function getBySignalType(
  signals: DiplomaticSignal[],
  type: SignalType,
): DiplomaticSignal[] {
  return signals.filter((s) => s.signalType === type);
}

export function getEscalatorySignals(signals: DiplomaticSignal[]): DiplomaticSignal[] {
  return signals.filter((s) => s.sentiment === 'escalatory');
}

export function getWarmingSignals(signals: DiplomaticSignal[]): DiplomaticSignal[] {
  return signals.filter((s) => s.sentiment === 'warming');
}

export function getByCountry(signals: DiplomaticSignal[], country: string): DiplomaticSignal[] {
  return signals.filter(
    (s) => s.initiatingCountry === country || s.targetCountry === country,
  );
}

export function getHostileRelationships(
  rels: BilateralRelationship[],
): BilateralRelationship[] {
  return rels.filter((r) => r.currentStatus === 'hostile');
}

export function getDeterioratingRelationships(
  rels: BilateralRelationship[],
): BilateralRelationship[] {
  return rels.filter((r) => r.trend === 'deteriorating');
}

export function computeGlobalDiplomaticTensionIndex(
  signals: DiplomaticSignal[],
  rels: BilateralRelationship[],
): number {
  if (signals.length === 0 && rels.length === 0) return 0;

  let relScore = 0;
  for (const r of rels) {
    let w = STATUS_TENSION_WEIGHT[r.currentStatus];
    if (r.trend === 'deteriorating') w = Math.min(4, w + 1);
    relScore += w;
  }
  const relMax = rels.length * 4;
  const relNorm = relMax === 0 ? 0 : relScore / relMax;

  let sigScore = 0;
  for (const s of signals) {
    if (s.sentiment === 'escalatory') sigScore += INTENSITY_WEIGHT[s.intensity];
  }
  const sigMax = signals.length * 4;
  const sigNorm = sigMax === 0 ? 0 : sigScore / sigMax;

  let combined: number;
  if (rels.length === 0) combined = sigNorm;
  else if (signals.length === 0) combined = relNorm;
  else combined = relNorm * 0.6 + sigNorm * 0.4;

  return Math.max(0, Math.min(100, Math.round(combined * 100)));
}

export function sentimentClass(sentiment: SignalSentiment): string {
  return SENTIMENT_CLASS[sentiment];
}

export function intensityClass(intensity: DiplomaticSignal['intensity']): string {
  return INTENSITY_CLASS[intensity];
}

export function relationshipStatusClass(
  status: BilateralRelationship['currentStatus'],
): string {
  return RELATIONSHIP_STATUS_CLASS[status];
}

export function buildRenderData(): DiplomaticSignalsData {
  return {
    signals: [...DIPLOMATIC_SIGNALS],
    relationships: [...BILATERAL_RELATIONSHIPS],
    lastUpdated: '2024-Q2',
    globalDiplomaticTensionIndex: computeGlobalDiplomaticTensionIndex(
      DIPLOMATIC_SIGNALS,
      BILATERAL_RELATIONSHIPS,
    ),
  };
}
