/**
 * GDELT 2.0 events poller — feeds the precedent-matcher corpus.
 *
 * GDELT publishes a new export file every 15 minutes at
 * http://data.gdeltproject.org/gdeltv2/lastupdate.txt — three lines
 * pointing at events / mentions / gkg CSVs (zipped). This module owns
 * the *pure* CSV parsing + transform → `HistoricalEvent[]`. The
 * actual periodic fetch + zip extraction lives in the sidecar so it
 * runs server-side (CORS + bandwidth), but the helpers here are
 * unit-testable on static fixtures.
 *
 * Plan invariants:
 *   - Pure functions: no DOM / fetch / globals at import time.
 *   - QuadClass filter is the dominant signal — GDELT's events file
 *     has confidence in NumMentions (mention count = how many distinct
 *     articles corroborate this event).
 *   - The transformer fills `HistoricalEvent` fields with conservative
 *     defaults so a partial GDELT row never throws.
 */

import type { HistoricalEvent } from './precedent-matcher';

// ── Public types ───────────────────────────────────────────────────────

export interface LastUpdateEntry {
  size: number;
  md5: string;
  url: string;
}

export interface LastUpdateManifest {
  events: LastUpdateEntry | null;
  mentions: LastUpdateEntry | null;
  gkg: LastUpdateEntry | null;
}

/** GDELT QuadClass: 1=verbal coop, 2=material coop, 3=verbal conflict,
 *  4=material conflict. */
export type GdeltQuadClass = 1 | 2 | 3 | 4;

/**
 * Subset of the GDELT 2.0 events CSV columns we use. The CSV has 61
 * tab-separated columns; we extract the ones the precedent matcher
 * needs and drop the rest.
 */
export interface GdeltEventRow {
  globalEventId: string;
  /** SQLDATE (YYYYMMDD). */
  sqlDate: string;
  quadClass: GdeltQuadClass;
  /** Goldstein scale [-10, +10]. */
  goldsteinScale: number;
  /** Number of mentions across distinct sources — our confidence proxy. */
  numMentions: number;
  /** Average tone of the source articles, [-100, +100]. */
  avgTone: number;
  actor1Name: string;
  actor2Name: string;
  actor1CountryCode: string;
  /** ActionGeo_FullName — best-of-three location for the event. */
  actionGeoFullName: string;
  actionGeoCountryCode: string;
  actionGeoLat: number | null;
  actionGeoLon: number | null;
  eventCode: string;
  /** SOURCEURL — the article that triggered the record. */
  sourceUrl: string;
}

export interface FilterOptions {
  /** Minimum NumMentions threshold. Default 60 per spec. */
  minMentions?: number;
  /** Whether to include only QuadClass 3 + 4 (conflict). Default true. */
  conflictOnly?: boolean;
}

// ── lastupdate.txt parsing ─────────────────────────────────────────────

const LAST_UPDATE_LINE_RE = /^(\d+)\s+([a-f0-9]{32})\s+(\S+)$/i;

/**
 * Parse the three-line lastupdate.txt manifest. Returns nulls for any
 * line that's missing or malformed; downstream callers must handle a
 * null for whichever data set they expected.
 */
export function parseLastUpdateTxt(text: string): LastUpdateManifest {
  const out: LastUpdateManifest = { events: null, mentions: null, gkg: null };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = LAST_UPDATE_LINE_RE.exec(line);
    if (!match) continue;
    const entry: LastUpdateEntry = {
      size: Number.parseInt(match[1]!, 10),
      md5: match[2]!.toLowerCase(),
      url: match[3]!,
    };
    if (entry.url.includes('.export.CSV')) out.events = entry;
    else if (entry.url.includes('.mentions.CSV')) out.mentions = entry;
    else if (entry.url.includes('.gkg.csv')) out.gkg = entry;
  }
  return out;
}

// ── Events CSV parsing ─────────────────────────────────────────────────

/**
 * Parse one tab-separated GDELT events row. Returns null on malformed
 * input — callers should filter out nulls. Robust to truncated rows
 * (returns null rather than throwing).
 */
export function parseGdeltEventsCsvLine(line: string): GdeltEventRow | null {
  if (!line) return null;
  const cols = line.split('\t');
  // Need at least up through SOURCEURL (col 60). GDELT 2.0 has 61 cols.
  if (cols.length < 60) return null;

  const quadClass = Number.parseInt(cols[26] ?? '', 10);
  if (quadClass !== 1 && quadClass !== 2 && quadClass !== 3 && quadClass !== 4) return null;

  const globalEventId = cols[0]!;
  if (!globalEventId) return null;

  return {
    globalEventId,
    sqlDate: cols[1] ?? '',
    quadClass: quadClass as GdeltQuadClass,
    goldsteinScale: parseNumberOrZero(cols[30]),
    numMentions: parseNumberOrZero(cols[31]),
    avgTone: parseNumberOrZero(cols[34]),
    actor1Name: cols[6] ?? '',
    actor2Name: cols[16] ?? '',
    actor1CountryCode: cols[7] ?? '',
    actionGeoFullName: cols[53] ?? '',
    actionGeoCountryCode: cols[54] ?? '',
    actionGeoLat: parseNumberOrNull(cols[56]),
    actionGeoLon: parseNumberOrNull(cols[57]),
    eventCode: cols[26] ?? '',
    sourceUrl: cols[60] ?? '',
  };
}

export function parseGdeltEventsCsv(text: string): GdeltEventRow[] {
  const out: GdeltEventRow[] = [];
  for (const line of text.split('\n')) {
    const row = parseGdeltEventsCsvLine(line);
    if (row) out.push(row);
  }
  return out;
}

// ── Filter ─────────────────────────────────────────────────────────────

/**
 * Filter rows to material/verbal conflict events with NumMentions
 * above the confidence floor. Per spec: QuadClass 3/4 + mentions > 60.
 */
export function filterMaterialConflict(
  rows: readonly GdeltEventRow[],
  options: FilterOptions = {},
): GdeltEventRow[] {
  const minMentions = options.minMentions ?? 60;
  const conflictOnly = options.conflictOnly ?? true;
  return rows.filter((r) => {
    if (r.numMentions < minMentions) return false;
    if (conflictOnly && r.quadClass !== 3 && r.quadClass !== 4) return false;
    return true;
  });
}

// ── Transform → HistoricalEvent ────────────────────────────────────────

const QUAD_CLASS_LABEL: Record<GdeltQuadClass, string> = {
  1: 'verbal-cooperation',
  2: 'material-cooperation',
  3: 'verbal-conflict',
  4: 'material-conflict',
};

export function transformToHistoricalEvent(row: GdeltEventRow): HistoricalEvent {
  const intensity = intensityForRow(row);
  const actors: string[] = [];
  if (row.actor1Name) actors.push(row.actor1Name);
  if (row.actor2Name && row.actor2Name !== row.actor1Name) actors.push(row.actor2Name);

  return {
    id: `gdelt-${row.globalEventId}`,
    date: sqlDateToIso(row.sqlDate),
    location: row.actionGeoFullName || row.actor1CountryCode || 'Unknown',
    country: row.actionGeoCountryCode || row.actor1CountryCode || 'XX',
    eventType: QUAD_CLASS_LABEL[row.quadClass],
    actors,
    intensity,
    summary: buildSummary(row),
    source: 'gdelt',
  };
}

/**
 * Map a row to {low, medium, high, critical}. Goldstein < -7 (severe
 * conflict) + many mentions → critical; otherwise scale on mentions
 * with Goldstein as a secondary signal.
 */
function intensityForRow(row: GdeltEventRow): HistoricalEvent['intensity'] {
  const isMaterialConflict = row.quadClass === 4;
  if (isMaterialConflict && row.goldsteinScale <= -7 && row.numMentions >= 200) return 'critical';
  if (isMaterialConflict && row.numMentions >= 200) return 'high';
  if (row.numMentions >= 100) return 'medium';
  return 'low';
}

function buildSummary(row: GdeltEventRow): string {
  const a1 = row.actor1Name || row.actor1CountryCode || 'Actor';
  const a2 = row.actor2Name ? ` ↔ ${row.actor2Name}` : '';
  const place = row.actionGeoFullName ? ` in ${row.actionGeoFullName}` : '';
  return `${QUAD_CLASS_LABEL[row.quadClass]}: ${a1}${a2}${place} (mentions=${row.numMentions}, Goldstein=${row.goldsteinScale.toFixed(1)})`;
}

// ── Helpers ────────────────────────────────────────────────────────────

function sqlDateToIso(sqlDate: string): string {
  // GDELT SQLDATE is YYYYMMDD. Convert to YYYY-MM-DD ISO date (no time).
  if (sqlDate.length !== 8) return new Date().toISOString().slice(0, 10);
  return `${sqlDate.slice(0, 4)}-${sqlDate.slice(4, 6)}-${sqlDate.slice(6, 8)}`;
}

function parseNumberOrZero(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumberOrNull(value: string | undefined): number | null {
  if (!value || value === '0' || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── End-to-end pipeline (used by sidecar) ──────────────────────────────

export function pipelineCsvToCorpus(
  csvText: string,
  options: FilterOptions = {},
): HistoricalEvent[] {
  const rows = parseGdeltEventsCsv(csvText);
  const filtered = filterMaterialConflict(rows, options);
  return filtered.map((row) => transformToHistoricalEvent(row));
}

export const __INTERNAL = {
  intensityForRow,
  sqlDateToIso,
  parseNumberOrZero,
  parseNumberOrNull,
  buildSummary,
};
