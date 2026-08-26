/**
 * Loader-callable fetch for OpenAQ v3 global "worst" stations,
 * so air-quality fusion has a real second source alongside Open-Meteo. Mirrors
 * the OpenaqMonitorPanel.loadWorst() fetch+parse path. Fail-closed: failures
 * record an error on the dedicated 'openaq-aqi' source (never silently drop).
 */

import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';
import {
  parseOpenaqEnvelope,
  pickGlobalWorst,
  type MonitorReading,
} from './openaq-service';

export interface OpenaqFetchResult {
  /** false on network/timeout error, non-2xx, OR a sidecar `degraded: true`
   *  response — so the caller records a failing fetch and the provider health
   *  drops instead of a dead source masquerading as healthy-but-empty. */
  ok: boolean;
  readings: MonitorReading[];
}

export async function fetchOpenaqWorstReadings(now = Date.now()): Promise<OpenaqFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/airquality/openaq/worst`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      dataFreshness.recordError('openaq-aqi', `HTTP ${res.status}`);
      return { ok: false, readings: [] };
    }
    const parsed = parseOpenaqEnvelope(await res.json());
    if (!parsed.ok) {
      dataFreshness.recordError('openaq-aqi', parsed.error);
      return { ok: false, readings: [] };
    }
    const readings = pickGlobalWorst(parsed.readings, now, 100);
    if (readings.length === 0) {
      dataFreshness.recordError('openaq-aqi', 'no usable readings');
      return { ok: false, readings: [] };
    }
    dataFreshness.recordUpdate('openaq-aqi', readings.length);
    return { ok: true, readings };
  } catch (error) {
    dataFreshness.recordError('openaq-aqi', String(error));
    return { ok: false, readings: [] };
  }
}
