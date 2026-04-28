/**
 * Personal Resilience Model — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 7.
 *
 * Pure deterministic engine that scores how PERSONALLY RELEVANT a
 * fact is to the user, separately from how true that fact is. The
 * relevance score:
 *   - rises when the fact touches a saved place, family location,
 *     travel route, watchlist asset, or infrastructure dependency
 *   - falls when the user has snoozed/dismissed similar items
 *   - is explained line-by-line so the UI can answer "why is this
 *     showing up for me?"
 *
 * Plan invariants:
 *   - Personalize relevance, NOT truth. The truth-score engine in
 *     `src/services/intelligence/truth-score.ts` is canonical for
 *     facticity. Nothing here changes a fact's confidence — it only
 *     decides whether to surface it to the user.
 *   - Pure deterministic — same inputs ⇒ same outputs.
 *   - JSON-serializable. No DOM, no fetch, no globals at import time.
 *   - All inputs are passed in explicitly so the caller controls
 *     locality. The store holding the personal model lives elsewhere
 *     (`personal-impact.ts` / `insights-state.ts` already host the
 *     PersonalProfile singleton); this module never touches that
 *     store.
 *   - Personal model NEVER goes off-device. The reset/delete API
 *     lives in the existing personal-state singletons; we expose a
 *     pure "scoreRelevance(input)" API that takes the snapshot.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type RelevanceTier = 'critical' | 'elevated' | 'watch' | 'low' | 'dormant';

export interface RelevanceReason {
  /** Stable id ("saved_place_match", "watchlist_ticker", "route_intersect", "snoozed_pattern"). */
  id: string;
  /** Human-readable explanation surfaced in the "why is this
   *  showing up for me?" panel. */
  text: string;
  /** Signed weight contribution. Positive boosts relevance,
   *  negative suppresses it. */
  weight: number;
}

export interface RelevanceScore {
  factId: string;
  /** Numeric score in [-1, 1]. Negative = "you've told us not to
   *  show this", positive = "this matters to you". Zero = no
   *  signal either way. */
  score: number;
  tier: RelevanceTier;
  reasons: readonly RelevanceReason[];
}

// ── Inputs ──────────────────────────────────────────────────────────────

export interface PersonalSnapshot {
  /** Saved place locations (lat/lon) and labels. */
  savedPlaces: readonly { id: string; label: string; latitude: number; longitude: number }[];
  /** Family / care-about places. */
  familyPlaces: readonly { id: string; label: string; latitude: number; longitude: number }[];
  /** Frequent travel routes — list of (lat,lon) waypoints. */
  travelRoutes: readonly { id: string; label: string; waypoints: readonly { latitude: number; longitude: number }[] }[];
  /** Watchlist entities (ticker, country code, ICAO hex, CVE id…). */
  watchlist: readonly { kind: string; id: string; label: string }[];
  /** Infrastructure dependencies (utility, ISP, fuel station). */
  infrastructure: readonly { kind: string; id: string; label: string; latitude?: number; longitude?: number }[];
  /** Past dismissals/snoozes of fact patterns. The matcher just
   *  checks substring inclusion against fact.entities + summary. */
  snoozedPatterns: readonly { pattern: string; reason?: string }[];
}

export interface FactForRelevance {
  /** Stable id from the truth-score / evidence layer. */
  id: string;
  /** Free-text summary the matcher scans for snoozed patterns. */
  summary: string;
  /** Optional location (lat/lon) — required for place / route / infra
   *  proximity scoring. */
  latitude?: number;
  longitude?: number;
  /** Affected entity ids (country code, ticker, ICAO hex, CVE id) — used to
   *  intersect with the watchlist. */
  entities: readonly string[];
  /** Severity 0–100 from the upstream domain — kept here only so
   *  the "critical" tier can boost when severity is real. */
  severity?: number;
}

// ── Implementation ──────────────────────────────────────────────────────

/** Distance threshold for place / family-place hits (km). */
const NEARBY_KM = 50;
/** Distance threshold for travel-route hits (km). */
const ROUTE_KM = 10;
/** Severity threshold above which we boost into critical tier. */
const SEVERITY_CRITICAL = 70;

function placeProximityReasons(
  lat: number,
  lon: number,
  places: readonly { id: string; label: string; latitude: number; longitude: number }[],
  prefix: 'saved_place' | 'family_place',
  weight: number,
): RelevanceReason[] {
  const out: RelevanceReason[] = [];
  for (const place of places) {
    const km = haversineKm(lat, lon, place.latitude, place.longitude);
    if (km <= NEARBY_KM) {
      const label = prefix === 'saved_place' ? 'saved place' : 'family location';
      out.push({
        id: `${prefix}:${place.id}`,
        text: `Near your ${label} "${place.label}" (${km.toFixed(1)} km)`,
        weight,
      });
    }
  }
  return out;
}

function routeReasons(
  lat: number,
  lon: number,
  routes: readonly { id: string; label: string; waypoints: readonly { latitude: number; longitude: number }[] }[],
): RelevanceReason[] {
  const out: RelevanceReason[] = [];
  for (const route of routes) {
    const minKm = nearestRouteKm(lat, lon, route.waypoints);
    if (minKm <= ROUTE_KM) {
      out.push({
        id: `route:${route.id}`,
        text: `On your travel route "${route.label}" (${minKm.toFixed(1)} km from path)`,
        weight: 0.4,
      });
    }
  }
  return out;
}

function infraReasons(
  lat: number,
  lon: number,
  infrastructure: readonly { kind: string; id: string; label: string; latitude?: number; longitude?: number }[],
): RelevanceReason[] {
  const out: RelevanceReason[] = [];
  for (const infra of infrastructure) {
    if (infra.latitude === undefined || infra.longitude === undefined) continue;
    const km = haversineKm(lat, lon, infra.latitude, infra.longitude);
    if (km <= NEARBY_KM) {
      out.push({
        id: `infra:${infra.id}`,
        text: `Affects your ${infra.kind} "${infra.label}" (${km.toFixed(1)} km)`,
        weight: 0.5,
      });
    }
  }
  return out;
}

function watchlistReasons(
  fact: FactForRelevance,
  watchlist: readonly { kind: string; id: string; label: string }[],
): RelevanceReason[] {
  const factEntities = new Set(fact.entities);
  return watchlist
    .filter((item) => factEntities.has(item.id))
    .map((item) => ({
      id: `watchlist:${item.id}`,
      text: `Affects your watched ${item.kind} "${item.label}"`,
      weight: 0.55,
    }));
}

function snoozeReasons(
  summary: string,
  patterns: readonly { pattern: string; reason?: string }[],
): RelevanceReason[] {
  const lower = summary.toLowerCase();
  return patterns
    .filter((s) => lower.includes(s.pattern.toLowerCase()))
    .map((s) => {
      const because = s.reason ? ` (${s.reason})` : '';
      return {
        id: `snoozed:${s.pattern}`,
        text: `You snoozed alerts matching "${s.pattern}"${because}`,
        weight: -0.5,
      };
    });
}

export function scoreRelevance(
  fact: FactForRelevance,
  snap: PersonalSnapshot,
): RelevanceScore {
  const reasons: RelevanceReason[] = [];

  if (fact.latitude !== undefined && fact.longitude !== undefined) {
    const { latitude: lat, longitude: lon } = fact;
    reasons.push(
      ...placeProximityReasons(lat, lon, snap.savedPlaces, 'saved_place', 0.6),
      ...placeProximityReasons(lat, lon, snap.familyPlaces, 'family_place', 0.55),
      ...routeReasons(lat, lon, snap.travelRoutes),
      ...infraReasons(lat, lon, snap.infrastructure),
    );
  }

  reasons.push(
    ...watchlistReasons(fact, snap.watchlist),
    ...snoozeReasons(fact.summary, snap.snoozedPatterns),
  );

  // Severity boost — only fires when there's already a personal
  // signal; we don't want truth-side severity alone to make
  // something "personally critical".
  const positiveCount = reasons.filter((r) => r.weight > 0).length;
  if (
    positiveCount > 0 &&
    fact.severity !== undefined &&
    fact.severity >= SEVERITY_CRITICAL
  ) {
    reasons.push({
      id: 'severity_boost',
      text: `High severity (${fact.severity}/100)`,
      weight: 0.2,
    });
  }

  const totalWeight = reasons.reduce((sum, r) => sum + r.weight, 0);
  const score = clamp(totalWeight, -1, 1);
  return {
    factId: fact.id,
    score,
    tier: bucketTier(score, fact.severity),
    reasons,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function bucketTier(score: number, severity: number | undefined): RelevanceTier {
  if (score < 0) return 'dormant';
  if (score >= 0.8 && (severity ?? 0) >= SEVERITY_CRITICAL) return 'critical';
  if (score >= 0.6) return 'elevated';
  if (score >= 0.3) return 'watch';
  if (score > 0) return 'low';
  return 'dormant';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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

function nearestRouteKm(
  lat: number,
  lon: number,
  waypoints: readonly { latitude: number; longitude: number }[],
): number {
  let min = Infinity;
  for (const wp of waypoints) {
    const km = haversineKm(lat, lon, wp.latitude, wp.longitude);
    if (km < min) min = km;
  }
  return min;
}

// ── Convenience helpers for the diagnostic surface ──────────────────────

/** Whether the fact has any personal relevance signal at all
 *  (positive OR negative). */
export function hasPersonalSignal(score: RelevanceScore): boolean {
  return score.reasons.length > 0;
}

/** The single line the UI shows under the alert ("Why am I seeing
 *  this?"). Picks the highest-weight reason. */
export function topRelevanceReason(score: RelevanceScore): string | undefined {
  if (score.reasons.length === 0) return undefined;
  const sorted = [...score.reasons].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return sorted[0]?.text;
}
