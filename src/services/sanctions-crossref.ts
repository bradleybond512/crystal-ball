/**
 * @module sanctions-crossref
 *
 * Automated Sanctions Cross-Reference Service — pure TypeScript, fully offline
 *
 * Maintains an in-memory sanctions database (max 10,000 entries) covering
 * major sanctions lists (OFAC SDN, OFAC Consolidated, EU, UN, OpenSanctions)
 * and cross-references entity names using a tiered matching strategy:
 *
 * 1. Exact match → 100 score
 * 2. Alias match → 90 score
 * 3. Substring containment → 75 score
 * 4. Bigram Dice similarity → 60–80 score (coefficient > 0.7 required)
 *
 * All string comparisons are normalised: lowercase, diacritics removed, trimmed.
 * Match history is capped at 1,000 entries; oldest matches are evicted on overflow.
 *
 * No external dependencies, no network calls. All state is in-memory.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Sanctions list identifiers */
export type SanctionsListType =
  | 'ofac_sdn'
  | 'ofac_consolidated'
  | 'eu_sanctions'
  | 'un_sanctions'
  | 'opensanctions';

/** A single entry in the in-memory sanctions database */
export interface SanctionsEntry {
  /** Unique entry identifier */
  id: string;
  /** Primary name of the sanctioned entity */
  name: string;
  /** Known aliases */
  aliases: string[];
  /** Originating sanctions list */
  listType: SanctionsListType;
  /** Country code or name (ISO 3166-1 alpha-2 or free text) */
  country?: string;
  /** Entity classification */
  entityType: 'person' | 'organization' | 'vessel';
  /** Human-readable reason for designation */
  reason: string;
  /** ISO date string (YYYY-MM-DD) when the entity was listed */
  listedSince?: string;
  /** Source dataset or feed identifier */
  source: string;
}

/** The result of matching a queried name against the sanctions database */
export interface SanctionsMatch {
  /** Unique match identifier */
  id: string;
  /** The name string that was submitted for checking */
  entityName: string;
  /** Entity type provided by the caller */
  entityType: string;
  /** The sanctions entry that matched */
  matchedEntry: SanctionsEntry;
  /** Similarity score 0–100 */
  matchScore: number;
  /** How the match was determined */
  matchType: 'exact' | 'alias' | 'fuzzy';
  /** Unix ms timestamp when the check was performed */
  checkedAt: number;
  /** Optional caller-supplied context (e.g. vessel MMSI, transaction ID) */
  context: string;
}

/** Aggregate statistics for dashboard display */
export interface SanctionsStats {
  /** Total entries currently loaded in the database */
  totalEntries: number;
  /** Total matches recorded in history */
  totalMatches: number;
  /** Entry count per list type */
  byList: Record<SanctionsListType, number>;
  /** Matches recorded in the last 24 hours */
  recentMatches24h: number;
  /** Matches with score >= 80 */
  highConfidenceMatches: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_ENTRIES = 10_000;
const MAX_MATCHES = 1_000;

/** Minimum Dice coefficient for a fuzzy match to be reported */
const FUZZY_DICE_THRESHOLD = 0.7;

// ── In-memory State ────────────────────────────────────────────────────────

let _entries: SanctionsEntry[] = [];
let _matches: SanctionsMatch[] = [];
let _idSeq = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idSeq).toString(36)}`;
}

/**
 * Normalise a name for comparison: lowercase, remove diacritics, collapse
 * punctuation/whitespace.
 */
function normalise(name: string): string {
  return name
 .normalize('NFD')
 .replace(/[\u0300-\u036F]/g, '') // strip combining diacritical marks
 .toLowerCase()
 .replace(/[^a-z0-9\s]/g, ' ') // non-alphanumeric → space
 .replace(/\s+/g, ' ')
 .trim();
}

/**
 * Bigram Dice coefficient between two (already-normalised) strings.
 * Returns 1 for identical strings, 0 when either input is shorter than
 * 2 characters, and a value in (0, 1) otherwise.
 */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  // Build bigram frequency map for a
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
 const bg = a.slice(i, i + 2);
 bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }

  // Count intersecting bigrams
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
 const bg = b.slice(i, i + 2);
 const count = bigramsA.get(bg);
 if (count && count > 0) {
 intersection++;
 bigramsA.set(bg, count - 1);
 }
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Map a Dice coefficient (0.7–1.0) to a fuzzy match score (60–80).
 */
function diceToScore(coefficient: number): number {
  // Linear interpolation: 0.7 → 60, 1.0 → 80
  return Math.round(60 + (coefficient - 0.7) * (80 - 60) / (1.0 - 0.7));
}

/** Trim match history to MAX_MATCHES, keeping the newest entries. */
function trimMatches(): void {
  if (_matches.length > MAX_MATCHES) {
 _matches = _matches.slice(_matches.length - MAX_MATCHES);
  }
}

/**
 * Attempt to match a normalised query name against a single sanctions entry.
 * Returns a SanctionsMatch if a match is found, or null otherwise.
 */
function matchEntry(
  rawName: string,
  normName: string,
  entityType: string,
  context: string,
  entry: SanctionsEntry,
): SanctionsMatch | null {
  const normPrimary = normalise(entry.name);

  // ── 1. Exact match ───────────────────────────────────────────────────────
  if (normName === normPrimary) {
 return {
 id: nextId('sm'),
 entityName: rawName,
 entityType,
 matchedEntry: entry,
 matchScore: 100,
 matchType: 'exact',
 checkedAt: Date.now(),
 context,
 };
  }

  // ── 2. Alias exact match ─────────────────────────────────────────────────
  for (const alias of entry.aliases) {
 if (normName === normalise(alias)) {
 return {
 id: nextId('sm'),
 entityName: rawName,
 entityType,
 matchedEntry: entry,
 matchScore: 90,
 matchType: 'alias',
 checkedAt: Date.now(),
 context,
 };
 }
  }

  // ── 3. Substring containment (75 score) ──────────────────────────────────
  const allNorms = [normPrimary, ...entry.aliases.map(normalise)];
  for (const norm of allNorms) {
 if (
 (normName.length >= 4 && norm.includes(normName)) ||
 (norm.length >= 4 && normName.includes(norm))
 ) {
 return {
 id: nextId('sm'),
 entityName: rawName,
 entityType,
 matchedEntry: entry,
 matchScore: 75,
 matchType: 'fuzzy',
 checkedAt: Date.now(),
 context,
 };
 }
  }

  // ── 4. Dice coefficient fuzzy match (60–80 score) ────────────────────────
  let bestDice = 0;
  for (const norm of allNorms) {
 const coeff = diceCoefficient(normName, norm);
 if (coeff > bestDice) bestDice = coeff;
  }

  if (bestDice >= FUZZY_DICE_THRESHOLD) {
 return {
 id: nextId('sm'),
 entityName: rawName,
 entityType,
 matchedEntry: entry,
 matchScore: diceToScore(bestDice),
 matchType: 'fuzzy',
 checkedAt: Date.now(),
 context,
 };
  }

  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Bulk-load sanctions entries into the database.
 * Existing entries are not deduplicated; call this once per list source.
 * Entries are silently dropped once the 10,000-entry cap is reached.
 *
 * @param entries - Array of entry data (id will be auto-generated)
 */
export function loadSanctionsList(
  entries: Array<{
 name: string;
 aliases?: string[];
 listType: SanctionsListType;
 country?: string;
 entityType: 'person' | 'organization' | 'vessel';
 reason: string;
 listedSince?: string;
 source: string;
  }>,
): void {
  for (const e of entries) {
 if (_entries.length >= MAX_ENTRIES) break;
 _entries.push({
 id: nextId('se'),
 name: e.name,
 aliases: e.aliases ?? [],
 listType: e.listType,
 country: e.country,
 entityType: e.entityType,
 reason: e.reason,
 listedSince: e.listedSince,
 source: e.source,
 });
  }
}

/**
 * Check a single entity name against the full sanctions database.
 * Returns zero or more SanctionsMatch objects sorted by matchScore descending.
 * Matches are recorded in internal history.
 *
 * @param name - Entity name to check
 * @param entityType - Caller-supplied entity type label
 * @param context - Optional caller context (e.g. transaction ID, AIS MMSI)
 */
export function checkEntity(
  name: string,
  entityType: string,
  context = '',
): SanctionsMatch[] {
  const normName = normalise(name);
  const hits: SanctionsMatch[] = [];

  for (const entry of _entries) {
 const match = matchEntry(name, normName, entityType, context, entry);
 if (match) {
 hits.push(match);
 _matches.push(match);
 }
  }

  trimMatches();
  return hits.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Batch-check multiple entities.
 * Results are returned as a flat array sorted by matchScore descending.
 *
 * @param entities - Array of entities to check
 */
export function checkBatch(
  entities: Array<{ name: string; entityType: string; context?: string }>,
): SanctionsMatch[] {
  const all: SanctionsMatch[] = [];
  for (const e of entities) {
 all.push(...checkEntity(e.name, e.entityType, e.context ?? ''));
  }
  return all.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Return recorded matches, optionally filtered and limited.
 * Results are ordered newest first.
 *
 * @param opts.minScore - Minimum matchScore to include (default: 0)
 * @param opts.entityType - Filter to a specific entity type
 * @param opts.listType - Filter to a specific sanctions list
 * @param opts.limit - Maximum number of results
 */
export function getMatches(opts?: {
  minScore?: number;
  entityType?: string;
  listType?: SanctionsListType;
  limit?: number;
}): SanctionsMatch[] {
  let result = [..._matches].reverse(); // newest first
  if (opts?.minScore !== undefined) {
 result = result.filter(m => m.matchScore >= (opts.minScore ?? 0));
  }
  if (opts?.entityType) {
 result = result.filter(m => m.entityType === opts.entityType);
  }
  if (opts?.listType) {
 result = result.filter(m => m.matchedEntry.listType === opts.listType);
  }
  if (opts?.limit && opts.limit > 0) {
 result = result.slice(0, opts.limit);
  }
  return result;
}

/**
 * Return aggregate statistics for the sanctions service.
 */
export function getSanctionsStats(): SanctionsStats {
  const byList: Record<SanctionsListType, number> = {
 ofac_sdn: 0,
 ofac_consolidated: 0,
 eu_sanctions: 0,
 un_sanctions: 0,
 opensanctions: 0,
  };

  for (const e of _entries) {
 byList[e.listType]++;
  }

  const cutoff24h = Date.now() - 24 * 3_600_000;
  const recentMatches24h = _matches.filter(m => m.checkedAt >= cutoff24h).length;
  const highConfidenceMatches = _matches.filter(m => m.matchScore >= 80).length;

  return {
 totalEntries: _entries.length,
 totalMatches: _matches.length,
 byList,
 recentMatches24h,
 highConfidenceMatches,
  };
}

/**
 * Return the most recent matches, newest first.
 *
 * @param limit - Maximum number of results (default: 20)
 */
export function getRecentMatches(limit = 20): SanctionsMatch[] {
  return [..._matches].reverse().slice(0, limit);
}

/**
 * Clear all recorded match history.
 * The sanctions entry database is not affected.
 */
export function clearMatches(): void {
  _matches = [];
}
