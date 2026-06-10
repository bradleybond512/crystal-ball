/**
 * Watchboards — geofenced standing queries ("tripwires").
 *
 * A Watchboard is a named collection of Tripwires. Each Tripwire couples a
 * geographic shape (polygon or circle) with one or more conditions; a signal
 * that falls inside the shape AND satisfies every condition produces a
 * WatchboardFiring. This is the workhorse pattern of professional watch
 * floors: draw a zone, attach a query, get a persistent watch.
 *
 * Coordinate order is [longitude, latitude] (GeoJSON convention) everywhere
 * in this module — matching `src/services/weather/nws-polygon-match.ts`.
 */

export interface GeoPolygon {
  type: 'polygon';
  /** Closed ring in [longitude, latitude] order. */
  coordinates: Array<[number, number]>;
  name?: string;
}

export interface GeoCircle {
  type: 'circle';
  center: [number, number]; // [lon, lat]
  radiusKm: number;
  name?: string;
}

export type GeoShape = GeoPolygon | GeoCircle;

export interface TripwireCondition {
  id: string;
  type: 'domain' | 'severity' | 'entity' | 'keyword' | 'event-type';
  // domain: fires when any signal of this domain appears in the zone
  // severity: fires when signal.severity >= threshold
  // entity: fires when a specific entity (by ID) appears in the zone
  // keyword: fires when payload contains keyword
  // event-type: fires for specific event types (e.g. 'vessel_dark', 'emergency_squawk')
  value: string | number;
  description: string;
}

export interface DwellLogic {
  enabled: boolean;
  /** For vessel/aircraft tracking: fire only after an entity dwells in zone this long. */
  minDwellMinutes?: number;
}

export interface Tripwire {
  id: string;
  watchboardId: string;
  name: string;
  shape: GeoShape;
  conditions: TripwireCondition[];
  dwellLogic?: DwellLogic;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
  fireCount: number;
}

export interface WatchboardFiring {
  id: string;
  tripwireId: string;
  watchboardId: string;
  firedAt: string;
  eventSummary: string;
  domain: string;
  severity?: number;
  entityIds?: string[];
  payload: unknown;
}

export interface Watchboard {
  id: string;
  name: string;
  description: string;
  tripwires: Tripwire[];
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  tags: string[];
}

/** A signal evaluated against a tripwire. Mirrors `ObservationEvent`
 *  (src/types/intelligence.ts) flattened to the fields a tripwire cares
 *  about. `eventType` carries the classifier used by 'event-type' conditions
 *  (e.g. 'vessel_dark', 'emergency_squawk'). */
export interface WatchboardSignal {
  lon: number;
  lat: number;
  domain?: string;
  severity?: number;
  entityIds?: string[];
  eventType?: string;
  payload?: unknown;
}

export interface WatchboardTemplate {
  name: string;
  description: string;
  /** Pre-drawn shapes for well-known regions. Empty array = global (no shape gate). */
  shapes: GeoShape[];
  conditions: TripwireCondition[];
}
