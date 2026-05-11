// IPAWS / NWS CAP monitor — thin client over the sidecar /api/alerts/active
// route. The sidecar owns parsing, dedup, and expiry; this module exposes
// typed payloads and a polling helper that emits the diff on each tick.

import { getApiBaseUrl } from '@/services/runtime';

export type IpawsSource = 'NWS' | 'FEMA';
export type CapSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
export type CapUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
export type CapCertainty = 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown';

export interface IpawsAlert {
  id: string;
  source: IpawsSource;
  event: string;
  headline: string;
  description: string;
  severity: CapSeverity;
  urgency: CapUrgency;
  certainty: CapCertainty;
  areaDesc: string;
  effective: string;
  expires: string;
  status: string;
  centroid: [number, number] | null;
}

export interface IpawsResponse {
  alerts: IpawsAlert[];
  fetchedAt: string;
  sources: { nws: 'ok' | 'degraded'; fema: 'ok' | 'degraded' };
  degraded?: boolean;
  reason?: string;
}

const POLL_DEFAULT_MS = 60 * 1000;

export async function fetchActiveAlerts(): Promise<IpawsResponse> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/alerts/active`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`alerts/active: ${res.status}`);
    const raw = (await res.json()) as Partial<IpawsResponse>;
    return {
      alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
      fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : new Date().toISOString(),
      sources: raw.sources ?? { nws: 'degraded', fema: 'degraded' },
      ...(raw.degraded ? { degraded: true, reason: raw.reason } : {}),
    };
  } catch (error) {
    return {
      alerts: [],
      fetchedAt: new Date().toISOString(),
      sources: { nws: 'degraded', fema: 'degraded' },
      degraded: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface IpawsPollingHandle {
  stop: () => void;
}

/**
 * Polls /api/alerts/active and invokes the callback with the FULL alert list
 * (not just deltas) plus a `newAlerts` slice containing alerts not present
 * in the previous tick. Caller is responsible for dispatching events.
 */
export function startIpawsPolling(
  onTick: (response: IpawsResponse, newAlerts: IpawsAlert[]) => void,
  intervalMs: number = POLL_DEFAULT_MS,
): IpawsPollingHandle {
  let stopped = false;
  let lastSeenIds = new Set<string>();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const response = await fetchActiveAlerts();
    if (stopped) return;
    const newAlerts = response.alerts.filter(a => !lastSeenIds.has(a.id));
    lastSeenIds = new Set(response.alerts.map(a => a.id));
    onTick(response, newAlerts);
  };

  void tick();
  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}

export function diffAlerts(prev: IpawsAlert[], next: IpawsAlert[]): IpawsAlert[] {
  const prevIds = new Set(prev.map(a => a.id));
  return next.filter(a => !prevIds.has(a.id));
}
