import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface GridAlert {
  id: string;
  severity: 'emergency' | 'warning' | 'watch' | 'info';
  title: string;
  description: string;
  region: string;
  timestamp: number;
}

export interface GridStatus {
  region: string;
  demand: number; // MW
  capacity: number; // MW
  utilizationPct: number;
  alerts: GridAlert[];
  lastUpdate: number;
}

let cachedData: { data: GridStatus[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function fetchGridStatus(): Promise<GridStatus[]> {
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL_MS) {
 return cachedData.data;
  }

  const base = getApiBaseUrl();
  const [gridRes, alertsRes] = await Promise.allSettled([
 fetch(`${base}/api/power-grid`),
 fetch(`${base}/api/grid-alerts`),
  ]);

  const gridData = gridRes.status === 'fulfilled' && gridRes.value.ok
 ? (await gridRes.value.json()) as { regions: Array<{ region: string; demand: number; capacity: number }> }
 : { regions: [] };

  const alertsData = alertsRes.status === 'fulfilled' && alertsRes.value.ok
 ? (await alertsRes.value.json()) as { alerts: GridAlert[] }
 : { alerts: [] };

  const alertsByRegion = new Map<string, GridAlert[]>();
  for (const alert of alertsData.alerts) {
 const existing = alertsByRegion.get(alert.region) ?? [];
 existing.push(alert);
 alertsByRegion.set(alert.region, existing);
  }

  const now = Date.now();
  const statuses: GridStatus[] = gridData.regions.map(r => {
 const utilization = r.capacity > 0 ? (r.demand / r.capacity) * 100 : 0;
 return {
 region: r.region,
 demand: r.demand,
 capacity: r.capacity,
 utilizationPct: Math.round(utilization * 10) / 10,
 alerts: alertsByRegion.get(r.region) ?? [],
 lastUpdate: now,
 };
  });

  // Attach unmatched alerts to a synthetic "Other" region or first region
  const matchedRegions = new Set(statuses.map(s => s.region));
  const unmatchedAlerts: GridAlert[] = [];
  for (const [region, alerts] of alertsByRegion) {
 if (!matchedRegions.has(region)) {
 unmatchedAlerts.push(...alerts);
 }
  }

  // Add unmatched alerts to the first status entry, or create a placeholder
  if (unmatchedAlerts.length > 0 && statuses.length > 0) {
 statuses[0]!.alerts.push(...unmatchedAlerts);
 }

  cachedData = { data: statuses, fetchedAt: now };
  dataFreshness.recordUpdate('power-grid', statuses.length);
  return statuses;
}
