/**
 * Tide predictions — NOAA CO-OPS (Center for Operational Oceanographic Products and Services)
 *
 * Source: https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
 * Free, no API key required. Covers US coastal stations.
 */

import { createCircuitBreaker } from '@/utils';

export interface TidePrediction {
  time: Date;
  height: number; // feet
  type: 'H' | 'L'; // high or low
}

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  state: string;
}

export interface TideData {
  station: TideStation;
  predictions: TidePrediction[];
  fetchedAt: Date;
}

const breaker = createCircuitBreaker<TideData | null>({
  name: 'Tides',
  cacheTtlMs: 60 * 60 * 1000,
  persistCache: true,
});

/** Major US tide stations */
export const TIDE_STATIONS: TideStation[] = [
  { id: '8518750', name: 'The Battery, NY', lat: 40.7, lon: -74.01, state: 'NY' },
  { id: '9414290', name: 'San Francisco, CA', lat: 37.81, lon: -122.47, state: 'CA' },
  { id: '8723214', name: 'Virginia Key, FL', lat: 25.73, lon: -80.16, state: 'FL' },
  { id: '8443970', name: 'Boston, MA', lat: 42.35, lon: -71.05, state: 'MA' },
  { id: '8574680', name: 'Baltimore, MD', lat: 39.27, lon: -76.58, state: 'MD' },
  { id: '8658120', name: 'Wilmington, NC', lat: 34.23, lon: -77.95, state: 'NC' },
  { id: '8771450', name: 'Galveston, TX', lat: 29.31, lon: -94.79, state: 'TX' },
  { id: '9410660', name: 'Los Angeles, CA', lat: 33.72, lon: -118.27, state: 'CA' },
  { id: '9447130', name: 'Seattle, WA', lat: 47.6, lon: -122.34, state: 'WA' },
  { id: '1612340', name: 'Honolulu, HI', lat: 21.31, lon: -157.87, state: 'HI' },
  { id: '8665530', name: 'Charleston, SC', lat: 32.78, lon: -79.92, state: 'SC' },
  { id: '8726520', name: 'St. Petersburg, FL', lat: 27.76, lon: -82.63, state: 'FL' },
];

interface CoopsHiLo {
  predictions: { t: string; v: string; type: string }[];
}

export async function fetchTidePredictions(stationId: string): Promise<TideData | null> {
  const data = await breaker.execute(async () => {
 const station = TIDE_STATIONS.find(s => s.id === stationId);
 if (!station) return null;
 const now = new Date();
 const begin = formatDate(now);
 const end = formatDate(new Date(now.getTime() + 48 * 60 * 60 * 1000));

 const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${begin}&end_date=${end}&station=${station.id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&format=json`;

 const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
 if (!res.ok) throw new Error(`CO-OPS HTTP ${String(res.status)}`);

 const data = await res.json() as CoopsHiLo;
 if (!data || typeof data !== 'object' || !Array.isArray(data.predictions)) return null;

 const predictions: TidePrediction[] = data.predictions.map(p => ({
 time: new Date(p.t),
 height: Number.parseFloat(p.v),
 type: p.type === 'H' ? 'H' : 'L',
 }));

 return { station, predictions, fetchedAt: new Date() };
  }, null);
  if (!data) return null;
  return {
    ...data,
    fetchedAt: data.fetchedAt instanceof Date
      ? data.fetchedAt
      : new Date(data.fetchedAt as unknown as string),
    predictions: data.predictions.map(prediction => ({
      ...prediction,
      time: prediction.time instanceof Date
        ? prediction.time
        : new Date(prediction.time as unknown as string),
    })),
  };
}

function formatDate(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Find nearest station to given coordinates */
export function findNearestStation(lat: number, lon: number): TideStation {
  let best: TideStation = TIDE_STATIONS[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of TIDE_STATIONS) {
 const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
 if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}
