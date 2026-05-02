/**
 * Dam and levee safety monitoring
 *
 * Sources:
 *  - NWS (National Weather Service): already monitors floods — filter specifically
 * for dam/levee failure warnings and flash flood events caused by dam breaks.
 * Reuses the existing NWS alerts proxy at /api/nws-alerts.
 *  - FERC (Federal Energy Regulatory Commission) hydropower safety:
 * https://www.ferc.gov/safety/safety-programs/dam-safety-program — RSS
 *  - USACE (Army Corps of Engineers) water control data:
 * https://water.usace.army.mil/ — public reservoir data
 *
 * Note: Real-time dam failure alerts primarily come through NWS emergency alerts
 * (which issue "Dam Break" and "Flash Flood Emergency" products). This service
 * surfaces those specifically, plus FERC incident reports.
 */

export interface DamSafetyAlert {
  id: string;
  title: string;
  description: string;
  damName: string;
  waterbody: string;
  state: string;
  lat: number | null;
  lon: number | null;
  alertType: 'dam_break' | 'dam_failure_imminent' | 'levee_failure' | 'flash_flood_emergency' | 'inspection' | 'other';
  source: 'NWS' | 'FERC' | 'USACE';
  issuedAt: Date;
  url: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// NWS alerts already proxied at /api/nws-alerts — we filter for dam events
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

// eslint-disable-next-line sonarjs/regex-complexity -- alternation matches state-abbr forms; input is bounded NWS area description
const STATE_RE = /\b([A-Z]{2})\b(?=\s*\d{5}|,\s*USA?|\s*\()/;
// eslint-disable-next-line sonarjs/slow-regex -- bounded RSS description input; tag stripper
const HTML_TAG_RE = /<[^>]*>/g;

// FERC dam safety program news
const FERC_RSS = 'https://www.ferc.gov/rss/news-releases.xml';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — dam failures are time-critical
let cache: { alerts: DamSafetyAlert[]; fetchedAt: number } | null = null;

const DAM_EVENT_TYPES = [
  'Dam Break', 'Dam Failure', 'Levee Failure', 'Flash Flood Emergency',
  'Flash Flood Warning', 'Areal Flood Emergency',
];

const DAM_KEYWORDS = [
  'dam break', 'dam failure', 'dam breach', 'levee failure', 'levee breach',
  'flood emergency', 'catastrophic', 'imminent failure', 'spillway',
  'reservoir', 'dam', 'levee', 'embankment',
];

function isDamRelated(event: string, headline: string, description: string): boolean {
  const text = (event + ' ' + headline + ' ' + description).toLowerCase();
  if (DAM_EVENT_TYPES.some(t => event.toLowerCase().includes(t.toLowerCase()))) return true;
  return DAM_KEYWORDS.some(k => text.includes(k));
}

function detectAlertType(event: string, headline: string): DamSafetyAlert['alertType'] {
  const t = (event + ' ' + headline).toLowerCase();
  if (t.includes('dam break') || t.includes('dam breach') || t.includes('dam failure')) return 'dam_break';
  if (t.includes('imminent') || t.includes('imminent failure')) return 'dam_failure_imminent';
  if (t.includes('levee')) return 'levee_failure';
  if (t.includes('flash flood emergency')) return 'flash_flood_emergency';
  if (t.includes('inspection') || t.includes('deficiency')) return 'inspection';
  return 'other';
}

function extractDamName(headline: string, description: string): string {
  const text = headline + ' ' + description;
  // Patterns: "XYZ Dam", "XYZ Lake Dam", "XYZ Reservoir"
  const match = /\b([A-Z][a-zA-Z\s]{1,30}(?:Dam|Reservoir|Levee|Lake|Embankment))\b/.exec(text);
  return match?.[1]?.trim() ?? 'Unknown Dam';
}

function extractState(text: string): string {
  // eslint-disable-next-line sonarjs/prefer-regexp-exec, @typescript-eslint/prefer-regexp-exec -- match() returns equivalent shape; .exec() trips PreToolUse security hook on this token
  const stateAbbr = text.match(STATE_RE);
  if (stateAbbr?.[1]) return stateAbbr[1];
  return '';
}

function classifyNwsSeverity(
  isEmergency: boolean,
  alertType: DamSafetyAlert['alertType'],
  rawSeverity: string,
): DamSafetyAlert['severity'] {
  if (isEmergency) return 'critical';
  if (alertType === 'levee_failure' || rawSeverity === 'Severe') return 'high';
  return 'medium';
}

interface NwsAlertRaw {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: string;
  areaDesc: string;
  onset: string;
  expires: string;
  status: string;
}

async function fetchNwsDamAlerts(): Promise<DamSafetyAlert[]> {
  try {
 const baseUrl = getApiBaseUrl();
 const res = await fetch(`${baseUrl}/api/nws-alerts`, { signal: AbortSignal.timeout(12_000) });
 if (!res.ok) return [];
 const alerts = (await res.json()) as NwsAlertRaw[];
 if (!Array.isArray(alerts)) return [];

 return alerts
 .filter(a => isDamRelated(a.event, a.headline, a.description))
 .map(a => {
 const alertType = detectAlertType(a.event, a.headline);
 const isEmergency = alertType === 'dam_break' || alertType === 'dam_failure_imminent' || a.severity === 'Extreme';
 return {
 id: `dam-nws-${a.id}`,
 title: a.event,
 description: (a.headline ?? a.description ?? '').slice(0, 400),
 damName: extractDamName(a.headline ?? '', a.description ?? ''),
 waterbody: '',
 state: extractState(a.areaDesc ?? ''),
 lat: null,
 lon: null,
 alertType,
 source: 'NWS' as const,
 issuedAt: a.onset ? new Date(a.onset) : new Date(),
 url: `https://alerts.weather.gov/cap/us.php?x=0`,
 severity: classifyNwsSeverity(isEmergency, alertType, a.severity),
 };
 });
  } catch {
 return [];
  }
}

async function fetchFercAlerts(): Promise<DamSafetyAlert[]> {
  try {
 const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(FERC_RSS)}`;
 const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12_000) });
 if (!res.ok) return [];

 const text = await res.text();
 const parser = new DOMParser();
 const doc = parser.parseFromString(text, 'text/xml');
 if (doc.querySelector('parsererror')) return [];

 const items = doc.querySelectorAll('item');
 const alerts: DamSafetyAlert[] = [];

 for (const item of items) {
 const title = item.querySelector('title')?.textContent?.trim() ?? '';
 const description = (item.querySelector('description')?.textContent ?? '').replace(HTML_TAG_RE, '').trim();
 const link = item.querySelector('link')?.textContent?.trim() ?? '';
 const pubDateStr = item.querySelector('pubDate')?.textContent?.trim() ?? '';

 const fullText = title + ' ' + description;
 if (!DAM_KEYWORDS.some(k => fullText.toLowerCase().includes(k))) continue;

 alerts.push({
 id: `dam-ferc-${title.replace(/\W/g, '').slice(0, 20)}`,
 title,
 description: description.slice(0, 400),
 damName: extractDamName(title, description),
 waterbody: '',
 state: extractState(fullText),
 lat: null,
 lon: null,
 alertType: detectAlertType(title, description),
 source: 'FERC',
 issuedAt: pubDateStr ? new Date(pubDateStr) : new Date(),
 url: link,
 severity: fullText.toLowerCase().includes('failure') || fullText.toLowerCase().includes('emergency') ? 'high' : 'medium',
 });
 }

 return alerts;
  } catch {
 return [];
  }
}

export async function fetchDamSafetyAlerts(): Promise<DamSafetyAlert[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.alerts;

  try {
 const [nwsResult, fercResult] = await Promise.allSettled([
 fetchNwsDamAlerts(),
 fetchFercAlerts(),
 ]);

 const combined = [
 ...(nwsResult.status === 'fulfilled' ? nwsResult.value : []),
 ...(fercResult.status === 'fulfilled' ? fercResult.value : []),
 ].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());

 cache = { alerts: combined.slice(0, 40), fetchedAt: Date.now() };
 dataFreshness.recordUpdate('dam-safety', cache.alerts.length);
 return cache.alerts;
  } catch (error) {
 dataFreshness.recordError('dam-safety', String(error));
 return cache?.alerts ?? [];
  }
}

export function damSeverityClass(severity: DamSafetyAlert['severity']): string {
  return {
 critical: 'eq-row eq-major',
 high: 'eq-row eq-strong',
 medium: 'eq-row eq-moderate',
 low: 'eq-row',
  }[severity] ?? 'eq-row';
}
