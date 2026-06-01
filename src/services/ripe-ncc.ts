import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export type RipeNccData = Record<string, unknown>;

export async function fetchRipeNccAsn(asn: string): Promise<RipeNccData | null> {
  if (!isFeatureAvailable('ripeNccData')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ripe-ncc?asn=${encodeURIComponent(asn)}`);
 if (!res.ok) return null;
 return (await res.json()) as RipeNccData;
  } catch {
 return null;
  }
}

export async function fetchRipeNccRoutingStatus(): Promise<RipeNccData | null> {
  if (!isFeatureAvailable('ripeNccData')) return null;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/ripe-ncc`);
 if (!res.ok) return null;
 return (await res.json()) as RipeNccData;
  } catch {
 return null;
  }
}

// ── Typed BGP routing-status view (for RipeNccPanel) ──────────────────────
// Normalised subset of the RIPE Stat `routing-status` payload proxied by
// /api/ripe-ncc. The raw API uses snake_case + array specifics; we flatten
// to the few fields the panel surfaces.
export interface RipeRoutingSeen {
  prefix: string;
  origin: string;
  time: string;
}

export interface RipeRoutingStatus {
  resource: string;
  v4PeersSeeing: number;
  v4TotalPeers: number;
  v6PeersSeeing: number;
  v6TotalPeers: number;
  origins: number[];
  firstSeen: RipeRoutingSeen | null;
  lastSeen: RipeRoutingSeen | null;
  lessSpecifics: number;
  moreSpecifics: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function fetchRipeNccStatus(): Promise<RipeRoutingStatus | null> {
  const raw = await fetchRipeNccRoutingStatus();
  if (!raw) return null;
  const vis = asRecord(raw.visibility);
  const v4 = asRecord(vis.v4);
  const v6 = asRecord(vis.v6);
  const origins = Array.isArray(raw.origins)
 ? raw.origins.map((o) => asNumber(asRecord(o).origin)).filter((n) => n > 0)
 : [];
  return {
 resource: typeof raw.resource === 'string' ? raw.resource : '—',
 v4PeersSeeing: asNumber(v4.ris_peers_seeing),
 v4TotalPeers: asNumber(v4.total_ris_peers),
 v6PeersSeeing: asNumber(v6.ris_peers_seeing),
 v6TotalPeers: asNumber(v6.total_ris_peers),
 origins,
 firstSeen: (raw.first_seen as RipeRoutingSeen) ?? null,
 lastSeen: (raw.last_seen as RipeRoutingSeen) ?? null,
 lessSpecifics: Array.isArray(raw.less_specifics) ? raw.less_specifics.length : 0,
 moreSpecifics: Array.isArray(raw.more_specifics) ? raw.more_specifics.length : 0,
  };
}
