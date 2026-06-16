import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface RipeAtlasAnchor {
  id: number;
  fqdn: string;
  country: string;
  is_ipv4_only: boolean;
  geometry: { type: string; coordinates: [number, number] } | null;
}

export interface RipeAtlasStatus {
  totalConnectedProbes: number;
  anchors: RipeAtlasAnchor[];
}

let cache: { data: RipeAtlasStatus; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchRipeAtlasStatus(): Promise<RipeAtlasStatus> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const base = getApiBaseUrl();
  const [statusRes, anchorsRes] = await Promise.allSettled([
    fetch(`${base}/api/ripe-atlas?type=status`, { signal: AbortSignal.timeout(12_000) }),
    fetch(`${base}/api/ripe-atlas?type=anchors`, { signal: AbortSignal.timeout(12_000) }),
  ]);

  let statusData: { totalConnectedProbes: number } = { totalConnectedProbes: 0 };
  if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
    const raw = await statusRes.value.json() as { totalConnectedProbes: number };
    if (raw && typeof raw === 'object' && typeof raw.totalConnectedProbes === 'number') {
      statusData = raw;
    }
  }

  let anchorsData: { anchors: RipeAtlasAnchor[]; count: number } = { anchors: [], count: 0 };
  if (anchorsRes.status === 'fulfilled' && anchorsRes.value.ok) {
    const raw = await anchorsRes.value.json() as { anchors: RipeAtlasAnchor[]; count: number };
    if (raw && typeof raw === 'object' && Array.isArray(raw.anchors)) {
      anchorsData = raw;
    }
  }

  const result: RipeAtlasStatus = {
    totalConnectedProbes: statusData.totalConnectedProbes,
    anchors: anchorsData.anchors,
  };

  cache = { data: result, fetchedAt: Date.now() };
  dataFreshness.recordUpdate('ripe-atlas', result.anchors.length);
  return result;
}
