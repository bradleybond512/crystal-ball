/**
 * Pure adapter: convert surface-temperature readings from the surface_temp
 * fusion providers (Open-Meteo forecast model, MET Norway observation) into
 * the generic DomainObservation the fusion-ingest layer consumes (value =
 * °C). No DOM, no fetch, no globals — fixture-testable.
 */

import type { DomainObservation } from '@/services/providers/fusion-ingest';

export interface TempReading {
  lat: number;
  lon: number;
  tempC: number;
  observedAt: number;
}

// Real-world surface air temperature never leaves roughly -89°C (Vostok,
// Antarctica, 1983) to +57°C (Death Valley, 1913) — a reading outside
// -95..65°C is a unit-conversion bug or a sentinel/error value, not weather.
const MIN_PLAUSIBLE_C = -95;
const MAX_PLAUSIBLE_C = 65;

export function tempToObservations(providerId: string, readings: readonly TempReading[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const r of readings) {
    if (!Number.isFinite(r.tempC) || r.tempC < MIN_PLAUSIBLE_C || r.tempC > MAX_PLAUSIBLE_C) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (!Number.isFinite(r.observedAt) || r.observedAt <= 0) continue;
    out.push({ providerId, value: r.tempC, lat: r.lat, lon: r.lon, occurredAt: r.observedAt });
  }
  return out;
}
