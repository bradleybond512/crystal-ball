/**
 * Loader-callable fetch for OpenAQ v3 global "worst" stations (no key needed),
 * so air-quality fusion has a real second source alongside Open-Meteo. Mirrors
 * the OpenaqMonitorPanel.loadWorst() fetch+parse path. Fail-closed: failures
 * record an error on the dedicated 'openaq-aqi' source (never silently drop).
 */

import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';
import {
  parseOpenaqLocations,
  pickGlobalWorst,
  type MonitorReading,
  type OpenaqLocationRaw,
} from './openaq-service';

export async function fetchOpenaqWorstReadings(now = Date.now()): Promise<MonitorReading[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/airquality/openaq/worst`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      dataFreshness.recordError('openaq-aqi', `HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { locations?: OpenaqLocationRaw[] } | null;
    const readings = pickGlobalWorst(parseOpenaqLocations(data?.locations ?? []), now, 100);
    dataFreshness.recordUpdate('openaq-aqi', readings.length);
    return readings;
  } catch (error) {
    dataFreshness.recordError('openaq-aqi', String(error));
    return [];
  }
}
