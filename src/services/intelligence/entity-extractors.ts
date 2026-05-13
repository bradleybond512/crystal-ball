/**
 * Entity extractors — pull canonical Entity records out of raw
 * ObservationEvents.
 *
 * Each domain-specific extractor reads from a combination of the
 * observation's `entityIds`, `tags`, and `raw` payload to produce zero or
 * more `Partial<Entity>` records that the caller can hand to
 * `entity-registry.register()`. Returning `Partial<Entity>` rather than
 * full entities lets callers attach the registered observation id on the
 * way through without losing the extractor's structured fields.
 *
 * No DOM, no fetch, no globals — every extractor is a pure function so
 * tests can pin them to fixtures.
 */

import type { ObservationEvent } from '@/types/intelligence';
import type { Entity, EntityType } from './entity-registry';

export type ExtractedEntity = Partial<Entity> & {
  /** Required: every extractor returns a stable id (registry-assignable). */
  id: string;
  type: EntityType;
  canonicalName: string;
};

// ── Raw payload accessors ──────────────────────────────────────────────────

function rawObject(event: ObservationEvent): Record<string, unknown> | null {
  return event.raw && typeof event.raw === 'object'
    ? (event.raw as Record<string, unknown>)
    : null;
}

function rawString(event: ObservationEvent, key: string): string | undefined {
  const raw = rawObject(event);
  if (!raw) return undefined;
  const v = raw[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function rawAny(event: ObservationEvent, key: string): unknown {
  const raw = rawObject(event);
  return raw ? raw[key] : undefined;
}

// ── MMSI / ICAO normalizers ────────────────────────────────────────────────

/** Maritime MMSI: 9 digits. Strips whitespace; returns undefined for non-digit
 *  strings or wrong length. */
export function normalizeMmsi(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) value = String(value);
  if (typeof value !== 'string') return undefined;
  const stripped = value.trim().replace(/\s+/g, '');
  if (!/^\d{9}$/.test(stripped)) return undefined;
  return stripped;
}

/** ICAO 24-bit hex: 6 hex digits, case-insensitive. */
export function normalizeIcao24(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(stripped)) return undefined;
  return stripped;
}

/** Tail number / aircraft registration. Letters, digits, dashes; 4..10 chars. */
export function normalizeTail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,10}$/.test(stripped)) return undefined;
  return stripped;
}

// ── Maritime extractor (AIS / vessel observations) ─────────────────────────

export function extractMaritimeEntities(event: ObservationEvent): ExtractedEntity[] {
  if (event.domain !== 'maritime') return [];
  const mmsi = normalizeMmsi(rawAny(event, 'mmsi'))
    ?? normalizeMmsi(rawAny(event, 'MMSI'))
    ?? extractMmsiFromEntityIds(event.entityIds);
  const name = rawString(event, 'vesselName')
    ?? rawString(event, 'name')
    ?? rawString(event, 'shipName')
    ?? event.title;
  if (!mmsi && !name) return [];

  const identifiers: Record<string, string> = {};
  if (mmsi) identifiers.mmsi = mmsi;
  const imo = rawString(event, 'imo');
  if (imo) identifiers.imo = imo;
  const callsign = rawString(event, 'callsign');
  if (callsign) identifiers.callsign = callsign;
  const flag = rawString(event, 'flag') ?? rawString(event, 'flagCountry');

  const id = mmsi ? `ship:mmsi:${mmsi}` : `ship:name:${slug(name ?? 'unknown')}`;
  const aliases: string[] = [];
  if (mmsi) aliases.push(mmsi);
  if (callsign) aliases.push(callsign);

  return [{
    id,
    type: 'ship',
    canonicalName: name ?? `MMSI ${mmsi ?? 'unknown'}`,
    aliases: dedupe(aliases),
    identifiers,
    domains: ['maritime'],
    attributes: flag ? { flag } : {},
  }];
}

function extractMmsiFromEntityIds(entityIds: readonly string[]): string | undefined {
  for (const id of entityIds) {
    const mmsi = normalizeMmsi(id) ?? normalizeMmsi(id.replace(/^mmsi[:\-]/i, ''));
    if (mmsi) return mmsi;
  }
  return undefined;
}

// ── Aviation extractor ─────────────────────────────────────────────────────

function aircraftIdFor(icao24: string | undefined, tail: string | undefined, callsign: string | undefined): string {
  if (icao24) return `aircraft:icao24:${icao24}`;
  if (tail) return `aircraft:tail:${tail}`;
  return `aircraft:callsign:${slug(callsign ?? 'unknown')}`;
}

function buildAviationIdentifiers(
  icao24: string | undefined,
  callsign: string | undefined,
  tail: string | undefined,
  flightNumber: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (icao24) out.icao24 = icao24;
  if (callsign) out.callsign = callsign;
  if (tail) out.tail = tail;
  if (flightNumber) out.flightNumber = flightNumber;
  return out;
}

function buildAviationAliases(
  canonicalName: string,
  icao24: string | undefined,
  tail: string | undefined,
  callsign: string | undefined,
  flightNumber: string | undefined,
): string[] {
  const aliases: string[] = [];
  if (icao24) aliases.push(icao24);
  if (tail && tail !== canonicalName) aliases.push(tail);
  if (callsign && callsign !== canonicalName) aliases.push(callsign);
  if (flightNumber) aliases.push(flightNumber);
  return dedupe(aliases);
}

export function extractAviationEntities(event: ObservationEvent): ExtractedEntity[] {
  if (event.domain !== 'aviation') return [];
  const icao24 = normalizeIcao24(rawAny(event, 'icao24'))
    ?? normalizeIcao24(rawAny(event, 'icao'))
    ?? normalizeIcao24(rawAny(event, 'hex'))
    ?? extractIcao24FromEntityIds(event.entityIds);
  const callsign = (rawString(event, 'callsign') ?? rawString(event, 'flight') ?? '').trim() || undefined;
  const tail = normalizeTail(rawAny(event, 'tail') ?? rawAny(event, 'registration'));
  const flightNumber = rawString(event, 'flightNumber');
  if (!icao24 && !callsign && !tail) return [];

  const canonicalName = callsign ?? tail ?? icao24 ?? event.title;
  return [{
    id: aircraftIdFor(icao24, tail, callsign),
    type: 'aircraft',
    canonicalName,
    aliases: buildAviationAliases(canonicalName, icao24, tail, callsign, flightNumber),
    identifiers: buildAviationIdentifiers(icao24, callsign, tail, flightNumber),
    domains: ['aviation'],
    attributes: {},
  }];
}

function extractIcao24FromEntityIds(entityIds: readonly string[]): string | undefined {
  for (const id of entityIds) {
    const icao = normalizeIcao24(id) ?? normalizeIcao24(id.replace(/^icao(24)?[:\-]/i, ''));
    if (icao) return icao;
  }
  return undefined;
}

// ── Sanctions / OFAC extractor ─────────────────────────────────────────────

export function extractSanctionsEntities(event: ObservationEvent): ExtractedEntity[] {
  if (event.domain !== 'sanctions') return [];
  const sdnId = rawString(event, 'sdnId')
    ?? rawString(event, 'sdn_id')
    ?? rawString(event, 'ofacId')
    ?? rawString(event, 'uid');
  const name = rawString(event, 'name') ?? rawString(event, 'primaryName') ?? event.title;
  const rawAliases = rawAny(event, 'aliases');
  const aliases = Array.isArray(rawAliases)
    ? rawAliases.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  const sdnType = (rawString(event, 'sdnType') ?? rawString(event, 'type') ?? 'individual').toLowerCase();
  if (!sdnId && !name) return [];

  const type: EntityType = sanctionsTypeOf(sdnType);

  const identifiers: Record<string, string> = {};
  if (sdnId) identifiers['ofac-sdn'] = sdnId;

  const id = sdnId
    ? `${type}:ofac-sdn:${sdnId}`
    : `${type}:name:${slug(name ?? 'unknown')}`;

  return [{
    id,
    type,
    canonicalName: name ?? `OFAC ${sdnId ?? 'unknown'}`,
    aliases: dedupe(aliases),
    identifiers,
    domains: ['sanctions'],
    attributes: { sdnType },
  }];
}

// ── Generic location extractor ─────────────────────────────────────────────

export function extractLocationEntities(event: ObservationEvent): ExtractedEntity[] {
  if (!event.location) return [];
  const placeName = rawString(event, 'place')
    ?? rawString(event, 'placeName')
    ?? rawString(event, 'locality');
  // Round to 0.1° so co-located observations collapse into a single
  // location node without spurious near-misses.
  const lat = roundTo(event.location.lat, 1);
  const lon = roundTo(event.location.lon, 1);
  const id = `location:geo:${lat.toFixed(1)},${lon.toFixed(1)}`;
  const canonicalName = placeName ?? `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  return [{
    id,
    type: 'location',
    canonicalName,
    aliases: [],
    identifiers: { geo: `${lat.toFixed(1)},${lon.toFixed(1)}` },
    domains: [event.domain],
    attributes: { lat: event.location.lat, lon: event.location.lon },
  }];
}

// ── Aggregate ──────────────────────────────────────────────────────────────

const EXTRACTORS: ((event: ObservationEvent) => ExtractedEntity[])[] = [
  extractMaritimeEntities,
  extractAviationEntities,
  extractSanctionsEntities,
  extractLocationEntities,
];

export function extractEntitiesFromObservation(event: ObservationEvent): ExtractedEntity[] {
  const out = new Map<string, ExtractedEntity>();
  for (const extractor of EXTRACTORS) {
    for (const e of extractor(event)) {
      const existing = out.get(e.id);
      if (existing) {
        out.set(e.id, {
          ...existing,
          ...e,
          aliases: dedupe([...(existing.aliases ?? []), ...(e.aliases ?? [])]),
          identifiers: { ...existing.identifiers, ...e.identifiers },
          domains: dedupe([...(existing.domains ?? []), ...(e.domains ?? [])]),
          attributes: { ...existing.attributes, ...e.attributes },
        });
      } else {
        out.set(e.id, e);
      }
    }
  }
  return [...out.values()];
}

// ── Internals ──────────────────────────────────────────────────────────────

function dedupe<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

function sanctionsTypeOf(sdnType: string): EntityType {
  if (sdnType === 'entity' || sdnType === 'organization') return 'organization';
  if (sdnType === 'vessel') return 'ship';
  if (sdnType === 'aircraft') return 'aircraft';
  return 'person';
}

/** Slugify: lowercase + non-alphanumerics → hyphens. Bounded regex
 *  (single character class, single hyphen-collapse pass) so it's safe
 *  against pathological inputs. */
function slug(s: string): string {
  const hyphens = s.toLowerCase().replace(/[^a-z0-9]/g, '-');
  let collapsed = '';
  let prevHyphen = false;
  for (const ch of hyphens) {
    if (ch === '-') {
      if (!prevHyphen) collapsed += ch;
      prevHyphen = true;
    } else {
      collapsed += ch;
      prevHyphen = false;
    }
  }
  return collapsed.replace(/^-/, '').replace(/-$/, '') || 'x';
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
