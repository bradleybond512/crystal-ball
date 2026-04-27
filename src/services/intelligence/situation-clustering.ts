/**
 * Situation clustering — per
 * docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 2 (lines 508-523).
 *
 * Groups NormalizedFacts into Situations along four axes:
 *   - space (within `spatialKm`)
 *   - time (within `temporalMs`)
 *   - source (provider overlap)
 *   - type (eventType / domain)
 *
 * For each Situation we emit:
 *   - canonical title
 *   - timeline (member facts ordered by occurredAt)
 *   - trend (rising / steady / falling severity over the window)
 *   - blended confidence (mean of member truth scores)
 *   - top drivers (highest-severity claims)
 *
 * Pure deterministic — no fetch, no DOM, no globals. Inputs are facts +
 * an optional truth-score function; output is Situation[].
 *
 * Plan invariant: "Contradictions should be surfaced, not averaged away."
 * Situations track contradicting fact ids separately from members so
 * the UI can render dispute callouts without double-counting.
 */

import type { FactDomain, NormalizedFact, Severity } from './types';
import { defaultContext, scoreFact, type TruthScoreContext } from './truth-score';

// ── Public types ─────────────────────────────────────────────────────────

export type SituationTrend = 'rising' | 'steady' | 'falling';

export interface Situation {
  id: string;
  title: string;
  /** Primary domain (the most-represented domain across members). */
  domain: FactDomain;
  /** All distinct domains touched by members — used to flag
   *  cross-domain situations downstream (PR 5 compound risk). */
  domains: FactDomain[];
  factIds: string[];
  /** Earliest occurredAt across members, latest across members. */
  timeWindow: { from: number; to: number };
  /** Mean lat/lon of geolocated members. Undefined when no member
   *  has coordinates (e.g. all global/macro facts). */
  centroid?: { lat: number; lon: number };
  trend: SituationTrend;
  /** Mean of member truthScores in 0-1. */
  confidence: number;
  /** Up to 5 top driver headlines, ordered by severity then recency. */
  topDrivers: string[];
  /** Distinct providers attesting to any member fact. */
  contributingProviders: string[];
  /** Fact ids that contradict at least one member (collected from each
   *  member's contradictedBy list). Tracked separately so confidence
   *  isn't averaged away. */
  contradictingFactIds: string[];
}

// ── Options ──────────────────────────────────────────────────────────────

export interface ClusterOptions {
  /** Two facts cluster if their coords are within this km of each other.
   *  Default 50. Set higher for slow-moving domains (markets/macro). */
  spatialKm?: number;
  /** Two facts cluster if their occurredAt timestamps are within this
   *  many ms of each other. Default 6 hours. */
  temporalMs?: number;
  /** When true, facts must share their eventType (not just domain) to
   *  cluster. Default false — so a "tornado warning" and a "severe TS
   *  warning" near each other still cluster as one situation. */
  requireSameEventType?: boolean;
  /** Truth score context. Defaults to the truth-score defaultContext. */
  truthCtx?: TruthScoreContext;
  /** When supplied, used instead of scoreFact for member confidence —
   *  lets callers inject pre-computed scores. */
  scoreOf?: (fact: NormalizedFact) => number;
}

const DEFAULTS = {
  spatialKm: 50,
  temporalMs: 6 * 60 * 60 * 1000,
};

// ── Top-level clustering ─────────────────────────────────────────────────

export function clusterFacts(
  facts: readonly NormalizedFact[],
  options: ClusterOptions = {},
): Situation[] {
  const opts = { ...DEFAULTS, ...options };
  const ctx = options.truthCtx ?? defaultContext();
  const scoreOf = options.scoreOf ?? ((f: NormalizedFact) => scoreFact(f, ctx).score);

  // Union-find: each fact starts in its own cluster, merge when two
  // facts pass the proximity test.
  const parent = new Map<string, string>();
  for (const f of facts) parent.set(f.id, f.id);
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    parent.set(id, cur);
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      if (shouldCluster(facts[i]!, facts[j]!, opts)) {
        union(facts[i]!.id, facts[j]!.id);
      }
    }
  }

  // Group facts by root.
  const groups = new Map<string, NormalizedFact[]>();
  for (const f of facts) {
    const root = find(f.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(f);
  }

  const situations: Situation[] = [];
  for (const [root, members] of groups) {
    situations.push(buildSituation(root, members, scoreOf));
  }

  // Order by confidence × member count so the most attention-worthy
  // situations bubble up.
  situations.sort(
    (a, b) =>
      b.confidence * Math.log2(b.factIds.length + 1) -
      a.confidence * Math.log2(a.factIds.length + 1),
  );
  return situations;
}

// ── Cluster predicate ──────────────────────────────────────────────────

function shouldCluster(
  a: NormalizedFact,
  b: NormalizedFact,
  opts: Required<Pick<ClusterOptions, 'spatialKm' | 'temporalMs'>> & ClusterOptions,
): boolean {
  // Different domains never cluster, except when an entity is shared —
  // a quake and a tsunami warning over the same country region SHOULD
  // co-cluster as a single situation, but markets and weather should not.
  const sameDomain = a.domain === b.domain;
  const sharedEntity = a.entities.some((e) => b.entities.includes(e));
  if (!sameDomain && !sharedEntity) return false;

  if (opts.requireSameEventType && a.eventType !== b.eventType) return false;

  if (Math.abs(a.occurredAt - b.occurredAt) > opts.temporalMs) return false;

  // Spatial check: only enforced when both facts have coordinates.
  // Facts with no coords (e.g. macro/global) cluster on time + entity
  // alone.
  if (a.lat !== undefined && a.lon !== undefined && b.lat !== undefined && b.lon !== undefined && haversineKm(a.lat, a.lon, b.lat, b.lon) > opts.spatialKm) return false;

  return true;
}

// ── Situation construction ─────────────────────────────────────────────

function buildSituation(
  rootId: string,
  members: readonly NormalizedFact[],
  scoreOf: (fact: NormalizedFact) => number,
): Situation {
  const ordered = [...members].sort((a, b) => a.occurredAt - b.occurredAt);
  const factIds = ordered.map((f) => f.id);
  const earliest = ordered[0]!;
  const latest = ordered[ordered.length - 1]!;

  const domains = unique(ordered.map((f) => f.domain));
  const domain = primaryDomain(ordered);
  const centroid = computeCentroid(ordered);

  const scores = ordered.map((f) => scoreOf(f));
  const confidence = scores.length > 0
    ? scores.reduce((s, v) => s + v, 0) / scores.length
    : 0;

  const trend = computeTrend(ordered);
  const topDrivers = pickTopDrivers(ordered);
  const contributingProviders = unique(
    ordered.flatMap((f) => f.sources.map((s) => s.providerId)),
  );
  const contradictingFactIds = unique(
    ordered.flatMap((f) => f.contradictedBy ?? []),
  );

  return {
    id: `situation:${rootId}`,
    title: titleFor(ordered, domain),
    domain,
    domains,
    factIds,
    timeWindow: { from: earliest.occurredAt, to: latest.occurredAt },
    centroid,
    trend,
    confidence: round3(confidence),
    topDrivers,
    contributingProviders,
    contradictingFactIds,
  };
}

function primaryDomain(facts: readonly NormalizedFact[]): FactDomain {
  const counts = new Map<FactDomain, number>();
  for (const f of facts) counts.set(f.domain, (counts.get(f.domain) ?? 0) + 1);
  let best: FactDomain = facts[0]!.domain;
  let bestCount = 0;
  for (const [d, c] of counts) {
    if (c > bestCount) { best = d; bestCount = c; }
  }
  return best;
}

function computeCentroid(facts: readonly NormalizedFact[]): { lat: number; lon: number } | undefined {
  let sumLat = 0;
  let sumLon = 0;
  let n = 0;
  for (const f of facts) {
    if (f.lat !== undefined && f.lon !== undefined) {
      sumLat += f.lat;
      sumLon += f.lon;
      n += 1;
    }
  }
  if (n === 0) return undefined;
  return { lat: round3(sumLat / n), lon: round3(sumLon / n) };
}

const SEVERITY_RANK: Record<Severity, number> = {
  info: 1,
  low: 2,
  moderate: 3,
  high: 4,
  critical: 5,
};

function computeTrend(facts: readonly NormalizedFact[]): SituationTrend {
  if (facts.length < 2) return 'steady';
  // Compare mean severity of first vs second half. >0.5 rank delta is
  // meaningful.
  const half = Math.floor(facts.length / 2);
  const earlyMean = meanSeverity(facts.slice(0, half));
  const lateMean = meanSeverity(facts.slice(half));
  if (lateMean - earlyMean > 0.5) return 'rising';
  if (earlyMean - lateMean > 0.5) return 'falling';
  return 'steady';
}

function meanSeverity(facts: readonly NormalizedFact[]): number {
  if (facts.length === 0) return 0;
  return facts.reduce((s, f) => s + SEVERITY_RANK[f.severity], 0) / facts.length;
}

function pickTopDrivers(facts: readonly NormalizedFact[]): string[] {
  const ranked = [...facts].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.occurredAt - a.occurredAt;
  });
  return ranked.slice(0, 5).map((f) => f.claim);
}

// Canonical title: "<top severity claim>" + ", +N more" when applicable.
// Plan section asks for a "canonical situation title" — keep it short
// and stable across re-runs.
function titleFor(facts: readonly NormalizedFact[], domain: FactDomain): string {
  if (facts.length === 0) return `${domain} situation`;
  const drivers = pickTopDrivers(facts);
  const head = drivers[0]!;
  if (facts.length === 1) return head;
  return `${head} (+${facts.length - 1} more)`;
}

// ── Geometry helpers ────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(d: number): number { return (d * Math.PI) / 180; }

// ── Misc helpers ────────────────────────────────────────────────────────

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
