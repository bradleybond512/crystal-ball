// travel-safety-helpers.ts — pure deterministic helpers for TravelSafetyPanel

export type AdvisoryLevel = 1 | 2 | 3 | 4;
export type RiskCategory = 'crime' | 'terrorism' | 'civil-unrest' | 'health' | 'natural-disaster' | 'kidnapping' | 'infrastructure';
export type Continent = 'europe' | 'middle-east' | 'africa' | 'asia-pacific' | 'americas' | 'central-asia';

export interface CountryAdvisory {
  country: string;
  countryCode: string;
  continent: Continent;
  advisoryLevel: AdvisoryLevel;
  primaryRisks: RiskCategory[];
  summary: string;
  lastUpdated: string;
  entryRestrictions: boolean;
  evacuationStatus: 'none' | 'voluntary' | 'ordered';
}

export interface SafetyAlert {
  id: string;
  date: string;
  countryCode: string;
  country: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  category: RiskCategory;
}

const MOCK_ADVISORIES: CountryAdvisory[] = [
  { country: 'Sudan', countryCode: 'SD', continent: 'africa', advisoryLevel: 4, primaryRisks: ['civil-unrest', 'crime', 'kidnapping'], summary: 'Do not travel. Active civil war, mass atrocities in Darfur. No functioning government services.', lastUpdated: '2026-05-18', entryRestrictions: true, evacuationStatus: 'ordered' },
  { country: 'Haiti', countryCode: 'HT', continent: 'americas', advisoryLevel: 4, primaryRisks: ['crime', 'kidnapping', 'civil-unrest'], summary: 'Do not travel. Gang violence controls most of Port-au-Prince. Kidnapping for ransom is widespread.', lastUpdated: '2026-05-16', entryRestrictions: false, evacuationStatus: 'ordered' },
  { country: 'Russia', countryCode: 'RU', continent: 'europe', advisoryLevel: 4, primaryRisks: ['civil-unrest', 'terrorism'], summary: 'Do not travel. Ongoing war, risk of wrongful detention. Airspace restrictions.', lastUpdated: '2026-05-10', entryRestrictions: true, evacuationStatus: 'ordered' },
  { country: 'Ukraine', countryCode: 'UA', continent: 'europe', advisoryLevel: 4, primaryRisks: ['civil-unrest', 'terrorism', 'infrastructure'], summary: 'Do not travel. Active war zone. Missile and drone strikes throughout the country.', lastUpdated: '2026-05-20', entryRestrictions: false, evacuationStatus: 'ordered' },
  { country: 'Myanmar', countryCode: 'MM', continent: 'asia-pacific', advisoryLevel: 4, primaryRisks: ['civil-unrest', 'crime', 'terrorism'], summary: 'Do not travel. Civil war, arbitrary detention risk for foreigners.', lastUpdated: '2026-05-15', entryRestrictions: false, evacuationStatus: 'voluntary' },
  { country: 'Mexico', countryCode: 'MX', continent: 'americas', advisoryLevel: 3, primaryRisks: ['crime', 'kidnapping', 'terrorism'], summary: 'Reconsider travel. Cartel violence in multiple states. Exercise increased caution.', lastUpdated: '2026-05-12', entryRestrictions: false, evacuationStatus: 'none' },
  { country: 'Colombia', countryCode: 'CO', continent: 'americas', advisoryLevel: 3, primaryRisks: ['crime', 'kidnapping', 'terrorism'], summary: 'Reconsider travel. Armed groups operate in border regions.', lastUpdated: '2026-05-08', entryRestrictions: false, evacuationStatus: 'none' },
  { country: 'Pakistan', countryCode: 'PK', continent: 'central-asia', advisoryLevel: 3, primaryRisks: ['terrorism', 'civil-unrest', 'kidnapping'], summary: 'Reconsider travel. Terrorism risk in KPK and Balochistan. Political instability.', lastUpdated: '2026-05-14', entryRestrictions: false, evacuationStatus: 'none' },
  { country: 'Egypt', countryCode: 'EG', continent: 'middle-east', advisoryLevel: 2, primaryRisks: ['terrorism', 'civil-unrest'], summary: 'Exercise increased caution. Terrorism risk in Sinai Peninsula. Demonstrations can turn violent.', lastUpdated: '2026-05-05', entryRestrictions: false, evacuationStatus: 'none' },
  { country: 'Kenya', countryCode: 'KE', continent: 'africa', advisoryLevel: 2, primaryRisks: ['terrorism', 'crime'], summary: 'Exercise increased caution. Al-Shabaab activity in coastal and border areas.', lastUpdated: '2026-05-01', entryRestrictions: false, evacuationStatus: 'none' },
  { country: 'Japan', countryCode: 'JP', continent: 'asia-pacific', advisoryLevel: 1, primaryRisks: ['natural-disaster'], summary: 'Exercise normal precautions. Earthquake and tsunami risk. Very low crime.', lastUpdated: '2026-04-15', entryRestrictions: false, evacuationStatus: 'none' },
  { country: 'Germany', countryCode: 'DE', continent: 'europe', advisoryLevel: 1, primaryRisks: ['terrorism'], summary: 'Exercise normal precautions. Low-level terrorism risk at crowded venues.', lastUpdated: '2026-04-10', entryRestrictions: false, evacuationStatus: 'none' },
];

const MOCK_ALERTS: SafetyAlert[] = [
  { id: 'alt1', date: '2026-05-22', countryCode: 'SD', country: 'Sudan', title: 'El Fasher under siege — departure routes blocked', severity: 'critical', category: 'civil-unrest' },
  { id: 'alt2', date: '2026-05-21', countryCode: 'HT', country: 'Haiti', title: 'Gang blockade disrupts Port-au-Prince airport access', severity: 'critical', category: 'crime' },
  { id: 'alt3', date: '2026-05-20', countryCode: 'UA', country: 'Ukraine', title: 'Missile strikes on Kyiv energy infrastructure', severity: 'critical', category: 'infrastructure' },
  { id: 'alt4', date: '2026-05-18', countryCode: 'MX', country: 'Mexico', title: 'Cartel roadblocks on Mazatlan-Culiacan highway', severity: 'high', category: 'crime' },
  { id: 'alt5', date: '2026-05-16', countryCode: 'PK', country: 'Pakistan', title: 'Suicide bombing near Peshawar security forces HQ', severity: 'high', category: 'terrorism' },
  { id: 'alt6', date: '2026-05-14', countryCode: 'KE', country: 'Kenya', title: 'Al-Shabaab IED attack on Lamu tourist route', severity: 'high', category: 'terrorism' },
];

// ── Pure helpers ──────────────────────────────────────────────────────────

export function advisoryLabel(level: AdvisoryLevel): string {
  const map: Record<AdvisoryLevel, string> = {
    1: 'Normal Precautions',
    2: 'Exercise Caution',
    3: 'Reconsider Travel',
    4: 'Do Not Travel',
  };
  return map[level];
}

export function advisoryColor(level: AdvisoryLevel): string {
  const map: Record<AdvisoryLevel, string> = {
    1: '#22c55e',
    2: '#eab308',
    3: '#f97316',
    4: '#ef4444',
  };
  return map[level];
}

export function countByAdvisoryLevel(advisories: CountryAdvisory[]): Record<AdvisoryLevel, number> {
  const counts: Record<AdvisoryLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const a of advisories) counts[a.advisoryLevel]++;
  return counts;
}

export function filterByLevel(advisories: CountryAdvisory[], level: AdvisoryLevel): CountryAdvisory[] {
  return advisories.filter((a) => a.advisoryLevel === level);
}

export function filterByMinLevel(advisories: CountryAdvisory[], min: AdvisoryLevel): CountryAdvisory[] {
  return advisories.filter((a) => a.advisoryLevel >= min);
}

export function filterByContinent(advisories: CountryAdvisory[], continent: Continent): CountryAdvisory[] {
  return advisories.filter((a) => a.continent === continent);
}

export function sortByRiskDescending(advisories: CountryAdvisory[]): CountryAdvisory[] {
  return [...advisories].sort((a, b) => b.advisoryLevel - a.advisoryLevel);
}

export function countriesUnderEvacuation(advisories: CountryAdvisory[]): CountryAdvisory[] {
  return advisories.filter((a) => a.evacuationStatus !== 'none');
}

export function hasEntryRestrictions(advisory: CountryAdvisory): boolean {
  return advisory.entryRestrictions;
}

export function topRiskyCountries(advisories: CountryAdvisory[], limit = 5): CountryAdvisory[] {
  return sortByRiskDescending(advisories).slice(0, limit);
}

export function recentCriticalAlerts(alerts: SafetyAlert[], limit = 5): SafetyAlert[] {
  return [...alerts]
    .filter((a) => a.severity === 'critical')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function alertsByCountry(alerts: SafetyAlert[], countryCode: string): SafetyAlert[] {
  return alerts.filter((a) => a.countryCode === countryCode);
}

export function computeRiskProfile(advisories: CountryAdvisory[]): Record<RiskCategory, number> {
  const profile: Record<RiskCategory, number> = {
    crime: 0, terrorism: 0, 'civil-unrest': 0, health: 0,
    'natural-disaster': 0, kidnapping: 0, infrastructure: 0,
  };
  for (const a of advisories) {
    for (const risk of a.primaryRisks) profile[risk]++;
  }
  return profile;
}

export function dominantRiskCategory(advisories: CountryAdvisory[]): RiskCategory {
  const profile = computeRiskProfile(advisories);
  const entries = Object.entries(profile) as [RiskCategory, number][];
  return entries.reduce((max, cur) => (cur[1] > max[1] ? cur : max), entries[0]!)[0];
}

export function buildRenderData(): {
  advisories: CountryAdvisory[];
  criticalAlerts: SafetyAlert[];
  levelCounts: Record<AdvisoryLevel, number>;
  evacuationCountries: CountryAdvisory[];
  topRisky: CountryAdvisory[];
  dominantRisk: RiskCategory;
} {
  return {
    advisories: sortByRiskDescending(MOCK_ADVISORIES),
    criticalAlerts: recentCriticalAlerts(MOCK_ALERTS),
    levelCounts: countByAdvisoryLevel(MOCK_ADVISORIES),
    evacuationCountries: countriesUnderEvacuation(MOCK_ADVISORIES),
    topRisky: topRiskyCountries(MOCK_ADVISORIES),
    dominantRisk: dominantRiskCategory(MOCK_ADVISORIES),
  };
}
