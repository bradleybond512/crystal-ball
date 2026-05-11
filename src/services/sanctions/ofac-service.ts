/**
 * OFAC search + cross-reference index.
 *
 * Pure: no DOM, no fetch. Build an index once from a parsed
 * SdnEntry[] and reuse it for every renderer query / sidecar request.
 *
 *   - searchSanctions(index, query, opts?) — substring match across
 *     name + aliases + ids + countries (case-insensitive). Sorted by
 *     match quality: exact-name > prefix-name > alias > substring.
 *   - vesselNamesToIndex(index) — Map<lowercased name, SdnEntry> for
 *     O(1) AIS-vessel cross-reference.
 *   - imosToIndex(index) — Map<imo string, SdnEntry> for the same.
 *   - matchVesselToSanction(name, mmsi, imo, indexes) — single-call
 *     helper used by /api/maritime/vessels to flag matched ships.
 */

import type { SdnEntry } from './ofac-types';

// ─── Index construction ───────────────────────────────────────────────

export interface OfacIndex {
  entries: readonly SdnEntry[];
  /** Lower-cased name + aliases concatenated per entry, used for the
   *  fast contains() pass during search. */
  searchHaystack: readonly string[];
  vesselsByName: ReadonlyMap<string, SdnEntry>;
  vesselsByImo: ReadonlyMap<string, SdnEntry>;
  vesselsByCallSign: ReadonlyMap<string, SdnEntry>;
}

export function buildOfacIndex(entries: readonly SdnEntry[]): OfacIndex {
  const haystack: string[] = [];
  const vesselsByName = new Map<string, SdnEntry>();
  const vesselsByImo = new Map<string, SdnEntry>();
  const vesselsByCallSign = new Map<string, SdnEntry>();

  for (const e of entries) {
    haystack.push(buildHaystackRow(e));
    if (e.type === 'vessel') indexVessel(e, vesselsByName, vesselsByImo, vesselsByCallSign);
  }

  return { entries, searchHaystack: haystack, vesselsByName, vesselsByImo, vesselsByCallSign };
}

function buildHaystackRow(e: SdnEntry): string {
  const idTokens = e.ids.map((id) => `${id.idType.toLowerCase()}:${id.idNumber.toLowerCase()}`);
  return [e.name.toLowerCase(), ...e.aliases, ...e.countries, ...idTokens].join(' | ');
}

function indexVessel(
  e: SdnEntry,
  byName: Map<string, SdnEntry>,
  byImo: Map<string, SdnEntry>,
  byCallSign: Map<string, SdnEntry>,
): void {
  const nameKey = normalizeVesselName(e.name);
  if (nameKey && !byName.has(nameKey)) byName.set(nameKey, e);
  for (const alias of e.aliases) {
    const aliasKey = normalizeVesselName(alias);
    if (aliasKey && !byName.has(aliasKey)) byName.set(aliasKey, e);
  }
  const imoKey = e.vessel?.imo ? normalizeImo(e.vessel.imo) : '';
  if (imoKey) byImo.set(imoKey, e);
  const csKey = e.vessel?.callSign?.trim().toLowerCase() ?? '';
  if (csKey) byCallSign.set(csKey, e);
}

// ─── Public search API ────────────────────────────────────────────────

export interface SearchOptions {
  /** Cap on results (default 50). */
  limit?: number;
  /** Restrict to a single sdnType (e.g. 'vessel') when set. */
  type?: SdnEntry['type'];
}

export interface SearchHit {
  entry: SdnEntry;
  /** Higher = stronger match. Tier ladder:
   *    100 = exact (case-insensitive) match on `name`
   *     90 = `name` starts with the query
   *     80 = exact match on an alias
   *     70 = alias starts with the query
   *     60 = `name` contains the query (anywhere)
   *     50 = alias / id / country contains the query */
  score: number;
}

export function searchSanctions(
  index: OfacIndex,
  rawQuery: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const out: SearchHit[] = [];

  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i]!;
    if (opts.type && entry.type !== opts.type) continue;
    const score = scoreMatch(entry, query, index.searchHaystack[i] ?? '');
    if (score === 0) continue;
    out.push({ entry, score });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.name.localeCompare(b.entry.name);
  });
  return out.slice(0, limit);
}

function scoreMatch(entry: SdnEntry, query: string, haystack: string): number {
  const name = entry.name.toLowerCase();
  if (name === query) return 100;
  if (name.startsWith(query)) return 90;
  const aliasScore = scoreAliasMatch(entry.aliases, query);
  if (aliasScore !== 0) return aliasScore;
  if (name.includes(query)) return 60;
  if (haystack.includes(query)) return 50;
  return 0;
}

function scoreAliasMatch(aliases: readonly string[], query: string): number {
  let prefixHit = false;
  for (const alias of aliases) {
    if (alias === query) return 80;
    if (!prefixHit && alias.startsWith(query)) prefixHit = true;
  }
  return prefixHit ? 70 : 0;
}

// ─── Vessel-only convenience ──────────────────────────────────────────

export function listSanctionedVessels(index: OfacIndex): SdnEntry[] {
  return index.entries.filter((e) => e.type === 'vessel');
}

export function listSanctionedAircraft(index: OfacIndex): SdnEntry[] {
  return index.entries.filter((e) => e.type === 'aircraft');
}

// ─── AIS cross-reference ──────────────────────────────────────────────

export interface SanctionMatch {
  matched: true;
  reason: 'name' | 'imo' | 'callsign';
  uid: string;
  programs: string[];
  /** Short human-readable label e.g. "OFAC SDN — RUSSIA-EO14024". */
  badge: string;
}

export type SanctionMatchResult = SanctionMatch | { matched: false };

/**
 * Match a vessel from /api/maritime/vessels against the SDN index.
 * Inputs may be partially populated (AIS often lacks IMO and
 * callsign) — we just check whatever's present.
 */
export function matchVesselToSanction(
  args: {
    name?: string | null;
    imo?: string | null;
    callSign?: string | null;
  },
  index: Pick<OfacIndex, 'vesselsByName' | 'vesselsByImo' | 'vesselsByCallSign'>,
): SanctionMatchResult {
  const imoKey = args.imo ? normalizeImo(args.imo) : null;
  if (imoKey) {
    const hit = index.vesselsByImo.get(imoKey);
    if (hit) return toMatch(hit, 'imo');
  }
  const csKey = args.callSign?.trim().toLowerCase();
  if (csKey) {
    const hit = index.vesselsByCallSign.get(csKey);
    if (hit) return toMatch(hit, 'callsign');
  }
  const nameKey = args.name ? normalizeVesselName(args.name) : null;
  if (nameKey) {
    const hit = index.vesselsByName.get(nameKey);
    if (hit) return toMatch(hit, 'name');
  }
  return { matched: false };
}

function toMatch(entry: SdnEntry, reason: 'name' | 'imo' | 'callsign'): SanctionMatch {
  const programLabel = entry.programs.length > 0 ? entry.programs.join(', ').toUpperCase() : 'SDN';
  return {
    matched: true,
    reason,
    uid: entry.uid,
    programs: [...entry.programs],
    badge: `OFAC SDN — ${programLabel}`,
  };
}

// ─── Normalizers ──────────────────────────────────────────────────────

/** Vessel name keys: lowercased, collapsed whitespace, common
 *  suffixes (M/V, M/T, MV, MT, S/V, formerly known as) stripped so
 *  AIS-style "M/V STAR" and SDN "STAR" match. */
export function normalizeVesselName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(m\/v|m\/t|s\/v|m\.v\.|m\.t\.|f\.v\.|mv|mt)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Treasury IMOs sometimes appear as "IMO 1234567" or "1234567". We
 *  reduce to digits, then keep the trailing 7 digits when present. */
export function normalizeImo(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  return digits.length > 7 ? digits.slice(-7) : digits;
}
