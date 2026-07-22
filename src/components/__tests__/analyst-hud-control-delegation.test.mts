/**
 * AnalystHUD auxiliary-control delegation tests (happy-dom).
 *
 * Companion to analyst-hud-action-delegation.test.mts. PR #1501 migrated the
 * hypothesis *action row* onto the stable `root` delegate to kill a swallowed
 * "dead click" race. Several sibling controls in the same HUD shared the
 * identical latent race — their `click` handlers were bound directly on nodes
 * that render() destroys via replaceChildren on every one of the HUD's ~16
 * subscriptions, so a background re-render landing between pointerdown and
 * pointerup orphaned the node and the browser never synthesized the click.
 *
 * These lock the delegated CONTRACT (data attributes + a root-handler branch
 * that survives a render() teardown) for each migrated control:
 *   - .analyst-hud-skeptic-toggle       → data-skeptic-toggle      = note.signature
 *   - .analyst-hud-alternatives-toggle  → data-alternatives-toggle = view.signature
 *   - .analyst-hud-evidence-chip        → data-evidence-panel / -id / -source
 *   - .analyst-hud-question-chip        → data-question-hyp-id + data-question-text
 *   - .analyst-hud-scrubber-live        → data-scrubber-live
 *
 * Same happy-dom caveat as the action-row suite: jsdom/happy-dom cannot
 * reproduce WKWebView's cross-render click synthesis, so these lock the
 * delegation contract rather than the raw pointerdown/pointerup race.
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

// Seed the localStorage-backed stores BEFORE the first render triggers their
// lazy, once-only load(). signatureFor() ignores the hypothesis id — every
// test hypothesis that carries no evidence + no region resolves to the same
// `${kind}||*` signature, so ONE seeded skeptic note + ONE alternative view
// cover all of them regardless of id.
const SEED_SIGNATURE = 'cross-domain-cluster||*';
happyWindow.localStorage.setItem(
  'crystalball-skeptic-notes-v1',
  JSON.stringify({
    [SEED_SIGNATURE]: {
      signature: SEED_SIGNATURE,
      hypothesisId: 'seed',
      generatedAt: 1_700_000_000_000,
      summary: 'Skeptic summary long enough to render a collapsible toggle label for the delegation contract.',
      text: 'Full skeptic critique body used when the toggle is expanded.',
    },
  }),
);
happyWindow.localStorage.setItem(
  'crystalball-hypothesis-alternatives-v1',
  JSON.stringify({
    [SEED_SIGNATURE]: {
      signature: SEED_SIGNATURE,
      hypothesisId: 'seed',
      generatedAt: 1_700_000_000_000,
      alternative: 'An alternative explanation seeded for the delegation contract test.',
      alternativeConfidence: 0.4,
      premortem: 'Pre-mortem body seeded for the delegation contract test.',
    },
  }),
);
// Two archived snapshots so buildReplayScrubber() renders its live button.
const SNAP_A = 1_700_000_000_000;
const SNAP_B = 1_700_000_300_000;
happyWindow.localStorage.setItem(
  'crystalball-snapshot-archive-v1',
  JSON.stringify([
    { timestamp: SNAP_A, hypotheses: [], aiEnriched: false },
    { timestamp: SNAP_B, hypotheses: [], aiEnriched: false },
  ]),
);

const { AnalystHUD } = await import('../AnalystHUD.ts');
type AnalystSnapshot = import('@/services/analyst-loop').AnalystSnapshot;
type Hypothesis = import('@/services/analyst-loop').Hypothesis;
type HypothesisEvidence = import('@/services/analyst-loop').HypothesisEvidence;

interface HudInternals {
  root: HTMLElement;
  snapshot: AnalystSnapshot | null;
  render(): void;
  visible: boolean;
  expandedSkeptic: Set<string>;
  expandedAlternative: Set<string>;
  loadingQuestion: Set<string>;
  replayAtTimestamp: number | null;
}

function makeHypothesis(id: string, evidence: HypothesisEvidence[] = []): Hypothesis {
  return {
    id,
    kind: 'cross-domain-cluster',
    statement: 'Test hypothesis for control delegation coverage.',
    confidence: 0.8,
    risk: 'high',
    evidence,
    timestamp: 1_700_000_000_000,
  };
}

function makeSnapshot(id: string, evidence: HypothesisEvidence[] = []): AnalystSnapshot {
  return { timestamp: 1_700_000_000_000, hypotheses: [makeHypothesis(id, evidence)], aiEnriched: false };
}

/** Mount an HUD, inject a one-hypothesis snapshot, and force a render. */
function mountWithHypothesis(
  id: string,
  evidence: HypothesisEvidence[] = [],
): { hud: unknown; internals: HudInternals } {
  const hud = new AnalystHUD();
  hud.mount(happyWindow.document.body as unknown as HTMLElement);
  const internals = hud as unknown as HudInternals;
  internals.snapshot = makeSnapshot(id, evidence);
  internals.render();
  return { hud, internals };
}

function dispatchBubblingClick(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

const evidenceRow = (): HypothesisEvidence[] => [
  { source: 'unified-alerts', id: 'ev-1', label: 'Evidence label for the chip', panelId: 'unified-alerts' },
];

test('skeptic + alternatives toggles carry the delegated signature contract', () => {
  const { hud, internals } = mountWithHypothesis('h-contract');
  const root = internals.root;

  const skeptic = root.querySelector<HTMLElement>('.analyst-hud-skeptic-toggle');
  assert.ok(skeptic, 'skeptic toggle renders when a note exists');
  assert.equal(skeptic?.dataset.skepticToggle, SEED_SIGNATURE, 'skeptic toggle delegates by note signature');

  const alt = root.querySelector<HTMLElement>('.analyst-hud-alternatives-toggle');
  assert.ok(alt, 'alternatives toggle renders when a view exists');
  assert.equal(alt?.dataset.alternativesToggle, SEED_SIGNATURE, 'alternatives toggle delegates by view signature');

  (hud as { destroy(): void }).destroy();
});

test('evidence chip carries the delegated panel/id/source contract', () => {
  const { hud, internals } = mountWithHypothesis('h-evidence', evidenceRow());
  const chip = internals.root.querySelector<HTMLElement>('.analyst-hud-evidence-chip');
  assert.ok(chip, 'evidence chip renders for evidence with a panelId');
  assert.equal(chip?.dataset.evidencePanel, 'unified-alerts', 'chip carries the panel id to jump to');
  assert.equal(chip?.dataset.evidenceId, 'ev-1', 'chip carries the evidence id for hypothesis re-resolution');
  assert.equal(chip?.dataset.evidenceSource, 'unified-alerts', 'chip carries the evidence source');
  (hud as { destroy(): void }).destroy();
});

test('question chip carries the delegated hyp-id + question-text contract', () => {
  const { hud, internals } = mountWithHypothesis('h-question');
  const chip = internals.root.querySelector<HTMLElement>('.analyst-hud-question-chip');
  assert.ok(chip, 'a question chip always renders (heuristic fallback)');
  assert.equal(chip?.dataset.questionHypId, 'h-question', 'chip carries the hypothesis id');
  assert.ok((chip?.dataset.questionText ?? '').length > 0, 'chip carries the question text for re-resolution');
  (hud as { destroy(): void }).destroy();
});

test('replay scrubber live button carries the delegated data-scrubber-live contract', () => {
  const { hud, internals } = mountWithHypothesis('h-scrubber');
  internals.replayAtTimestamp = SNAP_A; // enter replay so the live button is enabled
  internals.render();
  const live = internals.root.querySelector<HTMLElement>('.analyst-hud-scrubber-live');
  assert.ok(live, 'live button renders when >=2 snapshots are archived');
  assert.equal(live?.dataset.scrubberLive, '1', 'live button is delegated via data-scrubber-live');
  (hud as { destroy(): void }).destroy();
});

test('skeptic toggle click flips expandedSkeptic via the root delegate after render() replaced it', () => {
  const { hud, internals } = mountWithHypothesis('h-skeptic-live');
  internals.render(); // teardown: detaches the original button node

  const skeptic = internals.root.querySelector<HTMLElement>('.analyst-hud-skeptic-toggle');
  assert.ok(skeptic, 'skeptic toggle re-rendered after teardown');
  assert.equal(internals.expandedSkeptic.has(SEED_SIGNATURE), false, 'not expanded before click');

  dispatchBubblingClick(skeptic as Element);

  assert.equal(
    internals.expandedSkeptic.has(SEED_SIGNATURE),
    true,
    'clicking the post-teardown skeptic toggle must flip expandedSkeptic via the root delegate',
  );
  (hud as { destroy(): void }).destroy();
});

test('alternatives toggle click flips expandedAlternative via the root delegate after render() replaced it', () => {
  const { hud, internals } = mountWithHypothesis('h-alt-live');
  internals.render(); // teardown

  const alt = internals.root.querySelector<HTMLElement>('.analyst-hud-alternatives-toggle');
  assert.ok(alt, 'alternatives toggle re-rendered after teardown');
  assert.equal(internals.expandedAlternative.has(SEED_SIGNATURE), false, 'not expanded before click');

  dispatchBubblingClick(alt as Element);

  assert.equal(
    internals.expandedAlternative.has(SEED_SIGNATURE),
    true,
    'clicking the post-teardown alternatives toggle must flip expandedAlternative via the root delegate',
  );
  (hud as { destroy(): void }).destroy();
});

test('question chip click enters the ask/loading path via the root delegate after render() replaced it', () => {
  const { hud, internals } = mountWithHypothesis('h-question-live');
  internals.render(); // teardown

  const chip = internals.root.querySelector<HTMLElement>('.analyst-hud-question-chip');
  assert.ok(chip, 'question chip re-rendered after teardown');
  const id = chip?.dataset.questionHypId ?? '';
  const question = chip?.dataset.questionText ?? '';
  const key = `${id}||${question}`;
  assert.equal(internals.loadingQuestion.has(key), false, 'not loading before click');

  dispatchBubblingClick(chip as Element);

  assert.equal(
    internals.loadingQuestion.has(key),
    true,
    'clicking the post-teardown question chip must enter the loading path via the root delegate',
  );
  (hud as { destroy(): void }).destroy();
});

test('scrubber live click clears replayAtTimestamp via the root delegate after render() replaced it', () => {
  const { hud, internals } = mountWithHypothesis('h-scrubber-live');
  internals.replayAtTimestamp = SNAP_A; // enter replay so the live button is enabled
  internals.render(); // teardown

  const live = internals.root.querySelector<HTMLElement>('.analyst-hud-scrubber-live');
  assert.ok(live, 'live button re-rendered after teardown');
  assert.equal(internals.replayAtTimestamp, SNAP_A, 'still in replay before click');

  dispatchBubblingClick(live as Element);

  assert.equal(
    internals.replayAtTimestamp,
    null,
    'clicking the post-teardown live button must return to live via the root delegate',
  );
  (hud as { destroy(): void }).destroy();
});

test('evidence chip click hides the HUD via the root delegate after render() replaced it', () => {
  const { hud, internals } = mountWithHypothesis('h-evidence-live', evidenceRow());
  internals.visible = true; // hide() early-returns unless the HUD is visible
  internals.render(); // teardown

  const chip = internals.root.querySelector<HTMLElement>('.analyst-hud-evidence-chip');
  assert.ok(chip, 'evidence chip re-rendered after teardown');

  dispatchBubblingClick(chip as Element);

  assert.equal(
    internals.visible,
    false,
    'clicking the post-teardown evidence chip must run hide() via the root delegate',
  );
  (hud as { destroy(): void }).destroy();
});
