// media-freedom-helpers.ts
// Pure logic for MediaFreedomPanel — no DOM, no Panel imports

export type FreedomCategory = 'Free' | 'Good' | 'Satisfactory' | 'Problematic' | 'Difficult' | 'Very Serious';
export type FreedomTrend = 'improving' | 'stable' | 'declining';

export interface CountryFreedom {
  id: string;
  country: string;
  rsfScore: number;          // RSF Press Freedom Index 0-100, higher = more free
  category: FreedomCategory;
  trend: FreedomTrend;
  journalistsJailed: number; // CPJ 2024
  notes: string;
  population: number;        // millions
}

export interface MediaIncident {
  id: string;
  date: string;
  country: string;
  subject: string;
  type: 'Journalist Arrest' | 'Journalist Death' | 'Media Ban' | 'Extradition' | 'War Zone';
  description: string;
  status: 'Ongoing' | 'Resolved' | 'Escalating';
  severity: number; // 1-10
}

export interface MediaFreedomRenderData {
  countries: CountryFreedom[];
  incidents: MediaIncident[];
  globalFreedomIndex: number;
  freeCount: number;
  goodCount: number;
  satisfactoryCount: number;
  problematicCount: number;
  difficultCount: number;
  verySeriousCount: number;
  totalJailed: number;
  decliningCount: number;
  highRisk: CountryFreedom[];
}

const COUNTRIES: CountryFreedom[] = [
  { id: 'MF001', country: 'Norway',       rsfScore: 95, category: 'Free',         trend: 'stable',    journalistsJailed: 0,   notes: 'Consistent world leader; public broadcaster NRK editorially independent',    population: 5.5  },
  { id: 'MF002', country: 'Finland',      rsfScore: 94, category: 'Free',         trend: 'stable',    journalistsJailed: 0,   notes: 'Strong public media funding; near-absolute press freedom legally',             population: 5.5  },
  { id: 'MF003', country: 'Denmark',      rsfScore: 93, category: 'Free',         trend: 'stable',    journalistsJailed: 0,   notes: 'Transparent governance; robust shield laws; no journalist imprisoned',         population: 5.9  },
  { id: 'MF004', country: 'Germany',      rsfScore: 79, category: 'Good',         trend: 'stable',    journalistsJailed: 0,   notes: 'Strong legal protections; far-right harassment of press increasing',           population: 84   },
  { id: 'MF005', country: 'UK',           rsfScore: 74, category: 'Satisfactory', trend: 'stable',    journalistsJailed: 0,   notes: 'Libel tourism concerns; Assange extradition case damaged global standing',    population: 67   },
  { id: 'MF006', country: 'France',       rsfScore: 72, category: 'Satisfactory', trend: 'stable',    journalistsJailed: 0,   notes: 'Yellow vest coverage restrictions; journalist surveillance cases reported',    population: 68   },
  { id: 'MF007', country: 'USA',          rsfScore: 66, category: 'Satisfactory', trend: 'declining', journalistsJailed: 0,   notes: 'Declining trust; shield law gaps; Assange Espionage Act precedent concerns',  population: 335  },
  { id: 'MF008', country: 'Israel',       rsfScore: 55, category: 'Problematic',  trend: 'declining', journalistsJailed: 2,   notes: 'Wartime press restrictions; Al Jazeera ban; 100+ Gaza journalist deaths',     population: 9.7  },
  { id: 'MF009', country: 'Mexico',       rsfScore: 47, category: 'Difficult',    trend: 'declining', journalistsJailed: 0,   notes: 'Most dangerous country for journalists in Americas; cartel-linked murders',  population: 130  },
  { id: 'MF010', country: 'India',        rsfScore: 31, category: 'Difficult',    trend: 'declining', journalistsJailed: 4,   notes: 'Steep decline under BJP; SLAPP suits; digital surveillance of journalists',   population: 1440 },
  { id: 'MF011', country: 'Turkey',       rsfScore: 29, category: 'Difficult',    trend: 'stable',    journalistsJailed: 17,  notes: 'Courts weaponized against press; one of the world top jailers of journalists', population: 85   },
  { id: 'MF012', country: 'Saudi Arabia', rsfScore: 17, category: 'Very Serious', trend: 'stable',    journalistsJailed: 32,  notes: 'Khashoggi murder 2018; total state media control; bloggers imprisoned',       population: 36   },
  { id: 'MF013', country: 'Myanmar',      rsfScore: 19, category: 'Very Serious', trend: 'declining', journalistsJailed: 60,  notes: 'Post-coup 2021 crackdown; second-most jailed journalists globally (CPJ)',     population: 54   },
  { id: 'MF014', country: 'Iran',         rsfScore: 14, category: 'Very Serious', trend: 'declining', journalistsJailed: 22,  notes: 'Post-Mahsa Amini crackdown 2022-2024; journalists face death penalty',        population: 87   },
  { id: 'MF015', country: 'Russia',       rsfScore: 9,  category: 'Very Serious', trend: 'declining', journalistsJailed: 22,  notes: 'Wartime media blackout; Gershkovich arrested 2023; Novaya Gazeta suspended',  population: 145  },
  { id: 'MF016', country: 'China',        rsfScore: 8,  category: 'Very Serious', trend: 'stable',    journalistsJailed: 100, notes: 'Most jailed journalists globally; Great Firewall; foreign press expelled',    population: 1410 },
  { id: 'MF017', country: 'North Korea',  rsfScore: 2,  category: 'Very Serious', trend: 'stable',    journalistsJailed: 0,   notes: 'No free press exists; all media state-controlled; journalists face execution', population: 26   },
];

const INCIDENTS: MediaIncident[] = [
  {
    id: 'MI001', date: '2023-03-29', country: 'Russia', subject: 'Evan Gershkovich',
    type: 'Journalist Arrest',
    description: 'Wall Street Journal reporter Evan Gershkovich arrested on espionage charges — first US journalist detained in Russia since Cold War. Held 491 days before August 2024 prisoner exchange.',
    status: 'Resolved', severity: 9,
  },
  {
    id: 'MI002', date: '2023-10-07', country: 'Israel/Gaza', subject: 'Gaza Journalist Deaths',
    type: 'War Zone',
    description: 'Over 100 journalists killed in Gaza since October 2023 — highest journalist death toll for any single conflict in recorded CPJ history (2024). Majority are Palestinian press members.',
    status: 'Ongoing', severity: 10,
  },
  {
    id: 'MI003', date: '2024-06-26', country: 'UK/Australia', subject: 'Julian Assange',
    type: 'Extradition',
    description: 'Julian Assange accepted plea deal with US DOJ under Espionage Act; returned to Australia as free man after 14-year legal battle. Sets contested precedent for publication of classified material.',
    status: 'Resolved', severity: 8,
  },
  {
    id: 'MI004', date: '2024-08-05', country: 'Israel', subject: 'Al Jazeera Operating Ban',
    type: 'Media Ban',
    description: 'Israel extended ban on Al Jazeera network; accused of inciting violence. CPJ and RSF condemned the ban as silencing wartime coverage. Station continued reporting from outside Israel.',
    status: 'Ongoing', severity: 7,
  },
  {
    id: 'MI005', date: '2024-01-15', country: 'Iran', subject: 'Post-Mahsa Journalists',
    type: 'Journalist Arrest',
    description: 'Iran arrested multiple journalists covering Mahsa Amini anniversary protests. At least 22 journalists in detention as of 2024; several face death penalty charges.',
    status: 'Ongoing', severity: 8,
  },
  {
    id: 'MI006', date: '2024-03-10', country: 'Mexico', subject: 'Journalist Murders Q1 2024',
    type: 'Journalist Death',
    description: 'Three journalist murders in Q1 2024, continuing pattern of cartel-linked killings. Mexico ranks as deadliest country for press in Americas; 30+ journalists killed in 2022-2024.',
    status: 'Ongoing', severity: 9,
  },
];

export function computeGlobalFreedomIndex(countries: CountryFreedom[]): number {
  if (!countries.length) return 0;
  const totalPop = countries.reduce((s, c) => s + c.population, 0);
  const weighted = countries.reduce((s, c) => s + c.rsfScore * c.population, 0);
  return Math.round(weighted / totalPop);
}

export function getByCategory(countries: CountryFreedom[], category: FreedomCategory): CountryFreedom[] {
  return countries.filter(c => c.category === category);
}

export function getDecliningCountries(countries: CountryFreedom[]): CountryFreedom[] {
  return countries.filter(c => c.trend === 'declining');
}

export function getMostJailed(countries: CountryFreedom[], n = 5): CountryFreedom[] {
  return [...countries]
    .filter(c => c.journalistsJailed > 0)
    .sort((a, b) => b.journalistsJailed - a.journalistsJailed)
    .slice(0, n);
}

export function getHighRiskCountries(countries: CountryFreedom[]): CountryFreedom[] {
  return countries.filter(c => c.category === 'Very Serious' || c.category === 'Difficult');
}

export function freedomClass(category: FreedomCategory): string {
  const map: Record<FreedomCategory, string> = {
    'Free':         'mf-free',
    'Good':         'mf-good',
    'Satisfactory': 'mf-satisfactory',
    'Problematic':  'mf-problematic',
    'Difficult':    'mf-difficult',
    'Very Serious': 'mf-very-serious',
  };
  return map[category] ?? 'mf-satisfactory';
}

export function trendClass(trend: FreedomTrend): string {
  const map: Record<FreedomTrend, string> = {
    'improving': 'trend-up',
    'stable':    'trend-flat',
    'declining': 'trend-down',
  };
  return map[trend] ?? 'trend-flat';
}

export function trendArrow(trend: FreedomTrend): string {
  return { improving: '↑', stable: '→', declining: '↓' }[trend] ?? '→';
}

export function incidentStatusClass(status: MediaIncident['status']): string {
  const map: Record<string, string> = {
    'Resolved':   'incident-resolved',
    'Ongoing':    'incident-ongoing',
    'Escalating': 'incident-escalating',
  };
  return map[status] ?? 'incident-ongoing';
}

export function buildRenderData(): MediaFreedomRenderData {
  const totalJailed = COUNTRIES.reduce((s, c) => s + c.journalistsJailed, 0);
  return {
    countries: COUNTRIES,
    incidents: INCIDENTS,
    globalFreedomIndex: computeGlobalFreedomIndex(COUNTRIES),
    freeCount:         getByCategory(COUNTRIES, 'Free').length,
    goodCount:         getByCategory(COUNTRIES, 'Good').length,
    satisfactoryCount: getByCategory(COUNTRIES, 'Satisfactory').length,
    problematicCount:  getByCategory(COUNTRIES, 'Problematic').length,
    difficultCount:    getByCategory(COUNTRIES, 'Difficult').length,
    verySeriousCount:  getByCategory(COUNTRIES, 'Very Serious').length,
    totalJailed,
    decliningCount: getDecliningCountries(COUNTRIES).length,
    highRisk: getHighRiskCountries(COUNTRIES),
  };
}
