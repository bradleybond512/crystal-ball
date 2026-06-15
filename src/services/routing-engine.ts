import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

export type RoutingTier = 1 | 2 | 3 | 4;
export type RoutingProfile = 'driving' | 'cycling' | 'walking';

export interface RouteCoord {
  lat: number;
  lon: number;
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  maneuver: string;
  name: string;
  coordinates: RouteCoord[];
}

export interface RouteResult {
  steps: RouteStep[];
  geometry: RouteCoord[];
  distance: number;
  duration: number;
  tier: RoutingTier;
  provider: string;
}

export const ROUTING_TIER_NAMES: Record<RoutingTier, string> = {
  1: 'Mapbox',
  2: 'Google',
  3: 'Valhalla',
  4: 'OSRM',
};

export function decodePolyline(encoded: string, precision = 5): RouteCoord[] {
  const factor = Math.pow(10, precision);
  const coords: RouteCoord[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = (encoded.codePointAt(index++) ?? 0) - 63;
      result |= (byte & 0x1F) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = (encoded.codePointAt(index++) ?? 0) - 63;
      result |= (byte & 0x1F) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += dlon;

    coords.push({ lat: lat / factor, lon: lon / factor });
  }

  return coords;
}

async function tryMapbox(from: RouteCoord, to: RouteCoord, profile: RoutingProfile): Promise<RouteResult | null> {
  const key = getRuntimeConfigSnapshot().secrets.MAPBOX_API_KEY?.value;
  if (!key) return null;

  const mbProfile = profile === 'driving' ? 'driving-traffic' : profile;
  const url = `https://api.mapbox.com/directions/v5/mapbox/${mbProfile}/${from.lon},${from.lat};${to.lon},${to.lat}?access_token=${key}&geometries=geojson&steps=true&overview=full`;

  const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  const routes = data.routes as Record<string, unknown>[];
  const route = routes[0] as Record<string, unknown>;
  const legs = route.legs as Record<string, unknown>[];
  const leg = legs[0] as Record<string, unknown>;
  const rawSteps = leg.steps as Record<string, unknown>[];

  const steps: RouteStep[] = rawSteps.map((s) => {
    const maneuver = s.maneuver as Record<string, unknown>;
    const geom = s.geometry as Record<string, unknown>;
    const geomCoords = geom.coordinates as number[][];
    return {
      instruction: (maneuver.instruction as string) ?? '',
      distance: (s.distance as number) ?? 0,
      duration: (s.duration as number) ?? 0,
      maneuver: (maneuver.type as string) ?? '',
      name: (s.name as string) ?? '',
      coordinates: geomCoords.map(([lon, lat]) => ({ lat: lat ?? 0, lon: lon ?? 0 })),
    };
  });

  const geomData = route.geometry as Record<string, unknown>;
  const geomCoords = geomData.coordinates as number[][];
  const geometry: RouteCoord[] = geomCoords.map(([lon, lat]) => ({ lat: lat ?? 0, lon: lon ?? 0 }));

  return {
    steps,
    geometry,
    distance: (route.distance as number) ?? 0,
    duration: (route.duration as number) ?? 0,
    tier: 1,
    provider: ROUTING_TIER_NAMES[1],
  };
}

function stripHtml(html: string): string {
  // eslint-disable-next-line sonarjs/slow-regex -- single bounded class, no nested quantifier; linear time
  return html.replace(/<[^>]*>/g, '');
}

async function tryGoogle(from: RouteCoord, to: RouteCoord): Promise<RouteResult | null> {
  const key = getRuntimeConfigSnapshot().secrets.GOOGLE_MAPS_API_KEY?.value;
  if (!key) return null;

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&key=${key}`;

  const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  const routesArr = data.routes as Record<string, unknown>[];
  const route = routesArr[0] as Record<string, unknown>;
  const legsArr = route.legs as Record<string, unknown>[];
  const leg = legsArr[0] as Record<string, unknown>;
  const rawSteps = leg.steps as Record<string, unknown>[];

  const steps: RouteStep[] = rawSteps.map((s) => {
    const polyObj = s.polyline as Record<string, unknown>;
    const stepCoords = decodePolyline((polyObj.points as string) ?? '');
    const distObj = s.distance as Record<string, unknown>;
    const durObj = s.duration as Record<string, unknown>;
    const maneuver = (s.maneuver as string | undefined) ?? '';
    return {
      instruction: stripHtml((s.html_instructions as string) ?? ''),
      distance: (distObj.value as number) ?? 0,
      duration: (durObj.value as number) ?? 0,
      maneuver,
      name: '',
      coordinates: stepCoords,
    };
  });

  const overviewPoly = route.overview_polyline as Record<string, unknown>;
  const geometry = decodePolyline((overviewPoly.points as string) ?? '');

  const totalDist = leg.distance as Record<string, unknown>;
  const totalDur = leg.duration as Record<string, unknown>;

  return {
    steps,
    geometry,
    distance: (totalDist.value as number) ?? 0,
    duration: (totalDur.value as number) ?? 0,
    tier: 2,
    provider: ROUTING_TIER_NAMES[2],
  };
}

async function tryValhalla(from: RouteCoord, to: RouteCoord, profile: RoutingProfile): Promise<RouteResult | null> {
  const costingMap: Record<RoutingProfile, string> = {
    driving: 'auto',
    cycling: 'bicycle',
    walking: 'pedestrian',
  };
  const costing = costingMap[profile];

  const res = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
      costing,
      directions_options: { units: 'kilometers' },
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  const trip = data.trip as Record<string, unknown>;
  const legsArr = trip.legs as Record<string, unknown>[];
  const leg = legsArr[0] as Record<string, unknown>;
  const geometry = decodePolyline((leg.shape as string) ?? '', 6);

  const maneuvers = leg.maneuvers as Record<string, unknown>[];
  const steps: RouteStep[] = maneuvers.map((m) => {
    const beginIdx = (m.begin_shape_index as number) ?? 0;
    const endIdx = (m.end_shape_index as number) ?? 0;
    const stepCoords = geometry.slice(beginIdx, endIdx + 1);
    const lengthKm = (m.length as number) ?? 0;
    return {
      instruction: (m.instruction as string) ?? '',
      distance: lengthKm * 1000,
      duration: (m.time as number) ?? 0,
      maneuver: String((m.type as number) ?? 0),
      name: (m.street_names as string[] | undefined)?.[0] ?? '',
      coordinates: stepCoords,
    };
  });

  const summary = trip.summary as Record<string, unknown>;
  const totalLengthKm = (summary.length as number) ?? 0;
  const totalTime = (summary.time as number) ?? 0;

  return {
    steps,
    geometry,
    distance: totalLengthKm * 1000,
    duration: totalTime,
    tier: 3,
    provider: ROUTING_TIER_NAMES[3],
  };
}

async function tryOsrm(from: RouteCoord, to: RouteCoord): Promise<RouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;
  const routesArr = data.routes as Record<string, unknown>[];
  const route = routesArr[0] as Record<string, unknown>;
  const legsArr = route.legs as Record<string, unknown>[];
  const leg = legsArr[0] as Record<string, unknown>;
  const rawSteps = leg.steps as Record<string, unknown>[];

  const steps: RouteStep[] = rawSteps.map((s) => {
    const maneuver = s.maneuver as Record<string, unknown>;
    const geom = s.geometry as Record<string, unknown>;
    const geomCoords = geom.coordinates as number[][];
    return {
      instruction: (maneuver.type as string) ?? '',
      distance: (s.distance as number) ?? 0,
      duration: (s.duration as number) ?? 0,
      maneuver: (maneuver.type as string) ?? '',
      name: (s.name as string) ?? '',
      coordinates: geomCoords.map(([lon, lat]) => ({ lat: lat ?? 0, lon: lon ?? 0 })),
    };
  });

  const geomData = route.geometry as Record<string, unknown>;
  const geomCoords = geomData.coordinates as number[][];
  const geometry: RouteCoord[] = geomCoords.map(([lon, lat]) => ({ lat: lat ?? 0, lon: lon ?? 0 }));

  return {
    steps,
    geometry,
    distance: (route.distance as number) ?? 0,
    duration: (route.duration as number) ?? 0,
    tier: 4,
    provider: ROUTING_TIER_NAMES[4],
  };
}

type TierFn = (from: RouteCoord, to: RouteCoord, profile: RoutingProfile) => Promise<RouteResult | null>;

const TIERS: TierFn[] = [tryMapbox, tryGoogle, tryValhalla, tryOsrm];

export async function computeRoute(
  from: RouteCoord,
  to: RouteCoord,
  profile: RoutingProfile = 'driving',
): Promise<RouteResult | null> {
  for (const tier of TIERS) {
    try {
      const result = await tier(from, to, profile);
      if (result) return result;
    } catch (error) {
      console.warn(`[routing] tier failed:`, error); // eslint-disable-line no-console
    }
  }
  console.error('[routing] all tiers failed'); // eslint-disable-line no-console
  return null;
}
