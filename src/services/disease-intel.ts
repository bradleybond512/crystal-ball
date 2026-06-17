// Disease Intelligence — Nextstrain variant frequencies + disease.sh country cases
// + ReliefWeb epidemic declarations + WHO Disease Outbreak News.
// All sources are free and require no API key.

import { getApiBaseUrl } from '@/services/runtime';
import { iso3ToIso2Code, nameToCountryCode } from '@/services/country-geometry';
import { dataFreshness } from '@/services/data-freshness';

// ── Nextstrain variant frequency ─────────────────────────────────────────────

export interface NextstrainCladeFreq {
  value: number;
  upper: number;
  lower: number;
}

export interface NextstrainCladeGrowthAdv {
  value: number;
  upper: number;
  lower: number;
}

export interface NextstrainClade {
  clade: string;
  freq: NextstrainCladeFreq;
  ga: NextstrainCladeGrowthAdv;
}

export interface NextstrainLocation {
  location: string;
  clades: NextstrainClade[];
}

// ── COVID country case counts ─────────────────────────────────────────────────

export interface CovidCountry {
  country: string;
  iso2: string;
  lat: number;
  lon: number;
  active: number;
  todayCases: number;
  casesPerOneMillion: number;
  updatedMs: number;
}

// ── ReliefWeb epidemic events ─────────────────────────────────────────────────

export interface EpidemicEvent {
  id: string;
  name: string;
  country: string;
  iso3: string;
  status: 'alert' | 'ongoing' | 'past';
  date: Date;
  url: string;
}

// ── WHO Disease Outbreak News ─────────────────────────────────────────────────

export interface WhoDonAlert {
  id: string;
  title: string;
  disease: string;
  country: string;
  date: Date;
  url: string;
}

// ── WHO DON ↔ ProMED cross-reference ──────────────────────────────────────────

export interface WhoProMedCrossReference {
  whoDonId: string;
  promedIds: string[];
}

// ── Combined panel data ───────────────────────────────────────────────────────

export interface DiseaseIntelData {
  variants: NextstrainLocation[];
  covidCountries: CovidCountry[];
  epidemicEvents: EpidemicEvent[];
  whoDon: WhoDonAlert[];
  crossReferencedWithPromed: WhoProMedCrossReference[];
  fetchedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache: { data: DiseaseIntelData; ts: number } | null = null;

export async function fetchDiseaseIntel(): Promise<DiseaseIntelData> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/disease-intel`, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`disease-intel: ${res.status}`);

    const raw = await res.json() as {
   nextstrain: unknown;
   covidCountries: unknown;
   reliefweb: unknown;
   whoDon: unknown;
   crossReferencedWithPromed?: unknown;
    };
    if (!raw || typeof raw !== 'object') throw new Error('disease-intel: malformed response');

    const data: DiseaseIntelData = {
   variants: parseNextstrain(raw.nextstrain),
   covidCountries: parseCovidCountries(raw.covidCountries),
   epidemicEvents: parseEpidemicEvents(raw.reliefweb),
   whoDon: parseWhoDon(raw.whoDon),
   crossReferencedWithPromed: parseCrossReferences(raw.crossReferencedWithPromed),
   fetchedAt: new Date(),
    };

    _cache = { data, ts: Date.now() };
    dataFreshness.recordUpdate('disease-intel', data.covidCountries.length + data.epidemicEvents.length + data.whoDon.length);
    return data;
  } catch (error) {
    dataFreshness.recordError('disease-intel', String(error));
    throw error;
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseNextstrain(raw: unknown): NextstrainLocation[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];

  return data
 .map((row: unknown) => {
 if (!row || typeof row !== 'object') return null;
 const r = row as Record<string, unknown>;
 const location = typeof r.location === 'string' ? r.location : '';
 const rawClades = Array.isArray(r.clades) ? r.clades : [];
 const clades: NextstrainClade[] = rawClades
 .map((c: unknown) => {
 if (!c || typeof c !== 'object') return null;
 const cr = c as Record<string, unknown>;
 const clade = typeof cr.clade === 'string' ? cr.clade : '';
 const freq = parseInterval(cr.freq);
 const ga = parseInterval(cr.ga);
 if (!clade || freq.value < 0.01) return null;
 return { clade, freq, ga };
 })
 .filter((c): c is NextstrainClade => c !== null);
 if (!location || clades.length === 0) return null;
 return { location, clades };
 })
 .filter((l): l is NextstrainLocation => l !== null);
}

function parseInterval(raw: unknown): NextstrainCladeFreq {
  if (!raw || typeof raw !== 'object') return { value: 0, upper: 0, lower: 0 };
  const r = raw as Record<string, unknown>;
  return {
 value: typeof r.value === 'number' ? r.value : 0,
 upper: typeof r.upper === 'number' ? r.upper : 0,
 lower: typeof r.lower === 'number' ? r.lower : 0,
  };
}

function parseCovidCountries(raw: unknown): CovidCountry[] {
  if (!Array.isArray(raw)) return [];
  return raw
 .map((item: unknown) => {
 if (!item || typeof item !== 'object') return null;
 const r = item as Record<string, unknown>;
 const info = (r.countryInfo as Record<string, unknown> | undefined) ?? {};
 const iso2 = typeof info.iso2 === 'string' ? info.iso2 : '';
 if (!iso2 || iso2 === '?') return null;
 return {
 country: typeof r.country === 'string' ? r.country : '',
 iso2: iso2.toUpperCase(),
 lat: typeof info.lat === 'number' ? info.lat : 0,
 lon: typeof info.long === 'number' ? info.long : 0,
 active: typeof r.active === 'number' ? r.active : 0,
 todayCases: typeof r.todayCases === 'number' ? r.todayCases : 0,
 casesPerOneMillion: typeof r.casesPerOneMillion === 'number' ? r.casesPerOneMillion : 0,
 updatedMs: typeof r.updated === 'number' ? r.updated : 0,
 };
 })
 .filter((c): c is CovidCountry => c !== null)
 .sort((a, b) => b.active - a.active);
}

function parseEpidemicEvents(raw: unknown): EpidemicEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = Array.isArray((raw as Record<string, unknown>).data)
 ? ((raw as Record<string, unknown>).data as unknown[])
 : [];
  return data
 .map((item: unknown) => {
 if (!item || typeof item !== 'object') return null;
 const r = item as Record<string, unknown>;
 const fields = (r.fields as Record<string, unknown> | undefined) ?? {};
 const countries = Array.isArray(fields.country) ? fields.country as Record<string, unknown>[] : [];
 const status = typeof fields.status === 'string' ? fields.status : 'ongoing';
 if (status === 'past') return null;
 const dateObj = (fields.date as Record<string, unknown> | undefined) ?? {};
 let eventId = '';
 if (typeof r.id === 'string') eventId = r.id;
 else if (typeof r.id === 'number') eventId = String(r.id);
 return {
 id: eventId,
 name: typeof fields.name === 'string' ? fields.name : '',
 country: typeof countries[0]?.name === 'string' ? countries[0].name : 'Unknown',
 iso3: typeof countries[0]?.iso3 === 'string' ? countries[0].iso3 : '',
 status: (status === 'alert' ? 'alert' : 'ongoing') as EpidemicEvent['status'],
 date: typeof dateObj.created === 'string' ? new Date(dateObj.created) : new Date(),
 url: typeof fields.url === 'string' && fields.url.startsWith('https://') ? fields.url : '',
 };
 })
 .filter((e): e is EpidemicEvent => e !== null);
}

function parseCrossReferences(raw: unknown): WhoProMedCrossReference[] {
  if (!Array.isArray(raw)) return [];
  return raw
 .map((item: unknown) => {
 if (!item || typeof item !== 'object') return null;
 const r = item as Record<string, unknown>;
 const whoDonId = typeof r.whoDonId === 'string' ? r.whoDonId : '';
 const promedIds = Array.isArray(r.promedIds)
 ? r.promedIds.filter((p): p is string => typeof p === 'string')
 : [];
 if (!whoDonId || promedIds.length === 0) return null;
 return { whoDonId, promedIds };
 })
 .filter((x): x is WhoProMedCrossReference => x !== null);
}

function parseWhoDon(raw: unknown): WhoDonAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw
 .slice(0, 20)
 .map((item: unknown, i: number) => {
 if (!item || typeof item !== 'object') return null;
 const r = item as Record<string, unknown>;
 const title = typeof r.Title === 'string' ? r.Title : '';
 const url = typeof r.Url === 'string' && r.Url.startsWith('https://') ? r.Url : '';
 const pubDate = typeof r.PublicationDate === 'string' ? r.PublicationDate : '';
 return {
 id: `who-don-${i}-${pubDate.slice(0, 10)}`,
 title,
 disease: extractDiseaseName(title),
 country: extractCountry(title),
 date: pubDate ? new Date(pubDate) : new Date(),
 url,
 };
 })
 .filter((a): a is WhoDonAlert => a !== null);
}

function extractDiseaseName(title: string): string {
  const patterns = [
 /mpox/i, /ebola/i, /cholera/i, /dengue/i, /measles/i, /covid/i, /influenza/i,
 /avian influenza/i, /marburg/i, /lassa/i, /nipah/i, /plague/i, /yellow fever/i,
 /monkeypox/i, /polio/i, /meningitis/i, /anthrax/i,
  ];
  for (const p of patterns) {
 const m = p.exec(title);
 if (m) return m[0].charAt(0).toUpperCase() + m[0].slice(1);
  }
  return title.split(/[-–—:,]/)[0]?.trim() ?? title.slice(0, 40);
}

function extractCountry(title: string): string {
  const parenMatch = /\(([^)]{1,60})\)$/.exec(title);
  if (parenMatch?.[1]) return parenMatch[1];
  const dashMatch = /[-\u2013\u2014]\s*([A-Z][A-Za-z ]{1,40})/.exec(title);
  if (dashMatch?.[1]) return dashMatch[1].trim();
  return 'Unknown';
}

// ── Derived helpers ───────────────────────────────────────────────────────────

function coordsFromIso2(iso2: string, countries: CovidCountry[]): [number, number] | null {
  const m = countries.find(c => c.iso2 === iso2.toUpperCase());
  if (!m || (m.lat === 0 && m.lon === 0)) return null;
  return [m.lat, m.lon];
}

function coordsFromNameFold(name: string, countries: CovidCountry[]): [number, number] | null {
  const needle = name.toLowerCase();
  let match = countries.find(c => c.country.toLowerCase() === needle);
  match ??= countries.find(c => {
 const hay = c.country.toLowerCase();
 return hay.startsWith(needle.slice(0, 5)) || needle.startsWith(hay.slice(0, 5));
  });
  if (!match || (match.lat === 0 && match.lon === 0)) return null;
  return [match.lat, match.lon];
}

// Resolve an outbreak's country to lat/lon in the disease.sh country list.
// Priority order:
//   1. ISO3 → ISO2 lookup (most reliable, used by ReliefWeb EpidemicEvent)
//   2. Country-geometry name → ISO2 lookup (handles aliases like "DR Congo")
//   3. Exact case-insensitive name match, then 5-char prefix fold (legacy
//      fallback for WhoDonAlert entries that only have a parsed name).
export function resolveOutbreakCoords(
  name: string,
  countries: CovidCountry[],
  iso3?: string,
): [number, number] | null {
  if (iso3 && /^[A-Z]{3}$/i.test(iso3.trim())) {
 const iso2 = iso3ToIso2Code(iso3);
 if (iso2) {
 const fromIso = coordsFromIso2(iso2, countries);
 if (fromIso) return fromIso;
 }
  }

  const trimmed = name.trim();
  if (trimmed.length > 0) {
 const aliasIso2 = nameToCountryCode(trimmed);
 if (aliasIso2) {
 const fromAlias = coordsFromIso2(aliasIso2, countries);
 if (fromAlias) return fromAlias;
 }
 return coordsFromNameFold(trimmed, countries);
  }

  return null;
}

export function getGlobalVariants(data: DiseaseIntelData): NextstrainClade[] {
  const global = data.variants.find(v => v.location.toLowerCase() === 'global');
  if (!global) return [];
  return [...global.clades].sort((a, b) => b.ga.value - a.ga.value);
}

export function getDominantCladeForCountry(data: DiseaseIntelData, iso2: string): string | null {
  const country = data.covidCountries.find(c => c.iso2 === iso2);
  if (!country) return null;
  const loc = data.variants.find(v =>
 v.location.toLowerCase().includes(country.country.toLowerCase().slice(0, 6))
  );
  if (!loc || loc.clades.length === 0) return null;
  return [...loc.clades].sort((a, b) => b.freq.value - a.freq.value)[0]?.clade ?? null;
}
