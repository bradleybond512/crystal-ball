import type { PizzIntStatus, PizzIntLocation, PizzIntDefconLevel, GdeltTensionPair } from '@/types';
import { getApiBaseUrl } from '@/services/runtime';
import { createCircuitBreaker } from '@/utils';

// ── Raw API shapes ──────────────────────────────────────────────────────────

interface RawLocation {
  place_id: string;
  name: string;
  address: string;
  current_popularity: number;
  percentage_of_usual: number | null;
  is_spike: boolean;
  spike_magnitude: number | null;
  data_source: string;
  recorded_at: string;
  data_freshness: string;
  is_closed_now?: boolean;
  lat?: number;
  lng?: number;
}

interface DashboardResponse {
  success: boolean;
  data: RawLocation[];
}

interface RawTensionPair {
  id: string;
  countries: [string, string];
  label: string;
  score: number;
  trend: 'rising' | 'stable' | 'falling';
  change_percent: number;
  region: string;
}

// ── DEFCON labels ───────────────────────────────────────────────────────────

const DEFCON_LABELS: Record<number, string> = {
  1: 'MAXIMUM ALERT',
  2: 'ELEVATED ALERT',
  3: 'HEIGHTENED',
  4: 'GUARDED',
  5: 'NORMAL',
};

// ── DEFCON computation ──────────────────────────────────────────────────────

function computeDefcon(locations: RawLocation[]): {
  defconLevel: PizzIntDefconLevel;
  aggregateActivity: number;
  activeSpikes: number;
  locationsMonitored: number;
  locationsOpen: number;
} {
  const open = locations.filter(l => !l.is_closed_now);
  const locationsMonitored = locations.length;
  const locationsOpen = open.length;
  const activeSpikes = open.filter(l => l.is_spike).length;
  const aggregateActivity = open.length > 0
 ? open.reduce((sum, l) => sum + l.current_popularity, 0) / open.length
 : 0;

  let defconLevel: PizzIntDefconLevel;
  if (activeSpikes >= 7 || aggregateActivity >= 85) defconLevel = 1;
  else if (activeSpikes >= 4 || aggregateActivity >= 70) defconLevel = 2;
  else if (activeSpikes >= 2 || aggregateActivity >= 50) defconLevel = 3;
  else if (activeSpikes >= 1 || aggregateActivity >= 30) defconLevel = 4;
  else defconLevel = 5;

  return { defconLevel, aggregateActivity, activeSpikes, locationsMonitored, locationsOpen };
}

// ── Circuit breakers ────────────────────────────────────────────────────────

const pizzintBreaker = createCircuitBreaker<PizzIntStatus>({
  name: 'PizzINT',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
  cacheTtlMs: 30 * 60 * 1000,
  persistCache: true,
});

const gdeltBreaker = createCircuitBreaker<GdeltTensionPair[]>({
  name: 'GDELT Tensions',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
  cacheTtlMs: 10 * 60 * 1000,
  persistCache: true,
});

// ── Defaults ────────────────────────────────────────────────────────────────

const defaultStatus: PizzIntStatus = {
  defconLevel: 5,
  defconLabel: DEFCON_LABELS[5]!,
  aggregateActivity: 0,
  activeSpikes: 0,
  locationsMonitored: 0,
  locationsOpen: 0,
  lastUpdate: new Date(),
  dataFreshness: 'stale',
  locations: [],
};

// ── Public API ──────────────────────────────────────────────────────────────

export async function fetchPizzIntStatus(): Promise<PizzIntStatus> {
  return pizzintBreaker.execute(async () => {
 const resp = await fetch(`${getApiBaseUrl()}/api/pizzint/dashboard`);
 if (!resp.ok) throw new Error(`PizzINT dashboard returned ${resp.status}`);
 const raw = await resp.json() as DashboardResponse;
 if (!raw.success || !Array.isArray(raw.data) || raw.data.length === 0) {
 throw new Error('No PizzINT locations in response');
 }

 const { defconLevel, aggregateActivity, activeSpikes, locationsMonitored, locationsOpen } =
 computeDefcon(raw.data);

 const locations: PizzIntLocation[] = raw.data.map(d => ({
 place_id: d.place_id,
 name: d.name,
 address: d.address,
 current_popularity: d.current_popularity,
 percentage_of_usual: d.percentage_of_usual,
 is_spike: d.is_spike,
 spike_magnitude: d.spike_magnitude,
 data_source: d.data_source,
 recorded_at: d.recorded_at,
 data_freshness: d.data_freshness === 'fresh' ? 'fresh' : 'stale',
 is_closed_now: d.is_closed_now ?? false,
 lat: d.lat,
 lng: d.lng,
 }));

 return {
 defconLevel,
 defconLabel: DEFCON_LABELS[defconLevel]!,
 aggregateActivity,
 activeSpikes,
 locationsMonitored,
 locationsOpen,
 lastUpdate: new Date(),
 dataFreshness: raw.data.some(d => d.data_freshness === 'fresh') ? 'fresh' : 'stale',
 locations,
 };
  }, defaultStatus);
}

export async function fetchGdeltTensions(): Promise<GdeltTensionPair[]> {
  return gdeltBreaker.execute(async () => {
 const resp = await fetch(`${getApiBaseUrl()}/api/pizzint/gdelt`);
 if (!resp.ok) throw new Error(`GDELT tensions returned ${resp.status}`);
 const raw = await resp.json() as RawTensionPair[];
 if (!Array.isArray(raw)) throw new Error('Unexpected GDELT tensions response shape');
 return raw.map(r => ({
 id: r.id,
 countries: r.countries,
 label: r.label,
 score: r.score,
 trend: r.trend,
 changePercent: r.change_percent,
 region: r.region,
 }));
  }, []);
}

export function getPizzIntStatus(): string {
  return pizzintBreaker.getStatus();
}

export function getGdeltStatus(): string {
  return gdeltBreaker.getStatus();
}
