/**
 * Pollen & allergy data — Open-Meteo Air Quality API
 *
 * Source: https://open-meteo.com/en/docs/air-quality-api
 * Free, no API key required, CORS-enabled.
 * Provides grass, birch, alder, ragweed, and olive pollen grains/m³.
 */

import { createCircuitBreaker } from '@/utils';

export interface PollenReading {
  city: string;
  lat: number;
  lon: number;
  grassPollen: number;
  birchPollen: number;
  ragweedPollen: number;
  alderPollen: number;
  olivePollen: number;
  overallLevel: PollenLevel;
  dominantType: string;
  updatedAt: Date;
}

export type PollenLevel = 'low' | 'moderate' | 'high' | 'very_high';

const CITIES = [
  { city: 'New York', lat: 40.71, lon: -74.01 },
  { city: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { city: 'Chicago', lat: 41.88, lon: -87.63 },
  { city: 'London', lat: 51.51, lon: -0.13 },
  { city: 'Paris', lat: 48.85, lon: 2.35 },
  { city: 'Berlin', lat: 52.52, lon: 13.41 },
  { city: 'Tokyo', lat: 35.68, lon: 139.69 },
  { city: 'Sydney', lat: -33.87, lon: 151.21 },
  { city: 'Dallas', lat: 32.78, lon: -96.8 },
  { city: 'Atlanta', lat: 33.75, lon: -84.39 },
  { city: 'Denver', lat: 39.74, lon: -104.99 },
  { city: 'Toronto', lat: 43.65, lon: -79.38 },
];

const breaker = createCircuitBreaker<PollenReading[]>({
  name: 'Pollen',
  cacheTtlMs: 60 * 60 * 1000,
  persistCache: true,
});

interface PollenResponse {
  current: {
 grass_pollen?: number;
 birch_pollen?: number;
 ragweed_pollen?: number;
 alder_pollen?: number;
 olive_pollen?: number;
  };
}

export async function fetchPollenData(): Promise<PollenReading[]> {
  const readings = await breaker.execute(async () => {
 const results = await Promise.allSettled(CITIES.map(c => fetchCityPollen(c)));
 return results
 .filter((r): r is PromiseFulfilledResult<PollenReading | null> => r.status === 'fulfilled')
 .map(r => r.value)
 .filter((r): r is PollenReading => r !== null);
  }, []);
  return readings.map(reading => ({
    ...reading,
    updatedAt: reading.updatedAt instanceof Date
      ? reading.updatedAt
      : new Date(reading.updatedAt as unknown as string),
  }));
}

async function fetchCityPollen(city: typeof CITIES[0]): Promise<PollenReading | null> {
  try {
 const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${String(city.lat)}&longitude=${String(city.lon)}&current=grass_pollen,birch_pollen,ragweed_pollen,alder_pollen,olive_pollen`;
 const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) return null;

 const data = await res.json() as PollenResponse;
 if (!data || typeof data !== 'object' || !data.current) return null;
 const c = data.current;

 const grass = c.grass_pollen ?? 0;
 const birch = c.birch_pollen ?? 0;
 const ragweed = c.ragweed_pollen ?? 0;
 const alder = c.alder_pollen ?? 0;
 const olive = c.olive_pollen ?? 0;

 const types: [string, number][] = [
 ['Grass', grass], ['Birch', birch], ['Ragweed', ragweed],
 ['Alder', alder], ['Olive', olive],
 ];
 const dominant = types.reduce((a, b) => b[1] > a[1] ? b : a, ['Unknown', 0] as [string, number]);
 const maxPollen = dominant[1];

 return {
 city: city.city,
 lat: city.lat,
 lon: city.lon,
 grassPollen: grass,
 birchPollen: birch,
 ragweedPollen: ragweed,
 alderPollen: alder,
 olivePollen: olive,
 overallLevel: pollenLevel(maxPollen),
 dominantType: dominant[0],
 updatedAt: new Date(),
 };
  } catch {
 return null;
  }
}

function pollenLevel(grains: number): PollenLevel {
  if (grains < 20) return 'low';
  if (grains < 80) return 'moderate';
  if (grains < 200) return 'high';
  return 'very_high';
}

export function pollenLevelColor(level: PollenLevel): string {
  const colors: Record<PollenLevel, string> = {
 low: '#4ade80',
 moderate: '#facc15',
 high: '#f97316',
 very_high: '#ef4444',
  };
  return colors[level];
}
