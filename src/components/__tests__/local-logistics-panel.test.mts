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
import {
  getPanelHealthRegistry,
  resetDiagnosticsState,
} from '../../services/diagnostics/diagnostics-state.ts';

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
const { createLifelinePrewarmCoordinator } = await import('../../services/lifelines/lifeline-prewarm.ts');

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

function mountPanel(
  loader: SnapshotLoader,
  prewarmCoordinator?: unknown,
  getExactPackReadiness?: unknown,
): InstanceType<typeof LocalLogisticsPanel> {
  const panel = new LocalLogisticsPanel({
    focusNode: () => {},
    fetchSnapshot: loader,
    ...(prewarmCoordinator ? { prewarmCoordinator } : {}),
    ...(getExactPackReadiness ? { getExactPackReadiness } : {}),
  } as never);
  mountedPanels.push(panel);
  document.body.append(panel.getElement());
  return panel;
}

test('Prepare offline enqueues the active exact radius and cleanup unsubscribes', async () => {
  const place = addSavedPlace({
    name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 8, offlinePinned: true,
  });
  localStorage.setItem('wm_saved_places_v1', JSON.stringify(getSavedPlaces()));
  const enqueued: Array<{ placeId: string; radiusKm: number; trigger: string }> = [];
  let subscriptions = 0;
  let unsubscriptions = 0;
  let prewarmListener: ((state: Record<string, unknown>) => void) | null = null;
  const coordinator = {
    enqueue: (input: { place: SavedPlace; radiusKm: number; trigger: string }) => {
      enqueued.push({ placeId: input.place.id, radiusKm: input.radiusKm, trigger: input.trigger });
      prewarmListener?.({
        placeId: input.place.id,
        radiusKm: input.radiusKm,
        queryFingerprint: 'exact',
        phase: 'queued',
        triggers: [input.trigger],
        retryAt: null,
        error: null,
      });
    },
    retry: () => {},
    getState: () => null,
    subscribe: (listener: (state: Record<string, unknown>) => void) => {
      subscriptions += 1;
      prewarmListener = listener;
      return () => { prewarmListener = null; unsubscriptions += 1; };
    },
  };
  const panel = mountPanel(
    async (requestedPlace, options) => makeSnapshot(requestedPlace, options?.radiusKm ?? 25),
    coordinator,
  );
  panel.setPlaceId(place.id);
  await settleRender();

  const content = panel.getContentElement();
  requiredElement<HTMLButtonElement>(content, '[data-logistics-radius="50"]').click();
  await settleRender();
  requiredElement<HTMLButtonElement>(content, '[data-lifeline-prewarm]').click();
  await settleRender();

  assert.deepEqual(enqueued, [{ placeId: place.id, radiusKm: 50, trigger: 'manual' }]);
  assert.equal(
    document.activeElement?.getAttribute('data-lifeline-prewarm'),
    '1',
    'preparation status rerenders should restore keyboard focus to the action',
  );
  assert.equal(subscriptions, 1);
  panel.destroy();
  mountedPanels.splice(mountedPanels.indexOf(panel), 1);
  assert.equal(unsubscriptions, 1);
});

test('failed preparation displays an actionable generic error without provider details', async () => {
  const place = addSavedPlace({
    name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25, offlinePinned: true,
  });
  localStorage.setItem('wm_saved_places_v1', JSON.stringify(getSavedPlaces()));
  const secretMessage = 'provider-token=super-secret-upstream-detail';
  const coordinator = createLifelinePrewarmCoordinator({
    fetchSnapshot: async () => { throw new Error(secretMessage); },
    verifySnapshot: () => ({ status: 'ready', exact: true }),
  });
  const panel = mountPanel(
    async (requestedPlace, options) => makeSnapshot(requestedPlace, options?.radiusKm ?? 25),
    coordinator,
  );
  panel.setPlaceId(place.id);
  await settleRender();

  requiredElement<HTMLButtonElement>(panel.getContentElement(), '[data-lifeline-prewarm]').click();
  await settleRender();

  const content = panel.getContentElement().textContent ?? '';
  assert.doesNotMatch(content, /super-secret|provider-token|upstream-detail/);
  assert.match(content, /try again/i);
  coordinator.destroy();
});

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  assert.ok(element, `${selector} should be rendered`);
  return element;
}

async function requiredElementEventually<T extends Element>(
  root: ParentNode,
  selector: string,
): Promise<T> {
  const deadline = Date.now() + 2_000;
  do {
    const element = root.querySelector<T>(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  return requiredElement<T>(root, selector);
}

async function settleRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 180));
}

beforeEach(() => {
  resetDiagnosticsState();
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

test('pack readiness follows the exact active 10 km and 50 km radii', async () => {
  const place = addSavedPlace({
    name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 8, offlinePinned: true,
  });
  const requested: number[] = [];
  const panel = mountPanel(
    async (requestedPlace, options) => makeSnapshot(requestedPlace, options?.radiusKm ?? 10),
    undefined,
    (_place: SavedPlace, radiusKm: number) => {
      requested.push(radiusKm);
      return { status: 'ready' };
    },
  );
  panel.setPlaceId(place.id);
  await settleRender();

  let content = panel.getContentElement().textContent ?? '';
  assert.match(content, /Offline Lifelines: saved for this exact place/);
  assert.doesNotMatch(content, /not saved for this exact place/);
  assert.ok(requested.includes(10), 'saved radius 8 km must verify the visible 10 km pack');

  requiredElement<HTMLButtonElement>(panel.getContentElement(), '[data-logistics-radius="50"]').click();
  await settleRender();
  content = panel.getContentElement().textContent ?? '';
  assert.match(content, /Offline Lifelines: saved for this exact place/);
  assert.doesNotMatch(content, /not saved for this exact place/);
  assert.equal(requested.at(-1), 50, 'manual 50 km selection must verify the 50 km pack');
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
  assert.match(text, /ORNL ODIN.+single source.+not independently corroborated/is);
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
  assert.doesNotMatch(representativeCard.textContent ?? '', /Retrieved/,
    'non-directory cards preserve their existing presentation');
  requiredElement<HTMLButtonElement>(representativeCard, '[data-logistics-external-map]').click();
  requiredElement<HTMLButtonElement>(representativeCard, '[data-logistics-call]').click();
  assert.match(opened[0] ?? '', /^https:\/\/www\.openstreetmap\.org\//);
  assert.equal(opened[1], 'tel:+12195550100');
  assert.equal(
    requiredElement<HTMLButtonElement>(representativeCard, '[data-logistics-call]').textContent,
    'Call',
    'non-hotels keep the generic action label',
  );
});

test('official hotel card preserves generic call presentation and does not add directory retrieval copy', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const hotel = makeNode('official-hotel', 'hotel', {
    name: 'Official Hotel',
    directoryOnly: false,
    verification: 'official',
    operational: 'open',
  });
  const panel = mountPanel(async () => makeSnapshot(place, 25, { nodes: [hotel] }));

  panel.setPlaceId(place.id);
  await settleRender();

  const card = requiredElement<HTMLElement>(panel.getContentElement(), '[data-logistics-node-card="official-hotel"]');
  assert.equal(requiredElement<HTMLButtonElement>(card, '[data-logistics-call]').textContent, 'Call');
  assert.doesNotMatch(card.textContent ?? '', /Directory listing only|Retrieved/);
});

test('hotel card fails closed, discloses evidence, and labels a valid call as confirmation', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const retrievedAt = new Date('2026-08-14T13:40:00.000Z');
  const observedAt = new Date('2026-08-14T12:00:00.000Z');
  const hotel = makeNode('hotel-valid-phone', 'hotel', {
    name: 'Directory Hotel',
    directoryOnly: false,
    verification: 'directory',
    operational: 'open',
    inventory: 'available',
    power: 'grid',
    access: 'reachable',
    observedAt,
    retrievedAt,
  });
  const panel = mountPanel(async () => makeSnapshot(place, 25, { nodes: [hotel] }));

  panel.setPlaceId(place.id);
  await settleRender();

  const card = requiredElement<HTMLElement>(panel.getContentElement(), '[data-logistics-node-card="hotel-valid-phone"]');
  const text = card.textContent ?? '';
  assert.match(text, /Directory listing only\. Vacancy, current operation, power, and access are unknown\. Confirm directly with the property before relying on it\./);
  assert.match(text, /Operational: unknown/);
  assert.match(text, /Inventory: unknown/);
  assert.match(text, /Power: unknown/);
  assert.match(text, /Access: unknown/);
  assert.equal(card.querySelector('time')?.getAttribute('datetime'), retrievedAt.toISOString());
  assert.match(text, /Retrieved/);
  const call = requiredElement<HTMLButtonElement>(card, '[data-logistics-call]');
  assert.deepEqual(
    { label: call.textContent, accessibleName: call.getAttribute('aria-label') },
    {
      label: 'Call to confirm',
      accessibleName: 'Call Directory Hotel to confirm vacancy, current operation, power, and access',
    },
  );
});

test('expired hotel card composes expiry and omits missing or malformed call controls', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const hotel = makeNode('hotel-no-phone', 'hotel', {
    publicPhone: undefined,
    directoryOnly: true,
    operational: 'open',
    inventory: 'available',
    power: 'grid',
    access: 'reachable',
    expiresAt: new Date(Date.now() - 1),
  });
  const panel = mountPanel(async () => makeSnapshot(place, 25, { nodes: [hotel] }));

  panel.setPlaceId(place.id);
  await settleRender();

  const card = await requiredElementEventually<HTMLElement>(panel.getContentElement(), '[data-logistics-node-card="hotel-no-phone"]');
  const text = card.textContent ?? '';
  assert.match(text, /Verification expired/);
  assert.match(text, /Directory listing only/);
  assert.match(text, /No callable public phone published\./);
  assert.equal(card.querySelector('[data-logistics-call]'), null);
  assert.ok(card.querySelector('[data-logistics-external-map]'));
  assert.ok(card.querySelector('[data-logistics-source]'));
  assert.doesNotMatch(text, /Operational: open|Inventory: available|Power: grid|Access: reachable/);
});

test('renders an accessible exact-county outage matrix without summing reports or treating ODIN as facility coverage', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const now = Date.now();
  const snapshot = makeSnapshot(place, 25, {
    countyFips: '18141<img src=x onerror=bad()>',
    areaConditions: [{
      id: 'ornl-odin:18141:unsafe', type: 'power_outage', coverage: 'reported',
      countyFips: '18141<img src=x onerror=bad()>', county: 'St. Joseph <County>', state: 'Indiana',
      customersOut: 11, utilityName: 'A <script>bad()</script>',
      utilityId: 'utility-a<img src=x onerror=bad()>',
      observedAt: new Date(now - 4 * 60_000), retrievedAt: new Date(now - 4 * 60_000),
      sourceObservedAt: new Date(now - 5 * 60_000), expiresAt: new Date(now + 20 * 60_000),
      source: 'ornl-odin',
    }, {
      id: 'ornl-odin:18141:unknown', type: 'power_outage', coverage: 'reported',
      countyFips: '18141<img src=x onerror=bad()>', county: 'St. Joseph', state: 'Indiana', customersOut: 17,
      observedAt: new Date(now - 40 * 60_000), retrievedAt: new Date(now - 40 * 60_000),
      expiresAt: new Date(now - 10 * 60_000), source: 'ornl-odin',
    }],
    providers: [
      { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(now), retrievedAt: new Date(now) },
      { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(now), retrievedAt: new Date(now) },
      { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(now), retrievedAt: new Date(now) },
      { id: 'ornl-odin', state: 'partial', acceptedRows: 2, droppedRows: 3, observedAt: new Date(now), retrievedAt: new Date(now) },
    ],
  });
  const panel = mountPanel(async () => snapshot);

  panel.setPlaceId(place.id);
  await settleRender();
  const content = panel.getContentElement();
  const outage = requiredElement<HTMLElement>(content, '[data-outage-coverage-matrix]');
  const tables = outage.querySelectorAll('table');
  assert.equal(tables.length, 2);
  assert.equal(tables[0]?.querySelector('caption')?.textContent, 'ORNL ODIN provider telemetry');
  assert.equal(tables[1]?.querySelector('caption')?.textContent, 'Individual outage reports — never summed');
  assert.ok([...outage.querySelectorAll('th')].every((header) => Boolean(header.getAttribute('scope'))));
  assert.ok([...outage.querySelectorAll('time')].every((time) => Boolean(time.getAttribute('datetime'))));
  const scrollRegions = [...outage.querySelectorAll<HTMLElement>('.local-logistics-table-scroll')];
  assert.equal(scrollRegions.length, 2);
  assert.deepEqual(
    scrollRegions.map((region) => ({
      role: region.getAttribute('role'),
      label: region.getAttribute('aria-label'),
      tabIndex: region.tabIndex,
    })),
    [
      { role: 'region', label: 'ORNL ODIN provider telemetry', tabIndex: 0 },
      { role: 'region', label: 'Individual outage reports', tabIndex: 0 },
    ],
  );

  const text = outage.textContent ?? '';
  assert.match(text, /exact-county/i);
  assert.match(text, /single source.+not independently corroborated/is);
  assert.match(text, /not facility power or status/i);
  assert.match(text, /Accepted before final reconciliation.+Unavailable.+not retained/is);
  assert.match(text, /Dropped \/ rejected.+3/is);
  assert.match(text, /Contributed.+2/is);
  assert.match(text, /Current unexpired.+1/is);
  assert.match(text, /18141<img src=x onerror=bad\(\)>/);
  assert.match(text, /St\. Joseph <County>/);
  assert.match(text, /A <script>bad\(\)<\/script>/);
  assert.match(text, /utility-a<img src=x onerror=bad\(\)>/);
  assert.match(text, /Utility not identified by source/);
  assert.match(text, /Source observation.+Not published/is);
  assert.match(text, /Expired/);
  assert.doesNotMatch(text, /28 customers/i, 'independent outage rows must never be summed');
  assert.equal(outage.querySelectorAll('tbody tr').length, 3, 'one telemetry row plus two independent claims');
  assert.equal(outage.querySelector('script'), null, 'provider text must be escaped rather than interpreted');
  assert.equal(outage.querySelector('img'), null, 'FIPS and utility IDs must be escaped rather than interpreted');

  const reportRows = tables[1]?.querySelectorAll('tbody tr') ?? [];
  assert.equal(reportRows.length, 2);
  const currentCells = reportRows[0]?.children;
  const expiredCells = reportRows[1]?.children;
  assert.equal(currentCells?.item(4)?.textContent, '11');
  assert.equal(expiredCells?.item(4)?.textContent, '17');
  assert.match(currentCells?.item(3)?.textContent ?? '', /utility-a<img src=x onerror=bad\(\)>/);
  assert.equal(
    currentCells?.item(5)?.querySelector('time')?.getAttribute('datetime'),
    new Date(now - 4 * 60_000).toISOString(),
  );
  assert.equal(
    expiredCells?.item(5)?.querySelector('time')?.getAttribute('datetime'),
    new Date(now - 40 * 60_000).toISOString(),
  );
  assert.equal(
    currentCells?.item(7)?.querySelector('time')?.getAttribute('datetime'),
    new Date(now + 20 * 60_000).toISOString(),
  );
  assert.equal(
    expiredCells?.item(7)?.querySelector('time')?.getAttribute('datetime'),
    new Date(now - 10 * 60_000).toISOString(),
  );

  const providerCards = [...content.querySelectorAll('.local-logistics-provider-row')]
    .map((row) => row.textContent ?? '');
  assert.ok(providerCards.every((row) => !/ODIN/i.test(row)), 'ODIN is not facility provider coverage');
});

test('renders outage unknown states explicitly instead of zero or power-on claims', async () => {
  const place = addSavedPlace({ name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 });
  const now = Date.now();
  const panel = mountPanel(async () => makeSnapshot(place, 25, {
    countyFips: '18141',
    providers: [{
      id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0,
      observedAt: new Date(now), retrievedAt: new Date(now),
    }],
  }));

  panel.setPlaceId(place.id);
  await settleRender();
  const text = requiredElement<HTMLElement>(
    panel.getContentElement(),
    '[data-outage-coverage-matrix]',
  ).textContent ?? '';
  assert.match(text, /coverage unknown/i);
  assert.match(text, /contributed no current accepted outage reports/i);
  assert.match(text, /not zero outages/i);
  assert.match(text, /does not mean power is on/i);
  assert.doesNotMatch(text, /healthy|current complete/i);
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
  assert.equal(getPanelHealthRegistry().get('local-logistics')?.lastError, 'provider unavailable');
  assert.ok(content.querySelector('[data-logistics-radius="25"]'));
  assert.ok(content.querySelector('[data-logistics-refresh]'));
});
