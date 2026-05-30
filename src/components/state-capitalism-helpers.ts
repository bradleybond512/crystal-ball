// state-capitalism-helpers.ts
// Pure logic for StateCapitalismPanel — no DOM, no Panel imports

export type StrategicFunction =
  | 'Energy Leverage'
  | 'Port Access'
  | 'Tech Espionage'
  | 'Sanctions Evasion'
  | 'Market Dominance'
  | 'Weapons Export'
  | 'Financial Control'
  | 'Nuclear / Energy Policy';

export type GeopoliticalRisk = 'Critical' | 'High' | 'Medium' | 'Low';

export type IncidentType =
  | 'Port Acquisition'
  | '5G Ban'
  | 'Energy Weaponization'
  | 'OPEC+ Decision'
  | 'Sanctions Evasion'
  | 'Market Dominance'
  | 'SOE Acquisition Blocked'
  | 'US Delisting';

export interface SOE {
  id: string;
  name: string;
  country: string;
  sector: string;
  revenueUSD: number; // billions USD
  strategicFunction: StrategicFunction;
  geopoliticalRisk: GeopoliticalRisk;
  description: string;
}

export interface SOEIncident {
  id: string;
  date: string;
  entity: string;
  country: string;
  incidentType: IncidentType;
  description: string;
  severity: number; // 1-10
}

export interface StateCapitalismCountry {
  country: string;
  code: string;
  index: number; // 0-100, higher = more state control of strategic economy
  description: string;
}

export interface StateCapitalismRenderData {
  soes: SOE[];
  incidents: SOEIncident[];
  stateCapitalismIndex: StateCapitalismCountry[];
  criticalCount: number;
  highRiskCount: number;
  totalRevenueTrillion: number;
  topCountryByControl: string;
}

// ── Static Data ───────────────────────────────────────────────────────────────

export const SOES: SOE[] = [
  {
    id: 'SOE001',
    name: 'CNOOC',
    country: 'China',
    sector: 'Oil & Gas',
    revenueUSD: 62,
    strategicFunction: 'Energy Leverage',
    geopoliticalRisk: 'Critical',
    description: 'US-listed then delisted in 2021 over national security concerns; controls strategic deepwater energy assets globally.',
  },
  {
    id: 'SOE002',
    name: 'COSCO Shipping',
    country: 'China',
    sector: 'Shipping & Ports',
    revenueUSD: 55,
    strategicFunction: 'Port Access',
    geopoliticalRisk: 'Critical',
    description: 'Controls or has stakes in 50+ ports globally; Long Beach terminal acquisition blocked by CFIUS in 2019.',
  },
  {
    id: 'SOE003',
    name: 'Huawei',
    country: 'China',
    sector: 'Telecommunications',
    revenueUSD: 92,
    strategicFunction: 'Tech Espionage',
    geopoliticalRisk: 'Critical',
    description: 'State-linked; 5G infrastructure banned in US, UK, Australia, EU members over backdoor espionage concerns.',
  },
  {
    id: 'SOE004',
    name: 'CATL',
    country: 'China',
    sector: 'Battery Technology',
    revenueUSD: 44,
    strategicFunction: 'Market Dominance',
    geopoliticalRisk: 'High',
    description: 'Controls ~37% of global EV battery market; strategic supply chain chokepoint for Western electrification.',
  },
  {
    id: 'SOE005',
    name: 'State Grid Corporation',
    country: 'China',
    sector: 'Energy Infrastructure',
    revenueUSD: 530,
    strategicFunction: 'Energy Leverage',
    geopoliticalRisk: 'High',
    description: "World's largest utility; attempted acquisition of Australian and European grid assets blocked on security grounds.",
  },
  {
    id: 'SOE006',
    name: 'Gazprom',
    country: 'Russia',
    sector: 'Natural Gas',
    revenueUSD: 120,
    strategicFunction: 'Energy Leverage',
    geopoliticalRisk: 'Critical',
    description: 'Used as primary energy weaponization tool against Europe; Nord Stream operator; supply cuts as coercive diplomacy.',
  },
  {
    id: 'SOE007',
    name: 'Rosneft',
    country: 'Russia',
    sector: 'Oil',
    revenueUSD: 130,
    strategicFunction: 'Sanctions Evasion',
    geopoliticalRisk: 'Critical',
    description: 'Routes oil through shadow fleet to India, China, Turkey; primary mechanism for evading Western energy sanctions.',
  },
  {
    id: 'SOE008',
    name: 'Rostec',
    country: 'Russia',
    sector: 'Defense & Manufacturing',
    revenueUSD: 25,
    strategicFunction: 'Weapons Export',
    geopoliticalRisk: 'Critical',
    description: 'State defense conglomerate; supplies arms to Africa, Middle East, Asia; directly sanctioned by US/EU.',
  },
  {
    id: 'SOE009',
    name: 'Sberbank',
    country: 'Russia',
    sector: 'Banking & Finance',
    revenueUSD: 18,
    strategicFunction: 'Financial Control',
    geopoliticalRisk: 'Critical',
    description: "Russia's largest bank; fully sanctioned post-2022; used for financing war economy and circumventing SWIFT.",
  },
  {
    id: 'SOE010',
    name: 'Saudi Aramco',
    country: 'Saudi Arabia',
    sector: 'Oil & Gas',
    revenueUSD: 440,
    strategicFunction: 'Energy Leverage',
    geopoliticalRisk: 'High',
    description: '$2T valuation; OPEC+ production decisions used as geopolitical tool against Western energy policy objectives.',
  },
  {
    id: 'SOE011',
    name: 'ADNOC / Mubadala',
    country: 'UAE',
    sector: 'Oil, Gas & Sovereign Investment',
    revenueUSD: 80,
    strategicFunction: 'Market Dominance',
    geopoliticalRisk: 'Medium',
    description: 'Strategic investments across tech, defense, and critical infrastructure in Western economies via Mubadala.',
  },
  {
    id: 'SOE012',
    name: 'EDF',
    country: 'France',
    sector: 'Nuclear Energy',
    revenueUSD: 92,
    strategicFunction: 'Nuclear / Energy Policy',
    geopoliticalRisk: 'Low',
    description: 'Re-nationalized 2023; cornerstone of French energy sovereignty and EU nuclear diplomacy.',
  },
];

export const SOE_INCIDENTS: SOEIncident[] = [
  {
    id: 'INC001',
    date: '2019-05',
    entity: 'COSCO / Orient Overseas',
    country: 'USA',
    incidentType: 'Port Acquisition',
    description: "CFIUS blocked COSCO's Long Beach terminal acquisition; raised concerns about PLA access to US port infrastructure.",
    severity: 8,
  },
  {
    id: 'INC002',
    date: '2020-08',
    entity: 'Huawei',
    country: 'USA',
    incidentType: '5G Ban',
    description: 'US FCC designated Huawei a national security threat; $1.9B removal and replacement program launched.',
    severity: 9,
  },
  {
    id: 'INC003',
    date: '2021-12',
    entity: 'CNOOC',
    country: 'USA',
    incidentType: 'US Delisting',
    description: 'NYSE delisted CNOOC following Trump executive order; part of broader campaign against Chinese military-linked companies.',
    severity: 7,
  },
  {
    id: 'INC004',
    date: '2022-08',
    entity: 'Gazprom',
    country: 'Germany',
    incidentType: 'Energy Weaponization',
    description: 'Gazprom cut Nord Stream 1 flows to 20% then zero; Germany faced energy crisis; European governments scrambled for LNG alternatives.',
    severity: 10,
  },
  {
    id: 'INC005',
    date: '2023-06',
    entity: 'Saudi Aramco / OPEC+',
    country: 'Global',
    incidentType: 'OPEC+ Decision',
    description: "Saudi Arabia announced voluntary 1M bpd cut; tensions with US over refusal to increase production amid Ukraine war.",
    severity: 7,
  },
  {
    id: 'INC006',
    date: '2023-10',
    entity: 'Rosneft',
    country: 'India',
    incidentType: 'Sanctions Evasion',
    description: "India's Rosneft purchases rose 40% YoY; shadow fleet of 600+ tankers used to circumvent G7 price cap mechanisms.",
    severity: 8,
  },
  {
    id: 'INC007',
    date: '2024-01',
    entity: 'CATL',
    country: 'USA',
    incidentType: 'Market Dominance',
    description: 'Pentagon added CATL to "Chinese military company" list; threatens US EV supply chain dependent on Chinese battery dominance.',
    severity: 8,
  },
  {
    id: 'INC008',
    date: '2024-06',
    entity: 'China SOEs',
    country: 'Multiple',
    incidentType: 'SOE Acquisition Blocked',
    description: 'Multiple EU nations blocked Chinese SOE infrastructure acquisitions in ports, telecom, and energy sectors under FDI screening rules.',
    severity: 6,
  },
];

export const STATE_CAPITALISM_INDEX: StateCapitalismCountry[] = [
  { country: 'China',        code: 'CN', index: 92, description: 'Party-state controls commanding heights; SOEs cover energy, finance, telecom, transport' },
  { country: 'Russia',       code: 'RU', index: 85, description: 'Oligarchic-state hybrid; Kremlin controls energy majors, state bank, defense industry' },
  { country: 'Saudi Arabia', code: 'SA', index: 78, description: 'Aramco dominates economy; Vision 2030 diversification via sovereign funds' },
  { country: 'UAE',          code: 'AE', index: 70, description: 'Abu Dhabi sovereign funds (Mubadala, ADIA) strategically deployed globally' },
  { country: 'Vietnam',      code: 'VN', index: 68, description: 'Party-directed SOEs in energy, finance; gradualist market reforms' },
  { country: 'France',       code: 'FR', index: 45, description: 'Strategic sectors (nuclear, rail, defense) retain state ownership; EDF renationalized' },
  { country: 'South Korea',  code: 'KR', index: 38, description: 'Chaebol system with informal state coordination; POSCO, Korea Electric Power' },
  { country: 'Brazil',       code: 'BR', index: 35, description: 'Petrobras as strategic asset; Lula government increasing state role in energy' },
  { country: 'Germany',      code: 'DE', index: 22, description: 'Limited SOEs; post-Gazprom crisis partial renationalization of Uniper' },
  { country: 'USA',          code: 'US', index: 12, description: 'Minimal SOEs; strategic industries shaped via regulation and export controls' },
];

// ── Helper functions ───────────────────────────────────────────────────────────

export function getByCountry(soes: SOE[], country: string): SOE[] {
  return soes.filter(s => s.country === country);
}

export function getByFunction(soes: SOE[], fn: StrategicFunction): SOE[] {
  return soes.filter(s => s.strategicFunction === fn);
}

export function getHighRisk(soes: SOE[]): SOE[] {
  return soes.filter(s => s.geopoliticalRisk === 'Critical' || s.geopoliticalRisk === 'High');
}

export function computeStateCapitalismIndex(countries: StateCapitalismCountry[]): number {
  if (countries.length === 0) return 0;
  const sum = countries.reduce((acc, c) => acc + c.index, 0);
  return Math.round(sum / countries.length);
}

export function functionClass(fn: StrategicFunction): string {
  switch (fn) {
    case 'Energy Leverage':         return 'sc-func-energy';
    case 'Port Access':             return 'sc-func-port';
    case 'Tech Espionage':          return 'sc-func-tech';
    case 'Sanctions Evasion':       return 'sc-func-sanctions';
    case 'Market Dominance':        return 'sc-func-market';
    case 'Weapons Export':          return 'sc-func-weapons';
    case 'Financial Control':       return 'sc-func-finance';
    case 'Nuclear / Energy Policy': return 'sc-func-nuclear';
    default:                        return 'sc-func-other';
  }
}

export function riskClass(risk: GeopoliticalRisk): string {
  switch (risk) {
    case 'Critical': return 'sc-risk-critical';
    case 'High':     return 'sc-risk-high';
    case 'Medium':   return 'sc-risk-medium';
    case 'Low':      return 'sc-risk-low';
    default:         return '';
  }
}

export function buildRenderData(): StateCapitalismRenderData {
  const soes              = SOES;
  const incidents         = SOE_INCIDENTS;
  const stateCapitalismIndex = STATE_CAPITALISM_INDEX;

  const criticalCount        = soes.filter(s => s.geopoliticalRisk === 'Critical').length;
  const highRiskCount        = soes.filter(s => s.geopoliticalRisk === 'High').length;
  const totalRevenueTrillion = parseFloat(
    (soes.reduce((acc, s) => acc + s.revenueUSD, 0) / 1000).toFixed(1),
  );
  const topCountryByControl  = [...stateCapitalismIndex].sort((a, b) => b.index - a.index)[0]?.country ?? '';

  return {
    soes,
    incidents,
    stateCapitalismIndex,
    criticalCount,
    highRiskCount,
    totalRevenueTrillion,
    topCountryByControl,
  };
}
