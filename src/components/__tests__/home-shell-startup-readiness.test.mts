import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';

import { createHomeShellStartupReadiness } from '../HomeShellStartupReadiness.ts';
import { buildContextualDeckView } from '../../services/home-shell/contextual-deck-view.ts';
import type { HomeShellReadinessView } from '../../services/home-shell/startup-readiness-view.ts';
import type { WorldSnapshot } from '../../services/survival/survival-types.ts';

const READY_CONTEXTUAL_PROJECTION = {
  kind: 'ready' as const,
  build: buildContextualDeckView,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
    threats: axis === 'physical_safety' && level >= 40 ? [{
      sourceEventId: 'test-physical-safety',
      axis,
      severity: level,
      threatLevel: level >= 75 ? 'warning' : 'advisory',
      hazardKind: 'other',
      hazardLabel: 'Test physical safety threat',
      timeToImpactMins: null,
      arrivalLabel: null,
      why: 'Test support',
      confidenceLabel: 'medium',
    }] : [],
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

test('contextual projection stays behind a dynamic production boundary', async () => {
  const source = await readFile(new URL('../HomeShellOverlay.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(
    source,
    /import\s+(?!type\b)[^;]+\sfrom\s*['"]@\/services\/home-shell\/contextual-deck-view['"];/,
  );
  assert.match(
    source,
    /import\(\s*['"]@\/services\/home-shell\/contextual-deck-view['"]\s*\)/,
  );
});

test('lazy contextual projection does no constructor or mount work and loads once on show', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  const load = deferred<typeof buildContextualDeckView>();
  const hydrate = deferred<void>();
  let loads = 0;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualProjection: {
      kind: 'lazy',
      load: () => { loads += 1; return load.promise; },
    },
    contextualSnapshotSource: {
      get: () => contextualSnapshot(),
      subscribe: () => () => {},
      hydrate: () => hydrate.promise,
    },
  });

  assert.equal(loads, 0);
  shell.mount(parent);
  assert.equal(loads, 0);
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  assert.equal(loads, 1);
  assert.equal(section?.dataset.state, 'checking');
  assert.match(section?.textContent ?? '', /loading contextual guidance/i);

  shell.hide();
  shell.show();
  assert.equal(loads, 1);
  shell.destroy();
  load.resolve(buildContextualDeckView);
  hydrate.resolve();
  await flushAsync();
});

test('lazy projection and hydration use the latest snapshot in either completion order', async () => {
  for (const completionOrder of ['projection-first', 'hydration-first'] as const) {
    const happyWindow = installDom();
    const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
    const parent = happyWindow.document.createElement('main');
    happyWindow.document.body.append(parent);
    const load = deferred<typeof buildContextualDeckView>();
    const hydrate = deferred<void>();
    let current: WorldSnapshot | null = null;
    let loads = 0;
    const shell = new HomeShellOverlay({
      getPanel: () => undefined,
      ensurePanel: async () => undefined,
      now: () => CONTEXT_NOW,
      contextualProjection: {
        kind: 'lazy',
        load: () => { loads += 1; return load.promise; },
      },
      contextualSnapshotSource: {
        get: () => current,
        subscribe: () => () => {},
        hydrate: () => hydrate.promise,
      },
    });
    shell.mount(parent);
    shell.show();
    const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
    assert.equal(section?.dataset.state, 'checking', completionOrder);
    current = contextualSnapshot();

    if (completionOrder === 'projection-first') {
      load.resolve(buildContextualDeckView);
      await flushAsync();
      assert.equal(section?.dataset.state, 'active', completionOrder);
      hydrate.resolve();
    } else {
      hydrate.resolve();
      await flushAsync();
      assert.equal(section?.dataset.state, 'checking', completionOrder);
      load.resolve(buildContextualDeckView);
    }
    await flushAsync();

    assert.equal(loads, 1, completionOrder);
    assert.equal(section?.dataset.state, 'active', completionOrder);
    assert.ok(section?.querySelector('[data-panel-key="local-logistics"]'), completionOrder);
    shell.destroy();
  }
});

test('a hidden lazy resolution caches without touching DOM and renders synchronously on reshow', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  const load = deferred<typeof buildContextualDeckView>();
  const hydrate = deferred<void>();
  let gets = 0;
  let loads = 0;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualProjection: {
      kind: 'lazy',
      load: () => { loads += 1; return load.promise; },
    },
    contextualSnapshotSource: {
      get: () => { gets += 1; return contextualSnapshot(); },
      subscribe: () => () => {},
      hydrate: () => hydrate.promise,
    },
  });
  shell.mount(parent);
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  assert.equal(section?.dataset.state, 'checking');
  shell.hide();

  load.resolve(buildContextualDeckView);
  await flushAsync();
  assert.equal(section?.dataset.state, 'checking');
  assert.equal(gets, 0);

  shell.show();
  assert.equal(loads, 1);
  assert.equal(gets, 2);
  assert.equal(section?.dataset.state, 'active');
  shell.destroy();
  hydrate.resolve();
  await flushAsync();
});

test('a hidden lazy rejection preserves checking DOM and renders cached failure on reshow', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  const load = deferred<typeof buildContextualDeckView>();
  void load.promise.catch(() => {});
  let gets = 0;
  let loads = 0;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualProjection: {
      kind: 'lazy',
      load: () => { loads += 1; return load.promise; },
    },
    contextualSnapshotSource: {
      get: () => { gets += 1; return contextualSnapshot(); },
      subscribe: () => () => {},
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  const checkingNode = section?.firstElementChild;
  const checkingText = section?.textContent;
  assert.equal(section?.dataset.state, 'checking');
  shell.hide();

  load.reject(new Error('contextual chunk unavailable'));
  await flushAsync();
  assert.equal(section?.dataset.state, 'checking');
  assert.equal(section?.firstElementChild, checkingNode);
  assert.equal(section?.textContent, checkingText);
  assert.equal(gets, 0);

  shell.show();
  assert.equal(section?.dataset.state, 'unavailable');
  assert.match(section?.textContent ?? '', /use your deck or library to open panels/i);
  assert.equal(loads, 1);
  shell.hide();
  shell.show();
  assert.equal(loads, 1);
  shell.destroy();
});

test('destroyed lazy projection completions never render or access the detached section', async () => {
  for (const outcome of ['resolve', 'reject'] as const) {
    const happyWindow = installDom();
    const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
    const parent = happyWindow.document.createElement('main');
    happyWindow.document.body.append(parent);
    const load = deferred<typeof buildContextualDeckView>();
    void load.promise.catch(() => {});
    let loads = 0;
    let gets = 0;
    let builderCalls = 0;
    let detachedWrites = 0;
    const builder: typeof buildContextualDeckView = (inputs, now) => {
      builderCalls += 1;
      return buildContextualDeckView(inputs, now);
    };
    const shell = new HomeShellOverlay({
      getPanel: () => undefined,
      ensurePanel: async () => undefined,
      now: () => CONTEXT_NOW,
      contextualProjection: {
        kind: 'lazy',
        load: () => { loads += 1; return load.promise; },
      },
      contextualSnapshotSource: {
        get: () => { gets += 1; return contextualSnapshot(); },
        subscribe: () => () => {},
        hydrate: async () => {},
      },
    });
    shell.mount(parent);
    shell.show();
    const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
    shell.destroy();
    if (section) section.replaceChildren = () => { detachedWrites += 1; };

    if (outcome === 'resolve') load.resolve(builder);
    else load.reject(new Error('contextual chunk unavailable'));
    await flushAsync();

    assert.equal(loads, 1, outcome);
    assert.equal(gets, 0, outcome);
    assert.equal(builderCalls, 0, outcome);
    assert.equal(detachedWrites, 0, outcome);
    assert.equal(parent.querySelector('.home-shell-contextual'), null, outcome);
  }
});

test('a visible lazy rejection is stable, fail-closed, and leaves Your Deck usable', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  const panelGrid = happyWindow.document.createElement('div');
  panelGrid.id = 'panelsGrid';
  const panelElement = happyWindow.document.createElement('section');
  panelGrid.append(panelElement);
  happyWindow.document.body.append(parent, panelGrid);
  const load = deferred<typeof buildContextualDeckView>();
  void load.promise.catch(() => {});
  let loads = 0;
  const requested: string[] = [];
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async (panelId) => {
      requested.push(panelId);
      return { getElement: () => panelElement };
    },
    now: () => CONTEXT_NOW,
    contextualProjection: {
      kind: 'lazy',
      load: () => { loads += 1; return load.promise; },
    },
    contextualSnapshotSource: {
      get: () => contextualSnapshot(),
      subscribe: () => () => {},
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  load.reject(new Error('contextual chunk unavailable'));
  await flushAsync();

  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  assert.equal(section?.dataset.state, 'unavailable');
  assert.match(section?.textContent ?? '', /use your deck or library to open panels/i);
  assert.equal(section?.querySelector('[data-action="context-open"]'), null);
  assert.equal(section?.querySelector('[data-action*="retry"]'), null);
  const deckOpen = parent.querySelector<HTMLButtonElement>('.home-shell-deck [data-action="open"]');
  assert.ok(deckOpen);
  deckOpen?.click();
  await flushAsync();
  assert.equal(requested.length, 1);

  shell.hide();
  shell.show();
  assert.equal(loads, 1);
  assert.equal(section?.dataset.state, 'unavailable');
  assert.match(section?.textContent ?? '', /use your deck or library to open panels/i);
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
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
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

test('the 10-second shell refresh marks a snapshot stale after time crosses the freshness boundary without a posture event', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  let now = CONTEXT_NOW + 15 * 60_000;
  let postureEvents = 0;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => now,
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
    contextualSnapshotSource: {
      get: () => contextualSnapshot(),
      subscribe: () => () => { postureEvents += 1; },
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  const testShell = shell as unknown as {
    loop: { inspect(): { intervalMs: number } };
    refresh(): void;
  };
  assert.equal(testShell.loop.inspect().intervalMs, 10_000);
  assert.equal(section?.dataset.state, 'active');

  now += 1;
  testShell.refresh();

  assert.equal(postureEvents, 0);
  assert.equal(section?.dataset.state, 'stale');
  assert.match(section?.textContent ?? '', /verify current conditions before acting/i);
  assert.ok(section?.querySelector('[data-panel-key="local-logistics"]'));
  shell.destroy();
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
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
    contextualSnapshotSource: {
      get: () => { gets += 1; return null; },
      subscribe: () => () => {},
      hydrate: () => pending,
    },
  });
  shell.mount(parent);
  shell.show();
  assert.equal(gets, 2);
  shell.hide();
  shell.destroy();
  resolveHydrate();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gets, 2);
  assert.equal(parent.querySelector('.home-shell-contextual'), null);
});

test('a pending first hydration settles into the currently visible reshow generation', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  let resolveHydrate!: () => void;
  const pending = new Promise<void>((resolve) => { resolveHydrate = resolve; });
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
    contextualSnapshotSource: {
      get: () => null,
      subscribe: () => () => {},
      hydrate: () => pending,
    },
  });
  shell.mount(parent);
  shell.show();
  shell.hide();
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  assert.equal(section?.dataset.state, 'checking');

  resolveHydrate();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));

  const settledState = section?.dataset.state;
  const settledText = section?.textContent ?? '';
  shell.destroy();
  assert.equal(settledState, 'unavailable');
  assert.match(settledText, /no posture snapshot yet/i);
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
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
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

test('a focused contextual A to B to A update cancels the obsolete deferred B view', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  let current = contextualSnapshot(80);
  let listener: (() => void) | undefined;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
    contextualSnapshotSource: {
      get: () => current,
      subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  const section = parent.querySelector<HTMLElement>('.home-shell-contextual');
  const initialCard = section?.querySelector<HTMLElement>('[data-panel-key="local-logistics"]');
  const open = section?.querySelector<HTMLButtonElement>('[data-action="context-open"]');
  open?.focus();

  current = contextualSnapshot(60);
  listener?.();
  current = contextualSnapshot(80);
  listener?.();
  const testShell = shell as unknown as { pendingContextualView: unknown };

  const finalCard = section?.querySelector('[data-panel-key="local-logistics"]');
  const finalText = section?.textContent ?? '';
  const pendingView = testShell.pendingContextualView;
  shell.destroy();
  assert.equal(finalCard, initialCard);
  assert.match(finalText, /critical \(80\)/i);
  assert.equal(pendingView, null);
});

test('the Deck hint reveals actionable contextual suggestions before falling through to saved cards', async () => {
  const happyWindow = installDom();
  const { HomeShellOverlay } = await import('../HomeShellOverlay.ts');
  const parent = happyWindow.document.createElement('main');
  happyWindow.document.body.append(parent);
  let current = contextualSnapshot(80);
  let listener: (() => void) | undefined;
  const shell = new HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => CONTEXT_NOW,
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
    contextualSnapshotSource: {
      get: () => current,
      subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
      hydrate: async () => {},
    },
  });
  shell.mount(parent);
  shell.show();
  const hint = parent.querySelector<HTMLButtonElement>('.home-shell-deck-hint');
  const contextual = parent.querySelector<HTMLElement>('.home-shell-contextual');
  const deck = parent.querySelector<HTMLElement>('.home-shell-deck');
  const reached: string[] = [];
  if (contextual) contextual.scrollIntoView = () => { reached.push('contextual'); };
  if (deck) deck.scrollIntoView = () => { reached.push('deck'); };

  hint?.click();
  current = contextualSnapshot(0);
  listener?.();
  hint?.click();

  shell.destroy();
  assert.deepEqual(reached, ['contextual', 'deck']);
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
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
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
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
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
    contextualProjection: READY_CONTEXTUAL_PROJECTION,
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
