/**
 * Pure geo-math shared by the fusion layer's spatial-match domains. No DOM,
 * no fetch, no globals.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Whether a coordinate pair is usable as a fetch target. Never test a
 * coordinate with truthiness: longitude 0 (Greenwich — London, Accra) and
 * latitude 0 (the equator) are ordinary places, and `!lon` silently skips
 * them, which then records every provider for that place as empty.
 */
export function isUsableLatLon(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterNearby<T extends { lat: number; lon: number }>(
  items: readonly T[],
  lat: number,
  lon: number,
  radiusKm: number,
): T[] {
  return items.filter((item) => haversineKm(lat, lon, item.lat, item.lon) <= radiusKm);
}
