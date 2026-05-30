// Pure helpers for CorruptionIndexPanel.
// No DOM, no Panel imports — safe to import in Node.js tests.

export type CorruptionTrend = 'improving' | 'stable' | 'declining';
export type CorruptionCategory = 'Clean' | 'Satisfactory' | 'Problematic' | 'Very Corrupt';

export interface CountryRecord {
  country: string;
  /** ISO 3166-1 alpha-3 code */
  code: string;
  /** CPI score 0-100; higher = cleaner */
  score: number;
  trend: CorruptionTrend;
  keyRisk: string;
  /** Approximate population in millions (for weighted avg) */
  populationM: number;
}

export interface KeyEvent {
  year: number;
  title: string;
  description: string;
  /** General theme or category of corruption */
  category: string;
}

export interface CorruptionRenderData {
  countries: CountryRecord[];
  globalAvgWeighted: number;
  globalAvgUnweighted: number;
  cleanCount: number;
  satisfactoryCount: number;
  problematicCount: number;
  veryCorruptCount: number;
  decliningCount: number;
  improvingCount: number;
  topEvents: KeyEvent[];
  mostCorrupt: CountryRecord[];
  leastCorrupt: CountryRecord[];
}

// ── Data ─────────────────────────────────────────────────────────────────────

export const COUNTRIES: CountryRecord[] = [
  { country: 'Denmark',     code: 'DNK', score: 90, trend: 'stable',    keyRisk: 'Minimal; strong institutions',                              populationM: 5.9   },
  { country: 'Finland',     code: 'FIN', score: 87, trend: 'stable',    keyRisk: 'Minimal; Nordic governance model',                          populationM: 5.5   },
  { country: 'Norway',      code: 'NOR', score: 84, trend: 'stable',    keyRisk: 'Oil-fund transparency risk (low)',                           populationM: 5.4   },
  { country: 'Singapore',   code: 'SGP', score: 83, trend: 'stable',    keyRisk: 'State capitalism opacity',                                  populationM: 5.9   },
  { country: 'Netherlands', code: 'NLD', score: 79, trend: 'stable',    keyRisk: 'Offshore shell-company exposure',                           populationM: 17.9  },
  { country: 'Germany',     code: 'DEU', score: 78, trend: 'declining', keyRisk: 'Wirecard fallout; lobbying opacity',                        populationM: 83.8  },
  { country: 'Japan',       code: 'JPN', score: 73, trend: 'stable',    keyRisk: 'LDP political-fund scandals',                               populationM: 125.7 },
  { country: 'UK',          code: 'GBR', score: 71, trend: 'declining', keyRisk: 'Londongrad sanctions evasion; PPE contracts',                populationM: 67.7  },
  { country: 'USA',         code: 'USA', score: 69, trend: 'declining', keyRisk: 'Jan 6 politicization; judicial independence concerns',       populationM: 331.0 },
  { country: 'South Korea', code: 'KOR', score: 63, trend: 'improving', keyRisk: 'Chaebol governance risk (post-Park reforms)',                populationM: 51.7  },
  { country: 'China',       code: 'CHN', score: 42, trend: 'stable',    keyRisk: 'Xi crackdown: selective, not systemic',                     populationM: 1412.0 },
  { country: 'India',       code: 'IND', score: 39, trend: 'stable',    keyRisk: 'State-level patronage; enforcement selectivity',            populationM: 1407.6 },
  { country: 'Brazil',      code: 'BRA', score: 36, trend: 'stable',    keyRisk: 'Lava Jato fatigue; state-enterprise risk',                  populationM: 215.3 },
  { country: 'Mexico',      code: 'MEX', score: 31, trend: 'declining', keyRisk: 'Cartel capture of state; judicial intimidation',            populationM: 130.3 },
  { country: 'Pakistan',    code: 'PAK', score: 29, trend: 'stable',    keyRisk: 'Military-business complex; ISI opacity',                    populationM: 231.4 },
  { country: 'Russia',      code: 'RUS', score: 26, trend: 'declining', keyRisk: 'War economy opacity; sanctions evasion',                    populationM: 144.1 },
  { country: 'Nigeria',     code: 'NGA', score: 24, trend: 'declining', keyRisk: 'Tinubu subsidy scandal; petro-corruption',                  populationM: 218.5 },
  { country: 'Afghanistan', code: 'AFG', score: 20, trend: 'stable',    keyRisk: 'Taliban financial opacity; aid diversion',                  populationM: 40.1  },
  { country: 'Venezuela',   code: 'VEN', score: 13, trend: 'declining', keyRisk: 'Maduro kleptocracy; PDVSA looting',                         populationM: 29.0  },
  { country: 'Somalia',     code: 'SOM', score: 11, trend: 'stable',    keyRisk: 'State collapse; chronic governance failure',                populationM: 17.1  },
];

export const KEY_EVENTS: KeyEvent[] = [
  {
    year: 2022,
    title: 'FTX / Crypto Corruption Collapse',
    description:
      'Sam Bankman-Fried\'s FTX exchange collapsed amid alleged fraud and misuse of customer funds, exposing regulatory capture and political donation networks in the crypto sector.',
    category: 'Financial Fraud',
  },
  {
    year: 2022,
    title: 'Odessa Port Scandal (Ukraine)',
    description:
      'Allegations of embezzlement in Ukrainian wartime reconstruction contracts surfaced at Odessa port, prompting Zelenskyy to dismiss multiple officials in anti-corruption drives.',
    category: 'Wartime Corruption',
  },
  {
    year: 2023,
    title: 'Guatemala Judicial Independence Restored',
    description:
      'Newly elected President Arévalo launched sweeping anti-corruption reforms, restoring institutional confidence after years of judicial and prosecutorial capture by entrenched elites.',
    category: 'Governance Reform',
  },
  {
    year: 2023,
    title: 'Nigeria Tinubu Subsidy Scandal',
    description:
      'President Tinubu\'s abrupt removal of fuel subsidies revealed decades of systemic petro-corruption: NNPC had been overcharging by an estimated $3–7 billion annually.',
    category: 'Petro-Corruption',
  },
];

// ── Pure functions ────────────────────────────────────────────────────────────

/** Map CPI score (0–100) to a human-readable category.
 *  Clean ≥75 · Satisfactory 50–74 · Problematic 25–49 · Very Corrupt <25 */
export function getCategory(score: number): CorruptionCategory {
  if (score >= 75) return 'Clean';
  if (score >= 50) return 'Satisfactory';
  if (score >= 25) return 'Problematic';
  return 'Very Corrupt';
}

/** Filter countries to those matching the given category. */
export function getByCategory(
  countries: CountryRecord[],
  category: CorruptionCategory,
): CountryRecord[] {
  return countries.filter(c => getCategory(c.score) === category);
}

/** Return the N most corrupt countries (lowest CPI first). */
export function getMostCorrupt(countries: CountryRecord[], n = 5): CountryRecord[] {
  return [...countries].sort((a, b) => a.score - b.score).slice(0, n);
}

/** Return the N least corrupt countries (highest CPI first). */
export function getLeastCorrupt(countries: CountryRecord[], n = 5): CountryRecord[] {
  return [...countries].sort((a, b) => b.score - a.score).slice(0, n);
}

/** Countries whose trend is 'declining'. */
export function getDecliningCountries(countries: CountryRecord[]): CountryRecord[] {
  return countries.filter(c => c.trend === 'declining');
}

/** Countries whose trend is 'improving'. */
export function getImprovingCountries(countries: CountryRecord[]): CountryRecord[] {
  return countries.filter(c => c.trend === 'improving');
}

/** CSS utility class for a corruption category. */
export function categoryClass(category: CorruptionCategory): string {
  switch (category) {
    case 'Clean':        return 'cat-clean';
    case 'Satisfactory': return 'cat-satisfactory';
    case 'Problematic':  return 'cat-problematic';
    case 'Very Corrupt': return 'cat-very-corrupt';
  }
}

/** CSS utility class for a trend value. */
export function trendClass(trend: CorruptionTrend): string {
  switch (trend) {
    case 'improving': return 'trend-improving';
    case 'stable':    return 'trend-stable';
    case 'declining': return 'trend-declining';
  }
}

/** Population-weighted global CPI average. */
export function weightedGlobalAvg(countries: CountryRecord[]): number {
  if (countries.length === 0) return 0;
  const totalPop     = countries.reduce((s, c) => s + c.populationM, 0);
  const weightedSum  = countries.reduce((s, c) => s + c.score * c.populationM, 0);
  return Math.round((weightedSum / totalPop) * 10) / 10;
}

/** Simple arithmetic mean CPI across listed countries. */
export function unweightedGlobalAvg(countries: CountryRecord[]): number {
  if (countries.length === 0) return 0;
  const sum = countries.reduce((s, c) => s + c.score, 0);
  return Math.round((sum / countries.length) * 10) / 10;
}

/** Assemble all data needed for a single panel render pass. */
export function buildRenderData(): CorruptionRenderData {
  const sorted = [...COUNTRIES].sort((a, b) => b.score - a.score);
  return {
    countries:            sorted,
    globalAvgWeighted:    weightedGlobalAvg(COUNTRIES),
    globalAvgUnweighted:  unweightedGlobalAvg(COUNTRIES),
    cleanCount:           getByCategory(COUNTRIES, 'Clean').length,
    satisfactoryCount:    getByCategory(COUNTRIES, 'Satisfactory').length,
    problematicCount:     getByCategory(COUNTRIES, 'Problematic').length,
    veryCorruptCount:     getByCategory(COUNTRIES, 'Very Corrupt').length,
    decliningCount:       getDecliningCountries(COUNTRIES).length,
    improvingCount:       getImprovingCountries(COUNTRIES).length,
    topEvents:            KEY_EVENTS,
    mostCorrupt:          getMostCorrupt(COUNTRIES, 5),
    leastCorrupt:         getLeastCorrupt(COUNTRIES, 5),
  };
}
