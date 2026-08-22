import { readOfflineCacheEntry, writeOfflineCacheEntry } from './offline-alert-cache';
import type { SavedPlace } from './saved-places';

export type SavedPlaceWeatherSeverity = 'critical' | 'high' | 'medium' | 'low';
export type SavedPlaceWeatherHazardType = 'tropical' | 'thunderstorm' | 'winter' | 'flood' | 'wind';

export interface HourlyForecastPeriod {
  startTime: string;
  endTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  shortForecast?: string;
  probabilityOfPrecipitation?: { value: number | null };
}

export interface SavedPlaceWeatherHazard {
  type: SavedPlaceWeatherHazardType;
  headline: string;
  detail: string;
  severity: SavedPlaceWeatherSeverity;
  startTime: string;
  endTime?: string;
  leadHours: number;
  source: string;
}

export interface SavedPlaceWeatherSnapshot {
  placeId: string;
  placeName: string;
  placeFingerprint: string;
  forecastUrl?: string;
  hazards: SavedPlaceWeatherHazard[];
  fetchedAt: Date;
  isStale: boolean;
  staleAgeMs: number;
  source: 'network' | 'offline-cache';
}

export interface SavedPlaceWeatherBriefItem {
  kind: 'forecast';
  label: string;
  value: string;
  severity: SavedPlaceWeatherSeverity;
  link?: string;
}

interface NWSPointsResponse {
  properties?: {
 forecastHourly?: string;
  };
}

interface NWSForecastResponse {
  properties?: {
 updated?: string;
 periods?: HourlyForecastPeriod[];
  };
}

interface CachedSavedPlaceWeatherSnapshot {
  schemaVersion: 2;
  placeId: string;
  placeName: string;
  placeFingerprint: string;
  forecastUrl?: string;
  hazards: SavedPlaceWeatherHazard[];
  fetchedAt: string;
}

const SAVED_PLACE_WEATHER_EVENT = 'wm:saved-place-weather-updated';
const SAVED_PLACE_WEATHER_CACHE_PREFIX = 'saved-place-weather';
const MAX_FORECAST_HOURS = 18;
const MAX_CACHED_FORECAST_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ALLOWED_NWS_HOSTS = new Set(['api.weather.gov', 'forecast.weather.gov']);
const memoryCache = new Map<string, CachedSavedPlaceWeatherSnapshot>();

/** Exact point identity for forecast caches; stable IDs do not imply stable geography. */
export function buildSavedPlaceWeatherFingerprint(
  place: Pick<SavedPlace, 'id' | 'name' | 'lat' | 'lon'>,
): string {
  return JSON.stringify([2, place.id, place.name, place.lat, place.lon]);
}

function buildCacheKey(place: SavedPlace): string {
  return `${SAVED_PLACE_WEATHER_CACHE_PREFIX}:${place.id}:${buildSavedPlaceWeatherFingerprint(place)}`;
}

function emitSavedPlaceWeatherUpdated(snapshot: SavedPlaceWeatherSnapshot): void {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent(SAVED_PLACE_WEATHER_EVENT, { detail: snapshot }));
}

function isAllowedNwsForecastUrl(url: string): boolean {
  try {
 const parsed = new URL(url);
 return parsed.protocol === 'https:' && ALLOWED_NWS_HOSTS.has(parsed.hostname);
  } catch {
 return false;
  }
}

function severityRank(severity: SavedPlaceWeatherSeverity): number {
  return {
 critical: 3,
 high: 2,
 medium: 1,
 low: 0,
  }[severity];
}

function normalizeForecast(text: string | undefined): string {
  return text?.replace(/\s+/g, ' ').trim() ?? '';
}

function parseWindSpeedMph(raw: string | undefined): number {
  if (!raw) return 0;
  const values = raw.match(/\d+/g)?.map((value) => Number.parseInt(value, 10)) ?? [];
  return values.length > 0 ? Math.max(...values) : 0;
}

function toFahrenheit(temperature: number | undefined, unit: string | undefined): number | null {
  if (!Number.isFinite(temperature)) return null;
  if (unit === 'C') {
 return Math.round((((temperature as number) * 9) / 5) + 32);
  }
  return Math.round(temperature as number);
}

function formatLeadHours(hours: number): string {
  if (hours <= 0) return 'Now';
  if (hours === 1) return 'Within 1 hr';
  return `Within ${hours} hr`;
}

function formatHazardDetail(period: HourlyForecastPeriod, windMph: number, precipitationChance: number): string {
  const pieces: string[] = [];
  const forecast = normalizeForecast(period.shortForecast);
  if (forecast) pieces.push(forecast);
  if (windMph > 0) pieces.push(`winds up to ${windMph} mph`);
  if (precipitationChance > 0) pieces.push(`${precipitationChance}% precip`);
  const temperatureF = toFahrenheit(period.temperature, period.temperatureUnit);
  if (temperatureF != null) pieces.push(`${temperatureF}F`);
  return pieces.join(' · ');
}

function thunderstormSeverity(forecast: string, windMph: number, precipitationChance: number): SavedPlaceWeatherSeverity {
  if (forecast.includes('severe') || forecast.includes('damaging') || windMph >= 50) return 'critical';
  if (windMph >= 35 || precipitationChance >= 70) return 'high';
  return 'medium';
}

function winterSeverity(forecast: string, windMph: number, temperatureF: number | null): SavedPlaceWeatherSeverity {
  if (forecast.includes('blizzard') || windMph >= 45) return 'critical';
  if (forecast.includes('heavy snow') || forecast.includes('ice') || forecast.includes('freezing rain') || windMph >= 30) return 'high';
  if (temperatureF != null && temperatureF <= 20 && forecast.includes('snow')) return 'high';
  return 'medium';
}

function tropicalSeverity(forecast: string, windMph: number): SavedPlaceWeatherSeverity {
  if (forecast.includes('hurricane') || windMph >= 74) return 'critical';
  if (forecast.includes('tropical storm') || windMph >= 45) return 'high';
  return 'medium';
}

function floodSeverity(forecast: string, precipitationChance: number): SavedPlaceWeatherSeverity {
  if (forecast.includes('flash flood') || precipitationChance >= 90) return 'high';
  if (forecast.includes('heavy rain') || precipitationChance >= 70) return 'medium';
  return 'low';
}

function buildHazard(
  type: SavedPlaceWeatherHazardType,
  headline: string,
  severity: SavedPlaceWeatherSeverity,
  period: HourlyForecastPeriod,
  leadHours: number,
  detail: string,
): SavedPlaceWeatherHazard {
  return {
 type,
 headline,
 detail,
 severity,
 startTime: period.startTime,
 endTime: period.endTime,
 leadHours,
 source: 'NWS hourly forecast',
  };
}

function analyzeForecastPeriod(period: HourlyForecastPeriod, leadHours: number): SavedPlaceWeatherHazard | null {
  const forecast = normalizeForecast(period.shortForecast).toLowerCase();
  const windMph = parseWindSpeedMph(period.windSpeed);
  const precipitationChance = Math.max(0, Math.round(period.probabilityOfPrecipitation?.value ?? 0));
  const temperatureF = toFahrenheit(period.temperature, period.temperatureUnit);
  const detail = formatHazardDetail(period, windMph, precipitationChance);

  if (forecast.includes('hurricane') || forecast.includes('tropical storm')) {
 return buildHazard(
 'tropical',
 'Tropical-storm window',
 tropicalSeverity(forecast, windMph),
 period,
 leadHours,
 detail,
 );
  }

  if (forecast.includes('thunderstorm')) {
 return buildHazard(
 'thunderstorm',
 'Thunderstorm window',
 thunderstormSeverity(forecast, windMph, precipitationChance),
 period,
 leadHours,
 detail,
 );
  }

  if (
 forecast.includes('blizzard')
 || forecast.includes('heavy snow')
 || forecast.includes('blowing snow')
 || forecast.includes('snow squall')
 || forecast.includes('ice')
 || forecast.includes('freezing rain')
  ) {
 return buildHazard(
 'winter',
 'Winter storm window',
 winterSeverity(forecast, windMph, temperatureF),
 period,
 leadHours,
 detail,
 );
  }

  if (
 forecast.includes('flash flood')
 || forecast.includes('heavy rain')
 || (forecast.includes('rain') && precipitationChance >= 85)
  ) {
 return buildHazard(
 'flood',
 'Flooding rain window',
 floodSeverity(forecast, precipitationChance),
 period,
 leadHours,
 detail,
 );
  }

  if (windMph >= 45) {
 return buildHazard(
 'wind',
 'High-wind window',
 windMph >= 60 ? 'critical' : 'high',
 period,
 leadHours,
 detail,
 );
  }

  return null;
}

export function analyzeHourlyForecastPeriods(periods: HourlyForecastPeriod[]): SavedPlaceWeatherHazard[] {
  const hazards = periods
 .slice(0, MAX_FORECAST_HOURS)
 .map((period, index) => analyzeForecastPeriod(period, index))
 .filter((hazard): hazard is SavedPlaceWeatherHazard => Boolean(hazard))
 .sort((left, right) => {
 const severityDiff = severityRank(right.severity) - severityRank(left.severity);
 if (severityDiff !== 0) return severityDiff;
 const leadDiff = left.leadHours - right.leadHours;
 if (leadDiff !== 0) return leadDiff;
 return left.headline.localeCompare(right.headline);
 });

  const seenTypes = new Set<SavedPlaceWeatherHazardType>();
  return hazards.filter((hazard) => {
 if (seenTypes.has(hazard.type)) return false;
 seenTypes.add(hazard.type);
 return true;
  });
}

function serializeSnapshot(snapshot: SavedPlaceWeatherSnapshot): CachedSavedPlaceWeatherSnapshot {
  return {
 schemaVersion: 2,
 placeId: snapshot.placeId,
 placeName: snapshot.placeName,
 placeFingerprint: snapshot.placeFingerprint,
 forecastUrl: snapshot.forecastUrl,
 hazards: snapshot.hazards,
 fetchedAt: snapshot.fetchedAt.toISOString(),
  };
}

function validCachedHazard(value: unknown): value is SavedPlaceWeatherHazard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hazard = value as Record<string, unknown>;
  return ['tropical', 'thunderstorm', 'winter', 'flood', 'wind'].includes(String(hazard.type))
    && ['critical', 'high', 'medium', 'low'].includes(String(hazard.severity))
    && typeof hazard.headline === 'string' && hazard.headline.length > 0 && hazard.headline.length <= 240
    && typeof hazard.detail === 'string' && hazard.detail.length <= 1000
    && typeof hazard.startTime === 'string' && hazard.startTime.length > 0 && hazard.startTime.length <= 80
    && (hazard.endTime === undefined || (typeof hazard.endTime === 'string' && hazard.endTime.length <= 80))
    && Number.isSafeInteger(hazard.leadHours) && Number(hazard.leadHours) >= 0 && Number(hazard.leadHours) <= MAX_FORECAST_HOURS
    && hazard.source === 'NWS hourly forecast';
}

/** @internal Strict exact-place boundary for offline forecast reuse. */
export function deserializeCachedSavedPlaceWeather(
  cached: unknown,
  place: SavedPlace,
  now = Date.now(),
): SavedPlaceWeatherSnapshot | null {
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return null;
  const value = cached as Record<string, unknown>;
  if (value.schemaVersion !== 2
    || value.placeId !== place.id
    || value.placeName !== place.name
    || value.placeFingerprint !== buildSavedPlaceWeatherFingerprint(place)
    || (value.forecastUrl !== undefined
      && (typeof value.forecastUrl !== 'string' || !isAllowedNwsForecastUrl(value.forecastUrl)))
    || !Array.isArray(value.hazards) || value.hazards.length > MAX_FORECAST_HOURS
    || !value.hazards.every((hazard) => validCachedHazard(hazard))
    || typeof value.fetchedAt !== 'string') return null;
  const fetchedAt = new Date(value.fetchedAt);
  if (!Number.isFinite(fetchedAt.getTime())
    || fetchedAt.getTime() > now + CACHE_CLOCK_SKEW_MS
    || now - fetchedAt.getTime() < 0
    || now - fetchedAt.getTime() > MAX_CACHED_FORECAST_AGE_MS) return null;
  return {
 placeId: place.id,
 placeName: place.name,
 placeFingerprint: buildSavedPlaceWeatherFingerprint(place),
 forecastUrl: value.forecastUrl as string | undefined,
 hazards: value.hazards as SavedPlaceWeatherHazard[],
 fetchedAt,
 isStale: true,
 staleAgeMs: Math.max(0, now - fetchedAt.getTime()),
 source: 'offline-cache',
  };
}

function buildSnapshot(
  place: SavedPlace,
  hazards: SavedPlaceWeatherHazard[],
  fetchedAt: Date,
  forecastUrl: string | undefined,
): SavedPlaceWeatherSnapshot {
  return {
 placeId: place.id,
 placeName: place.name,
 placeFingerprint: buildSavedPlaceWeatherFingerprint(place),
 forecastUrl,
 hazards,
 fetchedAt,
 isStale: false,
 staleAgeMs: 0,
 source: 'network',
  };
}

export function getCachedSavedPlaceWeather(place: SavedPlace): SavedPlaceWeatherSnapshot | null {
  const cacheKey = buildCacheKey(place);
  const cached = memoryCache.get(cacheKey);
  if (cached) return deserializeCachedSavedPlaceWeather(cached, place);
  const offline = readOfflineCacheEntry<CachedSavedPlaceWeatherSnapshot>(cacheKey);
  if (!offline) return null;
  const parsed = deserializeCachedSavedPlaceWeather(offline.data, place);
  if (!parsed) return null;
  memoryCache.set(cacheKey, offline.data);
  return parsed;
}

export function buildSavedPlaceWeatherBriefItems(
  snapshot: SavedPlaceWeatherSnapshot | null,
  limit = 2,
): SavedPlaceWeatherBriefItem[] {
  if (!snapshot || snapshot.hazards.length === 0) return [];
  return snapshot.hazards.slice(0, Math.max(1, limit)).map((hazard) => ({
 kind: 'forecast',
 label: hazard.headline,
 value: `${formatLeadHours(hazard.leadHours)} · ${hazard.detail}${snapshot.isStale ? ' · Cached forecast' : ''}`,
 severity: hazard.severity,
 ...(snapshot.forecastUrl ? { link: snapshot.forecastUrl } : {}),
  }));
}

function emitCachedSavedPlaceWeather(place: SavedPlace): SavedPlaceWeatherSnapshot | null {
  const cached = getCachedSavedPlaceWeather(place);
  if (cached) emitSavedPlaceWeatherUpdated(cached);
  return cached;
}

export async function fetchSavedPlaceWeather(place: SavedPlace): Promise<SavedPlaceWeatherSnapshot | null> {
  const cacheKey = buildCacheKey(place);
  try {
 const pointResponse = await fetch(`https://api.weather.gov/points/${place.lat},${place.lon}`, {
 headers: { Accept: 'application/geo+json' },
 signal: AbortSignal.timeout(12_000),
 });
 if (pointResponse.status === 404) {
 return emitCachedSavedPlaceWeather(place);
 }
 if (!pointResponse.ok) throw new Error(`HTTP ${pointResponse.status}`);

 const pointPayload = await pointResponse.json() as NWSPointsResponse;
 const forecastUrl = pointPayload.properties?.forecastHourly;
 if (!forecastUrl) throw new Error('NWS points response missing forecastHourly');
 if (!isAllowedNwsForecastUrl(forecastUrl)) throw new Error('NWS points response returned an unexpected forecast host');

 const forecastResponse = await fetch(forecastUrl, {
 headers: { Accept: 'application/geo+json' },
 signal: AbortSignal.timeout(12_000),
 });
 if (!forecastResponse.ok) throw new Error(`HTTP ${forecastResponse.status}`);

 const forecastPayload = await forecastResponse.json() as NWSForecastResponse;
 const periods = Array.isArray(forecastPayload.properties?.periods) ? forecastPayload.properties.periods : [];
 const hazards = analyzeHourlyForecastPeriods(periods);
 const updatedAt = forecastPayload.properties?.updated ? new Date(forecastPayload.properties.updated) : new Date();
 const fetchedAt = Number.isFinite(updatedAt.getTime()) ? updatedAt : new Date();
 const snapshot = buildSnapshot(place, hazards, fetchedAt, forecastUrl);
 const serialized = serializeSnapshot(snapshot);
 memoryCache.set(cacheKey, serialized);
 writeOfflineCacheEntry(cacheKey, serialized);
 emitSavedPlaceWeatherUpdated(snapshot);
 return snapshot;
  } catch (error) {
 const cached = emitCachedSavedPlaceWeather(place);
 if (cached) return cached;
 if (error instanceof Error && error.message.includes('HTTP 404')) {
 return null;
 }
 throw error;
  }
}

export { SAVED_PLACE_WEATHER_EVENT };
