import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { formatLogArgument, isExpectedFeedFailure } from '../log-bridge.ts';

const originalLocalStorage = globalThis.localStorage;
const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() { return storage.size; },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    removeItem: (key: string) => { storage.delete(key); },
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } satisfies Storage,
});

function seedBreakerCache(name: string, data: unknown): void {
  const key = `breaker:${name}`;
  storage.set(`crystalball-persistent-cache:${key}`, JSON.stringify({
    key,
    updatedAt: Date.now(),
    data,
  }));
}

after(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

test('GDACS cache hydration restores event dates before normalization', async () => {
  seedBreakerCache('GDACS', [{
    id: 'gdacs-EQ-1',
    eventType: 'EQ',
    name: 'Test earthquake',
    description: 'Test event',
    alertLevel: 'Orange',
    country: 'Testland',
    coordinates: [10, 20],
    fromDate: '2026-08-10T01:02:03.000Z',
    severity: 'Moderate',
    url: 'https://example.com/event',
  }]);
  const { fetchGDACSEvents } = await import('../gdacs.ts');
  const { normalizeGDACSEvent } = await import('../alert-normalizer.ts');

  const [event] = await fetchGDACSEvents();

  assert.ok(event?.fromDate instanceof Date);
  assert.equal(normalizeGDACSEvent(event!).timestamp, Date.parse('2026-08-10T01:02:03.000Z'));
});

test('extended forecast cache hydration restores fetchedAt', async () => {
  seedBreakerCache('ExtendedForecast', {
    location: 'Test City',
    lat: 10,
    lon: 20,
    days: [],
    fetchedAt: '2026-08-10T01:02:03.000Z',
  });
  const { fetchExtendedForecast } = await import('../extended-forecast.ts');

  const forecast = await fetchExtendedForecast(10, 20, 'Test City');

  assert.ok(forecast?.fetchedAt instanceof Date);
  assert.equal(forecast.fetchedAt.getTime(), Date.parse('2026-08-10T01:02:03.000Z'));
});

test('tide cache hydration restores fetchedAt and prediction times', async () => {
  seedBreakerCache('Tides', {
    station: { id: '8518750', name: 'The Battery, NY', lat: 40.7, lon: -74.01, state: 'NY' },
    predictions: [{ time: '2026-08-10T01:02:03.000Z', height: 3.2, type: 'H' }],
    fetchedAt: '2026-08-10T01:02:03.000Z',
  });
  const { fetchTidePredictions } = await import('../tide-predictions.ts');

  const data = await fetchTidePredictions('8518750');

  assert.ok(data?.fetchedAt instanceof Date);
  assert.ok(data.predictions[0]?.time instanceof Date);
  assert.doesNotThrow(() => data.predictions[0]!.time.toLocaleTimeString('en-US'));
});

test('flight delay cache hydration restores updatedAt', async () => {
  seedBreakerCache('Flight Delays v2', [{
    id: 'delay-1',
    iata: 'ORD',
    icao: 'KORD',
    name: "O'Hare International Airport",
    city: 'Chicago',
    country: 'United States',
    lat: 41.9742,
    lon: -87.9073,
    region: 'americas',
    delayType: 'ground_delay',
    severity: 'moderate',
    avgDelayMinutes: 45,
    source: 'faa',
    updatedAt: '2026-08-10T01:02:03.000Z',
  }]);
  const { fetchFlightDelays } = await import('../aviation/index.ts');

  const [delay] = await fetchFlightDelays();

  assert.ok(delay?.updatedAt instanceof Date);
  assert.doesNotThrow(() => delay!.updatedAt.toLocaleTimeString('en-US'));
});

test('weather alert cache hydration restores onset and expiry dates', async () => {
  seedBreakerCache('NWS Weather', [{
    id: 'weather-1',
    event: 'Tornado Warning',
    severity: 'Extreme',
    headline: 'Test warning',
    description: 'Test warning description',
    areaDesc: 'Test County',
    onset: '2026-08-10T01:02:03.000Z',
    expires: '2026-08-10T02:02:03.000Z',
    coordinates: [],
    ugcZones: ['ILC031'],
  }]);
  const { fetchWeatherAlerts, fetchWeatherAlertsWithFeedState } = await import('../weather.ts');

  const [alert] = await fetchWeatherAlerts();
  const tracked = await fetchWeatherAlertsWithFeedState();

  assert.ok(alert?.onset instanceof Date);
  assert.ok(alert?.expires instanceof Date);
  assert.ok(tracked.alerts[0]?.onset instanceof Date);
  assert.ok(tracked.alerts[0]?.expires instanceof Date);
});

test('red flag warning cache hydration restores onset and expiry dates', async () => {
  seedBreakerCache('NWS-RedFlag', [{
    id: 'red-flag-1',
    event: 'Red Flag Warning',
    headline: 'Critical fire weather conditions',
    areaDesc: 'Test County',
    severity: 'Severe',
    onset: '2026-08-10T01:02:03.000Z',
    expires: '2026-08-10T02:02:03.000Z',
    centroid: [-87.63, 41.88],
  }]);
  const { fetchRedFlagWarnings } = await import('../red-flag-warnings.ts');

  const [warning] = await fetchRedFlagWarnings();

  assert.ok(warning?.onset instanceof Date);
  assert.ok(warning?.expires instanceof Date);
});

test('pollen cache hydration restores updatedAt', async () => {
  seedBreakerCache('Pollen', [{
    city: 'Chicago',
    lat: 41.88,
    lon: -87.63,
    grassPollen: 10,
    birchPollen: 5,
    ragweedPollen: 2,
    alderPollen: 1,
    olivePollen: 0,
    overallLevel: 'low',
    dominantType: 'Grass',
    updatedAt: '2026-08-10T01:02:03.000Z',
  }]);
  const { fetchPollenData } = await import('../pollen.ts');

  const [reading] = await fetchPollenData();

  assert.ok(reading?.updatedAt instanceof Date);
});

test('SPC WebKit load failures carry fetch context into the log classifier', async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const capturedErrors: unknown[][] = [];
  globalThis.fetch = (async () => { throw new TypeError('Load failed'); }) as typeof globalThis.fetch;
  console.error = (...args: unknown[]) => { capturedErrors.push(args); };
  const { fetchFireWeatherOutlook } = await import('../red-flag-warnings.ts');

  try {
    assert.deepEqual(await fetchFireWeatherOutlook(), []);
    assert.equal(capturedErrors.length, 1);
    const message = capturedErrors[0]!.map(formatLogArgument).join(' ');
    assert.equal(isExpectedFeedFailure(message), true, message);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('SPC unexpected fetch exceptions remain genuine errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const capturedErrors: unknown[][] = [];
  globalThis.fetch = (async () => { throw new TypeError('Unexpected response coercion'); }) as typeof globalThis.fetch;
  console.error = (...args: unknown[]) => { capturedErrors.push(args); };
  console.warn = () => {};
  const { fetchFireWeatherOutlook } = await import('../red-flag-warnings.ts');

  try {
    assert.deepEqual(await fetchFireWeatherOutlook(), []);
    assert.equal(capturedErrors.length, 1);
    const message = capturedErrors[0]!.map(formatLogArgument).join(' ');
    assert.equal(isExpectedFeedFailure(message), false, message);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});
