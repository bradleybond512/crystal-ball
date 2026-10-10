/**
 * R4-SEC-004: pending agent suggestions are bounded, expire, survive reloads
 * only in a validated shape, and keep agent text free of hidden characters.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;

const {
  AGENT_SUGGESTIONS_MAX,
  AGENT_SUGGESTIONS_STORAGE_KEY,
  AGENT_SUGGESTION_TTL_MS,
  _resetAgentSuggestionsForTests,
  cleanAgentText,
  discardAgentSuggestion,
  listAgentSuggestions,
  queueAgentSuggestion,
  subscribeAgentSuggestions,
  takeAgentSuggestion,
} = await import('../agent-suggestions.ts');
type AgentSuggestionInput = import('../agent-suggestions.ts').AgentSuggestionInput;

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const T0 = 1_800_000_000_000;

function input(overrides: Partial<AgentSuggestionInput> = {}): AgentSuggestionInput {
  return {
    id: 'cmd-1',
    kind: 'thumbs_down',
    signature: 'cross-domain-cluster|situation-engine|Taiwan',
    hypothesisId: 'h-1',
    statement: 'Naval activity is rising near Taiwan.',
    note: 'Looks like noise to me.',
    issuedAt: T0 - 1_000,
    ...overrides,
  };
}

beforeEach(() => {
  storage.clear();
  _resetAgentSuggestionsForTests();
});

test('a queued suggestion is listed and persisted, newest first', () => {
  queueAgentSuggestion(input({ id: 'a', signature: 's-a' }), T0);
  queueAgentSuggestion(input({ id: 'b', signature: 's-b', kind: 'dismiss' }), T0 + 1);
  assert.deepEqual(listAgentSuggestions(T0 + 2).map((s) => s.id), ['b', 'a']);
  const stored = JSON.parse(storage.get(AGENT_SUGGESTIONS_STORAGE_KEY) ?? '[]') as { id: string; receivedAt: number }[];
  assert.deepEqual(stored.map((s) => s.id), ['a', 'b']);
  assert.equal(stored[0]?.receivedAt, T0);
});

test('agent text loses hidden characters and is length-capped; the signature is kept exact', () => {
  const hidden = `${cp(0x200b)}${cp(0x202e)}${[...'ok'].map((c) => cp(0xe0000 + (c.codePointAt(0) ?? 0))).join('')}`;
  const queued = queueAgentSuggestion(input({
    note: `Dismiss${hidden} this\nnow\t${'x'.repeat(1000)}`,
    statement: `State${cp(0xfeff)}ment`,
  }), T0);
  assert.ok(queued);
  assert.ok(queued.note?.startsWith('Dismiss this now x'));
  assert.equal(queued.note?.length, 400);
  assert.equal(queued.statement, 'Statement');
  assert.equal(queued.signature, input().signature);
  assert.equal(cleanAgentText(`a${cp(0x2066)}b${cp(0xe0100)}c`, 10), 'abc');
  assert.equal(queueAgentSuggestion(input({ note: `${cp(0x200b)} ` }), T0)?.note, null);
});

test('malformed input is refused', () => {
  const bad: unknown[] = [
    { ...input(), kind: 'set_calibration' },
    { ...input(), signature: '' },
    { ...input(), signature: 's'.repeat(513) },
    { ...input(), id: `${cp(0x200b)}` },
    { ...input(), issuedAt: Number.NaN },
    { ...input(), statement: 42 },
    { ...input(), note: { html: '<b>' } },
  ];
  for (const raw of bad) {
    assert.equal(queueAgentSuggestion(raw as AgentSuggestionInput, T0), null, JSON.stringify(raw));
  }
  assert.equal(listAgentSuggestions(T0).length, 0);
});

test('a newer suggestion of the same kind for the same hypothesis replaces the older one', () => {
  queueAgentSuggestion(input({ id: 'old', note: 'first' }), T0);
  queueAgentSuggestion(input({ id: 'new', note: 'second' }), T0 + 1);
  queueAgentSuggestion(input({ id: 'other-kind', kind: 'thumbs_up' }), T0 + 2);
  const list = listAgentSuggestions(T0 + 3);
  assert.deepEqual(list.map((s) => s.id), ['other-kind', 'new']);
  assert.equal(list[1]?.note, 'second');
});

test('the list is capped at 50, dropping the oldest', () => {
  for (let i = 0; i < AGENT_SUGGESTIONS_MAX + 5; i += 1) {
    queueAgentSuggestion(input({ id: `c${i}`, signature: `s${i}` }), T0 + i);
  }
  const ids = listAgentSuggestions(T0 + 100).map((s) => s.id);
  assert.equal(AGENT_SUGGESTIONS_MAX, 50);
  assert.equal(ids.length, 50);
  assert.equal(ids.at(-1), 'c5');
  assert.equal(ids[0], 'c54');
});

test('suggestions expire after 7 days and can no longer be taken', () => {
  queueAgentSuggestion(input({ id: 'stale' }), T0);
  assert.equal(AGENT_SUGGESTION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(listAgentSuggestions(T0 + AGENT_SUGGESTION_TTL_MS - 1).length, 1);
  assert.equal(takeAgentSuggestion('stale', T0 + AGENT_SUGGESTION_TTL_MS), null);
  assert.equal(listAgentSuggestions(T0 + AGENT_SUGGESTION_TTL_MS).length, 0);
});

test('take removes exactly one suggestion; discard reports whether one existed', () => {
  queueAgentSuggestion(input({ id: 'a', signature: 's-a' }), T0);
  queueAgentSuggestion(input({ id: 'b', signature: 's-b' }), T0);
  assert.equal(takeAgentSuggestion('a', T0)?.id, 'a');
  assert.equal(takeAgentSuggestion('a', T0), null);
  assert.equal(discardAgentSuggestion('b', T0), true);
  assert.equal(discardAgentSuggestion('b', T0), false);
  assert.equal(listAgentSuggestions(T0).length, 0);
});

test('storage is validated on load: tampered entries are dropped, good ones kept', () => {
  const good = { ...input({ id: 'good' }), receivedAt: T0 };
  storage.set(AGENT_SUGGESTIONS_STORAGE_KEY, JSON.stringify([
    good,
    { ...good, id: 'evil', kind: 'apply_now' },
    { ...good, id: 'evil2', receivedAt: 'yesterday' },
    'not an object',
    null,
  ]));
  _resetAgentSuggestionsForTests();
  assert.deepEqual(listAgentSuggestions(T0 + 1).map((s) => s.id), ['good']);

  storage.set(AGENT_SUGGESTIONS_STORAGE_KEY, '{not json');
  _resetAgentSuggestionsForTests();
  assert.deepEqual(listAgentSuggestions(T0), []);
});

test('subscribers hear queue, take and discard', () => {
  let calls = 0;
  const unsubscribe = subscribeAgentSuggestions(() => { calls += 1; });
  queueAgentSuggestion(input({ id: 'a', signature: 's-a' }), T0);
  queueAgentSuggestion(input({ id: 'b', signature: 's-b' }), T0);
  takeAgentSuggestion('a', T0);
  discardAgentSuggestion('b', T0);
  assert.equal(calls, 4);
  unsubscribe();
  queueAgentSuggestion(input({ id: 'c', signature: 's-c' }), T0);
  assert.equal(calls, 4);
});
