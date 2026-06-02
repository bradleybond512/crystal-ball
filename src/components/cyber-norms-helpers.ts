// cyber-norms-helpers.ts
// Pure logic for CyberNormsPanel — no DOM, no Panel imports

export type FrameworkStatus = 'Active' | 'Emerging' | 'Contested' | 'Stalled';
export type AttributionLevel = 'Confirmed' | 'High' | 'Moderate' | 'Low' | 'Unattributed';
export type AttributedActor = 'China/PRC' | 'Russia' | 'Iran' | 'North Korea/DPRK' | 'Unknown';
export type OperationType = 'Espionage' | 'Sabotage' | 'Financial' | 'Disruptive' | 'Pre-positioning';
export type ComplianceTier = 'Compliant' | 'Partial' | 'Non-Compliant' | 'No Data';

export interface NormFramework {
  id: string;
  name: string;
  shortName: string;
  year: number;
  type: 'Treaty' | 'Voluntary Norms' | 'Technical Standard' | 'Political Declaration' | 'Expert Study';
  status: FrameworkStatus;
  signatoryCount: number;
  description: string;
  keyProvisions: string[];
  notableAbsences: string[];
  usPosition: 'Signed' | 'Not Signed' | 'Participant' | 'Engaged';
  chinaRussiaPosition: 'Signed' | 'Not Signed' | 'Opposed' | 'Engaged' | 'Parallel Track';
  geopoliticalSignificance: string;
}

export interface CyberOperation {
  id: string;
  name: string;
  year: string;
  attributedActor: AttributedActor;
  attributionLevel: AttributionLevel;
  operationType: OperationType;
  targetedSectors: string[];
  affectedCountries: string[];
  estimatedImpact: string;
  description: string;
  normViolations: string[];
  legalFrameworksImplicated: string[];
  status: 'Ongoing' | 'Concluded' | 'Disrupted';
}

export interface ComplianceScore {
  actor: string;
  overallScore: number; // 0-100, higher = more compliant
  tier: ComplianceTier;
  espionageRestraint: number; // 0-10
  criticalInfraProtection: number; // 0-10
  normEngagement: number; // 0-10
  responseToAttribution: number; // 0-10
  notes: string;
}

export interface CyberNormsRenderData {
  frameworks: NormFramework[];
  operations: CyberOperation[];
  complianceScores: ComplianceScore[];
  activeFrameworkCount: number;
  highConfidenceOperationCount: number;
  ongoingOperationCount: number;
  globalNormsAdoptionScore: number;
  mostActiveActor: AttributedActor | null;
  topViolatedFramework: string | null;
}

// ── Static Data ────────────────────────────────────────────────────────────────

const FRAMEWORKS: NormFramework[] = [
  {
    id: 'F001',
    name: 'UN Group of Governmental Experts 2015 Report',
    shortName: 'UN GGE 2015',
    year: 2015,
    type: 'Voluntary Norms',
    status: 'Active',
    signatoryCount: 193,
    description:
      'Established 11 voluntary norms for responsible state behavior in cyberspace. Widely cited baseline for international cyber diplomacy.',
    keyProvisions: [
      'States should not knowingly allow their territory to be used for internationally wrongful cyber acts',
      'States should not conduct or knowingly support cyber activity that intentionally damages critical infrastructure',
      'States should respond to requests for assistance from other states when facing cyber attacks',
      "States should not conduct or support activity that harms another state's CERT/CSIRT",
    ],
    notableAbsences: [],
    usPosition: 'Participant',
    chinaRussiaPosition: 'Parallel Track',
    geopoliticalSignificance:
      'Landmark consensus document; Russia and China later undermined it by pushing parallel UN OEWG to dilute norms.',
  },
  {
    id: 'F002',
    name: 'Tallinn Manual 3.0',
    shortName: 'Tallinn Manual 3.0',
    year: 2023,
    type: 'Expert Study',
    status: 'Active',
    signatoryCount: 0,
    description:
      'NATO-affiliated CCDCOE expert study on how international law — including IHL and state responsibility — applies to cyberspace operations. Third edition published 2023 with 60+ international law experts.',
    keyProvisions: [
      'Sovereignty applies in cyberspace — states have sovereign rights over cyber infrastructure on their territory',
      'Prohibition on intervention in internal affairs extends to cyber operations',
      'Cyber operations may constitute use of force under Article 2(4) UN Charter',
      'Law of armed conflict applies to cyber operations in armed conflicts',
    ],
    notableAbsences: ['Russia', 'China'],
    usPosition: 'Engaged',
    chinaRussiaPosition: 'Opposed',
    geopoliticalSignificance:
      'Non-binding but most authoritative legal analysis. China and Russia reject Western interpretation; developing parallel frameworks.',
  },
  {
    id: 'F003',
    name: 'Budapest Convention on Cybercrime',
    shortName: 'Budapest Convention',
    year: 2001,
    type: 'Treaty',
    status: 'Active',
    signatoryCount: 68,
    description:
      'First binding international cybercrime treaty. Requires signatories to criminalize specific cyber offenses and cooperate on investigations. Second Protocol added in 2022 for expanded data access.',
    keyProvisions: [
      'Criminalization of unauthorized system access, data interference, computer fraud',
      'Expedited preservation of stored data across borders',
      '24/7 network of contact points for law enforcement cooperation',
      'Second Protocol (2022) allows direct cooperation with service providers',
    ],
    notableAbsences: ['Russia', 'China', 'India', 'Brazil'],
    usPosition: 'Signed',
    chinaRussiaPosition: 'Not Signed',
    geopoliticalSignificance:
      'Russia and China refused to join, instead pushing UN cybercrime treaty as alternative that prioritizes state sovereignty over human rights safeguards.',
  },
  {
    id: 'F004',
    name: 'Paris Call for Trust and Security in Cyberspace',
    shortName: 'Paris Call (2018)',
    year: 2018,
    type: 'Political Declaration',
    status: 'Active',
    signatoryCount: 1200,
    description:
      'French-led multi-stakeholder initiative for secure and stable cyberspace. Over 80 states signed; the USA joined in 2021 under Biden. Endorsed by hundreds of civil society and private sector organizations.',
    keyProvisions: [
      'Prevent interference in electoral processes',
      'Protect individuals and infrastructure from malicious cyber operations',
      'Strengthen norms against proliferation of malicious code and tools',
      'Prevent private sector from hiring out offensive cyber capabilities',
    ],
    notableAbsences: ['Russia', 'China', 'Iran', 'North Korea'],
    usPosition: 'Signed',
    chinaRussiaPosition: 'Not Signed',
    geopoliticalSignificance:
      'USA absence under Trump was significant; 2021 rejoining signaled transatlantic cyber alignment.',
  },
  {
    id: 'F005',
    name: 'Prague Proposals on Telecommunications Security',
    shortName: 'Prague Proposals (2019)',
    year: 2019,
    type: 'Political Declaration',
    status: 'Active',
    signatoryCount: 32,
    description:
      "Five Eyes + allied nations framework establishing security principles for 5G networks against untrusted vendors. Primary target: Huawei and ZTE. Shapes Allied telco procurement policy.",
    keyProvisions: [
      "Assess vendor trustworthiness based on rule of law in vendor's home country",
      'Avoid vendor concentration and maintain resilience through diversification',
      'Apply security across entire supply chain, not just at deployment',
      'Governments should be transparent about risk assessments',
    ],
    notableAbsences: ['China', 'Russia'],
    usPosition: 'Signed',
    chinaRussiaPosition: 'Opposed',
    geopoliticalSignificance:
      'Operationalized exclusion of Chinese vendors from Allied 5G infrastructure; major geoeconomic consequence.',
  },
  {
    id: 'F006',
    name: 'UN Open-Ended Working Group on ICT Security',
    shortName: 'UN OEWG',
    year: 2019,
    type: 'Voluntary Norms',
    status: 'Contested',
    signatoryCount: 193,
    description:
      'Russia-China initiative to create a parallel UN forum to UN GGE, open to all member states. OEWG Final Report (2021) diluted norms language. Successor OEWG 2.0 runs through 2025.',
    keyProvisions: [
      'Reaffirms GGE 2015 norms but with weaker language',
      'Emphasizes national sovereignty over extraterritorial cyber operations',
      'Seeks binding international legal instrument (rejected by West)',
      'Advocates for state control over internet governance',
    ],
    notableAbsences: [],
    usPosition: 'Participant',
    chinaRussiaPosition: 'Parallel Track',
    geopoliticalSignificance:
      'Geopolitical battleground between Western liberal norms and Sino-Russian "cyber sovereignty" vision. Outcome shapes binding treaty prospects.',
  },
  {
    id: 'F007',
    name: 'G7 Cyber Expert Group',
    shortName: 'G7 Cyber Expert Group',
    year: 2016,
    type: 'Technical Standard',
    status: 'Active',
    signatoryCount: 7,
    description:
      'G7 coordination mechanism for cyber policy among major democracies. Focuses on critical infrastructure protection, financial sector resilience, and aligned threat attribution.',
    keyProvisions: [
      'Fundamental Elements for Cybersecurity in the Financial Sector (2016)',
      'Coordinated attribution of state-sponsored attacks',
      'Information sharing on critical infrastructure threats',
      'Ransomware response coordination (2021 G7 commitment)',
    ],
    notableAbsences: ['Russia (expelled 2014)', 'China'],
    usPosition: 'Participant',
    chinaRussiaPosition: 'Not Signed',
    geopoliticalSignificance:
      'Drives practical coordination; G7 joint attributions (e.g., Sandworm, APT40) have political legitimacy weight.',
  },
  {
    id: 'F008',
    name: 'OECD Digital Security Policy Recommendation',
    shortName: 'OECD Digital Security',
    year: 2015,
    type: 'Voluntary Norms',
    status: 'Active',
    signatoryCount: 38,
    description:
      'OECD recommendation integrating digital security risk management into economic activity. Updated 2022 with guidance on systemic risk and critical infrastructure.',
    keyProvisions: [
      'Treat digital security as economic rather than purely technical issue',
      'Promote security-aware culture in the economy',
      'Foster international cooperation on digital security',
      'Account for human rights in security policies',
    ],
    notableAbsences: ['China', 'Russia', 'India'],
    usPosition: 'Participant',
    chinaRussiaPosition: 'Not Signed',
    geopoliticalSignificance:
      'Economic framing bridges security and trade policy; increasingly cited in sanctions and export control contexts.',
  },
  {
    id: 'F009',
    name: 'Christchurch Call to Action',
    shortName: 'Christchurch Call',
    year: 2019,
    type: 'Political Declaration',
    status: 'Emerging',
    signatoryCount: 120,
    description:
      'New Zealand/France led initiative to eliminate terrorist and violent extremist content online. Addresses cyber-enabled information warfare and platform accountability.',
    keyProvisions: [
      'Platforms must remove terrorist/extremist content rapidly',
      'Governments commit to not use platforms to spread such content',
      'Develop tools to detect and remove content cross-platform',
      'Transparency in algorithms affecting content distribution',
    ],
    notableAbsences: ['USA (Trump era; partial engagement under Biden)', 'Russia', 'China'],
    usPosition: 'Engaged',
    chinaRussiaPosition: 'Not Signed',
    geopoliticalSignificance:
      'Establishes platform accountability norms relevant to information operations and hybrid warfare.',
  },
  {
    id: 'F010',
    name: 'Global Forum on Cyber Expertise',
    shortName: 'GFCE',
    year: 2015,
    type: 'Political Declaration',
    status: 'Active',
    signatoryCount: 180,
    description:
      'Multi-stakeholder platform for cyber capacity building. Connects donor nations with recipients; aims to reduce global cyber inequality that enables threat actors.',
    keyProvisions: [
      'Match capacity building needs with available expertise',
      'Reduce duplication of bilateral capacity building programs',
      'Track and coordinate global cyber capacity building investments',
      'Include developing nations in norm development processes',
    ],
    notableAbsences: ['Russia', 'China (observer only)'],
    usPosition: 'Participant',
    chinaRussiaPosition: 'Engaged',
    geopoliticalSignificance:
      'Geopolitical competition for influence in developing nations through cyber assistance programs.',
  },
];

const OPERATIONS: CyberOperation[] = [
  {
    id: 'OP001',
    name: 'Volt Typhoon',
    year: '2023–2024',
    attributedActor: 'China/PRC',
    attributionLevel: 'Confirmed',
    operationType: 'Pre-positioning',
    targetedSectors: ['Critical Infrastructure', 'Communications', 'Water', 'Energy', 'Transportation'],
    affectedCountries: ['USA', 'Guam', 'Pacific territories'],
    estimatedImpact: 'Pre-positioned access for potential disruption during Taiwan contingency',
    description:
      'PRC state-sponsored actor pre-positioned in US critical infrastructure using living-off-the-land techniques. Five Eyes joint advisory confirmed in 2024. Targeted Guam as key Pacific hub.',
    normViolations: [
      'UN GGE 2015 Norm 13(f) — critical infrastructure protection',
      'Paris Call Principle 2',
    ],
    legalFrameworksImplicated: ['UN GGE 2015', 'Tallinn Manual 3.0', 'Paris Call (2018)'],
    status: 'Ongoing',
  },
  {
    id: 'OP002',
    name: 'Salt Typhoon',
    year: '2024',
    attributedActor: 'China/PRC',
    attributionLevel: 'Confirmed',
    operationType: 'Espionage',
    targetedSectors: ['Telecommunications', 'Government'],
    affectedCountries: ['USA', 'Canada', 'UK', 'Australia'],
    estimatedImpact: '8+ US telecom carriers compromised; lawful intercept systems breached',
    description:
      'PRC intrusion into major US and Allied telecommunications providers. Breached CALEA lawful intercept infrastructure used by US law enforcement. One of the most significant known intelligence collection operations against US telecoms.',
    normViolations: ['UN GGE 2015 Norm 13(e) — respect for privacy', 'Paris Call Principle 2'],
    legalFrameworksImplicated: ['UN GGE 2015', 'Budapest Convention', 'Paris Call (2018)'],
    status: 'Concluded',
  },
  {
    id: 'OP003',
    name: 'Sandworm / GRU Wiper Campaign',
    year: '2022–2024',
    attributedActor: 'Russia',
    attributionLevel: 'Confirmed',
    operationType: 'Sabotage',
    targetedSectors: ['Government', 'Energy', 'Media', 'Financial'],
    affectedCountries: ['Ukraine', 'Poland', 'Germany', 'Latvia'],
    estimatedImpact: 'Dozens of wiper attacks; Viasat KA-SAT satellite disruption at war onset',
    description:
      'Russian GRU Unit 74455 (Sandworm) conducted sustained wiper attack campaign against Ukrainian government and infrastructure in conjunction with kinetic military operations. Attacks include WhisperGate, HermeticWiper, Industroyer2 targeting Ukrainian power grid.',
    normViolations: [
      'UN GGE 2015 Norm 13(f) — critical infrastructure',
      'Tallinn Manual — cyber operations amounting to use of force',
      'Paris Call Principle 2',
    ],
    legalFrameworksImplicated: ['UN GGE 2015', 'Tallinn Manual 3.0', 'G7 Cyber Expert Group'],
    status: 'Ongoing',
  },
  {
    id: 'OP004',
    name: 'Iranian Operations Against Gulf States & Israel',
    year: '2024',
    attributedActor: 'Iran',
    attributionLevel: 'High',
    operationType: 'Disruptive',
    targetedSectors: ['Government', 'Financial', 'Defense', 'Critical Infrastructure'],
    affectedCountries: ['Israel', 'Saudi Arabia', 'UAE', 'Albania'],
    estimatedImpact: 'Disruptions to Albanian government (2022 precedent extended); Israeli infrastructure targeting',
    description:
      'Iranian APTs (APT42, MuddyWater, OilRig) conducted disruptive and espionage operations against regional adversaries. Included hacktivist front groups to provide deniability. Albania operations in 2022 led to severance of diplomatic relations.',
    normViolations: [
      "UN GGE 2015 Norm 13(c) — not damage other states' infrastructure",
      'Paris Call Principle 2',
    ],
    legalFrameworksImplicated: ['UN GGE 2015', 'Paris Call (2018)', 'Budapest Convention'],
    status: 'Ongoing',
  },
  {
    id: 'OP005',
    name: 'Lazarus Group Ronin Bridge Hack',
    year: '2022',
    attributedActor: 'North Korea/DPRK',
    attributionLevel: 'Confirmed',
    operationType: 'Financial',
    targetedSectors: ['Finance', 'Cryptocurrency'],
    affectedCountries: ['USA', 'Global'],
    estimatedImpact: '$625 million stolen — largest crypto hack ever attributed to a nation-state',
    description:
      "DPRK's Lazarus Group (APT38) exploited the Ronin Network bridge used by Axie Infinity, stealing $625M in ETH and USDC. US Treasury sanctioned the Tornado Cash mixer used to launder funds. Part of estimated $3B+ stolen by DPRK via crypto in 2022.",
    normViolations: [
      'UN GGE 2015 Norm 13(f) — financial system stability',
      'Paris Call Principle 4 — prevent financially motivated cybercrime',
    ],
    legalFrameworksImplicated: ['UN GGE 2015', 'Budapest Convention', 'Paris Call (2018)'],
    status: 'Concluded',
  },
  {
    id: 'OP006',
    name: 'Hafnium / Microsoft Exchange Zero-Days',
    year: '2021',
    attributedActor: 'China/PRC',
    attributionLevel: 'Confirmed',
    operationType: 'Espionage',
    targetedSectors: ['Government', 'Defense', 'Healthcare', 'Finance'],
    affectedCountries: ['USA', 'EU', 'UK', 'Australia', 'Canada', 'NATO allies'],
    estimatedImpact: '250,000+ servers compromised globally; used for espionage and subsequent ransomware',
    description:
      'Chinese MSS-linked threat actor exploited four zero-day vulnerabilities in Microsoft Exchange Server. Mass exploitation preceded public disclosure. US, EU, NATO, and 40+ states issued joint attribution — unprecedented multilateral cyber attribution.',
    normViolations: [
      'UN GGE 2015 Norm 13(h) — use ICT to harm critical infrastructure',
      'Paris Call Principle 2',
    ],
    legalFrameworksImplicated: ['UN GGE 2015', 'Tallinn Manual 3.0', 'G7 Cyber Expert Group', 'Budapest Convention'],
    status: 'Concluded',
  },
];

const COMPLIANCE_SCORES: ComplianceScore[] = [
  {
    actor: 'United States',
    overallScore: 72,
    tier: 'Partial',
    espionageRestraint: 5,
    criticalInfraProtection: 9,
    normEngagement: 9,
    responseToAttribution: 8,
    notes:
      'Active norm-builder; NSA mass surveillance (Snowden) dented credibility; strong critical infra posture; leads multilateral attributions.',
  },
  {
    actor: 'EU/NATO Bloc',
    overallScore: 78,
    tier: 'Partial',
    espionageRestraint: 6,
    criticalInfraProtection: 8,
    normEngagement: 9,
    responseToAttribution: 8,
    notes:
      'Strong norm engagement; NIS2 Directive advances critical infra protection; joined US in attributions; internal fragmentation on China risk.',
  },
  {
    actor: 'China',
    overallScore: 28,
    tier: 'Non-Compliant',
    espionageRestraint: 1,
    criticalInfraProtection: 5,
    normEngagement: 4,
    responseToAttribution: 1,
    notes:
      'Persistent critical infra pre-positioning (Volt Typhoon); mass espionage; denies all attributions; promotes parallel sovereignty-focused norms.',
  },
  {
    actor: 'Russia',
    overallScore: 15,
    tier: 'Non-Compliant',
    espionageRestraint: 1,
    criticalInfraProtection: 1,
    normEngagement: 3,
    responseToAttribution: 1,
    notes:
      'Wiper attacks against Ukraine civilian infrastructure; SolarWinds; election interference; actively undermines Western norm frameworks.',
  },
  {
    actor: 'Iran',
    overallScore: 22,
    tier: 'Non-Compliant',
    espionageRestraint: 2,
    criticalInfraProtection: 3,
    normEngagement: 2,
    responseToAttribution: 1,
    notes:
      'Targeted critical infrastructure of regional adversaries; uses hacktivist fronts; destroyed Albanian government systems; sabotage intent.',
  },
  {
    actor: 'North Korea',
    overallScore: 10,
    tier: 'Non-Compliant',
    espionageRestraint: 1,
    criticalInfraProtection: 2,
    normEngagement: 1,
    responseToAttribution: 1,
    notes:
      'State-mandated crypto theft for WMD financing; $3B+ stolen 2022-2024; no engagement with norm frameworks; no attribution responses.',
  },
];

// ── Helper Functions ────────────────────────────────────────────────────────────

export function getActiveFrameworks(frameworks: NormFramework[]): NormFramework[] {
  return frameworks.filter(f => f.status === 'Active');
}

export function getMajorIncidents(
  operations: CyberOperation[],
  minConfidence: AttributionLevel = 'Moderate',
): CyberOperation[] {
  const confidenceRank: Record<AttributionLevel, number> = {
    Confirmed: 5,
    High: 4,
    Moderate: 3,
    Low: 2,
    Unattributed: 1,
  };
  const minRank = confidenceRank[minConfidence];
  return operations.filter(op => confidenceRank[op.attributionLevel] >= minRank);
}

export function getByAttributedActor(
  operations: CyberOperation[],
  actor: AttributedActor,
): CyberOperation[] {
  return operations.filter(op => op.attributedActor === actor);
}

export function complianceClass(tier: ComplianceTier): string {
  const map: Record<ComplianceTier, string> = {
    Compliant: 'comply-compliant',
    Partial: 'comply-partial',
    'Non-Compliant': 'comply-noncompliant',
    'No Data': 'comply-nodata',
  };
  return map[tier] ?? 'comply-nodata';
}

export function attributionClass(level: AttributionLevel): string {
  const map: Record<AttributionLevel, string> = {
    Confirmed: 'attr-confirmed',
    High: 'attr-high',
    Moderate: 'attr-moderate',
    Low: 'attr-low',
    Unattributed: 'attr-unattributed',
  };
  return map[level] ?? 'attr-unattributed';
}

export function attributionScore(level: AttributionLevel): number {
  const map: Record<AttributionLevel, number> = {
    Confirmed: 100,
    High: 80,
    Moderate: 60,
    Low: 30,
    Unattributed: 0,
  };
  return map[level] ?? 0;
}

export function computeGlobalNormsAdoptionScore(frameworks: NormFramework[]): number {
  if (!frameworks.length) return 0;
  const active = frameworks.filter(f => f.status === 'Active').length;
  const contested = frameworks.filter(f => f.status === 'Contested').length;
  const score = Math.round(((active - contested * 0.5) / frameworks.length) * 100);
  return Math.max(0, Math.min(100, score));
}

export function getMostActiveActor(operations: CyberOperation[]): AttributedActor | null {
  if (!operations.length) return null;
  const counts = new Map<AttributedActor, number>();
  for (const op of operations) {
    counts.set(op.attributedActor, (counts.get(op.attributedActor) ?? 0) + 1);
  }
  let topActor: AttributedActor | null = null;
  let topCount = 0;
  for (const [actor, count] of counts) {
    if (count > topCount) {
      topCount = count;
      topActor = actor;
    }
  }
  return topActor;
}

export function getTopViolatedFramework(operations: CyberOperation[]): string | null {
  if (!operations.length) return null;
  const counts = new Map<string, number>();
  for (const op of operations) {
    for (const f of op.legalFrameworksImplicated) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  let top: string | null = null;
  let topCount = 0;
  for (const [name, count] of counts) {
    if (count > topCount) {
      topCount = count;
      top = name;
    }
  }
  return top;
}

export function getOngoingOperations(operations: CyberOperation[]): CyberOperation[] {
  return operations.filter(op => op.status === 'Ongoing');
}

export function getHighConfidenceOperations(operations: CyberOperation[]): CyberOperation[] {
  return operations.filter(
    op => op.attributionLevel === 'Confirmed' || op.attributionLevel === 'High',
  );
}

export function getFrameworksByType(
  frameworks: NormFramework[],
  type: NormFramework['type'],
): NormFramework[] {
  return frameworks.filter(f => f.type === type);
}

export function buildRenderData(): CyberNormsRenderData {
  return {
    frameworks: FRAMEWORKS,
    operations: OPERATIONS,
    complianceScores: COMPLIANCE_SCORES,
    activeFrameworkCount: getActiveFrameworks(FRAMEWORKS).length,
    highConfidenceOperationCount: getHighConfidenceOperations(OPERATIONS).length,
    ongoingOperationCount: getOngoingOperations(OPERATIONS).length,
    globalNormsAdoptionScore: computeGlobalNormsAdoptionScore(FRAMEWORKS),
    mostActiveActor: getMostActiveActor(OPERATIONS),
    topViolatedFramework: getTopViolatedFramework(OPERATIONS),
  };
}

export { FRAMEWORKS, OPERATIONS, COMPLIANCE_SCORES };
