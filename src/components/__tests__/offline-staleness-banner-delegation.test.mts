/**
 * Regression guards for the swallowed-click race: the banner retains its action
 * nodes across renders and resolves actions through one stable root listener.
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

  // Exercise the background refresh path that used to replace the action nodes.
  internals.render(staleState());

  const dismiss = internals.el.querySelector<HTMLElement>('.cb-osb-dismiss');
  assert.ok(dismiss, 'dismiss button remains after refresh');
  assert.equal(internals.dismissed, false, 'not dismissed before click');

  // A clone keeps data attributes but drops direct listeners, so only the stable
  // root delegate can service this click.
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

test('repeated renders retain the warning hierarchy and action nodes', () => {
  const { banner, internals } = mountStale();

  try {
    const label = internals.el.querySelector<HTMLElement>('.cb-osb-label');
    const subtext = internals.el.querySelector<HTMLElement>('.cb-osb-subtext');
    const reset = internals.el.querySelector<HTMLButtonElement>('[data-action="reset"]');
    const live = internals.el.querySelector<HTMLElement>('.cb-osb-live');
    assert.ok(label);
    assert.ok(subtext);
    assert.ok(reset);
    assert.ok(live);
    assert.equal(internals.el.getAttribute('role'), 'region');
    assert.equal(internals.el.hasAttribute('aria-live'), false);
    const firstAnnouncement = live.textContent;

    internals.render({ ...staleState(), bannerSubtext: 'Last updated 7h ago' });

    assert.ok(internals.el.querySelector('.cb-osb-label') === label, 'label node should be retained');
    assert.ok(internals.el.querySelector('.cb-osb-subtext') === subtext, 'timestamp node should be retained');
    assert.ok(internals.el.querySelector('[data-action="reset"]') === reset, 'reset node should be retained');
    assert.equal(subtext.textContent, 'Last updated 7h ago');
    assert.equal(live.textContent, firstAnnouncement, 'age-only refresh should not repeat the live announcement');
    assert.equal(reset.getAttribute('aria-label'), 'Clear cache and reload');
    assert.equal(reset.getAttribute('title'), 'Clear cache and reload');

    internals.render({
      ...staleState(),
      status: 'very-stale',
      bannerLabel: 'Data is very old',
      bannerSubtext: 'Last updated 8h ago',
    });
    assert.notEqual(live.textContent, firstAnnouncement, 'status escalation should be announced');
  } finally {
    banner.destroy();
  }
});

test('reset click clears browser caches before one reload via the root delegate', async () => {
  const { banner, internals } = mountStale();

  // Stub location.reload so the reset action is observable and harmless. It is a
  // prototype method, so we install an own-property spy on the instance and
  // remove it afterward to reveal the original.
  let reloads = 0;
  const calls: string[] = [];
  Object.defineProperty(happyWindow.location, 'reload', {
    value: () => { calls.push('reload'); reloads++; },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(happyWindow.navigator, 'serviceWorker', {
    value: {
      getRegistrations: async () => [{
        unregister: async () => { calls.push('unregister'); return true; },
      }],
    },
    configurable: true,
  });
  Object.defineProperty(happyWindow, 'caches', {
    value: {
      keys: async () => ['runtime-v1'],
      delete: async (key: string) => { calls.push(`delete:${key}`); return true; },
    },
    configurable: true,
  });

  try {
    // Exercise the background refresh path before the action.
    internals.render(staleState());

    const reset = internals.el.querySelector<HTMLButtonElement>('[data-action="reset"]');
    assert.ok(reset, 'reset button remains after refresh');

    // A clone keeps data-action but drops direct listeners, proving the action is
    // handled by the stable root delegate.
    const clone = reset.cloneNode(true) as HTMLButtonElement;
    reset.replaceWith(clone);
    dispatchBubblingClick(clone);

    assert.equal(clone.disabled, true, 'reset is disabled while cleanup runs');
    assert.equal(internals.el.getAttribute('aria-busy'), 'true');

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      reloads,
      1,
      'clicking the listener-stripped reset clone must reload the page via the root delegate',
    );
    assert.deepEqual(calls, ['unregister', 'delete:runtime-v1', 'reload']);
  } finally {
    delete (happyWindow.location as unknown as Record<string, unknown>).reload;
    delete (happyWindow.navigator as unknown as Record<string, unknown>).serviceWorker;
    delete (happyWindow as unknown as Record<string, unknown>).caches;
    banner.destroy();
  }
});
