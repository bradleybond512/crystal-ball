import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

type UnifiedAlert = import('@/services/unified-alerts').UnifiedAlert;

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = happyWindow;
globals.document = happyWindow.document;
globals.HTMLElement = happyWindow.HTMLElement;
globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
globals.Element = happyWindow.Element;
globals.Node = happyWindow.Node;
globals.Event = happyWindow.Event;
globals.CustomEvent = happyWindow.CustomEvent;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: happyWindow.localStorage,
});

const { unifiedAlertStore } = await import('@/services/unified-alerts.ts');
const { PANEL_REVIEW_STORAGE_KEY } = await import('@/services/panel-attention.ts');
const { startSidebarHeat } = await import('@/services/sidebar-heat.ts');

function alert(
  id: string,
  source: UnifiedAlert['source'],
  severity: UnifiedAlert['severity'],
): UnifiedAlert {
  return {
    id,
    source,
    severity,
    title: id,
    body: id,
    timestamp: Date.now(),
    relevanceScore: 100,
    acknowledged: false,
    pinned: true,
  };
}

function pane(panelId: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'panel';
  element.dataset.panel = panelId;
  const header = document.createElement('div');
  header.className = 'panel-header';
  element.append(header);
  return element;
}

test('controller owns one lifecycle, persists review, and promotes without reordering children', () => {
  localStorage.clear();
  document.body.replaceChildren();
  const alerts = [
    alert('weather', 'nws', 'critical'),
    alert('cyber', 'cyber', 'high'),
    alert('news', 'breaking-news', 'medium'),
    alert('air', 'air-quality', 'medium'),
  ];
  const store = unifiedAlertStore as unknown as {
    getAll: () => UnifiedAlert[];
    subscribe: (listener: () => void) => () => void;
  };
  const originalGetAll = store.getAll;
  const originalSubscribe = store.subscribe;
  const originalSetInterval = happyWindow.setInterval;
  const originalClearInterval = happyWindow.clearInterval;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  let intervalCalls = 0;
  const clearedIntervals: number[] = [];
  store.getAll = () => alerts;
  store.subscribe = () => {
    subscribeCalls++;
    return () => { unsubscribeCalls++; };
  };
  Object.defineProperty(happyWindow, 'setInterval', {
    configurable: true,
    value: () => { intervalCalls++; return 71; },
  });
  Object.defineProperty(happyWindow, 'clearInterval', {
    configurable: true,
    value: (id: number) => { clearedIntervals.push(id); },
  });

  const navigatorParent = document.createElement('div');
  const grid = document.createElement('div');
  grid.id = 'panelsGrid';
  const panelIds = ['unified-alert-inbox', 'cyber-threats', 'live-news', 'air-quality'];
  const directPanes = panelIds.map((panelId) => pane(panelId));
  const wrapper = document.createElement('div');
  const nestedPane = pane('unified-alert-inbox');
  wrapper.append(nestedPane);
  grid.append(...directPanes, wrapper);
  for (const panelId of panelIds) {
    const sidebarItem = document.createElement('button');
    sidebarItem.className = 'mac-sidebar-panel-item';
    sidebarItem.dataset.panelKey = panelId;
    document.body.append(sidebarItem);
  }
  document.body.append(navigatorParent, grid);
  const originalOrder = [...grid.children];
  let controller: ReturnType<typeof startSidebarHeat> | undefined;

  try {
    controller = startSidebarHeat(navigatorParent);
    assert.equal(startSidebarHeat(navigatorParent), controller, 'start is idempotent');
    assert.equal(subscribeCalls, 1);
    assert.equal(intervalCalls, 1);
    assert.deepEqual([...grid.children], originalOrder, 'promotion never moves DOM children');
    const promoted = directPanes.filter((element) => element.style.order === '-1');
    assert.equal(promoted.length > 0 && promoted.length <= 3, true);
    assert.equal(nestedPane.style.order, '', 'only direct grid children are promoted');

    const review = navigatorParent.querySelector<HTMLElement>(
      '[data-attention-action="review"][data-panel-id="unified-alert-inbox"]',
    );
    assert.ok(review);
    review.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
    const ledger = JSON.parse(localStorage.getItem(PANEL_REVIEW_STORAGE_KEY) ?? 'null') as {
      reviewed?: Array<{ id?: string }>;
    };
    assert.deepEqual(ledger.reviewed?.map((identity) => identity.id), ['weather']);
    assert.equal(
      navigatorParent.querySelector('[data-attention-panel="unified-alert-inbox"]'),
      null,
      'review transaction refreshes the queue',
    );

    controller.destroy();
    assert.equal(unsubscribeCalls, 1);
    assert.deepEqual(clearedIntervals, [71]);
    assert.equal(navigatorParent.querySelector('.attention-navigator'), null);
    assert.equal(directPanes.some((element) => element.style.order !== ''), false);
    controller.destroy();
    assert.equal(unsubscribeCalls, 1, 'destroy is idempotent');
  } finally {
    controller?.destroy();
    store.getAll = originalGetAll;
    store.subscribe = originalSubscribe;
    Object.defineProperty(happyWindow, 'setInterval', {
      configurable: true,
      value: originalSetInterval,
    });
    Object.defineProperty(happyWindow, 'clearInterval', {
      configurable: true,
      value: originalClearInterval,
    });
    document.body.replaceChildren();
    localStorage.clear();
  }
});
