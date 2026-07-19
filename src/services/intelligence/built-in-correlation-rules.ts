/**
 * Built-in correlation rules — the 8 cross-domain joins Crystal Ball
 * ships with out of the box.
 *
 * Each rule combines a time window with one of three matchers:
 *   - haversine distance between event coordinates
 *   - shared country / state tag (via entityIds[])
 *   - tag-based content match
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';
import type { CorrelationRule } from './correlate-engine';
import { haversineKm } from '../proximity-filter';

// ── Match helpers ────────────────────────────────────────────────────

function withinDistance(a: ObservationEvent, b: ObservationEvent, km: number): boolean {
  if (!a.location || !b.location) return false;
  return haversineKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon) <= km;
}

function shareEntity(a: ObservationEvent, b: ObservationEvent): boolean {
  const aIds = a.entityIds ?? [];
  const bIds = b.entityIds ?? [];
  if (aIds.length === 0 || bIds.length === 0) return false;
  const setB = new Set(bIds);
  return aIds.some((id) => setB.has(id));
}

function hasTag(event: ObservationEvent, tag: string): boolean {
  return event.tags.includes(tag);
}

function hasAnyTag(event: ObservationEvent, tags: readonly string[]): boolean {
  return tags.some((t) => event.tags.includes(t));
}

function fromSource(event: ObservationEvent, sourceId: string): boolean {
  return event.sourceId === sourceId;
}

function isMajorEarthquake(event: ObservationEvent, minMag: number): boolean {
  if (event.sourceId !== 'usgs-earthquake') return false;
  if (minMag >= 6.5 && !hasTag(event, 'major-earthquake')) return false;
  // Severity ladder set by the earthquake adapter: M≥5 = MEDIUM, M≥6 =
  // HIGH, M≥7 = CRITICAL. minMag=5 → MEDIUM+, minMag=6.5 → HIGH+.
  if (minMag >= 6.5) return event.severity === 'HIGH' || event.severity === 'CRITICAL';
  if (minMag >= 5) {
    return event.severity === 'MEDIUM' || event.severity === 'HIGH' || event.severity === 'CRITICAL';
  }
  return true;
}

// ── 1. Earthquake → Tsunami ──────────────────────────────────────────

export const earthquakeTsunamiRule: CorrelationRule = {
  id: 'earthquake-tsunami',
  name: 'Earthquake → ocean event',
  description: 'M≥6.5 seismic event followed by a GDACS ocean hazard within 60 min and 800 km.',
  domains: ['weather', 'humanitarian'],
  timeWindowMs: 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => {
    if (!isMajorEarthquake(a, 6.5)) return false;
    if (!fromSource(b, 'gdacs-alerts')) return false;
    return withinDistance(a, b, 800);
  },
};

// ── 2. Earthquake → Infrastructure damage ────────────────────────────

export const earthquakeInfrastructureRule: CorrelationRule = {
  id: 'earthquake-infrastructure',
  name: 'Earthquake → infrastructure incident',
  description: 'M≥5 seismic event + CISA infrastructure advisory within 4h and 500km.',
  domains: ['weather', 'infra'],
  timeWindowMs: 4 * 60 * 60 * 1000,
  edgeType: 'co-located',
  matchFn: (a, b) => {
    if (!isMajorEarthquake(a, 5)) return false;
    if (!fromSource(b, 'cisa-infrastructure')) return false;
    return withinDistance(a, b, 500);
  },
};

// ── 3. Weather (red-flag) → Wildfire ─────────────────────────────────

export const weatherWildfireRule: CorrelationRule = {
  id: 'weather-wildfire',
  name: 'Red-flag → wildfire',
  description: 'NWS red-flag warning + NIFC wildfire sharing a state within 24h.',
  domains: ['weather'],
  timeWindowMs: 24 * 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => {
    const aRedFlag = fromSource(a, 'nws-alerts') && hasAnyTag(a, ['red-flag-warning', 'fire-weather-watch']);
    const bWildfire = fromSource(b, 'inciweb-wildfire') || hasTag(b, 'wildfire');
    if (!aRedFlag || !bWildfire) return false;
    return shareEntity(a, b);
  },
};

// ── 3b. Air quality (AirNow) → wildfire (FIRMS) — visual smoke confirmation ──

export const airQualityWildfireRule: CorrelationRule = {
  id: 'airquality-wildfire',
  name: 'Unhealthy air ↔ nearby wildfire',
  description: 'AirNow Unhealthy AQI / Action Day within 150km of an active FIRMS/NIFC fire — a fire likely explains the smoke.',
  domains: ['weather'],
  timeWindowMs: 24 * 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => {
    const aSmokeRelevant = fromSource(a, 'airnow') && hasTag(a, 'smoke-relevant');
    const bWildfire = hasTag(b, 'wildfire') || fromSource(b, 'inciweb-wildfire');
    if (!aSmokeRelevant || !bWildfire) return false;
    // Air quality ↔ fire is spatial (smoke drifts), not entity-shared.
    return withinDistance(a, b, 150);
  },
};

// ── 4. Biosurveillance → Aviation traffic ────────────────────────────

export const biosurvAviationRule: CorrelationRule = {
  id: 'biosurv-aviation',
  name: 'Biosurveillance → aviation traffic',
  description: 'CDC biosurveillance spike + aviation traffic near the same city within 72h.',
  domains: ['humanitarian', 'aviation'],
  timeWindowMs: 72 * 60 * 60 * 1000,
  edgeType: 'temporally-adjacent',
  matchFn: (a, b) => {
    if (!fromSource(a, 'cdc-biosurveillance')) return false;
    if (!fromSource(b, 'aviation-track')) return false;
    return withinDistance(a, b, 500);
  },
};

// ── 5. Sanctions → Maritime AIS ──────────────────────────────────────

export const sanctionsMaritimeRule: CorrelationRule = {
  id: 'sanctions-maritime',
  name: 'OFAC → AIS vessel',
  description: 'OFAC SDN entry shares an entity id (MMSI / vessel name) with an AIS observation within 12h.',
  domains: ['macro', 'maritime'],
  timeWindowMs: 12 * 60 * 60 * 1000,
  edgeType: 'co-located',
  matchFn: (a, b) => {
    if (!fromSource(a, 'ofac-sanctions')) return false;
    if (!fromSource(b, 'ais-disruption')) return false;
    return shareEntity(a, b);
  },
};

// ── 6. Space weather (G4+) → Infrastructure anomaly ─────────────────

export const spaceWeatherInfrastructureRule: CorrelationRule = {
  id: 'space-weather-infrastructure',
  name: 'Geomagnetic storm → infrastructure anomaly',
  description: 'SWPC G4/G5 (or Kp≥7) followed by a CISA infrastructure incident within 2h.',
  domains: ['space', 'infra'],
  timeWindowMs: 2 * 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => {
    if (!fromSource(a, 'swpc-space-weather')) return false;
    const strong = hasAnyTag(a, ['scale-g4', 'scale-g5']) || a.severity === 'CRITICAL' || a.severity === 'HIGH';
    if (!strong) return false;
    return fromSource(b, 'cisa-infrastructure');
  },
};

// ── 7. Weather → Aviation diversion ─────────────────────────────────

export const weatherAviationRule: CorrelationRule = {
  id: 'weather-aviation',
  name: 'Severe weather → aviation divert',
  description: 'NWS severe-weather alert + aviation track within 500km exhibiting divert pattern, within 6h.',
  domains: ['weather', 'aviation'],
  timeWindowMs: 6 * 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => {
    if (!fromSource(a, 'nws-alerts')) return false;
    const severe = a.severity === 'HIGH' || a.severity === 'CRITICAL';
    if (!severe) return false;
    if (!fromSource(b, 'aviation-track')) return false;
    return withinDistance(a, b, 500);
  },
};

// ── 8. Conflict → Displacement ──────────────────────────────────────

export const conflictDisplacementRule: CorrelationRule = {
  id: 'conflict-displacement',
  name: 'Conflict event → displacement',
  description: 'ACLED conflict event and GDACS displacement record sharing a country code within 48h.',
  domains: ['conflict', 'humanitarian'],
  timeWindowMs: 48 * 60 * 60 * 1000,
  edgeType: 'temporally-adjacent',
  matchFn: (a, b) => {
    const aConflict = a.domain === 'conflict' || fromSource(a, 'acled-events');
    const bDisplacement = hasTag(b, 'displacement') || fromSource(b, 'gdacs-alerts');
    if (!aConflict || !bDisplacement) return false;
    return shareEntity(a, b);
  },
};

// ── Aggregate export ─────────────────────────────────────────────────

export const builtInCorrelationRules: readonly CorrelationRule[] = [
  earthquakeTsunamiRule,
  earthquakeInfrastructureRule,
  weatherWildfireRule,
  airQualityWildfireRule,
  biosurvAviationRule,
  sanctionsMaritimeRule,
  spaceWeatherInfrastructureRule,
  weatherAviationRule,
  conflictDisplacementRule,
];
