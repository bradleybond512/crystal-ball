/**
 * Watchlist relevance engine — per
 * docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 7 (lines 592-605).
 *
 * Uses the user's context (saved places, watched countries, watched
 * companies, portfolio tickers, travel plans) to rank intelligence
 * for personal impact.
 *
 * Outputs:
 *   - relevance score (0-100)
 *   - personal impact label
 *   - local notification threshold
 *   - user feedback loop
 *
 * Pure deterministic. No DOM, no fetch.
 *
 * Plan invariants:
 *   - "Should I care?" filter must be answerable from this layer.
 *   - Notification thresholds must adapt to user feedback over time.
 */

import type { FactDomain } from './types';

// ── User context ─────────────────────────────────────────────────────────

export interface SavedPlace {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Optional radius (km) for explicit "near" semantics. Defaults to
   *  100 km when computing distance-based relevance. */
  radiusKm?: number;
}

export interface WatchedAsset {
  /** Free-form id — ticker ("AAPL"), commodity ("wheat"), CVE
   *  ("CVE-2026-1234"), country ("UA"). */
  id: string;
  /** Higher = more important to the user (1-10). Defaults to 5. */
  weight?: number;
}

export interface UserContext {
  savedPlaces?: readonly SavedPlace[];
  /** ISO 3166-1 alpha-2 country codes the user actively watches. */
  watchedCountries?: readonly string[];
  /** Company tickers / asset ids in the user's portfolio. */
  portfolio?: readonly WatchedAsset[];
  /** Generic free-form watchlist (CVEs, vessels, callsigns). */
  watchlist?: readonly WatchedAsset[];
  /** Travel plans: future trips with destinations + window. */
  travelPlans?: readonly TravelPlan[];
  /** Domains the user explicitly cares about (per personalized
   *  preferences). When empty, all domains are treated equally. */
  preferredDomains?: readonly FactDomain[];
  /** Domains the user has muted. Their relevance is heavily penalized. */
  mutedDomains?: readonly FactDomain[];
}

export interface TravelPlan {
  destinations: readonly string[];
  /** ms timestamp window when the user expects to be there. */
  startMs: number;
  endMs: number;
}

// ── Item we evaluate ─────────────────────────────────────────────────────

export interface RelevanceItem {
  id: string;
  domain: FactDomain;
  /** Free-text title for the impact line. */
  title: string;
  /** 0-100 underlying severity / risk score. */
  severityScore: number;
  /** Country / asset / CVE / etc. ids the item touches. */
  entities: readonly string[];
  /** Optional centroid for spatial proximity scoring. */
  centroid?: { lat: number; lon: number };
  /** Optional time window the item is active. When set, travel-plan
   *  overlap is checked. */
  activeFrom?: number;
  activeUntil?: number;
}

// ── Output ───────────────────────────────────────────────────────────────

export type PersonalImpact = 'none' | 'low' | 'moderate' | 'high' | 'direct';

export interface RelevanceContribution {
  reason: string;
  /** 0-100 contribution to the relevance score. */
  weight: number;
}

export interface RelevanceResult {
  itemId: string;
  /** 0-100 relevance score. */
  score: number;
  impact: PersonalImpact;
  contributions: RelevanceContribution[];
  /** Whether the score crosses the notification threshold (which itself
   *  is feedback-adjusted). */
  shouldNotify: boolean;
  /** Plain-text "Should I care?" answer. */
  shouldICare: string;
}

// ── User feedback (lightweight) ─────────────────────────────────────────

/** Per-domain feedback nudges. Positive value = user found notifications
 *  in this domain valuable; negative = user dismissed too many. */
export interface FeedbackState {
  domainNudges: Partial<Record<FactDomain, number>>;
}

export function applyFeedback(
  state: FeedbackState,
  domain: FactDomain,
  signal: 'helpful' | 'dismissed' | 'muted',
): FeedbackState {
  const next: FeedbackState = { domainNudges: { ...state.domainNudges } };
  const current = next.domainNudges[domain] ?? 0;
  if (signal === 'helpful') next.domainNudges[domain] = clamp(-30, 30, current + 5);
  if (signal === 'dismissed') next.domainNudges[domain] = clamp(-30, 30, current - 3);
  if (signal === 'muted') next.domainNudges[domain] = -30;
  return next;
}

// ── Top-level scorer ────────────────────────────────────────────────────

export interface RelevanceOptions {
  /** Default notification threshold (0-100). User feedback adjusts
   *  per-domain thresholds around this. Default 60. */
  notificationThresholdBase?: number;
  /** Defaults to Date.now(). Inject for tests. */
  now?: number;
}

const EMPTY_FEEDBACK: FeedbackState = Object.freeze({ domainNudges: {} });

export function scoreRelevance(
  item: RelevanceItem,
  user: UserContext,
  feedback: FeedbackState = EMPTY_FEEDBACK,
  options: RelevanceOptions = {},
): RelevanceResult {
  const opts = {
    notificationThresholdBase: options.notificationThresholdBase ?? 60,
    now: options.now ?? Date.now(),
  };

  const contributions: RelevanceContribution[] = [ { reason: `Severity ${item.severityScore}`, weight: item.severityScore * 0.5 }];
  // Severity baseline.

  addPlaceContribution(contributions, item, user.savedPlaces ?? []);
  addCountryContribution(contributions, item, user.watchedCountries ?? []);
  addPortfolioContribution(contributions, item, user.portfolio ?? []);
  addWatchlistContribution(contributions, item, user.watchlist ?? []);
  addTravelContribution(contributions, item, user.travelPlans ?? []);
  addDomainPreferenceContribution(contributions, item, user);

  // Sum + clamp.
  const rawScore = contributions.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(clamp(0, 100, rawScore));

  // Threshold adjusted by feedback nudge.
  const nudge = feedback.domainNudges[item.domain] ?? 0;
  const threshold = clamp(20, 95, opts.notificationThresholdBase - nudge);
  const shouldNotify = score >= threshold && !(user.mutedDomains ?? []).includes(item.domain);
  const impact = labelFor(score);

  return {
    itemId: item.id,
    score,
    impact,
    contributions,
    shouldNotify,
    shouldICare: buildShouldICare(item, score, contributions, shouldNotify),
  };
}

// ── Per-axis contributions ──────────────────────────────────────────────

function addPlaceContribution(
  contributions: RelevanceContribution[],
  item: RelevanceItem,
  places: readonly SavedPlace[],
): void {
  if (!item.centroid || places.length === 0) return;
  let bestKm = Number.POSITIVE_INFINITY;
  let bestPlace: SavedPlace | undefined;
  for (const p of places) {
    const km = haversineKm(p.lat, p.lon, item.centroid.lat, item.centroid.lon);
    if (km < bestKm) {
      bestKm = km;
      bestPlace = p;
    }
  }
  if (!bestPlace) return;
  const radius = bestPlace.radiusKm ?? 100;
  if (bestKm <= radius * 0.5) {
    contributions.push({ reason: `${bestKm.toFixed(0)} km from ${bestPlace.label}`, weight: 30 });
  } else if (bestKm <= radius) {
    contributions.push({ reason: `${bestKm.toFixed(0)} km from ${bestPlace.label}`, weight: 18 });
  } else if (bestKm <= radius * 2) {
    contributions.push({ reason: `${bestKm.toFixed(0)} km from ${bestPlace.label}`, weight: 8 });
  }
}

function addCountryContribution(
  contributions: RelevanceContribution[],
  item: RelevanceItem,
  watched: readonly string[],
): void {
  const hits = item.entities.filter((e) => watched.includes(e));
  if (hits.length === 0) return;
  contributions.push({ reason: `Watched ${hits.join(', ')}`, weight: 20 });
}

function addPortfolioContribution(
  contributions: RelevanceContribution[],
  item: RelevanceItem,
  portfolio: readonly WatchedAsset[],
): void {
  for (const asset of portfolio) {
    if (item.entities.includes(asset.id)) {
      const w = (asset.weight ?? 5) * 3; // scale: weight 5 = 15 pts
      contributions.push({ reason: `Portfolio: ${asset.id}`, weight: w });
    }
  }
}

function addWatchlistContribution(
  contributions: RelevanceContribution[],
  item: RelevanceItem,
  watchlist: readonly WatchedAsset[],
): void {
  for (const asset of watchlist) {
    if (item.entities.includes(asset.id)) {
      const w = (asset.weight ?? 5) * 2;
      contributions.push({ reason: `Watchlist: ${asset.id}`, weight: w });
    }
  }
}

function addTravelContribution(
  contributions: RelevanceContribution[],
  item: RelevanceItem,
  plans: readonly TravelPlan[],
): void {
  const itemFrom = item.activeFrom ?? 0;
  const itemTo = item.activeUntil ?? Number.POSITIVE_INFINITY;
  for (const plan of plans) {
    const overlapWindow = itemFrom <= plan.endMs && itemTo >= plan.startMs;
    if (!overlapWindow) continue;
    const overlapDest = item.entities.some((e) => plan.destinations.includes(e));
    if (overlapDest) {
      contributions.push({
        reason: `Travel: ${plan.destinations.join(', ')}`,
        weight: 25,
      });
    }
  }
}

function addDomainPreferenceContribution(
  contributions: RelevanceContribution[],
  item: RelevanceItem,
  user: UserContext,
): void {
  if (user.mutedDomains?.includes(item.domain)) {
    contributions.push({ reason: `Domain muted: ${item.domain}`, weight: -40 });
    return;
  }
  if (user.preferredDomains?.includes(item.domain)) {
    contributions.push({ reason: `Preferred domain: ${item.domain}`, weight: 8 });
  }
}

// ── Labels + explanations ───────────────────────────────────────────────

function labelFor(score: number): PersonalImpact {
  if (score >= 80) return 'direct';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 20) return 'low';
  return 'none';
}

function buildShouldICare(
  item: RelevanceItem,
  score: number,
  contributions: readonly RelevanceContribution[],
  shouldNotify: boolean,
): string {
  if (score < 20) {
    return `Low personal exposure to "${item.title}" — keep monitoring`;
  }
  const top = [...contributions]
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((c) => c.reason);
  const verdict = shouldNotify ? 'Yes' : 'Probably yes';
  return `${verdict}: ${top.join(' + ')}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
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
