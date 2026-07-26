/**
 * NGA (National Geospatial-Intelligence Agency) Maritime Safety Information
 * Public JSON API — no authentication required
 * https://msi.nga.mil/api/publications/broadcast-warn
 *
 * Covers: NAVAREA warnings, special warnings, coast guard broadcasts,
 * hydrographic office notices to mariners.
 */


import { dataFreshness } from './data-freshness';
import type { FetchResult } from './fetch-result';

export interface MaritimeWarning {
  id: string;
  msgYear: number;
  msgNumber: number;
  navArea: string;
  subregion: string;
  text: string;
  cancelTime: Date | null;
  issueTime: Date;
  authority: string;
  cancelMsgYear: number | null;
  cancelMsgNumber: number | null;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'search-rescue' | 'hazard' | 'mine' | 'wreck' | 'cable' | 'military' | 'navigation' | 'other';
}

interface NgaMsiWarning {
  msgYear: number;
  msgNumber: number;
  navArea: string;
  subregion: string;
  text: string;
  cancelTime?: string | null;
  issueTime?: string;
  authority?: string;
  cancelMsgYear?: number | null;
  cancelMsgNumber?: number | null;
  source?: string;
}

const NGA_MSI_API = 'https://msi.nga.mil/api/publications/broadcast-warn?includeCountries=&maxSecurity=U&output=json&pageSize=100';
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
let cache: { warnings: MaritimeWarning[]; fetchedAt: number } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeNgaMsiWarnings(raw: unknown): NgaMsiWarning[] {
  if (!isRecord(raw)) throw new Error('Invalid NGA MSI response');
  const candidate = raw.broadcastWarn ?? raw.items;
  if (!Array.isArray(candidate)) throw new Error('Invalid NGA MSI response');
  return candidate.map((value) => {
    if (
      !isRecord(value)
      || typeof value.msgYear !== 'number'
      || !Number.isFinite(value.msgYear)
      || typeof value.msgNumber !== 'number'
      || !Number.isFinite(value.msgNumber)
      || typeof value.navArea !== 'string'
      || typeof value.text !== 'string'
    ) {
      throw new Error('Invalid NGA MSI warning');
    }
    return {
      msgYear: value.msgYear,
      msgNumber: value.msgNumber,
      navArea: value.navArea,
      subregion: typeof value.subregion === 'string' ? value.subregion : '',
      text: value.text,
      cancelTime: typeof value.cancelTime === 'string' || value.cancelTime === null
        ? value.cancelTime
        : undefined,
      issueTime: typeof value.issueTime === 'string' ? value.issueTime : undefined,
      authority: typeof value.authority === 'string' ? value.authority : undefined,
      cancelMsgYear: typeof value.cancelMsgYear === 'number' ? value.cancelMsgYear : null,
      cancelMsgNumber: typeof value.cancelMsgNumber === 'number' ? value.cancelMsgNumber : null,
      source: typeof value.source === 'string' ? value.source : undefined,
    };
  });
}

const HIGH_PRIORITY_TERMS = [
  'search and rescue', 'sar', 'distress', 'mayday', 'sinking', 'capsized',
  'person overboard', 'missing vessel', 'life-threatening', 'icebreaker',
];
const HAZARD_TERMS = [
  'mine', 'wreck', 'obstruction', 'shoal', 'rock', 'reef', 'ice',
  'oil spill', 'chemical', 'debris', 'derelict', 'buoy missing', 'light out',
];
const MILITARY_TERMS = [
  'firing', 'exercise', 'military', 'naval', 'torpedo', 'gunnery', 'live fire',
];

function scoreCategory(text: string): MaritimeWarning['category'] {
  const t = text.toLowerCase();
  if (HIGH_PRIORITY_TERMS.some(k => t.includes(k))) return 'search-rescue';
  if (t.includes('mine')) return 'mine';
  if (t.includes('wreck')) return 'wreck';
  if (t.includes('cable') || t.includes('pipeline')) return 'cable';
  if (MILITARY_TERMS.some(k => t.includes(k))) return 'military';
  if (HAZARD_TERMS.some(k => t.includes(k))) return 'hazard';
  if (t.includes('light') || t.includes('buoy') || t.includes('aid to navigation')) return 'navigation';
  return 'other';
}

function scoreSeverity(category: MaritimeWarning['category']): MaritimeWarning['severity'] {
  switch (category) {
    case 'search-rescue': {
      return 'critical';
    }
    case 'mine':
    case 'hazard': {
      return 'high';
    }
    case 'wreck':
    case 'military': {
      return 'medium';
    }
    default: {
      return 'low';
    }
  }
}

function parseDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeWarnings(items: NgaMsiWarning[], now: number): MaritimeWarning[] {
  const warnings: MaritimeWarning[] = [];
  for (const w of items) {
    const cancelTime = parseDate(w.cancelTime);
    if (cancelTime && cancelTime.getTime() < now) continue;

    const issueTime = parseDate(w.issueTime) ?? new Date(now);
    const category = scoreCategory(w.text);
    warnings.push({
      id: `maritime-${w.navArea}-${w.msgYear}-${w.msgNumber}`,
      msgYear: w.msgYear,
      msgNumber: w.msgNumber,
      navArea: w.navArea,
      subregion: w.subregion,
      text: w.text.slice(0, 600),
      cancelTime,
      issueTime,
      authority: w.authority ?? '',
      cancelMsgYear: w.cancelMsgYear ?? null,
      cancelMsgNumber: w.cancelMsgNumber ?? null,
      source: w.source ?? 'NGA MSI',
      severity: scoreSeverity(category),
      category,
    });
  }

  return warnings
    .filter((warning) => warning.severity === 'critical' || warning.severity === 'high'
      || now - warning.issueTime.getTime() < 7 * 24 * 60 * 60 * 1000)
    .sort((a, b) => {
      const order: Record<MaritimeWarning['severity'], number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, 100);
}

function degradedResult(errorCode: string): FetchResult<MaritimeWarning[]> {
  return {
    data: cache?.warnings ?? [],
    status: cache ? 'stale' : 'degraded',
    source: 'NGA MSI',
    fetchedAt: cache?.fetchedAt ?? Date.now(),
    errorCode,
  };
}

export async function fetchMaritimeWarningsResult(): Promise<FetchResult<MaritimeWarning[]>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      data: cache.warnings,
      status: 'fresh',
      source: 'NGA MSI',
      fetchedAt: cache.fetchedAt,
    };
  }

  try {
    const res = await fetch(NGA_MSI_API, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      dataFreshness.recordError('maritime-safety', `HTTP ${res.status}`);
      return degradedResult(`http-${res.status}`);
    }

    const now = Date.now();
    const payload: unknown = await res.json();
    const items = decodeNgaMsiWarnings(payload);
    const filtered = normalizeWarnings(items, now);

    cache = { warnings: filtered, fetchedAt: now };
    dataFreshness.recordUpdate('maritime-safety', filtered.length);
    return {
      data: filtered,
      status: 'fresh',
      source: 'NGA MSI',
      fetchedAt: now,
    };
  } catch (error) {
    dataFreshness.recordError('maritime-safety', String(error));
    const errorCode = error instanceof Error && error.message.includes('Invalid NGA MSI')
      ? 'invalid-response'
      : 'network-error';
    return degradedResult(errorCode);
  }
}

export async function fetchMaritimeWarnings(): Promise<MaritimeWarning[]> {
  const result = await fetchMaritimeWarningsResult();
  return result.data;
}

export function resetMaritimeWarningsCacheForTests(): void {
  cache = null;
}

export function maritimeSeverityClass(severity: MaritimeWarning['severity']): string {
  return {
    critical: 'eq-row eq-major',
    high: 'eq-row eq-strong',
    medium: 'eq-row eq-moderate',
    low: 'eq-row',
  }[severity] ?? 'eq-row';
}
