/**
 * GlobeHUD alert-list delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. renderAlertList()
 * clears the whole alert list and rebuilds every row on GodsVisionView's 100ms
 * updateState cadence. The per-row "fly to this event" click used to bind `click`
 * directly on those per-render nodes, so a background re-render landing between
 * pointerdown and pointerup replaced the node and the browser never synthesized
 * the click → the alert looked dead.
 *
 * The fix routes the fly-to through ONE delegated listener bound on the stable
 * alertListEl container in buildDOM (created once, never replaced): each clickable
 * row carries `data-alert-lat`/`data-alert-lon`/`data-alert-name`, re-read at click
 * time after `target.closest('.ge-hud-alert-clickable')`.
 *
 * Runs with `tsx --import ./tests/panels/register-hook.mjs` because GlobeHUD's
 * import graph pulls the Vite-only `import.meta.glob` in transitive i18n modules
 * that the loader-hook stubs out. happy-dom cannot reproduce WKWebView's
 * cross-render click synthesis, so these tests lock the delegation CONTRACT (data
 * attributes + root handler that survives a renderAlertList teardown) rather than
 * the raw race.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLDivElement = happyWindow.HTMLDivElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.HTMLSpanElement = happyWindow.HTMLSpanElement;
G.HTMLCanvasElement = happyWindow.HTMLCanvasElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.MouseEvent = happyWindow.MouseEvent;
G.CustomEvent = happyWindow.CustomEvent;
G.localStorage = happyWindow.localStorage;
G.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
// Synchronous rAF so any HUD-scheduled work runs inline.
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };

const { GlobeHUD } = await import('@/components/GlobeHUD.ts');

type AlertItem = { name: string; type: string; severity: number; lat?: number; lon?: number };

interface HudInternals {
  alertListEl: HTMLElement | null;
  renderAlertList(el: HTMLElement, alerts: AlertItem[]): void;
  destroy(): void;
}

const hudsToClean: Array<{ destroy(): void }> = [];
after(() => { for (const h of hudsToClean) h.destroy(); });

function mountHud(): { hud: InstanceType<typeof GlobeHUD>; internals: HudInternals; list: HTMLElement } {
  const container = happyWindow.document.createElement('div');
  happyWindow.document.body.appendChild(container);
  const hud = new GlobeHUD(container as unknown as HTMLElement);
  hudsToClean.push(hud);
  const internals = hud as unknown as HudInternals;
  assert.ok(internals.alertListEl, 'alert list root exists');
  return { hud, internals, list: internals.alertListEl as HTMLElement };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('positioned alert rows carry the delegated data-alert-* contract', () => {
  const { hud, internals, list } = mountHud();
  internals.renderAlertList(list, [
    { name: 'Quake M6.1', type: 'earthquake', severity: 3, lat: 35.2, lon: 139.7 },
  ]);

  const row = list.querySelector<HTMLElement>('.ge-hud-alert-clickable');
  assert.ok(row, 'clickable row rendered');
  assert.equal(row?.dataset.alertLat, '35.2', 'row carries data-alert-lat');
  assert.equal(row?.dataset.alertLon, '139.7', 'row carries data-alert-lon');
  assert.equal(row?.dataset.alertName, 'Quake M6.1', 'row carries data-alert-name');

  hud.destroy();
});

test('alert click flies to the event via the root delegate after a rebuild teardown', () => {
  const { hud, internals, list } = mountHud();
  const calls: Array<[number, number, string]> = [];
  hud.setOnAlertClick((lat, lon, name) => { calls.push([lat, lon, name]); });

  const alerts: AlertItem[] = [{ name: 'Tsunami warning', type: 'tsunami', severity: 4, lat: -12.5, lon: 130.8 }];
  // First render, then a second render that replaces the original row node —
  // exactly the 100ms-cadence teardown that swallowed direct-bound clicks. The
  // delegated listener lives on the stable alertListEl, so the fresh row routes.
  internals.renderAlertList(list, alerts);
  internals.renderAlertList(list, alerts);

  const row = list.querySelector<HTMLElement>('.ge-hud-alert-clickable');
  assert.ok(row, 'clickable row re-rendered after teardown');
  assert.equal(calls.length, 0, 'no fly-to fired before dispatch');

  // Swap the live row for a cloneNode(true) copy: clones carry the data-alert-*
  // attributes but DROP directly-bound listeners, so the click can ONLY be
  // serviced by the delegated listener on the stable alertListEl. This is the
  // definitive delegation-vs-per-render distinguisher — the OLD per-render impl
  // also re-bound on every render, so a plain re-render-then-click could not tell
  // the two apart; the listener-stripped clone can. A per-node regression makes
  // this click inert.
  const clone = (row as HTMLElement).cloneNode(true) as HTMLElement;
  (row as HTMLElement).replaceWith(clone);

  // Click the inner text span of the clone, not the row itself: this exercises
  // the delegate's target.closest('.ge-hud-alert-clickable') resolution from a
  // descendant of the listener-stripped clone.
  const text = clone.querySelector<HTMLElement>('.ge-alert-text');
  assert.ok(text, 'alert text present inside the row clone');

  dispatchBubblingClick(text as Element);

  assert.deepEqual(
    calls,
    [[-12.5, 130.8, 'Tsunami warning']],
    'clicking the listener-stripped row clone must re-read data-* and fly to the event via the root delegate',
  );

  hud.destroy();
});

test('an alert without coordinates is not clickable and the delegate ignores it', () => {
  const { hud, internals, list } = mountHud();
  const calls: unknown[] = [];
  hud.setOnAlertClick((lat, lon, name) => { calls.push([lat, lon, name]); });

  internals.renderAlertList(list, [{ name: 'Advisory (no geo)', type: 'advisory', severity: 1 }]);

  const row = list.querySelector<HTMLElement>('.ge-alert-row');
  assert.ok(row, 'row rendered');
  assert.equal(row?.classList.contains('ge-hud-alert-clickable'), false, 'non-positioned row is not clickable');
  assert.equal(row?.dataset.alertLat, undefined, 'no data-alert-lat on a non-positioned row');

  dispatchBubblingClick((row?.querySelector('.ge-alert-text') ?? row) as Element);
  assert.equal(calls.length, 0, 'clicking a non-positioned alert flies nowhere');

  hud.destroy();
});
