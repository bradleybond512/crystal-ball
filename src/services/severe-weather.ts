/**
 * NOAA SPC Convective Outlook summary + NWS active tornado/severe-thunderstorm warnings
 * Sidecar:
 *   GET /api/weather/spc-outlook      (30 min cache)
 *   GET /api/weather/active-warnings  (2 min cache)
 */
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';
import type { ConvectiveRisk } from './spc-outlook';



export interface ActiveWarning {
  id: string;
  event: string;
  warnType: 'tornado' | 'thunderstorm' | 'watch';
  headline: string;
  areaDesc: string;
  onset: string;
  expires: string;
  polygon: [number, number][] | null;
  centroid: { lat: number; lon: number } | null;
}

export interface SpcOutlookSummary {
  maxRisk: ConvectiveRisk | null;
  outlookCount: number;
  day1MaxRisk: ConvectiveRisk | null;
  validTime: string;
}

export interface SevereWeatherStatus {
  outlook: SpcOutlookSummary;
  warnings: ActiveWarning[];
  tornadoWarningCount: number;
  thunderstormWarningCount: number;
  watchCount: number;
  fetchedAt: string;
}

const OUTLOOK_TTL_MS = 30 * 60 * 1000;
const WARNINGS_TTL_MS = 2 * 60 * 1000;

let outlookCache: { data: SpcOutlookSummary; ts: number } | null = null;
let warningsCache: { data: ActiveWarning[]; ts: number } | null = null;

const EMPTY_OUTLOOK: SpcOutlookSummary = { maxRisk: null, outlookCount: 0, day1MaxRisk: null, validTime: '' };

export async function fetchSpcOutlookSummary(): Promise<SpcOutlookSummary> {
  if (outlookCache && Date.now() - outlookCache.ts < OUTLOOK_TTL_MS) return outlookCache.data;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/weather/spc-outlook`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      dataFreshness.recordError('severe-weather', `HTTP ${res.status}`);
      return outlookCache?.data ?? EMPTY_OUTLOOK;
    }
    const data = (await res.json()) as SpcOutlookSummary;
    outlookCache = { data, ts: Date.now() };
    dataFreshness.recordUpdate('severe-weather', 1);
    return data;
  } catch (error) {
    dataFreshness.recordError('severe-weather', String(error));
    return outlookCache?.data ?? EMPTY_OUTLOOK;
  }
}

export async function fetchActiveWarnings(): Promise<ActiveWarning[]> {
  if (warningsCache && Date.now() - warningsCache.ts < WARNINGS_TTL_MS) return warningsCache.data;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/weather/active-warnings`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return warningsCache?.data ?? [];
    const data = (await res.json()) as ActiveWarning[];
    warningsCache = { data, ts: Date.now() };
    return data;
  } catch {
    return warningsCache?.data ?? [];
  }
}

export async function fetchSevereWeatherStatus(): Promise<SevereWeatherStatus> {
  const [outlook, warnings] = await Promise.all([fetchSpcOutlookSummary(), fetchActiveWarnings()]);
  return {
    outlook,
    warnings,
    tornadoWarningCount: warnings.filter(w => w.warnType === 'tornado').length,
    thunderstormWarningCount: warnings.filter(w => w.warnType === 'thunderstorm').length,
    watchCount: warnings.filter(w => w.warnType === 'watch').length,
    fetchedAt: new Date().toISOString(),
  };
}

export const RISK_LABELS: Record<string, string> = {
  TSTM: 'Thunderstorm',
  MRGL: 'Marginal',
  SLGT: 'Slight',
  ENH: 'Enhanced',
  MDT: 'Moderate',
  HIGH: 'High',
};

const RISK_ORDER: Record<string, number> = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };

export function riskLabelForCode(code: ConvectiveRisk | null): string {
  if (!code) return 'None';
  return RISK_LABELS[code] ?? code;
}

export function riskLevelNumber(code: ConvectiveRisk | null): number {
  return code ? (RISK_ORDER[code] ?? 0) : 0;
}

export function warningColor(warnType: ActiveWarning['warnType']): string {
  return { tornado: '#ef4444', thunderstorm: '#f97316', watch: '#eab308' }[warnType] ?? '#6b7280';
}

export function riskBadgeStyle(code: ConvectiveRisk | null): string {
  const colors: Record<string, string> = {
    HIGH: '#7f1d1d', MDT: '#c0392b', ENH: '#d97706', SLGT: '#ca8a04', MRGL: '#16a34a', TSTM: '#1d4ed8',
  };
  const bg = code ? (colors[code] ?? '#374151') : '#374151';
  return `background:${bg};color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700`;
}

export {type ConvectiveRisk} from './spc-outlook';