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

export interface AirnowReading {
  lat: number;
  lon: number;
  aqi: number;
  parameter: string;
  observedAt: number;
}

export interface PurpleairReading {
  lat: number;
  lon: number;
  pm25: number;
  observedAt: number;
}

// AirNow reports one row per monitored parameter (PM2.5, PM10, Ozone, CO...)
// per station, so a single site can appear several times in one payload. The
// fusion matcher treats same-site/same-time observations from one provider
// as independent signals rather than collapsing them, which would distort
// the site's true air-quality picture — so we collapse to a single
// worst-AQI-wins observation per site before handing off, keyed by lat/lon
// rounded to 3dp (~110m, well under the fusion match radius).
export function airnowToObservations(readings: readonly AirnowReading[]): DomainObservation[] {
  const bySite = new Map<string, AirnowReading>();
  for (const r of readings) {
    if (!Number.isFinite(r.aqi) || r.aqi < 0) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (!Number.isFinite(r.observedAt)) continue;
    const key = `${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
    const existing = bySite.get(key);
    if (!existing || r.aqi > existing.aqi) bySite.set(key, r);
  }
  const out: DomainObservation[] = [];
  for (const r of bySite.values()) {
    out.push({
      providerId: 'airnow',
      value: r.aqi,
      lat: r.lat,
      lon: r.lon,
      occurredAt: r.observedAt,
      externalId: r.parameter,
    });
  }
  return out;
}

// EPA PM2.5 (µg/m³, 24hr) → AQI breakpoint table (linear interpolation within
// each band). Deliberately self-contained here rather than sharing
// purpleair-helpers.ts's table — that one carries the 2024 EPA revision plus
// category labels for its own UI purposes; this is the plain pre-2024 table
// used to derive a fusion-comparable AQI, not a display concern.
const PM25_BREAKPOINTS: readonly { lo: number; hi: number; aqiLo: number; aqiHi: number }[] = [
  { lo: 0, hi: 12, aqiLo: 0, aqiHi: 50 },
  { lo: 12.1, hi: 35.4, aqiLo: 51, aqiHi: 100 },
  { lo: 35.5, hi: 55.4, aqiLo: 101, aqiHi: 150 },
  { lo: 55.5, hi: 150.4, aqiLo: 151, aqiHi: 200 },
  { lo: 150.5, hi: 250.4, aqiLo: 201, aqiHi: 300 },
  { lo: 250.5, hi: 500.4, aqiLo: 301, aqiHi: 500 },
];

export function pm25ToAqi(pm25: number): number | undefined {
  if (!Number.isFinite(pm25) || pm25 < 0) return undefined;
  for (const bp of PM25_BREAKPOINTS) {
    if (pm25 >= bp.lo && pm25 <= bp.hi) {
      return Math.round(((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (pm25 - bp.lo) + bp.aqiLo);
    }
  }
  return undefined;
}

export function purpleairToObservations(readings: readonly PurpleairReading[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const r of readings) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (!Number.isFinite(r.observedAt)) continue;
    const aqi = pm25ToAqi(r.pm25);
    if (aqi === undefined) continue;
    out.push({
      providerId: 'purpleair',
      value: aqi,
      lat: r.lat,
      lon: r.lon,
      occurredAt: r.observedAt,
    });
  }
  return out;
}
