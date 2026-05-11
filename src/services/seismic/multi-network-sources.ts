/**
 * Multi-network seismic source normalizers — Layer 1 extension.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Adds support for four regional authoritative networks beyond the
 * existing USGS / EMSC / PAGER triad:
 *
 *   - GeoNet (New Zealand, GNS Science) — regional authority for NZ
 *   - GEOFON (GFZ Potsdam) — global broadband network, fast revisions
 *   - INGV (Italy, Istituto Nazionale di Geofisica e Vulcanologia)
 *   - JMA (Japan Meteorological Agency)
 *
 * Each normalizer returns `CanonicalSeismicEvent | null`. Null means the
 * record was malformed enough that we'd rather drop it than guess at
 * missing fields. Callers should treat null as "skip this entry".
 *
 * Plan invariants:
 *   - Regional networks rank alongside USGS in source priority for
 *     events in their jurisdictions — they typically review faster than
 *     the global feed for local quakes.
 *   - JMA's lat/lon strings ("N37.0", "E140.6") and yyyymmddHHMMSS
 *     timestamps are parsed defensively. Bad values yield null rather
 *     than fabricated coordinates.
 *   - Every output is JSON-serializable (no Date instances, no NaN).
 */

import type { CanonicalSeismicEvent, SeismicSource } from './seismic-types';

// ── GeoNet (api.geonet.org.nz/quake) ───────────────────────────────────

/** Subset of the GeoNet `/quake` GeoJSON Feature shape this module reads. */
export interface GeonetQuakeFeature {
  geometry?: {
    type?: string;
    /** [lon, lat] (no depth in the geometry; depth is in properties). */
    coordinates?: readonly [number, number] | readonly number[];
  };
  properties?: {
    publicID?: string;
    /** Magnitude. */
    magnitude?: number;
    /** Depth in km. */
    depth?: number;
    /** ISO time string. */
    time?: string;
    /** Human-readable place. */
    locality?: string;
    /** GeoNet quality label: best | good | caution | deleted | unknown. */
    quality?: string;
    /** MMI shaking estimate (1–12). Not used for canonical magnitude but
     *  surfaced via `magnitudeType` for callers to distinguish. */
    mmi?: number;
  };
}

/** Normalize a GeoNet `/quake` feature. */
export function normalizeGeonetEvent(feature: GeonetQuakeFeature): CanonicalSeismicEvent | null {
  const props = feature.properties;
  if (!props) return null;
  const id = typeof props.publicID === 'string' ? props.publicID : null;
  if (!id) return null;

  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const occurredAt = parseIsoMs(props.time);
  if (occurredAt === null) return null;

  const status = mapGeonetQuality(props.quality);
  return {
    id: makeCanonicalId('geonet', id),
    source: 'geonet',
    sourceEventId: id,
    magnitude: Number.isFinite(props.magnitude as number) ? (props.magnitude as number) : null,
    depthKm: Number.isFinite(props.depth as number) ? (props.depth as number) : null,
    lat,
    lon,
    place: typeof props.locality === 'string' ? props.locality : '',
    occurredAt,
    status,
    confidence: defaultConfidenceFor('geonet', status),
  };
}

// ── GEOFON FDSN (geofon.gfz.de/fdsnws/event) ───────────────────────────

/** Subset of the FDSN GeoJSON Feature shape — shared between GEOFON
 *  and INGV. */
export interface FdsnGeoJsonFeature {
  id?: string;
  geometry?: {
    type?: string;
    /** [lon, lat, depth_km] — FDSN convention. */
    coordinates?: readonly number[];
  };
  properties?: {
    /** FDSN sets this to 'manual' | 'automatic'. */
    type?: string;
    mag?: number;
    magtype?: string;
    place?: string;
    /** ISO time string. */
    time?: string;
    /** FDSN review status: 'reviewed' | 'preliminary' | 'automatic'. */
    status?: string;
  };
}

/** Normalize a GEOFON FDSN feature. */
export function normalizeGeofonEvent(feature: FdsnGeoJsonFeature): CanonicalSeismicEvent | null {
  return normalizeFdsnFeature(feature, 'geofon');
}

/** Normalize an INGV FDSN feature. INGV uses the same FDSN GeoJSON
 *  schema as GEOFON, so the implementation is shared. */
export function normalizeIngvEvent(feature: FdsnGeoJsonFeature): CanonicalSeismicEvent | null {
  return normalizeFdsnFeature(feature, 'ingv');
}

// ── JMA (bosai/quake/data/list.json) ───────────────────────────────────

/** Subset of the JMA bosai list.json entry shape this module reads.
 *  JMA's coordinate fields can be either decimal numbers or strings
 *  with directional prefixes ("N37.0", "E140.6"); both are accepted. */
export interface JmaEvent {
  /** Event id. JMA uses both `eid` and the longer `at` field for ids. */
  eid?: string;
  /** Place name (Japanese). */
  anm?: string;
  /** Magnitude — string in some feeds, number in others. */
  mag?: number | string;
  /** Latitude. Accepts number, "37.0", "N37.0", or "S37.0". */
  lat?: number | string;
  /** Longitude. Accepts number, "140.6", "E140.6", or "W140.6". */
  lon?: number | string;
  /** Depth in km. JMA reports "ごく浅い" (very shallow) as a string in
   *  some feeds — we coerce that to 0 km. Numeric values pass through. */
  dep?: number | string;
  /** Origin time. JMA serialises as "yyyyMMddHHmmss" or ISO. */
  ctt?: string;
  /** Maximum observed shindo (intensity 0..7), e.g. "5+", "6-". */
  int?: string;
}

/** Normalize a JMA bosai event. */
export function normalizeJmaEvent(event: JmaEvent): CanonicalSeismicEvent | null {
  const id = typeof event.eid === 'string' && event.eid ? event.eid : null;
  if (!id) return null;

  const lat = parseJmaCoord(event.lat, 'N', 'S');
  const lon = parseJmaCoord(event.lon, 'E', 'W');
  if (lat === null || lon === null) return null;

  const occurredAt = parseJmaTime(event.ctt);
  if (occurredAt === null) return null;

  const magnitude = parseFiniteNumber(event.mag);
  const depthKm = parseJmaDepth(event.dep);

  return {
    id: makeCanonicalId('jma', id),
    source: 'jma',
    sourceEventId: id,
    magnitude,
    depthKm,
    lat,
    lon,
    place: typeof event.anm === 'string' ? event.anm : '',
    occurredAt,
    // JMA list entries are operator-released, treat as reviewed.
    status: 'reviewed',
    confidence: defaultConfidenceFor('jma', 'reviewed'),
  };
}

// ── Internal helpers ───────────────────────────────────────────────────

function normalizeFdsnFeature(
  feature: FdsnGeoJsonFeature,
  source: 'geofon' | 'ingv',
): CanonicalSeismicEvent | null {
  const id = typeof feature.id === 'string' ? feature.id : null;
  if (!id) return null;

  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  const depthRaw = coords.length >= 3 ? Number(coords[2]) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const props = feature.properties ?? {};
  const occurredAt = parseIsoMs(props.time);
  if (occurredAt === null) return null;

  const status = mapFdsnStatus(props.status);

  return {
    id: makeCanonicalId(source, id),
    source,
    sourceEventId: id,
    magnitude: Number.isFinite(props.mag as number) ? (props.mag as number) : null,
    magnitudeType: typeof props.magtype === 'string' ? props.magtype : undefined,
    depthKm: depthRaw !== null && Number.isFinite(depthRaw) ? depthRaw : null,
    lat,
    lon,
    place: typeof props.place === 'string' ? props.place : '',
    occurredAt,
    status,
    confidence: defaultConfidenceFor(source, status),
  };
}

function mapGeonetQuality(quality: unknown): CanonicalSeismicEvent['status'] {
  if (typeof quality !== 'string') return 'unknown';
  switch (quality.toLowerCase()) {
    case 'best': { return 'reviewed';
    }
    case 'good': { return 'reviewed';
    }
    case 'caution': { return 'automatic';
    }
    case 'deleted': { return 'deleted';
    }
    default: { return 'unknown';
    }
  }
}

function mapFdsnStatus(status: unknown): CanonicalSeismicEvent['status'] {
  if (typeof status !== 'string') return 'unknown';
  const s = status.toLowerCase();
  if (s === 'reviewed' || s === 'manual') return 'reviewed';
  if (s === 'automatic' || s === 'preliminary') return 'automatic';
  if (s === 'deleted') return 'deleted';
  return 'unknown';
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseJmaCoord(value: unknown, posPrefix: string, negPrefix: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  const trimmed = value.trim();
  let sign = 1;
  let body = trimmed;
  if (trimmed.startsWith(posPrefix)) body = trimmed.slice(posPrefix.length);
  else if (trimmed.startsWith(negPrefix)) {
    body = trimmed.slice(negPrefix.length);
    sign = -1;
  }
  const n = Number(body.replace(/[°\s]/g, ''));
  return Number.isFinite(n) ? sign * n : null;
}

function parseJmaDepth(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  // JMA's "very shallow" (ごく浅い) and "深さ不明" (depth unknown) strings.
  if (value.includes('ごく浅い')) return 0;
  if (value.includes('不明')) return null;
  // Strip "km" / "キロ" suffix, accept signed numbers.
  const n = Number(value.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseJmaTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  // Pure-digit strings: must match the 14-digit "yyyyMMddHHmmss" format.
  // Otherwise Date.parse will happily resolve "12345" to year-12345.
  if (/^\d+$/.test(value)) {
    if (!/^\d{14}$/.test(value)) return null;
  } else {
    // ISO-like strings: try Date.parse.
    const iso = parseIsoMs(value);
    if (iso !== null) return iso;
    return null;
  }
  // 14-digit JST compact format.
  {
    const yyyy = Number(value.slice(0, 4));
    const mm = Number(value.slice(4, 6));
    const dd = Number(value.slice(6, 8));
    const HH = Number(value.slice(8, 10));
    const MM = Number(value.slice(10, 12));
    const SS = Number(value.slice(12, 14));
    if (
      yyyy >= 1900 && yyyy <= 2100
      && mm >= 1 && mm <= 12
      && dd >= 1 && dd <= 31
      && HH >= 0 && HH <= 23
      && MM >= 0 && MM <= 59
      && SS >= 0 && SS <= 60
    ) {
      // JMA timestamps are JST (UTC+9).
      const ms = Date.UTC(yyyy, mm - 1, dd, HH, MM, SS) - 9 * 60 * 60 * 1000;
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

function makeCanonicalId(source: SeismicSource, sourceEventId: string): string {
  return `${source}:${sourceEventId}`;
}

/** Mirrors the baseline confidence rules in seismic-normalizer for the
 *  four new sources. Reviewed adds +0.1 (capped at 1.0), automatic and
 *  unknown stay at base, deleted is 0. */
function defaultConfidenceFor(
  source: SeismicSource,
  status: CanonicalSeismicEvent['status'],
): number {
  // All four regional networks share the 0.7 baseline (matching USGS).
  const base = source === 'jma' || source === 'geonet' || source === 'geofon' || source === 'ingv'
    ? 0.7
    : 0.6;
  if (status === 'reviewed') return Math.min(1, base + 0.1);
  if (status === 'deleted') return 0;
  return base;
}
