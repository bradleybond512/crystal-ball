/**
 * Observation Adapter registry — Phase 3 of the intelligence loop.
 *
 * Every feed in the app eventually produces ObservationEvents. Historically
 * each provider had a hand-written `<thing>ToObservation()` function and
 * callers wired them up by hand. This module gives those adapters a
 * uniform shape, registers them by `sourceId`, and ships a fallback
 * `GenericAdapter` for sources that don't yet have one.
 *
 * Pure deterministic. No DOM, no fetch, no I/O. Inputs are plain objects.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

export type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import {
  earthquakeToObservation,
  earthquakesToObservations,
} from './adapters/earthquake-adapter';
import {
  airQualityToObservation,
  airQualityToObservations,
  type AirQualitySample,
} from './adapters/air-quality-adapter';
import {
  wildfireToObservation,
  wildifiresToObservations,
} from './adapters/wildfire-adapter';

// ── Adapter interface ─────────────────────────────────────────────────────

export interface ObservationAdapter<TRaw> {
  /** Stable id used to dispatch — matches ObservationEvent.sourceId. */
  sourceId: string;
  domain: string;
  /** Returns undefined when the raw record can't be normalized
   *  (e.g. wildfire with missing coordinates). */
  adaptOne(raw: TRaw): ObservationEvent | undefined;
  adaptMany(raws: readonly TRaw[]): ObservationEvent[];
}

export class AdapterRegistry {
  private readonly bySourceId = new Map<string, ObservationAdapter<unknown>>();

  register<T>(adapter: ObservationAdapter<T>): void {
    this.bySourceId.set(adapter.sourceId, adapter as ObservationAdapter<unknown>);
  }

  has(sourceId: string): boolean {
    return this.bySourceId.has(sourceId);
  }

  adapt(sourceId: string, raw: unknown): ObservationEvent | undefined {
    return this.bySourceId.get(sourceId)?.adaptOne(raw);
  }

  adaptAll(sourceId: string, raws: readonly unknown[]): ObservationEvent[] {
    const adapter = this.bySourceId.get(sourceId);
    return adapter ? adapter.adaptMany(raws) : [];
  }
}

// ── Built-in adapter: USGS earthquakes ────────────────────────────────────

interface EarthquakeRaw {
  id: string;
  occurredAt: number;
  magnitude: number;
  place: string;
  depthKm: number;
  location?: { latitude: number; longitude: number };
}

export const EarthquakeAdapter: ObservationAdapter<EarthquakeRaw> = {
  sourceId: 'usgs-earthquake',
  domain: 'weather',
  adaptOne: (raw) => earthquakeToObservation(raw as never),
  adaptMany: (raws) => earthquakesToObservations(raws as never[]),
};

export const AirQualityAdapter: ObservationAdapter<AirQualitySample> = {
  sourceId: 'airnow',
  domain: 'weather',
  adaptOne: (raw) => airQualityToObservation(raw),
  adaptMany: (raws) => airQualityToObservations(raws),
};

// ── Built-in adapter: NWS weather alerts ─────────────────────────────────

interface NwsAlertRaw {
  id: string;
  event: string;
  severity: 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';
  onset: number;
  expires: number;
  area: string;
  geometry?: { coordinates?: readonly [number, number] };
}

const NWS_SEVERITY: Record<NwsAlertRaw['severity'], ObservationSeverity> = {
  Extreme: 'CRITICAL',
  Severe: 'HIGH',
  Moderate: 'MEDIUM',
  Minor: 'LOW',
  Unknown: 'INFO',
};

export const WeatherAdapter: ObservationAdapter<NwsAlertRaw> = {
  sourceId: 'nws-alerts',
  domain: 'weather',
  adaptOne: (raw) => {
    const coords = raw.geometry?.coordinates;
    const location = coords ? { lat: coords[1], lon: coords[0] } : undefined;
    const tags = ['weather-alert', raw.event.toLowerCase().replace(/\s+/g, '-')];
    return {
      id: `nws-${raw.id}`,
      sourceId: 'nws-alerts',
      domain: 'weather',
      timestamp: raw.onset,
      location,
      severity: NWS_SEVERITY[raw.severity],
      title: `${raw.event} — ${raw.area}`,
      raw,
      entityIds: [],
      tags,
    };
  },
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: aviation (OpenSky / FlightAware) ───────────────────

interface AviationRaw {
  icao24: string;
  callsign?: string | null;
  latitude: number;
  longitude: number;
  altitude: number;
  /** Squawk code; 7500/7600/7700 are emergency. */
  squawk?: string | null;
  timestamp: number;
}

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

export const AviationAdapter: ObservationAdapter<AviationRaw> = {
  sourceId: 'aviation-track',
  domain: 'aviation',
  adaptOne: (raw) => {
    const emergency = raw.squawk ? EMERGENCY_SQUAWKS.has(raw.squawk) : false;
    const tags = ['aviation'];
    if (emergency) tags.push('emergency-squawk', `squawk-${raw.squawk}`);
    return {
      id: `aviation-${raw.icao24}-${raw.timestamp}`,
      sourceId: 'aviation-track',
      domain: 'aviation',
      timestamp: raw.timestamp,
      location: { lat: raw.latitude, lon: raw.longitude },
      severity: emergency ? 'CRITICAL' : 'INFO',
      title: emergency
        ? `Emergency squawk ${raw.squawk} — ${raw.callsign ?? raw.icao24}`
        : `Aviation track ${raw.callsign ?? raw.icao24}`,
      raw,
      entityIds: raw.callsign ? [raw.callsign, raw.icao24] : [raw.icao24],
      tags,
    };
  },
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: maritime AIS ────────────────────────────────────────

interface MaritimeRaw {
  mmsi: string;
  vesselName: string;
  lat: number;
  lon: number;
  speedKn: number;
  destination: string;
  timestamp: number;
}

export const MaritimeAdapter: ObservationAdapter<MaritimeRaw> = {
  sourceId: 'ais-disruption',
  domain: 'maritime',
  adaptOne: (raw) => {
    const stopped = raw.speedKn === 0;
    const tags = ['ais', 'maritime'];
    if (stopped) tags.push('vessel-stopped');
    const destSuffix = raw.destination ? ` → ${raw.destination}` : '';
    return {
      id: `ais-${raw.mmsi}-${raw.timestamp}`,
      sourceId: 'ais-disruption',
      domain: 'maritime',
      timestamp: raw.timestamp,
      location: { lat: raw.lat, lon: raw.lon },
      severity: stopped ? 'MEDIUM' : 'INFO',
      title: `${raw.vesselName} (${raw.mmsi})${destSuffix}`,
      raw,
      entityIds: [raw.mmsi],
      tags,
    };
  },
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: wildfire (InciWeb) ──────────────────────────────────

export const WildfireAdapter: ObservationAdapter<Parameters<typeof wildfireToObservation>[0]> = {
  sourceId: 'inciweb-wildfire',
  domain: 'weather',
  adaptOne: (raw) => wildfireToObservation(raw) ?? undefined,
  adaptMany: (raws) => wildifiresToObservations(raws as never[]),
};

// ── Built-in adapter: space weather (SWPC) ────────────────────────────────

interface SpaceWeatherRaw {
  id: string;
  eventType: 'geomagnetic-storm' | 'solar-flare' | 'solar-radiation-storm' | 'radio-blackout';
  /** G/S/R scale: G1..G5, S1..S5, R1..R5. */
  scale: string;
  onset: number;
  regions: readonly string[];
}

function spaceWeatherSeverity(scale: string): ObservationSeverity {
  const digit = Number(scale.replace(/^[A-Z]/, ''));
  if (digit >= 5) return 'CRITICAL';
  if (digit >= 4) return 'HIGH';
  if (digit >= 3) return 'MEDIUM';
  if (digit >= 1) return 'LOW';
  return 'INFO';
}

export const SpaceWeatherAdapter: ObservationAdapter<SpaceWeatherRaw> = {
  sourceId: 'swpc-space-weather',
  domain: 'space',
  adaptOne: (raw) => ({
    id: `swpc-${raw.id}`,
    sourceId: 'swpc-space-weather',
    domain: 'space',
    timestamp: raw.onset,
    severity: spaceWeatherSeverity(raw.scale),
    title: `${raw.eventType.replace(/-/g, ' ')} ${raw.scale}`,
    raw,
    entityIds: [...raw.regions],
    tags: ['space-weather', raw.eventType, `scale-${raw.scale.toLowerCase()}`],
  }),
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: biosurveillance (CDC / WHO) ─────────────────────────

interface BiosurveillanceRaw {
  id: string;
  disease: string;
  location: string;
  caseCount: number;
  timestamp: number;
  lat?: number;
  lon?: number;
}

function biosurveillanceSeverity(cases: number): ObservationSeverity {
  if (cases >= 1000) return 'CRITICAL';
  if (cases >= 250) return 'HIGH';
  if (cases >= 50) return 'MEDIUM';
  return 'LOW';
}

export const BiosurveillanceAdapter: ObservationAdapter<BiosurveillanceRaw> = {
  sourceId: 'cdc-biosurveillance',
  domain: 'humanitarian',
  adaptOne: (raw) => ({
    id: `bio-${raw.id}`,
    sourceId: 'cdc-biosurveillance',
    domain: 'humanitarian',
    timestamp: raw.timestamp,
    location: raw.lat != null && raw.lon != null ? { lat: raw.lat, lon: raw.lon } : undefined,
    severity: biosurveillanceSeverity(raw.caseCount),
    title: `${raw.disease} — ${raw.location} (${raw.caseCount} cases)`,
    raw,
    entityIds: [],
    tags: ['biosurveillance', 'outbreak', raw.disease.toLowerCase().replace(/\s+/g, '-')],
  }),
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: sanctions (OFAC) ───────────────────────────────────

interface SanctionsRaw {
  sdnId: string;
  entityType: 'Individual' | 'Entity' | 'Vessel' | 'Aircraft';
  name: string;
  reason: string;
  timestamp: number;
}

export const SanctionsAdapter: ObservationAdapter<SanctionsRaw> = {
  sourceId: 'ofac-sanctions',
  domain: 'macro',
  adaptOne: (raw) => ({
    id: `ofac-${raw.sdnId}`,
    sourceId: 'ofac-sanctions',
    domain: 'macro',
    timestamp: raw.timestamp,
    severity: 'MEDIUM',
    title: `OFAC: ${raw.entityType} ${raw.name} — ${raw.reason}`,
    raw,
    entityIds: [raw.sdnId],
    tags: ['sanctions', 'ofac', raw.entityType.toLowerCase()],
  }),
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: infrastructure (CISA / BGP) ────────────────────────

interface InfrastructureRaw {
  id: string;
  affectedSystem: string;
  impactType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  lat?: number;
  lon?: number;
}

const INFRA_SEVERITY: Record<InfrastructureRaw['severity'], ObservationSeverity> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export const InfrastructureAdapter: ObservationAdapter<InfrastructureRaw> = {
  sourceId: 'cisa-infrastructure',
  domain: 'infra',
  adaptOne: (raw) => ({
    id: `cisa-${raw.id}`,
    sourceId: 'cisa-infrastructure',
    domain: 'infra',
    timestamp: raw.timestamp,
    location: raw.lat != null && raw.lon != null ? { lat: raw.lat, lon: raw.lon } : undefined,
    severity: INFRA_SEVERITY[raw.severity],
    title: `${raw.affectedSystem} — ${raw.impactType}`,
    raw,
    entityIds: [],
    tags: ['infrastructure', 'cisa', raw.impactType],
  }),
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Built-in adapter: GDACS multi-hazard alerts ──────────────────────────

interface GdacsRaw {
  id: string;
  /** TC = Tropical Cyclone, EQ = Earthquake, FL = Flood, VO = Volcano, WF = Wildfire, DR = Drought. */
  eventType: 'TC' | 'EQ' | 'FL' | 'VO' | 'WF' | 'DR';
  alertLevel: 'Red' | 'Orange' | 'Green';
  country: string;
  lat: number;
  lon: number;
  onset: number;
}

const GDACS_SEVERITY: Record<GdacsRaw['alertLevel'], ObservationSeverity> = {
  Red: 'CRITICAL',
  Orange: 'HIGH',
  Green: 'LOW',
};

const GDACS_TAG: Record<GdacsRaw['eventType'], string> = {
  TC: 'tropical-cyclone',
  EQ: 'earthquake',
  FL: 'flood',
  VO: 'volcano',
  WF: 'wildfire',
  DR: 'drought',
};

export const GdacsAdapter: ObservationAdapter<GdacsRaw> = {
  sourceId: 'gdacs-alerts',
  domain: 'humanitarian',
  adaptOne: (raw) => ({
    id: `gdacs-${raw.id}`,
    sourceId: 'gdacs-alerts',
    domain: 'humanitarian',
    timestamp: raw.onset,
    location: { lat: raw.lat, lon: raw.lon },
    severity: GDACS_SEVERITY[raw.alertLevel],
    title: `GDACS ${raw.alertLevel} ${raw.eventType} — ${raw.country}`,
    raw,
    entityIds: [raw.country],
    tags: ['gdacs', GDACS_TAG[raw.eventType], `alert-${raw.alertLevel.toLowerCase()}`],
  }),
  adaptMany(raws) {
    return raws.map((r) => this.adaptOne(r)).filter((x): x is ObservationEvent => Boolean(x));
  },
};

// ── Generic fallback adapter ─────────────────────────────────────────────

interface GenericInput {
  id: string;
  title: string;
  timestamp: number;
  severity?: ObservationSeverity;
  lat?: number;
  lon?: number;
  tags?: readonly string[];
  entityIds?: readonly string[];
}

export interface GenericAdapterOptions {
  sourceId: string;
  domain: string;
}

export class GenericAdapter implements ObservationAdapter<GenericInput> {
  public readonly sourceId: string;
  public readonly domain: string;

  constructor(opts: GenericAdapterOptions) {
    this.sourceId = opts.sourceId;
    this.domain = opts.domain;
  }

  adaptOne(raw: GenericInput): ObservationEvent {
    return {
      id: `${this.sourceId}-${raw.id}`,
      sourceId: this.sourceId,
      domain: this.domain,
      timestamp: raw.timestamp,
      location: raw.lat != null && raw.lon != null ? { lat: raw.lat, lon: raw.lon } : undefined,
      severity: raw.severity ?? 'INFO',
      title: raw.title,
      raw,
      entityIds: raw.entityIds ? [...raw.entityIds] : [],
      tags: raw.tags ? [...raw.tags] : [],
    };
  }

  adaptMany(raws: readonly GenericInput[]): ObservationEvent[] {
    return raws.map((r) => this.adaptOne(r));
  }
}

// ── Default registry ─────────────────────────────────────────────────────

export function createDefaultRegistry(): AdapterRegistry {
  const reg = new AdapterRegistry();
  reg.register(EarthquakeAdapter);
  reg.register(AirQualityAdapter);
  reg.register(WeatherAdapter);
  reg.register(AviationAdapter);
  reg.register(MaritimeAdapter);
  reg.register(WildfireAdapter);
  reg.register(SpaceWeatherAdapter);
  reg.register(BiosurveillanceAdapter);
  reg.register(SanctionsAdapter);
  reg.register(InfrastructureAdapter);
  reg.register(GdacsAdapter);
  return reg;
}

let defaultRegistry: AdapterRegistry | undefined;

export function getDefaultRegistry(): AdapterRegistry {
  defaultRegistry ??= createDefaultRegistry();
  return defaultRegistry;
}
