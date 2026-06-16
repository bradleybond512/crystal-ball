// Disease outbreak surveillance — WHO Disease Outbreak News + ReliefWeb API + ProMED + CDC
// All sources are free with no API key required
/* eslint-disable sonarjs/prefer-regexp-exec, sonarjs/slow-regex, sonarjs/no-misleading-array-reverse, sonarjs/cognitive-complexity, unicorn/numeric-separators-style -- pre-existing patterns; lint scope creeps into untouched code when staged */

import { getApiBaseUrl } from '@/services/runtime';

export interface DiseaseOutbreak {
  id: string;
  title: string;
  country: string;
  disease: string;
  date: Date;
  url?: string;
  source: 'WHO' | 'ReliefWeb' | 'ProMED';
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cache: { outbreaks: DiseaseOutbreak[]; fetchedAt: number } | null = null;

// ReliefWeb API — free, no key, returns disease outbreak reports
const RELIEFWEB_API =
  'https://api.reliefweb.int/v1/reports?appname=crystalball&filter[field]=type.name&filter[value]=Situation%20Report&filter[conditions][0][field]=theme.name&filter[conditions][0][value]=Health&limit=25&sort[]=date:desc&fields[include][]=title&fields[include][]=date&fields[include][]=country&fields[include][]=url';

// WHO Health Emergencies Dashboard — JSON endpoint
const WHO_EMERGENCIES =
  'https://www.who.int/api/hubs/cms/s3fs-public/attachments/disease-outbreak-news.json';

// ProMED-mail — Program for Monitoring Emerging Diseases (ISID).
// Sidecar /api/promed handles fetching, RSS parsing, and severity classification.

interface ProMedSidecarAlert {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  disease: string;
  country: string;
  severity: 'NOVEL_PATHOGEN' | 'OUTBREAK' | 'UNUSUAL_CLUSTER' | 'ROUTINE';
  cases?: number;
  deaths?: number;
}

interface ProMedSidecarResponse {
  alerts?: ProMedSidecarAlert[];
  lastFetch?: string;
  novelCount?: number;
  outbreakCount?: number;
  degraded?: boolean;
}

const PROMED_SEVERITY_MAP: Record<ProMedSidecarAlert['severity'], DiseaseOutbreak['severity']> = {
  NOVEL_PATHOGEN: 'critical',
  OUTBREAK: 'high',
  UNUSUAL_CLUSTER: 'medium',
  ROUTINE: 'low',
};

async function fetchProMED(): Promise<DiseaseOutbreak[]> {
  try {
 const base = getApiBaseUrl();
 const res = await fetch(`${base}/api/promed`, { signal: AbortSignal.timeout(15_000) });
 if (!res.ok) return [];
 const payload = (await res.json()) as ProMedSidecarResponse;
 if (!Array.isArray(payload.alerts)) return [];
 return payload.alerts.map((alert) => ({
 id: alert.id || `promed-${alert.pubDate?.slice(0, 10) ?? ''}-${alert.title.slice(0, 40)}`,
 title: alert.title,
 country: alert.country || 'Unknown',
 disease: alert.disease || extractDiseaseName(alert.title),
 date: alert.pubDate ? new Date(alert.pubDate) : new Date(),
 url: alert.link,
 source: 'ProMED' as const,
 severity: PROMED_SEVERITY_MAP[alert.severity] ?? 'medium',
 }));
  } catch {
 return [];
  }
}

function extractDiseaseName(title: string): string {
  const patterns = [
 /mpox/i, /ebola/i, /cholera/i, /dengue/i, /measles/i, /covid/i, /influenza/i, /avian influenza/i,
 /marburg/i, /lassa/i, /nipah/i, /hantavirus/i, /plague/i, /yellow fever/i, /rift valley/i,
 /monkeypox/i, /tuberculosis/i, /polio/i, /rabies/i, /meningitis/i,
  ];
  for (const p of patterns) {
 const m = title.match(p);
 if (m) return m[0].charAt(0).toUpperCase() + m[0].slice(1);
  }
  // Fall back to first significant noun phrase
  const trimmed = title.replace(/^(outbreak of|case of|cases of|situation report:?)\s*/i, '').trim();
  return trimmed.split(/[\-–—:,]/)[0]?.trim() ?? title.slice(0, 40);
}

function extractCountry(title: string, countryField?: string): string {
  if (countryField) return countryField;
  // Heuristic: last parenthetical or "in <Country>"
  const parenMatch = /\(([^)]+)\)\s*$/.exec(title);
  if (parenMatch?.[1]) return parenMatch[1];
  const inMatch = /\bin\s+([A-Z][a-zA-Z\s]+?)(?:\s*[-–]|\s*$)/.exec(title);
  if (inMatch?.[1]) return inMatch[1].trim();
  return 'Unknown';
}

function scoreSeverity(title: string): DiseaseOutbreak['severity'] {
  const tl = title.toLowerCase();
  if (/\b(ebola|marburg|nipah|plague|hemorrhagic)\b/.test(tl)) return 'critical';
  if (/\b(mpox|cholera|outbreak|emergency|alert|death|fatal|killed)\b/.test(tl)) return 'high';
  if (/\b(case|situation|report|update|cluster)\b/.test(tl)) return 'medium';
  return 'low';
}

async function fetchReliefWeb(): Promise<DiseaseOutbreak[]> {
  try {
 const res = await fetch(RELIEFWEB_API, { signal: AbortSignal.timeout(10_000) });
 if (!res.ok) return [];
 const json = await res.json() as {
 data: {
 id: string;
 fields: {
 title: string;
 date: { created: string };
 country?: { name: string }[];
 url: string;
 };
 }[];
 };
 const rows = Array.isArray(json?.data) ? json.data : [];
 return rows.flatMap(item => {
 const f = item?.fields;
 if (!f || typeof f.title !== 'string') return [];
 const country = f.country?.[0]?.name ?? extractCountry(f.title);
 return [{
 id: `rw-${item.id}`,
 title: f.title,
 country,
 disease: extractDiseaseName(f.title),
 date: new Date(f.date?.created ?? Date.now()),
 url: f.url,
 source: 'ReliefWeb' as const,
 severity: scoreSeverity(f.title),
 }];
 });
  } catch {
 return [];
  }
}

async function fetchWHOEmergencies(): Promise<DiseaseOutbreak[]> {
  try {
 const res = await fetch(WHO_EMERGENCIES, { signal: AbortSignal.timeout(10_000) });
 if (!res.ok) return [];
 const json = await res.json() as {
 Title?: string;
 title?: string;
 Date?: string;
 date?: string;
 Country?: string;
 country?: string;
 Url?: string;
 url?: string;
 }[];
 if (!Array.isArray(json)) return [];
 return json.slice(0, 30).map((item, i) => {
 const title = item.Title ?? item.title ?? '';
 const dateStr = item.Date ?? item.date ?? '';
 const country = item.Country ?? item.country ?? extractCountry(title);
 return {
 id: `who-${i}-${dateStr}`,
 title,
 country,
 disease: extractDiseaseName(title),
 date: dateStr ? new Date(dateStr) : new Date(),
 url: item.Url ?? item.url,
 source: 'WHO',
 severity: scoreSeverity(title),
 };
 });
  } catch {
 return [];
  }
}

export async function fetchDiseaseOutbreaks(): Promise<DiseaseOutbreak[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
 return cache.outbreaks;
  }

  const [rwResult, whoResult, promedResult] = await Promise.allSettled([
 fetchReliefWeb(),
 fetchWHOEmergencies(),
 fetchProMED(),
  ]);

  const combined: DiseaseOutbreak[] = [
 ...(rwResult.status === 'fulfilled' ? rwResult.value : []),
 ...(whoResult.status === 'fulfilled' ? whoResult.value : []),
 ...(promedResult.status === 'fulfilled' ? promedResult.value : []),
  ];

  // Dedupe by disease+country within 7 days
  const seen = new Set<string>();
  const deduped: DiseaseOutbreak[] = [];
  for (const o of combined.sort((a, b) => b.date.getTime() - a.date.getTime())) {
 const key = `${o.disease.toLowerCase()}-${o.country.toLowerCase()}`;
 if (!seen.has(key)) {
 seen.add(key);
 deduped.push(o);
 }
  }

  cache = { outbreaks: deduped.slice(0, 50), fetchedAt: Date.now() };
  return cache.outbreaks;
}

export interface GlobalDiseaseSnapshot {
  disease: 'covid19' | 'influenza';
  cases: number;
  deaths: number;
  recovered: number | null;
  activeCases: number | null;
  casesToday: number | null;
  deathsToday: number | null;
  trend: 'rising' | 'stable' | 'falling';
  updatedAt: Date;
}

let _diseaseShCache: { snapshots: GlobalDiseaseSnapshot[]; ts: number } | null = null;
const DISEASE_SH_TTL_MS = 60 * 60 * 1000;

export async function fetchGlobalDiseaseSnapshots(): Promise<GlobalDiseaseSnapshot[]> {
  if (_diseaseShCache && Date.now() - _diseaseShCache.ts < DISEASE_SH_TTL_MS) {
 return _diseaseShCache.snapshots;
  }
  try {
 const [covidResp, covidHistResp] = await Promise.allSettled([
 fetch('https://disease.sh/v3/covid-19/all', { signal: AbortSignal.timeout(10000) }),
 fetch('https://disease.sh/v3/covid-19/historical/all?lastdays=8', { signal: AbortSignal.timeout(10000) }),
 ]);

 const snapshots: GlobalDiseaseSnapshot[] = [];

 if (covidResp.status === 'fulfilled' && covidResp.value.ok) {
 const covid = await covidResp.value.json() as Record<string, number>;
 if (!covid || typeof covid !== 'object') { _diseaseShCache = { snapshots, ts: Date.now() }; return snapshots; }
 let trend: GlobalDiseaseSnapshot['trend'] = 'stable';
 if (covidHistResp.status === 'fulfilled' && covidHistResp.value.ok) {
 const hist = await covidHistResp.value.json() as { cases?: Record<string, number> };
 const casesArr = Object.values(hist.cases ?? {});
 if (casesArr.length >= 8) {
 const recent = casesArr.slice(-3).reduce((a, b) => a + b, 0) / 3;
 const older = casesArr.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
 if (recent > older * 1.1) trend = 'rising';
 else if (recent < older * 0.9) trend = 'falling';
 }
 }
 snapshots.push({
 disease: 'covid19',
 cases: covid.cases ?? 0,
 deaths: covid.deaths ?? 0,
 recovered: covid.recovered ?? null,
 activeCases: covid.active ?? null,
 casesToday: covid.todayCases ?? null,
 deathsToday: covid.todayDeaths ?? null,
 trend,
 updatedAt: new Date(covid.updated ?? Date.now()),
 });
 }

 _diseaseShCache = { snapshots, ts: Date.now() };
 return snapshots;
  } catch {
 _diseaseShCache = { snapshots: [], ts: Date.now() };
 return [];
  }
}

export interface CdcSurveillanceSignal {
  source: string;
  disease: string;
  metric: string;
  value: string | number | null;
  date: string;
  severity: string;
  region: string;
  url: string;
}

let _cdcCache: { signals: CdcSurveillanceSignal[]; ts: number } | null = null;
const CDC_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchCdcSurveillance(): Promise<CdcSurveillanceSignal[]> {
  if (_cdcCache && Date.now() - _cdcCache.ts < CDC_TTL_MS) {
 return _cdcCache.signals;
  }
  try {
 const base = getApiBaseUrl();
 if (!base) return [];
 const res = await fetch(`${base}/api/cdc-surveillance`, { signal: AbortSignal.timeout(15_000) });
 if (!res.ok) return [];
 const data = await res.json() as { signals?: CdcSurveillanceSignal[] };
 const signals = Array.isArray(data?.signals) ? data.signals : [];
 _cdcCache = { signals, ts: Date.now() };
 return signals;
  } catch {
 return [];
  }
}
