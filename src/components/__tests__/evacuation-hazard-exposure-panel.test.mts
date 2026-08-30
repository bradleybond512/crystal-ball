import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { Window } from 'happy-dom';
import '../../../tests/panels/register-hook.mjs';

import type { EvacRoute } from '../../services/evacuation-router.ts';
import type {
  EvacuationHazardExposureSnapshot,
  EvacuationHazardExposureStore,
  EvacuationWeatherSnapshot,
} from '../../services/weather/evacuation-hazard-exposure.ts';
import { canonicalEvacRouteFingerprint } from '../../services/weather/evacuation-hazard-exposure.ts';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

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
  ResizeObserver: TestResizeObserver,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
globals.matchMedia = happyWindow.matchMedia.bind(happyWindow);

const { EvacuationPanel } = await import('../EvacuationPanel.ts');

const NOW = Date.now();

function route(overrides: Partial<EvacRoute> = {}): EvacRoute {
  return {
    id: 'route-1',
    from: { lat: 41.6, lon: -86.7, label: 'Home <script>alert(1)</script>', placeRef: null },
    to: { lat: 41.7, lon: -86.8, label: 'Shelter', placeRef: null },
    distanceKm: 14.2,
    durationMinutes: 22,
    geometry: { type: 'LineString', coordinates: [[-86.7, 41.6], [-86.8, 41.7]] },
    steps: [],
    cachedAt: NOW - 60_000,
    ...overrides,
  };
}

class FakeExposureStore implements EvacuationHazardExposureStore {
  snapshot: EvacuationHazardExposureSnapshot = { generation: 0, results: [] };
  readonly routeUpdates: readonly EvacRoute[][] = [];
  subscribeCount = 0;
  unsubscribeCount = 0;
  private listener: ((snapshot: EvacuationHazardExposureSnapshot) => void) | null = null;

  publishWeatherSnapshot(_snapshot: EvacuationWeatherSnapshot): void {}

  setRoutes(routes: readonly EvacRoute[]): void {
    (this.routeUpdates as EvacRoute[][]).push([...routes]);
  }

  getSnapshot(): EvacuationHazardExposureSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: EvacuationHazardExposureSnapshot) => void): () => void {
    this.subscribeCount += 1;
    this.listener = listener;
    listener(this.snapshot);
    return () => {
      this.unsubscribeCount += 1;
      if (this.listener === listener) this.listener = null;
    };
  }

  destroy(): void {}

  emit(snapshot: EvacuationHazardExposureSnapshot): void {
    this.snapshot = snapshot;
    this.listener?.(snapshot);
  }
}

function saveRoutes(routes: readonly EvacRoute[]): void {
  localStorage.setItem('wm-evac-routes-v2', JSON.stringify(routes));
}

function mount(store: FakeExposureStore): InstanceType<typeof EvacuationPanel> {
  const panel = new EvacuationPanel(store);
  document.body.append(panel.getElement());
  return panel;
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

test('renders loading then escaped reported evidence with exact source, times, coverage, and disclosure', (context) => {
  const savedRoute = route();
  saveRoutes([savedRoute]);
  const store = new FakeExposureStore();
  const panel = mount(store);
  context.after(() => {
    if (store.unsubscribeCount === 0) panel.destroy();
  });
  const content = panel.getContentElement();

  assert.equal(store.subscribeCount, 1);
  assert.deepEqual(store.routeUpdates[0], [savedRoute]);
  const loading = content.querySelector<HTMLElement>('[data-evac-hazard-status]');
  assert.ok(loading);
  assert.equal(loading.getAttribute('role'), 'status');
  assert.equal(loading.getAttribute('aria-live'), 'polite');
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.match(loading.textContent ?? '', /Evaluating current NWS hazard exposure/i);

  const showMap = content.querySelector<HTMLButtonElement>('[data-evac-action="show-map"]');
  assert.ok(showMap);
  showMap.focus();

  store.emit({
    generation: 1,
    results: [{
      routeId: savedRoute.id,
      routeFingerprint: canonicalEvacRouteFingerprint(savedRoute),
      evaluatedAt: NOW,
      route: {
        status: 'reported_intersection',
        evidence: {
          alertId: 'alert-1',
          event: 'Tornado <img src=x onerror=alert(1)>',
          severity: 'Extreme',
          source: 'National Weather Service active alerts',
          basis: 'polygon',
          sentAt: NOW - 20_000,
          effectiveAt: NOW - 15_000,
          onsetAt: NOW - 10_000,
          retrievedAt: NOW - 5_000,
          expiresAt: NOW + 60_000,
        },
      },
      endpoints: {
        from: {
          status: 'reported_intersection',
          evidence: {
            alertId: 'alert-1',
            event: 'Tornado <img src=x onerror=alert(1)>',
            severity: 'Extreme',
            source: 'National Weather Service active alerts',
            basis: 'ugc',
            ugcZone: 'INC091',
            sentAt: NOW - 20_000,
            effectiveAt: NOW - 15_000,
            onsetAt: null,
            retrievedAt: NOW - 5_000,
            expiresAt: NOW + 60_000,
          },
        },
        to: { status: 'unknown', reason: 'jurisdiction_unknown' },
      },
      closure: { status: 'unknown', reason: 'no_closure_feed' },
    }],
  });

  const section = content.querySelector<HTMLElement>('[data-evac-hazard-status]');
  assert.ok(section);
  assert.equal(section.getAttribute('role'), 'status');
  assert.equal(section.getAttribute('aria-live'), 'polite');
  assert.equal(section.getAttribute('aria-busy'), 'false');
  assert.equal(section.getAttribute('aria-labelledby'), 'evac-hazard-title-route-1');
  assert.match(section.textContent ?? '', /Reported NWS alert-area intersection/);
  assert.match(section.textContent ?? '', /NWS reports Tornado <img src=x onerror=alert\(1\)> intersecting this graph route\./);
  assert.match(section.textContent ?? '', /Reported NWS impact at endpoint A/);
  assert.match(section.textContent ?? '', /NWS reports Tornado <img src=x onerror=alert\(1\)> by UGC zone INC091\./);
  assert.match(section.textContent ?? '', /Endpoint B hazard exposure unknown/);
  assert.match(section.textContent ?? '', /Jurisdiction unknown\./);
  assert.match(section.textContent ?? '', /National Weather Service active alerts/);
  assert.match(section.textContent ?? '', /Reported:/);
  assert.match(section.textContent ?? '', /Effective:/);
  assert.match(section.textContent ?? '', /Onset: not provided/);
  assert.match(section.textContent ?? '', /Retrieved:/);
  assert.match(section.textContent ?? '', /Expires:/);
  assert.match(section.textContent ?? '', /Coverage: alert polygon/);
  assert.match(section.textContent ?? '', /Coverage: UGC zone INC091/);
  assert.match(section.textContent ?? '', /Road closure evidence unknown/);
  assert.match(section.textContent ?? '', /No closure feed is configured\./);
  assert.match(section.textContent ?? '', /Hazard evidence does not verify road closure, passability, reachability, or route safety\./);
  assert.equal(section.querySelector('img'), null, 'attacker-controlled event text must remain text');
  assert.equal(section.querySelectorAll('time[datetime]').length, 9);
  assert.equal(
    document.activeElement?.getAttribute('data-evac-action'),
    'show-map',
    'an asynchronous exposure refresh must preserve keyboard focus',
  );

  panel.destroy();
  assert.equal(store.unsubscribeCount, 1);
  assert.deepEqual(store.routeUpdates.at(-1), []);
});

test('renders covered endpoint negatives and bounded unknown reasons without route-wide absence claims', () => {
  const savedRoute = route({ id: 'route-2' });
  saveRoutes([savedRoute]);
  const store = new FakeExposureStore();
  const panel = mount(store);

  store.emit({
    generation: 2,
    results: [{
      routeId: savedRoute.id,
      routeFingerprint: canonicalEvacRouteFingerprint(savedRoute),
      evaluatedAt: NOW,
      route: { status: 'unknown', reason: 'route_coverage_unproven' },
      endpoints: {
        from: { status: 'no_reported_intersection', retrievedAt: NOW - 5_000 },
        to: { status: 'unknown', reason: 'alert_unevaluable' },
      },
      closure: { status: 'unknown', reason: 'no_closure_feed' },
    }],
  });

  const text = panel.getContentElement().textContent ?? '';
  assert.match(text, /Route hazard exposure unknown/);
  assert.match(text, /Current NWS coverage was not proven for the full graph route\./);
  assert.match(text, /No reported NWS Severe\/Extreme alert intersection at endpoint A/);
  assert.match(text, /Within current NWS point jurisdiction as of .+ This point check does not cover the route corridor\./);
  assert.match(text, /Endpoint B hazard exposure unknown/);
  assert.match(text, /Alert evidence could not be completely evaluated\./);
  assert.doesNotMatch(text, /no reported.+route|route.+no reported/i);
  assert.doesNotMatch(text, /\b(?:safe|clear|open|passable|reachable)\b/i);

  panel.destroy();
});

test('does not render a hazard evidence section when no saved route exists', () => {
  const store = new FakeExposureStore();
  const panel = mount(store);

  assert.equal(panel.getContentElement().querySelector('[data-evac-hazard-status]'), null);
  assert.deepEqual(store.routeUpdates[0], []);

  panel.destroy();
});
