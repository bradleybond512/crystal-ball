/**
 * Compound risk index — per
 * docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 5 (lines 559-573).
 *
 * Fuses clustered situations (PR 2) with cross-domain overlap to
 * produce:
 *   - compound score (0-100)
 *   - affected domains
 *   - impact categories
 *   - likely cascade paths
 *   - recommended watch items
 *
 * The intuition: a hurricane near a refinery corridor + low gasoline
 * inventory + Gulf weather risk is much worse than the sum of those
 * three situations evaluated independently. Compound risk surfaces
 * when (a) situations share entities or geography, (b) they touch
 * domains known to cascade into each other, or (c) confidence is
 * high across the board.
 *
 * Pure deterministic. No DOM, no fetch.
 */

import type { FactDomain } from './types';

// ── Inputs the engine accepts ────────────────────────────────────────────

/** Subset of `intelligence/Situation` (PR 2) the engine actually needs.
 *  Lifted into its own type so callers can build inputs from any source
 *  (clustered situations, raw forecasts, weather urgency results). */
export interface CompoundRiskInput {
  id: string;
  /** Display title for cascade-path explanations. */
  title: string;
  /** Primary domain. */
  domain: FactDomain;
  /** All domains the underlying facts touch (cross-domain situations). */
  domains: readonly FactDomain[];
  /** 0-100 severity score. */
  severityScore: number;
  /** 0-1 confidence in the situation. */
  confidence: number;
  /** Country / asset / entity ids — used for overlap detection. */
  entities: readonly string[];
  /** Optional centroid for spatial overlap. */
  centroid?: { lat: number; lon: number };
  /** Optional region label ('US-IN', 'Black Sea', 'global'). */
  region?: string;
}

// ── Output ───────────────────────────────────────────────────────────────

export type ImpactCategory =
  | 'human_safety'
  | 'critical_infrastructure'
  | 'food_security'
  | 'energy_security'
  | 'financial_markets'
  | 'supply_chain'
  | 'public_health'
  | 'national_security'
  | 'communications';

export interface CascadePath {
  /** Ordered list of situation ids — earliest cause to latest effect. */
  situationIds: readonly string[];
  /** Human-readable narrative ("hurricane → Gulf refinery outage →
   *  diesel shortage"). */
  narrative: string;
  /** 0-1 plausibility (mean confidence of constituents discounted by
   *  hop count — longer cascades are less certain). */
  plausibility: number;
}

export interface WatchItem {
  /** Short label ("EIA inventory update", "NWS warning expansion"). */
  label: string;
  /** Why this matters for the compound risk. */
  rationale: string;
  /** Domain tag so the UI can route to the right panel. */
  domain: FactDomain;
}

export interface CompoundRiskResult {
  id: string;
  /** 0-100 compound risk score. */
  score: number;
  /** Categorical label. */
  level: 'background' | 'elevated' | 'severe' | 'critical';
  /** Member situation ids in priority order. */
  memberIds: string[];
  /** Distinct domains spanned. */
  affectedDomains: FactDomain[];
  /** Categorized impact buckets. */
  impactCategories: ImpactCategory[];
  /** Up to 3 most plausible cascade paths. */
  cascadePaths: CascadePath[];
  /** Up to 5 next-thing-to-watch items. */
  watchItems: WatchItem[];
  /** Human-readable headline for the UI. */
  headline: string;
}

// ── Top-level API ───────────────────────────────────────────────────────

export interface CompoundRiskOptions {
  /** Default 100 km — situations within this distance can compound. */
  spatialKm?: number;
  /** Default 1 — at least this many shared entities OR centroid
   *  proximity OR known cascade pair to compound. */
  minOverlap?: number;
  /** Score threshold for `elevated` (default 35), `severe` (60),
   *  `critical` (80). */
  thresholds?: { elevated?: number; severe?: number; critical?: number };
}

export function computeCompoundRisk(
  inputs: readonly CompoundRiskInput[],
  options: CompoundRiskOptions = {},
): CompoundRiskResult[] {
  const opts = {
    spatialKm: options.spatialKm ?? 100,
    minOverlap: options.minOverlap ?? 1,
    thresholds: {
      elevated: options.thresholds?.elevated ?? 35,
      severe: options.thresholds?.severe ?? 60,
      critical: options.thresholds?.critical ?? 80,
    },
  };

  const groups = unionFind(inputs, opts);
  const results: CompoundRiskResult[] = [];
  for (const members of groups) {
    if (members.length === 0) continue;
    results.push(buildResult(members, opts.thresholds));
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Union-find clustering by overlap ─────────────────────────────────────

function unionFind(
  inputs: readonly CompoundRiskInput[],
  opts: { spatialKm: number; minOverlap: number },
): CompoundRiskInput[][] {
  const parent = new Map<string, string>();
  for (const i of inputs) parent.set(i.id, i.id);
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

  for (let i = 0; i < inputs.length; i += 1) {
    for (let j = i + 1; j < inputs.length; j += 1) {
      if (overlap(inputs[i]!, inputs[j]!, opts) >= opts.minOverlap) {
        union(inputs[i]!.id, inputs[j]!.id);
      }
    }
  }

  const groups = new Map<string, CompoundRiskInput[]>();
  for (const input of inputs) {
    const root = find(input.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(input);
  }
  return [...groups.values()];
}

function overlap(
  a: CompoundRiskInput,
  b: CompoundRiskInput,
  opts: { spatialKm: number },
): number {
  let count = 0;
  // Shared entities.
  if (a.entities.some((e) => b.entities.includes(e))) count += 1;
  // Spatial proximity.
  if (a.centroid && b.centroid) {
    const km = haversineKm(a.centroid.lat, a.centroid.lon, b.centroid.lat, b.centroid.lon);
    if (km <= opts.spatialKm) count += 1;
  }
  // Known cascade pair (cross-domain).
  if (cascadePair(a.domain, b.domain)) count += 1;
  // Same region label.
  if (a.region && b.region && a.region === b.region) count += 1;
  return count;
}

// ── Result builder ──────────────────────────────────────────────────────

function buildResult(
  members: readonly CompoundRiskInput[],
  thresholds: Required<NonNullable<CompoundRiskOptions['thresholds']>>,
): CompoundRiskResult {
  const sorted = [...members].sort((a, b) => b.severityScore * b.confidence - a.severityScore * a.confidence);
  const memberIds = sorted.map((m) => m.id);
  const affectedDomains = uniqueDomains(sorted.flatMap((m) => [m.domain, ...m.domains]));
  const impactCategories = deriveImpactCategories(affectedDomains);
  const score = computeScore(sorted, affectedDomains.length);
  const level = labelFor(score, thresholds);
  const cascadePaths = buildCascadePaths(sorted);
  const watchItems = buildWatchItems(affectedDomains, sorted);
  const headline = buildHeadline(sorted, affectedDomains, score);

  return {
    id: `compound:${memberIds[0] ?? 'empty'}`,
    score,
    level,
    memberIds,
    affectedDomains,
    impactCategories,
    cascadePaths,
    watchItems,
    headline,
  };
}

function computeScore(
  members: readonly CompoundRiskInput[],
  domainCount: number,
): number {
  if (members.length === 0) return 0;
  // Mean of severity * confidence, then bumped by cross-domain breadth.
  const meanWeighted =
    members.reduce((s, m) => s + m.severityScore * m.confidence, 0) / members.length;
  // Cross-domain bump: 1 domain = 1.0, 2 domains = 1.15, 3+ = 1.25.
  const breadth = breadthMultiplier(domainCount);
  // Member-count bump: 1 = 1.0, 2 = 1.1, 3+ = 1.2.
  const corroboration = corroborationMultiplier(members.length);
  return Math.round(Math.min(100, meanWeighted * breadth * corroboration));
}

function breadthMultiplier(domainCount: number): number {
  if (domainCount >= 3) return 1.25;
  if (domainCount === 2) return 1.15;
  return 1;
}

function corroborationMultiplier(memberCount: number): number {
  if (memberCount >= 3) return 1.2;
  if (memberCount === 2) return 1.1;
  return 1;
}

function labelFor(score: number, thresholds: Required<NonNullable<CompoundRiskOptions['thresholds']>>): CompoundRiskResult['level'] {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.severe) return 'severe';
  if (score >= thresholds.elevated) return 'elevated';
  return 'background';
}

// ── Cascade paths ──────────────────────────────────────────────────────

function buildCascadePaths(members: readonly CompoundRiskInput[]): CascadePath[] {
  const paths: CascadePath[] = [];
  const order = orderByCascade(members);

  // Whole-group path (the most informative one).
  if (order.length >= 2) {
    const meanConfidence = order.reduce((s, m) => s + m.confidence, 0) / order.length;
    // Discount by hop count: each extra hop multiplies plausibility by 0.85.
    const plausibility = clamp01(meanConfidence * Math.pow(0.85, order.length - 2));
    paths.push({
      situationIds: order.map((m) => m.id),
      narrative: order.map((m) => m.title).join(' → '),
      plausibility: round3(plausibility),
    });
  }
  // Pairwise top-3 cascades.
  for (let i = 0; i < order.length - 1 && paths.length < 4; i += 1) {
    const a = order[i]!;
    const b = order[i + 1]!;
    paths.push({
      situationIds: [a.id, b.id],
      narrative: `${a.title} → ${b.title}`,
      plausibility: round3((a.confidence + b.confidence) / 2),
    });
  }
  // Top 3 by plausibility.
  paths.sort((a, b) => b.plausibility - a.plausibility);
  return paths.slice(0, 3);
}

/** Order members by their natural cascade direction: cause domains
 *  come before effect domains. The CASCADE_ORDER constant is a rough
 *  prior — weather/space/infra trigger markets/humanitarian effects. */
const CASCADE_ORDER: FactDomain[] = [
  'weather', 'space', 'infra', 'cyber', 'conflict', 'maritime', 'aviation',
  'macro', 'markets', 'humanitarian', 'other',
];

function orderByCascade(members: readonly CompoundRiskInput[]): CompoundRiskInput[] {
  return [...members].sort((a, b) => {
    const ai = CASCADE_ORDER.indexOf(a.domain);
    const bi = CASCADE_ORDER.indexOf(b.domain);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

// ── Impact categories ──────────────────────────────────────────────────

function deriveImpactCategories(domains: readonly FactDomain[]): ImpactCategory[] {
  const out = new Set<ImpactCategory>();
  for (const d of domains) {
    switch (d) {
      case 'weather': { out.add('human_safety'); out.add('critical_infrastructure'); break; }
      case 'cyber': { out.add('communications'); out.add('financial_markets'); out.add('critical_infrastructure'); break; }
      case 'aviation': { out.add('supply_chain'); out.add('human_safety'); break; }
      case 'maritime': { out.add('supply_chain'); break; }
      case 'markets': { out.add('financial_markets'); break; }
      case 'macro': { out.add('financial_markets'); break; }
      case 'conflict': { out.add('national_security'); out.add('human_safety'); break; }
      case 'humanitarian': { out.add('food_security'); out.add('public_health'); out.add('human_safety'); break; }
      case 'space': { out.add('communications'); out.add('critical_infrastructure'); break; }
      case 'infra': { out.add('critical_infrastructure'); out.add('energy_security'); break; }
      case 'other': { /* no add */ break; }
    }
  }
  return [...out];
}

// ── Watch items ────────────────────────────────────────────────────────

function buildWatchItems(
  domains: readonly FactDomain[],
  members: readonly CompoundRiskInput[],
): WatchItem[] {
  const items: WatchItem[] = [];
  for (const d of domains) {
    const next = WATCH_ITEMS_BY_DOMAIN[d];
    if (next) items.push({ ...next, rationale: `${members.length} situation(s) in this compound touch ${d}` });
  }
  return items.slice(0, 5);
}

const WATCH_ITEMS_BY_DOMAIN: Partial<Record<FactDomain, Pick<WatchItem, 'label' | 'domain'>>> = {
  weather: { label: 'NWS warning updates / radar trends', domain: 'weather' },
  cyber: { label: 'CISA KEV additions / vendor advisories', domain: 'cyber' },
  aviation: { label: 'Airport ground stops / NOTAM updates', domain: 'aviation' },
  maritime: { label: 'AIS gaps / port-status dashboards', domain: 'maritime' },
  markets: { label: 'Crack spread + futures curve moves', domain: 'markets' },
  macro: { label: 'Central bank statements / economic data', domain: 'macro' },
  conflict: { label: 'ACLED / GDELT escalation feeds', domain: 'conflict' },
  humanitarian: { label: 'GDACS / OCHA / FEWS NET updates', domain: 'humanitarian' },
  space: { label: 'USGS / ESMC seismic feeds', domain: 'space' },
  infra: { label: 'Utility outage maps / EIA feeds', domain: 'infra' },
};

// ── Cascade pair table ─────────────────────────────────────────────────

const CASCADE_PAIRS = new Set<string>([
  'weather|infra',
  'weather|markets',
  'weather|aviation',
  'weather|maritime',
  'weather|humanitarian',
  'space|humanitarian',
  'space|maritime',
  'cyber|markets',
  'cyber|infra',
  'cyber|communications',
  'conflict|maritime',
  'conflict|markets',
  'conflict|humanitarian',
  'macro|markets',
  'infra|markets',
  'maritime|markets',
  'aviation|markets',
]);

/** Learned cascade pairs, mined from outcome history (learned-cascades.ts) and
 *  registered at runtime to AUGMENT — never replace — the deterministic table.
 *  Empty by default, so behavior is unchanged until something registers pairs. */
const LEARNED_CASCADE_PAIRS = new Set<string>();

/** Replace the learned-pair set (idempotent). Keys are "fromDomain|toDomain". */
export function registerLearnedCascadePairs(keys: Iterable<string>): void {
  LEARNED_CASCADE_PAIRS.clear();
  for (const k of keys) LEARNED_CASCADE_PAIRS.add(k);
}

export function clearLearnedCascadePairs(): void {
  LEARNED_CASCADE_PAIRS.clear();
}

function cascadePair(a: FactDomain, b: FactDomain): boolean {
  const fwd = `${a}|${b}`;
  const rev = `${b}|${a}`;
  return (
    CASCADE_PAIRS.has(fwd) || CASCADE_PAIRS.has(rev) ||
    LEARNED_CASCADE_PAIRS.has(fwd) || LEARNED_CASCADE_PAIRS.has(rev)
  );
}

// ── Headline ───────────────────────────────────────────────────────────

function buildHeadline(
  members: readonly CompoundRiskInput[],
  domains: readonly FactDomain[],
  score: number,
): string {
  if (members.length === 1) {
    return `${members[0]!.title} (compound score ${score})`;
  }
  return `Compound risk ${score}: ${members.length} situations across ${domains.length} domain${domains.length === 1 ? '' : 's'}`;
}

// ── Helpers ────────────────────────────────────────────────────────────

function uniqueDomains(items: readonly FactDomain[]): FactDomain[] {
  return [...new Set(items)];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
