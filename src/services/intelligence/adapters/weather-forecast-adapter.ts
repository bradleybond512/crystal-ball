/**
 * Weather Forecast Observation Adapter
 *
 * Converts Open-Meteo hourly forecast data (from /api/weather/local-forecast)
 * into ObservationEvent items for the intelligence layer. This gives the
 * algorithms a SECOND, independent weather source alongside NWS alerts:
 *
 *   NWS alerts  → sourceId: 'nws'              (reactive: issued after event)
 *   Open-Meteo  → sourceId: 'open-meteo-forecast' (predictive: hours ahead)
 *
 * When NWS and Open-Meteo both flag the same area, the intelligence layer
 * has two independent SourceAttestation entries → truth-score corroboration
 * bonus (1 source = 0.3, 2 sources = 0.75).
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

export interface OpenMeteoHourlyForecast {
  hourly?: {
    time: string[];
    precipitation: number[];
    wind_gusts_10m: number[];
    weather_code: number[];
  };
  latitude?: number;
  longitude?: number;
  current?: { temperature_2m?: number };
  currentObservedAtMs?: number;
}

// WMO weather code → significant event label (only codes worth flagging)
const WMO_SIGNIFICANT: Record<number, string> = {
  61: 'Rain', 63: 'Moderate Rain', 65: 'Heavy Rain',
  71: 'Snow', 73: 'Moderate Snow', 75: 'Heavy Snow',
  80: 'Rain Showers', 81: 'Moderate Showers', 82: 'Violent Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with Hail', 99: 'Heavy Thunderstorm with Hail',
};

function precipitationSeverity(mm: number): ObservationSeverity | null {
  if (mm >= 25) return 'CRITICAL';
  if (mm >= 10) return 'HIGH';
  if (mm >= 5)  return 'MEDIUM';
  if (mm >= 2)  return 'LOW';
  return null; // below threshold — not worth an observation
}

function windSeverity(ms: number): ObservationSeverity | null {
  if (ms >= 35) return 'CRITICAL'; // hurricane force
  if (ms >= 25) return 'HIGH';     // storm force
  if (ms >= 17) return 'MEDIUM';   // near-gale
  if (ms >= 12) return 'LOW';      // strong breeze
  return null;
}

/**
 * Extract significant weather observation events from an Open-Meteo hourly
 * forecast. Only generates observations for hours that cross meaningful
 * thresholds — not a raw reading per hour.
 *
 * @param forecast Raw response from /api/weather/local-forecast
 * @param lat Latitude the forecast was requested for (saved place)
 * @param lon Longitude
 * @param placeLabel Human-readable label (e.g. "Home — La Porte IN")
 */
function makeLocation(lat: number, lon: number) {
  return { lat, lon, radiusKm: 25 as const };
}

/** Build observations for a single forecast hour. Returns 0–1 observations. */
function observationsForHour(
  lat: number, lon: number, placeLabel: string,
  timestamp: number, timeStr: string,
  precipitation: number, windGusts: number, weatherCode: number,
): ObservationEvent[] {
  const out: ObservationEvent[] = [];
  const loc = makeLocation(lat, lon);

  const precipSev = precipitationSeverity(precipitation);
  if (precipSev) {
    out.push({
      id: `open-meteo-precip-${lat.toFixed(3)}-${lon.toFixed(3)}-${timestamp}`,
      sourceId: 'open-meteo-forecast', domain: 'weather', timestamp, location: loc,
      severity: precipSev,
      title: `${precipitation.toFixed(1)} mm/h precipitation forecast — ${placeLabel}`,
      raw: { precipitation, weatherCode, timestamp: timeStr },
      entityIds: [], tags: ['weather', 'precipitation', 'forecast'],
    });
    return out; // precipitation dominates — skip wind/wx for this hour
  }

  const windSev = windSeverity(windGusts);
  if (windSev) {
    out.push({
      id: `open-meteo-wind-${lat.toFixed(3)}-${lon.toFixed(3)}-${timestamp}`,
      sourceId: 'open-meteo-forecast', domain: 'weather', timestamp, location: loc,
      severity: windSev,
      title: `${windGusts.toFixed(0)} m/s wind gusts forecast — ${placeLabel}`,
      raw: { windGusts, weatherCode, timestamp: timeStr },
      entityIds: [], tags: ['weather', 'wind', 'forecast'],
    });
    return out;
  }

  const wmoLabel = WMO_SIGNIFICANT[weatherCode];
  if (wmoLabel) {
    out.push({
      id: `open-meteo-wx-${lat.toFixed(3)}-${lon.toFixed(3)}-${timestamp}`,
      sourceId: 'open-meteo-forecast', domain: 'weather', timestamp, location: loc,
      severity: 'MEDIUM',
      title: `${wmoLabel} forecast — ${placeLabel}`,
      raw: { weatherCode, timestamp: timeStr },
      entityIds: [], tags: ['weather', 'forecast', wmoLabel.toLowerCase().replace(/\s+/g, '-')],
    });
  }
  return out;
}

export function forecastToObservations(
  forecast: OpenMeteoHourlyForecast,
  lat: number,
  lon: number,
  placeLabel: string,
): ObservationEvent[] {
  // Defensive: malformed or null API responses must never throw
  if (!forecast || typeof forecast !== 'object') return [];
  const hourly = forecast.hourly;
  if (!hourly?.time?.length || !Array.isArray(hourly.time)) return [];

  const observations: ObservationEvent[] = [];
  const now = Date.now();

  for (let i = 0; i < hourly.time.length; i++) {
    const timeStr = hourly.time[i] ?? '';
    const timestamp = new Date(timeStr).getTime();
    if (!Number.isFinite(timestamp) || timestamp < now - 60 * 60 * 1000) continue;

    // Coerce to number — guard against strings in unexpected responses
    const precipitation = Number(Array.isArray(hourly.precipitation) ? (hourly.precipitation[i] ?? 0) : 0);
    const windGusts = Number(Array.isArray(hourly.wind_gusts_10m) ? (hourly.wind_gusts_10m[i] ?? 0) : 0);
    const weatherCode = Number(Array.isArray(hourly.weather_code) ? (hourly.weather_code[i] ?? 0) : 0);
    if (!Number.isFinite(precipitation) || !Number.isFinite(windGusts)) continue;

    observations.push(...observationsForHour(lat, lon, placeLabel, timestamp, timeStr, precipitation, windGusts, weatherCode));
  }

  return observations;
}
