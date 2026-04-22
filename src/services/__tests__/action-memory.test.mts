import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;
class StubCE<T = unknown> {
  detail: T | undefined;
  type: string;
  constructor(type: string, init?: { detail?: T }) { this.type = type; this.detail = init?.detail; }
}
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = StubCE;
(globalThis as unknown as { document: { dispatchEvent: () => boolean } }).document = {
  dispatchEvent: () => true,
};

import {
  recordAction, getPlaybookFor, summarizePlaybook, noteRecurrence, resetActionMemory,
} from '../action-memory.ts';

function makeRef(region = 'TestRegion') {
  return {
    kind: 'cross-domain-cluster' as const,
    region,
    evidence: [{ source: 'situation-engine' as const, id: 's1', label: 'S1' }],
  };
}

test('recordAction creates a playbook on first call', () => {
  resetActionMemory();
  const h = makeRef('First');
  recordAction(h, 'panel-jump', 'situation-awareness');
  const book = getPlaybookFor(h);
  assert.ok(book, 'expected playbook');
  assert.equal(book?.actions.length, 1);
  assert.equal(book?.actions[0]?.kind, 'panel-jump');
  assert.equal(book?.actions[0]?.detail, 'situation-awareness');
});

test('noteRecurrence increments recurrenceCount', () => {
  resetActionMemory();
  const h = makeRef('Recur');
  recordAction(h, 'thumbs-up');
  assert.equal(getPlaybookFor(h)?.recurrenceCount, 1);
  noteRecurrence(h);
  assert.equal(getPlaybookFor(h)?.recurrenceCount, 2);
});

test('summarizePlaybook reports counts for repeated actions', () => {
  resetActionMemory();
  const h = makeRef('Counts');
  recordAction(h, 'panel-jump', 'sit-x');
  recordAction(h, 'panel-jump', 'sit-x');
  recordAction(h, 'thumbs-up');
  const book = getPlaybookFor(h);
  assert.ok(book);
  const summary = summarizePlaybook(book!);
  assert.match(summary, /opened sit-x \(2×\)/);
  assert.match(summary, /voted useful/);
});

test('actions accumulate across noteRecurrence calls', () => {
  resetActionMemory();
  const h = makeRef('Accum');
  recordAction(h, 'thumbs-up');
  noteRecurrence(h);
  recordAction(h, 'panel-jump', 'sit-y');
  const book = getPlaybookFor(h);
  assert.equal(book?.actions.length, 2);
  assert.equal(book?.recurrenceCount, 2);
});

test('getPlaybookFor returns null for unknown signature', () => {
  resetActionMemory();
  const h = makeRef('NoSuch');
  assert.equal(getPlaybookFor(h), null);
});
