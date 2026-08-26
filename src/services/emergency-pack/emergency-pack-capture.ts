export type EmergencyPackArtifactKind =
  | 'lifelines'
  | 'alerts'
  | 'route-primary'
  | 'route-alternate'
  | 'offline-map'
  | 'comms-plan'
  | 'contacts';

export interface EmergencyPackArtifactValidationInput {
  kind: string;
  placeId: string;
  profileFingerprint: string;
  byteLength: number;
  capturedAt: number;
  payload: unknown;
}

export interface EmergencyPackArtifactValidationResult {
  ok: boolean;
  itemCount: number;
  semanticState: 'verified' | 'verified-empty' | 'invalid';
  reason?: string;
}

const ARTIFACT_BYTE_CAPS: Readonly<Record<EmergencyPackArtifactKind, number>> = {
  lifelines: 1024 * 1024,
  alerts: 256 * 1024,
  'route-primary': 512 * 1024,
  'route-alternate': 512 * 1024,
  'offline-map': 50 * 1024 * 1024,
  'comms-plan': 128 * 1024,
  contacts: 128 * 1024,
};

const ARTIFACT_KINDS = new Set<EmergencyPackArtifactKind>(
  Object.keys(ARTIFACT_BYTE_CAPS) as EmergencyPackArtifactKind[],
);
const CHANNEL_KINDS = new Set(['sms', 'signal', 'call', 'radio', 'mesh', 'satcom', 'rally', 'other']);
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_ROUTE_COORDINATES = 5000;
const MAX_ROUTE_STEPS = 1000;
const MAX_ROUTE_DISTANCE_KM = 50_000;
const MAX_ROUTE_DURATION_MINUTES = 525_600;
const MAX_ENDPOINT_SNAP_DEGREES = 0.02;
const MAX_MAP_TILES = 512;
const MAX_MAP_TILE_BYTES = 1024 * 1024;
const MAX_CONTACTS = 25;
const MAX_FALLBACK_STEPS = 32;
const MAX_CHECK_IN_WINDOWS = 16;

function invalid(reason: string): EmergencyPackArtifactValidationResult {
  return { ok: false, itemCount: 0, semanticState: 'invalid', reason };
}

function verified(itemCount: number): EmergencyPackArtifactValidationResult {
  return { ok: true, itemCount, semanticState: 'verified' };
}

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

function isSafeCount(value: unknown, maximum: number, allowZero = true): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= (allowZero ? 0 : 1)
    && value <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_TIMESTAMP;
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function scopeMatches(
  payload: Record<string, unknown>,
  placeId: string,
  profileFingerprint: string,
): boolean {
  return payload.placeId === placeId && payload.profileFingerprint === profileFingerprint;
}

function serializedByteLength(value: unknown): number | null {
  try {
    const body = JSON.stringify(value);
    return typeof body === 'string' ? new TextEncoder().encode(body).byteLength : null;
  } catch {
    return null;
  }
}

function validateLifelines(payload: Record<string, unknown>): EmergencyPackArtifactValidationResult {
  if (!isRecord(payload.snapshot)) return invalid('invalid-lifelines-snapshot');
  return verified(1);
}

function validateAlerts(payload: Record<string, unknown>): EmergencyPackArtifactValidationResult {
  if (!Array.isArray(payload.alerts) || payload.alerts.length > 100) return invalid('invalid-alert-count');
  if (!isTimestamp(payload.sourceFetchedAt)) return invalid('invalid-alert-capture-time');
  if (!payload.alerts.every((alert) => isRecord(alert))) return invalid('invalid-alert');
  if (payload.alerts.length === 0) {
    return {
      ok: true,
      itemCount: 0,
      semanticState: 'verified-empty',
      reason: 'coverage-not-inferred',
    };
  }
  return verified(payload.alerts.length);
}

interface Coordinate {
  lat: number;
  lon: number;
}

function readCoordinate(value: unknown): Coordinate | null {
  if (!isRecord(value)
    || !isFiniteRange(value.lat, -90, 90)
    || !isFiniteRange(value.lon, -180, 180)) return null;
  return { lat: value.lat, lon: value.lon };
}

function coordinateMatchesEndpoint(coordinate: unknown, endpoint: Coordinate): boolean {
  if (!Array.isArray(coordinate) || coordinate.length !== 2) return false;
  if (!isFiniteRange(coordinate[0], -180, 180) || !isFiniteRange(coordinate[1], -90, 90)) return false;
  const longitudeDelta = Math.abs((((coordinate[0] - endpoint.lon) + 540) % 360) - 180);
  return longitudeDelta <= MAX_ENDPOINT_SNAP_DEGREES
    && Math.abs(coordinate[1] - endpoint.lat) <= MAX_ENDPOINT_SNAP_DEGREES;
}

function validRouteStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isBoundedString(value.instruction, 500)
    && isFiniteRange(value.distanceKm, 0, MAX_ROUTE_DISTANCE_KM)
    && isFiniteRange(value.durationMinutes, 0, MAX_ROUTE_DURATION_MINUTES);
}

function validateRoute(payload: Record<string, unknown>): EmergencyPackArtifactValidationResult {
  const from = readCoordinate(payload.from);
  const to = readCoordinate(payload.to);
  if (!from || !to) return invalid('invalid-route-endpoints');
  if (!isRecord(payload.geometry)
    || payload.geometry.type !== 'LineString'
    || !Array.isArray(payload.geometry.coordinates)
    || payload.geometry.coordinates.length < 2
    || payload.geometry.coordinates.length > MAX_ROUTE_COORDINATES) return invalid('invalid-route-geometry');
  const coordinates = payload.geometry.coordinates;
  if (!coordinates.every((coordinate) => Array.isArray(coordinate)
    && coordinate.length === 2
    && isFiniteRange(coordinate[0], -180, 180)
    && isFiniteRange(coordinate[1], -90, 90))) return invalid('invalid-route-coordinate');
  if (!coordinateMatchesEndpoint(coordinates[0], from)
    || !coordinateMatchesEndpoint(coordinates[coordinates.length - 1], to)) {
    return invalid('route-endpoint-mismatch');
  }
  if (!Array.isArray(payload.steps)
    || payload.steps.length > MAX_ROUTE_STEPS
    || !payload.steps.every((step) => validRouteStep(step))) return invalid('invalid-route-steps');
  if (!isTimestamp(payload.cachedAt)) return invalid('invalid-route-capture-time');
  return verified(coordinates.length);
}

function validateOfflineMap(payload: Record<string, unknown>): EmergencyPackArtifactValidationResult {
  if (!Array.isArray(payload.tiles)
    || payload.tiles.length === 0
    || payload.tiles.length > MAX_MAP_TILES) return invalid('invalid-map-tile-count');
  const urls = new Set<string>();
  let calculatedBytes = 0;
  for (const tile of payload.tiles) {
    if (!isRecord(tile)
      || !isBoundedString(tile.url, 2048)
      || !tile.url.startsWith('https://')
      || !isSafeCount(tile.byteLength, MAX_MAP_TILE_BYTES, false)
      || tile.verified !== true
      || urls.has(tile.url)) return invalid('invalid-map-tile');
    urls.add(tile.url);
    calculatedBytes += tile.byteLength;
    if (!Number.isSafeInteger(calculatedBytes) || calculatedBytes > ARTIFACT_BYTE_CAPS['offline-map']) {
      return invalid('map-byte-cap-exceeded');
    }
  }
  if (!isSafeCount(payload.totalBytes, ARTIFACT_BYTE_CAPS['offline-map'], false)
    || payload.totalBytes !== calculatedBytes) return invalid('map-byte-count-mismatch');
  return verified(payload.tiles.length);
}

function validContact(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isBoundedString(value.id, 180)
    && isBoundedString(value.label, 300)
    && isBoundedString(value.value, 1000)
    && isBoundedString(value.role, 300, true);
}

function validFallbackStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value.id, 180)
    || !isBoundedString(value.label, 300)
    || !isBoundedString(value.kind, 32)
    || !CHANNEL_KINDS.has(value.kind)
    || !isBoundedString(value.instruction, 2000)
    || !isSafeCount(value.priority, 10_000, false)) return false;
  return value.link === undefined || isBoundedString(value.link, 2048);
}

function validCheckInWindow(value: unknown): boolean {
  return isRecord(value)
    && isBoundedString(value.id, 180)
    && isBoundedString(value.label, 300)
    && isSafeCount(value.cadenceMinutes, 525_600, false)
    && isBoundedString(value.note, 2000, true);
}

function validateComms(payload: Record<string, unknown>): EmergencyPackArtifactValidationResult {
  if (payload.consent !== true) return invalid('contacts-consent-required');
  if (!Array.isArray(payload.contacts)
    || payload.contacts.length === 0
    || payload.contacts.length > MAX_CONTACTS
    || !payload.contacts.every((contact) => validContact(contact))) return invalid('invalid-contacts');

  const contactIds = new Set<string>();
  for (const contact of payload.contacts) {
    const id = contact.id as string;
    if (contactIds.has(id)) return invalid('duplicate-contact-id');
    contactIds.add(id);
  }
  if (!Array.isArray(payload.selectedContactIds)
    || payload.selectedContactIds.length === 0
    || payload.selectedContactIds.length > MAX_CONTACTS
    || !payload.selectedContactIds.every((id) => isBoundedString(id, 180))) {
    return invalid('selected-contact-required');
  }
  const selectedIds = new Set(payload.selectedContactIds);
  if (selectedIds.size !== payload.selectedContactIds.length
    || [...selectedIds].some((id) => !contactIds.has(id))) return invalid('selected-contact-mismatch');
  if (!Array.isArray(payload.fallbackSteps)
    || payload.fallbackSteps.length > MAX_FALLBACK_STEPS
    || !payload.fallbackSteps.every((step) => validFallbackStep(step))) return invalid('invalid-fallback-steps');
  if (!Array.isArray(payload.checkInWindows)
    || payload.checkInWindows.length > MAX_CHECK_IN_WINDOWS
    || !payload.checkInWindows.every((window) => validCheckInWindow(window))) return invalid('invalid-check-in-windows');
  if (!isBoundedString(payload.notes, 8192, true)) return invalid('invalid-comms-notes');
  return verified(selectedIds.size);
}

export function validateEmergencyPackArtifact(
  input: EmergencyPackArtifactValidationInput,
): EmergencyPackArtifactValidationResult {
  if (!ARTIFACT_KINDS.has(input.kind as EmergencyPackArtifactKind)) return invalid('unknown-artifact-kind');
  const kind = input.kind as EmergencyPackArtifactKind;
  if (!isBoundedString(input.placeId, 180)
    || !isBoundedString(input.profileFingerprint, 800)
    || !isTimestamp(input.capturedAt)) return invalid('invalid-capture-envelope');
  if (!isSafeCount(input.byteLength, ARTIFACT_BYTE_CAPS[kind])) return invalid('artifact-byte-cap-exceeded');
  if (!isRecord(input.payload)
    || !scopeMatches(input.payload, input.placeId, input.profileFingerprint)) return invalid('artifact-scope-mismatch');

  let result: EmergencyPackArtifactValidationResult;
  switch (kind) {
    case 'lifelines': {
      result = validateLifelines(input.payload);
      break;
    }
    case 'alerts': {
      result = validateAlerts(input.payload);
      break;
    }
    case 'route-primary':
    case 'route-alternate': {
      result = validateRoute(input.payload);
      break;
    }
    case 'offline-map': {
      result = validateOfflineMap(input.payload);
      break;
    }
    case 'comms-plan':
    case 'contacts': {
      result = validateComms(input.payload);
      break;
    }
  }
  if (!result.ok) return result;
  if (serializedByteLength(input.payload) !== input.byteLength) return invalid('artifact-byte-count-mismatch');
  return result;
}
