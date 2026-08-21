import type { LocalLogisticsSnapshot, LogisticsNode } from '@/services/local-logistics-types';
import { getCachedLocalLogistics } from '@/services/local-logistics';
import { getSavedPlace, type SavedPlace } from '@/services/saved-places';

export type LifelineMarkerState = 'official-open' | 'official-closed' | 'directory' | 'expired' | 'unknown';

export interface LifelineMarkerPresentation {
  state: LifelineMarkerState;
  categoryLabel: string;
  glyph: string;
  evidenceLabel: string;
  fillColor: [number, number, number, number];
  strokeColor: [number, number, number, number];
}

export interface LifelinesOverlayExactContext {
  getPlace(placeId: string): SavedPlace | null;
  getCachedSnapshot(place: SavedPlace): LocalLogisticsSnapshot | null;
}

const CATEGORY_PRESENTATION: Record<string, { label: string; glyph: string }> = {
  shelter: { label: 'Shelter', glyph: 'S' },
  hotel: { label: 'Hotel', glyph: 'H' },
  hospital: { label: 'Hospital', glyph: '+' },
  pharmacy: { label: 'Pharmacy', glyph: 'Rx' },
  fuel: { label: 'Fuel', glyph: 'F' },
  water: { label: 'Water', glyph: 'W' },
  recovery: { label: 'Recovery center', glyph: 'R' },
};

const STATE_PRESENTATION: Record<LifelineMarkerState, {
  fill: [number, number, number, number];
  stroke: [number, number, number, number];
}> = {
  'official-open': { fill: [38, 166, 91, 230], stroke: [218, 255, 231, 255] },
  'official-closed': { fill: [210, 59, 59, 235], stroke: [255, 224, 224, 255] },
  directory: { fill: [190, 132, 34, 225], stroke: [255, 239, 197, 255] },
  expired: { fill: [99, 109, 121, 210], stroke: [220, 225, 230, 255] },
  unknown: { fill: [55, 124, 174, 225], stroke: [218, 240, 255, 255] },
};

const CATEGORIES = new Set(Object.keys(CATEGORY_PRESENTATION));
const OPERATIONAL = new Set(['open', 'closed', 'unknown']);
const INVENTORY = new Set(['available', 'limited', 'full', 'out', 'unknown']);
const POWER = new Set(['grid', 'generator', 'outage', 'unknown']);
const ACCESS = new Set(['reachable', 'blocked', 'unknown']);
const VERIFICATION = new Set(['directory', 'official']);
const CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown']);
const FRESHNESS = new Set(['fresh', 'recent', 'stale']);
const HAZARD = new Set(['general', 'evacuation', 'medical', 'supply']);
const EARLIEST_SOURCE_TIME_MS = Date.UTC(2000, 0, 1);
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DIRECTORY_OBSERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const FEMA_OBSERVATION_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_KEYS = new Set([
  'schemaVersion', 'queryFingerprint', 'placeId', 'placeName', 'effectiveRadiusKm', 'countyFips',
  'categories', 'sites', 'observations', 'nodes', 'areaConditions', 'providers', 'fetchedAt',
  'isStale', 'isExpired', 'staleAgeMs', 'source',
]);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor);
}

function denseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor)) return false;
  }
  return Reflect.ownKeys(descriptors).every((key) => key === 'length'
    || (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
}

function boundedString(value: unknown, maximum = 400): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function optionalBoundedString(value: unknown, maximum = 400): boolean {
  return value === undefined || boundedString(value, maximum);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validHttpsUrl(value: unknown): boolean {
  if (!boundedString(value, 2_048)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function trustedProviderUrl(value: unknown, provider: 'osm' | 'fema'): boolean {
  if (!validHttpsUrl(value)) return false;
  const url = new URL(value as string);
  return provider === 'osm'
    ? url.hostname === 'www.openstreetmap.org' || url.hostname === 'openstreetmap.org'
    : url.hostname === 'gis.fema.gov';
}

function validProviderSemantics(value: Record<string, unknown>, provider: 'osm' | 'fema'): boolean {
  if (!trustedProviderUrl(value.sourceUrl, provider)) return false;
  if (value.url !== undefined && !trustedProviderUrl(value.url, provider)) return false;
  if (provider === 'osm') {
    return value.category !== 'recovery'
      && value.source === 'OpenStreetMap directory'
      && value.verification === 'directory'
      && value.directoryOnly === true
      && value.operational === 'unknown'
      && value.inventory === 'unknown'
      && value.power === 'unknown'
      && value.access === 'unknown'
      && value.confidence === 'low';
  }
  const expectedSource = value.category === 'recovery'
    ? 'FEMA Disaster Recovery Centers'
    : 'FEMA Open Shelters';
  return (value.category === 'shelter' || value.category === 'recovery')
    && value.source === expectedSource
    && value.verification === 'official'
    && value.directoryOnly === false
    && value.operational === 'open'
    && value.inventory === 'unknown'
    && value.power === 'unknown'
    && value.access === 'unknown'
    && value.confidence === 'high';
}

interface ParsedSnapshotFingerprint {
  lat: number;
  lon: number;
  radiusKm: number;
  categories: string[];
}

function parseSnapshotFingerprint(value: string): ParsedSnapshotFingerprint | null {
  const [version, latRaw, lonRaw, radiusRaw, categoriesRaw, limitRaw, ...rest] = value.split('|');
  if (version !== 'v2' || rest.length > 0) return null;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const radiusKm = Number(radiusRaw);
  const fingerprintCategories = categoriesRaw ? categoriesRaw.split(',') : [];
  const limit = Number(limitRaw);
  if (!finiteInRange(lat, -90, 90) || !finiteInRange(lon, -180, 180)
    || !finiteInRange(radiusKm, 1, 50)
    || latRaw !== lat.toFixed(5) || lonRaw !== lon.toFixed(5) || radiusRaw !== radiusKm.toFixed(2)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 5 || limitRaw !== String(limit)
    || new Set(fingerprintCategories).size !== fingerprintCategories.length
    || !fingerprintCategories.every((category) => CATEGORIES.has(category))) return null;
  return { lat, lon, radiusKm, categories: fingerprintCategories };
}

function haversineKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const radians = Math.PI / 180;
  const deltaLat = (toLat - fromLat) * radians;
  const deltaLon = (toLon - fromLon) * radians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(fromLat * radians) * Math.cos(toLat * radians) * Math.sin(deltaLon / 2) ** 2;
  const boundedA = Math.max(0, Math.min(1, a));
  return 6_371 * 2 * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
}

function validNode(value: unknown, snapshotFetchedAt: Date, now: number): value is LogisticsNode {
  if (!plainRecord(value)) return false;
  if (!boundedString(value.id, 180) || !boundedString(value.name, 240)) return false;
  if (!CATEGORIES.has(String(value.category)) || value.kind !== value.category) return false;
  if (!finiteInRange(value.lat, -90, 90) || !finiteInRange(value.lon, -180, 180)) return false;
  if (!finiteInRange(value.distanceKm, 0, 50_000)) return false;
  if (!optionalBoundedString(value.address) || !optionalBoundedString(value.publicPhone, 80)) return false;
  if (value.publicPhone !== undefined && !/^[+()\d\s.\-xext]+$/i.test(String(value.publicPhone))) return false;
  if (!plainRecord(value.capabilities) || !denseDataArray(value.sourceRefs) || value.sourceRefs.length === 0 || value.sourceRefs.length > 8) return false;
  const sourceRefs = Array.from(value.sourceRefs);
  if (!sourceRefs.every((ref) => plainRecord(ref)
    && (ref.provider === 'osm' || ref.provider === 'fema')
    && boundedString(ref.recordId, 180))) return false;
  const provider = (sourceRefs[0] as { provider: 'osm' | 'fema' }).provider;
  const refKeys = sourceRefs.map((ref) => `${(ref as { provider: string }).provider}:${(ref as { recordId: string }).recordId}`);
  if (new Set(refKeys).size !== refKeys.length) return false;
  if (provider === 'osm' && sourceRefs.some((ref) => (ref as { provider: string }).provider !== 'osm')) return false;
  if (provider === 'fema') {
    let reachedOsmSecondary = false;
    for (const ref of sourceRefs) {
      if ((ref as { provider: string }).provider === 'osm') reachedOsmSecondary = true;
      else if (reachedOsmSecondary) return false;
    }
  }
  if (!boundedString(value.source, 120) || !FRESHNESS.has(String(value.freshness)) || !HAZARD.has(String(value.hazardCompatibility))) return false;
  if (!OPERATIONAL.has(String(value.operational)) || !INVENTORY.has(String(value.inventory))) return false;
  if (!POWER.has(String(value.power)) || !ACCESS.has(String(value.access))) return false;
  if (!VERIFICATION.has(String(value.verification)) || !CONFIDENCE.has(String(value.confidence))) return false;
  if (!validDate(value.fetchedAt) || value.fetchedAt.getTime() !== snapshotFetchedAt.getTime()) return false;
  if (!validDate(value.observedAt) || !validDate(value.expiresAt)) return false;
  const retrievedAt = value.retrievedAt === undefined ? value.observedAt : value.retrievedAt;
  if (!validDate(retrievedAt) || value.observedAt.getTime() !== retrievedAt.getTime()) return false;
  if (retrievedAt.getTime() < EARLIEST_SOURCE_TIME_MS || retrievedAt.getTime() > now + CLOCK_SKEW_MS) return false;
  if (value.sourceObservedAt !== undefined && (!validDate(value.sourceObservedAt)
    || value.sourceObservedAt.getTime() < EARLIEST_SOURCE_TIME_MS
    || value.sourceObservedAt.getTime() > retrievedAt.getTime() + CLOCK_SKEW_MS)) return false;
  const maximumTtlMs = provider === 'osm' ? DIRECTORY_OBSERVATION_TTL_MS : FEMA_OBSERVATION_TTL_MS;
  if (value.expiresAt.getTime() < retrievedAt.getTime()
    || value.expiresAt.getTime() > retrievedAt.getTime() + maximumTtlMs) return false;
  if (typeof value.directoryOnly !== 'boolean' || !validProviderSemantics(value, provider)) return false;
  return true;
}

function sanitizeNode(node: LogisticsNode, distanceKm: number): LogisticsNode {
  const capabilities: LogisticsNode['capabilities'] = {};
  if (node.capabilities.lodgingType === 'hotel' || node.capabilities.lodgingType === 'motel'
    || node.capabilities.lodgingType === 'hostel' || node.capabilities.lodgingType === 'other') {
    capabilities.lodgingType = node.capabilities.lodgingType;
  }
  if (boundedString(node.capabilities.directoryHours, 240)) capabilities.directoryHours = node.capabilities.directoryHours;
  for (const key of ['evacuationCapacity', 'postImpactCapacity', 'reportedPopulation'] as const) {
    const candidate = node.capabilities[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) capabilities[key] = candidate;
  }
  for (const key of ['ada', 'wheelchairAccessible', 'pets', 'generatorOnsite'] as const) {
    const candidate = node.capabilities[key];
    if (typeof candidate === 'boolean') capabilities[key] = candidate;
  }
  return {
    id: node.id,
    kind: node.kind,
    category: node.category,
    name: node.name,
    lat: node.lat,
    lon: node.lon,
    distanceKm,
    ...(node.address ? { address: node.address } : {}),
    ...(node.publicPhone ? { publicPhone: node.publicPhone } : {}),
    sourceRefs: node.sourceRefs.map((ref) => ({ provider: ref.provider, recordId: ref.recordId })),
    capabilities,
    source: node.source,
    freshness: node.freshness,
    hazardCompatibility: node.hazardCompatibility,
    fetchedAt: new Date(node.fetchedAt.getTime()),
    operational: node.operational,
    inventory: node.inventory,
    power: node.power,
    access: node.access,
    verification: node.verification,
    observedAt: new Date(node.observedAt.getTime()),
    ...(node.retrievedAt ? { retrievedAt: new Date(node.retrievedAt.getTime()) } : {}),
    ...(node.sourceObservedAt ? { sourceObservedAt: new Date(node.sourceObservedAt.getTime()) } : {}),
    expiresAt: new Date(node.expiresAt.getTime()),
    confidence: node.confidence,
    sourceUrl: node.sourceUrl,
    directoryOnly: node.directoryOnly,
    ...(node.url ? { url: node.url } : {}),
  };
}

/**
 * Revalidates the document event even though its source currently lives in the
 * renderer. This keeps arbitrary scripts from smuggling malformed coordinates
 * or status strings into a safety-adjacent map overlay.
 */
function parseLifelinesOverlayEventDetailUnchecked(value: unknown, now: number): LocalLogisticsSnapshot | null {
  if (!plainRecord(value) || Object.keys(value).length !== 1 || !('snapshot' in value)) return null;
  const snapshot = value.snapshot;
  if (!plainRecord(snapshot) || Object.keys(snapshot).some((key) => !SNAPSHOT_KEYS.has(key))) return null;
  if (snapshot.schemaVersion !== 2 || !boundedString(snapshot.queryFingerprint, 800)) return null;
  if (!boundedString(snapshot.placeId, 180) || !boundedString(snapshot.placeName, 240)) return null;
  if (!finiteInRange(snapshot.effectiveRadiusKm, 1, 50) || !optionalBoundedString(snapshot.countyFips, 5)) return null;
  if (snapshot.countyFips !== undefined && !/^\d{5}$/.test(String(snapshot.countyFips))) return null;
  if (!denseDataArray(snapshot.categories) || snapshot.categories.length > CATEGORIES.size
    || !Array.from(snapshot.categories).every((item) => typeof item === 'string' && CATEGORIES.has(item))) return null;
  const snapshotCategories = Array.from(snapshot.categories) as string[];
  const fingerprint = parseSnapshotFingerprint(snapshot.queryFingerprint);
  if (new Set(snapshotCategories).size !== snapshotCategories.length || !fingerprint
    || fingerprint.radiusKm.toFixed(2) !== snapshot.effectiveRadiusKm.toFixed(2)
    || [...fingerprint.categories].sort().join(',') !== [...snapshotCategories].sort().join(',')) return null;
  if (!validDate(snapshot.fetchedAt)
    || snapshot.fetchedAt.getTime() < EARLIEST_SOURCE_TIME_MS
    || snapshot.fetchedAt.getTime() > now + CLOCK_SKEW_MS) return null;
  if (!denseDataArray(snapshot.nodes) || snapshot.nodes.length > 300
    || !Array.from(snapshot.nodes).every((node) => validNode(node, snapshot.fetchedAt as Date, now))) return null;
  const validatedNodes = Array.from(snapshot.nodes) as LogisticsNode[];
  const nodeDistances = validatedNodes.map((node) => haversineKm(fingerprint.lat, fingerprint.lon, node.lat, node.lon));
  if (validatedNodes.some((node, index) => !snapshotCategories.includes(node.category)
    || !Number.isFinite(nodeDistances[index])
    || (nodeDistances[index] ?? Number.POSITIVE_INFINITY) > fingerprint.radiusKm + 0.25)) return null;
  for (const key of ['sites', 'observations', 'areaConditions', 'providers'] as const) {
    if (!denseDataArray(snapshot[key]) || snapshot[key].length > 1_000) return null;
  }
  if (typeof snapshot.isStale !== 'boolean' || typeof snapshot.isExpired !== 'boolean') return null;
  if (!finiteInRange(snapshot.staleAgeMs, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (snapshot.source !== 'network' && snapshot.source !== 'offline-cache') return null;
  const validated = snapshot as unknown as LocalLogisticsSnapshot;
  return {
    schemaVersion: 2,
    queryFingerprint: validated.queryFingerprint,
    placeId: validated.placeId,
    placeName: validated.placeName,
    effectiveRadiusKm: validated.effectiveRadiusKm,
    ...(validated.countyFips ? { countyFips: validated.countyFips } : {}),
    categories: [...validated.categories],
    // Only map-consumed data crosses this document-event boundary. The full
    // provider/site graph remains owned by the list service and cannot be
    // smuggled through arbitrary nested event objects.
    sites: [],
    observations: [],
    nodes: validated.nodes.map((node, index) => sanitizeNode(node, nodeDistances[index]!)),
    areaConditions: [],
    providers: [],
    fetchedAt: new Date(validated.fetchedAt.getTime()),
    isStale: validated.isStale,
    isExpired: validated.isExpired,
    staleAgeMs: validated.staleAgeMs,
    source: validated.source,
  };
}

export function parseLifelinesOverlayEventDetail(value: unknown, now = Date.now()): LocalLogisticsSnapshot | null {
  return parseLifelinesOverlayEventDetailWithContext(value, now, {
    getPlace: getSavedPlace,
    getCachedSnapshot: getCachedLocalLogistics,
  });
}

/** @internal Injectable exact-cache boundary used by behavior tests. */
export function parseLifelinesOverlayEventDetailWithContext(
  value: unknown,
  now: number,
  context: LifelinesOverlayExactContext,
): LocalLogisticsSnapshot | null {
  try {
    const candidate = parseLifelinesOverlayEventDetailUnchecked(value, now);
    if (!candidate) return null;
    const place = context.getPlace(candidate.placeId);
    if (!place || candidate.placeName !== place.name) return null;
    const cached = context.getCachedSnapshot(place);
    if (!cached
      || candidate.queryFingerprint !== cached.queryFingerprint
      || candidate.effectiveRadiusKm !== cached.effectiveRadiusKm
      || candidate.countyFips !== cached.countyFips
      || candidate.fetchedAt.getTime() !== cached.fetchedAt.getTime()) return null;
    // Render only the exact accepted cache. A structurally valid document
    // event may identify it, but cannot substitute invented official nodes.
    return parseLifelinesOverlayEventDetailUnchecked({ snapshot: cached }, now);
  } catch {
    return null;
  }
}

export interface LifelinesOverlayIdentity {
  placeId: string;
  queryFingerprint: string;
}

/** Request-relevant saved-place identity; stable IDs alone do not pin coordinates. */
export function buildLifelinesPlaceMatchSignature(place: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}): string {
  return JSON.stringify([place.id, place.name, place.lat, place.lon, place.radiusKm]);
}

/** Exact identity envelope used only to clear the matching transient overlay. */
export function parseClearLifelinesOverlayEventDetail(value: unknown): LifelinesOverlayIdentity | null {
  try {
    if (!plainRecord(value) || Object.keys(value).length !== 2) return null;
    if (!boundedString(value.placeId, 180) || !boundedString(value.queryFingerprint, 800)) return null;
    return { placeId: value.placeId, queryFingerprint: value.queryFingerprint };
  } catch {
    return null;
  }
}

export interface TemporaryMapBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  crossesAntimeridian: boolean;
}

/**
 * Bounds shared by both map engines. A set straddling the antimeridian uses a
 * full-world longitude extent because the SVG fallback has no wrapped-world
 * copy; this is less tight but guarantees every point remains visible.
 */
export function getTemporaryMapBounds(coordinates: ReadonlyArray<readonly [number, number]>): TemporaryMapBounds | null {
  if (coordinates.length === 0) return null;
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2
      || !finiteInRange(coordinate[0], -180, 180)
      || !finiteInRange(coordinate[1], -90, 90)) return null;
    minLon = Math.min(minLon, coordinate[0]);
    minLat = Math.min(minLat, coordinate[1]);
    maxLon = Math.max(maxLon, coordinate[0]);
    maxLat = Math.max(maxLat, coordinate[1]);
  }
  const crossesAntimeridian = maxLon - minLon > 180;
  return {
    minLon: crossesAntimeridian ? -180 : minLon,
    minLat,
    maxLon: crossesAntimeridian ? 180 : maxLon,
    maxLat,
    crossesAntimeridian,
  };
}

/** A small generation guard that prevents async map initialization after teardown. */
export function createMapAsyncInitGuard(): {
  begin: () => number;
  isCurrent: (generation: number) => boolean;
  dispose: () => void;
} {
  let generation = 0;
  let disposed = false;
  return {
    begin: () => ++generation,
    isCurrent: (candidate) => !disposed && candidate === generation,
    dispose: () => { disposed = true; generation += 1; },
  };
}

export function getLifelineMarkerPresentation(
  node: Pick<LogisticsNode, 'category' | 'verification' | 'directoryOnly' | 'operational' | 'access' | 'expiresAt'>,
  now = Date.now(),
): LifelineMarkerPresentation {
  let state: LifelineMarkerState;
  let evidenceLabel: string;
  if (node.expiresAt.getTime() <= now) {
    state = 'expired';
    evidenceLabel = 'Verification expired — status unknown';
  } else if (node.directoryOnly || node.verification === 'directory') {
    state = 'directory';
    evidenceLabel = 'Directory listing — availability unknown';
  } else if (node.operational === 'closed' || node.access === 'blocked') {
    state = 'official-closed';
    evidenceLabel = node.access === 'blocked' ? 'Official report: access blocked' : 'Official report: closed';
  } else if (node.operational === 'open') {
    state = 'official-open';
    evidenceLabel = 'Official report: open';
  } else {
    state = 'unknown';
    evidenceLabel = 'Operational status unknown';
  }
  const category = CATEGORY_PRESENTATION[String(node.category)] ?? { label: 'Lifeline', glyph: 'L' };
  const style = STATE_PRESENTATION[state];
  return {
    state,
    categoryLabel: category.label,
    glyph: category.glyph,
    evidenceLabel,
    fillColor: style.fill,
    strokeColor: style.stroke,
  };
}

export function buildExternalMapsUrl(node: Pick<LogisticsNode, 'lat' | 'lon'>): string {
  // Reuse the existing OSM provider instead of adding another external map
  // service. The URL remains inert until the popup's click handler opens it.
  const url = new URL('https://www.openstreetmap.org/');
  url.searchParams.set('mlat', String(node.lat));
  url.searchParams.set('mlon', String(node.lon));
  url.hash = `map=16/${node.lat}/${node.lon}`;
  return url.toString();
}

interface LifelinePopupActionDependencies {
  writeClipboard?: (value: string) => Promise<void>;
  openMaps?: (url: string) => void;
}

/**
 * Bind the only side-effecting Lifeline popup actions. Merely rendering or
 * binding the popup performs no clipboard write or external navigation.
 */
export function bindLifelinePopupActions(
  root: ParentNode,
  node: Pick<LogisticsNode, 'address' | 'lat' | 'lon'>,
  dependencies: LifelinePopupActionDependencies = {},
): void {
  const status = root.querySelector<HTMLElement>('[data-lifeline-action-status]');
  const report = (message: string) => { if (status) status.textContent = message; };
  const writeClipboard = dependencies.writeClipboard
    ?? globalThis.navigator?.clipboard?.writeText?.bind(globalThis.navigator.clipboard);
  const openMaps = dependencies.openMaps
    ?? ((url: string) => { globalThis.window?.open(url, '_blank', 'noopener,noreferrer'); });

  root.querySelectorAll<HTMLButtonElement>('[data-lifeline-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.lifelineCopy === 'address'
        ? node.address
        : `${node.lat.toFixed(6)}, ${node.lon.toFixed(6)}`;
      if (!value || !writeClipboard) {
        report('Copy unavailable');
        return;
      }
      void writeClipboard(value)
        .then(() => report(button.dataset.lifelineCopy === 'address' ? 'Address copied' : 'Coordinates copied'))
        .catch(() => report('Copy failed'));
    });
  });
  root.querySelector<HTMLButtonElement>('[data-lifeline-open-maps]')?.addEventListener('click', () => {
    openMaps(buildExternalMapsUrl(node));
  });
}
