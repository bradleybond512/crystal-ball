/**
 * R4-SEC-004: the Analyst HUD shows pending agent suggestions as text only
 * (hypothesis statements and agent notes can carry attacker-written feed
 * text), and its Confirm / Discard buttons route through the root delegate.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'https://crystalball.test/' });
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
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };
console.error = (): void => { /* no IndexedDB in happy-dom; reasoning-memory logs and falls back */ };

const { AnalystHUD } = await import('../AnalystHUD.ts');
const { buildAgentSuggestionsSection } = await import('../agent-suggestions-view.ts');
const suggestions = await import('@/services/agent-suggestions');
const feedback = await import('@/services/hypothesis-feedback');
type AgentSuggestion = import('@/services/agent-suggestions').AgentSuggestion;

const PAYLOAD = '<img src=x onerror="globalThis.__pwned=1"><script>globalThis.__pwned=2</script>';
const NOW = 1_800_000_000_000;

function suggestion(overrides: Partial<AgentSuggestion> = {}): AgentSuggestion {
  return {
    id: 'cmd-1',
    kind: 'thumbs_down',
    signature: 'cross-domain-cluster|situation-engine|Taiwan',
    hypothesisId: 'h-1',
    statement: `Statement ${PAYLOAD}`,
    note: `Note ${PAYLOAD}`,
    issuedAt: NOW - 120_000,
    receivedAt: NOW - 120_000,
    ...overrides,
  };
}

beforeEach(() => {
  happyWindow.localStorage.clear();
  suggestions._resetAgentSuggestionsForTests();
  feedback.resetHypothesisFeedback();
  delete G.__pwned;
});

test('nothing pending renders no section', () => {
  assert.equal(buildAgentSuggestionsSection([], NOW), null);
});

test('statements and notes render as inert text, labelled as unverified', () => {
  const section = buildAgentSuggestionsSection([suggestion()], NOW);
  assert.ok(section);
  document.body.append(section);
  try {
    assert.equal(section.querySelector('img, script'), null, 'no markup from agent or feed text');
    const statement = section.querySelector('.analyst-hud-agent-suggestion-statement');
    const note = section.querySelector('.analyst-hud-agent-suggestion-note');
    assert.equal(statement?.textContent, `Statement ${PAYLOAD}`);
    assert.equal(note?.textContent, `Agent note (unverified): Note ${PAYLOAD}`);
    assert.match(section.textContent ?? '', /Agent suggestions \(1\)/);
    assert.match(section.textContent ?? '', /Mark as noise/);
    assert.match(section.textContent ?? '', /2m ago\. Nothing changes until you confirm\./);
    assert.equal(G.__pwned, undefined);
  } finally {
    section.remove();
  }
});

test('each row carries delegated Confirm and Discard buttons', () => {
  const section = buildAgentSuggestionsSection([suggestion({ id: 'a' }), suggestion({ id: 'b', kind: 'dismiss', note: null })], NOW);
  assert.ok(section);
  const buttons = [...section.querySelectorAll<HTMLElement>('button')]
    .map((b) => `${b.dataset.agentSuggestionAction}:${b.dataset.agentSuggestionId}`);
  assert.deepEqual(buttons, ['confirm:a', 'discard:a', 'confirm:b', 'discard:b']);
  assert.equal(section.querySelectorAll('.analyst-hud-agent-suggestion-note').length, 1, 'no note row without a note');
});

interface HudInternals { root: HTMLElement; render(): void }

function mountHud(): { hud: { destroy(): void }; internals: HudInternals } {
  const hud = new AnalystHUD();
  hud.mount(happyWindow.document.body as unknown as HTMLElement);
  const internals = hud as unknown as HudInternals;
  internals.render();
  return { hud: hud as unknown as { destroy(): void }, internals };
}

function click(el: Element): void {
  el.dispatchEvent(new happyWindow.Event('click', { bubbles: true }));
}

test('the HUD lists pending suggestions and Confirm applies one through the root delegate', () => {
  suggestions.queueAgentSuggestion({ ...suggestion({ id: 'c1' }), statement: 'Plain statement' });
  const { hud, internals } = mountHud();
  try {
    internals.render(); // a re-render replaces the buttons; the delegate must still route
    const confirm = internals.root.querySelector<HTMLElement>('[data-agent-suggestion-action="confirm"]');
    assert.ok(confirm, 'the HUD shows the pending suggestion');
    assert.deepEqual(feedback.getFeedbackStats(), {}, 'nothing applied before Confirm');

    click(confirm);

    assert.equal(feedback.getFeedbackStats()[suggestion().signature]?.down, 1);
    assert.deepEqual(suggestions.listAgentSuggestions(), []);
    assert.equal(internals.root.querySelector('.analyst-hud-agent-suggestions'), null, 'the section disappears');
  } finally {
    hud.destroy();
  }
});

test('Discard in the HUD drops the suggestion without applying it', () => {
  suggestions.queueAgentSuggestion({ ...suggestion({ id: 'd1' }), statement: 'Plain statement' });
  const { hud, internals } = mountHud();
  try {
    const discard = internals.root.querySelector<HTMLElement>('[data-agent-suggestion-action="discard"]');
    assert.ok(discard);
    click(discard);
    assert.deepEqual(feedback.getFeedbackStats(), {});
    assert.deepEqual(suggestions.listAgentSuggestions(), []);
  } finally {
    hud.destroy();
  }
});
