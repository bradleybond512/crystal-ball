/**
 * AnalystHUD hypothesis action-row delegation tests (happy-dom).
 *
 * Regression guard for the "Deep forecast won't activate — dead click" bug.
 * The per-hypothesis action buttons (thumbs / outcome / simulate / perspectives
 * / deep forecast / copy) used to bind `click` directly on their per-render DOM
 * nodes. render() tears the whole card down via replaceChildren on every one of
 * the HUD's ~16 subscriptions, so a background re-render landing between
 * pointerdown and pointerup orphaned the button and the browser never
 * synthesized the click → the button looked completely dead.
 *
 * The fix routes the whole action row through ONE delegated listener on the
 * stable `root` element (the pattern the file already used for close/EVOI/
 * analog): each button carries `data-hyp-action` + `data-hyp-id`, and the
 * hypothesis is re-resolved by id at click time.
 *
 * NOTE: jsdom/happy-dom cannot reproduce WKWebView's cross-render click
 * synthesis, so these tests lock the delegation CONTRACT (data attributes +
 * root handler that survives a render() teardown) rather than the raw race.
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
G.HTMLInputElement = happyWindow.HTMLInputElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.HTMLSpanElement = happyWindow.HTMLSpanElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.MouseEvent = happyWindow.MouseEvent;
G.CustomEvent = happyWindow.CustomEvent;
G.KeyboardEvent = happyWindow.KeyboardEvent;
G.localStorage = happyWindow.localStorage;
// Synchronous rAF so scheduleRender()/render() runs inline in the test.
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };

const { AnalystHUD } = await import('../AnalystHUD.ts');
type AnalystSnapshot = import('@/services/analyst-loop').AnalystSnapshot;
type Hypothesis = import('@/services/analyst-loop').Hypothesis;

interface HudInternals {
  root: HTMLElement;
  snapshot: AnalystSnapshot | null;
  render(): void;
  loadingSuperforecast: Set<string>;
}

function makeHypothesis(id: string): Hypothesis {
  return {
    id,
    kind: 'cross-domain-cluster',
    statement: 'Test hypothesis for delegation coverage.',
    confidence: 0.8,
    risk: 'high',
    evidence: [],
    timestamp: 1_700_000_000_000,
  };
}

function makeSnapshot(id: string): AnalystSnapshot {
  return { timestamp: 1_700_000_000_000, hypotheses: [makeHypothesis(id)], aiEnriched: false };
}

/** Mount an HUD, inject a one-hypothesis snapshot, and force a render. */
function mountWithHypothesis(id: string): { hud: unknown; internals: HudInternals } {
  const hud = new AnalystHUD();
  hud.mount(happyWindow.document.body as unknown as HTMLElement);
  const internals = hud as unknown as HudInternals;
  internals.snapshot = makeSnapshot(id);
  internals.render();
  return { hud, internals };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('every hypothesis action button carries the delegated data-hyp-action contract', () => {
  const { hud, internals } = mountWithHypothesis('h-contract');
  const root = internals.root;

  const expectAction = (selector: string, action: string): void => {
    const btn = root.querySelector<HTMLElement>(selector);
    assert.ok(btn, `expected ${selector} to render`);
    assert.equal(btn?.dataset.hypAction, action, `${selector} must delegate as ${action}`);
    assert.equal(btn?.dataset.hypId, 'h-contract', `${selector} must carry the hypothesis id`);
  };

  // The reported button plus every sibling that shared the same latent race.
  expectAction('.analyst-hud-superforecast-btn', 'superforecast');
  expectAction('.analyst-hud-ensemble-btn', 'ensemble');
  expectAction('.analyst-hud-sim-btn', 'simulate');
  expectAction('.analyst-hud-copy-btn', 'copy');

  const thumbs = root.querySelectorAll<HTMLElement>('.analyst-hud-thumb');
  assert.equal(thumbs.length, 2, 'both thumb buttons render');
  assert.equal(thumbs[0]?.dataset.hypAction, 'thumbs-up');
  assert.equal(thumbs[1]?.dataset.hypAction, 'thumbs-down');

  const outcomes = root.querySelectorAll<HTMLElement>('.analyst-hud-outcome');
  assert.equal(outcomes.length, 2, 'both outcome buttons render');
  assert.equal(outcomes[0]?.dataset.hypAction, 'outcome-confirmed');
  assert.equal(outcomes[1]?.dataset.hypAction, 'outcome-wrong');

  (hud as { destroy(): void }).destroy();
});

test('deep-forecast click is handled by the root delegate even after render() replaced the button', () => {
  const { hud, internals } = mountWithHypothesis('h-deadclick');

  // Reproduce the teardown that swallowed direct-bound clicks: a full re-render
  // detaches the original button node. The delegated listener lives on root,
  // which persists, so a click on the freshly-rendered button still routes.
  internals.render();

  const btn = internals.root.querySelector<HTMLElement>('.analyst-hud-superforecast-btn');
  assert.ok(btn, 'deep-forecast button re-rendered after teardown');
  assert.equal(internals.loadingSuperforecast.has('h-deadclick'), false, 'not loading before click');

  dispatchBubblingClick(btn as Element);

  // The delegated handler ran toggleOrRunSuperforecast → un-cached path adds the
  // loading marker synchronously. Direct binding would have been orphaned here.
  assert.equal(
    internals.loadingSuperforecast.has('h-deadclick'),
    true,
    'clicking the post-teardown deep-forecast button must drive the superforecast path via the root delegate',
  );

  (hud as { destroy(): void }).destroy();
});
