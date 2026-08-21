import { haversineKm } from './proximity-filter';
import { readOfflineCacheEntry, writeOfflineCacheEntry } from './offline-alert-cache';
import { getApiBaseUrl } from './runtime';
import type { SavedPlace } from './saved-places';
import {
  LOCAL_LOGISTICS_CATEGORIES,
  LOCAL_LOGISTICS_CATEGORY_LABELS,
  LOCAL_LOGISTICS_SCHEMA_VERSION,
  type AccessStatus,
  type AreaCondition,
  type InventoryStatus,
  type LocalLogisticsSnapshot,
  type LogisticsCategory,
  type LogisticsHazardCompatibility,
  type LogisticsNode,
  type OperationalStatus,
  type ObservationConfidence,
  type PowerStatus,
  type ProviderState,
  type ProviderStatus,
  type ResourceObservation,
  type ResourceSite,
  type VerificationMethod,
} from './local-logistics-types';

export { LOCAL_LOGISTICS_CATEGORIES, LOCAL_LOGISTICS_CATEGORY_LABELS } from './local-logistics-types';
export type {
  AccessStatus,
  AreaCondition,
  InventoryStatus,
  LocalLogisticsSnapshot,
  LogisticsCategory,
  LogisticsNode,
  OperationalStatus,
  PowerStatus,
  ProviderStatus,
  ResourceObservation,
  ResourceSite,
  VerificationMethod,
} from './local-logistics-types';

interface FetchLocalLogisticsOptions {
  categories?: LogisticsCategory[];
  radiusKm?: number;
  limitPerCategory?: number;
}

interface BuildSnapshotOptions {
  fetchedAt?: Date;
  isStale?: boolean;
  isExpired?: boolean;
  staleAgeMs?: number;
  source?: LocalLogisticsSnapshot['source'];
  queryFingerprint?: string;
  effectiveRadiusKm?: number;
  countyFips?: string;
  areaConditions?: AreaCondition[];
  providers?: ProviderStatus[];
  sites?: ResourceSite[];
  observations?: ResourceObservation[];
  categories?: LogisticsCategory[];
}

interface CachedLocalLogisticsSnapshot {
  schemaVersion: 2;
  queryFingerprint: string;
  placeId: string;
  placeName: string;
  effectiveRadiusKm: number;
  countyFips?: string;
  categories: LogisticsCategory[];
  sites: ResourceSite[];
  observations: (Omit<ResourceObservation, 'observedAt' | 'retrievedAt' | 'sourceObservedAt' | 'expiresAt'> & {
 observedAt: string;
 retrievedAt?: string;
 sourceObservedAt?: string;
 expiresAt: string;
  })[];
  nodes: (Omit<LogisticsNode, 'fetchedAt' | 'observedAt' | 'retrievedAt' | 'sourceObservedAt' | 'expiresAt'> & {
 fetchedAt: string;
 observedAt: string;
 retrievedAt?: string;
 sourceObservedAt?: string;
 expiresAt: string;
  })[];
  areaConditions: (Omit<AreaCondition, 'observedAt' | 'retrievedAt' | 'sourceObservedAt' | 'expiresAt'> & {
 observedAt: string;
 retrievedAt?: string;
 sourceObservedAt?: string;
 expiresAt: string;
  })[];
  providers: (Omit<ProviderStatus, 'observedAt' | 'retrievedAt' | 'sourceObservedAt'> & {
 observedAt: string | null;
 retrievedAt?: string | null;
 sourceObservedAt?: string | null;
  })[];
  fetchedAt: string;
}

interface ParsedLogisticsPayload {
  sites: ResourceSite[];
  observations: ResourceObservation[];
  nodes: LogisticsNode[];
  providers: ProviderStatus[];
  fetchedAt: Date;
  retrievedAt: Date;
  countyFips?: string;
  categories: LogisticsCategory[];
  effectiveRadiusKm: number;
}

interface LocalLogisticsBriefItem {
  kind: 'logistics';
  label: string;
  value: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  link?: string;
}

type LocatedResourceSite = ResourceSite & { distanceKm: number };

interface ParsedObservationDates {
  observedAt: Date;
  retrievedAt: Date;
  sourceObservedAt: Date | null;
  expiresAt: Date;
}

const CACHE_PREFIX = 'local-logistics:v2';
const CACHE_EXPIRE_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_OBSERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const FEMA_OBSERVATION_TTL_MS = 30 * 60 * 1000;
const ODIN_OBSERVATION_TTL_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const PREWARM_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_RADIUS_KM = 25;
const DEFAULT_LIMIT_PER_CATEGORY = 3;
const MAX_RESOURCE_ROWS = LOCAL_LOGISTICS_CATEGORIES.length * 5;
const MAX_PROVIDER_ROWS = 4;
const MAX_PROVIDER_ROW_COUNT = 5000;
const MAX_AREA_CONDITION_ROWS = 100;
const MAX_CUSTOMERS_OUT = 100_000_000;
const memoryCache = new Map<string, CachedLocalLogisticsSnapshot>();
const latestFingerprintByPlace = new Map<string, string>();
const inFlight = new Map<string, Promise<LocalLogisticsSnapshot>>();
const lastPrewarmByPlace = new Map<string, number>();

const OPERATIONAL = new Set<OperationalStatus>(['open', 'closed', 'unknown']);
const INVENTORY = new Set<InventoryStatus>(['available', 'limited', 'full', 'out', 'unknown']);
const POWER = new Set<PowerStatus>(['grid', 'generator', 'outage', 'unknown']);
const ACCESS = new Set<AccessStatus>(['reachable', 'blocked', 'unknown']);
const VERIFICATION = new Set<VerificationMethod>(['directory', 'official']);
const CONFIDENCE = new Set<ObservationConfidence>(['high', 'medium', 'low', 'unknown']);
const PROVIDER_STATES = new Set<ProviderState>(['ok', 'empty', 'partial', 'stale', 'error']);
const EARLIEST_SOURCE_TIME_MS = Date.UTC(2000, 0, 1);

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, maximum = 100): void {
  if (!map.has(key) && map.size >= maximum) {
 const oldest = map.keys().next().value as K | undefined;
 if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function isValidRfc3339CivilTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (!year || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (monthDays[month - 1] ?? 0);
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !isValidRfc3339CivilTime(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseNullableDate(value: unknown, fallback: Date | null): Date | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return parseDate(value);
}

function isBoundedSourceTime(sourceObservedAt: Date, retrievedAt: Date): boolean {
  return sourceObservedAt.getTime() >= EARLIEST_SOURCE_TIME_MS
    && sourceObservedAt.getTime() <= retrievedAt.getTime() + 5 * 60 * 1000;
}

function safeString(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function publicPhone(value: unknown): string | undefined {
  const phone = safeString(value, 80);
  return phone && /^[+()\d\s.\-ext]+$/i.test(phone) ? phone : undefined;
}

function trustedSourceUrl(value: unknown, provider: 'osm' | 'fema'): string | null {
  const raw = safeString(value);
  if (!raw) return null;
  try {
 const url = new URL(raw);
 const allowed = provider === 'osm'
 ? url.protocol === 'https:' && (url.hostname === 'www.openstreetmap.org' || url.hostname === 'openstreetmap.org')
 : url.protocol === 'https:' && url.hostname === 'gis.fema.gov';
 return allowed ? url.toString() : null;
  } catch {
 return null;
  }
}

export function buildLocalLogisticsFingerprint(
  place: Pick<SavedPlace, 'lat' | 'lon'>,
  radiusKm: number,
  categories: LogisticsCategory[],
  limitPerCategory = DEFAULT_LIMIT_PER_CATEGORY,
): string {
  return [
 `v${LOCAL_LOGISTICS_SCHEMA_VERSION}`,
 place.lat.toFixed(5),
 place.lon.toFixed(5),
 radiusKm.toFixed(2),
 [...categories].sort(compareStrings).join(','),
 String(limitPerCategory),
  ].join('|');
}

function parseLogisticsFingerprint(value: string): {
  lat: number; lon: number; radiusKm: number; categories: LogisticsCategory[]; limitPerCategory: number;
} | null {
  const [version, latRaw, lonRaw, radiusRaw, categoriesRaw, limitRaw, ...rest] = value.split('|');
  if (rest.length > 0 || version !== `v${LOCAL_LOGISTICS_SCHEMA_VERSION}`) return null;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const radiusKm = Number(radiusRaw);
  const limitPerCategory = Number(limitRaw);
  const categories = categoriesRaw?.split(',').filter((item): item is LogisticsCategory =>
    LOCAL_LOGISTICS_CATEGORIES.includes(item as LogisticsCategory)) ?? [];
  if (!isCoordinate(lat, -90, 90) || !isCoordinate(lon, -180, 180)
    || !isNonNegativeFinite(radiusKm) || radiusKm < 1 || radiusKm > 50
    || !Number.isSafeInteger(limitPerCategory) || limitPerCategory < 1 || limitPerCategory > 5
    || categories.length !== (categoriesRaw ? categoriesRaw.split(',').length : 0)) return null;
  return { lat, lon, radiusKm, categories, limitPerCategory };
}

function cacheKey(placeId: string, fingerprint: string): string {
  return `${CACHE_PREFIX}:${placeId}:${fingerprint}`;
}

/** Stable service ID used by the offline cache and Lifelines readiness verifier. */
export function getLocalLogisticsOfflineCacheServiceId(placeId: string, fingerprint: string): string {
  return cacheKey(placeId, fingerprint);
}

function latestKey(placeId: string): string {
  return `${CACHE_PREFIX}:latest:${placeId}`;
}

function emitLocalLogisticsUpdated(snapshot: LocalLogisticsSnapshot): void {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent('wm:local-logistics-updated', { detail: snapshot }));
}

function hazardCompatibility(category: LogisticsCategory): LogisticsHazardCompatibility {
  if (category === 'shelter' || category === 'hotel') return 'evacuation';
  if (category === 'hospital' || category === 'pharmacy') return 'medical';
  if (category === 'fuel' || category === 'water') return 'supply';
  return 'general';
}

function logisticsSourceLabel(site: ResourceSite): string {
  if (site.sourceRefs[0]?.provider !== 'fema') return 'OpenStreetMap directory';
  return site.kind === 'recovery' ? 'FEMA Disaster Recovery Centers' : 'FEMA Open Shelters';
}

function freshness(observedAt: Date, expiresAt: Date, now: number): LogisticsNode['freshness'] {
  if (expiresAt.getTime() <= now) return 'stale';
  return now - observedAt.getTime() <= 6 * 60 * 60 * 1000 ? 'fresh' : 'recent';
}

function parseProviderDates(
  value: Record<string, unknown>,
  now: number,
): Pick<ProviderStatus, 'observedAt' | 'retrievedAt' | 'sourceObservedAt'> | null {
  const observedAt = value.observedAt === null ? null : parseDate(value.observedAt);
  if (value.observedAt !== null && !observedAt) return null;
  const retrievedAt = parseNullableDate(value.retrievedAt, observedAt);
  if (value.retrievedAt !== undefined && value.retrievedAt !== null && !retrievedAt) return null;
  if (retrievedAt && (retrievedAt.getTime() < EARLIEST_SOURCE_TIME_MS || retrievedAt.getTime() > now + CLOCK_SKEW_MS)) return null;
  if (observedAt && retrievedAt && observedAt.getTime() !== retrievedAt.getTime()) return null;
  const sourceObservedAt = parseNullableDate(value.sourceObservedAt, null);
  if (value.sourceObservedAt !== undefined && value.sourceObservedAt !== null && !sourceObservedAt) return null;
  if (sourceObservedAt && (!retrievedAt || !isBoundedSourceTime(sourceObservedAt, retrievedAt))) return null;
  return { observedAt, retrievedAt, ...(sourceObservedAt ? { sourceObservedAt } : {}) };
}

function parseProvider(value: unknown, now = Date.now()): ProviderStatus | null {
  if (!isRecord(value)) return null;
  const ids = new Set(['osm', 'fema-open-shelters', 'fema-recovery-centers', 'ornl-odin']);
  if (typeof value.id !== 'string' || !ids.has(value.id)) return null;
  if (typeof value.state !== 'string' || !PROVIDER_STATES.has(value.state as ProviderState)) return null;
  if (!isNonNegativeInteger(value.acceptedRows) || value.acceptedRows > MAX_PROVIDER_ROW_COUNT
    || !isNonNegativeInteger(value.droppedRows) || value.droppedRows > MAX_PROVIDER_ROW_COUNT) return null;
  const dates = parseProviderDates(value, now);
  if (!dates) return null;
  return {
 id: value.id as ProviderStatus['id'],
 state: value.state as ProviderState,
 acceptedRows: value.acceptedRows as number,
 droppedRows: value.droppedRows as number,
 ...dates,
 ...(safeString(value.reasonCode) ? { reasonCode: safeString(value.reasonCode) } : {}),
  };
}

function observationStatusesAreValid(value: Record<string, unknown>): boolean {
  return VERIFICATION.has(value.verification as VerificationMethod)
    && OPERATIONAL.has(value.operational as OperationalStatus)
    && INVENTORY.has(value.inventory as InventoryStatus)
    && POWER.has(value.power as PowerStatus)
    && ACCESS.has(value.access as AccessStatus)
    && CONFIDENCE.has(value.confidence as ObservationConfidence);
}

function parseObservationDates(
  value: Record<string, unknown>,
  maximumTtlMs: number,
  now: number,
): ParsedObservationDates | null {
  const observedAt = parseDate(value.observedAt);
  const retrievedAt = value.retrievedAt === undefined ? observedAt : parseDate(value.retrievedAt);
  const sourceObservedAt = value.sourceObservedAt === undefined ? null : parseDate(value.sourceObservedAt);
  const expiresAt = parseDate(value.expiresAt);
  if (!observedAt || !retrievedAt || !expiresAt || observedAt.getTime() !== retrievedAt.getTime()) return null;
  if (retrievedAt.getTime() < EARLIEST_SOURCE_TIME_MS || retrievedAt.getTime() > now + CLOCK_SKEW_MS) return null;
  if (expiresAt.getTime() < retrievedAt.getTime()
    || expiresAt.getTime() > retrievedAt.getTime() + maximumTtlMs) return null;
  if (value.sourceObservedAt !== undefined && !sourceObservedAt) return null;
  if (sourceObservedAt && !isBoundedSourceTime(sourceObservedAt, retrievedAt)) return null;
  return { observedAt, retrievedAt, sourceObservedAt, expiresAt };
}

function parseSourceRefs(value: unknown): ResourceSite['sourceRefs'] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const refs: ResourceSite['sourceRefs'] = [];
  for (const ref of value) {
 if (!isRecord(ref) || (ref.provider !== 'osm' && ref.provider !== 'fema') || !safeString(ref.recordId)) return null;
 refs.push({ provider: ref.provider, recordId: safeString(ref.recordId) as string });
  }
  return refs;
}

function parseCapabilities(value: Record<string, unknown>): ResourceSite['capabilities'] {
  const capabilities: ResourceSite['capabilities'] = {};
  const lodgingType = safeString(value.lodgingType);
  if (lodgingType === 'hotel' || lodgingType === 'motel' || lodgingType === 'hostel' || lodgingType === 'other') {
    capabilities.lodgingType = lodgingType;
  }
  const directoryHours = safeString(value.directoryHours);
  if (directoryHours) capabilities.directoryHours = directoryHours;
  for (const key of ['evacuationCapacity', 'postImpactCapacity', 'reportedPopulation'] as const) {
    const parsed = value[key];
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) capabilities[key] = parsed;
  }
  for (const key of ['ada', 'wheelchairAccessible', 'pets', 'generatorOnsite'] as const) {
    const parsed = value[key];
    if (typeof parsed === 'boolean') capabilities[key] = parsed;
  }
  return capabilities;
}

function parseSite(value: unknown): ResourceSite | null {
  if (!isRecord(value)) return null;
  const id = safeString(value.id, 160);
  const name = safeString(value.name, 240);
  if (!id || !name) return null;
  if (!LOCAL_LOGISTICS_CATEGORIES.includes(value.kind as LogisticsCategory)) return null;
  if (!isCoordinate(value.lat, -90, 90) || !isCoordinate(value.lon, -180, 180)) return null;
  const sourceRefs = parseSourceRefs(value.sourceRefs);
  if (!sourceRefs || !isRecord(value.capabilities)) return null;
  const capabilities = parseCapabilities(value.capabilities);
  const address = safeString(value.address, 400);
  const phone = publicPhone(value.publicPhone);
  const directoryUrl = trustedSourceUrl(value.directoryUrl, sourceRefs[0]?.provider ?? 'osm');
  return {
 id,
 kind: value.kind as LogisticsCategory,
 name,
 lat: value.lat,
 lon: value.lon,
 ...(isNonNegativeFinite(value.distanceKm) ? { distanceKm: value.distanceKm } : {}),
 ...(address ? { address } : {}),
 ...(phone ? { publicPhone: phone } : {}),
 ...(directoryUrl ? { directoryUrl } : {}),
 sourceRefs,
 capabilities,
  };
}

function observationMatchesProviderContract(value: Record<string, unknown>): boolean {
  if (value.provider === 'osm') {
    return value.verification === 'directory'
      && value.operational === 'unknown'
      && value.inventory === 'unknown'
      && value.power === 'unknown'
      && value.access === 'unknown'
      && value.confidence === 'low';
  }
  return value.verification === 'official'
    && value.operational === 'open'
    && value.inventory === 'unknown'
    && value.power === 'unknown'
    && value.access === 'unknown'
    && value.confidence === 'high';
}

function parseObservation(value: unknown, now = Date.now()): ResourceObservation | null {
  if (!isRecord(value)) return null;
  const id = safeString(value.id);
  const siteId = safeString(value.siteId);
  if (!id || !siteId) return null;
  if (value.provider !== 'osm' && value.provider !== 'fema') return null;
  if (!observationStatusesAreValid(value)) return null;
  const maximumTtlMs = value.provider === 'osm' ? DIRECTORY_OBSERVATION_TTL_MS : FEMA_OBSERVATION_TTL_MS;
  const dates = parseObservationDates(value, maximumTtlMs, now);
  if (!dates) return null;
  if (!observationMatchesProviderContract(value)) return null;
  const sourceUrl = trustedSourceUrl(value.sourceUrl, value.provider);
  if (!sourceUrl) return null;
  return {
 id,
 siteId,
 provider: value.provider,
 verification: value.verification as VerificationMethod,
 operational: value.operational as OperationalStatus,
 inventory: value.inventory as InventoryStatus,
 power: value.power as PowerStatus,
 access: value.access as AccessStatus,
 observedAt: dates.observedAt,
 retrievedAt: dates.retrievedAt,
 ...(dates.sourceObservedAt ? { sourceObservedAt: dates.sourceObservedAt } : {}),
 expiresAt: dates.expiresAt,
 confidence: value.confidence as ObservationConfidence,
 sourceUrl,
  };
}

function compareObservations(left: ResourceObservation, right: ResourceObservation, now: number): number {
  const currentDiff = Number(right.expiresAt.getTime() > now) - Number(left.expiresAt.getTime() > now);
  if (currentDiff !== 0) return currentDiff;
  const verificationDiff = Number(right.verification === 'official') - Number(left.verification === 'official');
  if (verificationDiff !== 0) return verificationDiff;
  return (right.retrievedAt ?? right.observedAt).getTime() - (left.retrievedAt ?? left.observedAt).getTime();
}

function groupObservationsBySite(observations: ResourceObservation[]): Map<string, ResourceObservation[]> {
  const observationsBySite = new Map<string, ResourceObservation[]>();
  for (const observation of observations) {
    const bucket = observationsBySite.get(observation.siteId) ?? [];
    bucket.push(observation);
    observationsBySite.set(observation.siteId, bucket);
  }
  return observationsBySite;
}

function buildLogisticsNodes(
  sites: LocatedResourceSite[],
  observations: ResourceObservation[],
  fetchedAt: Date,
  now: number,
): LogisticsNode[] {
  const observationsBySite = groupObservationsBySite(observations);
  const nodes: LogisticsNode[] = [];
  for (const site of sites) {
    const observation = [...(observationsBySite.get(site.id) ?? [])]
      .sort((left, right) => compareObservations(left, right, now))[0];
    if (!observation) continue;
    nodes.push({
      ...site,
      category: site.kind,
      source: logisticsSourceLabel(site),
      freshness: freshness(observation.retrievedAt ?? observation.observedAt, observation.expiresAt, now),
      hazardCompatibility: hazardCompatibility(site.kind),
      fetchedAt,
      operational: observation.operational,
      inventory: observation.inventory,
      power: observation.power,
      access: observation.access,
      verification: observation.verification,
      observedAt: observation.observedAt,
      retrievedAt: observation.retrievedAt,
      ...(observation.sourceObservedAt ? { sourceObservedAt: observation.sourceObservedAt } : {}),
      expiresAt: observation.expiresAt,
      confidence: observation.confidence,
      sourceUrl: observation.sourceUrl,
      directoryOnly: observation.verification === 'directory',
      ...(site.directoryUrl ? { url: site.directoryUrl } : {}),
    });
  }
  return nodes;
}

function countProviderContributions(
  observations: ResourceObservation[],
  siteById: Map<string, LocatedResourceSite>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const observation of observations) {
    const site = siteById.get(observation.siteId);
    const providerId = site ? providerIdForObservation(site, observation) : null;
    if (providerId) counts.set(providerId, (counts.get(providerId) ?? 0) + 1);
  }
  return counts;
}

function expectedLocalProviderIds(categories: LogisticsCategory[]): string[] {
  return [
    ...(categories.some((category) => category !== 'recovery') ? ['osm'] : []),
    ...(categories.includes('shelter') ? ['fema-open-shelters'] : []),
    ...(categories.includes('recovery') ? ['fema-recovery-centers'] : []),
  ];
}

function providerIdForObservation(site: ResourceSite, observation: ResourceObservation): ProviderStatus['id'] | null {
  if (!site.sourceRefs.some((sourceRef) => sourceRef.provider === observation.provider)) return null;
  if (observation.provider === 'osm') return site.kind === 'recovery' ? null : 'osm';
  if (site.kind === 'recovery') return 'fema-recovery-centers';
  return site.kind === 'shelter' ? 'fema-open-shelters' : null;
}

function reconcileProvider(provider: ProviderStatus, contributedRows: number): ProviderStatus {
  if (provider.state !== 'ok' && provider.state !== 'partial') {
    return { ...provider, acceptedRows: 0 };
  }
  if (contributedRows === 0) {
    return {
      ...provider, state: 'error', acceptedRows: 0,
      droppedRows: provider.droppedRows + provider.acceptedRows,
      reasonCode: 'no_contributed_rows',
    };
  }
  if (provider.acceptedRows !== contributedRows) {
    return {
      ...provider, state: 'partial', acceptedRows: contributedRows,
      droppedRows: provider.droppedRows + Math.abs(provider.acceptedRows - contributedRows),
      reasonCode: 'rows_reconciled',
    };
  }
  return provider;
}

interface ApiLogisticsEnvelope {
  query: Record<string, unknown> & { categories: unknown[]; radiusKm: number };
  sites: unknown[];
  observations: unknown[];
  providers: unknown[];
  fetchedAt: unknown;
  retrievedAt: unknown;
}

function parseApiEnvelope(place: SavedPlace, payload: unknown): ApiLogisticsEnvelope {
  if (!isRecord(payload) || payload.schemaVersion !== LOCAL_LOGISTICS_SCHEMA_VERSION) throw new Error('unsupported lifelines schema');
  if (!isRecord(payload.query) || !Array.isArray(payload.query.categories)) throw new Error('malformed lifelines query');
  if (payload.query.lat !== place.lat || payload.query.lon !== place.lon) throw new Error('lifelines location mismatch');
  if (!isNonNegativeFinite(payload.query.radiusKm) || payload.query.radiusKm < 1 || payload.query.radiusKm > 50) {
    throw new Error('malformed lifelines radius');
  }
  if (!Array.isArray(payload.sites) || !Array.isArray(payload.observations) || !Array.isArray(payload.providers)) {
    throw new TypeError('malformed lifelines response');
  }
  if (payload.sites.length > MAX_RESOURCE_ROWS || payload.observations.length > MAX_RESOURCE_ROWS
    || payload.providers.length > MAX_PROVIDER_ROWS
    || (payload.nodes !== undefined && (!Array.isArray(payload.nodes) || payload.nodes.length > MAX_RESOURCE_ROWS))) {
    throw new Error('oversized lifelines response');
  }
  return {
    query: payload.query as ApiLogisticsEnvelope['query'],
    sites: payload.sites,
    observations: payload.observations,
    providers: payload.providers,
    fetchedAt: payload.fetchedAt,
    retrievedAt: payload.retrievedAt,
  };
}

function parseApiRetrievalTime(envelope: ApiLogisticsEnvelope, now: number): { fetchedAt: Date; retrievedAt: Date } {
  const fetchedAt = parseDate(envelope.fetchedAt);
  if (!fetchedAt) throw new Error('malformed lifelines timestamp');
  const retrievedAt = envelope.retrievedAt === undefined ? fetchedAt : parseDate(envelope.retrievedAt);
  if (retrievedAt?.getTime() !== fetchedAt.getTime()) throw new Error('malformed lifelines retrieval timestamp');
  if (retrievedAt.getTime() < EARLIEST_SOURCE_TIME_MS || retrievedAt.getTime() > now + CLOCK_SKEW_MS) {
    throw new Error('malformed lifelines retrieval timestamp');
  }
  return { fetchedAt, retrievedAt };
}

function parseCategories(value: unknown[]): LogisticsCategory[] | null {
  const categories = value.filter((item): item is LogisticsCategory =>
    typeof item === 'string' && LOCAL_LOGISTICS_CATEGORIES.includes(item as LogisticsCategory));
  return categories.length === value.length && new Set(categories).size === categories.length ? categories : null;
}

function categoriesMatchExpected(categories: LogisticsCategory[], expectedCategories?: LogisticsCategory[]): boolean {
  if (!expectedCategories) return true;
  const actual = [...categories].sort(compareStrings).join(',');
  const expected = [...new Set(expectedCategories)].sort(compareStrings).join(',');
  return actual === expected;
}

function parseProviderCollection(
  rawProviders: unknown[],
  categories: LogisticsCategory[],
  now: number,
  includeGrid: boolean,
): { providers: ProviderStatus[]; byId: Map<ProviderStatus['id'], ProviderStatus> } | null {
  const providers = rawProviders.map((provider) => parseProvider(provider, now))
    .filter((provider): provider is ProviderStatus => Boolean(provider));
  if (providers.length !== rawProviders.length) return null;
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  if (byId.size !== providers.length) return null;
  const gridIds = includeGrid ? ['ornl-odin'] : [];
  const expectedIds = [...expectedLocalProviderIds(categories), ...gridIds].sort(compareStrings);
  return [...byId.keys()].sort(compareStrings).join(',') === expectedIds.join(',') ? { providers, byId } : null;
}

function parseLocatedSites(rawSites: unknown[], lat: number, lon: number): LocatedResourceSite[] {
  return rawSites.map((site) => parseSite(site))
    .filter((site): site is ResourceSite => Boolean(site))
    .map((site) => ({ ...site, distanceKm: haversineKm(lat, lon, site.lat, site.lon) }));
}

function parseActiveObservations(
  rawObservations: unknown[],
  siteById: Map<string, LocatedResourceSite>,
  providerById: Map<ProviderStatus['id'], ProviderStatus>,
  now: number,
): ResourceObservation[] {
  return rawObservations.map((observation) => parseObservation(observation, now))
    .filter((item): item is ResourceObservation => Boolean(item))
    .filter((observation) => {
      const site = siteById.get(observation.siteId);
      if (!site) return false;
      const providerId = providerIdForObservation(site, observation);
      const provider = providerId ? providerById.get(providerId) : undefined;
      return provider?.state === 'ok' || provider?.state === 'partial';
    });
}

export function parseLocalLogisticsApiResponse(
  place: SavedPlace,
  payload: unknown,
  now = Date.now(),
  expectedCategories?: LogisticsCategory[],
): ParsedLogisticsPayload {
  const envelope = parseApiEnvelope(place, payload);
  const { fetchedAt, retrievedAt } = parseApiRetrievalTime(envelope, now);
  const categories = parseCategories(envelope.query.categories);
  if (!categories) throw new Error('malformed lifelines categories');
  if (!categoriesMatchExpected(categories, expectedCategories)) throw new Error('lifelines categories mismatch');
  const sites = parseLocatedSites(envelope.sites, place.lat, place.lon);
  if (sites.some((site) => !categories.includes(site.kind))) throw new Error('lifelines site category mismatch');
  const parsedProviders = envelope.providers.map((provider) => parseProvider(provider, now))
    .filter((provider): provider is ProviderStatus => Boolean(provider));
  if (envelope.providers.length !== parsedProviders.length) throw new Error('lifelines providers failed validation');
  const providerById = new Map(parsedProviders.map((provider) => [provider.id, provider]));
  if (providerById.size !== parsedProviders.length) throw new Error('duplicate lifelines provider');
  const expectedProviderIds = expectedLocalProviderIds(categories).sort(compareStrings);
  if ([...providerById.keys()].sort(compareStrings).join(',') !== expectedProviderIds.join(',')) {
    throw new Error('lifelines provider coverage mismatch');
  }
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const observations = parseActiveObservations(envelope.observations, siteById, providerById, now);
  if (envelope.sites.length > 0 && sites.length === 0) throw new Error('lifelines sites failed validation');
  if (envelope.observations.length > 0 && observations.length === 0) throw new Error('lifelines observations failed validation');
  const nodes = buildLogisticsNodes(sites, observations, fetchedAt, now);
  const contributionCounts = countProviderContributions(observations, siteById);
  const providers = parsedProviders.map((provider) =>
    reconcileProvider(provider, contributionCounts.get(provider.id) ?? 0));
  if (nodes.length !== sites.length) throw new Error('lifelines sites have no valid observations');
  const countyFips = safeString(envelope.query.countyFips);
  if (envelope.query.countyFips !== undefined && (!countyFips || !/^\d{5}$/.test(countyFips))) {
    throw new Error('malformed lifelines county FIPS');
  }
  return {
 sites, observations, nodes, providers, fetchedAt, retrievedAt, categories,
 effectiveRadiusKm: envelope.query.radiusKm,
 ...(countyFips ? { countyFips } : {}),
  };
}

function parseAreaCondition(row: unknown, expectedCountyFips?: string, now = Date.now()): AreaCondition | null {
  if (!isRecord(row) || row.type !== 'power_outage' || row.source !== 'ornl-odin') return null;
  const countyFips = safeString(row.countyFips);
  if (!countyFips || !/^\d{5}$/.test(countyFips) || (expectedCountyFips && countyFips !== expectedCountyFips)) return null;
  if (row.coverage !== 'reported' && row.coverage !== 'unknown') return null;
  const county = safeString(row.county);
  const state = safeString(row.state);
  if (!county || !state || !isNonNegativeInteger(row.customersOut) || row.customersOut > MAX_CUSTOMERS_OUT) return null;
  const dates = parseObservationDates(row, ODIN_OBSERVATION_TTL_MS, now);
  if (!dates) return null;
  return {
    id: safeString(row.id) ?? `ornl-odin:${countyFips}:${safeString(row.utilityId) ?? 'county'}`,
    type: 'power_outage', coverage: row.coverage, countyFips, county, state,
    customersOut: row.customersOut, observedAt: dates.observedAt, retrievedAt: dates.retrievedAt,
    ...(dates.sourceObservedAt ? { sourceObservedAt: dates.sourceObservedAt } : {}),
    expiresAt: dates.expiresAt, source: 'ornl-odin',
    ...(isNonNegativeInteger(row.customersRestored) && row.customersRestored <= MAX_CUSTOMERS_OUT
      ? { customersRestored: row.customersRestored } : {}),
    ...(safeString(row.utilityName) ? { utilityName: safeString(row.utilityName) } : {}),
    ...(safeString(row.utilityId) ? { utilityId: safeString(row.utilityId) } : {}),
  };
}

function parseGridOutages(payload: unknown, countyFips: string, now = Date.now()): { areaConditions: AreaCondition[]; provider: ProviderStatus } {
  const fallback: ProviderStatus = {
 id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows: 0, observedAt: null, reasonCode: 'malformed_response',
  };
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.outages)
    || payload.outages.length > MAX_AREA_CONDITION_ROWS || !isRecord(payload.provider)) {
 return { areaConditions: [], provider: fallback };
  }
  const parsedProvider = parseProvider(payload.provider, now);
  if (parsedProvider?.id !== 'ornl-odin') return { areaConditions: [], provider: fallback };
  const coverage = payload.coverage === 'reported' ? 'reported' : 'unknown';
  const areaConditions: AreaCondition[] = [];
  for (const row of payload.outages) {
    if (!isRecord(row) || row.fips !== countyFips) continue;
    const condition = parseAreaCondition({
      ...row,
      id: `ornl-odin:${countyFips}:${safeString(row.utilityId) ?? 'county'}`,
      type: 'power_outage', coverage, countyFips, source: 'ornl-odin',
    }, countyFips, now);
    if (condition && (parsedProvider.state === 'ok' || parsedProvider.state === 'partial')) {
      areaConditions.push(condition);
    }
  }
  return { areaConditions, provider: reconcileProvider(parsedProvider, areaConditions.length) };
}

function serializeSnapshot(snapshot: LocalLogisticsSnapshot): CachedLocalLogisticsSnapshot {
  return {
 schemaVersion: 2, queryFingerprint: snapshot.queryFingerprint, placeId: snapshot.placeId, placeName: snapshot.placeName,
 effectiveRadiusKm: snapshot.effectiveRadiusKm,
 ...(snapshot.countyFips ? { countyFips: snapshot.countyFips } : {}),
 categories: [...snapshot.categories],
 sites: snapshot.sites,
 observations: snapshot.observations.map(({
 observedAt, retrievedAt, sourceObservedAt, expiresAt, ...observation
 }) => ({
 ...observation,
 observedAt: observedAt.toISOString(),
 ...(retrievedAt ? { retrievedAt: retrievedAt.toISOString() } : {}),
 ...(sourceObservedAt ? { sourceObservedAt: sourceObservedAt.toISOString() } : {}),
 expiresAt: expiresAt.toISOString(),
 })),
 nodes: snapshot.nodes.map(({
 fetchedAt: nodeFetchedAt, observedAt, retrievedAt, sourceObservedAt, expiresAt, ...node
 }) => ({
 ...node,
 fetchedAt: nodeFetchedAt.toISOString(),
 observedAt: observedAt.toISOString(),
 ...(retrievedAt ? { retrievedAt: retrievedAt.toISOString() } : {}),
 ...(sourceObservedAt ? { sourceObservedAt: sourceObservedAt.toISOString() } : {}),
 expiresAt: expiresAt.toISOString(),
 })),
 areaConditions: snapshot.areaConditions.map(({
 observedAt, retrievedAt, sourceObservedAt, expiresAt, ...condition
 }) => ({
 ...condition,
 observedAt: observedAt.toISOString(),
 ...(retrievedAt ? { retrievedAt: retrievedAt.toISOString() } : {}),
 ...(sourceObservedAt ? { sourceObservedAt: sourceObservedAt.toISOString() } : {}),
 expiresAt: expiresAt.toISOString(),
 })),
 providers: snapshot.providers.map(({
 observedAt, retrievedAt, sourceObservedAt, ...provider
 }) => ({
 ...provider,
 observedAt: observedAt?.toISOString() ?? null,
 ...(retrievedAt === undefined ? {} : { retrievedAt: retrievedAt?.toISOString() ?? null }),
 ...(sourceObservedAt === undefined ? {} : { sourceObservedAt: sourceObservedAt?.toISOString() ?? null }),
 })),
 fetchedAt: snapshot.fetchedAt.toISOString(),
  };
}

interface CachedLogisticsEnvelope {
  categories: unknown[];
  sites: unknown[];
  observations: unknown[];
  areaConditions: unknown[];
  providers: unknown[];
  queryFingerprint: unknown;
  placeId: unknown;
  placeName: unknown;
  fetchedAt: unknown;
  effectiveRadiusKm: number;
  countyFips: unknown;
}

function parseCachedEnvelope(cached: unknown): CachedLogisticsEnvelope | null {
  if (!isRecord(cached) || cached.schemaVersion !== LOCAL_LOGISTICS_SCHEMA_VERSION) return null;
  if (!Array.isArray(cached.categories) || !Array.isArray(cached.sites)
    || !Array.isArray(cached.observations) || !Array.isArray(cached.nodes)
    || !Array.isArray(cached.areaConditions) || !Array.isArray(cached.providers)) return null;
  if (cached.sites.length > MAX_RESOURCE_ROWS || cached.observations.length > MAX_RESOURCE_ROWS
    || cached.nodes.length > MAX_RESOURCE_ROWS || cached.areaConditions.length > MAX_AREA_CONDITION_ROWS
    || cached.providers.length > MAX_PROVIDER_ROWS) return null;
  if (!isNonNegativeFinite(cached.effectiveRadiusKm)
    || cached.effectiveRadiusKm < 1 || cached.effectiveRadiusKm > 50) return null;
  return {
    categories: cached.categories,
    sites: cached.sites,
    observations: cached.observations,
    areaConditions: cached.areaConditions,
    providers: cached.providers,
    queryFingerprint: cached.queryFingerprint,
    placeId: cached.placeId,
    placeName: cached.placeName,
    fetchedAt: cached.fetchedAt,
    effectiveRadiusKm: cached.effectiveRadiusKm,
    countyFips: cached.countyFips,
  };
}

function parseCachedIdentity(
  cached: CachedLogisticsEnvelope,
  now: number,
  expected?: { placeId: string; queryFingerprint: string; lat: number; lon: number },
): { queryFingerprint: string; placeId: string; placeName: string; fetchedAt: Date } | null {
  const queryFingerprint = safeString(cached.queryFingerprint, 600);
  const placeId = safeString(cached.placeId, 240);
  const placeName = safeString(cached.placeName, 240);
  const fetchedAt = parseDate(cached.fetchedAt);
  if (!queryFingerprint || !placeId || !placeName || !fetchedAt) return null;
  if (expected && (placeId !== expected.placeId || queryFingerprint !== expected.queryFingerprint)) return null;
  if (fetchedAt.getTime() < EARLIEST_SOURCE_TIME_MS || fetchedAt.getTime() > now + CLOCK_SKEW_MS) return null;
  return { queryFingerprint, placeId, placeName, fetchedAt };
}

function parseCachedQuery(
  cached: CachedLogisticsEnvelope,
  queryFingerprint: string,
  expected?: { lat: number; lon: number },
): { categories: LogisticsCategory[]; queryLat: number; queryLon: number; countyFips?: string } | null {
  const categories = parseCategories(cached.categories);
  if (!categories) return null;
  const fingerprint = parseLogisticsFingerprint(queryFingerprint);
  if (fingerprint?.radiusKm.toFixed(2) !== cached.effectiveRadiusKm.toFixed(2)) return null;
  if (fingerprint.categories.join(',') !== [...categories].sort(compareStrings).join(',')) return null;
  const queryLat = expected?.lat ?? fingerprint.lat;
  const queryLon = expected?.lon ?? fingerprint.lon;
  if (!isCoordinate(queryLat, -90, 90) || !isCoordinate(queryLon, -180, 180)) return null;
  const countyFips = cached.countyFips === undefined ? undefined : safeString(cached.countyFips);
  if (cached.countyFips !== undefined && (!countyFips || !/^\d{5}$/.test(countyFips))) return null;
  return { categories, queryLat, queryLon, ...(countyFips ? { countyFips } : {}) };
}

/** @internal Strictly validates the persisted snapshot before offline use. */
export function deserializeLocalLogisticsSnapshot(
  cached: unknown,
  now = Date.now(),
  expected?: { placeId: string; queryFingerprint: string; lat: number; lon: number },
): LocalLogisticsSnapshot | null {
  const envelope = parseCachedEnvelope(cached);
  if (!envelope) return null;
  const identity = parseCachedIdentity(envelope, now, expected);
  if (!identity) return null;
  const query = parseCachedQuery(envelope, identity.queryFingerprint, expected);
  if (!query) return null;
  const { queryFingerprint, placeId, placeName, fetchedAt } = identity;
  const { categories, queryLat, queryLon, countyFips } = query;

  const providerCollection = parseProviderCollection(envelope.providers, categories, now, true);
  if (!providerCollection) return null;
  const { providers: parsedProviders, byId: providerById } = providerCollection;

  const sites = parseLocatedSites(envelope.sites, queryLat, queryLon);
  if (sites.length !== envelope.sites.length) return null;
  if (sites.some((site) => !categories.includes(site.kind))) return null;
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const observations = parseActiveObservations(envelope.observations, siteById, providerById, now);
  if (observations.length !== envelope.observations.length) return null;

  const nodes = buildLogisticsNodes(sites, observations, fetchedAt, now);
  if (nodes.length !== sites.length) return null;

  const areaConditions = envelope.areaConditions
    .map((condition) => countyFips ? parseAreaCondition(condition, countyFips, now) : null)
    .filter((condition): condition is AreaCondition => Boolean(condition))
    .filter(() => {
      const provider = providerById.get('ornl-odin');
      return provider?.state === 'ok' || provider?.state === 'partial';
    });
  if (areaConditions.length !== envelope.areaConditions.length) return null;
  const contributionCounts = countProviderContributions(observations, siteById);
  contributionCounts.set('ornl-odin', areaConditions.length);
  const providers = parsedProviders.map((provider) =>
    reconcileProvider(provider, contributionCounts.get(provider.id) ?? 0));

  const staleAgeMs = Math.max(0, now - fetchedAt.getTime());
  return {
    schemaVersion: 2, queryFingerprint, placeId, placeName,
    effectiveRadiusKm: envelope.effectiveRadiusKm,
    ...(countyFips ? { countyFips } : {}),
    categories: [...new Set(categories)], sites, observations,
    nodes: rankLocalLogisticsNodes(nodes, now), areaConditions, providers, fetchedAt,
    isStale: true, isExpired: staleAgeMs > CACHE_EXPIRE_MS,
    staleAgeMs, source: 'offline-cache',
  };
}

function eventDateValue(value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  return Number.isFinite(value.getTime()) ? value.toISOString() : value;
}

function eventRowWithDates(value: unknown, fields: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  for (const field of fields) normalized[field] = eventDateValue(value[field]);
  return normalized;
}

/**
 * Strict document-event boundary for renderer Lifelines snapshots.
 *
 * Events carry Date instances while persisted snapshots carry RFC 3339 strings.
 * Normalize only the known date fields, then reuse the persisted-snapshot parser
 * so malformed, oversized, future-dated, or semantically inconsistent payloads
 * never reach downstream derivations or storage.
 */
export function validateLocalLogisticsSnapshotEvent(
  value: unknown,
  now = Date.now(),
): LocalLogisticsSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== LOCAL_LOGISTICS_SCHEMA_VERSION) return null;
  if (value.source !== 'network' && value.source !== 'offline-cache') return null;
  if (typeof value.isStale !== 'boolean' || typeof value.isExpired !== 'boolean'
    || !isNonNegativeFinite(value.staleAgeMs)) return null;
  if (!Array.isArray(value.categories) || !Array.isArray(value.sites)
    || !Array.isArray(value.observations) || !Array.isArray(value.nodes)
    || !Array.isArray(value.areaConditions) || !Array.isArray(value.providers)) return null;
  if (value.sites.length > MAX_RESOURCE_ROWS || value.observations.length > MAX_RESOURCE_ROWS
    || value.nodes.length > MAX_RESOURCE_ROWS || value.areaConditions.length > MAX_AREA_CONDITION_ROWS
    || value.providers.length > MAX_PROVIDER_ROWS) return null;

  const normalized = {
    ...value,
    fetchedAt: eventDateValue(value.fetchedAt),
    observations: value.observations.map((row) => eventRowWithDates(
      row, ['observedAt', 'retrievedAt', 'sourceObservedAt', 'expiresAt'],
    )),
    // Presentation nodes are reconstructed from validated sites + observations.
    // Retain the bounded array shape without trusting its redundant fields.
    nodes: [],
    areaConditions: value.areaConditions.map((row) => eventRowWithDates(
      row, ['observedAt', 'retrievedAt', 'sourceObservedAt', 'expiresAt'],
    )),
    providers: value.providers.map((row) => eventRowWithDates(
      row, ['observedAt', 'retrievedAt', 'sourceObservedAt'],
    )),
  };
  const parsed = deserializeLocalLogisticsSnapshot(normalized, now);
  if (!parsed) return null;
  const staleAgeMs = Math.max(0, now - parsed.fetchedAt.getTime());
  return {
    ...parsed,
    source: value.source,
    isStale: value.source === 'offline-cache',
    isExpired: staleAgeMs > CACHE_EXPIRE_MS,
    staleAgeMs,
  };
}

function effectiveOperational(node: LogisticsNode, now: number): OperationalStatus {
  return node.expiresAt.getTime() > now ? node.operational : 'unknown';
}

function viabilityRank(node: LogisticsNode, now: number): number {
  if (node.expiresAt.getTime() <= now) return 0;
  if (node.access === 'blocked' || node.operational === 'closed' || node.inventory === 'full' || node.inventory === 'out') return 0;
  let rank = node.verification === 'official' ? 2 : 0;
  if (node.operational === 'open') rank += 5;
  if (node.inventory === 'available') rank += 3;
  if (node.inventory === 'limited') rank += 1;
  if (node.power === 'grid' || node.power === 'generator') rank += 2;
  if (node.access === 'reachable') rank += 2;
  return rank;
}

export function rankLocalLogisticsNodes(nodes: LogisticsNode[], now = Date.now()): LogisticsNode[] {
  return [...nodes].sort((left, right) => {
 const viabilityDiff = viabilityRank(right, now) - viabilityRank(left, now);
 if (viabilityDiff !== 0) return viabilityDiff;
 const currentDiff = Number(right.expiresAt.getTime() > now) - Number(left.expiresAt.getTime() > now);
 if (currentDiff !== 0) return currentDiff;
 const distanceDiff = left.distanceKm - right.distanceKm;
 return distanceDiff === 0 ? left.name.localeCompare(right.name) : distanceDiff;
  });
}

function resourceSiteFromNode(node: LogisticsNode): ResourceSite {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    lat: node.lat,
    lon: node.lon,
    distanceKm: node.distanceKm,
    ...(node.address ? { address: node.address } : {}),
    ...(node.publicPhone ? { publicPhone: node.publicPhone } : {}),
    ...(node.directoryUrl ? { directoryUrl: node.directoryUrl } : {}),
    sourceRefs: node.sourceRefs,
    capabilities: node.capabilities,
  };
}

export function buildLocalLogisticsSnapshot(place: SavedPlace, nodes: LogisticsNode[], options: BuildSnapshotOptions = {}): LocalLogisticsSnapshot {
  const fetchedAt = options.fetchedAt ?? new Date();
  const categories = options.categories
    ? [...new Set(options.categories)].sort((a, b) => a.localeCompare(b))
    : [...new Set(nodes.map((node) => node.category))].sort((a, b) => a.localeCompare(b));
  return {
 schemaVersion: 2,
 queryFingerprint: options.queryFingerprint ?? buildLocalLogisticsFingerprint(place, Math.min(place.radiusKm, DEFAULT_RADIUS_KM), [...LOCAL_LOGISTICS_CATEGORIES]),
 placeId: place.id, placeName: place.name,
 effectiveRadiusKm: options.effectiveRadiusKm ?? Math.min(place.radiusKm, DEFAULT_RADIUS_KM),
 categories,
 sites: options.sites ?? nodes.map((node) => resourceSiteFromNode(node)),
 observations: options.observations ?? nodes.map((node) => ({
 id: `${node.id}:presentation`, siteId: node.id, provider: node.sourceRefs[0]?.provider ?? 'osm',
 verification: node.verification, operational: node.operational, inventory: node.inventory,
 power: node.power, access: node.access, observedAt: node.observedAt,
 ...(node.retrievedAt ? { retrievedAt: node.retrievedAt } : {}),
 ...(node.sourceObservedAt ? { sourceObservedAt: node.sourceObservedAt } : {}),
 expiresAt: node.expiresAt,
 confidence: node.confidence, sourceUrl: node.sourceUrl,
 })),
 nodes: rankLocalLogisticsNodes(nodes, fetchedAt.getTime()),
 areaConditions: options.areaConditions ?? [], providers: options.providers ?? [], fetchedAt,
 isStale: options.isStale ?? false, isExpired: options.isExpired ?? false,
 staleAgeMs: options.staleAgeMs ?? 0, source: options.source ?? 'network',
 ...(options.countyFips ? { countyFips: options.countyFips } : {}),
  };
}

export function selectTopLocalLogisticsNodes(snapshot: LocalLogisticsSnapshot, category: LogisticsCategory | 'all' = 'all', limit = 3): LogisticsNode[] {
  const filtered = category === 'all' ? snapshot.nodes : snapshot.nodes.filter((node) => node.category === category);
  return filtered.slice(0, Math.max(1, limit));
}

function formatDistance(distanceKm: number): string {
  if (!Number.isFinite(distanceKm)) return 'distance unknown';
  return distanceKm < 10 ? `${distanceKm.toFixed(1)} km away` : `${Math.round(distanceKm)} km away`;
}

function briefStatus(node: LogisticsNode, now: number): string {
  if (node.expiresAt.getTime() <= now) return 'verification expired; status unknown';
  if (node.directoryOnly) return 'directory listing only; availability unknown';
  const operational = effectiveOperational(node, now);
  if (operational === 'open') return node.inventory === 'full' ? 'open; reported full' : 'officially reported open';
  if (operational === 'closed') return 'officially reported closed';
  return 'operational status unknown';
}

export function buildLocalLogisticsBriefItems(snapshot: LocalLogisticsSnapshot | null, limit = 3): LocalLogisticsBriefItem[] {
  if (!snapshot) return [];
  const now = Date.now();
  return selectTopLocalLogisticsNodes(snapshot, 'all', limit).map((node) => ({
 kind: 'logistics', label: `${LOCAL_LOGISTICS_CATEGORY_LABELS[node.category]}: ${node.name}`,
 value: `${formatDistance(node.distanceKm)} · ${briefStatus(node, now)}`,
 severity: effectiveOperational(node, now) === 'closed' || node.access === 'blocked' ? 'medium' : 'low',
 link: node.sourceUrl,
  }));
}

export function getCachedLocalLogistics(place: SavedPlace): LocalLogisticsSnapshot | null;
/** Compatibility lookup for callers intentionally requesting the latest cache by stable place ID. */
export function getCachedLocalLogistics(placeId: string): LocalLogisticsSnapshot | null;
export function getCachedLocalLogistics(placeOrId: SavedPlace | string): LocalLogisticsSnapshot | null {
  const placeId = typeof placeOrId === 'string' ? placeOrId : placeOrId.id;
  let fingerprint = typeof placeOrId === 'string'
 ? latestFingerprintByPlace.get(placeId)
 : buildLocalLogisticsFingerprint(
 placeOrId,
 Math.max(1, Math.min(placeOrId.radiusKm, DEFAULT_RADIUS_KM)),
 [...LOCAL_LOGISTICS_CATEGORIES],
 );
  // ID-only compatibility reads may consult the latest-index record. A full
  // SavedPlace never does: its current location/options determine the only
  // acceptable key, so edits cannot reuse a prior-location Lifeline Pack.
  if (!fingerprint) {
 if (typeof placeOrId !== 'string') return null;
 const latest = readOfflineCacheEntry<{ schemaVersion: 2; fingerprint: string }>(latestKey(placeId));
 if (latest?.data.schemaVersion === 2) fingerprint = latest.data.fingerprint;
  }
  if (!fingerprint) return null;
  const key = cacheKey(placeId, fingerprint);
  const cached = memoryCache.get(key) ?? readOfflineCacheEntry<CachedLocalLogisticsSnapshot>(key)?.data;
  if (!cached) return null;
  const coordinates = typeof placeOrId === 'string'
    ? parseLogisticsFingerprint(fingerprint)
    : { lat: placeOrId.lat, lon: placeOrId.lon };
  if (!coordinates) return null;
  const parsed = deserializeLocalLogisticsSnapshot(cached, Date.now(), {
    placeId, queryFingerprint: fingerprint, lat: coordinates.lat, lon: coordinates.lon,
  });
  if (!parsed) return null;
  boundedSet(memoryCache, key, cached);
  boundedSet(latestFingerprintByPlace, placeId, fingerprint);
  return parsed;
}

async function runFetch(place: SavedPlace, categories: LogisticsCategory[], radiusKm: number, limitPerCategory: number, fingerprint: string): Promise<LocalLogisticsSnapshot> {
  const params = new URLSearchParams({
 lat: String(place.lat), lon: String(place.lon), radiusKm: String(radiusKm),
 categories: categories.join(','), limitPerCategory: String(limitPerCategory),
  });
  try {
 const response = await fetch(`${getApiBaseUrl()}/api/local-logistics?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
 if (!response.ok) throw new Error(`Lifelines HTTP ${response.status}`);
 const parsed = parseLocalLogisticsApiResponse(place, await response.json(), Date.now(), categories);
 if (parsed.effectiveRadiusKm !== radiusKm) throw new Error('lifelines radius mismatch');
 let areaConditions: AreaCondition[] = [];
 const providers = [...parsed.providers];
 if (parsed.countyFips) {
 try {
 const outageResponse = await fetch(`${getApiBaseUrl()}/api/grid-outages?fips=${encodeURIComponent(parsed.countyFips)}&limit=100`, { signal: AbortSignal.timeout(10_000) });
 if (!outageResponse.ok) throw new Error(`ODIN HTTP ${outageResponse.status}`);
 const outage = parseGridOutages(await outageResponse.json(), parsed.countyFips);
 areaConditions = outage.areaConditions;
 providers.push(outage.provider);
 } catch {
 providers.push({ id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows: 0, observedAt: null, reasonCode: 'request_failed' });
 }
 } else {
 providers.push({ id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows: 0, observedAt: null, reasonCode: 'county_fips_unknown' });
 }
 const snapshot = buildLocalLogisticsSnapshot(place, parsed.nodes, {
 fetchedAt: parsed.retrievedAt, queryFingerprint: fingerprint, effectiveRadiusKm: parsed.effectiveRadiusKm,
 countyFips: parsed.countyFips,
 areaConditions, providers, sites: parsed.sites, observations: parsed.observations,
 categories: parsed.categories, source: 'network',
 });
 const serialized = serializeSnapshot(snapshot);
 const key = cacheKey(place.id, fingerprint);
 boundedSet(memoryCache, key, serialized);
 boundedSet(latestFingerprintByPlace, place.id, fingerprint);
 const exactPersisted = writeOfflineCacheEntry(key, serialized);
 if (exactPersisted) {
   writeOfflineCacheEntry(latestKey(place.id), { schemaVersion: 2, fingerprint });
 }
 emitLocalLogisticsUpdated(snapshot);
 return snapshot;
  } catch (error) {
 const key = cacheKey(place.id, fingerprint);
 const cachedPayload = memoryCache.get(key) ?? readOfflineCacheEntry<CachedLocalLogisticsSnapshot>(key)?.data;
 const cached = cachedPayload ? deserializeLocalLogisticsSnapshot(cachedPayload, Date.now(), {
   placeId: place.id, queryFingerprint: fingerprint, lat: place.lat, lon: place.lon,
 }) : null;
 if (cached) {
 emitLocalLogisticsUpdated(cached);
 return cached;
 }
 throw error;
  }
}

export function fetchLocalLogistics(place: SavedPlace, options: FetchLocalLogisticsOptions = {}): Promise<LocalLogisticsSnapshot> {
  const requested = options.categories?.length ? options.categories : [...LOCAL_LOGISTICS_CATEGORIES];
  const categories = [...new Set(requested.filter((item) => LOCAL_LOGISTICS_CATEGORIES.includes(item)))].sort(compareStrings);
  const radiusKm = Math.max(1, Math.min(place.radiusKm, options.radiusKm ?? DEFAULT_RADIUS_KM));
  const limitPerCategory = Math.max(1, Math.min(5, Math.trunc(options.limitPerCategory ?? DEFAULT_LIMIT_PER_CATEGORY)));
  const fingerprint = buildLocalLogisticsFingerprint(place, radiusKm, categories, limitPerCategory);
  const inFlightKey = `${place.id}|${fingerprint}`;
  const existing = inFlight.get(inFlightKey);
  if (existing) return existing;
  const request = runFetch(place, categories, radiusKm, limitPerCategory, fingerprint);
  inFlight.set(inFlightKey, request);
  return request.finally(() => {
 if (inFlight.get(inFlightKey) === request) inFlight.delete(inFlightKey);
  });
}

export function selectLifelinePrewarmPlaces(places: SavedPlace[], stormMatchedPlaceId: string | null | undefined): SavedPlace[] {
  const selected: SavedPlace[] = [];
  const seen = new Set<string>();
  for (const place of places) {
 if ((place.offlinePinned || place.id === stormMatchedPlaceId) && !seen.has(place.id)) {
 selected.push(place);
 seen.add(place.id);
 }
  }
  return selected;
}

export async function prewarmLocalLogistics(
  places: SavedPlace[],
  stormMatchedPlaceId: string | null | undefined = null,
  now = Date.now(),
  fetcher: (place: SavedPlace) => Promise<unknown> = fetchLocalLogistics,
): Promise<{ succeeded: string[]; failed: string[]; skipped: string[] }> {
  const eligible = selectLifelinePrewarmPlaces(places, stormMatchedPlaceId);
 const cooldownKey = (place: SavedPlace) => `${place.id}:${buildLocalLogisticsFingerprint(place, Math.min(place.radiusKm, DEFAULT_RADIUS_KM), [...LOCAL_LOGISTICS_CATEGORIES])}`;
 const queue = eligible.filter((place) => now - (lastPrewarmByPlace.get(cooldownKey(place)) ?? 0) >= PREWARM_COOLDOWN_MS);
  const skipped = eligible.filter((place) => !queue.includes(place)).map((place) => place.id);
  const succeeded: string[] = [];
  const failed: string[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
 while (cursor < queue.length) {
 const place = queue[cursor++];
 if (!place) return;
 boundedSet(lastPrewarmByPlace, cooldownKey(place), now);
 try { await fetcher(place); succeeded.push(place.id); } catch { failed.push(place.id); }
 }
  }
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
  return { succeeded, failed, skipped };
}

export type { LocalLogisticsBriefItem };
