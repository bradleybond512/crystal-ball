import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';
import { validateNWSAlertSnapshot, type NWSAlert, type NWSAlertSnapshot } from './nws-alert-snapshot';

export { validateNWSAlertSnapshot } from './nws-alert-snapshot';
export type { NWSAlert, NWSAlertSnapshot, NWSGeometry } from './nws-alert-snapshot';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
let cache: NWSAlertSnapshot | null = null;
let inflight: Promise<NWSAlertSnapshot> | null = null;

export function _resetNwsAlertsForTest(): void {
  cache = null;
  inflight = null;
}

export function captureNwsObservation(): (alerts: NWSAlert[]) => boolean {
  const previous = cache?.alerts;
  return alerts => alerts !== previous && alerts === cache?.alerts;
}

export async function fetchNWSAlertsSnapshot(): Promise<NWSAlertSnapshot> {
  if (cache && Date.now() - cache.observedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = doFetchNWSAlertsSnapshot().finally(() => { inflight = null; });
  return inflight;
}

export async function fetchNWSAlerts(): Promise<NWSAlert[]> {
  const snapshot = await fetchNWSAlertsSnapshot();
  return snapshot.alerts;
}

async function readNwsResponse(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error('NWS alerts response exceeded byte limit');
  }
  if (!response.body) throw new Error('NWS alerts response body missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel('NWS response exceeded byte limit');
        throw new Error('NWS alerts response exceeded byte limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

async function doFetchNWSAlertsSnapshot(): Promise<NWSAlertSnapshot> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/nws-alerts`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`NWS alerts HTTP ${response.status}`);
    const snapshot = validateNWSAlertSnapshot(await readNwsResponse(response));
    if (!snapshot) throw new Error('NWS alerts response was malformed');
    cache = snapshot;
    dataFreshness.recordUpdate('nws-alerts', snapshot.alerts.length, snapshot.observedAt);
    return snapshot;
  } catch (error) {
    dataFreshness.recordError('nws-alerts', String(error));
    throw error;
  }
}

export function nwsSeverityClass(severity: NWSAlert['severity']): string {
  return {
    Extreme: 'eq-row eq-major',
    Severe: 'eq-row eq-strong',
    Moderate: 'eq-row eq-moderate',
    Minor: 'eq-row',
    Unknown: 'eq-row',
  }[severity] ?? 'eq-row';
}
