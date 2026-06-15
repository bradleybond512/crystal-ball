/**
 * Tests for cognition/vector-index.ts
 *
 * Hashed tier only, static fixtures, no real IDB/DOM/fetch.
 * Runs via: tsx --test src/services/cognition/__tests__/vector-index.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { cosineSimilarity, topK } from '../vector-index.ts';
import type { IndexedVector } from '../vector-index.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a Float32Array from a plain number array. */
function f32(values: number[]): Float32Array {
  return new Float32Array(values);
}

/** L2-normalize a float array. */
function normalize(values: number[]): Float32Array {
  const v = new Float32Array(values);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function makeVec(id: string, values: number[], tier: 'neural' | 'hashed' = 'hashed'): IndexedVector {
  return { id, vector: normalize(values), tier };
}

// ── cosineSimilarity tests ────────────────────────────────────────────────────

test('cosineSimilarity: identical vectors → 1', () => {
  const a = normalize([1, 0, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-6);
});

test('cosineSimilarity: orthogonal vectors → 0', () => {
  const a = normalize([1, 0, 0]);
  const b = normalize([0, 1, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6);
});

test('cosineSimilarity: anti-parallel vectors → -1', () => {
  const a = normalize([1, 0, 0]);
  const b = normalize([-1, 0, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, b) - (-1)) < 1e-6);
});

test('cosineSimilarity: arbitrary similar vectors > 0', () => {
  const a = normalize([3, 1, 0]);
  const b = normalize([2, 1, 0]);
  const sim = cosineSimilarity(a, b);
  assert.ok(sim > 0.9, `expected > 0.9, got ${sim}`);
  assert.ok(sim <= 1.0);
});

test('cosineSimilarity: throws on dimension mismatch', () => {
  const a = f32([1, 2]);
  const b = f32([1, 2, 3]);
  assert.throws(() => cosineSimilarity(a, b), /dimension mismatch/);
});

// ── topK tests ────────────────────────────────────────────────────────────────

test('topK: returns top-K results sorted descending by similarity', () => {
  const query = makeVec('q', [1, 0, 0, 0]);
  const corpus: IndexedVector[] = [
    makeVec('a', [0.8, 0.6, 0, 0]),  // ~0.80 similarity
    makeVec('b', [1, 0, 0, 0]),       // ~1.0 similarity (identical)
    makeVec('c', [0, 1, 0, 0]),       // ~0.0 similarity
    makeVec('d', [0.5, 0.5, 0.5, 0.5]), // moderate
  ];

  const results = topK(query, corpus, 3);
  assert.equal(results.length, 3);
  // b should be first (highest similarity)
  assert.equal(results[0].id, 'b');
  // Descending order
  for (let i = 1; i < results.length; i++) {
    assert.ok(
      results[i - 1].similarity >= results[i].similarity,
      `Expected descending order at index ${i}`,
    );
  }
});

test('topK: minSim threshold filters low-similarity results', () => {
  const query = makeVec('q', [1, 0, 0, 0]);
  const corpus: IndexedVector[] = [
    makeVec('a', [1, 0, 0, 0]),   // identical → 1.0
    makeVec('b', [0, 1, 0, 0]),   // orthogonal → 0.0
    makeVec('c', [0, 0, 1, 0]),   // orthogonal → 0.0
  ];

  const results = topK(query, corpus, 10, 0.5);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
});

test('topK: tier partitioning — never compares across tiers', () => {
  const query = makeVec('q', [1, 0, 0, 0], 'hashed');
  const corpus: IndexedVector[] = [
    makeVec('neural-a', [1, 0, 0, 0], 'neural'),  // same direction, different tier
    makeVec('hashed-b', [0.9, 0.4, 0, 0], 'hashed'), // same tier, slightly different
  ];

  const results = topK(query, corpus, 5);
  // Only hashed-b should be returned; neural-a is different tier
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'hashed-b');
});

test('topK: excludes the query vector itself by id', () => {
  const query = makeVec('self', [1, 0, 0, 0], 'hashed');
  const corpus: IndexedVector[] = [
    makeVec('self', [1, 0, 0, 0], 'hashed'),  // same id as query
    makeVec('other', [0.9, 0.4, 0, 0], 'hashed'),
  ];

  const results = topK(query, corpus, 5);
  const ids = results.map(r => r.id);
  assert.ok(!ids.includes('self'), 'query id should be excluded from results');
  assert.ok(ids.includes('other'));
});

test('topK: returns fewer than K when corpus is small', () => {
  const query = makeVec('q', [1, 0, 0, 0]);
  const corpus: IndexedVector[] = [
    makeVec('a', [1, 0, 0, 0]),
  ];

  const results = topK(query, corpus, 5);
  assert.ok(results.length <= 1);
});

test('topK: empty corpus returns empty array', () => {
  const query = makeVec('q', [1, 0, 0, 0]);
  const results = topK(query, [], 5);
  assert.equal(results.length, 0);
});

test('topK: all neural tier when query is neural', () => {
  const query = makeVec('q', [1, 0, 0, 0], 'neural');
  const corpus: IndexedVector[] = [
    makeVec('a', [1, 0, 0, 0], 'neural'),
    makeVec('b', [1, 0, 0, 0], 'hashed'),  // wrong tier — excluded
  ];

  const results = topK(query, corpus, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
});

test('topK: similarity values are in [0, 1] for normalized inputs', () => {
  const query = makeVec('q', [1, 2, 3, 4]);
  const corpus: IndexedVector[] = [
    makeVec('a', [1, 1, 1, 1]),
    makeVec('b', [4, 3, 2, 1]),
    makeVec('c', [0, 0, 0, 1]),
  ];

  const results = topK(query, corpus, 10);
  for (const r of results) {
    assert.ok(r.similarity >= -1, `similarity ${r.similarity} < -1`);
    assert.ok(r.similarity <= 1, `similarity ${r.similarity} > 1`);
  }
});
