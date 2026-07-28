/**
 * NewsPanel related-asset + translate delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. renderClusters()
 * rebuilds the cluster list on every news refresh (formatTime() relative
 * timestamps defeat setContent's no-op guard, so the whole subtree is replaced).
 * The per-cluster "related asset" buttons and the per-item "translate" button
 * used to bind `click` directly on those per-render nodes (bindRelatedAssetEvents
 * ran after each rebuild), so a background refresh landing between pointerdown
 * and pointerup replaced the node and the browser never synthesized the click →
 * the button looked dead.
 *
 * The fix routes both button families through ONE delegated listener bound on the
 * stable content root in the constructor (Panel creates it once and never
 * replaces it): related-asset buttons carry `data-cluster-id`/`data-asset-id`/
 * `data-asset-type` (the asset re-resolved from `relatedAssetContext` at click
 * time), translate buttons carry `data-text`, both matched via
 * `target.closest(...)`. Only the mouseenter/mouseleave hover focus stays
 * per-render — hover isn't subject to the cross-render click-synthesis race.
 *
 * Runs with `tsx --import ./tests/panels/register-hook.mjs` because NewsPanel
 * extends Panel, whose import graph pulls Vite-only `?worker` / `ml-worker` /
 * i18n modules the loader-hook stubs out. The i18n stub pins getCurrentLanguage()
 * to 'en', so the real handleTranslate() early-returns; the translate test spies
 * the instance method to observe the delegate's routing directly. happy-dom
 * cannot reproduce WKWebView's cross-render click synthesis, so these tests lock
 * the delegation CONTRACT (data attributes + root handler that survives a rebuild
 * teardown) rather than the raw race.
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
// Synchronous rAF so any Panel-scheduled work runs inline.
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };

type RelatedAsset = import('@/types').RelatedAsset;
type RelatedAssetContext = import('@/types').RelatedAssetContext;

const { Panel } = await import('@/components/Panel.ts');
const { NewsPanel } = await import('@/components/NewsPanel.ts');

after(() => { Panel.stopHeartbeatTicker(); });

interface PanelInternals {
  relatedAssetContext: Map<string, RelatedAssetContext>;
  handleTranslate(element: HTMLElement, text: string): void;
  // Production markup builders. Driving the real string builders (rather than a
  // hand-rolled facsimile) is what makes this a faithful delegation regression:
  // if the production data-* contract drifts, these tests break. The cluster arg
  // is narrowed to { id } because relatedAssetsSection only reads cluster.id.
  translateButtonHtml(title: string): string;
  relatedAssetsSection(cluster: { id: string }, assetContext: RelatedAssetContext | null): string;
  getContentElement(): HTMLElement | null;
  destroy(): void;
}

function makeAsset(id: string): RelatedAsset {
  return { id, name: `Asset ${id}`, type: 'nuclear', distanceKm: 123 };
}

function makeContext(asset: RelatedAsset): RelatedAssetContext {
  return {
    origin: { label: 'Test Origin', lat: 41.6, lon: -86.7 },
    types: ['nuclear'],
    assets: [asset],
  };
}

/**
 * Inject a cluster card built from the PRODUCTION markup builders on the real
 * panel instance (relatedAssetsSection + translateButtonHtml), so the test
 * exercises the exact class names + datasets the delegate reads. If the
 * production data-* contract drifts, these tests break — that is the point: a
 * hand-rolled facsimile could silently diverge from the shipping markup and
 * still pass.
 *
 * The builder output is parsed via a Range fragment and swapped in with
 * replaceChildren — mirroring setContent's teardown, which is what used to
 * detach the per-render click listeners. createContextualFragment preserves
 * every data-* attribute and lets closest() resolve from a descendant span,
 * exactly as the live WKWebView HTML parse would.
 */
function injectClusterCard(
  internals: PanelInternals,
  content: HTMLElement,
  opts: { clusterId: string; context?: RelatedAssetContext | null; translateTitle?: string },
): void {
  const translate = opts.translateTitle !== undefined ? internals.translateButtonHtml(opts.translateTitle) : '';
  const related = internals.relatedAssetsSection({ id: opts.clusterId }, opts.context ?? null);
  const html = `<div class="item clustered" data-cluster-id="${opts.clusterId}">`
    + `<div class="cluster-meta">${translate}</div>${related}</div>`;
  const frag = happyWindow.document.createRange().createContextualFragment(html);
  content.replaceChildren(frag);
}

function mountPanel(): { internals: PanelInternals; content: HTMLElement } {
  const panel = new NewsPanel('news', 'News');
  const internals = panel as unknown as PanelInternals;
  const content = internals.getContentElement();
  assert.ok(content, 'panel content root exists');
  return { internals, content: content as HTMLElement };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('related-asset + translate buttons carry the delegated data contract', () => {
  const { internals, content } = mountPanel();
  const asset = makeAsset('a-1');
  injectClusterCard(internals, content, { clusterId: 'cl-1', context: makeContext(asset), translateTitle: 'Título' });

  const assetBtn = content.querySelector<HTMLElement>('.related-asset');
  assert.ok(assetBtn, 'related-asset button rendered');
  assert.equal(assetBtn?.dataset.clusterId, 'cl-1', 'related-asset carries data-cluster-id');
  assert.equal(assetBtn?.dataset.assetId, 'a-1', 'related-asset carries data-asset-id');
  assert.equal(assetBtn?.dataset.assetType, 'nuclear', 'related-asset carries data-asset-type');

  const translateBtn = content.querySelector<HTMLElement>('.item-translate-btn');
  assert.ok(translateBtn, 'translate button rendered');
  assert.equal(translateBtn?.dataset.text, 'Título', 'translate button carries data-text');

  internals.destroy();
});

test('related-asset click routes through the root delegate even after a rebuild teardown', () => {
  const { internals, content } = mountPanel();
  const asset = makeAsset('a-2');
  const context = makeContext(asset);
  internals.relatedAssetContext.set('cl-2', context);

  const clicks: RelatedAsset[] = [];
  (internals as unknown as { setRelatedAssetHandlers(o: { onRelatedAssetClick: (a: RelatedAsset) => void }): void })
    .setRelatedAssetHandlers({ onRelatedAssetClick: (a) => { clicks.push(a); } });

  // Render via the production builder, then a second render that replaces the
  // original button node — exactly the refresh teardown that swallowed
  // direct-bound clicks. The delegated listener lives on the stable content
  // root, so the fresh button still routes.
  injectClusterCard(internals, content, { clusterId: 'cl-2', context });
  injectClusterCard(internals, content, { clusterId: 'cl-2', context });

  // Swap the live button for a cloneNode(true) copy: clones carry the data-*
  // attributes but DROP directly-bound listeners, so the click can ONLY be
  // serviced by the delegated listener on the stable content root. This is the
  // definitive delegation-vs-per-render distinguisher — the OLD per-render impl
  // also re-bound on every render, so a plain re-render-then-click could not
  // tell the two apart; the listener-stripped clone can. A per-node regression
  // makes this click inert.
  const liveBtn = content.querySelector<HTMLElement>('.related-asset');
  assert.ok(liveBtn, 'related-asset button rendered');
  const clone = (liveBtn as HTMLElement).cloneNode(true) as HTMLElement;
  (liveBtn as HTMLElement).replaceWith(clone);

  // Click the inner label span of the clone, not the button itself: exercises
  // the delegate's target.closest('.related-asset') resolution from a descendant
  // of the listener-stripped clone.
  const nameSpan = clone.querySelector<HTMLElement>('.related-asset-name');
  assert.ok(nameSpan, 'related-asset label present inside the clone');
  assert.equal(clicks.length, 0, 'no click fired before dispatch');

  dispatchBubblingClick(nameSpan as Element);

  assert.deepEqual(
    clicks,
    [asset],
    'clicking the listener-stripped related-asset clone must re-resolve the asset and invoke the handler via the root delegate',
  );

  internals.destroy();
});

test('translate click routes through the root delegate even after a rebuild teardown', () => {
  const { internals, content } = mountPanel();

  // getCurrentLanguage() is pinned to 'en' by the i18n stub, so the real
  // handleTranslate() early-returns with nothing observable. Shadow it on the
  // instance to observe the delegate's routing + resolved data-text directly.
  const translated: Array<[HTMLElement, string]> = [];
  internals.handleTranslate = (element, text) => { translated.push([element, text]); };

  injectClusterCard(internals, content, { clusterId: 'cl-3', translateTitle: 'Nagłówek' });
  injectClusterCard(internals, content, { clusterId: 'cl-3', translateTitle: 'Nagłówek' });

  const liveBtn = content.querySelector<HTMLElement>('.item-translate-btn');
  assert.ok(liveBtn, 'translate button rendered');

  // cloneNode(true) drops the directly-bound listener a per-render regression
  // would attach, leaving only the root delegate to service the click. The
  // clone keeps the data-text attribute the delegate re-reads.
  const clone = (liveBtn as HTMLElement).cloneNode(true) as HTMLElement;
  (liveBtn as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.equal(translated.length, 1, 'delegate routed exactly one translate call');
  assert.equal(translated[0]?.[0], clone, 'delegate passed the clicked button element');
  assert.equal(translated[0]?.[1], 'Nagłówek', 'delegate passed the resolved data-text');

  internals.destroy();
});

test('a click on non-button cluster chrome is ignored by the delegate', () => {
  const { internals, content } = mountPanel();
  const asset = makeAsset('a-4');
  const context = makeContext(asset);
  internals.relatedAssetContext.set('cl-4', context);

  const clicks: RelatedAsset[] = [];
  const translated: Array<[HTMLElement, string]> = [];
  (internals as unknown as { setRelatedAssetHandlers(o: { onRelatedAssetClick: (a: RelatedAsset) => void }): void })
    .setRelatedAssetHandlers({ onRelatedAssetClick: (a) => { clicks.push(a); } });
  internals.handleTranslate = (element, text) => { translated.push([element, text]); };

  injectClusterCard(internals, content, { clusterId: 'cl-4', context, translateTitle: 'x' });

  const meta = content.querySelector<HTMLElement>('.cluster-meta');
  assert.ok(meta, 'cluster meta chrome rendered');
  dispatchBubblingClick(meta as Element);

  assert.equal(clicks.length, 0, 'non-button click leaves the related-asset handler untouched');
  assert.equal(translated.length, 0, 'non-button click leaves the translate handler untouched');

  internals.destroy();
});
