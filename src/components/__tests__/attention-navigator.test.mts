import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

type AttentionSnapshot = import('@/services/panel-attention').AttentionSnapshot;

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

const moduleUnderTest = await import('@/components/AttentionNavigator.ts');

function snapshot(): AttentionSnapshot {
  return {
    panels: [
      {
        panelId: 'weather', activeCount: 2, maxSeverity: 'critical', maxScore: 120,
        newestEvidenceAt: 2,
        evidence: [
          { id: 'w1', observedAt: 1, revision: '0000000000000001' },
          { id: 'w2', observedAt: 2, revision: '0000000000000002' },
        ],
        unreviewedEvidence: [
          { id: 'w1', observedAt: 1, revision: '0000000000000001' },
          { id: 'w2', observedAt: 2, revision: '0000000000000002' },
        ],
        unreviewedCount: 2, promoted: true,
      },
      {
        panelId: 'cyber', activeCount: 1, maxSeverity: 'medium', maxScore: 40,
        newestEvidenceAt: 3,
        evidence: [{ id: 'c1', observedAt: 3, revision: '0000000000000003' }],
        unreviewedEvidence: [{ id: 'c1', observedAt: 3, revision: '0000000000000003' }],
        unreviewedCount: 1, promoted: true,
      },
    ],
    severityCounts: { critical: 1, medium: 1 },
    promotedPanelIds: ['weather', 'cyber'],
  };
}

function click(target: Element): void {
  target.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('renders every unreviewed pane with accessible semantic severity text', async () => {
  const { AttentionNavigator } = moduleUnderTest;
  const navigator = new AttentionNavigator({ onReview: () => {}, getPanelName: (id) => id.toUpperCase() });
  navigator.mount(document.body);
  navigator.update(snapshot());

  const root = navigator.getElement();
  assert.equal(root.querySelectorAll('[data-attention-panel]').length, 2);
  assert.match(root.textContent ?? '', /1 critical/i);
  assert.match(root.textContent ?? '', /1 emerging/i);
  assert.match(root.textContent ?? '', /WEATHER/);
  assert.equal(root.querySelector('[aria-live="polite"]') !== null, true);
  assert.equal(root.querySelector('[data-attention-severity="critical"]') !== null, true);

  navigator.destroy();
});

test('keeps the polite live region mounted while queue text changes', () => {
  const { AttentionNavigator } = moduleUnderTest;
  const navigator = new AttentionNavigator({ onReview: () => {} });
  navigator.mount(document.body);
  navigator.update(snapshot());
  const liveRegion = navigator.getElement().querySelector('[aria-live="polite"]');

  const changed = snapshot();
  changed.panels = [changed.panels[1]!];
  changed.severityCounts = { medium: 1 };
  changed.promotedPanelIds = ['cyber'];
  navigator.update(changed);

  assert.equal(navigator.getElement().querySelector('[aria-live="polite"]') === liveRegion, true);
  assert.equal(liveRegion?.textContent, '0 critical · 0 high · 1 emerging · 0 new');
  navigator.destroy();
});

test('Next and Open dispatch shell-aware navigation without marking reviewed', async () => {
  const { AttentionNavigator } = moduleUnderTest;
  const reviewed: string[] = [];
  const opened: Array<{ type: string; panelKey: string }> = [];
  const onClassic = (event: Event): void => opened.push({ type: event.type, panelKey: (event as CustomEvent).detail.panelKey });
  const onShell = (event: Event): void => opened.push({ type: event.type, panelKey: (event as CustomEvent).detail.panelKey });
  document.addEventListener('cb:navigate-panel', onClassic);
  document.addEventListener('cb:open-panel', onShell);
  const navigator = new AttentionNavigator({ onReview: (id) => reviewed.push(id) });
  navigator.mount(document.body);
  navigator.update(snapshot());

  click(navigator.getElement().querySelector('[data-attention-action="next"]')!);
  document.body.classList.add('home-shell-active');
  const cyberOpen = navigator.getElement().querySelector('[data-attention-action="open"][data-panel-id="cyber"]')!;
  click(cyberOpen);

  assert.deepEqual(opened, [
    { type: 'cb:navigate-panel', panelKey: 'weather' },
    { type: 'cb:open-panel', panelKey: 'cyber' },
  ]);
  assert.deepEqual(reviewed, []);

  navigator.destroy();
  document.body.classList.remove('home-shell-active');
  document.removeEventListener('cb:navigate-panel', onClassic);
  document.removeEventListener('cb:open-panel', onShell);
});

test('Mark reviewed uses stable-root delegation after rerender and never dispatches navigation', async () => {
  const { AttentionNavigator } = moduleUnderTest;
  const reviewed: string[] = [];
  let navigations = 0;
  const onNavigate = (): void => { navigations++; };
  document.addEventListener('cb:navigate-panel', onNavigate);
  const navigator = new AttentionNavigator({ onReview: (id) => reviewed.push(id) });
  navigator.mount(document.body);
  navigator.update(snapshot());
  navigator.update(snapshot());

  const button = navigator.getElement().querySelector<HTMLElement>(
    '[data-attention-action="review"][data-panel-id="weather"]',
  )!;
  const clone = button.cloneNode(true) as HTMLElement;
  button.replaceWith(clone);
  click(clone);

  assert.deepEqual(reviewed, ['weather']);
  assert.equal(navigations, 0);

  navigator.destroy();
  document.removeEventListener('cb:navigate-panel', onNavigate);
});

test('Mark reviewed advances to the next pane returned by the review transaction', () => {
  const { AttentionNavigator } = moduleUnderTest;
  const opened: string[] = [];
  const onNavigate = (event: Event): void => opened.push((event as CustomEvent).detail.panelKey);
  document.addEventListener('cb:navigate-panel', onNavigate);
  const navigator = new AttentionNavigator({
    onReview: (panelId) => panelId === 'weather' ? 'cyber' : undefined,
  });
  navigator.mount(document.body);
  navigator.update(snapshot());

  const review = navigator.getElement().querySelector<HTMLElement>(
    '[data-attention-action="review"][data-panel-id="weather"]',
  )!;
  review.focus();
  click(review);

  assert.deepEqual(opened, ['cyber']);
  assert.equal((document.activeElement as HTMLElement).dataset.panelId, 'cyber');
  navigator.destroy();
  document.removeEventListener('cb:navigate-panel', onNavigate);
});

test('Mark reviewed keeps focus in the trail when the queue becomes empty', () => {
  const { AttentionNavigator } = moduleUnderTest;
  let navigator: InstanceType<typeof AttentionNavigator>;
  navigator = new AttentionNavigator({
    onReview: () => {
      navigator.update({ panels: [], severityCounts: {}, promotedPanelIds: [] });
    },
  });
  navigator.mount(document.body);
  navigator.update(snapshot());
  const review = navigator.getElement().querySelector<HTMLElement>(
    '[data-attention-action="review"][data-panel-id="weather"]',
  )!;
  review.focus();

  click(review);

  assert.equal(document.activeElement?.classList.contains('attention-navigator-summary'), true);
  navigator.destroy();
});

test('renders a truthful clear state when no pane needs review', async () => {
  const { AttentionNavigator } = moduleUnderTest;
  const navigator = new AttentionNavigator({ onReview: () => {} });
  navigator.mount(document.body);
  navigator.update({ panels: [], severityCounts: {}, promotedPanelIds: [] });

  assert.match(navigator.getElement().textContent ?? '', /Review queue clear/i);
  assert.equal(navigator.getElement().querySelector('[data-attention-action="next"]')?.hasAttribute('disabled'), true);

  navigator.destroy();
});

test('destroy removes the navigator and all pane/sidebar attention decoration', async () => {
  const { AttentionNavigator, applyAttentionDecorations } = moduleUnderTest;
  const pane = document.createElement('section');
  pane.className = 'panel';
  pane.dataset.panel = 'weather';
  const header = document.createElement('div');
  header.className = 'panel-header';
  pane.append(header);
  const sidebar = document.createElement('button');
  sidebar.className = 'mac-sidebar-panel-item';
  sidebar.dataset.panelKey = 'weather';
  document.body.append(pane, sidebar);
  const navigator = new AttentionNavigator({ onReview: () => {} });
  navigator.mount(document.body);
  navigator.update(snapshot());
  applyAttentionDecorations(snapshot());

  assert.equal(pane.dataset.attentionSeverity, 'critical');
  assert.equal(pane.querySelector('.panel-attention-chip') !== null, true);
  assert.equal(sidebar.dataset.attentionSeverity, 'critical');
  navigator.destroy();

  assert.equal(document.body.contains(navigator.getElement()), false);
  assert.equal(pane.hasAttribute('data-attention-severity'), false);
  assert.equal(pane.querySelector('.panel-attention-chip'), null);
  assert.equal(sidebar.hasAttribute('data-attention-severity'), false);
  pane.remove();
  sidebar.remove();
});

test('reapplying an unchanged snapshot preserves chips and ignores nested data-panel links', () => {
  const { applyAttentionDecorations } = moduleUnderTest;
  const pane = document.createElement('section');
  pane.className = 'panel';
  pane.dataset.panel = 'weather';
  const header = document.createElement('div');
  header.className = 'panel-header';
  const nested = document.createElement('a');
  nested.dataset.panel = 'weather';
  pane.append(header, nested);
  document.body.append(pane);

  applyAttentionDecorations(snapshot());
  const firstChip = header.querySelector('.panel-attention-chip');
  applyAttentionDecorations(snapshot());

  assert.equal(
    header.querySelector('.panel-attention-chip') === firstChip,
    true,
    'unchanged decoration avoids DOM replacement',
  );
  assert.equal(nested.hasAttribute('data-attention-severity'), false, 'only pane roots receive pane attention state');
  pane.remove();
});
