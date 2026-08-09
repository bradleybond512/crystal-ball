/**
 * Pure adapters: convert each earthquake provider's event shape into the
 * generic DomainObservation the fusion-ingest layer consumes. No DOM, no
 * fetch, no globals — fixture-testable.
 */

import type { UsgsEvent } from '@/services/earthquake/earthquake-intelligence';
import type { EmscEvent } from '@/services/emsc-seismic';
import type { GeofonEvent } from '@/services/geofon-seismic';
import type { DomainObservation } from '@/services/providers/fusion-ingest';

/** Rows from the sidecar `/api/earthquakes` route (see usgs-fusion-fetch.ts). */
export function usgsEventsToObservations(events: readonly UsgsEvent[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const e of events) {
    if (!Number.isFinite(e.magnitude) || !Number.isFinite(e.lat) || !Number.isFinite(e.lon) || !Number.isFinite(e.time)) continue;
    out.push({
      providerId: 'usgs-earthquakes',
      value: e.magnitude,
      lat: e.lat,
      lon: e.lon,
      occurredAt: e.time,
      externalId: e.id || undefined,
    });
  }
  return out;
}

export function emscEventsToObservations(events: readonly EmscEvent[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const e of events) {
    if (e.magnitude == null || !Number.isFinite(e.magnitude) || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    const occurredAt = e.time ? Date.parse(e.time) : Number.NaN;
    if (!Number.isFinite(occurredAt)) continue;
    out.push({
      providerId: 'emsc-seismic',
      value: e.magnitude,
      lat: e.lat,
      lon: e.lon,
      occurredAt,
      externalId: e.id ?? undefined,
    });
  }
  return out;
}

// GEOFON FDSN text timestamps lack a trailing timezone suffix (e.g.
// "2026-07-29T04:07:23.28"); Date.parse treats a suffix-less ISO string as
// LOCAL time, which would skew fusion matching against USGS/EMSC (both UTC).
const HAS_TZ_SUFFIX = /(?:[zZ]$)|(?:[+-]\d\d:?\d\d$)/;

export function geofonEventsToObservations(events: readonly GeofonEvent[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const e of events) {
    if (!Number.isFinite(e.magnitude) || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
    const iso = e.time && !HAS_TZ_SUFFIX.test(e.time) ? `${e.time}Z` : e.time;
    const occurredAt = iso ? Date.parse(iso) : Number.NaN;
    if (!Number.isFinite(occurredAt)) continue;
    out.push({ providerId: 'geofon-seismic', value: e.magnitude, lat: e.lat, lon: e.lon, occurredAt, externalId: e.id || undefined });
  }
  return out;
}
