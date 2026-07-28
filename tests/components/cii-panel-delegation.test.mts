/**
 * CIIPanel share-button delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. refresh() clears
 * and rebuilds the whole country list (replaceChildren on this.content) on every
 * watchlist change and on the panel refresh cadence. The per-country "share"
 * button used to bind `click` directly on those per-render nodes (bindShareButtons
 * ran after each replaceChildren), so a background refresh landing between
 * pointerdown and pointerup replaced the node and the browser never synthesized
 * the click -> the share button looked dead.
 *
 * The fix routes the share button through ONE delegated listener bound on the
 * stable content root in the constructor (Panel creates it once and never
 * replaces it): each button carries `data-code`/`data-name`, resolved by
 * `target.closest('.cii-share-btn')` at click time.
 *
 * Runs with `tsx --import ./tests/panels/register-hook.mjs` because CIIPanel
 * extends Panel, whose import graph pulls Vite-only `?worker` / `ml-worker`
 * modules the loader-hook stubs out. The test drives buildCountry() straight into
 * the stable content root (calculateCII() reads global focal-point state that is
 * awkward to seed) and reproduces the teardown with replaceChildren, mirroring
 * refresh()'s DOM shape. happy-dom cannot reproduce WKWebView's cross-render click
 * synthesis, so these tests lock the delegation CONTRACT.
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
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.MouseEvent = happyWindow.MouseEvent;
G.CustomEvent = happyWindow.CustomEvent;
G.localStorage = happyWindow.localStorage;
G.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };

type CountryScore = import('@/services/country-instability').CountryScore;

const { Panel } = await import('@/components/Panel.ts');
const { CIIPanel } = await import('@/components/CIIPanel.ts');

after(() => { Panel.stopHeartbeatTicker(); });

interface PanelInternals {
  buildCountry(country: CountryScore): HTMLElement;
  getContentElement(): HTMLElement | null;
  destroy(): void;
}

function makeCountry(code: string): CountryScore {
  return {
    code,
    name: `Country ${code}`,
    score: 63,
    level: 'high',
    trend: 'rising',
    change24h: 4,
    components: { unrest: 60, conflict: 55, security: 40, information: 70 },
    lastUpdated: new Date(1_700_000_000_000),
    staleSources: [],
    incompleteAssessment: false,
  };
}

/** Mirror refresh()'s DOM shape: a .cii-list wrapping buildCountry rows, swapped
 *  in via replaceChildren (the teardown that used to swallow direct clicks). */
function renderCountries(internals: PanelInternals, content: HTMLElement, countries: CountryScore[]): void {
  const list = happyWindow.document.createElement('div');
  list.className = 'cii-list';
  for (const c of countries) list.appendChild(internals.buildCountry(c));
  content.replaceChildren(list);
}

function mountPanel(): { internals: PanelInternals; content: HTMLElement; shares: Array<[string, string]> } {
  const panel = new CIIPanel();
  const shares: Array<[string, string]> = [];
  panel.setShareStoryHandler((code, name) => { shares.push([code, name]); });
  const internals = panel as unknown as PanelInternals;
  const content = internals.getContentElement();
  assert.ok(content, 'panel content root exists');
  return { internals, content: content as HTMLElement, shares };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('the share button carries the delegated data-code/data-name contract', () => {
  const { internals, content } = mountPanel();
  renderCountries(internals, content, [makeCountry('US')]);

  const btn = content.querySelector<HTMLElement>('.cii-share-btn');
  assert.ok(btn, 'share button rendered');
  assert.equal(btn?.dataset.code, 'US', 'share button carries data-code');
  assert.equal(btn?.dataset.name, 'Country US', 'share button carries data-name');

  internals.destroy();
});

test('share click routes through the root delegate even after a refresh() teardown', () => {
  const { internals, content, shares } = mountPanel();

  // First render, then a second render that replaces the original button node —
  // exactly the teardown that swallowed direct-bound clicks. The delegated
  // listener lives on the stable content root, so the fresh button still routes.
  renderCountries(internals, content, [makeCountry('FR')]);
  renderCountries(internals, content, [makeCountry('FR')]);

  const btn = content.querySelector<HTMLElement>('.cii-share-btn');
  assert.ok(btn, 'share button re-rendered after teardown');
  assert.equal(shares.length, 0, 'no share fired before click');

  // Swap the live button for a cloneNode(true) copy: clones carry the
  // data-code/data-name attributes but DROP directly-bound listeners, so the
  // click can ONLY be serviced by the delegated listener on the stable content
  // root. This is the definitive delegation-vs-per-render distinguisher — the
  // OLD bindShareButtons() impl re-bound on every render, so a plain
  // re-render-then-click could not tell the two apart; the listener-stripped
  // clone can. A per-node regression makes this click inert.
  const clone = (btn as HTMLElement).cloneNode(true) as HTMLElement;
  (btn as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.deepEqual(
    shares,
    [['FR', 'Country FR']],
    'clicking the listener-stripped share clone must invoke the handler via the root delegate',
  );

  internals.destroy();
});

test('a click on non-share card chrome is ignored by the delegate', () => {
  const { internals, content, shares } = mountPanel();
  renderCountries(internals, content, [makeCountry('DE')]);

  const name = content.querySelector<HTMLElement>('.cii-name');
  assert.ok(name, 'country name rendered');
  dispatchBubblingClick(name as Element);

  assert.equal(shares.length, 0, 'non-share click leaves the handler untouched');

  internals.destroy();
});

test('share click stops propagation; non-action clicks still bubble past the content root', () => {
  const { internals, content, shares } = mountPanel();

  // Reparent the content root under an ancestor we control so we can observe
  // whether the click bubbles past it. The delegated listener stays bound to
  // `content` (listeners survive a DOM move).
  const parent = happyWindow.document.createElement('div');
  happyWindow.document.body.appendChild(parent);
  parent.appendChild(content);

  let ancestorClicks = 0;
  parent.addEventListener('click', () => { ancestorClicks++; });

  renderCountries(internals, content, [makeCountry('JP')]);

  const btn = content.querySelector<HTMLElement>('.cii-share-btn');
  assert.ok(btn, 'share button rendered');
  dispatchBubblingClick(btn as Element);
  assert.equal(shares.length, 1, 'share handler fired via the delegate');
  assert.equal(
    ancestorClicks,
    0,
    'the share delegate calls stopPropagation, so the click never reaches the ancestor',
  );

  // Contrast: a click on non-action chrome takes the delegate's early return
  // (no stopPropagation), so it bubbles to the ancestor — proving the harness
  // actually observes propagation and the zero above is meaningful.
  const name = content.querySelector<HTMLElement>('.cii-name');
  assert.ok(name, 'country name rendered');
  dispatchBubblingClick(name as Element);
  assert.equal(shares.length, 1, 'non-action click fires no share');
  assert.equal(ancestorClicks, 1, 'non-action click bubbles past the content root to the ancestor');

  internals.destroy();
});
