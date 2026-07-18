/**
 * Pure adapters: convert each air-quality provider's reading shape into the
 * generic DomainObservation the fusion-ingest layer consumes (value = US/EPA
 * AQI on a 0–500 scale). No DOM, no fetch, no globals — fixture-testable.
 */

import type { AirQualityReading } from '@/services/air-quality';
import type { MonitorReading } from '@/services/airquality/openaq-service';
import type { DomainObservation } from '@/services/providers/fusion-ingest';

export function openMeteoAqToObservations(readings: readonly AirQualityReading[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const r of readings) {
    if (!Number.isFinite(r.aqi) || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    // Guard against null/invalid updatedAt — mirrors the observedAt check in openaqToObservations.
    if (!r.updatedAt || Number.isNaN(r.updatedAt.getTime())) continue;
    out.push({
      providerId: 'open-meteo-aqi',
      value: r.aqi,
      lat: r.lat,
      lon: r.lon,
      occurredAt: r.updatedAt.getTime(),
      externalId: r.city,
    });
  }
  return out;
}

export function openaqToObservations(readings: readonly MonitorReading[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const r of readings) {
    // Only PM2.5 stations carry a comparable EPA AQI; others have aqi === null.
    if (r.aqi == null || !Number.isFinite(r.aqi)) continue;
    if (r.lat == null || r.lon == null || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (r.observedAt == null || !Number.isFinite(r.observedAt)) continue;
    out.push({
      providerId: 'openaq-v3',
      value: r.aqi,
      lat: r.lat,
      lon: r.lon,
      occurredAt: r.observedAt,
      externalId: r.id,
    });
  }
  return out;
}
