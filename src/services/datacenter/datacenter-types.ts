import type { GridAlert } from '../power-grid.ts';
import type { EiaRegion } from '../infrastructure/grid-monitor.ts';
import type { PowerContext } from '../infrastructure/osm-power.ts';
import type { ThreatLevel, WeatherHazardKind } from '../weather/weather-threat-types.ts';
import type { StormModePayload } from '../weather/personal-storm-mode.ts';

/** Blended verdict ladder. Mirrors the weather ThreatLevel ordering but is a
 *  distinct type: weather's 'none'/'emergency' map to 'normal'/'critical'. */
export type DcLevel = 'normal' | 'watch' | 'advisory' | 'warning' | 'critical';

const DC_LEVEL_ORDER: readonly DcLevel[] = ['normal', 'watch', 'advisory', 'warning', 'critical'];

export function dcLevelRank(level: DcLevel): number {
  return DC_LEVEL_ORDER.indexOf(level);
}

export function maxDcLevel(a: DcLevel, b: DcLevel): DcLevel {
  return dcLevelRank(a) >= dcLevelRank(b) ? a : b;
}

export function bumpDcLevel(level: DcLevel): DcLevel {
  const next = Math.min(DC_LEVEL_ORDER.length - 1, dcLevelRank(level) + 1);
  return DC_LEVEL_ORDER[next]!;
}

export function mapThreatLevelToDc(level: ThreatLevel): DcLevel {
  switch (level) {
    case 'none': { return 'normal';
    }
    case 'watch': { return 'watch';
    }
    case 'advisory': { return 'advisory';
    }
    case 'warning': { return 'warning';
    }
    case 'emergency': { return 'critical';
    }
  }
}

export type ActionAudience = 'onsite_safety' | 'commute_staffing' | 'facility_ops' | 'escalation';
export type ActionUrgency = 'now' | 'soon' | 'be_ready' | 'monitor';

export interface ReadinessAction {
  id: string;
  audience: ActionAudience;
  urgency: ActionUrgency;
  title: string;
  detail: string;
  trigger: string;
  expiresAt: number | null;
}

export interface SiteConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  eiaRegion: EiaRegion;
  /** UGC zone/county codes for the site, derived at runtime from NWS
   *  `/points`. Enables zone-fallback matching for polygon-free alerts. */
  ugcZones?: string[];
}

export interface PowerPosture {
  level: DcLevel;
  gridUtilizationPct: number | null;
  gridAlerts: GridAlert[];
  nearbyOutageCount: number | null;
  drivers: string[];
}

export interface WeatherPosture {
  level: DcLevel;
  activeHazards: WeatherHazardKind[];
  stormMode: StormModePayload | null;
  arrivalWindowMins: number | null;
  drivers: string[];
}

export interface SiteConditions {
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  precipMm: number;
  uvIndex: number | null;
  weatherCode: number;
}

export interface ForecastSlot {
  offsetHours: number;
  tempC: number;
  precipProbabilityPct: number;
  weatherCode: number;
}

export interface SiteAirQuality {
  usAqi: number | null;
  pm25: number | null;
}

export interface NearbySeismicEvent {
  magnitudeM: number;
  distanceKm: number;
  place: string;
  occurredAt: number;
}

export type ConnectivityStatus = 'normal' | 'degraded' | 'outage';

export interface ConnectivitySignal {
  status: ConnectivityStatus;
  cloudflare: boolean | null;
  fastly: boolean | null;
}

export interface DataCenterPosture {
  site: SiteConfig;
  overall: DcLevel;
  headline: string;
  power: PowerPosture;
  weather: WeatherPosture;
  /** Nearby grid infrastructure (OSM: plants/substations/lines), when fetched. */
  gridInfrastructure: PowerContext | null;
  conditions: SiteConditions | null;
  forecast24h: ForecastSlot[];
  airQuality: SiteAirQuality | null;
  seismicNearby: NearbySeismicEvent[];
  connectivity: ConnectivitySignal | null;
  actions: ReadinessAction[];
  updatedAt: number;
  staleInputs: string[];
}
