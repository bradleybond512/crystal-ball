import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { createHomeShellStartupReadiness } from '../HomeShellStartupReadiness.ts';
import type { HomeShellReadinessView } from '../../services/home-shell/startup-readiness-view.ts';

function installDom(): Window {
  const happyWindow = new Window({ url: 'https://crystalball.app/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = happyWindow;
  globals.document = happyWindow.document;
  globals.localStorage = happyWindow.localStorage;
  globals.sessionStorage = happyWindow.sessionStorage;
  globals.HTMLElement = happyWindow.HTMLElement;
  globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
  globals.Element = happyWindow.Element;
  globals.Node = happyWindow.Node;
  globals.Event = happyWindow.Event;
  globals.CustomEvent = happyWindow.CustomEvent;
  globals.KeyboardEvent = happyWindow.KeyboardEvent;
  globals.MutationObserver = happyWindow.MutationObserver;
  globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
  globals.matchMedia = happyWindow.matchMedia;
  Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
  return happyWindow;
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
