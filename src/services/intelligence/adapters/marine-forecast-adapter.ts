/**
 * Marine Forecast Observation Adapter (Open-Meteo Marine API)
 *
 * Converts wave/swell/current forecast data into ObservationEvent items
 * for the maritime intelligence domain. AIS tracks vessel positions but
 * has no sea-state data — this fills that gap:
 *
 *   AIS vessels     → sourceId: 'ais-relay'    (where ships are)
 *   Open-Meteo Marine → sourceId: 'open-meteo-marine' (sea conditions)
 *
 * When both sources flag the same area (AIS vessel + heavy seas), the
 * compound-risk engine can score maritime hazard significantly higher than
 * it could with vessel position alone.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

export interface OpenMeteoMarineForecast {
  hourly?: {
    time: string[];
    wave_height: number[];
    wave_direction: number[];
    swell_wave_height: number[];
    ocean_current_velocity: number[];
  };
  latitude?: number;
  longitude?: number;
}

// Beaufort sea-state → alert severity mapping
function waveHeightSeverity(m: number): ObservationSeverity | null {
  if (m >= 9)  return 'CRITICAL'; // phenomenal seas (Force 12)
  if (m >= 6)  return 'HIGH';     // very rough to high (Force 9-10)
  if (m >= 4)  return 'MEDIUM';   // rough to very rough (Force 7-8)
  if (m >= 2.5) return 'LOW';     // moderate to rough (Force 5-6)
  return null; // calm/slight — not worth flagging
}

function currentSeverity(ms: number): ObservationSeverity | null {
  if (ms >= 2.5) return 'HIGH';   // 5+ knots — shipping hazard
  if (ms >= 1.5) return 'MEDIUM'; // 3+ knots — operational concern
  return null;
}

function safeNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function marineForecastToObservations(
  forecast: OpenMeteoMarineForecast,
  lat: number,
  lon: number,
  placeLabel: string,
): ObservationEvent[] {
  if (!forecast || typeof forecast !== 'object') return [];
  const hourly = forecast.hourly;
  if (!hourly?.time?.length || !Array.isArray(hourly.time)) return [];

  const observations: ObservationEvent[] = [];
  const now = Date.now();

  for (let i = 0; i < hourly.time.length; i++) {
    const timestamp = new Date(hourly.time[i] ?? '').getTime();
    if (!Number.isFinite(timestamp) || timestamp < now - 60 * 60 * 1000) continue;

    const waveH = safeNumber(Array.isArray(hourly.wave_height) ? hourly.wave_height[i] : 0);
    const swellH = safeNumber(Array.isArray(hourly.swell_wave_height) ? hourly.swell_wave_height[i] : 0);
    const currentV = safeNumber(Array.isArray(hourly.ocean_current_velocity) ? hourly.ocean_current_velocity[i] : 0);

    const waveSev = waveHeightSeverity(waveH);
    if (waveSev) {
      const combinedH = Math.max(waveH, swellH);
      observations.push({
        id: `open-meteo-marine-wave-${lat.toFixed(3)}-${lon.toFixed(3)}-${timestamp}`,
        sourceId: 'open-meteo-marine',
        domain: 'weather',
        timestamp,
        location: { lat, lon, radiusKm: 100 },
        severity: waveSev,
        title: `${combinedH.toFixed(1)} m seas forecast — ${placeLabel}`,
        raw: { waveH, swellH, currentV, timestamp: hourly.time[i] },
        entityIds: [],
        tags: ['maritime', 'wave-height', 'sea-state', 'forecast'],
      });
      continue; // wave dominates
    }

    const currSev = currentSeverity(currentV);
    if (currSev) {
      observations.push({
        id: `open-meteo-marine-current-${lat.toFixed(3)}-${lon.toFixed(3)}-${timestamp}`,
        sourceId: 'open-meteo-marine',
        domain: 'weather',
        timestamp,
        location: { lat, lon, radiusKm: 100 },
        severity: currSev,
        title: `${currentV.toFixed(1)} m/s ocean current forecast — ${placeLabel}`,
        raw: { waveH, swellH, currentV, timestamp: hourly.time[i] },
        entityIds: [],
        tags: ['maritime', 'ocean-current', 'forecast'],
      });
    }
  }

  return observations;
}
