/**
 * ReasoningDebugOverlay control delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. render() rebuilds
 * the whole overlay card via replaceChildren(this.root, ...) on every debug write
 * (Events tab subscription) and every 2s (metrics/state/boot refresh). The header
 * close button, the tab buttons, and the events-tab clear/copy/verbosity buttons
 * used to bind `click` directly on those per-render nodes, so a background
 * re-render landing between pointerdown and pointerup replaced the node and the
 * browser never synthesized the click → the control looked dead.
 *
 * The fix routes every control through ONE delegated listener bound on the stable
 * `root` element in the constructor (created once, never replaced): each button
 * carries `data-rdo-action` (+ `data-rdo-tab` for tabs), resolved by
 * `target.closest('[data-rdo-action]')` at click time.
 *
 * NOTE: happy-dom cannot reproduce WKWebView's cross-render click synthesis, so
 * these tests lock the delegation CONTRACT (data attributes + root handler that
 * survives a render() teardown) rather than the raw race.
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
G.KeyboardEvent = happyWindow.KeyboardEvent;
G.localStorage = happyWindow.localStorage;

const { ReasoningDebugOverlay } = await import('../ReasoningDebugOverlay.ts');
const { getVerbosity, logDebug, dumpDebug } = await import('@/services/reasoning-debug');
const { recordLatency, getMetricsSnapshot, resetMetrics } = await import('@/services/reasoning-metrics');

interface OverlayInternals {
  root: HTMLElement;
  tab: string;
  render(): void;
}

/** Mount an overlay and force one render() of the default (events) tab. */
function mountOverlay(): { overlay: ReasoningDebugOverlay; internals: OverlayInternals } {
  const overlay = new ReasoningDebugOverlay();
  overlay.mount(happyWindow.document.body as unknown as HTMLElement);
  const internals = overlay as unknown as OverlayInternals;
  internals.render();
  return { overlay, internals };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('every overlay control carries the delegated data-rdo-action contract', () => {
  const { overlay, internals } = mountOverlay();
  const root = internals.root;

  const expectAction = (selector: string, action: string): void => {
    const btn = root.querySelector<HTMLElement>(selector);
    assert.ok(btn, `expected ${selector} to render`);
    assert.equal(btn?.dataset.rdoAction, action, `${selector} must delegate as ${action}`);
  };

  expectAction('.reasoning-debug-close', 'close');
  expectAction('[data-rdo-action="clear"]', 'clear');
  expectAction('[data-rdo-action="copy"]', 'copy');
  expectAction('[data-rdo-action="verbosity"]', 'verbosity');

  const tabs = root.querySelectorAll<HTMLElement>('.reasoning-debug-tab');
  assert.equal(tabs.length, 4, 'all four tab buttons render');
  for (const t of tabs) {
    assert.equal(t.dataset.rdoAction, 'tab', 'each tab button delegates as tab');
    assert.ok(t.dataset.rdoTab, 'each tab button carries data-rdo-tab');
  }

  overlay.destroy();
});

test('tab click is handled by the root delegate even after render() replaced the button', () => {
  const { overlay, internals } = mountOverlay();
  assert.equal(internals.tab, 'events', 'events tab is the default');

  // Reproduce the teardown that swallowed direct-bound clicks: a full re-render
  // detaches the original tab buttons. The delegated listener lives on root,
  // which persists, so a click on the freshly-rendered button still routes.
  internals.render();

  const metricsTab = internals.root.querySelector<HTMLElement>('[data-rdo-tab="metrics"]');
  assert.ok(metricsTab, 'metrics tab re-rendered after teardown');

  // Swap the live tab for a cloneNode(true) copy: clones carry data-* attributes
  // but DROP directly-bound listeners, so the click can ONLY be serviced by the
  // delegated root handler. This is the definitive delegation-vs-per-render
  // distinguisher — the OLD per-render impl also re-bound on every render, so a
  // plain re-render-then-click could not tell the two apart; the listener-
  // stripped clone can. A per-node regression makes this click inert.
  const clone = (metricsTab as HTMLElement).cloneNode(true) as HTMLElement;
  (metricsTab as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.equal(
    internals.tab,
    'metrics',
    'clicking the listener-stripped metrics-tab clone must switch tabs via the root delegate',
  );

  overlay.destroy();
});

test('verbosity click cycles the llm level through the root delegate after teardown', () => {
  const { overlay, internals } = mountOverlay();

  // Switch back to events tab (metrics may linger from a prior test in-file) and
  // re-render to reproduce the per-render teardown before clicking.
  internals.tab = 'events';
  internals.render();

  const before = getVerbosity().llm;
  const verbBtn = internals.root.querySelector<HTMLElement>('[data-rdo-action="verbosity"]');
  assert.ok(verbBtn, 'verbosity button re-rendered after teardown');

  // cloneNode(true) copies data-rdo-action but DROPS any directly-bound listener,
  // so the clone can be serviced ONLY by the delegated root handler — the
  // definitive delegation-vs-per-render distinguisher. If verbosity regressed to
  // a per-node addEventListener, this click would be inert and llm verbosity
  // would not cycle.
  const clone = (verbBtn as HTMLElement).cloneNode(true) as HTMLElement;
  (verbBtn as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.notEqual(
    getVerbosity().llm,
    before,
    'clicking the listener-stripped verbosity clone must cycle llm verbosity via the root delegate',
  );

  overlay.destroy();
});

test('reset-metrics click clears metrics through the root delegate, not a per-render listener', () => {
  const { overlay, internals } = mountOverlay();

  // The reset button lives on the metrics tab; render it so buildMetrics() runs.
  internals.tab = 'metrics';
  internals.render();

  const probe = 'deadclick-reset-probe';
  recordLatency(probe, 5);
  assert.ok(getMetricsSnapshot().latencies[probe], 'seeded latency sample is present');

  const resetBtn = internals.root.querySelector<HTMLElement>('[data-rdo-action="reset"]');
  assert.ok(resetBtn, 'reset-metrics button renders with the delegated action attr');
  assert.equal(resetBtn?.dataset.rdoAction, 'reset', 'reset button delegates as reset');

  // cloneNode(true) copies data-* attributes but DROPS any directly-bound
  // listener, so the clone can be serviced ONLY by the delegated root handler —
  // the definitive delegation-vs-per-render distinguisher. If reset regressed to
  // a per-node addEventListener, this click would be inert and the seeded sample
  // would survive.
  const clone = (resetBtn as HTMLElement).cloneNode(true) as HTMLElement;
  (resetBtn as HTMLElement).replaceWith(clone);
  dispatchBubblingClick(clone);

  assert.equal(
    getMetricsSnapshot().latencies[probe],
    undefined,
    'clicking the listener-stripped reset clone must clear metrics via the root delegate',
  );

  resetMetrics();
  overlay.destroy();
});

test('close click hides the overlay through the root delegate, not a per-render listener', () => {
  const { overlay, internals } = mountOverlay();

  // Represent an open overlay without starting show()'s 2s refresh interval
  // (which would dangle a timer). The delegate's close handler calls hide(),
  // which flips root.hidden back to true — that transition is what we assert.
  internals.root.hidden = false;

  const close = internals.root.querySelector<HTMLElement>('.reasoning-debug-close');
  assert.ok(close, 'close button rendered');

  // cloneNode(true) copies data-rdo-action but DROPS any directly-bound listener,
  // so the clone can be serviced ONLY by the delegated root handler — the
  // definitive delegation-vs-per-render distinguisher. A per-node regression
  // would leave this click inert and the overlay visible.
  const clone = (close as HTMLElement).cloneNode(true) as HTMLElement;
  (close as HTMLElement).replaceWith(clone);
  dispatchBubblingClick(clone);

  assert.equal(
    internals.root.hidden,
    true,
    'clicking the listener-stripped close clone must hide the overlay via the root delegate',
  );

  overlay.destroy();
});

test('clear click empties the debug ring through the root delegate, not a per-render listener', () => {
  const { overlay, internals } = mountOverlay();

  // Seed a known entry into the ring, then re-render so the clear button (events
  // tab) reflects a non-empty log. logDebug at info level on the 'events'
  // category clears the verbosity gate, so the entry is retained.
  const probe = 'deadclick-clear-probe';
  logDebug({ level: 'info', category: 'events', source: 'test', message: probe });
  internals.tab = 'events';
  internals.render();
  assert.ok(dumpDebug().some(e => e.message === probe), 'seeded entry is in the ring before clear');

  const clearBtn = internals.root.querySelector<HTMLElement>('[data-rdo-action="clear"]');
  assert.ok(clearBtn, 'clear button rendered');

  // Listener-stripped clone: only the delegated root handler can service it.
  const clone = (clearBtn as HTMLElement).cloneNode(true) as HTMLElement;
  (clearBtn as HTMLElement).replaceWith(clone);
  dispatchBubblingClick(clone);

  assert.ok(
    !dumpDebug().some(e => e.message === probe),
    'clicking the listener-stripped clear clone must empty the ring via the root delegate',
  );

  overlay.destroy();
});

test('copy click writes the debug dump to the clipboard through the root delegate', () => {
  const { overlay, internals } = mountOverlay();

  // Install a clipboard spy for the duration of this test only. The overlay
  // reads the bare global `navigator`, so we stub it on globalThis and restore
  // the original afterward to avoid perturbing other modules' navigator reads.
  const writes: string[] = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: (t: string): Promise<void> => { writes.push(t); return Promise.resolve(); } } },
    configurable: true,
    writable: true,
  });

  try {
    const probe = 'deadclick-copy-probe';
    logDebug({ level: 'info', category: 'events', source: 'test', message: probe });
    internals.tab = 'events';
    internals.render();

    const copyBtn = internals.root.querySelector<HTMLElement>('[data-rdo-action="copy"]');
    assert.ok(copyBtn, 'copy button rendered');

    // Listener-stripped clone: only the delegated root handler can service it.
    const clone = (copyBtn as HTMLElement).cloneNode(true) as HTMLElement;
    (copyBtn as HTMLElement).replaceWith(clone);
    dispatchBubblingClick(clone);

    assert.equal(writes.length, 1, 'copy invoked clipboard.writeText exactly once via the root delegate');
    assert.match(
      writes[0] ?? '',
      new RegExp(probe),
      'the clipboard payload is the JSON debug dump, so it contains the seeded entry',
    );
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'navigator');
  }

  overlay.destroy();
});
