import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

import { addSavedPlace, getSavedPlaces, removeSavedPlace, type SavedPlace } from '../../services/saved-places.ts';
import type { LocalLogisticsSnapshot, LogisticsNode } from '../../services/local-logistics.ts';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis as unknown as Record<string, unknown>, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  KeyboardEvent: happyWindow.KeyboardEvent,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
(globalThis as unknown as Record<string, unknown>).getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
(globalThis as unknown as Record<string, unknown>).matchMedia = happyWindow.matchMedia.bind(happyWindow);

const { LocalLogisticsPanel } = await import('../LocalLogisticsPanel.ts');

interface CurrentFix {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
  source: 'native' | 'browser';
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function emptySnapshot(radiusKm: number): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: 'session-lifelines',
    placeId: 'session-current-location',
    placeName: 'Current location',
    effectiveRadiusKm: radiusKm,
    categories: ['shelter', 'hotel', 'hospital', 'pharmacy', 'fuel', 'water', 'recovery'],
    sites: [], observations: [], nodes: [], areaConditions: [], providers: [],
    fetchedAt: new Date(), isStale: false, isExpired: false, staleAgeMs: 0, source: 'network',
  };
}

function facilitySnapshot(radiusKm: number, expiresInMs = 60 * 60_000): LocalLogisticsSnapshot {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMs);
  const node: LogisticsNode = {
    id: 'fuel-1', kind: 'fuel', category: 'fuel', name: 'Fuel Stop', lat: 35.99, lon: -78.9,
    distanceKm: 2, source: 'OpenStreetMap directory', sourceRefs: [{ provider: 'osm', recordId: 'node/1' }],
    capabilities: {}, freshness: 'fresh', hazardCompatibility: 'supply', fetchedAt: now,
    operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
    verification: 'directory', observedAt: now, retrievedAt: now,
    expiresAt, confidence: 'low',
    sourceUrl: 'https://www.openstreetmap.org/node/1', directoryOnly: true,
    directoryUrl: 'https://www.openstreetmap.org/node/1', url: 'https://www.openstreetmap.org/node/1',
    publicPhone: '+1 919 555 0100',
  };
  return {
    ...emptySnapshot(radiusKm),
    sites: [{
      id: node.id, kind: node.kind, name: node.name, lat: node.lat, lon: node.lon,
      sourceRefs: node.sourceRefs, capabilities: node.capabilities, publicPhone: node.publicPhone,
      directoryUrl: node.directoryUrl,
    }],
    observations: [{
      id: 'fuel-1:directory', siteId: node.id, provider: 'osm', verification: 'directory',
      operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
      observedAt: now, retrievedAt: now, expiresAt: node.expiresAt, confidence: 'low',
      sourceUrl: node.sourceUrl,
    }],
    nodes: [node],
    providers: [{ id: 'osm', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: now, retrievedAt: now }],
  };
}

function mountPanel(options: Record<string, unknown>): InstanceType<typeof LocalLogisticsPanel> {
  const panel = new LocalLogisticsPanel({ focusNode: () => {}, ...options } as never);
  document.body.append(panel.getElement());
  return panel;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  assert.ok(element, `${selector} should be rendered; content: ${root.textContent ?? ''}`);
  return element;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 260));
}

const mounted: Array<InstanceType<typeof LocalLogisticsPanel>> = [];

beforeEach(() => {
  document.body.replaceChildren();
  happyWindow.localStorage.clear();
  for (const place of getSavedPlaces()) removeSavedPlace(place.id);
});

afterEach(() => {
  for (const panel of mounted.splice(0)) panel.destroy();
  for (const place of getSavedPlaces()) removeSavedPlace(place.id);
});

test('explicit disclosure gates one-shot acquisition and ready UI shows accuracy, time, and uncertainty', async () => {
  const calls: Array<{ anchor: { latitude: number; longitude: number }; radiusKm: number }> = [];
  const fix: CurrentFix = {
    lat: 0,
    lon: -78.8986,
    accuracy: 12_000,
    timestamp: Date.now() - 2_000,
    source: 'browser',
  };
  const panel = mountPanel({
    requestLocation: async () => fix,
    openSaveCurrentLocation: () => {},
    fetchEphemeralSnapshot: async (anchor: { latitude: number; longitude: number }, options: { radiusKm: number }) => {
      calls.push({ anchor, radiusKm: options.radiusKm });
      return emptySnapshot(options.radiusKm);
    },
  });
  mounted.push(panel);
  await settle();

  const content = panel.getContentElement();
  assert.match(content.textContent ?? '', /one location fix/i);
  assert.match(content.textContent ?? '', /session-only/i);
  assert.match(content.textContent ?? '', /Overpass, FEMA, Census, and ODIN/i);
  assert.match(content.textContent ?? '', /third-party provider access-log retention cannot be guaranteed/i);
  assert.equal(calls.length, 0, 'mount must not acquire or fetch');
  required<HTMLButtonElement>(content, '[data-logistics-use-current-location]').click();
  await settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.anchor.latitude, 0, 'zero-valued coordinates must remain valid');
  assert.equal(calls[0]?.radiusKm, 10);
  assert.match(content.textContent ?? '', /Accuracy.+12 km/is);
  assert.match(content.textContent ?? '', /Observed/i);
  assert.match(content.textContent ?? '', /uncertainty exceeds the selected 10 km coverage/i);
  assert.ok(content.querySelector('[data-logistics-update-location]'));
  assert.ok(content.querySelector('[data-logistics-clear-location]'));
  assert.ok(content.querySelector('[data-logistics-save-location]'));
  const aiButton = panel.getElement().querySelector<HTMLButtonElement>('.panel-ai-btn');
  assert.equal(aiButton?.hidden, true, 'current-location data must never reach AI Summary');
  assert.equal(aiButton?.disabled, true);
  assert.equal(document.activeElement, required(content, '[data-logistics-update-location]'));
});

test('refresh reuses the panel-owned anchor, update reacquires, and ephemeral actions stay private', async () => {
  let locationCalls = 0;
  let fetchCalls = 0;
  const events: string[] = [];
  const observedEvents = [
    'wm:local-logistics-updated', 'wm:active-local-logistics-snapshot-updated',
    'wm:show-lifelines-overlay', 'wm:clear-lifelines-overlay', 'wm:local-logistics-active-place-changed',
    'wm:show-evac-route',
  ];
  const listeners = observedEvents.map((name) => {
    const listener = () => events.push(name);
    document.addEventListener(name, listener);
    return { name, listener };
  });
  const panel = mountPanel({
    requestLocation: async () => ({
      lat: 35 + locationCalls++, lon: -78, accuracy: 20, timestamp: Date.now(), source: 'browser',
    }),
    fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => {
      fetchCalls += 1;
      return facilitySnapshot(options.radiusKm);
    },
  });
  mounted.push(panel);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await settle();
  events.length = 0;

  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-refresh]').click();
  await settle();
  assert.equal(locationCalls, 1, 'refresh must reuse the in-memory fix');
  assert.equal(fetchCalls, 2);
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-update-location]').click();
  await settle();
  assert.equal(locationCalls, 2, 'Update Location must acquire a new fix');
  assert.equal(fetchCalls, 3);
  assert.deepEqual(events, [], 'ephemeral fetches must not publish cross-feature events');

  const content = panel.getContentElement();
  assert.equal(content.querySelector('[data-logistics-map]'), null);
  assert.equal(content.querySelector('[data-lifeline-prewarm]'), null);
  assert.equal(content.querySelector('[data-logistics-route]'), null);
  assert.equal(content.querySelector('[data-logistics-focus]'), null);
  assert.doesNotMatch(content.textContent ?? '', /Offline Lifelines:/i);
  assert.ok(content.querySelector('[data-logistics-call]'));
  assert.ok(content.querySelector('[data-logistics-source]'));
  assert.ok(content.querySelector('[data-logistics-external-map]'));
  assert.equal(panel.getElement().querySelector<HTMLButtonElement>('.panel-ai-btn')?.hidden, true);
  for (const { name, listener } of listeners) document.removeEventListener(name, listener);
});

test('clear and destroy abort network work and make late location or fetch completions inert', async () => {
  const location = deferred<CurrentFix>();
  const fetches: Array<{ signal?: AbortSignal; pending: Deferred<LocalLogisticsSnapshot> }> = [];
  const panel = mountPanel({
    requestLocation: () => location.promise,
    fetchEphemeralSnapshot: (_anchor: CurrentFix, options: { radiusKm: number; signal?: AbortSignal }) => {
      const pending = deferred<LocalLogisticsSnapshot>();
      fetches.push({ signal: options.signal, pending });
      return pending.promise;
    },
  });
  mounted.push(panel);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-clear-location]').click();
  location.resolve({ lat: 35, lon: -78, accuracy: 10, timestamp: Date.now(), source: 'browser' });
  await settle();
  assert.equal(fetches.length, 0, 'a location result after clear must be inert');
  assert.match(panel.getContentElement().textContent ?? '', /Use current location/i);

  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await Promise.resolve();
  location.resolve({ lat: 35, lon: -78, accuracy: 10, timestamp: Date.now(), source: 'browser' });
  await settle();
  if (fetches[0]) {
    panel.destroy();
    mounted.splice(mounted.indexOf(panel), 1);
    assert.equal(fetches[0].signal?.aborted, true);
    fetches[0].pending.resolve(emptySnapshot(10));
    await settle();
  }
  assert.equal(fetches[0]?.signal?.aborted, true, 'destroy must retain the aborted request ownership');
});

test('destroy clears every accepted current-location snapshot owner', async () => {
  const panel = mountPanel({
    requestLocation: async () => ({
      lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser',
    }),
    fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => (
      facilitySnapshot(options.radiusKm)
    ),
  });
  mounted.push(panel);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await settle();

  const state = panel as unknown as {
    anchorMode: string;
    activeRadiusKm: number | null;
    currentLocationState: string;
    currentLocationFix: CurrentFix | null;
    currentLocationError: string | null;
    pendingCurrentLocationFocus: string | null;
    pendingRadiusFocusKm: number | null;
    snapshot: LocalLogisticsSnapshot | null;
    snapshotPlaceSignature: string | null;
    nodeLookup: Map<string, LogisticsNode>;
    evidenceExpiryScheduler: {
      currentSnapshot: LocalLogisticsSnapshot | null;
      timer: ReturnType<typeof setTimeout> | null;
      destroyed: boolean;
    };
  };
  assert.equal(state.currentLocationState, 'ready');
  assert.ok(state.snapshot, 'fixture must reach an accepted snapshot');
  assert.equal(state.nodeLookup.size, 1);
  assert.ok(state.evidenceExpiryScheduler.currentSnapshot);
  assert.ok(state.evidenceExpiryScheduler.timer);

  panel.destroy();
  mounted.splice(mounted.indexOf(panel), 1);

  assert.deepEqual({
    anchorMode: state.anchorMode,
    activeRadiusKm: state.activeRadiusKm,
    currentLocationState: state.currentLocationState,
    currentLocationFix: state.currentLocationFix,
    currentLocationError: state.currentLocationError,
    pendingCurrentLocationFocus: state.pendingCurrentLocationFocus,
    pendingRadiusFocusKm: state.pendingRadiusFocusKm,
    snapshot: state.snapshot,
    snapshotPlaceSignature: state.snapshotPlaceSignature,
    nodeCount: state.nodeLookup.size,
    expirySnapshot: state.evidenceExpiryScheduler.currentSnapshot,
    expiryTimer: state.evidenceExpiryScheduler.timer,
    expiryDestroyed: state.evidenceExpiryScheduler.destroyed,
  }, {
    anchorMode: 'saved',
    activeRadiusKm: null,
    currentLocationState: 'idle',
    currentLocationFix: null,
    currentLocationError: null,
    pendingCurrentLocationFocus: null,
    pendingRadiusFocusKm: null,
    snapshot: null,
    snapshotPlaceSignature: null,
    nodeCount: 0,
    expirySnapshot: null,
    expiryTimer: null,
    expiryDestroyed: true,
  });
});

test('location failure codes stay bounded, make one request, never fall back, and restore retry focus', async () => {
  const cases = [
    ['denied', /permission was denied/i],
    ['restricted', /restricted by this device/i],
    ['disabled', /Location Services are disabled/i],
    ['timeout', /timed out/i],
    ['unavailable', /current location is unavailable/i],
    ['stale', /old location fix/i],
    ['inaccurate', /too imprecise/i],
    ['busy', /already active/i],
    ['invalid', /invalid location fix/i],
    ['unsupported', /not supported/i],
  ] as const;
  const rawError = 'secret-lat=35.994-lon=-78.8986-server-token';
  let observedLogCalls = 0;
  const priorConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => { observedLogCalls += 1; };
  console.warn = () => { observedLogCalls += 1; };
  console.error = () => { observedLogCalls += 1; };
  try {
    for (const [code, expected] of cases) {
      let locationCalls = 0;
      let fetchCalls = 0;
      const panel = mountPanel({
        requestLocation: async () => {
          locationCalls += 1;
          throw Object.assign(new Error(rawError), { code });
        },
        fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => {
          fetchCalls += 1;
          return emptySnapshot(options.radiusKm);
        },
      });
      mounted.push(panel);
      await settle();
      required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
      await settle();
      const content = panel.getContentElement();
      assert.equal(locationCalls, 1, `${code} must issue one platform request`);
      assert.equal(fetchCalls, 0, `${code} must not use a renderer fallback`);
      assert.match(content.textContent ?? '', expected);
      assert.doesNotMatch(content.textContent ?? '', /35\.994|-78\.8986|server-token/i);
      const retry = required<HTMLButtonElement>(content, '[data-logistics-update-location]');
      assert.equal(document.activeElement === retry, true, `${code} must restore focus to retry`);
      panel.destroy();
      mounted.pop();
    }
  } finally {
    console.log = priorConsole.log;
    console.warn = priorConsole.warn;
    console.error = priorConsole.error;
  }
  assert.equal(observedLogCalls, 0, 'renderer must not log platform error details');
});

test('ephemeral facility actions suppress internal map and route effects while allowing explicit external actions', async () => {
  let focusCalls = 0;
  const routeEvents: Event[] = [];
  const onRoute = (event: Event) => routeEvents.push(event);
  document.addEventListener('wm:show-evac-route', onRoute);
  const opened: Array<[string | URL | undefined, string | undefined, string | undefined]> = [];
  const priorOpen = window.open;
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    opened.push([url, target, features]);
    return null;
  }) as typeof window.open;
  try {
    const panel = mountPanel({
      focusNode: () => { focusCalls += 1; },
      requestLocation: async () => ({ lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser' }),
      fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => facilitySnapshot(options.radiusKm),
    });
    mounted.push(panel);
    await settle();
    required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
    await settle();
    const content = panel.getContentElement();

    assert.equal(content.querySelector('[data-logistics-focus]'), null);
    assert.equal(content.querySelector('[data-logistics-route]'), null);
    const forgedFocus = document.createElement('button');
    forgedFocus.dataset.logisticsFocus = '1';
    forgedFocus.dataset.logisticsNodeId = 'fuel-1';
    content.append(forgedFocus);
    forgedFocus.click();
    const forgedRoute = document.createElement('button');
    forgedRoute.dataset.logisticsRoute = 'fuel-1';
    content.append(forgedRoute);
    forgedRoute.click();
    await Promise.resolve();
    assert.equal(focusCalls, 0, 'ephemeral mode must fail closed against internal map focus');
    assert.equal(routeEvents.length, 0, 'ephemeral mode must fail closed against internal route events');

    required<HTMLButtonElement>(content, '[data-logistics-call]').click();
    required<HTMLButtonElement>(content, '[data-logistics-source]').click();
    required<HTMLButtonElement>(content, '[data-logistics-external-map]').click();
    assert.equal(opened.length, 3);
    assert.deepEqual(opened.map(([, target]) => target), ['_self', '_blank', '_blank']);
    assert.equal(opened[1]?.[2], 'noopener,noreferrer');
    assert.equal(opened[2]?.[2], 'noopener,noreferrer');
  } finally {
    window.open = priorOpen;
    document.removeEventListener('wm:show-evac-route', onRoute);
  }
});

test('ephemeral evidence expiry repaints panel-owned status without publishing document events', async () => {
  const events: string[] = [];
  const names = ['wm:local-logistics-updated', 'wm:clear-lifelines-overlay'];
  const listeners = names.map((name) => {
    const listener = () => events.push(name);
    document.addEventListener(name, listener);
    return { name, listener };
  });
  try {
    const panel = mountPanel({
      requestLocation: async () => ({ lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser' }),
      fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => facilitySnapshot(options.radiusKm, 450),
    });
    mounted.push(panel);
    await settle();
    required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
    await settle();
    assert.match(panel.getContentElement().textContent ?? '', /Directory listing only/i);
    events.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await settle();
    assert.match(panel.getContentElement().textContent ?? '', /expired — status unknown/i);
    assert.deepEqual(events, [], 'ephemeral expiry must repaint without publishing or clearing shared state');
  } finally {
    for (const { name, listener } of listeners) document.removeEventListener(name, listener);
  }
});

test('radius changes invalidate stale save callbacks and only exact current-radius readback converts mode', async () => {
  const callbacks: Array<(place: SavedPlace) => void> = [];
  const prefills: Array<{ latitude: number; longitude: number; radiusKm: number }> = [];
  const panel = mountPanel({
    requestLocation: async () => ({ lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser' }),
    fetchSnapshot: async (place: SavedPlace, options: { radiusKm: number }) => ({
      ...emptySnapshot(options.radiusKm), placeId: place.id, placeName: place.name,
    }),
    fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => emptySnapshot(options.radiusKm),
    openSaveCurrentLocation: (
      prefill: { latitude: number; longitude: number; radiusKm: number },
      onConfirmed: (place: SavedPlace) => void,
    ) => { prefills.push(prefill); callbacks.push(onConfirmed); },
  });
  mounted.push(panel);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-save-location]').click();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-radius="25"]').click();
  await settle();
  const stale = addSavedPlace({ name: 'Stale radius', lat: 35.994, lon: -78.8986, radiusKm: 10 });
  callbacks[0]?.(stale);
  await settle();
  assert.match(panel.getContentElement().textContent ?? '', /Current location/i);
  assert.equal(panel.getContentElement().querySelector('[data-logistics-map]') === null, true);

  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-save-location]').click();
  assert.deepEqual(prefills, [
    { latitude: 35.994, longitude: -78.8986, radiusKm: 10 },
    { latitude: 35.994, longitude: -78.8986, radiusKm: 25 },
  ]);
  const current = addSavedPlace({ name: 'Current radius', lat: 35.994, lon: -78.8986, radiusKm: 25 });
  callbacks[1]?.(current);
  await settle();
  assert.match(panel.getContentElement().textContent ?? '', /Current radius/i);
  assert.ok(panel.getContentElement().querySelector('[data-logistics-map]'));
});

test('saved-place selection and newer radius fetches make late ephemeral completions inert', async () => {
  const location = deferred<CurrentFix>();
  const fetches: Array<{ radiusKm: number; signal?: AbortSignal; pending: Deferred<LocalLogisticsSnapshot> }> = [];
  const saved = addSavedPlace({ name: 'Saved anchor', lat: 41, lon: -86, radiusKm: 10 });
  const panel = mountPanel({
    requestLocation: () => location.promise,
    fetchSnapshot: async () => ({ ...emptySnapshot(10), placeId: saved.id, placeName: saved.name }),
    fetchEphemeralSnapshot: (_anchor: CurrentFix, options: { radiusKm: number; signal?: AbortSignal }) => {
      const pending = deferred<LocalLogisticsSnapshot>();
      fetches.push({ radiusKm: options.radiusKm, signal: options.signal, pending });
      return pending.promise;
    },
  });
  mounted.push(panel);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  panel.setPlaceId(saved.id);
  location.resolve({ lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser' });
  await settle();
  assert.equal(fetches.length, 0, 'saved-place selection must invalidate a late platform result');
  assert.match(panel.getContentElement().textContent ?? '', /Saved anchor/i);

  panel.setPlaceId(null);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await Promise.resolve();
  await settle();
  assert.equal(fetches.length, 1);
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-radius="25"]').click();
  await settle();
  assert.equal(fetches.length, 2);
  assert.equal(fetches[0]?.signal?.aborted, true);
  fetches[1]?.pending.resolve(emptySnapshot(25));
  await settle();
  fetches[0]?.pending.resolve(facilitySnapshot(10));
  await settle();
  assert.equal(required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-radius="25"]').getAttribute('aria-pressed'), 'true');
  assert.equal(
    panel.getContentElement().querySelector('[data-logistics-node-card="fuel-1"]') === null,
    true,
    'older fetch A must not replace newer fetch B',
  );
});

test('current-location controls expose stable focus, busy, live-region, and full-variant identity contracts', async () => {
  const location = deferred<CurrentFix>();
  const panel = mountPanel({
    requestLocation: () => location.promise,
    fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => emptySnapshot(options.radiusKm),
  });
  mounted.push(panel);
  await settle();
  const disclosure = required<HTMLElement>(panel.getContentElement(), 'section[aria-label="Current-location Lifelines"]');
  assert.ok(disclosure.querySelector('button[type="button"]'));
  required<HTMLButtonElement>(disclosure, '[data-logistics-use-current-location]').click();
  await settle();
  const busyContent = required<HTMLElement>(panel.getContentElement(), '[data-local-logistics-content]');
  assert.equal(busyContent.getAttribute('aria-busy'), 'true');
  assert.equal(required(busyContent, '[role="status"][aria-live="polite"]').textContent?.includes('Requesting'), true);
  assert.equal(required<HTMLButtonElement>(busyContent, '[data-logistics-update-location]').disabled, true);
  assert.equal(required(busyContent, 'fieldset[aria-label="Lifeline search radius"]') !== null, true);
  location.resolve({ lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser' });
  await settle();
  assert.equal(document.activeElement === required(panel.getContentElement(), '[data-logistics-update-location]'), true);

  const panelsSource = readFileSync(new URL('../../config/panels.ts', import.meta.url), 'utf8');
  const panelBlock = (marker: string): string => {
    const start = panelsSource.indexOf(marker);
    assert.notEqual(start, -1, `${marker} must exist`);
    const end = panelsSource.indexOf('\n};', start);
    assert.notEqual(end, -1, `${marker} must terminate`);
    return panelsSource.slice(start, end + 3);
  };
  const fullBlock = panelBlock('const FULL_PANELS');
  const techBlock = panelBlock('const TECH_PANELS');
  const financeBlock = panelBlock('const FINANCE_PANELS');
  const happyBlock = panelBlock('const HAPPY_PANELS');
  assert.match(fullBlock, /'local-logistics'/);
  assert.doesNotMatch(techBlock, /'local-logistics'/);
  assert.doesNotMatch(financeBlock, /'local-logistics'/);
  assert.doesNotMatch(happyBlock, /'local-logistics'/);
});

test('existing explicit location callers disclose the fixed 15-second one-shot deadline', () => {
  const gateSource = readFileSync(new URL('../location-gate.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../UnifiedSettings.ts', import.meta.url), 'utf8');
  for (const source of [gateSource, settingsSource]) {
    assert.match(source, /Waiting for location \(up to 15s\)/);
    assert.doesNotMatch(source, /Waiting for location \(up to 10s\)/);
  }
});

test('save conversion switches to saved mode only after exact current-generation confirmation', async () => {
  let confirmSave: ((place: SavedPlace) => void) | null = null;
  const panel = mountPanel({
    requestLocation: async () => ({ lat: 35.994, lon: -78.8986, accuracy: 15, timestamp: Date.now(), source: 'browser' }),
    fetchEphemeralSnapshot: async (_anchor: CurrentFix, options: { radiusKm: number }) => emptySnapshot(options.radiusKm),
    openSaveCurrentLocation: (
      prefill: { latitude: number; longitude: number; radiusKm: number },
      onConfirmed: (place: SavedPlace) => void,
    ) => {
      assert.deepEqual(prefill, { latitude: 35.994, longitude: -78.8986, radiusKm: 10 });
      confirmSave = onConfirmed;
    },
  });
  mounted.push(panel);
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-use-current-location]').click();
  await settle();
  required<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-save-location]').click();
  assert.ok(confirmSave);
  assert.match(panel.getContentElement().textContent ?? '', /Current location/i);

  const saved = addSavedPlace({ name: 'Saved current area', lat: 35.994, lon: -78.8986, radiusKm: 10 });
  confirmSave?.(saved);
  await settle();
  assert.match(panel.getContentElement().textContent ?? '', /Saved current area/i);
  assert.ok(panel.getContentElement().querySelector('[data-logistics-map]'), 'normal saved-place actions return after confirmation');
});
