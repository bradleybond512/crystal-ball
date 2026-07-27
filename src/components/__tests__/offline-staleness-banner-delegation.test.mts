/**
 * OfflineStalenessBanner action delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. render() rebuilds
 * the banner's inner row via el.replaceChildren() on every offline-state emit
 * (30s cadence + per-source updates). The Reset/Dismiss buttons used to bind
 * `click` directly on those per-render nodes, so a background emit landing
 * between pointerdown and pointerup replaced the node and the browser never
 * synthesized the click → the button looked completely dead.
 *
 * The fix routes both buttons through ONE delegated listener bound on the stable
 * `el` root in mount() (created once, never replaced): each button carries
 * `data-action`, and the action is resolved by `target.closest('[data-action]')`
 * at click time.
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
G.localStorage = happyWindow.localStorage;

const { OfflineStalenessBanner } = await import('../OfflineStalenessBanner.ts');

type OfflineState = import('@/services/offline-staleness').OfflineState;

interface BannerInternals {
  el: HTMLElement;
  dismissed: boolean;
  render(state: OfflineState): void;
}

function staleState(): OfflineState {
  return {
    isOnline: true,
    lastOnlineAt: 1_700_000_000_000,
    offlineDurationMs: 0,
    oldestCachedDataAgeMs: 6 * 60 * 60 * 1000,
    status: 'stale',
    bannerLabel: 'Data is getting old',
    bannerSubtext: 'Last updated 6h ago',
  };
}

/** Mount a banner, force a stale render, and expose internals. */
function mountStale(): { banner: OfflineStalenessBanner; internals: BannerInternals } {
  const banner = new OfflineStalenessBanner();
  banner.mount(happyWindow.document.body as unknown as HTMLElement);
  const internals = banner as unknown as BannerInternals;
  internals.render(staleState());
  return { banner, internals };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('reset + dismiss buttons carry the delegated data-action contract', () => {
  const { banner, internals } = mountStale();
  const el = internals.el;

  const reset = el.querySelector<HTMLElement>('.cb-osb-btn');
  assert.ok(reset, 'reset button rendered');
  assert.equal(reset?.dataset.action, 'reset', 'reset button must delegate as data-action="reset"');

  const dismiss = el.querySelector<HTMLElement>('.cb-osb-dismiss');
  assert.ok(dismiss, 'dismiss button rendered (stale is dismissible)');
  assert.equal(dismiss?.dataset.action, 'dismiss', 'dismiss button must delegate as data-action="dismiss"');

  banner.destroy();
});

test('dismiss click is serviced by the root delegate, not a per-render listener', () => {
  const { banner, internals } = mountStale();

  // First reproduce the teardown that swallowed direct-bound clicks: a second
  // render() detaches the original button via replaceChildren().
  internals.render(staleState());

  const dismiss = internals.el.querySelector<HTMLElement>('.cb-osb-dismiss');
  assert.ok(dismiss, 'dismiss button re-rendered after teardown');
  assert.equal(internals.dismissed, false, 'not dismissed before click');

  // Then swap the live button for a cloneNode(true) copy: clones carry data-*
  // attributes but DROP directly-bound listeners, so the click can ONLY be
  // serviced by the delegated listener on the stable `el` root. This is the
  // definitive delegation-vs-per-render distinguisher — the OLD implementation
  // also carried [data-action], so a plain re-render-then-click could not tell
  // the two apart; the listener-stripped clone can. A per-node regression would
  // make this click inert.
  const clone = (dismiss as HTMLElement).cloneNode(true) as HTMLElement;
  (dismiss as HTMLElement).replaceWith(clone);
  dispatchBubblingClick(clone);

  assert.equal(
    internals.dismissed,
    true,
    'clicking the listener-stripped dismiss clone must set dismissed via the root delegate',
  );
  assert.equal(internals.el.style.display, 'none', 'dismiss hides the banner');

  banner.destroy();
});

test('a click on empty banner chrome (no data-action) is ignored by the delegate', () => {
  const { banner, internals } = mountStale();

  // The icon span has no [data-action]; the delegate must no-op, not throw.
  const icon = internals.el.querySelector<HTMLElement>('.cb-osb-icon');
  assert.ok(icon, 'icon rendered');
  dispatchBubblingClick(icon as Element);

  assert.equal(internals.dismissed, false, 'non-action click leaves state untouched');

  banner.destroy();
});

test('reset click reloads via the root delegate, not a per-render listener', () => {
  const { banner, internals } = mountStale();

  // Stub location.reload so the reset action is observable and harmless. It is a
  // prototype method, so we install an own-property spy on the instance and
  // remove it afterward to reveal the original.
  let reloads = 0;
  Object.defineProperty(happyWindow.location, 'reload', {
    value: () => { reloads++; },
    configurable: true,
    writable: true,
  });

  try {
    // Reproduce the teardown that swallowed direct-bound clicks: a second
    // render() detaches the original button via replaceChildren().
    internals.render(staleState());

    const reset = internals.el.querySelector<HTMLElement>('.cb-osb-btn');
    assert.ok(reset, 'reset button re-rendered after teardown');

    // Swap the live button for a cloneNode(true) copy: clones carry data-action
    // but DROP directly-bound listeners, so the click can ONLY be serviced by the
    // delegated listener on the stable `el` root. A per-node regression would
    // leave this click inert and no reload would fire.
    const clone = (reset as HTMLElement).cloneNode(true) as HTMLElement;
    (reset as HTMLElement).replaceWith(clone);
    dispatchBubblingClick(clone);

    assert.equal(
      reloads,
      1,
      'clicking the listener-stripped reset clone must reload the page via the root delegate',
    );
  } finally {
    delete (happyWindow.location as unknown as Record<string, unknown>).reload;
  }

  banner.destroy();
});
