import type { MetarStation } from './metar-types';

const EARTH_RADIUS_NM = 3440.065;

export function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestStation(
  lat: number,
  lon: number,
  stations: MetarStation[],
  maxDistanceNm = 50,
): MetarStation | null {
  if (!Array.isArray(stations) || stations.length === 0) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: MetarStation | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const station of stations) {
    const d = haversineNm(lat, lon, station.lat, station.lon);
    if (d < bestDist && d <= maxDistanceNm) {
      best = station;
      bestDist = d;
    }
  }
  return best;
}

export interface AdsbStateLike {
  states?: unknown[][];
}

export function countAdsbWithinRadius(
  lat: number,
  lon: number,
  adsb: AdsbStateLike | null | undefined,
  radiusNm = 25,
): number {
  if (!adsb || !Array.isArray(adsb.states)) return 0;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  let count = 0;
  for (const state of adsb.states) {
    if (!Array.isArray(state)) continue;
    const acLat = state[6];
    const acLon = state[5];
    if (typeof acLat !== 'number' || typeof acLon !== 'number') continue;
    if (!Number.isFinite(acLat) || !Number.isFinite(acLon)) continue;
    if (haversineNm(lat, lon, acLat, acLon) <= radiusNm) count++;
  }
  return count;
}
