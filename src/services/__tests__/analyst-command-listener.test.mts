/**
 * R4-SEC-004: thumbs and dismissals from external agents wait for the user's
 * confirmation; only a confirmed suggestion reaches the feedback stats or the
 * dismissed set. Skeptic requests still apply at once.
 */
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'https://crystalball.test/' });
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.Event = happyWindow.Event;
G.CustomEvent = happyWindow.CustomEvent;
G.localStorage = happyWindow.localStorage;
// No IndexedDB here: reasoning-memory logs and falls back to localStorage.
const originalConsoleError = console.error;
console.error = (): void => { /* keep the IndexedDB fallback quiet */ };

const listener = await import('../analyst-command-listener.ts');
const feedback = await import('../hypothesis-feedback.ts');
const suggestions = await import('../agent-suggestions.ts');
type Hypothesis = import('../analyst-loop.ts').Hypothesis;

function hypothesis(id: string, region: string): Hypothesis {
  return {
    id,
    kind: 'cross-domain-cluster',
    statement: `Activity is rising near ${region}.`,
    confidence: 0.7,
    risk: 'high',
    region,
    evidence: [{ source: 'situation-engine', id: `e-${id}`, label: 'E' }],
    timestamp: 1_800_000_000_000,
  } as Hypothesis;
}

const H1 = hypothesis('h-1', 'Taiwan');
const H2 = hypothesis('h-2', 'Baltic');

function publishSnapshot(hypotheses: Hypothesis[]): void {
  document.dispatchEvent(new CustomEvent('cb:analyst-hypotheses', {
    detail: { timestamp: Date.now(), hypotheses, aiEnriched: false },
  }));
}

let seq = 0;
function command(kind: string, target: Hypothesis | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `cmd-${seq}`,
    issuedAt: 1_800_000_000_000 + seq,
    kind,
    origin: 'external',
    hypothesisId: target?.id ?? null,
    signature: null,
    note: 'agent says so',
    ...extra,
  };
}

listener.startAnalystCommandListener();
after(() => {
  listener.stopAnalystCommandListener();
  console.error = originalConsoleError;
});

beforeEach(() => {
  feedback.resetHypothesisFeedback();
  listener.clearDismissed();
  suggestions._resetAgentSuggestionsForTests();
  happyWindow.localStorage.clear();
  publishSnapshot([H1, H2]);
});

test('external thumbs and dismissals are held as suggestions, not applied', () => {
  const counts = listener.processAnalystCommands([
    command('thumbs_up', H1),
    command('thumbs_down', H2),
    command('dismiss', H1),
  ]);
  assert.deepEqual(counts, { applied: 0, queued: 3, dropped: 0 });
  assert.deepEqual(feedback.getFeedbackStats(), {});
  assert.equal(listener.isDismissed(H1), false);
  const pending = suggestions.listAgentSuggestions();
  assert.deepEqual(pending.map((s) => s.kind).sort(), ['dismiss', 'thumbs_down', 'thumbs_up']);
  assert.equal(pending.find((s) => s.kind === 'dismiss')?.signature, feedback.signatureFor(H1));
  assert.equal(pending.find((s) => s.kind === 'dismiss')?.statement, H1.statement);
});

test('no origin value lets a command skip confirmation', () => {
  for (const origin of ['renderer', 'local', 'user', undefined]) {
    listener.processAnalystCommands([command('thumbs_up', H1, { origin })]);
  }
  assert.deepEqual(feedback.getFeedbackStats(), {});
  assert.equal(suggestions.listAgentSuggestions().length, 1, 'same kind and hypothesis collapse to one');
});

test('Confirm applies the suggestion by signature; Discard drops it', () => {
  listener.processAnalystCommands([command('thumbs_down', H1), command('dismiss', H2), command('thumbs_up', H2)]);
  const byKind: Record<string, string> = Object.fromEntries(suggestions.listAgentSuggestions().map((s) => [s.kind, s.id]));

  assert.equal(listener.confirmAgentSuggestion(byKind.thumbs_down ?? ''), true);
  assert.deepEqual(feedback.getFeedbackStats()[feedback.signatureFor(H1)]?.down, 1);
  assert.equal(listener.confirmAgentSuggestion(byKind.thumbs_down ?? ''), false, 'a suggestion applies once');

  // The hypothesis left the snapshot; the dismissal still applies by signature.
  publishSnapshot([H1]);
  assert.equal(listener.confirmAgentSuggestion(byKind.dismiss ?? ''), true);
  assert.equal(listener.isDismissed(H2), true);

  assert.equal(listener.rejectAgentSuggestion(byKind.thumbs_up ?? ''), true);
  assert.equal(feedback.getFeedbackStats()[feedback.signatureFor(H2)], undefined);
  assert.equal(listener.confirmAgentSuggestion(byKind.thumbs_up ?? ''), false, 'a discarded suggestion cannot be confirmed');
  assert.deepEqual(suggestions.listAgentSuggestions(), []);
});

test('Confirm on a thumbs-up records an up vote', () => {
  listener.processAnalystCommands([command('thumbs_up', H2)]);
  const [pending] = suggestions.listAgentSuggestions();
  assert.ok(pending);
  assert.equal(listener.confirmAgentSuggestion(pending.id), true);
  assert.equal(feedback.getFeedbackStats()[feedback.signatureFor(H2)]?.up, 1);
});

test('run_skeptic still applies at once', () => {
  const seen: string[] = [];
  const onSkeptic = (e: Event): void => { seen.push((e as CustomEvent<Hypothesis>).detail.id); };
  document.addEventListener('cb:hypothesis-skeptic-requested', onSkeptic);
  try {
    const counts = listener.processAnalystCommands([command('run_skeptic', H2)]);
    assert.deepEqual(counts, { applied: 1, queued: 0, dropped: 0 });
    assert.deepEqual(seen, ['h-2']);
    assert.deepEqual(suggestions.listAgentSuggestions(), []);
  } finally {
    document.removeEventListener('cb:hypothesis-skeptic-requested', onSkeptic);
  }
});

test('malformed, unknown and unmatched commands are dropped', () => {
  const counts = listener.processAnalystCommands([
    null,
    'thumbs_up',
    { ...command('thumbs_up', H1), issuedAt: 'now' },
    // A bad timestamp would poison the poll cursor (Math.max -> NaN), so even
    // an otherwise valid skeptic request is dropped.
    { ...command('run_skeptic', H1), issuedAt: Number.NaN },
    { ...command('thumbs_up', H1), id: 7 },
    command('apply_calibration', H1),
    command('thumbs_up', null, { hypothesisId: 'missing', signature: 'nope' }),
  ]);
  assert.deepEqual(counts, { applied: 0, queued: 0, dropped: 7 });
  assert.deepEqual(suggestions.listAgentSuggestions(), []);
});

test('the user\'s own thumbs still apply directly', () => {
  feedback.thumbsUp(H1);
  feedback.thumbsDown(H1);
  assert.deepEqual(
    { up: feedback.getFeedbackStats()[feedback.signatureFor(H1)]?.up, down: feedback.getFeedbackStats()[feedback.signatureFor(H1)]?.down },
    { up: 1, down: 1 },
  );
});
