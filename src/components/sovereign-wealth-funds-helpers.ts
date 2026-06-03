// sovereign-wealth-funds-helpers.ts
// Pure logic for SovereignWealthFundsPanel — no DOM, no Panel imports

export type Transparency = 'High' | 'Medium' | 'Low' | 'Opaque';
export type GeopoliticalRisk = 'Low' | 'Moderate' | 'High' | 'Critical';
export type StrategicFocus =
  | 'Diversified'
  | 'Strategic Acquisitions'
  | 'Tech & Defense'
  | 'Infrastructure & Ports'
  | 'Real Estate'
  | 'Sports & Media'
  | 'Energy Transition'
  | 'FX Reserves'
  | 'Conservative';

export type UsePattern =
  | 'Sports Washing'
  | 'Tech Acquisition'
  | 'Port & Infrastructure'
  | 'Media Influence'
  | 'Strategic Equity'
  | 'Sanctions Evasion'
  | 'Soft Power'
  | 'Diversification';

export interface SovereignWealthFund {
  id: string;
  name: string;
  country: string;
  aumBillions: number; // Assets under management in $B
  founded: number;
  strategicFocus: StrategicFocus;
  transparency: Transparency;
  geopoliticalRisk: GeopoliticalRisk;
  fundingSource: string;
  sanctioned: boolean;
  usePatterns: UsePattern[];
  notableHoldings: string[];
  recentDevelopment: string;
}

export interface StrategicInvestment {
  id: string;
  date: string;
  fund: string;
  target: string;
  sector: string;
  value: string;
  usePattern: UsePattern;
  geopoliticalSignal: string;
}

export interface SWFRenderData {
  funds: SovereignWealthFund[];
  investments: StrategicInvestment[];
  totalAumTrillions: number;
  highRiskCount: number;
  sanctionedCount: number;
  largestFund: SovereignWealthFund | null;
}

const FUNDS: SovereignWealthFund[] = [
  {
    id: 'SWF001',
    name: 'Norway GPFG',
    country: 'Norway',
    aumBillions: 1700,
    founded: 1990,
    strategicFocus: 'Diversified',
    transparency: 'High',
    geopoliticalRisk: 'Low',
    fundingSource: 'Oil & gas export revenue',
    sanctioned: false,
    usePatterns: ['Diversification', 'Soft Power'],
    notableHoldings: ['~9,000 global equities', '30+ country bonds', 'European real estate'],
    recentDevelopment:
      'Divested from coal and weapons manufacturers; ethical exclusion list expanded 2023; ' +
      'returned 16% in 2023 on equity rally.',
  },
  {
    id: 'SWF002',
    name: 'China Investment Corporation (CIC)',
    country: 'China',
    aumBillions: 1350,
    founded: 2007,
    strategicFocus: 'Strategic Acquisitions',
    transparency: 'Low',
    geopoliticalRisk: 'High',
    fundingSource: 'Foreign exchange reserves',
    sanctioned: false,
    usePatterns: ['Strategic Equity', 'Tech Acquisition', 'Port & Infrastructure'],
    notableHoldings: ['Blackstone stake', 'Morgan Stanley stake', 'Global infrastructure assets'],
    recentDevelopment:
      'Increased allocations to Belt & Road adjacent infrastructure; ' +
      'reduced US equity exposure amid tech decoupling tensions.',
  },
  {
    id: 'SWF003',
    name: 'Abu Dhabi Investment Authority (ADIA)',
    country: 'UAE',
    aumBillions: 993,
    founded: 1976,
    strategicFocus: 'Diversified',
    transparency: 'Medium',
    geopoliticalRisk: 'Moderate',
    fundingSource: 'Abu Dhabi oil revenues',
    sanctioned: false,
    usePatterns: ['Diversification', 'Strategic Equity'],
    notableHoldings: ['Global private equity', 'Infrastructure', 'Real estate across 40+ countries'],
    recentDevelopment:
      'Expanded AI and technology allocations 2023-2024; increased exposure to Indian markets; ' +
      'co-invested with G42 on AI infrastructure.',
  },
  {
    id: 'SWF004',
    name: 'Saudi Public Investment Fund (PIF)',
    country: 'Saudi Arabia',
    aumBillions: 700,
    founded: 1971,
    strategicFocus: 'Sports & Media',
    transparency: 'Low',
    geopoliticalRisk: 'High',
    fundingSource: 'Saudi Aramco dividend & oil revenues',
    sanctioned: false,
    usePatterns: ['Sports Washing', 'Tech Acquisition', 'Media Influence', 'Soft Power'],
    notableHoldings: [
      'Newcastle United FC',
      'LIV Golf',
      'Lucid Motors',
      'SoftBank Vision Fund LP',
      'Uber',
      'Nintendo stake',
    ],
    recentDevelopment:
      "Vision 2030 diversification drive; acquired Newcastle United 2021; launched LIV Golf 2022; " +
      "investing $40B+ in domestic projects; Aramco SABIC integration fueling PIF's capital base.",
  },
  {
    id: 'SWF005',
    name: 'Kuwait Investment Authority (KIA)',
    country: 'Kuwait',
    aumBillions: 750,
    founded: 1953,
    strategicFocus: 'Diversified',
    transparency: 'Medium',
    geopoliticalRisk: 'Low',
    fundingSource: 'Oil export revenues',
    sanctioned: false,
    usePatterns: ['Diversification'],
    notableHoldings: ['Daimler stake', 'BP stake', 'Citigroup stake', 'Global blue-chip equities'],
    recentDevelopment:
      "World's oldest SWF; conservative mandate preserved through Gulf political instability; " +
      'returned to growth after COVID drawdown.',
  },
  {
    id: 'SWF006',
    name: 'Singapore GIC',
    country: 'Singapore',
    aumBillions: 770,
    founded: 1981,
    strategicFocus: 'Diversified',
    transparency: 'Medium',
    geopoliticalRisk: 'Low',
    fundingSource: 'Government reserves',
    sanctioned: false,
    usePatterns: ['Diversification', 'Strategic Equity'],
    notableHoldings: ['UBS stake', 'Citigroup stake', 'Global private equity', 'Infrastructure'],
    recentDevelopment:
      'Increased private market allocations; invested in Indian digital infrastructure; ' +
      'professional institutional model widely emulated.',
  },
  {
    id: 'SWF007',
    name: 'Singapore Temasek',
    country: 'Singapore',
    aumBillions: 287,
    founded: 1974,
    strategicFocus: 'Tech & Defense',
    transparency: 'Medium',
    geopoliticalRisk: 'Low',
    fundingSource: 'Singapore government holdings',
    sanctioned: false,
    usePatterns: ['Tech Acquisition', 'Strategic Equity'],
    notableHoldings: ['Singapore Airlines', 'DBS Bank', 'Vertex Ventures', 'Global tech portfolio'],
    recentDevelopment:
      'Wrote down FTX exposure 2022; pivoted to climate and AI investments; ' +
      'Singapore Airlines fleet expansion backed by Temasek.',
  },
  {
    id: 'SWF008',
    name: 'Qatar Investment Authority (QIA)',
    country: 'Qatar',
    aumBillions: 475,
    founded: 2005,
    strategicFocus: 'Real Estate',
    transparency: 'Low',
    geopoliticalRisk: 'Moderate',
    fundingSource: 'LNG and natural gas revenues',
    sanctioned: false,
    usePatterns: ['Sports Washing', 'Strategic Equity', 'Port & Infrastructure', 'Soft Power'],
    notableHoldings: [
      'Paris Saint-Germain FC',
      'Glencore 20% stake',
      'Harrods',
      'The Shard (London)',
      'Volkswagen stake',
      'Barclays stake',
    ],
    recentDevelopment:
      'FIFA World Cup 2022 soft power play; Glencore stake gives commodity market influence; ' +
      'Western real estate portfolio facing higher-rate headwinds.',
  },
  {
    id: 'SWF009',
    name: 'UAE Mubadala',
    country: 'UAE',
    aumBillions: 284,
    founded: 2002,
    strategicFocus: 'Tech & Defense',
    transparency: 'Medium',
    geopoliticalRisk: 'Moderate',
    fundingSource: 'Abu Dhabi government',
    sanctioned: false,
    usePatterns: ['Tech Acquisition', 'Strategic Equity', 'Soft Power'],
    notableHoldings: [
      'G42 AI investments',
      'Globalfoundries',
      'Marvel Technology',
      'SoftBank Vision Fund LP',
      'Abu Dhabi defense contractors',
    ],
    recentDevelopment:
      'Deep partnership with G42 on AI infrastructure; Microsoft $1.5B investment in G42 2024; ' +
      'co-investing with US tech firms on UAE AI hub.',
  },
  {
    id: 'SWF010',
    name: 'Russia RDIF',
    country: 'Russia',
    aumBillions: 10,
    founded: 2011,
    strategicFocus: 'Strategic Acquisitions',
    transparency: 'Opaque',
    geopoliticalRisk: 'Critical',
    fundingSource: 'Government budget',
    sanctioned: true,
    usePatterns: ['Sanctions Evasion', 'Strategic Equity'],
    notableHoldings: ['Sputnik V vaccine IP', 'Domestic infrastructure', 'Middle East co-investments'],
    recentDevelopment:
      'Sanctioned post-Ukraine invasion 2022; AUM effectively frozen; Western partnerships severed; ' +
      'pivoting to China/UAE/Gulf co-investments to circumvent sanctions.',
  },
  {
    id: 'SWF011',
    name: 'China SAFE Investment Company',
    country: 'China',
    aumBillions: 800,
    founded: 1997,
    strategicFocus: 'FX Reserves',
    transparency: 'Opaque',
    geopoliticalRisk: 'High',
    fundingSource: 'Foreign exchange reserves (adjacent)',
    sanctioned: false,
    usePatterns: ['Strategic Equity', 'Diversification'],
    notableHoldings: ['US Treasuries (partial)', 'European sovereign bonds', 'Equity stakes via subsidiaries'],
    recentDevelopment:
      'Reduced US Treasury holdings amid decoupling; increased gold reserves; opaque structure makes AUM estimates ' +
      'uncertain; functions as FX stabilization and strategic reserve simultaneously.',
  },
  {
    id: 'SWF012',
    name: 'Korea Investment Corporation (KIC)',
    country: 'South Korea',
    aumBillions: 206,
    founded: 2005,
    strategicFocus: 'Conservative',
    transparency: 'High',
    geopoliticalRisk: 'Low',
    fundingSource: 'Foreign exchange reserves & government funds',
    sanctioned: false,
    usePatterns: ['Diversification'],
    notableHoldings: ['Global equities', 'Fixed income', 'Alternative investments'],
    recentDevelopment:
      'Conservative mandate; increased alternatives allocation to 20%+; supporting Korean government currency stabilization efforts.',
  },
];

const STRATEGIC_INVESTMENTS: StrategicInvestment[] = [
  {
    id: 'SI001',
    date: '2021-10',
    fund: 'Saudi PIF',
    target: 'Newcastle United FC',
    sector: 'Sports',
    value: '$305M',
    usePattern: 'Sports Washing',
    geopoliticalSignal:
      "Saudi Arabia's normalization of international image; deflect human rights criticism via Premier League platform.",
  },
  {
    id: 'SI002',
    date: '2022-02',
    fund: 'Saudi PIF',
    target: 'LIV Golf',
    sector: 'Sports & Media',
    value: '$2B+',
    usePattern: 'Sports Washing',
    geopoliticalSignal:
      "Fractured PGA Tour; recruited top golfers; merger negotiations 2023-2024 signal golf's geopolitical battlefield.",
  },
  {
    id: 'SI003',
    date: '2024-02',
    fund: 'UAE Mubadala / G42',
    target: 'Microsoft AI Partnership',
    sector: 'AI & Technology',
    value: '$1.5B',
    usePattern: 'Tech Acquisition',
    geopoliticalSignal:
      'UAE positioning as AI hub; US tech companies choosing Gulf over China partnerships; strategic AI infrastructure competition.',
  },
  {
    id: 'SI004',
    date: '2023-06',
    fund: 'Saudi Aramco',
    target: 'SABIC Integration',
    sector: 'Petrochemicals',
    value: '$70B',
    usePattern: 'Strategic Equity',
    geopoliticalSignal:
      "World's largest petrochemical deal; diversifies Saudi revenues; supports Vision 2030 downstream value capture.",
  },
  {
    id: 'SI005',
    date: '2011-07',
    fund: 'Qatar QIA',
    target: 'Paris Saint-Germain FC',
    sector: 'Sports',
    value: '$50M+/year',
    usePattern: 'Sports Washing',
    geopoliticalSignal:
      'Flagship soft power play; PSG brand elevates Qatar globally; Mbappe/Neymar signings as diplomatic tools.',
  },
  {
    id: 'SI006',
    date: '2023-12',
    fund: 'China CIC',
    target: 'Global Port Infrastructure',
    sector: 'Infrastructure',
    value: '$Multi-billion',
    usePattern: 'Port & Infrastructure',
    geopoliticalSignal:
      'String of Pearls strategy; port stakes in Sri Lanka, Pakistan, Greece (Piraeus via COSCO); strategic chokepoint access.',
  },
  {
    id: 'SI007',
    date: '2022-11',
    fund: 'Russia RDIF',
    target: 'Sanctions Circumvention via Gulf',
    sector: 'Finance',
    value: 'Undisclosed',
    usePattern: 'Sanctions Evasion',
    geopoliticalSignal:
      "Post-Ukraine sanctions; RDIF sought UAE and Saudi co-investment to access Western financial system's shadow; largely blocked.",
  },
  {
    id: 'SI008',
    date: '2024-01',
    fund: 'Saudi PIF',
    target: 'esports & gaming portfolio',
    sector: 'Gaming',
    value: '$1B+',
    usePattern: 'Media Influence',
    geopoliticalSignal:
      'PIF acquired stakes in Nintendo, Activision, EA, Take-Two; gaming as youth soft power and image rehabilitation vector.',
  },
];

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getByCountry(funds: SovereignWealthFund[], country: string): SovereignWealthFund[] {
  return funds.filter((f) => f.country.toLowerCase() === country.toLowerCase());
}

export function getLargestFunds(funds: SovereignWealthFund[], n = 5): SovereignWealthFund[] {
  return [...funds].sort((a, b) => b.aumBillions - a.aumBillions).slice(0, n);
}

export function getHighRiskFunds(funds: SovereignWealthFund[]): SovereignWealthFund[] {
  return funds.filter((f) => f.geopoliticalRisk === 'High' || f.geopoliticalRisk === 'Critical');
}

export function getStrategicAcquisitions(
  investments: StrategicInvestment[],
  pattern: UsePattern,
): StrategicInvestment[] {
  return investments.filter((i) => i.usePattern === pattern);
}

export function computeTotalAum(funds: SovereignWealthFund[]): number {
  return funds.reduce((sum, f) => sum + f.aumBillions, 0);
}

export function transparencyClass(t: Transparency): string {
  const m: Record<Transparency, string> = {
    High: 'transp-high',
    Medium: 'transp-medium',
    Low: 'transp-low',
    Opaque: 'transp-opaque',
  };
  return m[t] ?? 'transp-medium';
}

export function riskClass(r: GeopoliticalRisk): string {
  const m: Record<GeopoliticalRisk, string> = {
    Low: 'risk-low',
    Moderate: 'risk-moderate',
    High: 'risk-high',
    Critical: 'risk-critical',
  };
  return m[r] ?? 'risk-moderate';
}

export function buildRenderData(): SWFRenderData {
  const totalAumBillions = computeTotalAum(FUNDS);
  return {
    funds: FUNDS,
    investments: STRATEGIC_INVESTMENTS,
    totalAumTrillions: Math.round((totalAumBillions / 1000) * 10) / 10,
    highRiskCount: getHighRiskFunds(FUNDS).length,
    sanctionedCount: FUNDS.filter((f) => f.sanctioned).length,
    largestFund: getLargestFunds(FUNDS, 1)[0] ?? null,
  };
}
