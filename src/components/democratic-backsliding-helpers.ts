// democratic-backsliding-helpers.ts
// Pure logic for DemocraticBackslidingPanel — no DOM, no Panel imports

export type DemocracyRegime = 'Liberal Democracy' | 'Electoral Democracy' | 'Electoral Autocracy' | 'Closed Autocracy';
export type BackslidingTrend = 'improving' | 'stable' | 'eroding' | 'collapsing';

export interface CountryDemocracy {
  id: string;
  country: string;
  region: string;
  regime: DemocracyRegime;
  vdemScore: number; // 0-1 liberal democracy index (V-Dem inspired)
  electoralScore: number; // 0-1
  civilLibertiesScore: number; // 0-1
  ruleOfLawScore: number; // 0-1
  trend: BackslidingTrend;
  trendDeltaYr: number; // change in vdemScore over 3 years, negative = erosion
  keyErosionEvent: string;
  population: number; // millions
}

export interface BackslidingEvent {
  id: string;
  date: string;
  country: string;
  category: 'Judiciary Capture' | 'Media Suppression' | 'Election Manipulation' | 'Protest Crackdown' | 'Constitutional Change' | 'Emergency Powers' | 'Civil Society Restriction';
  description: string;
  severity: number; // 1-10
  ongoing: boolean;
}

export interface DemocracyData {
  countries: CountryDemocracy[];
  events: BackslidingEvent[];
  globalDemocracyIndex: number; // 0-100
  liberalCount: number;
  electoralDemCount: number;
  electoralAutocCount: number;
  closedAutocCount: number;
  erodingCount: number;
  populationUnderAutocracy: number;
}

const COUNTRIES: CountryDemocracy[] = [
  { id: 'C01', country: 'Hungary', region: 'Europe', regime: 'Electoral Autocracy', vdemScore: 0.32, electoralScore: 0.45, civilLibertiesScore: 0.38, ruleOfLawScore: 0.30, trend: 'eroding', trendDeltaYr: -0.12, keyErosionEvent: 'Fidesz media monopoly; judiciary packed; Lex CEU; LGBTQ+ law; EU Article 7', population: 10 },
  { id: 'C02', country: 'Turkey', region: 'Middle East/Europe', regime: 'Electoral Autocracy', vdemScore: 0.20, electoralScore: 0.35, civilLibertiesScore: 0.22, ruleOfLawScore: 0.18, trend: 'stable', trendDeltaYr: -0.02, keyErosionEvent: '2016 coup attempt; mass purges; 150,000 arrested; presidential system 2017', population: 85 },
  { id: 'C03', country: 'Poland', region: 'Europe', regime: 'Electoral Democracy', vdemScore: 0.52, electoralScore: 0.65, civilLibertiesScore: 0.55, ruleOfLawScore: 0.48, trend: 'improving', trendDeltaYr: 0.08, keyErosionEvent: 'PiS-era judiciary capture partially reversed under Tusk coalition 2023+', population: 38 },
  { id: 'C04', country: 'India', region: 'Asia', regime: 'Electoral Democracy', vdemScore: 0.38, electoralScore: 0.52, civilLibertiesScore: 0.35, ruleOfLawScore: 0.36, trend: 'eroding', trendDeltaYr: -0.09, keyErosionEvent: 'BJP press freedom decline; CAA; Article 370; opposition arrests; ED weaponization', population: 1440 },
  { id: 'C05', country: 'Brazil', region: 'Latin America', regime: 'Electoral Democracy', vdemScore: 0.55, electoralScore: 0.70, civilLibertiesScore: 0.60, ruleOfLawScore: 0.50, trend: 'improving', trendDeltaYr: 0.06, keyErosionEvent: 'Bolsonaro Jan 8 coup attempt failed; Lula restored democratic norms 2023', population: 215 },
  { id: 'C06', country: 'Serbia', region: 'Europe', regime: 'Electoral Autocracy', vdemScore: 0.28, electoralScore: 0.38, civilLibertiesScore: 0.30, ruleOfLawScore: 0.25, trend: 'eroding', trendDeltaYr: -0.05, keyErosionEvent: 'Vucic SNS media control; election irregularities 2023; student protest movement 2024', population: 7 },
  { id: 'C07', country: 'Venezuela', region: 'Latin America', regime: 'Closed Autocracy', vdemScore: 0.08, electoralScore: 0.12, civilLibertiesScore: 0.09, ruleOfLawScore: 0.07, trend: 'collapsing', trendDeltaYr: -0.03, keyErosionEvent: '2024 election fraud; Maduro claimed victory despite opposition evidence; mass arrests', population: 28 },
  { id: 'C08', country: 'Israel', region: 'Middle East', regime: 'Electoral Democracy', vdemScore: 0.56, electoralScore: 0.68, civilLibertiesScore: 0.58, ruleOfLawScore: 0.52, trend: 'eroding', trendDeltaYr: -0.08, keyErosionEvent: 'Netanyahu judicial overhaul 2023; mass protests; Supreme Court powers curtailed; wartime emergency', population: 10 },
  { id: 'C09', country: 'Philippines', region: 'Asia', regime: 'Electoral Democracy', vdemScore: 0.42, electoralScore: 0.55, civilLibertiesScore: 0.44, ruleOfLawScore: 0.38, trend: 'stable', trendDeltaYr: 0.02, keyErosionEvent: 'Duterte drug war legacy; Marcos Jr. dynasty restoration 2022; press freedom concerns remain', population: 115 },
  { id: 'C10', country: 'Tunisia', region: 'North Africa', regime: 'Electoral Autocracy', vdemScore: 0.22, electoralScore: 0.30, civilLibertiesScore: 0.24, ruleOfLawScore: 0.20, trend: 'collapsing', trendDeltaYr: -0.15, keyErosionEvent: 'Saied self-coup 2021; new constitution concentrates power; opposition imprisoned', population: 12 },
  { id: 'C11', country: 'Mexico', region: 'Latin America', regime: 'Electoral Democracy', vdemScore: 0.44, electoralScore: 0.58, civilLibertiesScore: 0.46, ruleOfLawScore: 0.35, trend: 'eroding', trendDeltaYr: -0.06, keyErosionEvent: 'AMLO/Sheinbaum judicial reform dissolves independent courts; electoral authority weakened', population: 130 },
  { id: 'C12', country: 'Germany', region: 'Europe', regime: 'Liberal Democracy', vdemScore: 0.85, electoralScore: 0.90, civilLibertiesScore: 0.88, ruleOfLawScore: 0.86, trend: 'stable', trendDeltaYr: -0.01, keyErosionEvent: 'AfD rise; Verfassungsschutz monitoring; Thuringia coalition crisis', population: 84 },
  { id: 'C13', country: 'United States', region: 'Americas', regime: 'Liberal Democracy', vdemScore: 0.72, electoralScore: 0.80, civilLibertiesScore: 0.75, ruleOfLawScore: 0.68, trend: 'eroding', trendDeltaYr: -0.06, keyErosionEvent: 'Jan 6 attack; election denial; DOJ independence concerns; executive power expansion 2025', population: 335 },
  { id: 'C14', country: 'South Korea', region: 'Asia', regime: 'Liberal Democracy', vdemScore: 0.74, electoralScore: 0.82, civilLibertiesScore: 0.76, ruleOfLawScore: 0.72, trend: 'eroding', trendDeltaYr: -0.04, keyErosionEvent: 'Yoon martial law declaration Dec 2024; impeachment; constitutional crisis', population: 52 },
  { id: 'C15', country: 'Georgia', region: 'Europe', regime: 'Electoral Autocracy', vdemScore: 0.30, electoralScore: 0.42, civilLibertiesScore: 0.32, ruleOfLawScore: 0.28, trend: 'collapsing', trendDeltaYr: -0.14, keyErosionEvent: 'Georgian Dream 2024 election disputed; mass protests; Russia-style foreign agents law; EU accession suspended', population: 4 },
];

const EVENTS: BackslidingEvent[] = [
  { id: 'E001', date: '2024-12-03', country: 'South Korea', category: 'Emergency Powers', description: 'President Yoon declared martial law citing anti-state forces — reversed by National Assembly vote within 6 hours; Yoon impeached.', severity: 9, ongoing: false },
  { id: 'E002', date: '2024-10', country: 'Georgia', category: 'Election Manipulation', description: 'Georgian Dream claimed election victory amid widespread fraud allegations; pro-EU protests erupted in Tbilisi for weeks.', severity: 8, ongoing: true },
  { id: 'E003', date: '2024-09-11', country: 'Venezuela', category: 'Election Manipulation', description: 'Maduro regime declared victory without publishing voting tallies; opposition compiled 80%+ evidence of fraud; mass arrests of protesters.', severity: 9, ongoing: true },
  { id: 'E004', date: '2024-08-04', country: 'Bangladesh', category: 'Protest Crackdown', description: 'Hasina government killed 300+ protesters in quota reform crackdown before fleeing; Army oversaw transition to Yunus interim government.', severity: 8, ongoing: false },
  { id: 'E005', date: '2024-07-26', country: 'France', category: 'Constitutional Change', description: 'RN achieved first-round plurality; snap election result fragmented; far-right normalization trend in Western Europe accelerating.', severity: 5, ongoing: true },
  { id: 'E006', date: '2024-03-20', country: 'Russia', category: 'Election Manipulation', description: 'Putin re-elected with 87% in election with no viable opposition; Navalny died in prison Feb 2024; all opposition suppressed.', severity: 10, ongoing: true },
  { id: 'E007', date: '2023-07-23', country: 'Niger', category: 'Constitutional Change', description: 'Military coup overthrew elected President Bazoum; ECOWAS threatened intervention but backed down; democratic elections cancelled.', severity: 8, ongoing: true },
  { id: 'E008', date: '2023-07-11', country: 'Israel', category: 'Judiciary Capture', description: 'Knesset passed law removing Supreme Court power to overrule government decisions as unreasonable; mass protests of 100,000+.', severity: 7, ongoing: false },
];

export function computeGlobalDemocracyIndex(countries: CountryDemocracy[]): number {
  if (!countries.length) return 50;
  const wavg = countries.reduce((s, c) => s + c.vdemScore * c.population, 0);
  const totPop = countries.reduce((s, c) => s + c.population, 0);
  return Math.round((wavg / totPop) * 100);
}

export function getByRegime(countries: CountryDemocracy[], regime: DemocracyRegime): CountryDemocracy[] {
  return countries.filter(c => c.regime === regime);
}

export function getErodingCountries(countries: CountryDemocracy[]): CountryDemocracy[] {
  return countries.filter(c => c.trend === 'eroding' || c.trend === 'collapsing');
}

export function getImprovingCountries(countries: CountryDemocracy[]): CountryDemocracy[] {
  return countries.filter(c => c.trend === 'improving');
}

export function computePopulationUnderAutocracy(countries: CountryDemocracy[]): number {
  return countries
    .filter(c => c.regime === 'Electoral Autocracy' || c.regime === 'Closed Autocracy')
    .reduce((s, c) => s + c.population, 0);
}

export function rankByErosion(countries: CountryDemocracy[]): CountryDemocracy[] {
  return [...countries].sort((a, b) => a.trendDeltaYr - b.trendDeltaYr);
}

export function rankByScore(countries: CountryDemocracy[]): CountryDemocracy[] {
  return [...countries].sort((a, b) => a.vdemScore - b.vdemScore);
}

export function regimeClass(regime: DemocracyRegime): string {
  const m: Record<DemocracyRegime, string> = {
    'Liberal Democracy': 'regime-liberal',
    'Electoral Democracy': 'regime-electoral',
    'Electoral Autocracy': 'regime-autoc',
    'Closed Autocracy': 'regime-closed',
  };
  return m[regime] ?? 'regime-autoc';
}

export function trendClass(trend: BackslidingTrend): string {
  const m: Record<BackslidingTrend, string> = {
    improving: 'trend-up',
    stable: 'trend-flat',
    eroding: 'trend-down',
    collapsing: 'trend-critical',
  };
  return m[trend] ?? 'trend-flat';
}

export function trendArrow(trend: BackslidingTrend): string {
  return (
    { improving: 'up', stable: 'right', eroding: 'down', collapsing: 'down-down' }[trend] ?? 'right'
  );
}

export function buildRenderData(): DemocracyData {
  return {
    countries: COUNTRIES,
    events: EVENTS,
    globalDemocracyIndex: computeGlobalDemocracyIndex(COUNTRIES),
    liberalCount: getByRegime(COUNTRIES, 'Liberal Democracy').length,
    electoralDemCount: getByRegime(COUNTRIES, 'Electoral Democracy').length,
    electoralAutocCount: getByRegime(COUNTRIES, 'Electoral Autocracy').length,
    closedAutocCount: getByRegime(COUNTRIES, 'Closed Autocracy').length,
    erodingCount: getErodingCountries(COUNTRIES).length,
    populationUnderAutocracy: computePopulationUnderAutocracy(COUNTRIES),
  };
}
