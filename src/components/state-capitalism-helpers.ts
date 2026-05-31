// state-capitalism-helpers.ts
// Pure logic for StateCapitalismPanel — no DOM, no Panel imports

export type StrategicFunction =
  | 'Energy Leverage'
  | 'Port Access'
  | 'Tech Espionage'
  | 'Sanctions Evasion'
  | 'Market Dominance'
  | 'Defense Export';

export type GeopoliticalRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface StrategicSOE {
  id: string;
  name: string;
  country: string;
  sector: string;
  annualRevenueBn: number;
  strategicFunction: StrategicFunction;
  geopoliticalRiskLevel: GeopoliticalRiskLevel;
  description: string;
  recentIncident: string;
}

export interface SOEIncident {
  id: string;
  date: string;
  soe: string;
  incidentType: string;
  description: string;
  severity: number; // 1-10
}

export interface StateCapitalismRenderData {
  soes: StrategicSOE[];
  incidents: SOEIncident[];
  stateCapIndex: number;
  criticalRiskCount: number;
  highRiskCount: number;
  topCountryByControl: string;
}

const SOES: StrategicSOE[] = [
  {
    id: 'SOE001',
    name: 'COSCO Shipping',
    country: 'China',
    sector: 'Shipping / Ports',
    annualRevenueBn: 47,
    strategicFunction: 'Port Access',
    geopoliticalRiskLevel: 'Critical',
    description: "World's largest shipping company; operates or holds stakes in 50+ ports globally including strategic chokepoints.",
    recentIncident: 'Long Beach terminal acquisition blocked by CFIUS; global port acquisition strategy scrutinized by Five Eyes',
  },
  {
    id: 'SOE002',
    name: 'Huawei Technologies',
    country: 'China',
    sector: 'Telecommunications',
    annualRevenueBn: 99,
    strategicFunction: 'Tech Espionage',
    geopoliticalRiskLevel: 'Critical',
    description: 'State-linked telecom giant; 5G infrastructure embedded in 170+ countries; linked to PLA via founder and leadership.',
    recentIncident: '5G equipment banned across Five Eyes nations and EU; US Entity List since 2019; UK rip-and-replace order',
  },
  {
    id: 'SOE003',
    name: 'CNOOC',
    country: 'China',
    sector: 'Oil & Gas',
    annualRevenueBn: 55,
    strategicFunction: 'Market Dominance',
    geopoliticalRiskLevel: 'High',
    description: "China's largest offshore oil producer; extensive overseas drilling operations in contested waters.",
    recentIncident: 'Delisted from NYSE December 2021 on DoD military-company designation; US investment prohibited',
  },
  {
    id: 'SOE004',
    name: 'CATL',
    country: 'China',
    sector: 'Battery Manufacturing',
    annualRevenueBn: 44,
    strategicFunction: 'Market Dominance',
    geopoliticalRiskLevel: 'High',
    description: "Controls 37% of global EV battery market; near-monopoly on lithium iron phosphate cells; supply-chain leverage over Western automakers.",
    recentIncident: "Added to US DoD 'Chinese military company' list 2024; Ford licensing deal under congressional scrutiny",
  },
  {
    id: 'SOE005',
    name: 'Gazprom',
    country: 'Russia',
    sector: 'Natural Gas',
    annualRevenueBn: 120,
    strategicFunction: 'Energy Leverage',
    geopoliticalRiskLevel: 'Critical',
    description: 'State-owned gas monopoly; historically supplied 40% of EU gas; used as geopolitical coercion instrument by Kremlin.',
    recentIncident: 'Weaponized gas supply to Europe 2022; cut flows via Nord Stream 1; EU emergency energy measures activated',
  },
  {
    id: 'SOE006',
    name: 'Rosneft',
    country: 'Russia',
    sector: 'Oil',
    annualRevenueBn: 130,
    strategicFunction: 'Sanctions Evasion',
    geopoliticalRiskLevel: 'High',
    description: "Russia's largest oil producer; operates shadow fleet with India/China to circumvent G7 price cap.",
    recentIncident: 'India shadow fleet operations expanded 2023; G7 price cap routinely breached via ship-to-ship transfers',
  },
  {
    id: 'SOE007',
    name: 'Rostec',
    country: 'Russia',
    sector: 'Defense Manufacturing',
    annualRevenueBn: 23,
    strategicFunction: 'Defense Export',
    geopoliticalRiskLevel: 'High',
    description: 'State defense-industrial conglomerate; produces 80% of Russian military hardware; arms Iran, Syria, and sanctioned states.',
    recentIncident: 'OFAC sanctioned 2022; weapons transfers to Iran and DPRK documented; Shahed drone production partnership',
  },
  {
    id: 'SOE008',
    name: 'Saudi Aramco',
    country: 'Saudi Arabia',
    sector: 'Oil',
    annualRevenueBn: 440,
    strategicFunction: 'Energy Leverage',
    geopoliticalRiskLevel: 'High',
    description: "World's largest oil company; backbone of OPEC+ production coordination; $2T market cap instrument of Saudi Vision 2030.",
    recentIncident: 'OPEC+ unilateral production cut October 2023 defied Biden administration pressure; used as geopolitical counter-lever',
  },
  {
    id: 'SOE009',
    name: 'Mubadala Investment',
    country: 'UAE',
    sector: 'Sovereign Wealth / Tech',
    annualRevenueBn: 18,
    strategicFunction: 'Market Dominance',
    geopoliticalRiskLevel: 'Medium',
    description: 'Abu Dhabi SWF with $280B AUM; aggressive AI, semiconductor, and strategic-tech acquisitions globally.',
    recentIncident: 'Scrutinized for AI chip access deals with US firms amid UAE-China tech transfer concerns 2024',
  },
  {
    id: 'SOE010',
    name: 'EDF (Electricite de France)',
    country: 'France',
    sector: 'Nuclear Energy',
    annualRevenueBn: 143,
    strategicFunction: 'Energy Leverage',
    geopoliticalRiskLevel: 'Medium',
    description: 'Renationalized French nuclear utility; operates 56 reactors supplying 70% of French electricity; EU energy policy instrument.',
    recentIncident: 'French government fully renationalized EDF 2023; nuclear alliance used as EU energy sovereignty tool vs. gas dependency',
  },
  {
    id: 'SOE011',
    name: 'Samsung Electronics',
    country: 'South Korea',
    sector: 'Semiconductors / Consumer Tech',
    annualRevenueBn: 234,
    strategicFunction: 'Tech Espionage',
    geopoliticalRiskLevel: 'Medium',
    description: "South Korea's largest chaebol; dominant in DRAM, NAND, and advanced logic chips; caught between US CHIPS Act and China supply pressures.",
    recentIncident: 'US pressure to restrict China chip sales under CHIPS Act guardrails 2023; Chinese fab operations under scrutiny',
  },
  {
    id: 'SOE012',
    name: 'State Grid Corporation',
    country: 'China',
    sector: 'Electric Power',
    annualRevenueBn: 530,
    strategicFunction: 'Market Dominance',
    geopoliticalRiskLevel: 'High',
    description: "Controls 88% of Chinese power transmission; world's largest utility; overseas infrastructure investments in 13 countries.",
    recentIncident: 'Australian and Canadian overseas grid acquisitions blocked on national security grounds 2020-2021',
  },
];

const INCIDENTS: SOEIncident[] = [
  {
    id: 'INC001',
    date: '2021-11',
    soe: 'COSCO Shipping',
    incidentType: 'Foreign Investment Block',
    description: "CFIUS blocked COSCO's bid to acquire a terminal at the Port of Long Beach, citing national security risks from Chinese state control of US port infrastructure.",
    severity: 8,
  },
  {
    id: 'INC002',
    date: '2021-06',
    soe: 'Huawei Technologies',
    incidentType: 'Infrastructure Ban',
    description: 'US, UK, Australia, Canada, and Sweden finalized bans on Huawei 5G equipment. UK mandated rip-and-replace of existing Huawei kit by 2027.',
    severity: 9,
  },
  {
    id: 'INC003',
    date: '2022-08',
    soe: 'Gazprom',
    incidentType: 'Energy Weaponization',
    description: 'Gazprom halted gas flows through Nord Stream 1 citing turbine maintenance, triggering European energy crisis. Germany declared gas emergency.',
    severity: 10,
  },
  {
    id: 'INC004',
    date: '2023-10',
    soe: 'Saudi Aramco',
    incidentType: 'OPEC+ Production Cut',
    description: 'Saudi Arabia extended voluntary 1M bpd production cut through end 2023 despite White House pressure, highlighting Aramco geopolitical pricing power.',
    severity: 7,
  },
  {
    id: 'INC005',
    date: '2024-03',
    soe: 'CATL',
    incidentType: 'Sanctions / Designations',
    description: 'US Department of Defense added CATL to Chinese military company list; congressional scrutiny of Ford-CATL licensing deal; EU anti-subsidy investigation launched.',
    severity: 7,
  },
  {
    id: 'INC006',
    date: '2023-07',
    soe: 'Rosneft',
    incidentType: 'Sanctions Evasion',
    description: 'OFAC identified expanded Rosneft shadow fleet of 100+ tankers routing Russian oil through UAE and India to circumvent G7 price cap.',
    severity: 8,
  },
  {
    id: 'INC007',
    date: '2021-12',
    soe: 'CNOOC',
    incidentType: 'Exchange Delisting',
    description: 'NYSE delisted CNOOC following Biden executive order on military-company investments; cut off access to US capital markets.',
    severity: 7,
  },
  {
    id: 'INC008',
    date: '2021-04',
    soe: 'State Grid Corporation',
    incidentType: 'Foreign Investment Block',
    description: 'Australia blocked State Grid bid to acquire Ausgrid electricity network on FIRB national security grounds; Canada similarly blocked a State Grid subsidiary stake.',
    severity: 8,
  },
];

// State Capitalism Index by country (0-100; higher = more state-directed economy)
const STATE_CAP_INDEX: Record<string, number> = {
  China: 92,
  Russia: 88,
  'Saudi Arabia': 75,
  UAE: 65,
  France: 45,
  'South Korea': 35,
  USA: 20,
  Germany: 25,
};

// Approximate GDP weights in trillions for index weighting
const GDP_WEIGHTS: Record<string, number> = {
  China: 18,
  Russia: 2,
  'Saudi Arabia': 1,
  UAE: 0.5,
  France: 3,
  'South Korea': 2,
  USA: 27,
  Germany: 4,
};

export function getByCountry(soes: StrategicSOE[], country: string): StrategicSOE[] {
  return soes.filter((s) => s.country === country);
}

export function getByFunction(soes: StrategicSOE[], fn: StrategicFunction): StrategicSOE[] {
  return soes.filter((s) => s.strategicFunction === fn);
}

export function getCriticalRisk(soes: StrategicSOE[]): StrategicSOE[] {
  return soes.filter((s) => s.geopoliticalRiskLevel === 'Critical');
}

export function computeStateCapIndex(
  index: Record<string, number>,
  weights: Record<string, number>,
): number {
  const countries = Object.keys(index);
  if (!countries.length) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const c of countries) {
    const val = index[c];
    if (val === undefined) continue;
    const w = weights[c] ?? 1;
    weightedSum += val * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

export function topCountryBySoeCount(soes: StrategicSOE[]): string {
  if (!soes.length) return 'N/A';
  const counts: Record<string, number> = {};
  for (const s of soes) {
    counts[s.country] = (counts[s.country] ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'N/A';
}

export function functionClass(fn: StrategicFunction): string {
  switch (fn) {
    case 'Energy Leverage': { return 'fn-energy'; }
    case 'Port Access':     { return 'fn-port'; }
    case 'Tech Espionage':  { return 'fn-tech'; }
    case 'Sanctions Evasion': { return 'fn-sanctions'; }
    case 'Market Dominance': { return 'fn-market'; }
    case 'Defense Export':  { return 'fn-defense'; }
    default:                { return 'fn-unknown'; }
  }
}

export function riskClass(level: GeopoliticalRiskLevel): string {
  switch (level) {
    case 'Critical': { return 'risk-critical'; }
    case 'High':     { return 'risk-high'; }
    case 'Medium':   { return 'risk-medium'; }
    case 'Low':      { return 'risk-low'; }
    default:         { return 'risk-unknown'; }
  }
}

export function buildRenderData(): StateCapitalismRenderData {
  const soes = SOES;
  const incidents = INCIDENTS;
  const stateCapIndex = computeStateCapIndex(STATE_CAP_INDEX, GDP_WEIGHTS);
  const criticalRiskCount = soes.filter((s) => s.geopoliticalRiskLevel === 'Critical').length;
  const highRiskCount = soes.filter((s) => s.geopoliticalRiskLevel === 'High').length;
  const topCountryByControl = topCountryBySoeCount(soes);
  return { soes, incidents, stateCapIndex, criticalRiskCount, highRiskCount, topCountryByControl };
}
