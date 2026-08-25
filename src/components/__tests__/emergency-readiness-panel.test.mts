import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { beforeEach } from 'node:test';

import '../../../tests/panels/register-hook.mjs';
import { clearFetchCalls, getFetchCalls, happyWindow } from '../../../tests/panels/setup-dom.mts';
import type { SavedPlace } from '../../services/saved-places.ts';
import { buildSnapshot } from '../../services/survival/world-snapshot.ts';
import type { WorldSnapshot } from '../../services/survival/survival-types.ts';

const NOW = Date.parse('2026-08-25T16:00:00.000Z');
const moduleValue = await import('../EmergencyReadinessPanel.ts').catch(() => ({})) as {
  EmergencyReadinessPanel?: new (dependencies: Record<string, unknown>) => {
    getContentElement: () => HTMLElement;
    destroy: () => void;
  };
};

function PanelClass(): NonNullable<typeof moduleValue.EmergencyReadinessPanel> {
  assert.equal(typeof moduleValue.EmergencyReadinessPanel, 'function', 'EmergencyReadinessPanel should be exported');
  return moduleValue.EmergencyReadinessPanel as NonNullable<typeof moduleValue.EmergencyReadinessPanel>;
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

function restoredSnapshot(): WorldSnapshot {
  return buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [{
      id: 'home',
      label: 'Home <img src=x onerror=window.pwned=true>',
      lat: 41.6111,
      lon: -86.7225,
      radiusKm: 25,
    }],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW });
}

function savedPlace(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'home',
    name: 'Home <img src=x onerror=window.pwned=true>',
    lat: 41.6111,
    lon: -86.7225,
    radiusKm: 25,
    tags: ['home'],
    priority: 0,
    notes: '',
    offlinePinned: false,
    primary: true,
    source: 'manual',
    sortIndex: 1,
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  happyWindow.document.body.replaceChildren();
  happyWindow.localStorage.clear();
  clearFetchCalls();
});

test('hydrates only, renders empty then subscribed state, and fully cleans up', async () => {
  const Panel = PanelClass();
  let snapshot: WorldSnapshot | null = null;
  let primaryPlace: SavedPlace | null = null;
  let subscriber: (() => void) | null = null;
  let savedPlacesSubscriber: (() => void) | null = null;
  let hydrateCalls = 0;
  let snapshotUnsubscribeCalls = 0;
  let savedPlacesUnsubscribeCalls = 0;
  let receiptCalls = 0;
  let resolveHydrate: (() => void) | null = null;
  let schedulerDestroyed = 0;
  const trackedDeadlines: number[][] = [];
  const hydration = new Promise<void>((resolve) => { resolveHydrate = resolve; });
  const panel = new Panel({
    getSnapshot: () => snapshot,
    subscribe: (callback: () => void) => {
      subscriber = callback;
      return () => { snapshotUnsubscribeCalls += 1; };
    },
    getPrimaryPlace: () => primaryPlace,
    subscribeSavedPlaces: (callback: () => void) => {
      savedPlacesSubscriber = callback;
      return () => { savedPlacesUnsubscribeCalls += 1; };
    },
    hydrate: () => { hydrateCalls += 1; return hydration; },
    getReceipt: () => {
      receiptCalls += 1;
      return {
        placeId: 'home',
        capturedAt: new Date(NOW - 5 * 60_000),
        expiresAt: new Date(NOW + 60 * 60_000),
        isExpired: false,
      };
    },
    now: () => NOW,
    deadlineScheduler: {
      track: (deadlines: readonly number[]) => trackedDeadlines.push([...deadlines]),
      destroy: () => { schedulerDestroyed += 1; },
    },
  });

  assert.equal(hydrateCalls, 1);
  assert.match(panel.getContentElement().textContent ?? '', /loading/i);
  assert.equal(getFetchCalls().length, 0, 'constructing the panel must not fetch');

  resolveHydrate?.();
  await waitForRender();
  assert.equal(panel.getContentElement().querySelectorAll('[data-readiness-card]').length, 4);
  assert.equal(panel.getContentElement().querySelectorAll('.emergency-readiness-card--unavailable').length, 4);

  snapshot = restoredSnapshot();
  primaryPlace = savedPlace();
  subscriber?.();
  await waitForRender();
  const content = panel.getContentElement();
  assert.equal(content.querySelectorAll('[data-readiness-card]').length, 4);
  assert.ok(content.querySelector('section[aria-labelledby]'));
  assert.ok(content.querySelector('[aria-live="polite"][aria-atomic="true"]'));
  assert.equal(content.querySelectorAll('h3').length, 4);
  assert.equal(content.querySelectorAll('dl').length, 4);
  assert.equal(content.querySelectorAll('button, a, input, [tabindex]').length, 0, 'read-only content should add no keyboard traps');
  assert.match(content.textContent ?? '', /Home <img src=x onerror=window\.pwned=true>/);
  assert.equal(content.querySelector('img'), null, 'hostile saved-place text must remain text');
  assert.equal(getFetchCalls().length, 0, 'hydrate and subscription renders must remain offline-only');
  assert.equal(receiptCalls, 1);
  assert.ok(trackedDeadlines.at(-1)?.length, 'current per-card expiries should be scheduled');

  panel.destroy();
  assert.equal(snapshotUnsubscribeCalls, 1);
  assert.equal(savedPlacesUnsubscribeCalls, 1);
  assert.equal(schedulerDestroyed, 1);
  subscriber?.();
  savedPlacesSubscriber?.();
  assert.equal(receiptCalls, 1, 'destroyed subscriber callbacks must not render stale state');
});

test('a failed hydrate resolves to the truthful four-card unavailable state', async () => {
  const Panel = PanelClass();
  const panel = new Panel({
    getSnapshot: () => null,
    subscribe: () => () => undefined,
    getPrimaryPlace: () => null,
    subscribeSavedPlaces: () => () => undefined,
    hydrate: () => Promise.reject(new Error('storage unavailable')),
    getReceipt: () => null,
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });

  await waitForRender();
  assert.equal(panel.getContentElement().querySelectorAll('[data-readiness-card]').length, 4);
  assert.equal(panel.getContentElement().querySelectorAll('.emergency-readiness-card--unavailable').length, 4);
  panel.destroy();
});

test('a malformed primary place radius stays unavailable without querying a receipt', async (context) => {
  const Panel = PanelClass();
  const snapshot = buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [{ id: 'home', label: 'Home', lat: 41.6111, lon: -86.7225 }],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW });
  let receiptCalls = 0;
  const panel = new Panel({
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    getPrimaryPlace: () => savedPlace({ radiusKm: Number.NaN }),
    subscribeSavedPlaces: () => () => undefined,
    hydrate: () => Promise.resolve(),
    getReceipt: () => {
      receiptCalls += 1;
      return null;
    },
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());

  await waitForRender();
  assert.equal(receiptCalls, 0);
  assert.match(panel.getContentElement().textContent ?? '', /No verified Lifelines receipt/);
});

test('targets the live primary saved place even when restored snapshot order differs', async (context) => {
  const Panel = PanelClass();
  const snapshot = buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [
      { id: 'snapshot-first', label: 'Snapshot first', lat: 35, lon: -90, radiusKm: 10 },
      { id: 'primary', label: 'Stale primary label', lat: 40, lon: -85, radiusKm: 20 },
    ],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW });
  const primary = savedPlace({
    id: 'primary',
    name: 'Live Primary <script>window.pwned=true</script>',
    lat: 41.7,
    lon: -86.8,
    radiusKm: 30,
  });
  const requested: Array<{ id: string; lat: number; lon: number; radiusKm: number }> = [];
  const panel = new Panel({
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    getPrimaryPlace: () => primary,
    subscribeSavedPlaces: () => () => undefined,
    hydrate: () => Promise.resolve(),
    getReceipt: (place: { id: string; lat: number; lon: number; radiusKm: number }) => {
      requested.push(place);
      return {
        placeId: place.id,
        capturedAt: new Date(NOW - 5 * 60_000),
        expiresAt: new Date(NOW + 60 * 60_000),
        isExpired: false,
      };
    },
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());

  await waitForRender();
  assert.deepEqual(requested, [{ id: 'primary', lat: 41.7, lon: -86.8, radiusKm: 30 }]);
  const content = panel.getContentElement();
  assert.match(content.textContent ?? '', /Live Primary <script>window\.pwned=true<\/script>/);
  assert.equal(content.querySelector('script'), null, 'live saved-place name must stay escaped text');
  assert.doesNotMatch(content.textContent ?? '', /Snapshot first|Stale primary label/);
});

test('saved-place and Lifelines updates re-read live getters while ignoring event payloads', async (context) => {
  const Panel = PanelClass();
  const snapshot = restoredSnapshot();
  const primary = savedPlace();
  let savedPlacesSubscriber: (() => void) | null = null;
  let snapshotReads = 0;
  let primaryReads = 0;
  let receiptReads = 0;
  const panel = new Panel({
    getSnapshot: () => { snapshotReads += 1; return snapshot; },
    subscribe: () => () => undefined,
    getPrimaryPlace: () => { primaryReads += 1; return primary; },
    subscribeSavedPlaces: (callback: () => void) => {
      savedPlacesSubscriber = callback;
      return () => undefined;
    },
    hydrate: () => Promise.resolve(),
    getReceipt: () => {
      receiptReads += 1;
      return {
        placeId: primary.id,
        capturedAt: new Date(NOW - receiptReads * 1_000),
        expiresAt: new Date(NOW + 60 * 60_000),
        isExpired: false,
      };
    },
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());

  await waitForRender();
  const initial = { snapshotReads, primaryReads, receiptReads };
  savedPlacesSubscriber?.();
  await waitForRender();
  assert.ok(snapshotReads > initial.snapshotReads);
  assert.ok(primaryReads > initial.primaryReads);
  assert.ok(receiptReads > initial.receiptReads);

  const afterSavedPlaces = { snapshotReads, primaryReads, receiptReads };
  happyWindow.document.dispatchEvent(new happyWindow.CustomEvent('wm:lifeline-situation-updated', {
    detail: { placeId: 'attacker-controlled', receipt: 'PAYLOAD_ONLY_RECEIPT' },
  }));
  await waitForRender();
  assert.ok(snapshotReads > afterSavedPlaces.snapshotReads);
  assert.ok(primaryReads > afterSavedPlaces.primaryReads);
  assert.ok(receiptReads > afterSavedPlaces.receiptReads);
  assert.doesNotMatch(panel.getContentElement().innerHTML, /attacker-controlled|PAYLOAD_ONLY_RECEIPT/);
  assert.equal(panel.getContentElement().querySelector('img'), null);
});

test('destroy unsubscribes both sources, removes the Lifelines listener, and blocks stale renders', async (context) => {
  const Panel = PanelClass();
  let snapshotSubscriber: (() => void) | null = null;
  let savedPlacesSubscriber: (() => void) | null = null;
  let snapshotUnsubscribes = 0;
  let savedPlacesUnsubscribes = 0;
  let receiptReads = 0;
  let removedLifelinesListeners = 0;
  const originalRemoveEventListener = happyWindow.document.removeEventListener.bind(happyWindow.document);
  happyWindow.document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'wm:lifeline-situation-updated') removedLifelinesListeners += 1;
    originalRemoveEventListener(type, listener, options);
  }) as typeof happyWindow.document.removeEventListener;
  context.after(() => {
    happyWindow.document.removeEventListener = originalRemoveEventListener as typeof happyWindow.document.removeEventListener;
  });
  const panel = new Panel({
    getSnapshot: () => restoredSnapshot(),
    subscribe: (callback: () => void) => {
      snapshotSubscriber = callback;
      return () => { snapshotUnsubscribes += 1; };
    },
    getPrimaryPlace: () => savedPlace(),
    subscribeSavedPlaces: (callback: () => void) => {
      savedPlacesSubscriber = callback;
      return () => { savedPlacesUnsubscribes += 1; };
    },
    hydrate: () => Promise.resolve(),
    getReceipt: () => {
      receiptReads += 1;
      return {
        placeId: 'home',
        capturedAt: new Date(NOW),
        expiresAt: null,
        isExpired: false,
      };
    },
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());

  await waitForRender();
  const readsBeforeDestroy = receiptReads;
  panel.destroy();
  assert.equal(snapshotUnsubscribes, 1);
  assert.equal(savedPlacesUnsubscribes, 1);
  assert.equal(removedLifelinesListeners, 1);

  snapshotSubscriber?.();
  savedPlacesSubscriber?.();
  happyWindow.document.dispatchEvent(new happyWindow.CustomEvent('wm:lifeline-situation-updated'));
  await waitForRender();
  assert.equal(receiptReads, readsBeforeDestroy);
});

test('without a live primary place only Lifelines is unavailable with explicit setup guidance', async (context) => {
  const Panel = PanelClass();
  let receiptReads = 0;
  const panel = new Panel({
    getSnapshot: () => restoredSnapshot(),
    subscribe: () => () => undefined,
    getPrimaryPlace: () => null,
    subscribeSavedPlaces: () => () => undefined,
    hydrate: () => Promise.resolve(),
    getReceipt: () => { receiptReads += 1; return null; },
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());

  await waitForRender();
  const content = panel.getContentElement();
  assert.equal(receiptReads, 0);
  assert.equal(content.querySelectorAll('[data-readiness-card]').length, 4);
  assert.equal(content.querySelectorAll('.emergency-readiness-card--unavailable').length, 1);
  assert.match(content.textContent ?? '', /Save a primary place to verify an exact Lifelines snapshot receipt/);
});

test('panel CSS reflows cards as the window or resized panel narrows', () => {
  const css = readFileSync(new URL('../../styles/panels.css', import.meta.url), 'utf8');
  assert.match(css, /\.emergency-readiness__grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*220px\),\s*1fr\)\)/s);
  assert.match(css, /\.emergency-readiness-card--degraded/);
  assert.match(css, /\.emergency-readiness-card--expired/);
  assert.match(css, /\.emergency-readiness-card--unavailable/);
});
