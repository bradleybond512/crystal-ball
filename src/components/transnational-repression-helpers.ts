// transnational-repression-helpers.ts
// Pure logic for TransnationalRepressionPanel — no DOM, no Panel imports

export type RepressionMethod =
  | 'Physical Assassination'
  | 'Poisoning'
  | 'Rendition'
  | 'Interpol Abuse'
  | 'Digital Surveillance'
  | 'Pegasus Spyware'
  | 'Harassment Campaign'
  | 'Family Coercion'
  | 'Forced Disappearance'
  | 'Forced Plane Landing';

export type RepressionSeverity = 'Critical' | 'High' | 'Medium' | 'Low';

export type ActorTier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export interface RepressionIncident {
  id: string;
  date: string;
  actor: string;
  target: string;
  location: string;
  method: RepressionMethod;
  description: string;
  outcome: string;
  severity: number; // 1-10
  verified: boolean;
  sources: string[];
}

export interface ActorProfile {
  id: string;
  country: string;
  tier: ActorTier;
  reintensityScore: number; // 0-100 transnational repression intensity
  knownMethods: RepressionMethod[];
  freedomHouseRating: string;
  operationalReach: string[];
  keyInstruments: string[];
  incidentCount: number;
  trend: 'escalating' | 'stable' | 'declining';
}

export interface TransnationalRepressionRenderData {
  incidents: RepressionIncident[];
  actors: ActorProfile[];
  globalRepressionIndex: number; // 0-100
  criticalCount: number;
  highCount: number;
  activeActorCount: number;
  mostActiveActors: ActorProfile[];
  recentIncidents: RepressionIncident[];
}

// ── Data ──────────────────────────────────────────────────────────────────────

const INCIDENTS: RepressionIncident[] = [
  {
    id: 'TR001',
    date: '2018-10-02',
    actor: 'Saudi Arabia',
    target: 'Jamal Khashoggi (journalist, Washington Post)',
    location: 'Istanbul, Turkey',
    method: 'Physical Assassination',
    description:
      'Saudi journalist and Washington Post columnist lured to Saudi consulate in Istanbul and murdered by a 15-member Saudi intelligence team. US intelligence assessed Crown Prince Mohammed bin Salman ordered the operation. Body dismembered; remains never returned.',
    outcome:
      'Victim killed. Several operatives convicted in Saudi courts; no senior officials prosecuted. MBS faced no personal legal consequences.',
    severity: 10,
    verified: true,
    sources: ['CIA assessment (2021)', 'UN Special Rapporteur report', 'Turkish prosecution'],
  },
  {
    id: 'TR002',
    date: '2018-03-04',
    actor: 'Russia',
    target: 'Sergei Skripal (ex-GRU double agent) & daughter Yulia',
    location: 'Salisbury, United Kingdom',
    method: 'Poisoning',
    description:
      'GRU officers Anatoly Chepiga and Alexander Mishkin deployed Novichok nerve agent against former Russian intelligence officer Sergei Skripal in Salisbury, England. UK police officer Dawn Sturgess died from secondary exposure in July 2018.',
    outcome:
      'Skripal and daughter survived; bystander Dawn Sturgess killed. UK expelled 23 Russian diplomats. GRU operatives identified by Bellingcat but not extradited.',
    severity: 9,
    verified: true,
    sources: ['UK Crown Prosecution Service', 'Bellingcat investigation', 'OPCW verification'],
  },
  {
    id: 'TR003',
    date: '2020-08-20',
    actor: 'Russia',
    target: 'Alexei Navalny (opposition leader)',
    location: 'Siberia / Germany',
    method: 'Poisoning',
    description:
      "FSB operatives poisoned opposition leader Alexei Navalny with Novichok on a flight from Tomsk; Navalny evacuated to Germany where Novichok was confirmed. Navalny returned to Russia and was imprisoned. Died in Arctic penal colony IK-6 'Polar Wolf' on February 16, 2024.",
    outcome:
      'Navalny survived initial poisoning but died in prison Feb 16, 2024. Bellingcat identified FSB operatives. No prosecutions in Russia.',
    severity: 10,
    verified: true,
    sources: ['OPCW confirmation', 'Bellingcat investigation', 'German BfV assessment', 'US sanctions (E.O. 13661)'],
  },
  {
    id: 'TR004',
    date: '2019-08-23',
    actor: 'Russia',
    target: 'Zelimkhan Khangoshvili (Georgian-Chechen dissident)',
    location: 'Berlin, Germany',
    method: 'Physical Assassination',
    description:
      'GRU officer Vadim Krasikov shot dead Chechen dissident Zelimkhan Khangoshvili in Tiergarten park, Berlin. German court convicted Krasikov of murder in 2021. He was exchanged for Wall Street Journal reporter Evan Gershkovich in August 2024 prisoner swap.',
    outcome:
      'Victim killed. Krasikov convicted (life sentence), then exchanged in prisoner swap Aug 2024. Germany expelled two Russian diplomats.',
    severity: 9,
    verified: true,
    sources: ['Berlin court verdict (2021)', 'BfV investigation', 'German federal prosecutor'],
  },
  {
    id: 'TR005',
    date: '2022-01-01',
    actor: 'China',
    target: 'Chinese diaspora (Fox Hunt / Sky Net operations)',
    location: 'United States, Europe, Canada, Australia',
    method: 'Harassment Campaign',
    description:
      "FBI documented PRC 'Operation Fox Hunt' and 'Sky Net' covert operations targeting Chinese nationals abroad: sending agents to intimidate, threaten family members in China, and pressure targets to return. FBI Director Wray called it one of the most significant national security threats. 50+ clandestine Chinese police service stations discovered in 53 countries by 2022.",
    outcome:
      'Multiple FBI arrests of PRC agents in US. DOJ indicted Chinese officials in 2022. Netherlands, UK, Ireland, Canada closed PRC stations. Operations ongoing.',
    severity: 8,
    verified: true,
    sources: ['FBI Director testimony (2022)', 'DOJ indictments', 'Safeguard Defenders NGO report (2022)'],
  },
  {
    id: 'TR006',
    date: '2022-09-01',
    actor: 'Iran',
    target: 'US-based Iranian dissidents and ex-officials',
    location: 'United States',
    method: 'Physical Assassination',
    description:
      'DOJ and FBI uncovered multiple IRGC-linked plots to assassinate or kidnap US-based Iranians and former US officials, including former NSA John Bolton and ex-Secretary of State Mike Pompeo. Shahram Poursafi (IRGC officer) arrested for hiring a hitman to kill Bolton for $300,000. Multiple additional plots against journalists and dual citizens documented 2022-2024.',
    outcome:
      'Multiple plots disrupted by FBI. Poursafi indicted; remained in Iran. Multiple Iranian agents arrested or charged.',
    severity: 9,
    verified: true,
    sources: ['DOJ indictments (2022-2024)', 'FBI press releases', 'US Treasury IRGC designations'],
  },
  {
    id: 'TR007',
    date: '2020-09-26',
    actor: 'Rwanda',
    target: 'Paul Rusesabagina (Hotel Rwanda hero, government critic)',
    location: 'Dubai, UAE to Kigali, Rwanda',
    method: 'Rendition',
    description:
      'Paul Rusesabagina, a Belgian-US permanent resident and critic of President Kagame, was lured onto a private jet in Dubai under false pretenses and flown to Kigali without his knowledge or consent. Tried on terrorism charges and sentenced to 25 years. Released May 2023 after diplomatic pressure from Belgium and US.',
    outcome:
      'Rusesabagina held 3 years, convicted in controversial trial, released 2023. International human rights bodies condemned rendition.',
    severity: 8,
    verified: true,
    sources: ['Amnesty International', 'Human Rights Watch', 'US State Department', 'Belgian foreign ministry'],
  },
  {
    id: 'TR008',
    date: '2021-05-23',
    actor: 'Belarus',
    target: 'Roman Protasevich (journalist, opposition blogger)',
    location: 'Minsk airspace (Athens-Vilnius Ryanair FR4978)',
    method: 'Forced Plane Landing',
    description:
      'Belarusian authorities scrambled a MiG-29 fighter jet and issued a false bomb threat to force a Ryanair passenger aircraft to divert and land in Minsk. Opposition journalist Roman Protasevich and his Russian girlfriend Sofia Sapega were arrested. First confirmed instance of state air piracy against a civilian commercial aircraft to capture a dissident.',
    outcome:
      'Protasevich and Sapega arrested. EU and US imposed sweeping sanctions on Belarus. ICAO condemned action. Protasevich received suspended sentence; Sapega released 2023.',
    severity: 9,
    verified: true,
    sources: ['ICAO investigation', 'EU Council sanctions decisions', 'Ryanair incident report'],
  },
  {
    id: 'TR009',
    date: '2021-07-18',
    actor: 'UAE',
    target: 'Journalists, activists, and dissidents across 50+ countries',
    location: 'Multiple countries globally',
    method: 'Pegasus Spyware',
    description:
      "NSO Group's Pegasus spyware, sold to UAE, Saudi Arabia, Morocco and other states, was used to surveil journalists, activists, and opposition figures. Amnesty Tech and Forbidden Stories' Pegasus Project (2021) confirmed targeting of over 50,000 phone numbers. Includes Al Jazeera journalists, Arab Spring activists, and political opponents of Gulf states.",
    outcome:
      'NSO Group blacklisted by US Commerce Dept (2021). Apple sued NSO. Targets across 50+ countries confirmed. Multiple lawsuits ongoing.',
    severity: 8,
    verified: true,
    sources: ['Amnesty International Tech Lab', 'Citizen Lab reports', 'Forbidden Stories Pegasus Project (2021)'],
  },
  {
    id: 'TR010',
    date: '2019-01-01',
    actor: 'Turkey',
    target: 'Gulenist movement (FETO) members abroad',
    location: 'Central Asia, Europe, Africa',
    method: 'Interpol Abuse',
    description:
      "Turkish government issued thousands of Interpol Red Notices against alleged Gulenists following the 2016 coup attempt; many involving tenuous evidence. Interpol's CCF deleted hundreds of Turkish notices. Turkey also pressured Central Asian states to extradite Gulen-linked individuals, with several extraordinary renditions documented by human rights groups.",
    outcome:
      'Interpol deleted hundreds of notices. Several renditions to Turkey from Central Asia documented. Multiple countries expelled Turkish teachers under pressure.',
    severity: 7,
    verified: true,
    sources: ['Fair Trials International (2017)', 'Interpol CCF decisions', 'Stockholm Center for Freedom reports'],
  },
  {
    id: 'TR011',
    date: '2019-01-01',
    actor: 'North Korea',
    target: 'North Korean defectors and overseas workers',
    location: 'South Korea, China, Southeast Asia',
    method: 'Family Coercion',
    description:
      'DPRK intelligence (RGB) maintains extensive networks to monitor, intimidate, and sometimes forcibly repatriate defectors. Tactics include threatening family members in North Korea, sending agents to infiltrate defector communities in South Korea, and working with Chinese authorities to repatriate defectors from China.',
    outcome:
      'South Korean NIS documented dozens of cases. Some defectors repatriated; others intimidated into silence. Ongoing systemic operation.',
    severity: 7,
    verified: true,
    sources: ['UN Commission of Inquiry on North Korea (2014)', 'NIS South Korea reports', 'Database Center for North Korean Human Rights'],
  },
  {
    id: 'TR012',
    date: '2019-06-01',
    actor: 'Uzbekistan',
    target: 'Uzbek diaspora in Germany',
    location: 'Germany',
    method: 'Digital Surveillance',
    description:
      'Uzbek intelligence services (SNB) documented surveilling Uzbek diaspora members in Germany through informant networks, social media monitoring, and covert contacts. German BfV flagged Uzbek intelligence activities targeting diaspora members who had fled the Karimov/Mirziyoyev governments.',
    outcome:
      'German BfV counter-intelligence monitoring increased. Several cases referred to prosecutors. Uzbekistan denied operations.',
    severity: 5,
    verified: true,
    sources: ['German BfV annual report', 'Human Rights Watch Central Asia report', 'Forum 18 documentation'],
  },
];

const ACTORS: ActorProfile[] = [
  {
    id: 'A001',
    country: 'Russia',
    tier: 'Tier 1',
    reintensityScore: 95,
    knownMethods: ['Physical Assassination', 'Poisoning', 'Digital Surveillance', 'Harassment Campaign', 'Family Coercion'],
    freedomHouseRating: 'Most Severe',
    operationalReach: ['United Kingdom', 'Germany', 'Europe', 'Central Asia', 'Middle East'],
    keyInstruments: ['GRU Unit 29155', 'FSB', 'Wagner Group', 'SVR'],
    incidentCount: 40,
    trend: 'escalating',
  },
  {
    id: 'A002',
    country: 'China',
    tier: 'Tier 1',
    reintensityScore: 90,
    knownMethods: ['Harassment Campaign', 'Family Coercion', 'Digital Surveillance', 'Rendition', 'Interpol Abuse'],
    freedomHouseRating: 'Most Severe',
    operationalReach: ['United States', 'Europe', 'Australia', 'Canada', 'Southeast Asia', 'Africa'],
    keyInstruments: ['MSS', 'MPS Fox Hunt teams', 'United Front Work Dept', 'clandestine police stations'],
    incidentCount: 200,
    trend: 'escalating',
  },
  {
    id: 'A003',
    country: 'Saudi Arabia',
    tier: 'Tier 1',
    reintensityScore: 88,
    knownMethods: ['Physical Assassination', 'Pegasus Spyware', 'Harassment Campaign', 'Family Coercion'],
    freedomHouseRating: 'Most Severe',
    operationalReach: ['Europe', 'North America', 'Turkey', 'Canada'],
    keyInstruments: ['SADF Tiger Squad (Rapid Intervention Force)', 'NSO Pegasus', 'Saudi diplomatic missions'],
    incidentCount: 25,
    trend: 'stable',
  },
  {
    id: 'A004',
    country: 'Iran',
    tier: 'Tier 1',
    reintensityScore: 85,
    knownMethods: ['Physical Assassination', 'Rendition', 'Harassment Campaign', 'Family Coercion'],
    freedomHouseRating: 'Most Severe',
    operationalReach: ['United States', 'Europe', 'Middle East', 'Canada'],
    keyInstruments: ['IRGC Quds Force', 'MOIS', 'proxies', 'contract assassins'],
    incidentCount: 30,
    trend: 'escalating',
  },
  {
    id: 'A005',
    country: 'UAE',
    tier: 'Tier 2',
    reintensityScore: 72,
    knownMethods: ['Pegasus Spyware', 'Digital Surveillance', 'Harassment Campaign'],
    freedomHouseRating: 'Severe',
    operationalReach: ['North Africa', 'Middle East', 'Europe', 'Horn of Africa'],
    keyInstruments: ['NSO Pegasus', 'Cellebrite UFED', 'Karma hacking tool (ex-NSA operatives)'],
    incidentCount: 15,
    trend: 'stable',
  },
  {
    id: 'A006',
    country: 'Turkey',
    tier: 'Tier 2',
    reintensityScore: 68,
    knownMethods: ['Interpol Abuse', 'Rendition', 'Harassment Campaign', 'Digital Surveillance'],
    freedomHouseRating: 'Severe',
    operationalReach: ['Central Asia', 'Europe', 'Africa', 'Balkans'],
    keyInstruments: ['MIT (intelligence)', 'Interpol Red Notices', 'diplomatic pressure', 'bilateral extradition'],
    incidentCount: 60,
    trend: 'stable',
  },
  {
    id: 'A007',
    country: 'Rwanda',
    tier: 'Tier 2',
    reintensityScore: 65,
    knownMethods: ['Rendition', 'Physical Assassination', 'Harassment Campaign', 'Pegasus Spyware'],
    freedomHouseRating: 'Severe',
    operationalReach: ['Uganda', 'DRC', 'Europe', 'South Africa', 'UAE'],
    keyInstruments: ['DMI (Directorate of Military Intelligence)', 'NSO Pegasus', 'diplomatic cover'],
    incidentCount: 12,
    trend: 'stable',
  },
  {
    id: 'A008',
    country: 'Belarus',
    tier: 'Tier 2',
    reintensityScore: 62,
    knownMethods: ['Forced Plane Landing', 'Rendition', 'Harassment Campaign', 'Digital Surveillance'],
    freedomHouseRating: 'Severe',
    operationalReach: ['Europe', 'Ukraine', 'Russia'],
    keyInstruments: ['KGB Belarus', 'Russian intelligence cooperation', 'Lukashenko presidential guard'],
    incidentCount: 10,
    trend: 'stable',
  },
  {
    id: 'A009',
    country: 'North Korea',
    tier: 'Tier 2',
    reintensityScore: 60,
    knownMethods: ['Family Coercion', 'Harassment Campaign', 'Physical Assassination', 'Digital Surveillance'],
    freedomHouseRating: 'Severe',
    operationalReach: ['South Korea', 'China', 'Southeast Asia'],
    keyInstruments: ['RGB (Reconnaissance General Bureau)', 'Lazarus Group cyber', 'defector surveillance networks'],
    incidentCount: 35,
    trend: 'stable',
  },
  {
    id: 'A010',
    country: 'Uzbekistan',
    tier: 'Tier 3',
    reintensityScore: 42,
    knownMethods: ['Digital Surveillance', 'Harassment Campaign', 'Family Coercion'],
    freedomHouseRating: 'Transnational Repressor',
    operationalReach: ['Germany', 'Russia', 'Ukraine', 'Kazakhstan'],
    keyInstruments: ['SNB (State Security Service)', 'informant networks', 'social media monitoring'],
    incidentCount: 8,
    trend: 'declining',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function computeGlobalRepressionIndex(actors: ActorProfile[]): number {
  if (!actors.length) return 0;
  const avg = actors.reduce((s, a) => s + a.reintensityScore, 0) / actors.length;
  return Math.min(100, Math.round(avg));
}

export function getByMethod(
  incidents: RepressionIncident[],
  method: RepressionMethod,
): RepressionIncident[] {
  return incidents.filter(i => i.method === method);
}

export function getByActor(
  incidents: RepressionIncident[],
  actor: string,
): RepressionIncident[] {
  return incidents.filter(i => i.actor === actor);
}

export function getHighSeverity(
  incidents: RepressionIncident[],
  threshold = 8,
): RepressionIncident[] {
  return incidents.filter(i => i.severity >= threshold);
}

export function getMostActiveActors(
  actors: ActorProfile[],
  n = 5,
): ActorProfile[] {
  return [...actors].sort((a, b) => b.reintensityScore - a.reintensityScore).slice(0, n);
}

export function getSeverityCategory(severity: number): RepressionSeverity {
  if (severity >= 9) return 'Critical';
  if (severity >= 7) return 'High';
  if (severity >= 5) return 'Medium';
  return 'Low';
}

export function methodClass(method: RepressionMethod): string {
  const map: Record<RepressionMethod, string> = {
    'Physical Assassination': 'method-lethal',
    'Poisoning': 'method-lethal',
    'Forced Disappearance': 'method-lethal',
    'Rendition': 'method-coercive',
    'Forced Plane Landing': 'method-coercive',
    'Interpol Abuse': 'method-legal',
    'Digital Surveillance': 'method-digital',
    'Pegasus Spyware': 'method-digital',
    'Harassment Campaign': 'method-pressure',
    'Family Coercion': 'method-pressure',
  };
  return map[method] ?? 'method-pressure';
}

export function severityClass(severity: number): string {
  const cat = getSeverityCategory(severity);
  const map: Record<RepressionSeverity, string> = {
    Critical: 'sev-critical',
    High: 'sev-high',
    Medium: 'sev-medium',
    Low: 'sev-low',
  };
  return map[cat];
}

export function tierClass(tier: ActorTier): string {
  const map: Record<ActorTier, string> = {
    'Tier 1': 'tier-1',
    'Tier 2': 'tier-2',
    'Tier 3': 'tier-3',
  };
  return map[tier] ?? 'tier-3';
}

export function trendClass(trend: ActorProfile['trend']): string {
  const map: Record<ActorProfile['trend'], string> = {
    escalating: 'trend-up',
    stable: 'trend-flat',
    declining: 'trend-down',
  };
  return map[trend] ?? 'trend-flat';
}

export function buildRenderData(): TransnationalRepressionRenderData {
  return {
    incidents: INCIDENTS,
    actors: ACTORS,
    globalRepressionIndex: computeGlobalRepressionIndex(ACTORS),
    criticalCount: INCIDENTS.filter(i => getSeverityCategory(i.severity) === 'Critical').length,
    highCount: INCIDENTS.filter(i => getSeverityCategory(i.severity) === 'High').length,
    activeActorCount: ACTORS.filter(a => a.trend === 'escalating' || a.trend === 'stable').length,
    mostActiveActors: getMostActiveActors(ACTORS, 5),
    recentIncidents: [...INCIDENTS].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
  };
}
