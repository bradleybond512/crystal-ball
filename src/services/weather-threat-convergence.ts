/**
 * Weather-Threat Convergence Detection
 *
 * Detects when severe weather events overlap geographically with existing
 * conflict, infrastructure, or other threat signals — creating compound
 * risk scenarios that are qualitatively worse than either hazard alone.
 *
 * Examples:
 *  - Extreme heat wave over a region already suffering power-grid stress
 *  - Hurricane making landfall in an active conflict zone
 *  - Flooding near industrial facilities or disease outbreak areas
 *  - Wildfire smoke compounding an existing air-quality emergency
 *
 * The service cross-references NWS weather alerts against the unified alert
 * store, applies domain-specific interaction rules, and produces scored
 * convergence entries for the dashboard.
 *
 * State: module-level cache with 5-minute TTL.
 */

import type { WeatherAlert } from './weather';
import type { UnifiedAlert, AlertSource } from './unified-alerts';
import { unifiedAlertStore } from './unified-alerts';
import { classifyRegion, type MatrixRegion } from './correlation-matrix';
import { haversineKm } from './proximity-filter';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeatherThreatConvergence {
  id: string;
  weatherAlert: { id: string; event: string; severity: string; headline: string };
  collocatedThreats: { id: string; source: string; title: string; severity: string }[];
  region: MatrixRegion | null;
  lat: number;
  lon: number;
  convergenceScore: number; // 0-100
  riskMultiplier: number;   // 1.0-3.0
  description: string;
  detectedAt: number;
}

type WeatherCategory =
  | 'extreme_heat'
  | 'winter_storm'
  | 'tornado'
  | 'hurricane'
  | 'flood'
  | 'wildfire'
  | 'thunderstorm'
  | 'drought'
  | 'general';

interface WeatherThreatRule {
  weatherCategory: WeatherCategory;
  /** Alert source to match, or 'any' for a catch-all rule */
  threatSource: AlertSource | 'any';
  description: string;
  multiplier: number;
}

// ── Interaction Rules ─────────────────────────────────────────────────────────

const WEATHER_THREAT_RULES: WeatherThreatRule[] = [
  { weatherCategory: 'extreme_heat', threatSource: 'power-grid',    description: 'Heat wave straining power grid — blackout risk',                    multiplier: 2.5 },
  { weatherCategory: 'extreme_heat', threatSource: 'disease',       description: 'Extreme heat compounding health crisis',                            multiplier: 2 },
  { weatherCategory: 'hurricane',    threatSource: 'correlation',   description: 'Tropical storm in active conflict zone — humanitarian crisis',      multiplier: 2.5 },
  { weatherCategory: 'hurricane',    threatSource: 'power-grid',    description: 'Tropical system threatening grid infrastructure',                   multiplier: 2 },
  { weatherCategory: 'winter_storm', threatSource: 'power-grid',    description: 'Winter storm threatening heating infrastructure',                   multiplier: 2 },
  { weatherCategory: 'winter_storm', threatSource: 'comms-health',  description: 'Winter storm disrupting communications',                            multiplier: 1.8 },
  { weatherCategory: 'tornado',      threatSource: 'any',           description: 'Tornado activity with concurrent threat',                           multiplier: 1.5 },
  { weatherCategory: 'flood',        threatSource: 'hazard',        description: 'Flooding near industrial facility',                                 multiplier: 2.5 },
  { weatherCategory: 'flood',        threatSource: 'disease',       description: 'Flooding compounding disease outbreak — waterborne risk',           multiplier: 2 },
  { weatherCategory: 'wildfire',     threatSource: 'air-quality',   description: 'Wildfire smoke emergency',                                          multiplier: 2 },
  { weatherCategory: 'drought',      threatSource: 'resource',      description: 'Drought accelerating food insecurity',                              multiplier: 2 },
];

// ── Weather Category Mapping ──────────────────────────────────────────────────

const HEAT_KEYWORDS = ['heat', 'excessive heat', 'heat advisory'];
const WINTER_KEYWORDS = ['winter storm', 'blizzard', 'ice storm', 'winter weather', 'freezing rain', 'frost'];
const TORNADO_KEYWORDS = ['tornado'];
const HURRICANE_KEYWORDS = ['hurricane', 'tropical storm', 'typhoon', 'tropical depression', 'cyclone'];
const FLOOD_KEYWORDS = ['flash flood', 'flood', 'coastal flood', 'river flood', 'urban flood'];
const WILDFIRE_KEYWORDS = ['red flag', 'fire weather', 'wildfire'];
const THUNDERSTORM_KEYWORDS = ['severe thunderstorm'];
const DROUGHT_KEYWORDS = ['drought'];

/**
 * Map an NWS event string to a broad weather category for rule matching.
 */
export function categorizeWeatherEvent(event: string): WeatherCategory {
  const lower = event.toLowerCase();

  // Order matters — check more specific keywords before generic ones
  if (TORNADO_KEYWORDS.some(k => lower.includes(k)))       return 'tornado';
  if (HURRICANE_KEYWORDS.some(k => lower.includes(k)))     return 'hurricane';
  if (FLOOD_KEYWORDS.some(k => lower.includes(k)))         return 'flood';
  if (WILDFIRE_KEYWORDS.some(k => lower.includes(k)))      return 'wildfire';
  if (THUNDERSTORM_KEYWORDS.some(k => lower.includes(k)))  return 'thunderstorm';
  if (DROUGHT_KEYWORDS.some(k => lower.includes(k)))       return 'drought';
  if (HEAT_KEYWORDS.some(k => lower.includes(k)))          return 'extreme_heat';
  if (WINTER_KEYWORDS.some(k => lower.includes(k)))        return 'winter_storm';

  return 'general';
}

// ── Severity Scoring ──────────────────────────────────────────────────────────

const SEVERITY_BASE_SCORE: Record<string, number> = {
  Extreme:  90,
  Severe:   70,
  Moderate: 50,
  Minor:    30,
  Unknown:  20,
};

// ── Module-level Cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RESULTS = 20;
const COLLOCATION_RADIUS_KM = 500;

let cachedConvergences: WeatherThreatConvergence[] = [];
let cacheTimestamp = 0;

// ── Core Detection ────────────────────────────────────────────────────────────

/**
 * Find the best matching rule for a weather category + threat source pair.
 * Returns null if no rule matches.
 */
function findMatchingRule(
  category: WeatherCategory,
  threatSource: AlertSource,
): WeatherThreatRule | null {
  // First try an exact category + source match
  const exact = WEATHER_THREAT_RULES.find(
    r => r.weatherCategory === category && r.threatSource === threatSource,
  );
  if (exact) return exact;

  // Fall back to a catch-all rule for this weather category
  const catchAll = WEATHER_THREAT_RULES.find(
    r => r.weatherCategory === category && r.threatSource === 'any',
  );
  return catchAll ?? null;
}

/**
 * Detect convergence between active weather alerts and threat signals.
 *
 * For each weather alert that has a geographic centroid, the function
 * scans all current unified alerts within a 500 km radius, checks the
 * weather-threat rule table, and emits scored convergence entries.
 *
 * Results are sorted by convergenceScore descending and capped at 20.
 */
function findNearbyThreats(
  wxLat: number,
  wxLon: number,
  allThreats: UnifiedAlert[],
): UnifiedAlert[] {
  const nearby: UnifiedAlert[] = [];
  for (const threat of allThreats) {
    if (!threat.location) continue;
    const dist = haversineKm(wxLat, wxLon, threat.location.lat, threat.location.lon);
    if (dist <= COLLOCATION_RADIUS_KM) nearby.push(threat);
  }
  return nearby;
}

function selectBestMatch(
  category: WeatherCategory,
  threats: UnifiedAlert[],
): { rule: WeatherThreatRule; matched: UnifiedAlert[] } | null {
  let bestRule: WeatherThreatRule | null = null;
  const matchedThreats: UnifiedAlert[] = [];
  for (const threat of threats) {
    const rule = findMatchingRule(category, threat.source);
    if (!rule) continue;
    matchedThreats.push(threat);
    if (!bestRule || rule.multiplier > bestRule.multiplier) bestRule = rule;
  }
  if (!bestRule || matchedThreats.length === 0) return null;
  return { rule: bestRule, matched: matchedThreats };
}

function buildConvergence(
  wx: WeatherAlert,
  wxLat: number,
  wxLon: number,
  matched: UnifiedAlert[],
  rule: WeatherThreatRule,
  now: number,
): WeatherThreatConvergence {
  const baseSeverity = SEVERITY_BASE_SCORE[wx.severity] ?? 20;
  const convergenceScore = Math.min(100, Math.round(baseSeverity * rule.multiplier));
  return {
    id: `wtc-${wx.id}-${now}`,
    weatherAlert: { id: wx.id, event: wx.event, severity: wx.severity, headline: wx.headline },
    collocatedThreats: matched.map(t => ({ id: t.id, source: t.source, title: t.title, severity: t.severity })),
    region: classifyRegion(wxLat, wxLon),
    lat: wxLat,
    lon: wxLon,
    convergenceScore,
    riskMultiplier: rule.multiplier,
    description: rule.description,
    detectedAt: now,
  };
}

export function detectWeatherThreatConvergence(
  weatherAlerts: WeatherAlert[],
): WeatherThreatConvergence[] {
  const now = Date.now();
  const allThreats: UnifiedAlert[] = unifiedAlertStore.getAll();
  const convergences: WeatherThreatConvergence[] = [];

  for (const wx of weatherAlerts) {
    if (!wx.centroid) continue;
    const [wxLat, wxLon] = wx.centroid;
    const category = categorizeWeatherEvent(wx.event);
    if (category === 'general') continue;

    const nearby = findNearbyThreats(wxLat, wxLon, allThreats);
    if (nearby.length === 0) continue;

    const match = selectBestMatch(category, nearby);
    if (!match) continue;

    convergences.push(buildConvergence(wx, wxLat, wxLon, match.matched, match.rule, now));
  }

  // Sort by score descending, cap at MAX_RESULTS
  convergences.sort((a, b) => b.convergenceScore - a.convergenceScore);
  const results = convergences.slice(0, MAX_RESULTS);

  // Update cache
  cachedConvergences = results;
  cacheTimestamp = now;

  return results;
}

// ── Public Accessors ──────────────────────────────────────────────────────────

/**
 * Return the most recently computed convergences.
 * If the cache has expired (>5 min), returns an empty array — callers
 * should invoke detectWeatherThreatConvergence() to refresh.
 */
export function getActiveConvergences(): WeatherThreatConvergence[] {
  if (Date.now() - cacheTimestamp > CACHE_TTL_MS) {
    return [];
  }
  return cachedConvergences;
}
