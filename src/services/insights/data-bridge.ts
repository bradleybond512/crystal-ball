/**
 * Data bridge — wires the live data loader into the insights state
 * singleton + Personal Impact Engine + Provider Redundancy.
 *
 * The data-loader calls these helpers after each refresh; everything
 * downstream (Command Center, panels, share packets) reads the same
 * state through the singleton.
 *
 * Pure deterministic. No DOM, no fetch. Inputs are fully-formed
 * objects already produced by the loader.
 */

import {
  setRecentEvents,
  getRecentEvents,
  setActiveSituation,
  setActiveActionBrief,
  getActiveSituation,
  setProviderSnapshots,
  setPersonalProfile,
  getPersonalProfile,
} from './insights-state';
import type { IncomingEvent, SavedPlace } from '../personal/personal-impact';
import type { SituationDescriptor } from './action-briefs';
import { actionsForEarthquake } from '../action-guidance/earthquake-action-guidance';
import type { ProviderSnapshot, ProviderHealthLevel } from '../diagnostics/provider-redundancy';
import { getProviderDefinition } from '../providers/provider-registry';
import { recordProviderFetchOutcome, getProviderHealthState } from '../providers/providers-state';
import { getFusionProviderSnapshots } from '../providers/fusion-publish';
// ── Public API ──────────────────────────────────────────────────────────

/** A subset of the `WeatherAlert` shape from `services/weather.ts` —
 *  we don't import the type directly to keep this module decoupled. */
export interface WeatherAlertLike {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  areaDesc: string;
  onset: Date | string;
  centroid?: [number, number];
}

/** A subset of the `SourceDiagnostic` shape from
 *  `services/api-diagnostic.ts`. */
export interface SourceDiagnosticLike {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'failing' | 'silent' | 'unknown';
  lastUpdateMs: number | null;
  /** Free-text domain bucket the diagnostic belongs to — populated by
   *  the bridge with a sensible default if missing. */
  domain?: string;
  /** Whether this is the primary provider for its domain. */
  primary?: boolean;
}

// ── Weather → IncomingEvent + active situation ─────────────────────────

const SEVERITY_TO_SCORE: Record<WeatherAlertLike['severity'], number> = {
  Extreme: 95,
  Severe: 80,
  Moderate: 55,
  Minor: 30,
  Unknown: 20,
};

const SEVERITY_TO_TIER: Record<WeatherAlertLike['severity'], 'low' | 'medium' | 'high'> = {
  Extreme: 'high',
  Severe: 'high',
  Moderate: 'medium',
  Minor: 'low',
  Unknown: 'low',
};

/** Optional logger callback injected by the host (data-loader / panel-layout).
 *  Keeps the service-layer pure — no direct slog import. Defaults to a no-op. */
export type BridgeLogFn = (level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;

const _noop: BridgeLogFn = () => undefined;

/** Translate a weather alert list into IncomingEvent[] + push the
 *  highest-severity matching alert as the active situation. */
export function bridgeWeatherAlertsToInsights(
  alerts: readonly WeatherAlertLike[],
  options: { savedPlaces?: readonly SavedPlace[]; log?: BridgeLogFn } = {},
): { events: readonly IncomingEvent[]; situation: SituationDescriptor | undefined } {
  const log = options.log ?? _noop;
  const places = options.savedPlaces ?? getPersonalProfile().savedPlaces;
  const events: IncomingEvent[] = alerts.map((a) => alertToEvent(a));
  // Replace only the weather-alert slice — mirror the earthquake bridge.
  // Events published by other bridges (earthquakes, the smoke callout's
  // `smoke-*` event which also carries domain 'weather') must survive a
  // weather refresh or they flicker out between their own refresh ticks.
  const preserved = getRecentEvents().filter(
    (e) => e.domain !== 'weather' || e.eventId.startsWith('smoke-'),
  );
  setRecentEvents([...preserved, ...events]);

  const situation = pickActiveSituation(alerts, places);
  setActiveSituation(situation);

  for (const evt of events) {
    log('info', 'ingested', { domain: 'weather', alertsIn: alerts.length, traceId: evt.eventId });
  }
  if (events.length === 0) {
    log('info', 'bridgeWeatherAlertsToInsights', { alertsIn: alerts.length, eventsBridged: 0, hasSituation: false });
  }

  return { events, situation };
}

function alertToEvent(alert: WeatherAlertLike): IncomingEvent {
  // alert.onset is typed Date|string but runtime casts may produce other values.
  // Guard so a non-Date non-string falls through to the NaN default.
  let at: number;
  if (typeof alert.onset === 'string') at = Date.parse(alert.onset);
  else if (alert.onset instanceof Date) at = alert.onset.getTime();
  else at = Number.NaN;
  const [lng, lat] = alert.centroid ?? [0, 0];
  return {
    eventId: alert.id,
    description: alert.headline || alert.event,
    domain: 'weather',
    severity: SEVERITY_TO_SCORE[alert.severity] ?? 30,
    at: Number.isFinite(at) ? at : Date.now(),
    location: alert.centroid ? { latitude: lat, longitude: lng } : undefined,
  };
}

function pickActiveSituation(
  alerts: readonly WeatherAlertLike[],
  places: readonly SavedPlace[],
): SituationDescriptor | undefined {
  if (alerts.length === 0 || places.length === 0) return undefined;
  // Sort severity desc, then by alert id for stability.
  const sorted = [...alerts].sort((a, b) => {
    const sa = SEVERITY_TO_SCORE[a.severity] ?? 0;
    const sb = SEVERITY_TO_SCORE[b.severity] ?? 0;
    if (sa !== sb) return sb - sa;
    return a.id.localeCompare(b.id);
  });
  const top = sorted[0];
  if (!top?.centroid) return undefined;
  // Only treat as the active situation if at least one saved place is
  // within ~50 km of the centroid.
  const [lng, lat] = top.centroid;
  const closest = nearestPlaceKm(places, lat, lng);
  if (closest === undefined || closest > 50) return undefined;
  return {
    id: top.id,
    title: top.headline || top.event,
    category: pickCategory(top.event),
    severityScore: SEVERITY_TO_SCORE[top.severity] ?? 30,
    confidence: SEVERITY_TO_TIER[top.severity] ?? 'medium',
  };
}

function pickCategory(eventName: string): SituationDescriptor['category'] {
  const lower = eventName.toLowerCase();
  if (/wildfire|red flag|fire weather/.test(lower)) return 'wildfire';
  if (/tornado|severe thunderstorm|hurricane|tropical|flash flood|blizzard|ice storm|extreme/.test(lower)) {
    return 'severe_weather';
  }
  return 'severe_weather';
}

// ── Earthquake → active situation + injected Action Brief ──────────────

/** A subset of a USGS / mission-bridge earthquake event — kept decoupled
 *  from the seismic feed types on purpose. */
export interface EarthquakeLike {
  id: string;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  place?: string;
  tsunamiWarning?: boolean;
}

/** When an earthquake (domain earthquake/seismic) becomes the dominant felt
 *  event near a saved place, set it as the active situation AND inject the
 *  proximity-aware brief from `actionsForEarthquake`. Mirrors
 *  `bridgeWeatherAlertsToInsights`. */
export function bridgeEarthquakeToInsights(
  quakes: readonly EarthquakeLike[],
  options: { savedPlaces?: readonly SavedPlace[]; populationDensity?: 'low' | 'medium' | 'high'; log?: BridgeLogFn } = {},
): { events: readonly IncomingEvent[]; situation: SituationDescriptor | undefined } {
  const log = options.log ?? _noop;
  const places = options.savedPlaces ?? getPersonalProfile().savedPlaces;

  const events: IncomingEvent[] = quakes.map((q) => quakeToEvent(q));
  // Replace the earthquake slice (not append) so repeated refreshes with the
  // same snapshot don't accumulate duplicates, and quakes that fall out of the
  // feed don't linger. Non-earthquake events from other bridges are preserved.
  const nonQuake = getRecentEvents().filter((e) => e.domain !== 'earthquake');
  setRecentEvents([...nonQuake, ...events]);

  const picked = pickActiveQuake(quakes, places);
  if (!picked) {
    // If a prior earthquake left an active situation/brief but the current
    // snapshot has no relevant quake, clear it so the Command Center stops
    // rendering a stale earthquake brief. Don't touch a non-earthquake
    // situation set by another bridge.
    if (getActiveSituation()?.category === 'earthquake') {
      setActiveSituation(undefined); // also clears the injected brief
    }
    if (events.length === 0) {
      log('info', 'bridgeEarthquakeToInsights', { quakesIn: quakes.length, eventsBridged: 0, hasSituation: false });
    }
    return { events, situation: undefined };
  }

  const { quake, distanceKm } = picked;
  const situation: SituationDescriptor = {
    id: quake.id,
    title: quakeTitle(quake),
    category: 'earthquake',
    severityScore: magnitudeToScore(quake.magnitude),
    confidence: quake.magnitude >= 5 ? 'high' : 'medium',
  };
  setActiveSituation(situation);

  const brief = actionsForEarthquake(quake.magnitude, quake.depthKm, distanceKm, {
    populationDensity: options.populationDensity,
    tsunamiWarning: quake.tsunamiWarning,
  });
  // Pin the brief to the real situation id so consumers stay consistent.
  setActiveActionBrief({ ...brief, situationId: situation.id });

  log('info', 'ingested', { domain: 'earthquake', quakesIn: quakes.length, traceId: quake.id });
  return { events, situation };
}

function quakeToEvent(q: EarthquakeLike): IncomingEvent {
  return {
    eventId: q.id,
    description: quakeTitle(q),
    domain: 'earthquake',
    severity: magnitudeToScore(q.magnitude),
    at: Date.now(),
    location: { latitude: q.latitude, longitude: q.longitude },
  };
}

function quakeTitle(q: EarthquakeLike): string {
  const where = q.place ? ` near ${q.place}` : '';
  return `M${q.magnitude.toFixed(1)} earthquake${where}`;
}

function magnitudeToScore(magnitude: number): number {
  return Math.max(0, Math.min(100, Math.round(magnitude * 12)));
}

/** Pick the highest-magnitude quake whose epicenter is within a
 *  magnitude-scaled felt radius of a saved place. */
function pickActiveQuake(
  quakes: readonly EarthquakeLike[],
  places: readonly SavedPlace[],
): { quake: EarthquakeLike; distanceKm: number } | undefined {
  if (quakes.length === 0 || places.length === 0) return undefined;
  const sorted = [...quakes].sort((a, b) => {
    if (a.magnitude !== b.magnitude) return b.magnitude - a.magnitude;
    return a.id.localeCompare(b.id);
  });
  for (const quake of sorted) {
    const distanceKm = nearestPlaceKm(places, quake.latitude, quake.longitude);
    if (distanceKm === undefined) continue;
    if (quake.tsunamiWarning || distanceKm <= feltRadiusKm(quake.magnitude)) {
      return { quake, distanceKm };
    }
  }
  return undefined;
}

function feltRadiusKm(magnitude: number): number {
  if (magnitude >= 6) return 500;
  if (magnitude >= 5) return 250;
  if (magnitude >= 4) return 100;
  return 40;
}

// ── Sources → ProviderSnapshot[] ───────────────────────────────────────

const KNOWN_DOMAIN_BY_SOURCE: Record<string, string> = {
  'nws-alerts': 'weather',
  'noaa-radar': 'weather',
  'weather-alerts': 'weather',
  'weather': 'weather',
  'gdacs': 'disasters',
  'usgs-earthquakes': 'disasters',
  'adsbexchange': 'adsb',
  'opensky': 'adsb',
  'eia': 'commodities',
  'fred': 'commodities',
  'fews-net': 'food_security',
};

const KNOWN_PRIMARIES = new Set([
  'nws-alerts',
  'usgs-earthquakes',
  'gdacs',
  'eia',
  'fred',
  'fews-net',
  'adsbexchange',
]);

const STATUS_TO_LEVEL: Record<SourceDiagnosticLike['status'], ProviderHealthLevel> = {
  healthy: 'healthy',
  degraded: 'degraded',
  failing: 'failing',
  silent: 'silent',
  unknown: 'unknown',
};

/** Translate api-diagnostic SourceDiagnostic[] into ProviderSnapshot[]
 *  and push them through the singleton. Registry-known sources flow
 *  through the provider registry (richer health + fusion); unregistered
 *  sources keep the legacy translation. */
export function bridgeSourcesToProviderRedundancy(
  sources: readonly SourceDiagnosticLike[],
  now = Date.now(),
): readonly ProviderSnapshot[] {
  const legacy: ProviderSnapshot[] = [];
  const registrySnapshots: ProviderSnapshot[] = [];

  for (const s of sources) {
    const registrySnapshot = registrySnapshotFor(s, now);
    if (registrySnapshot) {
      registrySnapshots.push(registrySnapshot);
    } else {
      legacy.push({
        providerId: s.id,
        domain: s.domain ?? KNOWN_DOMAIN_BY_SOURCE[s.id] ?? s.id,
        label: s.name,
        primary: s.primary ?? KNOWN_PRIMARIES.has(s.id),
        level: STATUS_TO_LEVEL[s.status] ?? 'unknown',
        lastSuccessAt: s.lastUpdateMs ?? undefined,
      });
    }
  }

  const base = [...registrySnapshots, ...legacy];
  // Overlay live fusion snapshots — they carry recentFactFingerprint, so a
  // fused domain (e.g. disasters: USGS + EMSC) can read 'redundant_agreement'
  // instead of 'redundant_unverified'. Fusion wins by providerId.
  const fusion = getFusionProviderSnapshots(now);
  const fusionIds = new Set(fusion.map((f) => f.providerId));
  const snapshots = [...base.filter((s) => !fusionIds.has(s.providerId)), ...fusion];
  setProviderSnapshots(snapshots);
  return snapshots;
}

/** Build a snapshot for a registry-known source, recording the outcome for
 *  history first. The snapshot level comes directly from the diagnostic
 *  status so a dead primary reports its real level, not 'degraded' (which
 *  deriveProviderHealth emits until it sees 3 consecutive failures). */
function registrySnapshotFor(s: SourceDiagnosticLike, now: number): ProviderSnapshot | undefined {
  const def = getProviderDefinition(s.id);
  if (!def) return undefined;
  const okStatus = s.status === 'healthy' || s.status === 'degraded';
  recordProviderFetchOutcome(s.id, {
    ok: okStatus,
    latencyMs: 0,
    at: s.lastUpdateMs ?? now,
    errorMessage: okStatus ? undefined : `diagnostic status: ${s.status}`,
  });
  const health = getProviderHealthState().outcomes[s.id];
  const successes = health ? health.filter((o) => o.ok) : [];
  const successRate = health && health.length > 0 ? successes.length / health.length : undefined;
  const lastSuccessAt = successes.length > 0 ? successes[successes.length - 1]!.at : (s.lastUpdateMs ?? undefined);
  return {
    providerId: s.id,
    domain: def.domain,
    label: def.displayName,
    primary: def.fallbackPriority === 1,
    level: STATUS_TO_LEVEL[s.status] ?? 'unknown',
    lastSuccessAt,
    successRate,
  };
}

// ── Personal profile helper ────────────────────────────────────────────

/** Convenience: the data loader can call this once on boot to install
 *  the user's saved-place list (matched on the existing
 *  `crystalball-saved-places` storage shape). */
export function bridgeSavedPlacesToProfile(places: readonly SavedPlace[]): void {
  const profile = getPersonalProfile();
  setPersonalProfile({ ...profile, savedPlaces: places });
}

/** Adapter: translate the existing `services/saved-places.ts`
 *  `SavedPlace` shape (id/name/lat/lon/radiusKm) into the personal
 *  impact engine's shape (placeId/label/latitude/longitude/role). */
export interface ExistingSavedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  primary?: boolean;
  tags?: readonly string[];
}

export function adaptExistingSavedPlace(p: ExistingSavedPlace): SavedPlace {
  return {
    placeId: p.id,
    label: p.name,
    latitude: p.lat,
    longitude: p.lon,
    role: p.primary ? 'home' : pickRoleFromTags(p.tags),
  };
}

function pickRoleFromTags(tags: readonly string[] | undefined): SavedPlace['role'] {
  if (!tags || tags.length === 0) return 'other';
  const lc = new Set(tags.map((t) => t.toLowerCase()));
  if (lc.has('home')) return 'home';
  if (lc.has('work') || lc.has('office')) return 'work';
  if (lc.has('family')) return 'family';
  if (lc.has('travel')) return 'travel';
  return 'other';
}

// ── Helpers ─────────────────────────────────────────────────────────────

const EARTH_KM = 6371;

function nearestPlaceKm(places: readonly SavedPlace[], lat: number, lng: number): number | undefined {
  let best: number | undefined;
  for (const p of places) {
    const km = haversineKm(lat, lng, p.latitude, p.longitude);
    if (best === undefined || km < best) best = km;
  }
  return best;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_KM * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
