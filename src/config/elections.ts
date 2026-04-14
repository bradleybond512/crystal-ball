/**
 * Election calendar reference data for CII sensitivity boosting.
 *
 * Elections mark periods of heightened political volatility: news velocity
 * rises, disinformation campaigns intensify, and both incumbent and opposition
 * actors take risks they otherwise wouldn't. When a country has an election
 * within a 30-day window, the CII information component is boosted 1.3x to
 * reflect the elevated political-uncertainty signal.
 *
 * Dates are best-effort curated from publicly announced schedules as of
 * 2026-04-14. Some are approximate (e.g. quarter-only announcements) — callers
 * should treat this as reference data, not a live feed.
 */

export type ElectionType = 'presidential' | 'parliamentary' | 'general' | 'referendum' | 'regional';

export interface Election {
  /** ISO 3166-1 alpha-2 code (US, UK, FR, DE, etc.) */
  country: string;
  countryName: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  type: ElectionType;
  notes?: string;
}

export const UPCOMING_ELECTIONS: Election[] = [
  // 2026
  { country: 'HU', countryName: 'Hungary', date: '2026-04-12', type: 'parliamentary', notes: 'Orbán seeks fifth consecutive term' },
  { country: 'PE', countryName: 'Peru', date: '2026-04-12', type: 'general', notes: 'Presidential + congressional' },
  { country: 'CO', countryName: 'Colombia', date: '2026-05-31', type: 'presidential', notes: 'First round' },
  { country: 'PH', countryName: 'Philippines', date: '2026-05-11', type: 'general', notes: 'Mid-term: senators + house' },
  { country: 'MX', countryName: 'Mexico', date: '2026-06-07', type: 'regional', notes: 'State-level elections across multiple states' },
  { country: 'SE', countryName: 'Sweden', date: '2026-09-13', type: 'general', notes: 'Parliamentary (Riksdag)' },
  { country: 'BR', countryName: 'Brazil', date: '2026-10-04', type: 'general', notes: 'Presidential + congressional, first round' },
  { country: 'US', countryName: 'United States', date: '2026-11-03', type: 'general', notes: 'Mid-term: House, 1/3 Senate, 36 governors' },
  { country: 'NL', countryName: 'Netherlands', date: '2026-03-18', type: 'regional', notes: 'Provincial + water board (feeds Senate)' },
  { country: 'CZ', countryName: 'Czechia', date: '2026-10-09', type: 'parliamentary', notes: 'Chamber of Deputies' },
  { country: 'LV', countryName: 'Latvia', date: '2026-10-03', type: 'parliamentary', notes: 'Saeima' },
  { country: 'BO', countryName: 'Bolivia', date: '2026-08-16', type: 'general', notes: 'Post-Morales political realignment' },
  { country: 'IE', countryName: 'Ireland', date: '2026-10-24', type: 'presidential', notes: 'Successor to Michael D. Higgins' },
  { country: 'CR', countryName: 'Costa Rica', date: '2026-02-01', type: 'general', notes: 'Presidential + legislative' },
  { country: 'PT', countryName: 'Portugal', date: '2026-01-18', type: 'presidential', notes: 'Successor to Marcelo Rebelo de Sousa' },
  { country: 'UG', countryName: 'Uganda', date: '2026-01-15', type: 'general', notes: 'Museveni seeks further term' },
  { country: 'TZ', countryName: 'Tanzania', date: '2026-10-28', type: 'general', notes: 'Presidential + parliamentary' },
  { country: 'VN', countryName: 'Vietnam', date: '2026-05-24', type: 'parliamentary', notes: 'National Assembly (15th)' },
  { country: 'KR', countryName: 'South Korea', date: '2026-06-03', type: 'regional', notes: 'Nationwide local elections' },
  { country: 'JP', countryName: 'Japan', date: '2026-07-26', type: 'parliamentary', notes: 'House of Councillors (approximate)' },

  // 2027
  { country: 'FR', countryName: 'France', date: '2027-04-11', type: 'presidential', notes: 'First round; Macron term-limited' },
  { country: 'AR', countryName: 'Argentina', date: '2027-10-24', type: 'general', notes: 'Presidential + congressional' },
  { country: 'IN', countryName: 'India', date: '2027-04-01', type: 'parliamentary', notes: 'State-level (multiple) approximate' },
  { country: 'TR', countryName: 'Turkey', date: '2027-05-14', type: 'presidential', notes: 'Scheduled; early election risk' },
  { country: 'NG', countryName: 'Nigeria', date: '2027-02-20', type: 'general', notes: 'Presidential + National Assembly' },
  { country: 'DE', countryName: 'Germany', date: '2027-09-26', type: 'regional', notes: 'Multiple Länder; bellwether for federal' },
  { country: 'UK', countryName: 'United Kingdom', date: '2029-01-28', type: 'general', notes: 'Next general must be called by Aug 2029' },
];

/**
 * Returns elections within the next N days, optionally filtered by country.
 * @param daysAhead Window in days from "now"
 * @param country Optional ISO 3166-1 alpha-2 code filter
 */
export function getElectionsInWindow(daysAhead: number, country?: string): Election[] {
  const now = Date.now();
  const horizon = now + daysAhead * 24 * 60 * 60 * 1000;
  const countryUpper = country ? country.toUpperCase() : undefined;

  return UPCOMING_ELECTIONS.filter(e => {
 if (countryUpper && e.country.toUpperCase() !== countryUpper) return false;
 const t = Date.parse(e.date);
 if (Number.isNaN(t)) return false;
 return t >= now && t <= horizon;
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Returns the nearest upcoming election for a country within the window, or null.
 * @param country ISO 3166-1 alpha-2 code
 * @param daysAhead Window in days (default 30)
 */
export function hasElectionSoon(country: string, daysAhead = 30): Election | null {
  const matches = getElectionsInWindow(daysAhead, country);
  return matches[0] ?? null;
}
