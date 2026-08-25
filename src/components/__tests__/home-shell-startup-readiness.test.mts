import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { createHomeShellStartupReadiness } from '../HomeShellStartupReadiness.ts';
import type { HomeShellReadinessView } from '../../services/home-shell/startup-readiness-view.ts';
import type { WorldSnapshot } from '../../services/survival/survival-types.ts';

function installDom(): Window {
  const happyWindow = new Window({ url: 'https://crystalball.app/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = happyWindow;
  globals.document = happyWindow.document;
  globals.localStorage = happyWindow.localStorage;
  globals.sessionStorage = happyWindow.sessionStorage;
  globals.HTMLElement = happyWindow.HTMLElement;
  globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
  globals.HTMLInputElement = happyWindow.HTMLInputElement;
  globals.Element = happyWindow.Element;
  globals.Node = happyWindow.Node;
  globals.Event = happyWindow.Event;
  globals.CustomEvent = happyWindow.CustomEvent;
  globals.KeyboardEvent = happyWindow.KeyboardEvent;
  globals.FocusEvent = happyWindow.FocusEvent;
  globals.MutationObserver = happyWindow.MutationObserver;
  globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
  globals.matchMedia = happyWindow.matchMedia;
  Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
  return happyWindow;
}

const CONTEXT_NOW = Date.UTC(2026, 7, 25, 15);

function contextualSnapshot(level = 80): WorldSnapshot {
  const axisNames = [
    'physical_safety', 'supply', 'financial', 'mobility',
    'comms', 'health', 'energy_water', 'security',
  ] as const;
  const axes = axisNames.map((axis) => ({
    axis,
    level: axis === 'physical_safety' ? level : 0,
    band: axis === 'physical_safety' ? (level >= 80 ? 'critical' : 'elevated') : 'secure',
    trend: 'steady',
    threats: [],
    confidence: { score: 1, factors: [] },
    explanation: { summary: '', factors: [], limitations: [] },
    drivers: [],
  }));
  return {
    version: 1,
    capturedAtMs: CONTEXT_NOW,
    freshness: [{ domain: 'weather', fetchedAtMs: CONTEXT_NOW, ageMs: 0, ok: true }],
    weatherAlerts: [],
    savedPlaces: [],
    posture: {
      axes,
      overallLevel: level,
      overallBand: level >= 80 ? 'critical' : 'elevated',
      worstAxis: 'physical_safety',
      headline: '',
      capturedAtMs: CONTEXT_NOW,
      staleInputs: [],
    },
    plan: { committed: [] },
  } as WorldSnapshot;
}

const ATTENTION: HomeShellReadinessView = {
  state: 'attention',
  label: 'First-run data readiness',
  headline: 'Some first-run coverage needs attention',
  summary: '3 useful Deck cards · 0 loading · 2 need attention',
  setupNote: 'Some adapters do not require configured credentials. Network and upstream availability still apply.',
  sources: [{
    id: 'usgs',
    name: 'USGS Earthquakes',
    state: 'working',
    statusLabel: 'working now · 3 items in latest update',
    nextStep: 'Open Earthquakes to inspect the data.',
    canRetryAllData: false,
  }],
  showRetryAll: true,
};

test('startup readiness keeps controls outside an atomic polite live region', () => {
  const happyWindow = installDom();
  let retries = 0;
  let settingsOpens = 0;
  const presenter = createHomeShellStartupReadiness(ATTENTION, {
    onRetryAll: () => { retries += 1; },
    onOpenSettings: () => { settingsOpens += 1; },
  });
  happyWindow.document.body.append(presenter.element);
  const live = presenter.liveRegion;

  assert.equal(presenter.element.getAttribute('role'), null);
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.equal(live.getAttribute('aria-atomic'), 'true');
  assert.equal(live.getAttribute('aria-label'), 'First-run data readiness');
  assert.match(live.textContent, /first-run coverage needs attention/i);
  assert.equal(live.querySelector('[data-source-id="usgs"]')?.getAttribute('data-source-state'), 'working');
  assert.match(live.querySelector('[data-source-id="usgs"]')?.textContent ?? '', /working now.*3 items/i);

  const retry = presenter.element.querySelector<HTMLButtonElement>('[data-action="readiness-retry-all"]');
  const settings = presenter.element.querySelector<HTMLButtonElement>('[data-action="readiness-settings"]');
  assert.equal(live.contains(retry), false);
  assert.equal(live.contains(settings), false);
  assert.equal(retry?.textContent, 'Retry all data');
  assert.equal(settings?.textContent, 'Optional setup');
  retry?.click();
  settings?.click();
  assert.equal(retries, 1);
  assert.equal(settingsOpens, 1);
});

test('unchanged readiness retains live-node identity and a changed view replaces it exactly once', () => {
  installDom();
  const presenter = createHomeShellStartupReadiness(ATTENTION, {
    onRetryAll() {},
    onOpenSettings() {},
  });
  const first = presenter.liveRegion;
  assert.equal(presenter.update({ ...ATTENTION }), false);
  assert.equal(presenter.liveRegion, first);

  const changed = { ...ATTENTION, state: 'loading' as const, headline: 'Keyless coverage is still loading', showRetryAll: false };
  assert.equal(presenter.update(changed), true);
  const second = presenter.liveRegion;
  assert.notEqual(second, first);
  assert.equal(presenter.element.querySelectorAll('[role="status"]').length, 1);
  assert.equal(presenter.update({ ...changed }), false);
  assert.equal(presenter.liveRegion, second);
  assert.equal(presenter.element.querySelector('[data-action="readiness-retry-all"]'), null);
});

test('an over-budget Deck card uses sibling native actions without a nested button role', async () => {
  installDom();
  const { renderDeckCard } = await import('../HomeShellOverlay.ts');
  const card = renderDeckCard({
    panelId: 'live-news',
    title: 'Live News',
    tone: 'unknown',
    readiness: 'attention',
    hasRenderReport: false,
    canRetryAllData: false,
    statusLabel: 'no recent panel render after 30s · open panel',
  });

  assert.equal(card.tagName, 'ARTICLE');
  assert.equal(card.getAttribute('role'), null);
  assert.equal(card.tabIndex, -1);
  assert.equal(card.querySelector('[role="button"]'), null);
  assert.equal(card.querySelector<HTMLButtonElement>('[data-action="open"]')?.textContent, 'Open panel');
  assert.equal(card.querySelector('[data-action="retry"]'), null);
  assert.doesNotMatch(
    card.querySelector('.hs-card-status')?.textContent ?? '',
    /provider|data|offline|failed|unreachable|usable|live/i,
  );
});

test('the explicit Open panel action mounts a no-report panel in the focus host', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  const panelGrid = happyWindow.document.createElement('div');
  panelGrid.id = 'panelsGrid';
  const panelElement = happyWindow.document.createElement('section');
  panelElement.dataset.panel = 'live-news';
  panelGrid.append(panelElement);
  happyWindow.document.body.append(parent, panelGrid);

  const requested: string[] = [];
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async (panelId) => {
      requested.push(panelId);
      return { getElement: () => panelElement };
    },
  });
  shell.mount(parent);
  const testShell = shell as unknown as { renderDeck(cards: unknown[]): void };
  testShell.renderDeck([{
    panelId: 'live-news',
    title: 'Live News',
    tone: 'unknown',
    readiness: 'attention',
    hasRenderReport: false,
    canRetryAllData: false,
    statusLabel: 'no recent panel render after 30s · open panel',
  }]);

  const open = parent.querySelector<HTMLButtonElement>('[data-action="open"]');
  open?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, ['live-news']);
  assert.equal(parent.querySelector('.hs-focus')?.classList.contains('hs-focus--open'), true);
  assert.equal(parent.querySelector('.hs-focus-body')?.contains(panelElement), true);
  shell.destroy();
});

test('contextual posture does no hidden work, subscribes before one hydration, and unsubscribes while hidden', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  const order: string[] = [];
  let listener: (() => void) | undefined;
  let unsubscribeCount = 0;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualSnapshotSource: {
      get: () => { order.push('get'); return null; },
      subscribe: (callback) => {
        order.push('subscribe');
        listener = callback;
        return () => { unsubscribeCount += 1; listener = undefined; };
      },
      hydrate: async () => { order.push('hydrate'); },
    },
  });

  assert.deepEqual(order, []);
  shell.mount(parent);
  assert.deepEqual(order, []);
  shell.show();
  assert.deepEqual(order.slice(0, 3), ['subscribe', 'get', 'hydrate']);
  assert.ok(listener);
  await new Promise((resolve) => setTimeout(resolve, 0));
  shell.hide();
  assert.equal(unsubscribeCount, 1);
  shell.show();
  assert.equal(order.filter((entry) => entry === 'subscribe').length, 2);
  assert.equal(order.filter((entry) => entry === 'hydrate').length, 1);
  shell.destroy();
  assert.equal(unsubscribeCount, 2);
});

test('hide and destroy invalidate a pending contextual hydration completion', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  let resolveHydrate!: () => void;
  const pending = new Promise<void>((resolve) => { resolveHydrate = resolve; });
  let gets = 0;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualSnapshotSource: {
      get: () => { gets += 1; return null; },
      subscribe: () => () => {},
      hydrate: () => pending,
    },
  });
  shell.mount(parent);
  shell.show();
  assert.equal(gets, 1);
  shell.hide();
  shell.destroy();
  resolveHydrate();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gets, 1);
  assert.equal(parent.querySelector('.home-shell-contextual'), null);
});

test('an unchanged contextual projection preserves its focused DOM node and defers changed replacement until focus leaves', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  const outside = happyWindow.document.createElement('button');
  happyWindow.document.body.append(parent, outside);
  let current = contextualSnapshot();
  let listener: (() => void) | undefined;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualSnapshotSource: {
      get: () => current,
      subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  const first = section?.querySelector<HTMLElement>('[data-panel-key="local-logistics"]');

  current = contextualSnapshot(80.1);
  listener?.();
  const sameProjectionPreserved = section?.querySelector('[data-panel-key="local-logistics"]') === first;

  const currentOpen = section?.querySelector<HTMLButtonElement>('[data-action="context-open"]');
  currentOpen?.focus();
  const focusedBeforeUpdate = happyWindow.document.activeElement === currentOpen;

  current = contextualSnapshot(60);
  listener?.();
  const focusedUpdateDeferred = section?.querySelector('[data-panel-key="local-logistics"]') === first;
  outside.focus();
  const changedProjectionReplaced = section?.querySelector('[data-panel-key="local-logistics"]') !== first;
  const outsideFocused = happyWindow.document.activeElement === outside;
  shell.destroy();
  assert.equal(sameProjectionPreserved, true);
  assert.equal(focusedBeforeUpdate, true);
  assert.equal(focusedUpdateDeferred, true);
  assert.equal(changedProjectionReplaced, true);
  assert.equal(outsideFocused, true);
});

test('contextual Open leaves persisted pins byte-for-byte unchanged and exposes no pin controls', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  const panelGrid = happyWindow.document.createElement('div');
  panelGrid.id = 'panelsGrid';
  const panelElement = happyWindow.document.createElement('section');
  panelElement.dataset.panel = 'local-logistics';
  panelGrid.append(panelElement);
  happyWindow.document.body.append(parent, panelGrid);
  const rawPins = '["live-news","markets"]';
  happyWindow.localStorage.setItem('crystalball-deck-pins', rawPins);
  const requested: string[] = [];
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async (panelId) => { requested.push(panelId); return { getElement: () => panelElement }; },
    now: () => CONTEXT_NOW,
    contextualSnapshotSource: {
      get: () => contextualSnapshot(),
      subscribe: () => () => {},
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  const section = parent.querySelector('.home-shell-contextual');
  assert.equal(section?.querySelector('[data-action="move-left"]'), null);
  assert.equal(section?.querySelector('[data-action="move-right"]'), null);
  assert.equal(section?.querySelector('[data-action="unpin"]'), null);
  const contextualOpen = section?.querySelector<HTMLButtonElement>('[data-action="context-open"]');
  assert.equal(
    contextualOpen?.getAttribute('aria-label'),
    'Open Disaster Lifelines — Physical safety critical (80).',
  );
  contextualOpen?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, ['local-logistics']);
  assert.equal(happyWindow.localStorage.getItem('crystalball-deck-pins'), rawPins);
  shell.destroy();
});

test('persisting a pin immediately removes its canonical contextual suggestion', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualSnapshotSource: {
      get: () => contextualSnapshot(),
      subscribe: () => () => {},
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  assert.ok(parent.querySelector('.home-shell-contextual [data-panel-key="local-logistics"]'));
  const testShell = shell as unknown as { setPins(pins: string[]): void };
  testShell.setPins(['local-logistics']);
  const removed = parent.querySelector('.home-shell-contextual [data-panel-key="local-logistics"]') === null;
  shell.destroy();
  assert.equal(removed, true);
});

test('a runtime-disabled contextual panel uses the existing classic fallback', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  const panelGrid = happyWindow.document.createElement('div');
  panelGrid.id = 'panelsGrid';
  const disabled = happyWindow.document.createElement('section');
  disabled.classList.add('hidden');
  panelGrid.append(disabled);
  happyWindow.document.body.append(parent, panelGrid);
  const navigations: string[] = [];
  happyWindow.document.addEventListener('cb:navigate-panel', (event) => {
    navigations.push((event as CustomEvent<{ panelKey: string }>).detail.panelKey);
  }, { once: true });
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => ({ getElement: () => disabled }),
    now: () => CONTEXT_NOW,
    contextualSnapshotSource: {
      get: () => contextualSnapshot(),
      subscribe: () => () => {},
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  parent.querySelector<HTMLButtonElement>('.home-shell-contextual [data-action="context-open"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(navigations, ['local-logistics']);
  assert.equal(shell.isVisible(), false);
  shell.destroy();
});
