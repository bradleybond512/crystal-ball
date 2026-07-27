/**
 * TodayView row / Ack / close delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. render() rebuilds
 * the header, every source-grouped row and its nested Ack button via
 * replaceChildren, and it fires in the background from the unifiedAlertStore +
 * activity-log subscriptions wired in show(). Binding `click` directly on those
 * per-render nodes let a re-render landing between pointerdown and pointerup
 * orphan the node so the browser never synthesized the click → the row/button
 * looked dead.
 *
 * The fix routes every interaction through ONE delegated listener bound on the
 * stable overlay in the constructor (created once, never replaced): the close
 * button carries `data-today-action="close"`, each row carries
 * `data-today-action="jump"` + `data-alert-id`, and its nested Ack button carries
 * `data-today-action="ack"` + `data-alert-id`. `target.closest('[data-today-action]')`
 * resolves the nearest action at click time — landing on the Ack button resolves
 * "ack" (preserving the old stopPropagation semantics), landing anywhere else on
 * the row resolves "jump".
 *
 * TodayView is a standalone overlay (it does not extend Panel), so this runs under
 * plain `tsx --test` via the test:renderer glob and must self-exit. happy-dom
 * cannot reproduce WKWebView's cross-render click synthesis, so these tests lock
 * the delegation CONTRACT (data attributes + root handler that survives a render()
 * teardown) rather than the raw race.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLDivElement = happyWindow.HTMLDivElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.HTMLSpanElement = happyWindow.HTMLSpanElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.MouseEvent = happyWindow.MouseEvent;
G.CustomEvent = happyWindow.CustomEvent;
G.localStorage = happyWindow.localStorage;

type UnifiedAlert = import('@/services/unified-alerts').UnifiedAlert;
type AlertSource = import('@/services/unified-alerts').AlertSource;

const { unifiedAlertStore } = await import('@/services/unified-alerts');
const { panelForAlert } = await import('@/services/alert-routing');

// Seed the singleton store from module-scoped fixtures. getAll drives both the
// render() ranking and the jump handler's id lookup; acknowledge records calls.
let fixtures: UnifiedAlert[] = [];
const acked: string[] = [];
const store = unifiedAlertStore as unknown as Record<string, unknown>;
store.getAll = () => fixtures;
store.subscribe = () => () => { /* noop unsub — show() must not wire a live subscription */ };
store.acknowledge = (id: string) => { acked.push(id); };

const { TodayView } = await import('@/components/TodayView.ts');

interface ViewInternals {
  overlay: HTMLElement;
  render(): void;
}

function makeAlert(id: string, source: AlertSource = 'nws'): UnifiedAlert {
  return {
    id,
    source,
    severity: 'critical',
    title: `Alert ${id}`,
    body: 'delegation coverage fixture',
    // Fresh timestamp: rankAlerts drops any alert whose decayed score is 0, and a
    // stale (multi-year-old) timestamp would decay this fixture out of the render.
    timestamp: Date.now(),
    relevanceScore: 0,
    acknowledged: false,
    pinned: false,
  };
}

function mount(): { view: InstanceType<typeof TodayView>; internals: ViewInternals } {
  const view = new TodayView();
  view.mount(happyWindow.document.body as unknown as HTMLElement);
  return { view, internals: view as unknown as ViewInternals };
}

/** Replace the instance's hide() with a counting spy that still hides. `this.hide()`
 *  in the delegate resolves to this own-property shadow. */
function spyHide(view: InstanceType<typeof TodayView>): { calls: () => number; restore: () => void } {
  let n = 0;
  const orig = view.hide.bind(view);
  (view as unknown as { hide: () => void }).hide = () => { n++; orig(); };
  return { calls: () => n, restore: () => orig() };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('rows, Ack + close carry the delegated data-today-action contract', () => {
  fixtures = [makeAlert('al-1')];
  const { view, internals } = mount();
  view.show();

  const overlay = internals.overlay;
  const close = overlay.querySelector<HTMLElement>('.today-view-close');
  assert.equal(close?.dataset.todayAction, 'close', 'close button delegates as close');

  const row = overlay.querySelector<HTMLElement>('.today-view-row');
  assert.ok(row, 'alert row rendered');
  assert.equal(row?.dataset.todayAction, 'jump', 'row delegates as jump');
  assert.equal(row?.dataset.alertId, 'al-1', 'row carries data-alert-id');

  const ack = overlay.querySelector<HTMLElement>('.today-row-ack');
  assert.equal(ack?.dataset.todayAction, 'ack', 'Ack button delegates as ack');
  assert.equal(ack?.dataset.alertId, 'al-1', 'Ack button carries data-alert-id');

  view.hide();
});

test('Ack click acknowledges via the root delegate after a render() teardown, without closing', () => {
  acked.length = 0;
  fixtures = [makeAlert('al-2')];
  const { view, internals } = mount();
  view.show();
  // Reproduce the teardown that swallowed direct-bound clicks: a full re-render
  // replaces the original Ack button node. The delegate lives on the overlay,
  // which persists, so the fresh button still routes.
  internals.render();

  const hide = spyHide(view);
  const ack = internals.overlay.querySelector<HTMLElement>('.today-row-ack');
  assert.ok(ack, 'Ack button re-rendered after teardown');
  assert.deepEqual(acked, [], 'nothing acknowledged before click');

  // Swap the live Ack button for a cloneNode(true) copy: clones carry the
  // data-today-action / data-alert-id attributes but DROP directly-bound
  // listeners, so the click can ONLY be serviced by the delegated listener on
  // the stable overlay. This is the definitive delegation-vs-per-render
  // distinguisher — the OLD per-render impl also re-bound on every render, so a
  // plain re-render-then-click could not tell the two apart; the listener-
  // stripped clone can. The clone stays inside the row (a descendant of the
  // overlay), so closest('[data-today-action]') re-resolves "ack" at click time.
  // A per-node regression makes this click inert.
  const clone = (ack as HTMLElement).cloneNode(true) as HTMLElement;
  (ack as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.deepEqual(acked, ['al-2'], 'Ack routes acknowledge(id) via the root delegate');
  assert.equal(hide.calls(), 0, 'acknowledging must not close the overlay');

  hide.restore();
});

test('row click jumps to the alert panel via the root delegate after teardown', () => {
  acked.length = 0;
  fixtures = [makeAlert('al-3', 'nws')];
  const { view, internals } = mount();
  view.show();
  internals.render();

  // Force jumpToPanel's shell branch so the routed panel id is observable as a
  // cb:open-panel event instead of a silent scrollIntoView.
  happyWindow.document.body.classList.add('home-shell-active');
  const opened: string[] = [];
  const listener = (e: Event): void => { opened.push((e as CustomEvent).detail.panelKey); };
  happyWindow.document.addEventListener('cb:open-panel', listener as EventListener);

  const hide = spyHide(view);
  const row = internals.overlay.querySelector<HTMLElement>('.today-view-row');
  assert.ok(row, 'alert row re-rendered after teardown');

  // Swap the live row for a cloneNode(true) copy: the clone carries the row's
  // data-today-action="jump" / data-alert-id but DROPS any directly-bound
  // listener, so the click can ONLY be serviced by the delegated listener on the
  // stable overlay. This is the definitive delegation-vs-per-render distinguisher
  // — the OLD per-render impl also re-bound on every render, so a plain
  // re-render-then-click could not tell the two apart; the listener-stripped
  // clone can. Clicking the title span (a descendant of the clone that is NOT
  // inside the Ack button) exercises closest('[data-today-action]') resolving
  // "jump". A per-node regression makes this click inert.
  const clone = (row as HTMLElement).cloneNode(true) as HTMLElement;
  (row as HTMLElement).replaceWith(clone);
  const title = clone.querySelector<HTMLElement>('.today-row-title');
  assert.ok(title, 'row title present inside the clone');

  dispatchBubblingClick(title as Element);

  assert.deepEqual(
    opened,
    [panelForAlert(fixtures[0])],
    'clicking the listener-stripped row clone routes jumpToPanel(panelForAlert(alert)) via the delegate',
  );
  assert.equal(hide.calls(), 1, 'jumping closes the overlay');
  assert.deepEqual(acked, [], 'jumping must not acknowledge');

  happyWindow.document.removeEventListener('cb:open-panel', listener as EventListener);
  happyWindow.document.body.classList.remove('home-shell-active');
  hide.restore();
});

test('close button click hides via the root delegate after teardown', () => {
  fixtures = [makeAlert('al-4')];
  const { view, internals } = mount();
  view.show();
  internals.render();

  const hide = spyHide(view);
  const close = internals.overlay.querySelector<HTMLElement>('.today-view-close');
  assert.ok(close, 'close button re-rendered after teardown');

  // cloneNode(true) copies data-today-action="close" but DROPS any directly-bound
  // listener, so the clone can be serviced ONLY by the delegated listener on the
  // stable overlay — the definitive delegation-vs-per-render distinguisher. A
  // per-node regression would leave this click inert and the overlay open.
  const clone = (close as HTMLElement).cloneNode(true) as HTMLElement;
  (close as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.equal(hide.calls(), 1, 'close button routes hide() via the delegate');
});

test('a click on non-action chrome is ignored by the delegate', () => {
  acked.length = 0;
  fixtures = [makeAlert('al-5')];
  const { view, internals } = mount();
  view.show();

  const hide = spyHide(view);
  const label = internals.overlay.querySelector<HTMLElement>('.today-view-section h3');
  assert.ok(label, 'section label rendered');

  dispatchBubblingClick(label as Element);

  assert.equal(hide.calls(), 0, 'non-action chrome does not close');
  assert.deepEqual(acked, [], 'non-action chrome does not acknowledge');

  hide.restore();
});
