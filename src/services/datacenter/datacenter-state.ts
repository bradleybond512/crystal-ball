import type { GridStatus } from '../power-grid.ts';
import type { NwsAlertMinimal } from '../weather/weather-threat-types.ts';
import type {
  ConnectivitySignal,
  DataCenterPosture,
  ForecastSlot,
  NearbySeismicEvent,
  SiteAirQuality,
  SiteConditions,
  SiteConfig,
} from './datacenter-types.ts';
import type { PowerContext } from '../infrastructure/osm-power.ts';
import { computeDatacenterPosture } from './datacenter-posture.ts';

type Listener = (posture: DataCenterPosture | null) => void;

let site: SiteConfig | null = null;
let posture: DataCenterPosture | null = null;
const listeners = new Set<Listener>();

export function setDatacenterSite(next: SiteConfig | null): void {
  if (site === next) return;
  site = next;
  posture = null;
  emit();
}

export function getDatacenterSite(): SiteConfig | null {
  return site;
}

export function getDatacenterPosture(): DataCenterPosture | null {
  return posture;
}

export interface RecomputeInput {
  gridStatus: GridStatus | null;
  weatherAlerts: readonly NwsAlertMinimal[];
  nearbyOutageCount: number | null;
  now?: number;
  conditions?: SiteConditions | null;
  forecast24h?: ForecastSlot[];
  airQuality?: SiteAirQuality | null;
  seismicNearby?: NearbySeismicEvent[];
  connectivity?: ConnectivitySignal | null;
  gridInfrastructure?: PowerContext | null;
}

export function recomputeDatacenterPosture(input: RecomputeInput): DataCenterPosture | null {
  if (!site) return null;
  posture = computeDatacenterPosture({ site, ...input });
  emit();
  return posture;
}

export function subscribeDatacenterPosture(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const l of listeners) l(posture);
}

export function __resetDatacenterStateForTests(): void {
  site = null;
  posture = null;
  listeners.clear();
}
