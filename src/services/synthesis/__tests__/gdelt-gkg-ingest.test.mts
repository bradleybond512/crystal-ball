/**
 * Pure-transformer coverage for src/services/synthesis/gdelt-gkg-ingest.ts
 *
 * `mergeIntoCorpus` is the only piece worth unit-testing — `fetchGdeltEvents`
 * and `refreshCorpusFromGdelt` are thin I/O wrappers covered by route-level
 * tests in api/__tests__/gdelt-events.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HistoricalEvent } from '../precedent-matcher.ts';
import { mergeIntoCorpus, DEFAULT_CORPUS_CAP } from '../gdelt-gkg-ingest.ts';

const ev = (id: string, date: string, summary = 'x'): HistoricalEvent => ({
  id, date, location: 'X', country: 'X', eventType: 'fight',
  actors: [], intensity: 'medium', summary, source: 'gdelt',
});

test('mergeIntoCorpus: empty existing + fresh = fresh', () => {
  const fresh = [ev('a', '2026-05-01T00:00:00Z'), ev('b', '2026-05-02T00:00:00Z')];
  const out = mergeIntoCorpus([], fresh);
  assert.equal(out.length, 2);
});

test('mergeIntoCorpus: dedupes by id (fresh wins)', () => {
  const existing = [ev('a', '2026-04-01T00:00:00Z', 'old')];
  const fresh = [ev('a', '2026-05-01T00:00:00Z', 'new')];
  const out = mergeIntoCorpus(existing, fresh);
  assert.equal(out.length, 1);
  assert.equal(out[0].summary, 'new');
  assert.equal(out[0].date, '2026-05-01T00:00:00Z');
});

test('mergeIntoCorpus: sorts newest-first by date', () => {
  const existing = [ev('a', '2026-01-01T00:00:00Z'), ev('b', '2026-03-01T00:00:00Z')];
  const fresh = [ev('c', '2026-02-01T00:00:00Z')];
  const out = mergeIntoCorpus(existing, fresh);
  assert.deepEqual(out.map((e) => e.id), ['b', 'c', 'a']);
});

test('mergeIntoCorpus: enforces cap by dropping oldest', () => {
  const existing = [
    ev('a', '2026-01-01T00:00:00Z'),
    ev('b', '2026-02-01T00:00:00Z'),
    ev('c', '2026-03-01T00:00:00Z'),
  ];
  const fresh = [ev('d', '2026-04-01T00:00:00Z')];
  const out = mergeIntoCorpus(existing, fresh, 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.id), ['d', 'c']);     // newest two retained
});

test('mergeIntoCorpus: default cap is honored', () => {
  // Build corpus larger than DEFAULT_CORPUS_CAP and confirm trim.
  const existing = Array.from({ length: DEFAULT_CORPUS_CAP + 100 }, (_, i) =>
    ev(`e${i}`, new Date(2020, 0, 1, 0, i).toISOString()));
  const out = mergeIntoCorpus(existing, []);
  assert.equal(out.length, DEFAULT_CORPUS_CAP);
});

test('mergeIntoCorpus: missing date sorts last (defensive — should not crash)', () => {
  const existing = [{ ...ev('a', '2026-05-01T00:00:00Z'), date: '' }];
  const fresh = [ev('b', '2026-05-02T00:00:00Z')];
  const out = mergeIntoCorpus(existing, fresh);
  assert.equal(out[0].id, 'b');
  assert.equal(out[1].id, 'a');
});
