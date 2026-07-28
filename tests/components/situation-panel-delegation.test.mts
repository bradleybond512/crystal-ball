/**
 * SituationPanel card delegation tests (happy-dom).
 *
 * Regression guard for the swallowed-click ("dead click") race. render() clears
 * and rebuilds the whole card list on every situation-engine notify (signal
 * ingestion + 5-min reassess). The per-card "show on map" button, the header
 * expand toggle, the verification badge, and the per-action "dismiss" button used
 * to bind `click` directly on those per-render nodes, so a background re-render
 * landing between pointerdown and pointerup replaced the node and the browser
 * never synthesized the click -> the control looked dead.
 *
 * The fix routes every card interaction through ONE delegated listener bound on
 * the stable content root in the constructor (Panel creates it once and never
 * replaces it): cards carry `data-sit-id`, dismiss buttons carry `data-act-id`,
 * and both the situation and the action are re-resolved by id at click time via
 * `target.closest(...)`.
 *
 * Runs with `tsx --import ./tests/panels/register-hook.mjs` because SituationPanel
 * extends Panel, whose import graph pulls Vite-only `?worker` / `ml-worker`
 * modules the loader-hook stubs out. happy-dom cannot reproduce WKWebView's
 * cross-render click synthesis, so these tests lock the delegation CONTRACT (data
 * attributes + root handler that survives a render() teardown) rather than the
 * raw race.
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
// Synchronous rAF so any Panel-scheduled work runs inline.
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };

type Situation = import('@/services/situation-types').Situation;

const { situationEngine } = await import('@/services/situation-engine');
const { Panel } = await import('@/components/Panel.ts');

// Stub the engine so constructing the panel starts no timers and reads our
// fixtures. Own-property assignment shadows the prototype methods.
let fixtures: Situation[] = [];
const engineStub = situationEngine as unknown as Record<string, unknown>;
engineStub.subscribe = () => () => { /* noop unsub */ };
engineStub.start = () => { /* no timers in tests */ };
engineStub.stop = () => { /* noop */ };
engineStub.getSituations = () => fixtures;
engineStub.getActiveCount = () => fixtures.length;

const { SituationPanel } = await import('@/components/SituationPanel.ts');

after(() => { Panel.stopHeartbeatTicker(); });

interface PanelInternals {
  _expandedSitId: string | null;
  render(): void;
  getContentElement(): HTMLElement | null;
  destroy(): void;
}

function makeSituation(id: string): Situation {
  return {
    id,
    title: 'Test situation',
    summary: 'A correlated cluster for delegation coverage.',
    phase: 'active',
    domain: 'compound',
    confidence: 0.72,
    geo: { lat: 41.6, lon: -86.7, label: 'La Porte, IN', countries: ['US'], radiusKm: 50 },
    signalIds: ['sig-1'],
    signals: [
      { id: 'sig-1', type: 'weather_alert', title: 'Signal', confidence: 0.7, timestamp: 1_700_000_000_000, domain: 'natural_hazard' },
    ],
    domainDiversity: 1,
    evidence: null,
    scenarios: [],
    actions: [
      {
        id: 'act-1', headline: 'Do the thing', rationale: 'Because reasons',
        urgency: 'soon', category: 'physical_safety', steps: ['step one'],
        situationId: id, scenarioId: null, dismissed: false,
      },
    ],
    causalChainId: null,
    firstSeen: 1_700_000_000_000,
    lastUpdated: 1_700_000_000_000,
    reassessmentCount: 0,
  };
}

function mountPanel(sits: Situation[]): { panel: unknown; internals: PanelInternals; content: HTMLElement } {
  fixtures = sits;
  const panel = new SituationPanel();
  const internals = panel as unknown as PanelInternals;
  const content = internals.getContentElement();
  assert.ok(content, 'panel content root exists');
  return { panel, internals, content: content as HTMLElement };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('situation cards + actions carry the delegated id contract', () => {
  const { internals, content } = mountPanel([makeSituation('sit-c')]);
  // Expand so the action list (and its dismiss button) renders.
  internals._expandedSitId = 'sit-c';
  internals.render();

  const card = content.querySelector<HTMLElement>('.sit-card');
  assert.ok(card, 'card rendered');
  assert.equal(card?.dataset.sitId, 'sit-c', 'card carries data-sit-id');

  assert.ok(content.querySelector('.sit-header'), 'header rendered (expand target)');
  assert.ok(content.querySelector('.sit-map-btn'), 'map button rendered (geo is non-zero)');

  const dismiss = content.querySelector<HTMLElement>('.sit-act-dismiss');
  assert.ok(dismiss, 'action dismiss button rendered while expanded');
  assert.equal(dismiss?.dataset.actId, 'act-1', 'dismiss button carries data-act-id');

  internals.destroy();
});

test('header click toggles expand via the root delegate even after render() replaced the card', () => {
  const { internals, content } = mountPanel([makeSituation('sit-d')]);
  assert.equal(internals._expandedSitId, null, 'starts collapsed');

  // Reproduce the teardown that swallowed direct-bound clicks: a full re-render
  // detaches the original header. The delegated listener lives on the content
  // root, which persists, so a click still routes.
  internals.render();

  const header = content.querySelector<HTMLElement>('.sit-header');
  assert.ok(header, 'header re-rendered after teardown');

  // Swap the live header for a cloneNode(true) copy: clones carry data-*
  // attributes but DROP directly-bound listeners, so the click can ONLY be
  // serviced by the delegated listener on the stable content root. This is the
  // definitive delegation-vs-per-render distinguisher — the OLD per-render impl
  // also re-bound on every render, so a plain re-render-then-click could not
  // tell the two apart; the listener-stripped clone can. The clone stays inside
  // the .sit-card (which still carries data-sit-id), so closest() re-resolves
  // the situation at click time. A per-node regression makes this click inert.
  const clone = (header as HTMLElement).cloneNode(true) as HTMLElement;
  (header as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.equal(
    internals._expandedSitId,
    'sit-d',
    'clicking the listener-stripped header clone must expand the situation via the root delegate',
  );

  internals.destroy();
});

test('dismiss click marks the action dismissed via the root delegate after teardown', () => {
  const sit = makeSituation('sit-x');
  const { internals, content } = mountPanel([sit]);
  internals._expandedSitId = 'sit-x';
  internals.render();

  const dismiss = content.querySelector<HTMLElement>('.sit-act-dismiss');
  assert.ok(dismiss, 'dismiss button rendered after teardown');
  assert.equal(sit.actions[0]?.dismissed, false, 'action not dismissed before click');

  // Swap the live dismiss button for a cloneNode(true) copy: clones carry the
  // data-act-id attribute but DROP directly-bound listeners, so the click can
  // ONLY be serviced by the delegated listener on the stable content root. This
  // is the definitive delegation-vs-per-render distinguisher — the OLD per-render
  // impl also re-bound on every render, so a plain re-render-then-click could not
  // tell the two apart; the listener-stripped clone can. The clone stays inside
  // the .sit-card (which still carries data-sit-id), so closest() re-resolves the
  // situation + action at click time. A per-node regression makes this inert.
  const clone = (dismiss as HTMLElement).cloneNode(true) as HTMLElement;
  (dismiss as HTMLElement).replaceWith(clone);

  dispatchBubblingClick(clone);

  assert.equal(
    sit.actions[0]?.dismissed,
    true,
    'clicking the listener-stripped dismiss clone must mark the action dismissed via the root delegate',
  );
  assert.equal(
    content.querySelector('.sit-act-dismiss'),
    null,
    'the dismissed action is filtered out of the re-render',
  );

  internals.destroy();
});

test('map / verif / dismiss controls stop propagation; the header toggle bubbles', () => {
  const sit = makeSituation('sit-prop');
  // Set verification details so the verif badge (a stopPropagation control)
  // actually renders — the default fixture omits them.
  sit.verificationDetails = {
    independentSources: 3,
    temporalCorroboration: true,
    crossDomainVerified: true,
    hasContradictions: false,
    freshnessScore: 0.9,
    overallVerdict: 'verified',
  };
  const { internals, content } = mountPanel([sit]);
  internals._expandedSitId = 'sit-prop'; // expand so the dismiss button renders
  internals.render();

  // Reparent the content root under an ancestor we control so we can observe
  // whether a click bubbles past it. render() only rebuilds content's children,
  // never content itself, so this reparent survives every re-render below.
  const parent = happyWindow.document.createElement('div');
  happyWindow.document.body.appendChild(parent);
  parent.appendChild(content);

  let ancestorClicks = 0;
  parent.addEventListener('click', () => { ancestorClicks++; });

  // Observe the map-focus side effect so we assert the delegate DID something,
  // not merely that a click failed to bubble (which an inert delegate would also
  // satisfy). focusOnMap() dispatches wm:focus-situation on document.
  let focusDetail: { situationId?: string } | null = null;
  const onFocus = (e: Event): void => {
    focusDetail = (e as CustomEvent<{ situationId?: string }>).detail ?? null;
  };
  happyWindow.document.addEventListener('wm:focus-situation', onFocus);

  // Map button previously stopped propagation to beat the header toggle. Click a
  // listener-stripped cloneNode(true) copy (drops any per-render listener a
  // regression would re-attach, keeps the class so closest() still resolves the
  // control + the card's data-sit-id) so this asserts the delegate's
  // stopPropagation, not a per-node handler's.
  const mapBtn = content.querySelector<HTMLElement>('.sit-map-btn');
  assert.ok(mapBtn, 'map button rendered (geo is non-zero)');
  const mapClone = (mapBtn as HTMLElement).cloneNode(true) as HTMLElement;
  (mapBtn as HTMLElement).replaceWith(mapClone);
  dispatchBubblingClick(mapClone);
  assert.equal(ancestorClicks, 0, 'map button stops propagation — click never reaches the ancestor');
  assert.ok(focusDetail, 'map button dispatched wm:focus-situation — the delegate acted');
  assert.equal(
    (focusDetail as { situationId?: string }).situationId,
    'sit-prop',
    'the focus event targets the clicked situation',
  );

  // Verification badge also stops propagation. Clicking it toggles expand to
  // null (it started at 'sit-prop') and re-renders, so re-expand afterwards to
  // reach the dismiss button. Asserting the toggle proves the delegate acted.
  const verif = content.querySelector<HTMLElement>('.sit-verif-badge');
  assert.ok(verif, 'verification badge rendered');
  const verifClone = (verif as HTMLElement).cloneNode(true) as HTMLElement;
  (verif as HTMLElement).replaceWith(verifClone);
  dispatchBubblingClick(verifClone);
  assert.equal(ancestorClicks, 0, 'verification badge stops propagation');
  assert.equal(
    internals._expandedSitId,
    null,
    'verification badge click toggled the expanded situation off — the delegate acted',
  );

  happyWindow.document.removeEventListener('wm:focus-situation', onFocus);

  internals._expandedSitId = 'sit-prop';
  internals.render();
  const dismiss = content.querySelector<HTMLElement>('.sit-act-dismiss');
  assert.ok(dismiss, 'dismiss button rendered while expanded');
  const dismissClone = (dismiss as HTMLElement).cloneNode(true) as HTMLElement;
  (dismiss as HTMLElement).replaceWith(dismissClone);
  dispatchBubblingClick(dismissClone);
  assert.equal(ancestorClicks, 0, 'dismiss button stops propagation');

  // The header toggle does NOT stopPropagation — clicking the title (a header
  // child that is not the map button) bubbles to the ancestor, proving the
  // harness observes propagation and the three zeros above are meaningful.
  const title = content.querySelector<HTMLElement>('.sit-title');
  assert.ok(title, 'title rendered');
  dispatchBubblingClick(title as Element);
  assert.equal(ancestorClicks, 1, 'header toggle click bubbles past the content root to the ancestor');

  internals.destroy();
});
