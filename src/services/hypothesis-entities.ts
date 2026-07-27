/**
 * Hypothesis Entities — entity extraction + cross-linking across hypotheses.
 *
 * Scans analyst-loop hypotheses and their evidence labels for named entities
 * (country ISO codes, equity tickers, CVE IDs, region names) and builds a
 * reverse index: "Iran appears in 3 active hypotheses + N evidence items."
 *
 * The HUD uses this to render per-hypothesis entity chips and to surface a
 * "hot entities" row — entities that appear in 2+ concurrent hypotheses.
 *
 * This is deliberately pattern-based (no NLP). The patterns target entities
 * already structured elsewhere in the codebase (ISO3 country codes, ticker
 * symbols, CVE IDs), so results are high precision.
 */

import type { Hypothesis, AnalystSnapshot } from './analyst-loop';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntityKind = 'country' | 'ticker' | 'cve' | 'region' | 'callsign';

export interface EntityMention {
  entity: string;
  kind: EntityKind;
  /** Hypothesis IDs that mention this entity. */
  hypothesisIds: string[];
  /** Source labels the entity was extracted from (evidence labels or region). */
  sources: string[];
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// ISO3 country codes actually used by situations in this codebase are
// uppercase 3-letter codes. We match standalone uppercase 3-letter tokens.
const COUNTRY_CODE = /\b([A-Z]{3})\b/g;
// Tickers can include futures-style suffixes (e.g. CL=F, GC=F) and
// hyphenated pair notation (e.g. BTC-USD, XAU-USD). Restricted further by
// the KNOWN_TICKERS allowlist so spurious uppercase runs don't match.
const TICKER = /\b([A-Z]{1,5}(?:[-=][A-Z0-9]{1,3})?)\b/g;
const CVE = /\b(CVE-\d{4}-\d{4,7})\b/gi;
const CALLSIGN = /\b([A-Z]{2,6}\d{0,4})\b/g;

// Known ISO3 country codes we care about (subset used by the app).
const KNOWN_COUNTRIES = new Set([
  'USA', 'RUS', 'CHN', 'IRN', 'ISR', 'PRK', 'UKR', 'TWN', 'SYR', 'IRQ',
  'AFG', 'PAK', 'IND', 'SAU', 'TUR', 'YEM', 'LBN', 'EGY', 'DEU', 'FRA',
  'GBR', 'JPN', 'KOR', 'VEN', 'CUB', 'LBY', 'SDN', 'ETH', 'SOM', 'NGA',
]);

// Known ticker allowlist so we don't match every uppercase token as a ticker.
const KNOWN_TICKERS = new Set([
  'SPY', 'QQQ', 'DIA', 'VIX', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA',
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'XAU-USD', 'CL=F', 'GC=F',
  'BTC', 'ETH', 'SOL', 'XRP', 'DXY',
]);

// Common false-positive tokens to skip when matching country/ticker shapes.
const STOP_TOKENS = new Set([
  'THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'THIS', 'HAS', 'HAVE', 'ARE',
  'NEW', 'OLD', 'NOT', 'ALL', 'ANY', 'PER', 'VIA', 'OUT', 'DUE', 'AI', 'CVE',
  'API', 'ID', 'IDS', 'URL', 'URI', 'CPU', 'GPU', 'RAM', 'USD', 'EUR', 'GBP',
  'IPV4', 'IPV6',
]);

// ── Extraction ───────────────────────────────────────────────────────────────

function collectMatches(regex: RegExp, text: string): string[] {
  const out: string[] = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

interface ExtractorRule {
  kind: EntityKind;
  pattern: RegExp;
  accept?: (raw: string) => boolean;
  normalize?: (raw: string) => string;
}

const RULES: ExtractorRule[] = [
  { kind: 'cve', pattern: CVE, normalize: r => r.toUpperCase() },
  { kind: 'country', pattern: COUNTRY_CODE, accept: r => !STOP_TOKENS.has(r) && KNOWN_COUNTRIES.has(r) },
  { kind: 'ticker', pattern: TICKER, accept: r => !STOP_TOKENS.has(r) && KNOWN_TICKERS.has(r) },
  { kind: 'callsign', pattern: CALLSIGN, accept: r => !STOP_TOKENS.has(r) && /\d/.test(r) },
];

function extractFromText(text: string): { kind: EntityKind; entity: string }[] {
  const results: { kind: EntityKind; entity: string }[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    for (const raw of collectMatches(rule.pattern, text)) {
      if (rule.accept && !rule.accept(raw)) continue;
      const entity = rule.normalize ? rule.normalize(raw) : raw;
      const key = `${rule.kind}:${entity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ kind: rule.kind, entity });
    }
  }
  return results;
}

function extractFromHypothesis(h: Hypothesis): { kind: EntityKind; entity: string }[] {
  const texts: string[] = [h.statement];
  if (h.region) texts.push(h.region);
  for (const e of h.evidence) texts.push(e.label);
  const combined = texts.join(' | ');

  const out = extractFromText(combined);
  // Region as-is becomes a 'region' entity when short.
  if (h.region && h.region.length <= 40) {
    const trimmed = h.region.trim();
    if (trimmed && !out.some(e => e.kind === 'region' && e.entity === trimmed)) {
      out.push({ kind: 'region', entity: trimmed });
    }
  }
  return out;
}

// ── Cache of last extraction ─────────────────────────────────────────────────

let lastMentions: EntityMention[] = [];
let lastTimestamp = 0;

function buildMentions(snapshot: AnalystSnapshot): EntityMention[] {
  const byKey = new Map<string, EntityMention>();
  for (const h of snapshot.hypotheses) {
    const entities = extractFromHypothesis(h);
    for (const { kind, entity } of entities) {
      const key = `${kind}:${entity}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.hypothesisIds.includes(h.id)) existing.hypothesisIds.push(h.id);
        const label = h.region ?? h.kind;
        if (!existing.sources.includes(label)) existing.sources.push(label);
      } else {
        byKey.set(key, {
          entity,
          kind,
          hypothesisIds: [h.id],
          sources: [h.region ?? h.kind],
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.hypothesisIds.length - a.hypothesisIds.length);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** All entity mentions from the most recent snapshot. */
export function getEntityMentions(): EntityMention[] {
  return lastMentions;
}

/** Entities that appear in 2+ concurrent hypotheses. */
export function getHotEntities(): EntityMention[] {
  return lastMentions.filter(m => m.hypothesisIds.length >= 2);
}

/**
 * Entities associated with a specific hypothesis, looked up from the
 * most-recently-built cache. Returns empty for past-snapshot hypotheses
 * whose IDs are no longer in the cache — use `entitiesFromHypothesis`
 * for anything that might be a replayed or out-of-band hypothesis.
 */
export function entitiesForHypothesis(hypothesisId: string): EntityMention[] {
  return lastMentions.filter(m => m.hypothesisIds.includes(hypothesisId));
}

/**
 * Extract entities from a hypothesis directly, without consulting the
 * lastMentions cache. Use this for code paths that might see past-
 * snapshot hypotheses (HUD replay scrubber, hypothesis-export bundle)
 * where the per-snapshot cache won't have the IDs anymore.
 */
export function entitiesFromHypothesis(h: Hypothesis): EntityMention[] {
  return extractFromHypothesis(h).map(({ kind, entity }) => ({
    entity,
    kind,
    hypothesisIds: [h.id],
    sources: [h.region ?? h.kind],
  }));
}

/** Exposed for tests / debugging. */
export function extractEntitiesFromText(text: string): { kind: EntityKind; entity: string }[] {
  return extractFromText(text);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startHypothesisEntities(): void {
  if (started) return;
  started = true;
  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    lastMentions = buildMentions(ce.detail);
    lastTimestamp = Date.now();
    document.dispatchEvent(new CustomEvent<EntityMention[]>('cb:hypothesis-entities', {
      detail: lastMentions,
    }));
  });
}

/** Timestamp of the last entity extraction pass, for debug surfaces. */
export function getLastEntityScanTime(): number { return lastTimestamp; }
