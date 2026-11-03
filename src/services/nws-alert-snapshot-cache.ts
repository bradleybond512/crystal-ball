import { fetchNWSAlertsSnapshot } from './nws-alerts';
import { validateNWSAlertSnapshot, type NWSAlertSnapshot } from './nws-alert-snapshot';
import { withOfflineCache, type CachedSnapshot } from './offline-alert-cache';

export const NWS_SNAPSHOT_FRESH_MS = 5 * 60_000;
const NWS_SNAPSHOT_CACHE_KEY = 'nws-alerts-snapshot-v1';
const NWS_SNAPSHOT_CACHE_MS = 60 * 60_000;

export async function fetchCachedNwsSnapshot(): Promise<CachedSnapshot<NWSAlertSnapshot>> {
  const result = await withOfflineCache(NWS_SNAPSHOT_CACHE_KEY, async () => {
    const snapshot = validateNWSAlertSnapshot(await fetchNWSAlertsSnapshot());
    if (!snapshot) throw new Error('Invalid national NWS snapshot');
    return snapshot;
  }, NWS_SNAPSHOT_CACHE_MS);
  const data = validateNWSAlertSnapshot(result.data);
  if (!data) throw new Error('Invalid cached national NWS snapshot');
  const age = Math.max(0, Date.now() - data.observedAt);
  return {
    ...result,
    data,
    cachedAt: data.observedAt,
    expiresAt: data.observedAt + NWS_SNAPSHOT_CACHE_MS,
    isStale: result.source === 'offline-cache' || age >= NWS_SNAPSHOT_FRESH_MS,
    staleDurationMs: age,
  };
}
