import assert from 'node:assert/strict';
import test from 'node:test';

interface InvokeCall {
  command: string;
}

type InvokeImpl = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

const calls: InvokeCall[] = [];
let invokeImpl: InvokeImpl = async () => { throw new Error('no impl set'); };

const testWindow: { __TAURI__?: { core: { invoke: InvokeImpl } } } = {};
(globalThis as unknown as { window: typeof testWindow }).window = testWindow;

function installTauri(): void {
  testWindow.__TAURI__ = {
    core: {
      invoke: <T>(command: string, payload?: Record<string, unknown>): Promise<T> => {
        calls.push({ command });
        return invokeImpl<T>(command, payload);
      },
    },
  };
}

function installBrowserGeolocation(
  getCurrentPosition: (
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ) => void,
): void {
  delete testWindow.__TAURI__;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { geolocation: { getCurrentPosition } },
  });
}

const {
  LOCATION_REQUEST_TIMEOUT_MS,
  LocationRequestError,
  locationService,
  requestCurrentLocation,
} = await import('../location.ts');

function nativeSuccess(
  latitude: number,
  longitude: number,
  horizontalAccuracyMeters: number,
  observedAtUnixMs: number,
): unknown {
  return {
    ok: true,
    fix: { latitude, longitude, horizontalAccuracyMeters, observedAtUnixMs },
  };
}

function assertLocationCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof LocationRequestError);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /41\.6|-86\.7|secret platform detail/);
  return true;
}

test('native requests are stateless and preserve real accuracy, timestamp, and zero coordinates', async () => {
  calls.length = 0;
  installTauri();
  const observedAt = Date.now() - 1_000;
  invokeImpl = (async () => nativeSuccess(0, 0, 25, observedAt) as never) as InvokeImpl;

  const first = await requestCurrentLocation();
  const second = await locationService.getLocation();

  assert.deepEqual(first, {
    lat: 0,
    lon: 0,
    accuracy: 25,
    timestamp: observedAt,
    source: 'native',
  });
  assert.deepEqual(second, first);
  assert.equal(calls.filter((call) => call.command === 'get_native_location').length, 2);
});

test('native allowlisted failures remain structured and coordinate-free', async () => {
  installTauri();
  for (const code of ['denied', 'restricted', 'disabled', 'timeout', 'unavailable', 'busy', 'unsupported']) {
    invokeImpl = (async () => ({ ok: false, error: { code } }) as never) as InvokeImpl;
    await assert.rejects(() => locationService.getLocation(), (error) => assertLocationCode(error, code));
  }

  invokeImpl = (async () => { throw new Error('secret platform detail 41.6,-86.7'); }) as InvokeImpl;
  await assert.rejects(() => locationService.getLocation(), (error) => assertLocationCode(error, 'unavailable'));
});

test('denied copy preserves the existing permission-settings action gate', async () => {
  installTauri();
  invokeImpl = (async () => ({ ok: false, error: { code: 'denied' } }) as never) as InvokeImpl;

  await assert.rejects(() => locationService.getLocation(), (error) => {
    assertLocationCode(error, 'denied');
    assert.ok((error as Error).message.includes('permission denied'));
    return true;
  });
});

test('malformed native envelopes fail closed without echoing their payload', async () => {
  installTauri();
  for (const payload of [
    [41.6, -86.7],
    { ok: true, fix: { latitude: 41.6, longitude: -86.7, horizontalAccuracyMeters: 5, observedAtUnixMs: Date.now(), extra: 'secret platform detail' } },
    { ok: false, error: { code: 'surprise', detail: 'secret platform detail 41.6,-86.7' } },
  ]) {
    invokeImpl = (async () => payload as never) as InvokeImpl;
    await assert.rejects(() => locationService.getLocation(), (error) => assertLocationCode(error, 'invalid'));
  }
});

test('location policy rejects stale, future, inaccurate, and invalid observations before use', async () => {
  installTauri();
  const now = Date.now();
  const cases: Array<[unknown, string]> = [
    [nativeSuccess(41.6, -86.7, 10, now - 60_001), 'stale'],
    [nativeSuccess(41.6, -86.7, 10, now + 31_000), 'invalid'],
    [nativeSuccess(41.6, -86.7, 50_001, now), 'inaccurate'],
    [nativeSuccess(Number.NaN, -86.7, 10, now), 'invalid'],
    [nativeSuccess(91, -86.7, 10, now), 'invalid'],
    [nativeSuccess(41.6, -181, 10, now), 'invalid'],
    [nativeSuccess(41.6, -86.7, -1, now), 'invalid'],
    [nativeSuccess(41.6, -86.7, 10.5, Number.NaN), 'invalid'],
  ];

  for (const [payload, code] of cases) {
    invokeImpl = (async () => payload as never) as InvokeImpl;
    await assert.rejects(() => locationService.getLocation(), (error) => assertLocationCode(error, code));
  }
});

test('location policy accepts its exact age, future-skew, and accuracy boundaries', async () => {
  installTauri();
  const now = 1_777_777_777_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    for (const payload of [
      nativeSuccess(41.6, -86.7, 50_000, now - 60_000),
      nativeSuccess(41.6, -86.7, 50_000, now + 30_000),
    ]) {
      invokeImpl = (async () => payload as never) as InvokeImpl;
      assert.equal((await locationService.getLocation()).accuracy, 50_000);
    }
  } finally {
    Date.now = originalNow;
  }
});

test('browser acquisition is one-shot, uncached, and uses the fixed platform policy', async () => {
  const observedAt = Date.now() - 2_000;
  const options: PositionOptions[] = [];
  let requests = 0;
  installBrowserGeolocation((success, _error, receivedOptions) => {
    requests += 1;
    options.push(receivedOptions ?? {});
    success({
      coords: {
        latitude: 0,
        longitude: 12,
        accuracy: 100,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: observedAt,
      toJSON: () => ({}),
    });
  });

  const first = await locationService.getLocation({ timeoutMs: 1, maxAgeMs: 999_999, force: false });
  const second = await locationService.getLocation();

  assert.equal(requests, 2);
  assert.deepEqual(first, { lat: 0, lon: 12, accuracy: 100, timestamp: observedAt, source: 'browser' });
  assert.deepEqual(second, first);
  assert.deepEqual(options, [
    { enableHighAccuracy: true, timeout: LOCATION_REQUEST_TIMEOUT_MS, maximumAge: 0 },
    { enableHighAccuracy: true, timeout: LOCATION_REQUEST_TIMEOUT_MS, maximumAge: 0 },
  ]);
  assert.equal(LOCATION_REQUEST_TIMEOUT_MS, 15_000);
});

test('browser errors use fixed codes and never include the platform message', async () => {
  const browserCases: Array<[number, string]> = [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']];
  for (const [platformCode, expectedCode] of browserCases) {
    installBrowserGeolocation((_success, error) => {
      error?.({ code: platformCode, message: 'secret platform detail 41.6,-86.7', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    });
    await assert.rejects(() => locationService.getLocation(), (caught) => assertLocationCode(caught, expectedCode));
  }

  delete testWindow.__TAURI__;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(() => locationService.getLocation(), (error) => assertLocationCode(error, 'unsupported'));
});
