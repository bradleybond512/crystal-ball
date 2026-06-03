// drone-warfare-helpers.ts
// Pure logic for DroneWarfarePanel — no DOM, no Panel imports

export type DroneType = 'Military' | 'Commercial' | 'Both';
export type MaturityLevel = 'Advanced' | 'Developing' | 'Nascent';
export type IncidentType = 'Strike' | 'Swarm Attack' | 'Surveillance' | 'Supply' | 'Kamikaze';

export interface DroneProgram {
  country: string;
  type: DroneType;
  maturityLevel: MaturityLevel;
  keyPlatforms: string[];
  combatExperience: boolean;
  exportingTo: string[];
  description: string;
}

export interface DroneIncident {
  id: string;
  date: string;
  actor: string;
  target: string;
  platform: string;
  type: IncidentType;
  region: string;
  casualties: number;
  significance: number; // 1-10
  description: string;
  ongoing: boolean;
}

export interface DroneRenderData {
  programs: DroneProgram[];
  incidents: DroneIncident[];
  globalDroneIndex: number;
  proliferationScore: number;
  combatUsageScore: number;
  topActors: string[];
}

const PROGRAMS: DroneProgram[] = [
  {
    country: 'USA',
    type: 'Military',
    maturityLevel: 'Advanced',
    keyPlatforms: ['MQ-9 Reaper', 'RQ-4 Global Hawk', 'Switchblade'],
    combatExperience: true,
    exportingTo: ['UK', 'Australia', 'India'],
    description: 'World leader in military drone development; ISR and strike capabilities across all domains.',
  },
  {
    country: 'China',
    type: 'Both',
    maturityLevel: 'Advanced',
    keyPlatforms: ['Wing Loong', 'CH-4', 'TB001'],
    combatExperience: true,
    exportingTo: [
      'Saudi Arabia', 'UAE', 'Iraq', 'Nigeria', 'Ethiopia', 'Pakistan', 'Jordan', 'Myanmar',
      'Serbia', 'Egypt', 'Morocco', 'Algeria', 'Turkey', 'Sudan', 'Bangladesh', 'Kenya',
      'Zambia', 'Cameroon', 'Namibia', 'Senegal',
    ],
    description: 'Rapidly expanding military and commercial drone sector; major global exporter to 20+ countries.',
  },
  {
    country: 'Turkey',
    type: 'Military',
    maturityLevel: 'Advanced',
    keyPlatforms: ['Bayraktar TB2', 'Ak\u0131nc\u0131'],
    combatExperience: true,
    exportingTo: ['Ukraine', 'Azerbaijan', 'Qatar', 'Morocco', 'Ethiopia', 'Libya', 'Kyrgyzstan', 'Albania', 'Latvia', 'Lithuania', 'Estonia'],
    description: 'Bayraktar TB2 transformed modern warfare in Ukraine, Libya, and Nagorno-Karabakh; growing export market.',
  },
  {
    country: 'Iran',
    type: 'Military',
    maturityLevel: 'Developing',
    keyPlatforms: ['Shahed-136', 'Mohajer'],
    combatExperience: true,
    exportingTo: ['Russia', 'Hamas', 'Hezbollah'],
    description: 'Loitering munitions exported to Russia for Ukraine war; proxy networks armed with Shahed variants.',
  },
  {
    country: 'Israel',
    type: 'Military',
    maturityLevel: 'Advanced',
    keyPlatforms: ['Harop', 'Hermes 900', 'Heron'],
    combatExperience: true,
    exportingTo: ['India', 'Azerbaijan', 'Germany', 'France', 'Brazil', 'Colombia', 'Philippines'],
    description: 'Pioneer in loitering munitions and ISR drones; extensive combat testing in Gaza and Syria.',
  },
  {
    country: 'Russia',
    type: 'Military',
    maturityLevel: 'Developing',
    keyPlatforms: ['Orlan-10', 'Lancet', 'Shahed variants'],
    combatExperience: true,
    exportingTo: [],
    description: 'Heavy reliance on Iranian-supplied Shaheds; domestic Lancet loitering munition effective against armor.',
  },
  {
    country: 'Ukraine',
    type: 'Both',
    maturityLevel: 'Developing',
    keyPlatforms: ['Magura V5', 'FPV drones', 'custom kamikaze'],
    combatExperience: true,
    exportingTo: [],
    description: 'Pioneering civilian-to-military drone conversion at scale; naval drone attacks on Black Sea fleet.',
  },
  {
    country: 'Houthi (non-state)',
    type: 'Military',
    maturityLevel: 'Nascent',
    keyPlatforms: ['Shahed variants (Iranian-supplied)'],
    combatExperience: true,
    exportingTo: [],
    description: 'Iranian-supplied drones and missiles; Red Sea shipping disruption campaign 2023\u20132024.',
  },
];

const INCIDENTS: DroneIncident[] = [
  {
    id: 'DI001',
    date: '2024-01-01',
    actor: 'Houthis',
    target: 'Commercial shipping (Red Sea)',
    platform: 'Shahed variants',
    type: 'Swarm Attack',
    region: 'Middle East',
    casualties: 3,
    significance: 9,
    description: 'Houthi drone and missile swarm attacks on international shipping lanes in Red Sea; forced global rerouting.',
    ongoing: true,
  },
  {
    id: 'DI002',
    date: '2022-09-12',
    actor: 'Russia',
    target: 'Ukrainian cities',
    platform: 'Shahed-136',
    type: 'Kamikaze',
    region: 'Europe',
    casualties: 500,
    significance: 10,
    description: 'Russia launched mass Shahed-136 kamikaze drone attacks on Ukrainian energy infrastructure and cities.',
    ongoing: true,
  },
  {
    id: 'DI003',
    date: '2023-07-17',
    actor: 'Ukraine',
    target: 'Russian Black Sea Fleet, Sevastopol',
    platform: 'Sea Baby USV',
    type: 'Strike',
    region: 'Europe',
    casualties: 1,
    significance: 8,
    description: 'Ukrainian Sea Baby drone boat attacked Russian fleet in Sevastopol harbor; damaged warships.',
    ongoing: false,
  },
  {
    id: 'DI004',
    date: '2020-10-01',
    actor: 'Azerbaijan',
    target: 'Armenian military units, Nagorno-Karabakh',
    platform: 'Bayraktar TB2',
    type: 'Strike',
    region: 'Europe',
    casualties: 2000,
    significance: 9,
    description: 'TB2 drones devastated Armenian armor and air defenses; transformed the 44-day war outcome.',
    ongoing: false,
  },
  {
    id: 'DI005',
    date: '2024-03-01',
    actor: 'Houthis',
    target: 'USA MQ-9 Reaper (international airspace)',
    platform: 'Surface-to-air missile vs MQ-9',
    type: 'Surveillance',
    region: 'Middle East',
    casualties: 0,
    significance: 7,
    description: 'Houthis shot down a US Navy MQ-9 Reaper over the Red Sea, demonstrating IADS capability against ISR drones.',
    ongoing: false,
  },
  {
    id: 'DI006',
    date: '2023-10-07',
    actor: 'Hamas',
    target: 'Israeli military positions',
    platform: 'Modified commercial drones',
    type: 'Strike',
    region: 'Middle East',
    casualties: 50,
    significance: 8,
    description: 'Hamas used drone-dropped munitions to disable Iron Dome radar systems during Oct 7 attack.',
    ongoing: false,
  },
  {
    id: 'DI007',
    date: '2024-01-28',
    actor: 'Iran-aligned militia',
    target: 'US base Tower 22, Al-Asad, Jordan',
    platform: 'Iranian one-way attack drone',
    type: 'Strike',
    region: 'Middle East',
    casualties: 3,
    significance: 7,
    description: 'Iran-backed militia drone strike killed 3 US soldiers at Tower 22 base in Jordan; triggered US retaliatory strikes.',
    ongoing: false,
  },
  {
    id: 'DI008',
    date: '2023-06-01',
    actor: 'Ukraine',
    target: 'Russian armored vehicles',
    platform: 'FPV kamikaze drones',
    type: 'Swarm Attack',
    region: 'Europe',
    casualties: 100,
    significance: 8,
    description: 'Ukrainian FPV drone swarms became primary anti-armor weapon; low-cost consumer drones modified for combat.',
    ongoing: true,
  },
  {
    id: 'DI009',
    date: '2023-09-01',
    actor: 'Russia',
    target: 'Ukrainian armored vehicles and artillery',
    platform: 'Lancet loitering munition',
    type: 'Strike',
    region: 'Europe',
    casualties: 0,
    significance: 7,
    description: 'Russian Lancet loitering munitions achieved high kill rates against Western-supplied armor in Ukraine.',
    ongoing: true,
  },
  {
    id: 'DI010',
    date: '2024-08-01',
    actor: 'China (PLA)',
    target: 'Taiwan Strait / Taiwan airspace',
    platform: 'BZK-005 / TB001',
    type: 'Surveillance',
    region: 'Asia',
    casualties: 0,
    significance: 7,
    description: 'PLA drones repeatedly entered Taiwan ADIZ for surveillance; frequency increased through 2024.',
    ongoing: true,
  },
  {
    id: 'DI011',
    date: '2024-06-01',
    actor: 'Hezbollah',
    target: 'Northern Israel military bases',
    platform: 'Iranian-supplied Shahed variants',
    type: 'Strike',
    region: 'Middle East',
    casualties: 12,
    significance: 7,
    description: 'Hezbollah drone campaign against northern Israel intensified; displaced 100,000 civilians.',
    ongoing: true,
  },
  {
    id: 'DI012',
    date: '2024-03-01',
    actor: 'Ukraine',
    target: 'Russian warships and oil tankers, Black Sea',
    platform: 'Magura V5',
    type: 'Strike',
    region: 'Europe',
    casualties: 20,
    significance: 8,
    description: 'Magura V5 naval drones sank or damaged Russian warships; forced partial Black Sea Fleet withdrawal.',
    ongoing: true,
  },
];

export function getByType(programs: DroneProgram[], type: DroneType): DroneProgram[] {
  return programs.filter(p => p.type === type);
}

export function getCombatExperienced(programs: DroneProgram[]): DroneProgram[] {
  return programs.filter(p => p.combatExperience);
}

export function getHighSignificanceIncidents(incidents: DroneIncident[], threshold = 8): DroneIncident[] {
  return incidents.filter(i => i.significance >= threshold);
}

export function getOngoingIncidents(incidents: DroneIncident[]): DroneIncident[] {
  return incidents.filter(i => i.ongoing);
}

export function computeGlobalDroneIndex(programs: DroneProgram[], incidents: DroneIncident[]): number {
  if (!programs.length) return 0;
  const combatPct = programs.filter(p => p.combatExperience).length / programs.length;
  const advancedPct = programs.filter(p => p.maturityLevel === 'Advanced').length / programs.length;
  const avgSig = incidents.length
    ? incidents.reduce((s, i) => s + i.significance, 0) / incidents.length
    : 0;
  return Math.min(100, Math.round(combatPct * 30 + advancedPct * 30 + (avgSig / 10) * 40));
}

export function proliferationClass(maturity: MaturityLevel): string {
  const map: Record<MaturityLevel, string> = {
    Advanced: 'drone-advanced',
    Developing: 'drone-developing',
    Nascent: 'drone-nascent',
  };
  return map[maturity] ?? 'drone-nascent';
}

export function maturityClass(maturity: MaturityLevel): string {
  return proliferationClass(maturity);
}

export function incidentTypeClass(type: IncidentType): string {
  const map: Record<IncidentType, string> = {
    Strike: 'itype-strike',
    'Swarm Attack': 'itype-swarm',
    Surveillance: 'itype-surveillance',
    Supply: 'itype-supply',
    Kamikaze: 'itype-kamikaze',
  };
  return map[type] ?? 'itype-strike';
}

export function buildRenderData(): DroneRenderData {
  const proliferationScore = Math.round(
    (PROGRAMS.filter(p => p.exportingTo.length > 0).length / PROGRAMS.length) * 100,
  );
  const combatUsageScore = Math.round(
    (PROGRAMS.filter(p => p.combatExperience).length / PROGRAMS.length) * 100,
  );
  const topActors = getCombatExperienced(PROGRAMS).map(p => p.country);
  return {
    programs: PROGRAMS,
    incidents: INCIDENTS,
    globalDroneIndex: computeGlobalDroneIndex(PROGRAMS, INCIDENTS),
    proliferationScore,
    combatUsageScore,
    topActors,
  };
}
