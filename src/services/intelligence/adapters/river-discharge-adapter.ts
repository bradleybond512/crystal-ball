/**
 * River Discharge Observation Adapter (Open-Meteo Flood API)
 *
 * Converts GloFAS river discharge forecasts into ObservationEvent items.
 * This is the PREDICTIVE complement to NOAA CO-OPS point gauges:
 *
 *   NOAA CO-OPS  → current water level    (sourceId: 'noaa-coops')
 *   Open-Meteo Flood → 7-day discharge forecast (sourceId: 'open-meteo-flood')
 *
 * Two independent sources flagging the same area triggers the truth-score
 * corroboration bonus (0.3 → 0.75) AND activates negative-evidence tracking
 * ("we predicted a flood peak — did the gauge confirm it?").
 *
 * The discharge model is GloFAS (Global Flood Awareness System) from the
 * European Centre for Medium-Range Weather Forecasts — a genuine predictive
 * model, not just observations.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

export interface OpenMeteoFloodForecast {
  daily?: {
    time: string[];
    river_discharge: number[];
  };
  latitude?: number;
  longitude?: number;
}

/**
 * Absolute discharge thresholds (m³/s) — fallback for when no relative-spike
 * signal is available. High enough that normally-large rivers (Amazon, Mississippi)
 * don't generate noise. In practice the relative-spike path fires first.
 */
function dischargeSeverity(m3s: number): ObservationSeverity | null {
  if (m3s >= 50_000) return 'CRITICAL'; // Amazon-scale flooding
  if (m3s >= 10_000) return 'HIGH';     // major river in severe flood
  if (m3s >= 2000)  return 'MEDIUM';   // significant regional flood
  return null;
}

/**
 * Detects anomalous discharge days in the 7-day forecast by looking for
 * values significantly above the 7-day mean (1.5× = medium, 2× = high).
 * This avoids generating observations for rivers that are normally large.
 */
function relativeSeverity(discharge: number, mean: number): ObservationSeverity | null {
  if (mean <= 0) return dischargeSeverity(discharge);
  const ratio = discharge / mean;
  if (ratio >= 3)   return 'CRITICAL';
  if (ratio >= 2)   return 'HIGH';
  if (ratio >= 1.5) return 'MEDIUM';
  return null;
}

function leaveOneOutMean(values: number[], excludeIndex: number): number {
  const others = values.filter((_, j) => j !== excludeIndex && Number.isFinite(values[j]));
  return others.length > 0 ? others.reduce((a, b) => a + b, 0) / others.length : 0;
}

function makeDischargeObservation(
  lat: number, lon: number, placeLabel: string,
  timestamp: number, timeStr: string, discharge: number, mean: number, sev: ObservationSeverity,
): ObservationEvent {
  let pct = 'no baseline';
  if (mean > 0) {
    const sign = discharge >= mean ? '+' : '';
    pct = `${sign}${Math.round((discharge / mean - 1) * 100)}% vs 7d mean`;
  }
  return {
    id: `open-meteo-flood-${lat.toFixed(3)}-${lon.toFixed(3)}-${timestamp}`,
    sourceId: 'open-meteo-flood',
    domain: 'weather',
    timestamp,
    location: { lat, lon, radiusKm: 50 },
    severity: sev,
    title: `River discharge ${discharge.toFixed(0)} m³/s forecast — ${placeLabel} (${pct})`,
    raw: { discharge, mean, ratio: mean > 0 ? discharge / mean : null, timestamp: timeStr },
    entityIds: [],
    tags: ['flood', 'river-discharge', 'forecast', 'glofas'],
  };
}

export function riverDischargeToObservations(
  forecast: OpenMeteoFloodForecast,
  lat: number,
  lon: number,
  placeLabel: string,
): ObservationEvent[] {
  if (!forecast || typeof forecast !== 'object') return [];
  const daily = forecast.daily;
  if (!daily?.time?.length || !Array.isArray(daily.river_discharge)) return [];

  const allDischarges = daily.river_discharge.map(Number);
  if (allDischarges.length === 0) return [];

  const observations: ObservationEvent[] = [];
  const now = Date.now();

  for (let i = 0; i < daily.time.length; i++) {
    const timeStr = daily.time[i] ?? '';
    const timestamp = new Date(timeStr).getTime();
    if (!Number.isFinite(timestamp) || timestamp < now - 24 * 60 * 60 * 1000) continue;

    const discharge = allDischarges[i] ?? 0;
    if (!Number.isFinite(discharge) || discharge <= 0) continue;

    const mean = leaveOneOutMean(allDischarges, i);
    const sev = relativeSeverity(discharge, mean) ?? dischargeSeverity(discharge);
    if (!sev) continue;

    observations.push(makeDischargeObservation(lat, lon, placeLabel, timestamp, timeStr, discharge, mean, sev));
  }

  return observations;
}
