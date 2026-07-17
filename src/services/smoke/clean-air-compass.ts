/**
 * Cleaner-air compass — pure math half. Sampling coordinates use an
 * equirectangular offset (fine at ≤100 mi scale); fetching AQI at those
 * points and reverse-geocoding names happens in smoke-fetch.ts.
 */
import type { CompassDirection, CompassPoint, CompassSample } from './smoke-types';

const DIRECTIONS: { direction: CompassDirection; bearingDeg: number }[] = [
  { direction: 'N', bearingDeg: 0 }, { direction: 'NE', bearingDeg: 45 },
  { direction: 'E', bearingDeg: 90 }, { direction: 'SE', bearingDeg: 135 },
  { direction: 'S', bearingDeg: 180 }, { direction: 'SW', bearingDeg: 225 },
  { direction: 'W', bearingDeg: 270 }, { direction: 'NW', bearingDeg: 315 },
];

const MI_PER_DEG_LAT = 69.09;

export function compassPoints(lat: number, lon: number, radiiMi: number[]): CompassPoint[] {
  const out: CompassPoint[] = [];
  const latRad = (lat * Math.PI) / 180;
  for (const { direction, bearingDeg } of DIRECTIONS) {
    const theta = (bearingDeg * Math.PI) / 180;
    for (const radiusMi of radiiMi) {
      const dLat = (radiusMi * Math.cos(theta)) / MI_PER_DEG_LAT;
      const dLon = (radiusMi * Math.sin(theta)) / (MI_PER_DEG_LAT * Math.cos(latRad));
      out.push({ direction, bearingDeg, radiusMi, lat: lat + dLat, lon: lon + dLon });
    }
  }
  return out;
}

/** Attach deltas vs home and sort: cleanest first, no-data last. */
export function rankCompass(samples: CompassSample[], homeAqi: number | null): CompassSample[] {
  const withDelta = samples.map((s) => ({
    ...s,
    deltaPctVsHome:
      s.avgAqi6h === null || homeAqi === null || homeAqi === 0
        ? null
        : Math.round(((s.avgAqi6h - homeAqi) / homeAqi) * 100),
  }));
  return withDelta.sort((a, b) => {
    if (a.avgAqi6h === null && b.avgAqi6h === null) return 0;
    if (a.avgAqi6h === null) return 1;
    if (b.avgAqi6h === null) return -1;
    return a.avgAqi6h - b.avgAqi6h;
  });
}

/** One-line human statement for the best escape direction. */
export function describeCompass(ranked: CompassSample[], homeAqi: number | null): string {
  const usable = ranked.filter((s) => s.avgAqi6h !== null);
  if (usable.length === 0 || usable.length < ranked.length / 2) {
    return 'Cleaner-air scan unavailable (insufficient forecast data).';
  }
  const best = usable[0]!;
  if (best.deltaPctVsHome === null || best.deltaPctVsHome >= -10 || homeAqi === null) {
    return 'No cleaner air within 100 mi — conditions are regional. Best strategy is indoor air + safe windows.';
  }
  const where = best.placeName
    ? `${best.radiusMi} mi ${best.direction} near ${best.placeName}`
    : `${best.radiusMi} mi ${best.direction}`;
  return `Air is ${Math.abs(best.deltaPctVsHome)}% cleaner ${where} (AQI ~${Math.round(best.avgAqi6h!)} vs ${Math.round(homeAqi)} at home).`;
}
