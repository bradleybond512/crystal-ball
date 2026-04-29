/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Personal Exposure Graph — Phase 2 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Aggregates the user's "world" — saved places, watchlisted countries
 * / companies / sectors, current device OS — into a single read-only
 * structure that adapters score situations against.
 *
 * Pure deterministic. No DOM, no fetch. Adapters call
 * `scoreExposure()` to get a (score, reasons) breakdown, replacing
 * Phase 1's adapter-internal radial-distance heuristics.
 *
 * The graph is fed by the host loop via `setExposureGraph(...)` —
 * this module is type+score logic only, no global state at import
 * time except a singleton accessor for app code to read.
 */

import type { CyberSector } from './cyber-adapter';

// ── Public API ──────────────────────────────────────────────────────────

export interface ExposureSavedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Tags from the saved-places module — 'home', 'work', 'family',
   *  etc. Used for prioritization (home > work > travel). */
  tags: readonly string[];
  /** Whether this is the user's primary place. */
  primary: boolean;
}

export interface ExposureWatchlist {
  /** ISO 3166-1 alpha-3 codes. */
  countries: readonly string[];
  /** Free-form sector tags ('finance', 'power_grid', 'consumer_software', ...). */
  sectors: readonly string[];
  /** Stock tickers. */
  tickers: readonly string[];
  /** Vendor names — 'Apple', 'Microsoft', etc. — for cyber matching. */
  vendors: readonly string[];
  /** CVE ids the user has explicitly flagged. */
  cves: readonly string[];
}

export interface ExposureDevice {
  /** OS labels the user runs — 'macOS', 'iOS', 'Windows', 'Linux'. */
  osLabels: readonly string[];
  /** Major-version hints for cyber matching ('macOS 14', 'iOS 17'). */
  versions: readonly string[];
}

export interface ExposureGraph {
  savedPlaces: readonly ExposureSavedPlace[];
  watchlist: ExposureWatchlist;
  device: ExposureDevice;
  /** Optional current location for "near me" exposure. */
  currentLocation?: { lat: number; lon: number };
}

/** Score with reasons breakdown — consumed by adapters. */
export interface ExposureScore {
  /** 0..1 raw exposure score. */
  score: number;
  /** Plain-English reasons exposure is non-zero, sorted by weight. */
  reasons: readonly string[];
  /** Per-rule score contributions for the diagnostics trace. */
  contributions: Readonly<Record<string, number>>;
}

// ── Singleton wiring ────────────────────────────────────────────────────

const EMPTY_GRAPH: ExposureGraph = {
  savedPlaces: [],
  watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] },
  device: { osLabels: [], versions: [] },
};

let currentGraph: ExposureGraph = EMPTY_GRAPH;

/** Host loop calls this to install the user's exposure data. The
 *  graph is replaced wholesale — no merging — so callers should
 *  always pass the complete current state. */
export function setExposureGraph(graph: ExposureGraph): void {
  currentGraph = graph;
}

/** Read the current graph. Adapters call this when score functions
 *  weren't given an explicit graph parameter. */
export function getExposureGraph(): ExposureGraph {
  return currentGraph;
}

/** Reset to empty. Tests + storybook only. */
export function resetExposureGraphForTests(): void {
  currentGraph = EMPTY_GRAPH;
}

// ── Geo exposure scoring ────────────────────────────────────────────────

/** Compute exposure for a geographic event — weather alert, military
 *  theater, regional cyber outage. Caller passes the event's centroid
 *  (or current location); the helper finds the closest saved place /
 *  current-location and grades exposure on a haversine-distance ladder.
 *
 *  Bands (km radius from the event centroid):
 *    < 25 km  → severe (0.95)
 *    < 80 km  → high   (0.6)
 *    < 200 km → medium (0.25)
 *    further  → low    (0.1)
 *  Home/primary saved place adds +0.05 to the band score (capped at 1).
 *  Currentlocation match wins over saved-place match by 0.05.
 */
export function scoreGeoExposure(
  centroid: { lat: number; lon: number } | undefined,
  graph: ExposureGraph = currentGraph,
): ExposureScore {
  if (!centroid) {
    return {
      score: 0.1,
      reasons: [],
      contributions: { 'no-centroid': 0.1 },
    };
  }

  const reasons: string[] = [];
  const contributions: Record<string, number> = {};
  let score = 0.1;

  // Saved places — find the closest match, prefer home/primary.
  for (const place of graph.savedPlaces) {
    const km = haversineKm(centroid.lat, centroid.lon, place.lat, place.lon);
    const band = bandFromKm(km);
    if (band === 0) continue;
    const isPrimary = place.primary || place.tags.includes('home');
    const placeScore = Math.min(1, band + (isPrimary ? 0.05 : 0));
    if (placeScore > score) {
      score = placeScore;
      const km100 = Math.round(km * 10) / 10;
      const tagLabel = place.tags[0] ? ` (${place.tags[0]})` : '';
      reasons.unshift(`${place.name}${tagLabel} ${km100} km from event`);
      contributions[`place:${place.id}`] = placeScore;
    } else if (band >= 0.6) {
      // Still record secondary nearby places as additional reasons.
      const km100 = Math.round(km * 10) / 10;
      reasons.push(`${place.name} ${km100} km from event`);
    }
  }

  // Current location — the user is literally there. Wins ties with
  // saved places (>=) since "I'm at this exact spot" is more
  // actionable than "this is one of my saved places."
  if (graph.currentLocation) {
    const km = haversineKm(centroid.lat, centroid.lon, graph.currentLocation.lat, graph.currentLocation.lon);
    const band = bandFromKm(km);
    if (band > 0) {
      const liveScore = Math.min(1, band + 0.05);
      if (liveScore >= score) {
        score = liveScore;
        const km100 = Math.round(km * 10) / 10;
        reasons.unshift(`Current location ${km100} km from event`);
        contributions['current-location'] = liveScore;
      }
    }
  }

  return {
    score,
    reasons: reasons.slice(0, 5),
    contributions,
  };
}

// ── Cyber exposure scoring ──────────────────────────────────────────────

export interface CyberExposureInput {
  affectedVendors: readonly string[];
  affectedSectors: readonly CyberSector[];
  cveId?: string;
}

/** Compute exposure for a cyber threat — match affected vendors
 *  against the user's device OS, affected sectors against the
 *  watchlist, and CVE id against any explicitly-flagged CVEs. */
export function scoreCyberExposure(
  input: CyberExposureInput,
  graph: ExposureGraph = currentGraph,
): ExposureScore {
  const reasons: string[] = [];
  const contributions: Record<string, number> = {};
  let score = 0.1;

  // Vendor / OS match — strongest signal.
  const userOs = graph.device.osLabels.map((s) => s.toLowerCase());
  const userVendors = graph.watchlist.vendors.map((s) => s.toLowerCase());
  const matchedVendor = input.affectedVendors.find((v) => {
    const lower = v.toLowerCase();
    return userOs.some((o) => lower.includes(o)) || userVendors.some((u) => lower.includes(u));
  });
  if (matchedVendor) {
    score = Math.max(score, 0.85);
    reasons.unshift(`Affected vendor ${matchedVendor} matches your OS / watched vendors`);
    contributions['vendor-match'] = 0.85;
  }

  // Sector match — medium signal.
  const watchedSectors = new Set(graph.watchlist.sectors);
  const matchedSector = input.affectedSectors.find((s) => watchedSectors.has(s));
  if (matchedSector) {
    score = Math.max(score, 0.6);
    reasons.push(`Affected sector ${matchedSector} is on your watchlist`);
    contributions['sector-match'] = 0.6;
  }

  // CVE id match — explicit flag → severe.
  if (input.cveId && graph.watchlist.cves.includes(input.cveId)) {
    score = 1;
    reasons.unshift(`CVE ${input.cveId} is on your watchlist`);
    contributions['cve-match'] = 1;
  }

  return {
    score,
    reasons,
    contributions,
  };
}

// ── Country exposure scoring ────────────────────────────────────────────

/** Compute exposure for a country-tagged event (military theater,
 *  diplomatic incident, etc.). */
export function scoreCountryExposure(
  countries: readonly string[],
  graph: ExposureGraph = currentGraph,
): ExposureScore {
  if (countries.length === 0) {
    return { score: 0.1, reasons: [], contributions: {} };
  }
  const watched = new Set(graph.watchlist.countries.map((c) => c.toUpperCase()));
  const matched = countries.filter((c) => watched.has(c.toUpperCase()));
  if (matched.length === 0) {
    return { score: 0.1, reasons: [], contributions: { 'no-country-match': 0.1 } };
  }
  // Multiple matches → higher exposure.
  const score = Math.min(0.85, 0.5 + 0.1 * matched.length);
  return {
    score,
    reasons: matched.map((c) => `${c} is on your country watchlist`),
    contributions: { 'country-match': score },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function bandFromKm(km: number): number {
  if (km < 25) return 0.95;
  if (km < 80) return 0.6;
  if (km < 200) return 0.25;
  return 0;
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

/** Convenience: convert raw exposure score to the personalImpact level. */
export function exposureToLevel(score: number): 'none' | 'low' | 'medium' | 'high' | 'severe' {
  if (score >= 0.85) return 'severe';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'medium';
  if (score >= 0.15) return 'low';
  return 'none';
}
