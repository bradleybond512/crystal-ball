/**
 * Pure adapters: convert each air-quality provider's reading shape into the
 * generic DomainObservation the fusion-ingest layer consumes (value = US/EPA
 * AQI on a 0–500 scale). No DOM, no fetch, no globals — fixture-testable.
 */

import type { AirQualityReading } from '@/services/air-quality';
import type { MonitorReading } from '@/services/airquality/openaq-service';
import type { DomainObservation } from '@/services/providers/fusion-ingest';
import { pm25ToAqi as epaPm25ToAqi } from '@/services/airquality/purpleair-helpers';

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

// Consolidated onto purpleair-helpers.ts's 2024-revision EPA breakpoint
// table — this file used to carry its own self-contained pre-2024 table,
// which under-reports by up to ~12 AQI points vs what AirNow has actually
// published since May 2024 (worst divergence around 9-10 µg/m³), eating
// into half of this domain's 25-point fusion tolerance right where readings
// cluster. purpleair-helpers.pm25ToAqi is pure (no DOM/fetch/imports) and
// already exported, so it's imported directly rather than re-declared.
//
// Two behavioral deltas from the old local table, both handled here:
//  - purpleair-helpers clamps negative PM2.5 to 0 (AQI 0) rather than
//    rejecting it, since it's built for a display path where "somehow
//    negative" should still render something. For fusion input a negative
//    reading is physically invalid sensor garbage, not a legitimate "clean
//    air" observation, so this wrapper keeps rejecting it explicitly.
//  - purpleair-helpers caps anything >= 500.4 at AQI 500 instead of
//    rejecting it — this matches AirNow's own hazardous-ceiling convention
//    (extreme wildfire-smoke PM2.5 is a real reading, not sensor noise) and
//    is adopted as-is; a value that used to be dropped as "off the table"
//    now correctly fuses in as AQI 500.
export function pm25ToAqi(pm25: number): number | undefined {
  if (!Number.isFinite(pm25) || pm25 < 0) return undefined;
  return epaPm25ToAqi(pm25) ?? undefined;
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

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Local, not shared: fusion-ingest.ts has its own module-private haversineKm
// (unexported) and proximity-filter.ts's exported haversineKm drags in the
// location service (localStorage/GPS globals) — neither is a clean pure
// import here, so this mirrors the fusion-ingest formula directly.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Precise distance gate on top of the sidecar's bbox pre-filter: the bbox
// corners reach ~√2 × radius from the center, and a caller that skips the
// bbox still gets the global 20-30k-sensor payload — so cap to the true
// radius before fusion's per-observation linear cluster scan
// (fusion-ingest.ts) ever sees the readings.
export function filterReadingsNearby(
  readings: readonly PurpleairReading[],
  lat: number,
  lon: number,
  radiusKm: number,
): PurpleairReading[] {
  return readings.filter((r) => haversineKm(lat, lon, r.lat, r.lon) <= radiusKm);
}

export interface SensorBoundingBox {
  nwLng: number;
  nwLat: number;
  seLng: number;
  seLat: number;
}

// PurpleAir's v1 API accepts a nwlng/nwlat/selng/selat bounding box, so the
// sidecar can filter upstream instead of shipping every global sensor to the
// renderer. filterReadingsNearby stays the precise gate: a widened box only
// costs payload size, never correctness.
export function bboxAround(lat: number, lon: number, radiusKm: number): SensorBoundingBox {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const nwLat = Math.min(90, lat + latDelta);
  const seLat = Math.max(-90, lat - latDelta);
  if (nwLat >= 90 || seLat <= -90) {
    return { nwLat, seLat, nwLng: -180, seLng: 180 };
  }
  const lonDelta = latDelta / Math.cos(toRad(lat));
  const nwLng = lon - lonDelta;
  const seLng = lon + lonDelta;
  // A box crossing the antimeridian can't be expressed as one nwlng<selng
  // pair — widen to the full span and let filterReadingsNearby trim, rather
  // than silently dropping a user's nearest cross-meridian sensors.
  if (nwLng < -180 || seLng > 180) {
    return { nwLat, seLat, nwLng: -180, seLng: 180 };
  }
  return { nwLat, seLat, nwLng, seLng };
}
