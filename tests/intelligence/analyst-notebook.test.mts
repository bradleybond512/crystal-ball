/**
 * Tests for AnalystNotebookService.
 *
 * Run with: npx tsx --test tests/intelligence/analyst-notebook.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalystNotebookService,
  MAX_NOTES,
  STORAGE_KEY,
  __internals,
  __resetAnalystNotebookSingleton,
  getAnalystNotebookService,
  type Note,
  type NoteInput,
  type NotebookStorage,
} from '../../src/services/intelligence/analyst-notebook.ts';

const NOW = 1_745_000_000_000;

function makeStorage(): { storage: NotebookStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: NotebookStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return { storage, map };
}

function freshService(clock = () => NOW): AnalystNotebookService {
  const { storage } = makeStorage();
  return new AnalystNotebookService(storage, clock);
}

function tickingClock(start = NOW): () => number {
  let t = start;
  return () => {
    t += 1000;
    return t;
  };
}

function noteInput(overrides: Partial<NoteInput> = {}): NoteInput {
  return {
    title: 'Default title',
    body: 'Default body',
    category: 'general',
    tags: [],
    linkedSituationIds: [],
    linkedObservationIds: [],
    isPinned: false,
    ...overrides,
  };
}

// ── create() ─────────────────────────────────────────────────────────

test('create stamps id, createdAt, updatedAt and returns the note', () => {
  const svc = freshService();
  const note = svc.create(noteInput({ title: 'first' }));
  assert.ok(note.id.startsWith('note-'));
  assert.equal(note.createdAt, NOW);
  assert.equal(note.updatedAt, NOW);
  assert.equal(note.title, 'first');
});

test('create preserves all input fields', () => {
  const svc = freshService();
  const n = svc.create(noteInput({
    title: 'A', body: 'B', category: 'hypothesis',
    tags: ['x', 'y'], linkedSituationIds: ['s-1'], linkedObservationIds: ['o-1'], isPinned: true,
  }));
  assert.equal(n.category, 'hypothesis');
  assert.deepEqual(n.tags, ['x', 'y']);
  assert.deepEqual(n.linkedSituationIds, ['s-1']);
  assert.deepEqual(n.linkedObservationIds, ['o-1']);
  assert.equal(n.isPinned, true);
});

test('create returns defensive copies — mutating result does not affect store', () => {
  const svc = freshService();
  const n = svc.create(noteInput({ tags: ['x'] }));
  n.tags.push('rogue');
  const stored = svc.getAll();
  assert.deepEqual(stored[0]!.tags, ['x']);
});

test('create assigns unique ids even at the same clock tick', () => {
  const svc = freshService();
  const a = svc.create(noteInput({ title: 'A' }));
  const b = svc.create(noteInput({ title: 'B' }));
  assert.notEqual(a.id, b.id);
});

// ── update() ─────────────────────────────────────────────────────────

test('update changes the fields specified and bumps updatedAt', () => {
  const clock = tickingClock();
  const { storage } = makeStorage();
  const svc = new AnalystNotebookService(storage, clock);
  const n = svc.create(noteInput({ title: 'old' }));
  const updated = svc.update(n.id, { title: 'new' });
  assert.ok(updated);
  assert.equal(updated!.title, 'new');
  assert.ok(updated!.updatedAt > n.createdAt);
  assert.equal(updated!.createdAt, n.createdAt);
});

test('update returns null on unknown id', () => {
  const svc = freshService();
  assert.equal(svc.update('does-not-exist', { title: 'x' }), null);
});

test('update preserves unspecified fields', () => {
  const svc = freshService();
  const n = svc.create(noteInput({ title: 'A', body: 'B', isPinned: true }));
  const u = svc.update(n.id, { title: 'A2' });
  assert.equal(u!.title, 'A2');
  assert.equal(u!.body, 'B');
  assert.equal(u!.isPinned, true);
});

// ── delete() ─────────────────────────────────────────────────────────

test('delete removes the note and returns true', () => {
  const svc = freshService();
  const n = svc.create(noteInput());
  assert.equal(svc.delete(n.id), true);
  assert.equal(svc.getAll().length, 0);
});

test('delete returns false on unknown id', () => {
  const svc = freshService();
  assert.equal(svc.delete('does-not-exist'), false);
});

// ── search() ─────────────────────────────────────────────────────────

test('search matches by title case-insensitive', () => {
  const svc = freshService();
  svc.create(noteInput({ title: 'Quake near Tokyo' }));
  svc.create(noteInput({ title: 'Cyclone alert' }));
  const r = svc.search('TOKYO');
  assert.equal(r.length, 1);
  assert.equal(r[0]!.title, 'Quake near Tokyo');
});

test('search matches by body', () => {
  const svc = freshService();
  svc.create(noteInput({ body: 'depth=12km magnitude 6.2' }));
  svc.create(noteInput({ body: 'unrelated' }));
  assert.equal(svc.search('magnitude').length, 1);
});

test('search matches by tag', () => {
  const svc = freshService();
  svc.create(noteInput({ tags: ['urgent', 'maritime'] }));
  svc.create(noteInput({ tags: ['routine'] }));
  assert.equal(svc.search('Maritime').length, 1);
});

test('search returns empty for an empty/whitespace query', () => {
  const svc = freshService();
  svc.create(noteInput({ title: 'has content' }));
  assert.equal(svc.search('').length, 0);
  assert.equal(svc.search('   ').length, 0);
});

test('search returns results in LIFO order', () => {
  const clock = tickingClock();
  const { storage } = makeStorage();
  const svc = new AnalystNotebookService(storage, clock);
  const first = svc.create(noteInput({ title: 'tokyo first' }));
  const second = svc.create(noteInput({ title: 'tokyo second' }));
  const r = svc.search('tokyo');
  assert.equal(r[0]!.id, second.id);
  assert.equal(r[1]!.id, first.id);
});

// ── getByTag() / getBySituation() ────────────────────────────────────

test('getByTag matches case-insensitive exact tag', () => {
  const svc = freshService();
  svc.create(noteInput({ tags: ['Urgent'] }));
  svc.create(noteInput({ tags: ['urgent-followup'] })); // not exact
  const r = svc.getByTag('urgent');
  assert.equal(r.length, 1);
});

test('getBySituation matches situation id presence in linkedSituationIds', () => {
  const svc = freshService();
  svc.create(noteInput({ linkedSituationIds: ['sit-A', 'sit-B'] }));
  svc.create(noteInput({ linkedSituationIds: ['sit-C'] }));
  const r = svc.getBySituation('sit-A');
  assert.equal(r.length, 1);
});

// ── getAll() ─────────────────────────────────────────────────────────

test('getAll returns pinned notes before unpinned, each bucket LIFO', () => {
  const clock = tickingClock();
  const { storage } = makeStorage();
  const svc = new AnalystNotebookService(storage, clock);
  const oldUnpinned = svc.create(noteInput({ title: 'old-unpinned' }));
  const oldPinned = svc.create(noteInput({ title: 'old-pinned', isPinned: true }));
  const newUnpinned = svc.create(noteInput({ title: 'new-unpinned' }));
  const newPinned = svc.create(noteInput({ title: 'new-pinned', isPinned: true }));
  const all = svc.getAll();
  assert.deepEqual(all.map((n) => n.id), [newPinned.id, oldPinned.id, newUnpinned.id, oldUnpinned.id]);
});

test('getAll filters by category', () => {
  const svc = freshService();
  svc.create(noteInput({ category: 'observation' }));
  svc.create(noteInput({ category: 'hypothesis' }));
  svc.create(noteInput({ category: 'observation' }));
  assert.equal(svc.getAll({ category: 'observation' }).length, 2);
});

test('getAll filters by isPinned', () => {
  const svc = freshService();
  svc.create(noteInput({ isPinned: true }));
  svc.create(noteInput({ isPinned: false }));
  assert.equal(svc.getAll({ isPinned: true }).length, 1);
});

test('getAll respects limit', () => {
  const svc = freshService();
  for (let i = 0; i < 5; i++) svc.create(noteInput({ title: `n-${i}` }));
  assert.equal(svc.getAll(undefined, 2).length, 2);
});

// ── getStats() ───────────────────────────────────────────────────────

test('getStats reports total, pinned, byCategory counts', () => {
  const svc = freshService();
  svc.create(noteInput({ category: 'observation', isPinned: true }));
  svc.create(noteInput({ category: 'observation' }));
  svc.create(noteInput({ category: 'hypothesis' }));
  const stats = svc.getStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.pinned, 1);
  assert.equal(stats.byCategory.observation, 2);
  assert.equal(stats.byCategory.hypothesis, 1);
  assert.equal(stats.byCategory.assessment, 0);
});

test('getStats recentTags lists unique tags from the last 20 notes, most-frequent first', () => {
  const clock = tickingClock();
  const { storage } = makeStorage();
  const svc = new AnalystNotebookService(storage, clock);
  // tag 'a' appears 3 times, 'b' once. Both within the 20-note window.
  svc.create(noteInput({ tags: ['a'] }));
  svc.create(noteInput({ tags: ['a', 'b'] }));
  svc.create(noteInput({ tags: ['a'] }));
  const stats = svc.getStats();
  assert.equal(stats.recentTags[0], 'a');
  assert.equal(stats.recentTags[1], 'b');
});

test('getStats recentTags is empty on an empty notebook', () => {
  assert.deepEqual(freshService().getStats().recentTags, []);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('ring buffer caps notes at MAX_NOTES', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new AnalystNotebookService(storage, () => t);
  for (let i = 0; i < MAX_NOTES + 10; i++) {
    svc.create(noteInput({ title: `n-${i}` }));
    t += 1;
  }
  assert.equal(svc.getAll().length, MAX_NOTES);
});

test('ring buffer evicts oldest unpinned first, keeps pinned notes', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new AnalystNotebookService(storage, () => t);
  // First note pinned, then fill to MAX with unpinned + one more.
  const pinned = svc.create(noteInput({ title: 'pinned-first', isPinned: true }));
  t += 1;
  for (let i = 0; i < MAX_NOTES; i++) {
    svc.create(noteInput({ title: `n-${i}` }));
    t += 1;
  }
  // The pinned note must survive eviction; the very-oldest unpinned
  // ('n-0') should be gone.
  const surviving = svc.getAll();
  assert.equal(surviving.length, MAX_NOTES);
  assert.ok(surviving.some((n) => n.id === pinned.id));
  assert.ok(!surviving.some((n) => n.title === 'n-0'));
});

// ── subscribe() ──────────────────────────────────────────────────────

test('subscribe fires on create, update, delete', () => {
  const svc = freshService();
  let fires = 0;
  svc.subscribe(() => { fires += 1; });
  const n = svc.create(noteInput());
  svc.update(n.id, { title: 'x' });
  svc.delete(n.id);
  assert.equal(fires, 3);
});

test('subscribe unsubscribe stops further fires', () => {
  const svc = freshService();
  let fires = 0;
  const off = svc.subscribe(() => { fires += 1; });
  svc.create(noteInput());
  off();
  svc.create(noteInput());
  assert.equal(fires, 1);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  let goodFires = 0;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { goodFires += 1; });
  svc.create(noteInput());
  assert.equal(goodFires, 1);
});

// ── Persistence ──────────────────────────────────────────────────────

test('notes survive across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new AnalystNotebookService(storage, () => NOW);
  a.create(noteInput({ title: 'persist me' }));
  const b = new AnalystNotebookService(storage, () => NOW);
  assert.equal(b.getAll().length, 1);
  assert.equal(b.getAll()[0]!.title, 'persist me');
});

test('persistence key is wm-analyst-notes', () => {
  const { storage, map } = makeStorage();
  const svc = new AnalystNotebookService(storage, () => NOW);
  svc.create(noteInput());
  assert.ok(map.has(STORAGE_KEY));
  assert.equal(STORAGE_KEY, 'wm-analyst-notes');
});

test('corrupt persisted blob does not crash hydrate', () => {
  const { storage } = makeStorage();
  storage.setItem(STORAGE_KEY, 'not-json');
  const svc = new AnalystNotebookService(storage, () => NOW);
  assert.equal(svc.getAll().length, 0);
});

test('non-array persisted blob is ignored without crash', () => {
  const { storage } = makeStorage();
  storage.setItem(STORAGE_KEY, '{"weird":"shape"}');
  const svc = new AnalystNotebookService(storage, () => NOW);
  assert.equal(svc.getAll().length, 0);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getAnalystNotebookService returns a stable singleton', () => {
  __resetAnalystNotebookSingleton();
  const a = getAnalystNotebookService();
  const b = getAnalystNotebookService();
  assert.equal(a, b);
  __resetAnalystNotebookSingleton();
});

// ── Internals ────────────────────────────────────────────────────────

test('internals.isValidNote rejects malformed records', () => {
  assert.equal(__internals.isValidNote({}), false);
  assert.equal(__internals.isValidNote({ id: 'x' }), false);
  assert.equal(__internals.isValidNote(null), false);
});

test('internals.isValidNote accepts well-formed records', () => {
  const good: Note = {
    id: 'n-1', title: 't', body: 'b', category: 'general',
    tags: [], linkedSituationIds: [], linkedObservationIds: [],
    createdAt: 0, updatedAt: 0, isPinned: false,
  };
  assert.equal(__internals.isValidNote(good), true);
});
