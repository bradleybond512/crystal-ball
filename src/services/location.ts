import { hasTauriInvokeBridge, invokeTauri } from '@/services/tauri-bridge';

export const LOCATION_REQUEST_TIMEOUT_MS = 15_000;
export const LOCATION_MAX_AGE_MS = 60_000;
export const LOCATION_MAX_FUTURE_SKEW_MS = 30_000;
export const LOCATION_MAX_ACCURACY_METERS = 50_000;

export type LocationErrorCode =
  | 'denied'
  | 'restricted'
  | 'disabled'
  | 'timeout'
  | 'unavailable'
  | 'stale'
  | 'inaccurate'
  | 'busy'
  | 'invalid'
  | 'unsupported';

const ERROR_MESSAGES: Record<LocationErrorCode, string> = {
  denied: 'Location permission denied. You can enable it in Location Settings and retry.',
  restricted: 'Location access is restricted on this device.',
  disabled: 'Location Services are disabled. Enable them in Location Settings and retry.',
  timeout: 'The location request timed out. Retry when the device has a clearer signal.',
  unavailable: 'A current location is unavailable. Check location connectivity and retry.',
  stale: 'The reported location is too old. Request an updated location.',
  inaccurate: 'The reported location is too imprecise for nearby Lifelines.',
  busy: 'Another location request is already active. Wait for it to finish and retry.',
  invalid: 'The device returned an invalid location result.',
  unsupported: 'Current location is not supported in this environment.',
};

export class LocationRequestError extends Error {
  readonly code: LocationErrorCode;

  constructor(code: LocationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'LocationRequestError';
    this.code = code;
  }
}

export interface LocationFix {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
  source: 'native' | 'browser';
}

interface GetLocationOptions {
  force?: boolean;
  maxAgeMs?: number;
  timeoutMs?: number;
}

interface RawLocationFix {
  latitude: unknown;
  longitude: unknown;
  horizontalAccuracyMeters: unknown;
  observedAtUnixMs: unknown;
}

const NATIVE_ERROR_CODES = new Set<LocationErrorCode>([
  'denied',
  'restricted',
  'disabled',
  'timeout',
  'unavailable',
  'busy',
  'unsupported',
]);

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function locationError(code: LocationErrorCode): never {
  throw new LocationRequestError(code);
}

function validateLocationFix(raw: RawLocationFix, source: LocationFix['source'], now: number): LocationFix {
  const { latitude, longitude, horizontalAccuracyMeters, observedAtUnixMs } = raw;
  if (
    typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || typeof horizontalAccuracyMeters !== 'number'
    || !Number.isFinite(horizontalAccuracyMeters)
    || horizontalAccuracyMeters < 0
    || typeof observedAtUnixMs !== 'number'
    || !Number.isSafeInteger(observedAtUnixMs)
    || observedAtUnixMs <= 0
  ) {
    return locationError('invalid');
  }
  if (observedAtUnixMs < now - LOCATION_MAX_AGE_MS) return locationError('stale');
  if (observedAtUnixMs > now + LOCATION_MAX_FUTURE_SKEW_MS) return locationError('invalid');
  if (horizontalAccuracyMeters > LOCATION_MAX_ACCURACY_METERS) return locationError('inaccurate');
  return {
    lat: latitude,
    lon: longitude,
    accuracy: horizontalAccuracyMeters,
    timestamp: observedAtUnixMs,
    source,
  };
}

function parseNativeResponse(value: unknown, now: number): LocationFix {
  if (!isExactRecord(value, ['ok', 'fix']) && !isExactRecord(value, ['ok', 'error'])) {
    return locationError('invalid');
  }
  if (value.ok === false && isExactRecord(value.error, ['code'])) {
    const code = value.error.code;
    if (typeof code === 'string' && NATIVE_ERROR_CODES.has(code as LocationErrorCode)) {
      return locationError(code as LocationErrorCode);
    }
    return locationError('invalid');
  }
  if (value.ok !== true || !isExactRecord(value.fix, [
    'latitude',
    'longitude',
    'horizontalAccuracyMeters',
    'observedAtUnixMs',
  ])) {
    return locationError('invalid');
  }
  return validateLocationFix(value.fix as unknown as RawLocationFix, 'native', now);
}

async function requestNativeLocation(): Promise<LocationFix> {
  let response: unknown;
  try {
    response = await invokeTauri<unknown>('get_native_location');
  } catch {
    return locationError('unavailable');
  }
  return parseNativeResponse(response, Date.now());
}

function browserErrorCode(code: number): LocationErrorCode {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

function requestBrowserLocation(): Promise<LocationFix> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new LocationRequestError('unsupported'));
  }
  return new Promise<LocationFix>((resolve, reject) => {
    // eslint-disable-next-line sonarjs/no-intrusive-permissions -- invoked only by explicit user action
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(validateLocationFix({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            horizontalAccuracyMeters: position.coords.accuracy,
            observedAtUnixMs: position.timestamp,
          }, 'browser', Date.now()));
        } catch (error) {
          reject(error instanceof Error ? error : new LocationRequestError('invalid'));
        }
      },
      (error) => reject(new LocationRequestError(browserErrorCode(error.code))),
      { enableHighAccuracy: true, timeout: LOCATION_REQUEST_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

export function requestCurrentLocation(): Promise<LocationFix> {
  return hasTauriInvokeBridge() ? requestNativeLocation() : requestBrowserLocation();
}

class LocationService {
  getLocation(options?: GetLocationOptions): Promise<LocationFix>;
  getLocation(): Promise<LocationFix> {
    return requestCurrentLocation();
  }
}

export const locationService = new LocationService();
