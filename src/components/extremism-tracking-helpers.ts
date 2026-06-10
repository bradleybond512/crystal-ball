// extremism-tracking-helpers.ts
// Pure logic for ExtremismTrackingPanel — no DOM, no Panel imports.
//
// A static, fixture-tested model of 12 major extremist groups across
// ideologies plus 8 recent significant attacks (2023-2024). The panel layer
// (ExtremismTrackingPanel.ts) renders the output of buildRenderData(); every
// function here is input-output pure so it can be unit-tested with the static
// EXTREMIST_GROUPS / EXTREMISM_EVENTS fixtures.

export interface ExtremistGroup {
  id: string;
  name: string;
  ideology:
    | 'jihadist-salafi'
    | 'far-right'
    | 'far-left'
    | 'ethnonationalist'
    | 'eco-terrorist'
    | 'religious-cult'
    | 'anarchist';
  primaryRegion: string;
  activeCountries: string[];
  threatLevel: 'critical' | 'high' | 'medium' | 'low';
  estimatedMembers: number;
  recentAttacks12Mo: number;
  lastMajorAttack: string;
  lastMajorAttackYear: number;
  financingType: 'state-sponsor' | 'self-financing' | 'criminal' | 'donations' | 'mixed';
  trend: 'growing' | 'stable' | 'declining';
  designation: 'FTO' | 'SDGT' | 'proscribed' | 'monitored' | 'none';
  notes: string;
}

export interface ExtremismEvent {
  id: string;
  date: string;
  country: string;
  group: string;
  attackType: 'bombing' | 'shooting' | 'stabbing' | 'vehicle' | 'arson' | 'cyber' | 'other';
  fatalities: number;
  injured: number;
  significance: 'major' | 'notable' | 'minor';
  description: string;
}

export interface ExtremismData {
  groups: ExtremistGroup[];
  recentEvents: ExtremismEvent[];
  lastUpdated: string;
  globalExtremismThreatIndex: number;
}

export const EXTREMIST_GROUPS: ExtremistGroup[] = [
  {
    id: 'isis-core',
    name: 'Islamic State (ISIS/DAESH) — Core',
    ideology: 'jihadist-salafi',
    primaryRegion: 'Middle East/Global',
    activeCountries: ['Iraq', 'Syria', 'Libya', 'Afghanistan', 'Philippines'],
    threatLevel: 'critical',
    estimatedMembers: 20000,
    recentAttacks12Mo: 180,
    lastMajorAttack: 'Moscow Crocus City Hall attack (ISIS-K)',
    lastMajorAttackYear: 2024,
    financingType: 'mixed',
    trend: 'stable',
    designation: 'FTO',
    notes:
      'Caliphate territory lost but global franchises (ISIS-K, ISIS-Sahel, ISIS-Somalia) expanding; 2024 attacks in Russia, Iran, Afghanistan',
  },
  {
    id: 'isis-k',
    name: 'ISIS-Khorasan (ISIS-K)',
    ideology: 'jihadist-salafi',
    primaryRegion: 'Central/South Asia',
    activeCountries: ['Afghanistan', 'Pakistan', 'Iran', 'Russia', 'Tajikistan'],
    threatLevel: 'critical',
    estimatedMembers: 4000,
    recentAttacks12Mo: 45,
    lastMajorAttack: 'Crocus City Hall, Moscow (140 killed)',
    lastMajorAttackYear: 2024,
    financingType: 'mixed',
    trend: 'growing',
    designation: 'FTO',
    notes:
      'Most active ISIS franchise; conducted highest-lethality Western-linked attack in years; Taliban hostility drives cross-border ops',
  },
  {
    id: 'hamas',
    name: 'Hamas — Military Wing (Qassam Brigades)',
    ideology: 'jihadist-salafi',
    primaryRegion: 'Middle East',
    activeCountries: ['Gaza', 'West Bank', 'Lebanon'],
    threatLevel: 'critical',
    estimatedMembers: 30000,
    recentAttacks12Mo: 1200,
    lastMajorAttack: 'Oct 7 2023 attack on Israel (1200 killed)',
    lastMajorAttackYear: 2023,
    financingType: 'state-sponsor',
    trend: 'declining',
    designation: 'FTO',
    notes:
      'Oct 7 triggered Israel war in Gaza; military capacity degraded significantly; political leadership in Doha',
  },
  {
    id: 'hezbollah',
    name: 'Hezbollah',
    ideology: 'jihadist-salafi',
    primaryRegion: 'Middle East',
    activeCountries: ['Lebanon', 'Syria', 'Yemen', 'Iraq', 'Latin America'],
    threatLevel: 'critical',
    estimatedMembers: 100000,
    recentAttacks12Mo: 890,
    lastMajorAttack: 'Mass pager attack by Israel (2024), Lebanon cross-border operations',
    lastMajorAttackYear: 2024,
    financingType: 'state-sponsor',
    trend: 'declining',
    designation: 'FTO',
    notes:
      'Iran proxy; significantly degraded after Israel pager attacks and leadership assassinations Sept 2024; ceasefire Nov 2024',
  },
  {
    id: 'al-qaeda',
    name: 'al-Qaeda Core + Network',
    ideology: 'jihadist-salafi',
    primaryRegion: 'Global',
    activeCountries: ['Afghanistan', 'Mali', 'Somalia', 'Yemen', 'Syria'],
    threatLevel: 'high',
    estimatedMembers: 7000,
    recentAttacks12Mo: 60,
    lastMajorAttack: 'JNIM attack in Mali (42 soldiers killed)',
    lastMajorAttackYear: 2024,
    financingType: 'mixed',
    trend: 'stable',
    designation: 'FTO',
    notes:
      'Core weakened but affiliates (AQIM/JNIM in Sahel, AQAP in Yemen) conducting operations; Sahel surge significant',
  },
  {
    id: 'proud-boys',
    name: 'Proud Boys / Western Chauvinist Militia Network',
    ideology: 'far-right',
    primaryRegion: 'North America',
    activeCountries: ['USA', 'Canada', 'Australia'],
    threatLevel: 'medium',
    estimatedMembers: 3000,
    recentAttacks12Mo: 8,
    lastMajorAttack: 'Jan 6 Capitol attack role',
    lastMajorAttackYear: 2021,
    financingType: 'donations',
    trend: 'declining',
    designation: 'proscribed',
    notes:
      'Leadership jailed post-Jan6; Enrique Tarrio 22-year sentence; Canadian proscription; international network fragmented',
  },
  {
    id: 'atomwaffen',
    name: 'Atomwaffen Division / Neo-Nazi Accelerationist Network',
    ideology: 'far-right',
    primaryRegion: 'North America/Europe',
    activeCountries: ['USA', 'UK', 'Germany', 'Canada', 'Australia'],
    threatLevel: 'high',
    estimatedMembers: 500,
    recentAttacks12Mo: 12,
    lastMajorAttack: 'Multiple murders by members (series 2018-2024)',
    lastMajorAttackYear: 2023,
    financingType: 'self-financing',
    trend: 'stable',
    designation: 'proscribed',
    notes:
      'Explicitly seeks to accelerate societal collapse; multiple murders; reformed under names like Iron March successors',
  },
  {
    id: 'raf-successor',
    name: 'European Far-Left Militant Networks (Italian/Greek)',
    ideology: 'far-left',
    primaryRegion: 'Western Europe',
    activeCountries: ['Italy', 'Greece', 'Germany'],
    threatLevel: 'low',
    estimatedMembers: 200,
    recentAttacks12Mo: 4,
    lastMajorAttack: 'Athens car bombing (2023)',
    lastMajorAttackYear: 2023,
    financingType: 'self-financing',
    trend: 'declining',
    designation: 'monitored',
    notes:
      'Red Brigades successor groups in Italy; Conspiracy of Fire cells in Greece; low-lethality bombings',
  },
  {
    id: 'jni-mali',
    name: "Jama'at Nusrat al-Islam wal-Muslimin (JNIM)",
    ideology: 'jihadist-salafi',
    primaryRegion: 'West Africa',
    activeCountries: ['Mali', 'Burkina Faso', 'Niger', 'Senegal', 'Guinea'],
    threatLevel: 'critical',
    estimatedMembers: 10000,
    recentAttacks12Mo: 400,
    lastMajorAttack: 'Multi-day siege of Bamako military school (Sept 2024)',
    lastMajorAttackYear: 2024,
    financingType: 'mixed',
    trend: 'growing',
    designation: 'FTO',
    notes:
      'al-Qaeda affiliate; largest armed group in Sahel; French withdrawal enabled territorial expansion; attacks on capital Bamako in 2024',
  },
  {
    id: 'ttp',
    name: 'Tehrik-i-Taliban Pakistan (TTP)',
    ideology: 'jihadist-salafi',
    primaryRegion: 'South Asia',
    activeCountries: ['Pakistan', 'Afghanistan'],
    threatLevel: 'high',
    estimatedMembers: 6000,
    recentAttacks12Mo: 350,
    lastMajorAttack: 'Peshawar mosque bombing (2023, 100 killed)',
    lastMajorAttackYear: 2023,
    financingType: 'mixed',
    trend: 'growing',
    designation: 'FTO',
    notes:
      'Afghan Taliban gave TTP sanctuary post-US withdrawal; cross-border attacks into Pakistan surged; ISK/TTP rivalry',
  },
  {
    id: 'eco-terrorism-eu',
    name: 'Eco-Extremist Direct Action Groups (EU)',
    ideology: 'eco-terrorist',
    primaryRegion: 'Western Europe',
    activeCountries: ['Germany', 'UK', 'Netherlands', 'France', 'Belgium'],
    threatLevel: 'low',
    estimatedMembers: 500,
    recentAttacks12Mo: 35,
    lastMajorAttack: 'Pipeline sabotage, luxury car arson, Davos disruption attempts',
    lastMajorAttackYear: 2024,
    financingType: 'donations',
    trend: 'growing',
    designation: 'monitored',
    notes:
      'Earth Liberation Front successors; Tyre Extinguishers; Stop-Ecocide networks; increasing property destruction',
  },
  {
    id: 'wagner-successors',
    name: 'Africa Corps / Wagner Successor Networks',
    ideology: 'ethnonationalist',
    primaryRegion: 'Africa/Middle East',
    activeCountries: ['Mali', 'Central African Republic', 'Libya', 'Sudan', 'Mozambique'],
    threatLevel: 'high',
    estimatedMembers: 15000,
    recentAttacks12Mo: 120,
    lastMajorAttack: 'Moura massacre (2022 ~500 civilians)',
    lastMajorAttackYear: 2022,
    financingType: 'state-sponsor',
    trend: 'stable',
    designation: 'SDGT',
    notes:
      'Prigozhin death did not end operations; rebranded as Africa Corps under Russian MoD; still in 5+ African countries',
  },
];

export const EXTREMISM_EVENTS: ExtremismEvent[] = [
  {
    id: 'crocus-2024',
    date: '2024-03-22',
    country: 'Russia',
    group: 'ISIS-K',
    attackType: 'shooting',
    fatalities: 145,
    injured: 551,
    significance: 'major',
    description:
      'ISIS-K gunmen attacked Crocus City Hall concert venue near Moscow, deadliest terror attack in Russia in 20 years',
  },
  {
    id: 'oct7-2023',
    date: '2023-10-07',
    country: 'Israel',
    group: 'Hamas',
    attackType: 'shooting',
    fatalities: 1200,
    injured: 3400,
    significance: 'major',
    description:
      'Hamas launched mass-casualty multi-vector assault on Israeli kibbutzim and Nova music festival; triggered Gaza war',
  },
  {
    id: 'bamako-2024',
    date: '2024-09-17',
    country: 'Mali',
    group: 'JNIM',
    attackType: 'other',
    fatalities: 77,
    injured: 200,
    significance: 'major',
    description:
      'JNIM siege of Bamako military academy and Bamako airport area — unprecedented attack on Malian capital',
  },
  {
    id: 'peshawar-mosque-2023',
    date: '2023-01-30',
    country: 'Pakistan',
    group: 'TTP',
    attackType: 'bombing',
    fatalities: 100,
    injured: 221,
    significance: 'major',
    description:
      'Suicide bomb at Peshawar mosque inside police compound; devastating attack on security forces',
  },
  {
    id: 'iran-jan-2024',
    date: '2024-01-03',
    country: 'Iran',
    group: 'ISIS-K',
    attackType: 'bombing',
    fatalities: 95,
    injured: 284,
    significance: 'major',
    description:
      'Twin suicide bombings near Qasem Soleimani memorial in Kerman, Iran — ISIS-K first major attack on Iranian soil',
  },
  {
    id: 'sahel-convoy-2024',
    date: '2024-08-24',
    country: 'Mali',
    group: 'JNIM',
    attackType: 'other',
    fatalities: 84,
    injured: 40,
    significance: 'notable',
    description:
      'JNIM ambush of Malian army convoy near Bamako — significant territorial advance towards capital',
  },
  {
    id: 'dagestan-2024',
    date: '2024-06-23',
    country: 'Russia',
    group: 'ISIS-affiliated',
    attackType: 'shooting',
    fatalities: 22,
    injured: 30,
    significance: 'notable',
    description:
      'Coordinated attacks on Orthodox churches and synagogues in Makhachkala and Derbent, Dagestan',
  },
  {
    id: 'brussels-2023',
    date: '2023-10-16',
    country: 'Belgium',
    group: 'ISIS-affiliated',
    attackType: 'shooting',
    fatalities: 2,
    injured: 2,
    significance: 'notable',
    description:
      'Tunisian national shot two Swedish football fans in Brussels; ISIS claim; triggered high-alert across EU',
  },
];

const THREAT_WEIGHT: Record<ExtremistGroup['threatLevel'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const GROWING_MULTIPLIER = 1.3;
const MAX_WEIGHT = THREAT_WEIGHT.critical;

const THREAT_LEVEL_CLASS: Record<ExtremistGroup['threatLevel'], string> = {
  critical: 'severity-critical',
  high: 'severity-high',
  medium: 'severity-medium',
  low: 'severity-low',
};

const IDEOLOGY_CLASS: Record<ExtremistGroup['ideology'], string> = {
  'jihadist-salafi': 'ideology-jihadist',
  'far-right': 'ideology-far-right',
  'far-left': 'ideology-far-left',
  ethnonationalist: 'ideology-ethnonationalist',
  'eco-terrorist': 'ideology-eco',
  'religious-cult': 'ideology-cult',
  anarchist: 'ideology-anarchist',
};

export function getByIdeology(
  groups: ExtremistGroup[],
  ideology: ExtremistGroup['ideology'],
): ExtremistGroup[] {
  return groups.filter((g) => g.ideology === ideology);
}

export function getByThreatLevel(
  groups: ExtremistGroup[],
  level: ExtremistGroup['threatLevel'],
): ExtremistGroup[] {
  return groups.filter((g) => g.threatLevel === level);
}

export function getGrowingGroups(groups: ExtremistGroup[]): ExtremistGroup[] {
  return groups.filter((g) => g.trend === 'growing');
}

export function getStateSponsoredGroups(groups: ExtremistGroup[]): ExtremistGroup[] {
  return groups.filter((g) => g.financingType === 'state-sponsor');
}

export function getMajorEvents(events: ExtremismEvent[]): ExtremismEvent[] {
  return events.filter((e) => e.significance === 'major');
}

export function computeGlobalExtremismThreatIndex(groups: ExtremistGroup[]): number {
  if (groups.length === 0) return 0;
  let sum = 0;
  for (const g of groups) {
    const weight = THREAT_WEIGHT[g.threatLevel];
    sum += g.trend === 'growing' ? weight * GROWING_MULTIPLIER : weight;
  }
  const maxPossibleSum = groups.length * MAX_WEIGHT * GROWING_MULTIPLIER;
  const index = Math.round((sum / maxPossibleSum) * 100);
  return Math.max(0, Math.min(100, index));
}

export function threatLevelClass(level: ExtremistGroup['threatLevel']): string {
  return THREAT_LEVEL_CLASS[level] ?? 'severity-medium';
}

export function ideologyClass(ideology: ExtremistGroup['ideology']): string {
  return IDEOLOGY_CLASS[ideology] ?? 'ideology-other';
}

export function buildRenderData(): ExtremismData {
  return {
    groups: [...EXTREMIST_GROUPS],
    recentEvents: [...EXTREMISM_EVENTS],
    lastUpdated: '2024-Q4',
    globalExtremismThreatIndex: computeGlobalExtremismThreatIndex(EXTREMIST_GROUPS),
  };
}
