/**
 * Pure helpers for OpenSanctionsPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Backs the consolidated-watchlist coverage view: dataset freshness,
 * topic badges, per-schema tallies, and aggregate coverage stats over
 * the free OpenSanctions /catalog feed.
 */

export interface SanctionsDataset {
  name: string;
  title: string;
  entityCount: number;
  lastUpdated: string;
  countries: string[];
}

export interface SanctionedEntity {
  id: string;
  caption: string; // display name
  schema: string; // 'Person' | 'Organization' | 'Vessel' | 'Aircraft'
  datasets: string[]; // which sanctions lists this entity is on
  topics: string[]; // 'sanction' | 'pep' | 'crime' etc
  countries: string[];
  aliases: string[];
}

export interface SanctionsStats {
  totalEntities: number;
  totalDatasets: number;
  vessels: number;
  aircraft: number;
  persons: number;
  organizations: number;
  datasets: SanctionsDataset[];
  fetchedAt: string;
}

export type FreshnessStatus = 'fresh' | 'aging' | 'stale';

const DAY_MS = 86_400_000;
const FRESH_DAYS = 7; // < 7 days → fresh
const AGING_DAYS = 14; // 7–13 days → aging, ≥ 14 → stale

/** Whole days between `lastUpdated` and `now`. NaN when unparseable. */
function ageInDays(lastUpdated: string, now: number): number {
  const ts = Date.parse(lastUpdated);
  if (Number.isNaN(ts)) return Number.NaN;
  return Math.floor((now - ts) / DAY_MS);
}

/**
 * Freshness verdict for a dataset's last export.
 * Fails safe to 'stale' when the date can't be parsed — a watchlist we
 * can't confirm is current must not be presented as fresh.
 */
export function getFreshnessStatus(lastUpdated: string, now: number = Date.now()): FreshnessStatus {
  const days = ageInDays(lastUpdated, now);
  if (Number.isNaN(days)) return 'stale';
  if (days < 0) return 'fresh'; // future export timestamp (clock skew)
  if (days < FRESH_DAYS) return 'fresh';
  if (days < AGING_DAYS) return 'aging';
  return 'stale';
}

/** Human-readable relative age, e.g. "today", "1 day ago", "12 days ago". */
export function getFreshnessLabel(lastUpdated: string, now: number = Date.now()): string {
  const days = ageInDays(lastUpdated, now);
  if (Number.isNaN(days)) return 'unknown';
  if (days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const KNOWN_DATASET_NAMES: Record<string, string> = {
  us_ofac_sdn: 'OFAC SDN',
  eu_fsf: 'EU Sanctions',
  gb_hmt_sanctions: 'UK OFSI',
  un_sc_sanctions: 'UN Security Council',
  us_bis_denied: 'BIS Entity List',
  interpol_red: 'INTERPOL Red Notices',
};

const ACRONYMS = new Set([
  'us', 'eu', 'un', 'uk', 'gb', 'ru', 'za', 'ofac', 'sdn', 'bis', 'sc',
  'hmt', 'ofsi', 'fsf', 'pep', 'fic', 'csl', 'nsl',
]);

function titleCaseToken(token: string): string {
  const lower = token.toLowerCase();
  if (ACRONYMS.has(lower) || token.length <= 3) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + lower.slice(1);
}

/** Turn an OpenSanctions dataset ID (e.g. "us_ofac_sdn") into a display name. */
export function formatDatasetName(name: string): string {
  if (!name) return '';
  const known = KNOWN_DATASET_NAMES[name.toLowerCase()];
  if (known) return known;
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
}

const TOPIC_BADGES: Record<string, string> = {
  sanction: 'Sanctioned',
  pep: 'PEP',
  crime: 'Crime',
  wanted: 'Wanted',
  debarment: 'Debarred',
};

/** Short, human display label for an OpenSanctions topic tag. */
export function getTopicBadge(topic: string): string {
  if (!topic) return '';
  for (const segment of topic.toLowerCase().split('.')) {
    const known = TOPIC_BADGES[segment];
    if (known) return known;
  }
  return topic
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(' ');
}

/** Tally entities by their schema (Person / Organization / Vessel / Aircraft / …). */
export function countBySchema(entities: SanctionedEntity[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entities) {
    const key = e.schema && e.schema.trim() ? e.schema : 'Unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Aggregate coverage stats over the catalog datasets, optionally enriched with
 * a sample of entities for the per-schema breakdown (vessels / aircraft / …).
 * The free /catalog feed has no schema histogram, so those counts are 0 unless
 * entities are supplied.
 */
export function aggregateStats(
  datasets: SanctionsDataset[],
  entities: SanctionedEntity[] = [],
  now: number = Date.now(),
): SanctionsStats {
  const totalEntities = datasets.reduce((sum, d) => sum + (Number(d.entityCount) || 0), 0);
  const bySchema = countBySchema(entities);
  return {
    totalEntities,
    totalDatasets: datasets.length,
    persons: bySchema.Person ?? 0,
    organizations: bySchema.Organization ?? 0,
    vessels: bySchema.Vessel ?? 0,
    aircraft: bySchema.Aircraft ?? 0,
    datasets,
    fetchedAt: new Date(now).toISOString(),
  };
}

/**
 * The least-recently-updated dataset, for the "Most stale" headline.
 * Unparseable dates sort as maximally stale so they surface, not hide.
 */
export function mostStaleDataset(datasets: SanctionsDataset[]): SanctionsDataset | null {
  if (datasets.length === 0) return null;
  let worst = datasets[0]!;
  let worstTs = Date.parse(worst.lastUpdated);
  if (Number.isNaN(worstTs)) worstTs = -Infinity;
  for (const d of datasets.slice(1)) {
    let ts = Date.parse(d.lastUpdated);
    if (Number.isNaN(ts)) ts = -Infinity;
    if (ts < worstTs) {
      worst = d;
      worstTs = ts;
    }
  }
  return worst;
}
