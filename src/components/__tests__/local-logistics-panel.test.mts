import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

import {
  addSavedPlace,
  getSavedPlaces,
  removeSavedPlace,
  type SavedPlace,
} from '../../services/saved-places.ts';
import {
  buildLocalLogisticsFingerprint,
  LOCAL_LOGISTICS_CATEGORIES,
  type LocalLogisticsSnapshot,
  type LogisticsNode,
} from '../../services/local-logistics.ts';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;
Object.assign(globals, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  sessionStorage: happyWindow.sessionStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
globals.matchMedia = happyWindow.matchMedia.bind(happyWindow);

const { LocalLogisticsPanel } = await import('../LocalLogisticsPanel.ts');

type SnapshotLoader = (
  place: SavedPlace,
  options?: { radiusKm?: number },
) => Promise<LocalLogisticsSnapshot>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

const mountedPanels: InstanceType<typeof LocalLogisticsPanel>[] = [];

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function makeNode(
  id: string,
  category: LogisticsNode['category'],
  overrides: Partial<LogisticsNode> = {},
): LogisticsNode {
  const now = Date.now();
  return {
    id,
    kind: category,
    category,
    name: `${category} ${id}`,
    lat: 41.6,
    lon: -86.7,
    distanceKm: 2,
    address: '100 Main St',
    publicPhone: '+1 (219) 555-0100',
    sourceRefs: [{ provider: 'osm', recordId: id }],
    capabilities: {},
    source: 'OpenStreetMap',
    freshness: 'fresh',
    hazardCompatibility: 'general',
    fetchedAt: new Date(now - 1_000),
    operational: 'unknown',
    inventory: 'unknown',
    power: 'unknown',
    access: 'unknown',
    verification: 'directory',
    observedAt: new Date(now - 1_000),
    retrievedAt: new Date(now - 1_000),
    expiresAt: new Date(now + 60 * 60_000),
    confidence: 'medium',
    sourceUrl: 'https://www.openstreetmap.org/node/1',
    directoryOnly: true,
    ...overrides,
  };
}

function makeSnapshot(
  place: SavedPlace,
  radiusKm: number,
  overrides: Partial<LocalLogisticsSnapshot> = {},
): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: buildLocalLogisticsFingerprint(
      place,
      radiusKm,
      [...LOCAL_LOGISTICS_CATEGORIES],
    ),
    placeId: place.id,
    placeName: place.name,
    effectiveRadiusKm: radiusKm,
    categories: [...LOCAL_LOGISTICS_CATEGORIES],
    sites: [],
    observations: [],
    nodes: [],
    areaConditions: [],
    providers: [],
    fetchedAt: new Date(),
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
    ...overrides,
  };
}

function mountPanel(loader: SnapshotLoader): InstanceType<typeof LocalLogisticsPanel> {
  const panel = new LocalLogisticsPanel({
    focusNode: () => {},
    fetchSnapshot: loader,
  } as never);
  mountedPanels.push(panel);
  document.body.append(panel.getElement());
  return panel;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  assert.ok(element, `${selector} should be rendered`);
  return element;
}

async function settleRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 180));
}

beforeEach(() => {
  document.body.replaceChildren();
  for (const place of getSavedPlaces()) removeSavedPlace(place.id);
  happyWindow.localStorage.clear();
  globalThis.fetch = (async () => {
    throw new Error('unexpected non-injected network request');
  }) as typeof fetch;
});

afterEach(() => {
  for (const panel of mountedPanels.splice(0)) panel.destroy();
  for (const place of getSavedPlaces()) removeSavedPlace(place.id);
});

test('radius controls initialize from the saved place, allowlist clicks, retain manual choice, and preserve the place', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 8 });
  const originalPlace = structuredClone(place);
  const requests: Array<{ place: SavedPlace; radiusKm: number; pending: Deferred<LocalLogisticsSnapshot> }> = [];
  const loader: SnapshotLoader = (requestedPlace, options) => {
    const pending = deferred<LocalLogisticsSnapshot>();
    requests.push({ place: requestedPlace, radiusKm: options?.radiusKm ?? -1, pending });
    return pending.promise;
  };
  const panel = mountPanel(loader);

  panel.setPlaceId(place.id);
  await settleRender();

  assert.equal(requests[0]?.radiusKm, 10, 'saved radius 8 km should initialize to the 10 km choice');
  const content = panel.getContentElement();
  const busyRoot = requiredElement<HTMLElement>(content, '[data-local-logistics-content]');
  assert.equal(busyRoot.getAttribute('aria-busy'), 'true');
  assert.match(busyRoot.textContent ?? '', /Loading lifelines near Home/i);
  assert.deepEqual(
    [...content.querySelectorAll('[data-logistics-radius]')].map((button) => button.getAttribute('data-logistics-radius')),
    ['5', '10', '25', '50'],
  );
  assert.equal(
    requiredElement<HTMLButtonElement>(content, '[data-logistics-radius="10"]').getAttribute('aria-pressed'),
    'true',
  );

  const invalid = document.createElement('button');
  invalid.dataset.logisticsRadius = '999';
  content.append(invalid);
  invalid.click();
  assert.equal(requests.length, 1, 'a radius outside the four allowed values must be ignored');

  requiredElement<HTMLButtonElement>(content, '[data-logistics-radius="50"]').click();
  await settleRender();
  assert.equal(requests[1]?.radiusKm, 50);
  const selected = requiredElement<HTMLButtonElement>(content, '[data-logistics-radius="50"]');
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, selected, 'selection rerender should restore focus to the selected radius');

  requests[1]?.pending.resolve(makeSnapshot(place, 50));
  await settleRender();
  requiredElement<HTMLButtonElement>(content, '[data-logistics-refresh]').click();
  await Promise.resolve();
  assert.equal(requests[2]?.radiusKm, 50, 'manual refresh should retain the transient radius choice');
  assert.deepEqual(getSavedPlaces()[0], originalPlace, 'radius selection must not mutate the saved place');
});

test('out-of-order radius responses cannot display, publish, or reach the map overlay', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 8 });
  const requests: Array<{ radiusKm: number; pending: Deferred<LocalLogisticsSnapshot> }> = [];
  const loader: SnapshotLoader = (_requestedPlace, options) => {
    const pending = deferred<LocalLogisticsSnapshot>();
    requests.push({ radiusKm: options?.radiusKm ?? -1, pending });
    return pending.promise;
  };
  const accepted: LocalLogisticsSnapshot[] = [];
  const overlays: LocalLogisticsSnapshot[] = [];
  document.addEventListener('wm:active-local-logistics-snapshot-updated', (event) => {
    accepted.push((event as CustomEvent<{ snapshot: LocalLogisticsSnapshot }>).detail.snapshot);
  }, { once: false });
  document.addEventListener('wm:show-lifelines-overlay', (event) => {
    overlays.push((event as CustomEvent<{ snapshot: LocalLogisticsSnapshot }>).detail.snapshot);
  }, { once: false });
  const panel = mountPanel(loader);

  panel.setPlaceId(place.id);
  await settleRender();
  requiredElement<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-radius="50"]').click();
  await Promise.resolve();

  const current = makeSnapshot(place, 50, { nodes: [makeNode('current', 'shelter')] });
  requests[1]?.pending.resolve(current);
  await settleRender();
  const stale = makeSnapshot(place, 10, { nodes: [makeNode('stale', 'hospital')] });
  requests[0]?.pending.resolve(stale);
  await settleRender();

  const text = panel.getContentElement().textContent ?? '';
  assert.match(text, /Returned radius 50 km/);
  assert.match(text, /shelter current/i);
  assert.doesNotMatch(text, /hospital stale/i);
  assert.deepEqual(accepted, [current]);

  requiredElement<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-map]').click();
  assert.deepEqual(overlays, [current]);
});

test('changing saved-place identity resets the transient radius while same-place refresh retains it', async () => {
  const home = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 8 });
  const family = addSavedPlace({ name: 'Family', lat: 42, lon: -87, radiusKm: 30 });
  const requests: Array<{ placeId: string; radiusKm: number; pending: Deferred<LocalLogisticsSnapshot> }> = [];
  const panel = mountPanel((place, options) => {
    const pending = deferred<LocalLogisticsSnapshot>();
    requests.push({ placeId: place.id, radiusKm: options?.radiusKm ?? -1, pending });
    return pending.promise;
  });

  panel.setPlaceId(home.id);
  await settleRender();
  requiredElement<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-radius="25"]').click();
  await Promise.resolve();
  assert.deepEqual(requests.slice(0, 2).map(({ placeId, radiusKm }) => ({ placeId, radiusKm })), [
    { placeId: home.id, radiusKm: 10 },
    { placeId: home.id, radiusKm: 25 },
  ]);

  panel.setPlaceId(family.id);
  await Promise.resolve();
  assert.deepEqual(
    { placeId: requests[2]?.placeId, radiusKm: requests[2]?.radiusKm },
    { placeId: family.id, radiusKm: 50 },
  );
});

test('renders representative nodes, provider coverage, truthful category empties, and explicit card actions', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const now = Date.now();
  const hospitals = Array.from({ length: 12 }, (_, index) => makeNode(`hospital-${index}`, 'hospital'));
  const shelter = makeNode('representative', 'shelter', { name: 'Representative Shelter' });
  const snapshot = makeSnapshot(place, 25, {
    nodes: [...hospitals, shelter],
    providers: [
      { id: 'osm', state: 'ok', acceptedRows: 13, droppedRows: 0, observedAt: new Date(now), retrievedAt: new Date(now) },
      { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(now), retrievedAt: new Date(now) },
      { id: 'ornl-odin', state: 'partial', acceptedRows: 1, droppedRows: 2, observedAt: new Date(now), retrievedAt: new Date(now) },
    ],
  });
  const opened: string[] = [];
  happyWindow.open = ((url?: string | URL) => {
    opened.push(String(url));
    return null;
  }) as typeof happyWindow.open;
  const panel = mountPanel(async () => snapshot);

  panel.setPlaceId(place.id);
  await settleRender();
  const content = panel.getContentElement();
  const text = content.textContent ?? '';
  assert.match(text, /Requested radius 25 km/);
  assert.match(text, /Returned radius 25 km/);
  assert.match(text, /Representative Shelter/,
    'all-results view should retain one representative from each available category');
  assert.match(text, /OSM.+current complete.+Retrieved.+Projected expiry.+13 accepted.+0 dropped/is);
  assert.match(text, /ODIN.+county outage context; not facility coverage/is);
  assert.equal(opened.length, 0, 'rendering action controls must not navigate');

  requiredElement<HTMLButtonElement>(content, '[data-logistics-filter="water"]').click();
  await settleRender();
  assert.match(
    content.textContent ?? '',
    /None reported within the current returned 25 km coverage for Water\. Coverage expires at/i,
  );

  requiredElement<HTMLButtonElement>(content, '[data-logistics-filter="recovery"]').click();
  await settleRender();
  assert.match(
    content.textContent ?? '',
    /No Recovery Center results displayed\. Current provider coverage is incomplete or expired; this does not mean none exist\./i,
  );

  requiredElement<HTMLButtonElement>(content, '[data-logistics-filter="all"]').click();
  await settleRender();
  const representativeCard = requiredElement<HTMLElement>(content, '[data-logistics-node-card="representative"]');
  requiredElement<HTMLButtonElement>(representativeCard, '[data-logistics-external-map]').click();
  requiredElement<HTMLButtonElement>(representativeCard, '[data-logistics-call]').click();
  assert.match(opened[0] ?? '', /^https:\/\/www\.openstreetmap\.org\//);
  assert.equal(opened[1], 'tel:+12195550100');
});

test('failed refresh resolves to an error without removing radius and refresh controls', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const panel = mountPanel(async () => {
    throw new Error('provider unavailable');
  });

  panel.setPlaceId(place.id);
  await settleRender();

  const content = panel.getContentElement();
  assert.equal(requiredElement<HTMLElement>(content, '[data-local-logistics-content]').getAttribute('aria-busy'), 'false');
  assert.match(requiredElement<HTMLElement>(content, '[role="alert"]').textContent ?? '', /provider unavailable/i);
  assert.ok(content.querySelector('[data-logistics-radius="25"]'));
  assert.ok(content.querySelector('[data-logistics-refresh]'));
});
