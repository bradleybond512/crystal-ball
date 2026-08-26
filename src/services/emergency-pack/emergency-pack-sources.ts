import {
  validateEmergencyPackArtifact,
  type EmergencyPackArtifactKind,
  type EmergencyPackCapturedArtifact,
  type EmergencyPackCaptureScope,
} from './emergency-pack-capture';

export interface EmergencyPackSourcePlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

interface VerifiedLifelinesReceipt {
  placeId: string;
  capturedAt: Date;
  expiresAt: Date | null;
  isExpired: boolean;
}

interface AlertFeed {
  alerts: unknown[];
  capturedAt: number;
}

export interface EmergencyPackSourceDependencies {
  now: () => number;
  buildLifelinesQueryFingerprint: (place: EmergencyPackSourcePlace) => string;
  getLifelinesSnapshot: (place: EmergencyPackSourcePlace, queryFingerprint: string) => unknown;
  getVerifiedLifelinesReceipt: (place: EmergencyPackSourcePlace) => VerifiedLifelinesReceipt | null;
  getAlertFeed: () => AlertFeed | null;
  matchAlertToPlace: (
    alert: unknown,
    place: EmergencyPackSourcePlace,
    options: { now: number },
  ) => unknown;
  getRoutes: () => unknown[];
  getCommsPlan: (placeId: string) => unknown;
  getSelectedContactIds: (placeId: string) => string[];
  captureOfflineMap: (
    place: EmergencyPackSourcePlace,
    scope: EmergencyPackCaptureScope,
  ) => Promise<EmergencyPackCapturedArtifact | null>;
}

export type EmergencyPackArtifactSource = (
  scope: EmergencyPackCaptureScope,
) => Promise<EmergencyPackCapturedArtifact | null>;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_ALERTS = 100;
const MAX_ROUTE_COORDINATES = 5000;
const MAX_ROUTE_STEPS = 1000;
const MAX_CONTACTS = 25;
const MAX_FALLBACK_STEPS = 32;
const MAX_CHECK_IN_WINDOWS = 16;
const MATCHED_ALERT_KINDS = new Set(['inside_polygon', 'near_polygon', 'inside_zone']);
const COMMS_CHANNEL_KINDS = new Set(['sms', 'signal', 'call', 'radio', 'mesh', 'satcom', 'rally', 'other']);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && (allowEmpty || value.trim().length > 0);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_DATE_MS;
}

function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isNonNegativeFinite(value: unknown, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= maximum;
}

function validPlace(place: EmergencyPackSourcePlace): boolean {
  return isBoundedString(place.id, 180)
    && isBoundedString(place.name, 300)
    && isCoordinate(place.lat, -90, 90)
    && isCoordinate(place.lon, -180, 180)
    && isNonNegativeFinite(place.radiusKm, 3000)
    && place.radiusKm > 0;
}

function scopeMatchesPlace(scope: EmergencyPackCaptureScope, place: EmergencyPackSourcePlace): boolean {
  return scope.placeId === place.id
    && scope.profileFingerprint === buildEmergencyPackProfileFingerprint(place);
}

function serializedRecord(value: unknown): { body: string; payload: Record<string, unknown> } | null {
  try {
    const body = JSON.stringify(value);
    if (typeof body !== 'string') return null;
    const payload = JSON.parse(body) as unknown;
    return isRecord(payload) ? { body, payload } : null;
  } catch {
    return null;
  }
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildArtifact(
  kind: EmergencyPackArtifactKind,
  payload: Record<string, unknown>,
  capturedAt: number,
  expiresAt: number,
  summary: string,
): EmergencyPackCapturedArtifact | null {
  if (!isTimestamp(capturedAt)
    || !isTimestamp(expiresAt)
    || expiresAt <= capturedAt
    || !isBoundedString(summary, 300)) return null;
  const serialized = serializedRecord(payload);
  if (!serialized) return null;
  const byteLength = new TextEncoder().encode(serialized.body).byteLength;
  const validation = validateEmergencyPackArtifact({
    kind,
    placeId: payload.placeId as string,
    profileFingerprint: payload.profileFingerprint as string,
    byteLength,
    capturedAt,
    payload: serialized.payload,
  });
  if (!validation.ok) return null;
  return {
    kind,
    body: serialized.body,
    expiresAt,
    semanticState: validation.semanticState,
    summary,
    itemCount: validation.itemCount,
  };
}

function snapshotCapturedAt(snapshot: Record<string, unknown>): number | null {
  if (snapshot.fetchedAt instanceof Date) {
    const timestamp = snapshot.fetchedAt.getTime();
    return isTimestamp(timestamp) ? timestamp : null;
  }
  if (typeof snapshot.fetchedAt !== 'string') return null;
  const timestamp = Date.parse(snapshot.fetchedAt);
  return isTimestamp(timestamp) ? timestamp : null;
}

export function buildEmergencyPackProfileFingerprint(place: EmergencyPackSourcePlace): string {
  return JSON.stringify([2, place.id, place.lat, place.lon, place.radiusKm]);
}

export function buildEmergencyPackRoutePlaceFingerprint(place: EmergencyPackSourcePlace): string {
  return JSON.stringify([2, place.id, place.name, place.lat, place.lon]);
}

function createLifelinesSource(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
): EmergencyPackArtifactSource {
  return async (scope) => {
    if (!scopeMatchesPlace(scope, place)) return null;
    const now = await Promise.resolve(dependencies.now());
    const queryFingerprint = dependencies.buildLifelinesQueryFingerprint(place);
    if (!isTimestamp(now) || !isBoundedString(queryFingerprint, 800)) return null;
    const snapshot = dependencies.getLifelinesSnapshot(place, queryFingerprint);
    const receipt = dependencies.getVerifiedLifelinesReceipt(place);
    if (!isRecord(snapshot)
      || snapshot.schemaVersion !== 2
      || snapshot.placeId !== place.id
      || snapshot.queryFingerprint !== queryFingerprint
      || snapshot.isExpired === true
      || receipt?.placeId !== place.id
      || !(receipt.capturedAt instanceof Date)
      || !isTimestamp(receipt.capturedAt.getTime())
      || receipt.capturedAt.getTime() > now
      || snapshotCapturedAt(snapshot) !== receipt.capturedAt.getTime()
      || !(receipt.expiresAt instanceof Date)
      || !isTimestamp(receipt.expiresAt.getTime())
      || receipt.isExpired
      || receipt.expiresAt.getTime() <= now) return null;
    return buildArtifact('lifelines', {
      kind: 'lifelines',
      placeId: place.id,
      profileFingerprint: scope.profileFingerprint,
      snapshot,
    }, now, receipt.expiresAt.getTime(), 'Exact Lifelines snapshot verified');
  };
}

function createAlertsSource(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
): EmergencyPackArtifactSource {
  return async (scope) => {
    if (!scopeMatchesPlace(scope, place)) return null;
    const now = await Promise.resolve(dependencies.now());
    const feed = dependencies.getAlertFeed();
    if (!isTimestamp(now)
      || !feed
      || !Array.isArray(feed.alerts)
      || !isTimestamp(feed.capturedAt)
      || feed.capturedAt > now
      || feed.capturedAt + FOUR_HOURS_MS <= now) return null;

    const matched: Record<string, unknown>[] = [];
    for (const alert of feed.alerts) {
      let match: unknown;
      try {
        match = dependencies.matchAlertToPlace(alert, place, { now });
      } catch {
        return null;
      }
      if (!isRecord(match) || typeof match.matchKind !== 'string') return null;
      if (!MATCHED_ALERT_KINDS.has(match.matchKind)) continue;
      if (!isRecord(alert)) return null;
      if (matched.length < MAX_ALERTS) matched.push(alert);
    }
    const alertSuffix = matched.length === 1 ? '' : 's';
    const summary = matched.length === 0
      ? 'No current matched alerts; coverage not inferred'
      : `${matched.length} current matched alert${alertSuffix}`;
    return buildArtifact('alerts', {
      kind: 'alerts',
      placeId: place.id,
      profileFingerprint: scope.profileFingerprint,
      alerts: matched,
      sourceFetchedAt: feed.capturedAt,
    }, now, feed.capturedAt + FOUR_HOURS_MS, summary);
  };
}

interface RouteCandidate {
  id: string;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  distanceKm: number;
  durationMinutes: number;
  coordinates: number[][];
  steps: Record<string, unknown>[];
  cachedAt: number;
}

function validRouteEndpoint(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isCoordinate(value.lat, -90, 90)
    && isCoordinate(value.lon, -180, 180)
    && isBoundedString(value.label, 300)
    && (value.placeRef === null || isRecord(value.placeRef));
}

function routeEndpointMatchesPlace(
  endpoint: Record<string, unknown>,
  place: EmergencyPackSourcePlace,
  fingerprint: string,
): boolean {
  if (!isRecord(endpoint.placeRef)) return false;
  return endpoint.placeRef.id === place.id
    && endpoint.placeRef.fingerprint === fingerprint
    && endpoint.label === place.name
    && Math.abs((endpoint.lat as number) - place.lat) <= 1e-7
    && Math.abs((endpoint.lon as number) - place.lon) <= 1e-7;
}

function parseRoute(
  value: unknown,
  place: EmergencyPackSourcePlace,
  routeFingerprint: string,
  now: number,
): RouteCandidate | null {
  if (!isRecord(value)
    || !isBoundedString(value.id, 180)
    || !validRouteEndpoint(value.from)
    || !validRouteEndpoint(value.to)
    || !isNonNegativeFinite(value.distanceKm, 50_000)
    || !isNonNegativeFinite(value.durationMinutes, 525_600)
    || !isTimestamp(value.cachedAt)
    || value.cachedAt > now
    || value.cachedAt + ONE_DAY_MS <= now
    || (!routeEndpointMatchesPlace(value.from, place, routeFingerprint)
      && !routeEndpointMatchesPlace(value.to, place, routeFingerprint))
    || !isRecord(value.geometry)
    || value.geometry.type !== 'LineString'
    || !Array.isArray(value.geometry.coordinates)
    || value.geometry.coordinates.length < 2
    || !Array.isArray(value.steps)) return null;

  const coordinates: number[][] = [];
  for (const coordinate of value.geometry.coordinates) {
    if (!Array.isArray(coordinate)
      || coordinate.length !== 2
      || !isCoordinate(coordinate[0], -180, 180)
      || !isCoordinate(coordinate[1], -90, 90)) return null;
    coordinates.push([coordinate[0], coordinate[1]]);
  }
  const steps: Record<string, unknown>[] = [];
  for (const step of value.steps) {
    if (!isRecord(step)
      || !isBoundedString(step.instruction, 500)
      || !isNonNegativeFinite(step.distanceKm, 50_000)
      || !isNonNegativeFinite(step.durationMinutes, 525_600)) return null;
    steps.push({
      instruction: step.instruction,
      distanceKm: step.distanceKm,
      durationMinutes: step.durationMinutes,
    });
  }
  return {
    id: value.id,
    from: { ...value.from, placeRef: isRecord(value.from.placeRef) ? { ...value.from.placeRef } : null },
    to: { ...value.to, placeRef: isRecord(value.to.placeRef) ? { ...value.to.placeRef } : null },
    distanceKm: value.distanceKm,
    durationMinutes: value.durationMinutes,
    coordinates,
    steps,
    cachedAt: value.cachedAt,
  };
}

function downsampleCoordinates(coordinates: number[][]): number[][] {
  if (coordinates.length <= MAX_ROUTE_COORDINATES) return coordinates;
  return Array.from({ length: MAX_ROUTE_COORDINATES }, (_, index) => {
    const sourceIndex = Math.round(index * (coordinates.length - 1) / (MAX_ROUTE_COORDINATES - 1));
    return coordinates[sourceIndex]!;
  });
}

function routeArtifact(
  kind: 'route-primary' | 'route-alternate',
  route: RouteCandidate,
  scope: EmergencyPackCaptureScope,
  capturedAt: number,
): EmergencyPackCapturedArtifact | null {
  return buildArtifact(kind, {
    kind,
    placeId: scope.placeId,
    profileFingerprint: scope.profileFingerprint,
    routeId: route.id,
    from: route.from,
    to: route.to,
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    geometry: { type: 'LineString', coordinates: downsampleCoordinates(route.coordinates) },
    steps: route.steps.slice(0, MAX_ROUTE_STEPS),
    cachedAt: route.cachedAt,
  }, capturedAt, route.cachedAt + ONE_DAY_MS, `${kind === 'route-primary' ? 'Primary' : 'Alternate'} route verified`);
}

function readRoutes(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
  now: number,
): RouteCandidate[] {
  const values = dependencies.getRoutes();
  if (!Array.isArray(values)) return [];
  const routeFingerprint = buildEmergencyPackRoutePlaceFingerprint(place);
  return values.flatMap((value) => {
    const parsed = parseRoute(value, place, routeFingerprint, now);
    return parsed ? [parsed] : [];
  }).sort((left, right) => right.cachedAt - left.cachedAt || left.id.localeCompare(right.id));
}

function createRouteSource(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
  kind: 'route-primary' | 'route-alternate',
): EmergencyPackArtifactSource {
  return async (scope) => {
    if (!scopeMatchesPlace(scope, place)) return null;
    const now = await Promise.resolve(dependencies.now());
    if (!isTimestamp(now)) return null;
    const routes = readRoutes(place, dependencies, now);
    const route = routes[kind === 'route-primary' ? 0 : 1];
    return route ? routeArtifact(kind, route, scope, now) : null;
  };
}

interface SelectedCommsPlan {
  selectedContactIds: string[];
  contacts: Record<string, unknown>[];
  fallbackSteps: Record<string, unknown>[];
  checkInWindows: Record<string, unknown>[];
  notes: string;
}

function parseSelectedContactIds(value: unknown): string[] | null {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > MAX_CONTACTS
    || !value.every((id) => isBoundedString(id, 180))) return null;
  const selectedContactIds = [...new Set(value)];
  return selectedContactIds.length === value.length ? selectedContactIds : null;
}

function readSelectedCommsPlan(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
): SelectedCommsPlan | null {
  const raw = dependencies.getCommsPlan(place.id);
  const selectedContactIds = parseSelectedContactIds(dependencies.getSelectedContactIds(place.id));
  if (!isRecord(raw)
    || raw.placeId !== place.id
    || !Array.isArray(raw.contacts)
    || !Array.isArray(raw.fallbackSteps)
    || !Array.isArray(raw.checkInWindows)
    || !isBoundedString(raw.notes, 8192, true)
    || !selectedContactIds) return null;

  const contactsById = new Map<string, Record<string, unknown>>();
  for (const contact of raw.contacts) {
    if (!isRecord(contact)
      || !isBoundedString(contact.id, 180)
      || !isBoundedString(contact.label, 300)
      || !isBoundedString(contact.value, 1000)
      || !isBoundedString(contact.role, 300, true)
      || contactsById.has(contact.id)) return null;
    contactsById.set(contact.id, {
      id: contact.id,
      label: contact.label,
      value: contact.value,
      role: contact.role,
    });
  }
  const contacts = selectedContactIds.map((id) => contactsById.get(id));
  if (contacts.includes(undefined)) return null;

  if (raw.fallbackSteps.length > MAX_FALLBACK_STEPS
    || raw.checkInWindows.length > MAX_CHECK_IN_WINDOWS) return null;
  const fallbackSteps: Record<string, unknown>[] = [];
  for (const step of raw.fallbackSteps) {
    if (!isRecord(step)
      || !isBoundedString(step.id, 180)
      || !isBoundedString(step.label, 300)
      || !isBoundedString(step.kind, 32)
      || !COMMS_CHANNEL_KINDS.has(step.kind)
      || !isBoundedString(step.instruction, 2000)
      || !Number.isSafeInteger(step.priority)
      || (step.priority as number) < 1
      || (step.priority as number) > 10_000
      || (step.link !== undefined && !isBoundedString(step.link, 2048))) return null;
    fallbackSteps.push({
      id: step.id,
      label: step.label,
      kind: step.kind,
      instruction: step.instruction,
      priority: step.priority,
      ...(step.link === undefined ? {} : { link: step.link }),
    });
  }
  const checkInWindows: Record<string, unknown>[] = [];
  for (const window of raw.checkInWindows) {
    if (!isRecord(window)
      || !isBoundedString(window.id, 180)
      || !isBoundedString(window.label, 300)
      || !Number.isSafeInteger(window.cadenceMinutes)
      || (window.cadenceMinutes as number) < 1
      || (window.cadenceMinutes as number) > 525_600
      || !isBoundedString(window.note, 2000, true)) return null;
    checkInWindows.push({
      id: window.id,
      label: window.label,
      cadenceMinutes: window.cadenceMinutes,
      note: window.note,
    });
  }
  return {
    selectedContactIds,
    contacts: contacts as Record<string, unknown>[],
    fallbackSteps,
    checkInWindows,
    notes: raw.notes,
  };
}

function createCommsSource(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
  kind: 'comms-plan' | 'contacts',
): EmergencyPackArtifactSource {
  return async (scope) => {
    if (!scopeMatchesPlace(scope, place) || scope.contactConsent !== true) return null;
    const now = await Promise.resolve(dependencies.now());
    if (!isTimestamp(now)) return null;
    const selected = readSelectedCommsPlan(place, dependencies);
    if (!selected) return null;
    const payload = kind === 'comms-plan'
      ? {
        kind,
        placeId: place.id,
        profileFingerprint: scope.profileFingerprint,
        consent: true,
        selectedContactIds: selected.selectedContactIds,
        fallbackSteps: selected.fallbackSteps,
        checkInWindows: selected.checkInWindows,
        notes: selected.notes,
      }
      : {
        kind,
        placeId: place.id,
        profileFingerprint: scope.profileFingerprint,
        consent: true,
        selectedContactIds: selected.selectedContactIds,
        contacts: selected.contacts,
      };
    const contactSuffix = selected.contacts.length === 1 ? '' : 's';
    const summary = kind === 'contacts'
      ? `${selected.contacts.length} selected emergency contact${contactSuffix} verified`
      : 'Emergency communications plan verified';
    return buildArtifact(
      kind,
      payload,
      now,
      now + THIRTY_DAYS_MS,
      summary,
    );
  };
}

function createOfflineMapSource(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
): EmergencyPackArtifactSource {
  return async (scope) => {
    if (!scopeMatchesPlace(scope, place)) return null;
    const now = dependencies.now();
    if (!isTimestamp(now)) return null;
    const artifact = await dependencies.captureOfflineMap(place, scope);
    if (artifact?.kind !== 'offline-map'
      || !isTimestamp(artifact.expiresAt)
      || artifact.expiresAt <= now
      || artifact.expiresAt > now + THIRTY_DAYS_MS
      || !isBoundedString(artifact.summary, 300)) return null;
    const payload = parseBody(artifact.body);
    if (payload?.kind !== 'offline-map'
      || payload.placeId !== scope.placeId
      || payload.profileFingerprint !== scope.profileFingerprint) return null;
    const validation = validateEmergencyPackArtifact({
      kind: 'offline-map',
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      byteLength: new TextEncoder().encode(artifact.body).byteLength,
      capturedAt: now,
      payload,
    });
    if (!validation.ok
      || validation.itemCount !== artifact.itemCount
      || validation.semanticState !== artifact.semanticState) return null;
    return artifact;
  };
}

export function createEmergencyPackSources(
  place: EmergencyPackSourcePlace,
  dependencies: EmergencyPackSourceDependencies,
): Partial<Record<EmergencyPackArtifactKind, EmergencyPackArtifactSource>> {
  if (!validPlace(place)) return {};
  return {
    lifelines: createLifelinesSource(place, dependencies),
    alerts: createAlertsSource(place, dependencies),
    'route-primary': createRouteSource(place, dependencies, 'route-primary'),
    'route-alternate': createRouteSource(place, dependencies, 'route-alternate'),
    'offline-map': createOfflineMapSource(place, dependencies),
    'comms-plan': createCommsSource(place, dependencies, 'comms-plan'),
    contacts: createCommsSource(place, dependencies, 'contacts'),
  };
}
