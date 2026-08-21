import type { BreakingAlert } from './breaking-news-alerts';
import { getRecentBreakingAlerts } from './breaking-news-alerts';
import type { CorrelationSignal } from './correlation';
import { getRecentSignals } from './correlation';
import { buildLocalLogisticsBriefItems, getCachedLocalLogistics, type LocalLogisticsSnapshot } from './local-logistics';
import {
  getLifelinePackReadinessForPlace,
  getRecentLifelineChangesForPlace,
} from './lifelines/lifeline-runtime';
import type { LifelineChange } from './lifelines/lifeline-changes';
import type { LifelineOfflinePackStatus } from './lifelines/offline-pack';
import { haversineKm } from './proximity-filter';
import {
  buildSavedPlaceWeatherFingerprint,
  buildSavedPlaceWeatherBriefItems,
  getCachedSavedPlaceWeather,
  type SavedPlaceWeatherSnapshot,
} from './saved-place-weather';
import { getSavedPlace, getSavedPlaces, type SavedPlace } from './saved-places';
import { isOffline, readOfflineCacheEntry, writeOfflineCacheEntry } from './offline-alert-cache';
import {
  getStormPreparednessContext,
  getStormPreparednessForPlace,
  summarizeStormPreparedness,
  type PlaceStormPreparedness,
} from './storm-preparedness';

// Per-place storm preparedness cache keyed by stormContext.updatedAt.
// Polygon math (ray-cast over NWS alert geometry) is O(places × alerts × vertices)
// and must not run on every panel re-render — only when storm data actually changes.
const stormPrepCache = new Map<string, { result: PlaceStormPreparedness | null; version: number }>();

export function buildStormPreparednessCacheKey(place: SavedPlace, version: number): string {
  return `${buildPlaceBriefFingerprint(place)}:${version}`;
}

function getCachedStormPreparedness(place: SavedPlace): PlaceStormPreparedness | null {
  const version = getStormPreparednessContext().updatedAt;
  const cacheKey = buildStormPreparednessCacheKey(place, version);
  const cached = stormPrepCache.get(cacheKey);
  if (cached?.version === version) return cached.result;
  const result = getStormPreparednessForPlace(place);
  if (stormPrepCache.size >= 128) {
    const oldestKey = stormPrepCache.keys().next().value as string | undefined;
    if (oldestKey) stormPrepCache.delete(oldestKey);
  }
  stormPrepCache.set(cacheKey, { result, version });
  return result;
}

export interface PlaceBriefItem {
  kind: 'breaking' | 'signal' | 'preparedness' | 'forecast' | 'logistics';
  label: string;
  value: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  link?: string;
}

export interface PlaceBrief {
  placeId: string;
  headline: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  items: PlaceBriefItem[];
  generatedAt: Date;
  isStale: boolean;
  staleAgeMs: number;
}

interface CachedPlaceBrief {
  schemaVersion: 2;
  placeId: string;
  placeFingerprint: string;
  headline: string;
  severity: PlaceBrief['severity'];
  items: PlaceBriefItem[];
  generatedAtMs: number;
}

interface PlaceBriefOptions {
  breakingAlerts?: BreakingAlert[];
  signals?: CorrelationSignal[];
  stormPreparedness?: PlaceStormPreparedness | null;
  forecastSnapshot?: SavedPlaceWeatherSnapshot | null;
  logisticsSnapshot?: LocalLogisticsSnapshot | null;
  offline?: boolean;
  now?: number;
}

interface LifelineBriefContext {
  packStatus?: LifelineOfflinePackStatus;
  changes?: LifelineChange[];
}

const PLACE_BRIEF_CACHE_PREFIX = 'saved-place-brief';
const PLACE_BRIEF_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

function placeBriefCacheKey(placeId: string): string {
  return `${PLACE_BRIEF_CACHE_PREFIX}:${placeId}`;
}

/** Exact saved-place identity for cached briefs; same-ID edits must not reuse old geography. */
export function buildPlaceBriefFingerprint(place: SavedPlace): string {
  return JSON.stringify([
    2,
    place.id,
    place.name,
    place.lat,
    place.lon,
    place.radiusKm,
    place.offlinePinned,
    place.updatedAt,
  ]);
}

function briefSeverityFromSignal(signal: CorrelationSignal): PlaceBrief['severity'] {
  if (signal.confidence > 0.8) return 'high';
  if (signal.confidence > 0.65) return 'medium';
  return 'low';
}

function computeSeverity(items: PlaceBriefItem[]): PlaceBrief['severity'] {
  // Lifelines are an evidence/action surface, not a calibrated threat score.
  // A reported closure or outage context must not silently promote the saved
  // place headline or severity without a separately reviewed scoring model.
  const scored = items.filter((item) => item.kind !== 'logistics');
  if (scored.some((item) => item.severity === 'critical')) return 'critical';
  if (scored.some((item) => item.severity === 'high')) return 'high';
  if (scored.some((item) => item.severity === 'medium')) return 'medium';
  return 'low';
}

function isBreakingAlertNearPlace(place: SavedPlace, alert: BreakingAlert): boolean {
  if (Array.isArray(alert.placeIds) && alert.placeIds.includes(place.id)) return true;
  if (!Number.isFinite(alert.lat) || !Number.isFinite(alert.lon)) return false;
  return haversineKm(alert.lat as number, alert.lon as number, place.lat, place.lon) <= place.radiusKm;
}

function isSignalNearPlace(place: SavedPlace, signal: CorrelationSignal): boolean {
  return Array.isArray(signal.data.placeIds) && signal.data.placeIds.includes(place.id);
}

function serializeBrief(brief: PlaceBrief, place: SavedPlace): CachedPlaceBrief {
  return {
 schemaVersion: 2,
 placeId: brief.placeId,
 placeFingerprint: buildPlaceBriefFingerprint(place),
 headline: brief.headline,
 severity: brief.severity,
 items: brief.items,
 generatedAtMs: brief.generatedAt.getTime(),
  };
}

function isCachedBriefItem(value: unknown): value is PlaceBriefItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ['breaking', 'signal', 'preparedness', 'forecast', 'logistics'].includes(String(item.kind))
    && ['critical', 'high', 'medium', 'low'].includes(String(item.severity))
    && typeof item.label === 'string' && item.label.length > 0 && item.label.length <= 500
    && typeof item.value === 'string' && item.value.length > 0 && item.value.length <= 2_000
    && (item.link === undefined || (typeof item.link === 'string' && item.link.length <= 2_048));
}

/** @internal Strict cache boundary used by the offline same-place fallback. */
export function deserializeCachedPlaceBrief(cached: unknown, place: SavedPlace, now: number): PlaceBrief | null {
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return null;
  const value = cached as Record<string, unknown>;
  if (value.schemaVersion !== 2 || value.placeId !== place.id
    || value.placeFingerprint !== buildPlaceBriefFingerprint(place)
    || typeof value.headline !== 'string' || value.headline.length === 0 || value.headline.length > 500
    || !['critical', 'high', 'medium', 'low'].includes(String(value.severity))
    || !Array.isArray(value.items) || value.items.length > 20 || !value.items.every(isCachedBriefItem)
    || typeof value.generatedAtMs !== 'number' || !Number.isFinite(value.generatedAtMs)
    || value.generatedAtMs > now + 5 * 60_000
    || now - value.generatedAtMs < 0 || now - value.generatedAtMs >= PLACE_BRIEF_CACHE_MAX_AGE_MS) return null;
  return {
 placeId: place.id,
 headline: value.headline,
 severity: value.severity as PlaceBrief['severity'],
 items: value.items as PlaceBriefItem[],
 generatedAt: new Date(value.generatedAtMs),
 isStale: true,
 staleAgeMs: now - value.generatedAtMs,
  };
}

function buildOfflineUnknownBrief(place: SavedPlace, now: number): PlaceBrief {
  return {
    placeId: place.id,
    headline: 'Offline coverage unavailable for this exact place',
    severity: 'low',
    items: [{
      kind: 'signal',
      label: 'Local status unknown',
      value: 'No current exact-place brief is cached. Reconnect and refresh before relying on local conditions.',
      severity: 'low',
    }],
    generatedAt: new Date(now),
    isStale: true,
    staleAgeMs: 0,
  };
}

function buildCalmHeadline(place: SavedPlace): string {
  return `No recent critical alerts within ${place.radiusKm} km`;
}

function buildAlertItems(place: SavedPlace, breakingAlerts: BreakingAlert[]): PlaceBriefItem[] {
  return breakingAlerts
 .filter((alert) => isBreakingAlertNearPlace(place, alert))
 .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
 .slice(0, 3)
 .map((alert) => ({
 kind: 'breaking' as const,
 label: alert.headline,
 value: [alert.source, alert.origin.replace(/_/g, ' ')].join(' · '),
 severity: alert.threatLevel,
 link: alert.link,
 }));
}

function buildSignalItems(place: SavedPlace, signals: CorrelationSignal[]): PlaceBriefItem[] {
  return signals
 .filter((signal) => isSignalNearPlace(place, signal))
 .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
 .slice(0, 2)
 .map((signal) => ({
 kind: 'signal' as const,
 label: signal.title,
 value: signal.description,
 severity: briefSeverityFromSignal(signal),
 }));
}

function buildPreparednessItems(stormPreparedness: PlaceStormPreparedness | null): PlaceBriefItem[] {
  if (!stormPreparedness) return [];

  const summary = summarizeStormPreparedness(stormPreparedness) ?? stormPreparedness.detail;
  return [
 {
 kind: 'preparedness',
 label: stormPreparedness.headline,
 value: summary,
 severity: stormPreparedness.severity,
 },
 ...stormPreparedness.guidance.slice(0, 2).map((action) => ({
 kind: 'preparedness' as const,
 label: 'Next action',
 value: action,
 severity: stormPreparedness.severity === 'critical' ? 'high' : stormPreparedness.severity,
 })),
  ];
}

function buildLifelineSituationBriefItems(
  place: SavedPlace,
  snapshot: LocalLogisticsSnapshot | null,
  context: LifelineBriefContext,
  now: number,
): PlaceBriefItem[] {
  const items: PlaceBriefItem[] = [];
  if (place.offlinePinned && context.packStatus) {
    const statusLabel: Record<LifelineOfflinePackStatus, string> = {
      ready: 'Lifelines ready offline',
      partial: 'Lifelines pack partial',
      expired: 'Lifelines pack expired',
      'not-saved': 'Lifelines pack not saved',
    };
    items.push({
      kind: 'logistics',
      label: 'Offline readiness',
      value: statusLabel[context.packStatus],
      severity: 'low',
    });
  }
  if (!snapshot) return items;

  const currentConditions = snapshot.areaConditions.filter((condition) => (
    condition.coverage === 'reported' && condition.expiresAt.getTime() > now
  ));
  if (currentConditions.length > 0) {
    const customersOut = currentConditions.reduce((sum, condition) => sum + condition.customersOut, 0);
    const county = currentConditions[0]?.county ?? 'County';
    items.push({
      kind: 'logistics',
      label: `${county} power context`,
      value: `${customersOut.toLocaleString()} customers reported out; individual facility power remains unknown. Retrieved ${snapshot.fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
      severity: 'low',
    });
  } else {
    items.push({
      kind: 'logistics',
      label: 'County power coverage',
      value: 'Unknown; no current accepted county observation. This does not mean power is on.',
      severity: 'low',
    });
  }

  const newestChange = context.changes?.[0];
  if (newestChange) {
    const transition = newestChange.kind.includes('coverage-lost') || newestChange.kind.includes('became-unknown')
      ? 'Evidence became unknown'
      : `${String(newestChange.from)} → ${String(newestChange.to)}`;
    items.push({
      kind: 'logistics',
      label: 'What changed (review-only)',
      value: `${newestChange.attribute.replace(/-/g, ' ')}: ${transition}.`,
      severity: 'low',
    });
  }

  items.push({
    kind: 'logistics',
    label: 'Known collection gaps',
    value: 'Hotel occupancy, fuel stock, facility power, and unreported road access are not verified; call first.',
    severity: 'low',
  });
  return items;
}

export function buildPlaceBrief(
  place: SavedPlace,
  breakingAlerts: BreakingAlert[] = [],
  signals: CorrelationSignal[] = [],
  stormPreparedness: PlaceStormPreparedness | null = null,
  forecastSnapshot: SavedPlaceWeatherSnapshot | null = null,
  logisticsSnapshot: LocalLogisticsSnapshot | null = null,
  now = Date.now(),
  lifelineContext: LifelineBriefContext = {},
): PlaceBrief {
  const exactForecastSnapshot = forecastSnapshot
    && forecastSnapshot.placeId === place.id
    && forecastSnapshot.placeName === place.name
    && forecastSnapshot.placeFingerprint === buildSavedPlaceWeatherFingerprint(place)
    ? forecastSnapshot
    : null;
  const items = [
 ...buildPreparednessItems(stormPreparedness),
 ...buildSavedPlaceWeatherBriefItems(exactForecastSnapshot, 2),
 ...buildAlertItems(place, breakingAlerts),
 ...buildSignalItems(place, signals),
 ...buildLocalLogisticsBriefItems(logisticsSnapshot, 2),
 ...buildLifelineSituationBriefItems(place, logisticsSnapshot, lifelineContext, now),
  ];

  if (items.length === 0) {
 return {
 placeId: place.id,
 headline: buildCalmHeadline(place),
 severity: 'low',
 items: [
 {
 kind: 'signal',
 label: 'Local status',
 value: 'No recent saved-place matches in the live alert stream.',
 severity: 'low',
 },
 ],
 generatedAt: new Date(now),
 isStale: false,
 staleAgeMs: 0,
 };
  }

  const lead = items.find((item) => item.kind !== 'logistics');
  return {
 placeId: place.id,
 headline: lead?.label ?? buildCalmHeadline(place),
 severity: computeSeverity(items),
 items,
 generatedAt: new Date(now),
 isStale: false,
 staleAgeMs: 0,
  };
}

export function getPlaceBriefSnapshot(
  place: SavedPlace,
  options: PlaceBriefOptions = {},
): PlaceBrief {
  const now = options.now ?? Date.now();
  const breakingAlerts = options.breakingAlerts ?? getRecentBreakingAlerts();
  const signals = options.signals ?? getRecentSignals();
  const stormPreparedness = options.stormPreparedness ?? getCachedStormPreparedness(place);
  const forecastSnapshot = options.forecastSnapshot ?? getCachedSavedPlaceWeather(place);
  const logisticsSnapshot = options.logisticsSnapshot ?? getCachedLocalLogistics(place);
  const offline = options.offline ?? isOffline();

  if (offline && breakingAlerts.length === 0 && signals.length === 0 && !stormPreparedness && !forecastSnapshot && !logisticsSnapshot) {
 const cached = readOfflineCacheEntry<unknown>(placeBriefCacheKey(place.id));
 if (cached) {
 const exact = deserializeCachedPlaceBrief(cached.data, place, now);
 if (exact) return exact;
 }
 return buildOfflineUnknownBrief(place, now);
  }

  const brief = buildPlaceBrief(
    place,
    breakingAlerts,
    signals,
    stormPreparedness,
    forecastSnapshot,
    logisticsSnapshot,
    now,
    {
      packStatus: getLifelinePackReadinessForPlace(place).status,
      changes: getRecentLifelineChangesForPlace(place),
    },
  );
  // Defer the localStorage write so it never blocks a UI render or click handler.
  // The offline cache is background bookkeeping — a 5-second window is fine.
  const cacheKey = placeBriefCacheKey(place.id);
  const serialized = serializeBrief(brief, place);
  if (typeof requestIdleCallback === 'undefined') {
    setTimeout(() => { writeOfflineCacheEntry(cacheKey, serialized); }, 0);
  } else {
    requestIdleCallback(() => { writeOfflineCacheEntry(cacheKey, serialized); }, { timeout: 5000 });
  }
  return brief;
}

export function getSavedPlaceBrief(placeId: string): PlaceBrief | null {
  const place = getSavedPlace(placeId);
  if (!place) return null;
  return getPlaceBriefSnapshot(place);
}

export function getSavedPlaceBriefs(): PlaceBrief[] {
  return getSavedPlaces().map((place) => getPlaceBriefSnapshot(place));
}

/**
 * Compute briefs for a list of places in one pass, reusing the
 * shared getRecentBreakingAlerts/getRecentSignals results rather than
 * re-fetching them once per place.  Use this in any UI that renders
 * multiple place cards so those two calls happen exactly once.
 */
export function computePlaceBriefsBatch(places: SavedPlace[]): Map<string, PlaceBrief> {
  const out = new Map<string, PlaceBrief>();
  if (places.length === 0) return out;
  const breakingAlerts = getRecentBreakingAlerts();
  const signals = getRecentSignals();
  for (const place of places) {
    out.set(place.id, getPlaceBriefSnapshot(place, { breakingAlerts, signals }));
  }
  return out;
}
