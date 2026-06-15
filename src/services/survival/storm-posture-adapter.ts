import type { AlertPolygon, Coord, NwsAlertMinimal, SavedPlace, WeatherMessageType, WeatherSeverity } from '../weather/weather-threat-types.ts';

export interface AppSavedPlaceLike {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm?: number;
  ugcZones?: string[];
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface LiveAlertInput {
  id: string;
  event: string;
  severity?: string;
  onset: string;
  expires: string;
  headline?: string;
  messageType?: string | null;
  centroid?: [number, number] | null;
  geometry?: GeoJsonGeometry | null;
}

const SYNTHETIC_RADIUS_KM = 20;
const SYNTHETIC_POINTS = 12;

export function adaptSavedPlace(p: AppSavedPlaceLike): SavedPlace {
  return { id: p.id, label: p.name, lat: p.lat, lon: p.lon, radiusKm: p.radiusKm, ugcZones: p.ugcZones };
}

function normalizeMessageType(raw: string | null | undefined): WeatherMessageType {
  switch ((raw ?? '').toLowerCase()) {
    case 'cancel': { return 'cancel';
    }
    case 'update': { return 'update';
    }
    case 'alert': { return 'alert';
    }
    default: { return 'unknown';
    }
  }
}

function normalizeSeverity(raw: string | undefined): WeatherSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'extreme': { return 'extreme';
    }
    case 'severe': { return 'severe';
    }
    case 'moderate': { return 'moderate';
    }
    case 'minor': { return 'minor';
    }
    default: { return 'unknown';
    }
  }
}

function ringFromGeometry(geom: GeoJsonGeometry | null | undefined): Coord[][] | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    const coords = geom.coordinates as number[][][];
    if (Array.isArray(coords?.[0])) {
      return [coords[0]!.map((c): Coord => [c[0]!, c[1]!])];
    }
  }
  if (geom.type === 'MultiPolygon') {
    const coords = geom.coordinates as number[][][][];
    if (Array.isArray(coords?.[0]?.[0])) {
      return coords.map((poly) => poly[0]!.map((c): Coord => [c[0]!, c[1]!]));
    }
  }
  return null;
}

function syntheticCircle(centroid: [number, number], radiusKm: number): Coord[][] {
  const [lon, lat] = centroid;
  const latDeg = radiusKm / 111;
  const lonDeg = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const ring: Coord[] = [];
  for (let i = 0; i < SYNTHETIC_POINTS; i++) {
    const a = (2 * Math.PI * i) / SYNTHETIC_POINTS;
    ring.push([lon + lonDeg * Math.cos(a), lat + latDeg * Math.sin(a)]);
  }
  ring.push(ring[0]!);
  return [ring];
}

export function adaptLiveAlert(raw: LiveAlertInput): NwsAlertMinimal {
  const geomRings = ringFromGeometry(raw.geometry);
  const rings = geomRings ?? (raw.centroid ? syntheticCircle(raw.centroid, SYNTHETIC_RADIUS_KM) : null);
  const polygon: AlertPolygon | undefined = rings ? { rings } : undefined;
  return {
    id: raw.id,
    event: raw.event,
    polygon,
    sent: raw.onset,
    expires: raw.expires,
    severity: normalizeSeverity(raw.severity),
    headline: raw.headline,
    messageType: normalizeMessageType(raw.messageType),
  };
}
