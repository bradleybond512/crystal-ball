/**
 * ACLED events poller — feeds the precedent-matcher corpus.
 *
 * ACLED publishes conflict + protest event records via a JSON read API.
 * This module owns the *pure* JSON → HistoricalEvent transform; the
 * actual periodic fetch lives in the sidecar where the API key + email
 * env vars are scoped.
 *
 * Plan invariants:
 *   - Pure functions: no DOM / fetch / globals at import time.
 *   - Fatality count drives intensity — ACLED's primary severity signal.
 *   - The transformer fills HistoricalEvent fields with conservative
 *     defaults so a partial ACLED record never throws.
 *   - 30-day rolling window matches the spec's daily polling cadence.
 */

import type { HistoricalEvent } from './precedent-matcher';

// ── Public types ───────────────────────────────────────────────────────

/**
 * Subset of the ACLED API record fields. ACLED returns numbers as
 * strings sometimes — we accept both shapes and normalize.
 */
export interface AcledRecord {
  event_id_cnty?: string;
  /** YYYY-MM-DD. */
  event_date?: string;
  event_type?: string;
  sub_event_type?: string;
  actor1?: string;
  actor2?: string;
  country?: string;
  admin1?: string;
  location?: string;
  latitude?: string | number;
  longitude?: string | number;
  fatalities?: string | number;
  notes?: string;
}

export interface AcledFilterOptions {
  /** Drop records older than this (ISO date). */
  sinceDate?: string;
  /** Cap number of records returned. */
  limit?: number;
}

// ── Parsers ────────────────────────────────────────────────────────────

/** Parse the ACLED JSON envelope. Their API wraps records in `{ data: [...] }`. */
export function parseAcledResponse(raw: unknown): AcledRecord[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.data)) return [];
  const out: AcledRecord[] = [];
  for (const item of obj.data) {
    if (item && typeof item === 'object') out.push(item as AcledRecord);
  }
  return out;
}

// ── Filter ─────────────────────────────────────────────────────────────

export function filterAcledRecords(
  records: readonly AcledRecord[],
  options: AcledFilterOptions = {},
): AcledRecord[] {
  let out = records.filter((r) => typeof r.event_id_cnty === 'string' && r.event_id_cnty.length > 0);
  if (options.sinceDate) {
    const cutoff = options.sinceDate;
    out = out.filter((r) => typeof r.event_date === 'string' && r.event_date >= cutoff);
  }
  if (typeof options.limit === 'number' && options.limit >= 0) {
    out = out.slice(0, options.limit);
  }
  return out;
}

// ── Transform → HistoricalEvent ────────────────────────────────────────

export function transformAcledToHistorical(record: AcledRecord): HistoricalEvent | null {
  const id = record.event_id_cnty;
  if (!id) return null;

  const fatalities = parseNumber(record.fatalities);
  const intensity = intensityForFatalities(fatalities);
  const actors: string[] = [];
  if (record.actor1) actors.push(record.actor1);
  if (record.actor2 && record.actor2 !== record.actor1) actors.push(record.actor2);

  const country = record.country ?? 'Unknown';
  const placeBits = [record.location, record.admin1, country].filter((s): s is string => typeof s === 'string' && s.length > 0);
  const location = placeBits.length > 0 ? placeBits.join(', ') : country;
  const eventType = nonEmpty(record.sub_event_type) ?? nonEmpty(record.event_type) ?? 'event';

  return {
    id: `acled-${id}`,
    date: record.event_date?.length === 10 ? record.event_date : new Date().toISOString().slice(0, 10),
    location,
    country,
    eventType,
    actors,
    intensity,
    summary: buildSummary(record, fatalities),
    source: 'acled',
  };
}

function intensityForFatalities(fatalities: number): HistoricalEvent['intensity'] {
  if (fatalities >= 50) return 'critical';
  if (fatalities >= 10) return 'high';
  if (fatalities >= 1) return 'medium';
  return 'low';
}

function buildSummary(record: AcledRecord, fatalities: number): string {
  const a1 = record.actor1 ?? 'Actor';
  const a2 = record.actor2 ? ` ↔ ${record.actor2}` : '';
  const place = record.location ? ` in ${record.location}` : '';
  const country = record.country ? `, ${record.country}` : '';
  const fatality = fatalities > 0 ? ` (${fatalities} fatalities)` : '';
  const eventType = nonEmpty(record.sub_event_type) ?? nonEmpty(record.event_type) ?? 'event';
  return `${eventType}: ${a1}${a2}${place}${country}${fatality}`;
}

function nonEmpty(s: string | undefined): string | undefined {
  return typeof s === 'string' && s.length > 0 ? s : undefined;
}

function parseNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

// ── End-to-end pipeline ────────────────────────────────────────────────

export function pipelineAcledToCorpus(
  raw: unknown,
  options: AcledFilterOptions = {},
): HistoricalEvent[] {
  const records = filterAcledRecords(parseAcledResponse(raw), options);
  const out: HistoricalEvent[] = [];
  for (const record of records) {
    const ev = transformAcledToHistorical(record);
    if (ev) out.push(ev);
  }
  return out;
}

// ── URL builder ────────────────────────────────────────────────────────

export interface AcledUrlOptions {
  accessToken: string;
  email: string;
  /** ISO date (YYYY-MM-DD) used as the "since" filter. */
  sinceDate?: string;
  limit?: number;
}

export function buildAcledReadUrl(options: AcledUrlOptions): string {
  const params = new URLSearchParams();
  params.set('key', options.accessToken);
  params.set('email', options.email);
  params.set('limit', String(options.limit ?? 500));
  if (options.sinceDate) {
    params.set('event_date', options.sinceDate);
    params.set('event_date_where', '>=');
  }
  params.set('fields', 'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|admin1|location|latitude|longitude|fatalities|notes');
  params.set('_format', 'json');
  return `https://api.acleddata.com/acled/read?${params.toString()}`;
}

export const __INTERNAL = {
  intensityForFatalities,
  buildSummary,
  parseNumber,
};
