import { createCircuitBreaker, getCSSColor } from '@/utils';

export interface WeatherAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  description: string;
  areaDesc: string;
  onset: Date;
  expires: Date;
  coordinates: [number, number][];
  centroid?: [number, number];
}

interface NWSAlert {
  id: string;
  properties: {
 event: string;
 severity: string;
 headline: string;
 description: string;
 areaDesc: string;
 onset: string;
 expires: string;
  };
  geometry?: {
 type: string;
 coordinates: number[][][] | number[][];
  };
}

interface NWSResponse {
  features: NWSAlert[];
}

const NWS_API = 'https://api.weather.gov/alerts/active';
const breaker = createCircuitBreaker<WeatherAlert[]>({ name: 'NWS Weather', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

export async function fetchWeatherAlerts(): Promise<WeatherAlert[]> {
  return breaker.execute(async () => {
 const response = await fetch(NWS_API, {
 headers: { 'User-Agent': 'CrystalBall/1.0' }
 });

 if (!response.ok) throw new Error(`HTTP ${response.status}`);

 const data: NWSResponse = await response.json();

 return data.features
 .filter(alert => alert.properties.severity !== 'Unknown')
 .slice(0, 50)
 .map(alert => {
 const coords = extractCoordinates(alert.geometry);
 return {
 id: alert.id,
 event: alert.properties.event,
 severity: alert.properties.severity as WeatherAlert['severity'],
 headline: alert.properties.headline,
 description: alert.properties.description?.slice(0, 500) || '',
 areaDesc: alert.properties.areaDesc,
 onset: new Date(alert.properties.onset),
 expires: new Date(alert.properties.expires),
 coordinates: coords,
 centroid: calculateCentroid(coords),
 };
 });
  }, []);
}

export function getWeatherStatus(): string {
  return breaker.getStatus();
}

function extractCoordinates(geometry?: NWSAlert['geometry']): [number, number][] {
  if (!geometry) return [];

  try {
 if (geometry.type === 'Polygon') {
 const coords = geometry.coordinates as unknown as number[][][];
 return coords[0]?.map(c => [c[0], c[1]] as [number, number]) || [];
 }
 if (geometry.type === 'MultiPolygon') {
 const coords = geometry.coordinates as unknown as number[][][][];
 return coords[0]?.[0]?.map(c => [c[0], c[1]] as [number, number]) || [];
 }
  } catch {
 return [];
  }
  return [];
}

function calculateCentroid(coords: [number, number][]): [number, number] | undefined {
  if (coords.length === 0) return undefined;

  const sum = coords.reduce(
 (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
 [0, 0]
  );

  return [sum[0] / coords.length, sum[1] / coords.length];
}

export function getSeverityColor(severity: WeatherAlert['severity']): string {
  switch (severity) {
 case 'Extreme': { return getCSSColor('--semantic-critical');
 }
 case 'Severe': { return getCSSColor('--semantic-high');
 }
 case 'Moderate': { return getCSSColor('--semantic-elevated');
 }
 case 'Minor': { return getCSSColor('--semantic-elevated');
 }
 default: { return getCSSColor('--text-dim');
 }
  }
}

export interface OpenMeteoConditions {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  weatherCode: number;
  isDay: boolean;
  uvIndex: number | null;
  fetchedAt: Date;
  source: 'open-meteo';
}

const _openMeteoCache = new Map<string, { data: OpenMeteoConditions; ts: number }>();
const OPEN_METEO_TTL_MS = 10 * 60 * 1000;

export async function fetchOpenMeteoConditions(
  lat: number,
  lon: number,
): Promise<OpenMeteoConditions | null> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _openMeteoCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OPEN_METEO_TTL_MS) return cached.data;

  try {
 const url = `https://api.open-meteo.com/v1/forecast` +
 `?latitude=${lat}&longitude=${lon}` +
 `&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day,uv_index` +
 `&wind_speed_unit=kmh&timezone=auto`;
 const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) return null;
 const raw = await res.json() as { current?: Record<string, number | boolean | null> };
 const c = raw.current;
 if (!c) return null;
 const data: OpenMeteoConditions = {
 temperature: typeof c.temperature_2m === 'number' ? c.temperature_2m : 0,
 windSpeed: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : 0,
 windDirection: typeof c.wind_direction_10m === 'number' ? c.wind_direction_10m : 0,
 precipitation: typeof c.precipitation === 'number' ? c.precipitation : 0,
 weatherCode: typeof c.weather_code === 'number' ? c.weather_code : 0,
 isDay: c.is_day === 1,
 uvIndex: typeof c.uv_index === 'number' ? c.uv_index : null,
 fetchedAt: new Date(),
 source: 'open-meteo',
 };
 _openMeteoCache.set(cacheKey, { data, ts: Date.now() });
 return data;
  } catch {
 return null;
  }
}
