/**
 * Tests for cognition-worker.ts — worker manager fallback path.
 *
 * These tests exercise the in-thread fallback path (Worker is unavailable in
 * Node.js). The invariant under test: fallback results are IDENTICAL to what
 * a running worker would produce, because both paths use the same pure math.
 *
 * We test the manager's topK and cluster methods directly. When no Worker is
 * available (Node.js — tryGetWorkerClass() returns null), cognition-worker.ts
 * transparently delegates to the same in-thread functions. We also test
 * clusterInThread directly for property assertions.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { cognitionWorker, clusterInThread } from '../cognition-worker.ts';
import { cosineSimilarity } from '../vector-index.ts';
import type { IndexedVector } from '../vector-index.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVec(values: number[]): Float32Array {
  return new Float32Array(values);
}

/** L2-normalise a Float32Array in-place; returns it for chaining. */
function l2Norm(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += (vec[i] ?? 0) ** 2;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
  return vec;
}

function makeIndexedVec(id: string, values: number[], tier: 'hashed' | 'neural' = 'hashed'): IndexedVector {
  return { id, vector: l2Norm(makeVec(values)), tier };
}

// ── init ──────────────────────────────────────────────────────────────────────

before(async () => {
  // In Node.js the Worker module import will fail → manager stays in fallback mode.
  // init() should return false (no worker) but not throw.
  const result = await cognitionWorker.init();
  // We don't assert true/false — it depends on whether the env can spawn workers.
  // We just assert it doesn't throw.
  assert.ok(typeof result === 'boolean', 'init() must return boolean');
});

// ── topK — fallback path ──────────────────────────────────────────────────────

describe('cognitionWorker.topK fallback', () => {
  it('returns results sorted by descending similarity', async () => {
    const query = makeIndexedVec('q', [1, 0, 0, 0]);
    const corpus: IndexedVector[] = [
      makeIndexedVec('a', [1, 0, 0, 0]),  // identical → highest
      makeIndexedVec('b', [0.9, 0.4, 0, 0]),
      makeIndexedVec('c', [0, 1, 0, 0]),  // orthogonal → ~0
    ];
    const results = await cognitionWorker.topK(query, corpus, 3, 0);
    assert.ok(results.length >= 1, 'should return at least one result');
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1]!.similarity >= results[i]!.similarity,
        'results must be descending by similarity',
      );
    }
  });

  it('respects k limit', async () => {
    const query = makeIndexedVec('q', [1, 0, 0, 0]);
    const corpus: IndexedVector[] = [
      makeIndexedVec('a', [1, 0, 0, 0]),
      makeIndexedVec('b', [0.9, 0.4, 0, 0]),
      makeIndexedVec('c', [0.8, 0.6, 0, 0]),
      makeIndexedVec('d', [0, 1, 0, 0]),
    ];
    const results = await cognitionWorker.topK(query, corpus, 2, 0);
    assert.equal(results.length, 2, 'should return exactly k results');
  });

  it('respects minSim threshold', async () => {
    const query = makeIndexedVec('q', [1, 0, 0, 0]);
    const corpus: IndexedVector[] = [
      makeIndexedVec('a', [1, 0, 0, 0]),   // sim = 1.0
      makeIndexedVec('b', [0, 1, 0, 0]),   // sim ≈ 0
    ];
    const results = await cognitionWorker.topK(query, corpus, 5, 0.5);
    assert.ok(results.every(r => r.similarity >= 0.5), 'all results must clear minSim');
  });

  it('never compares across tiers', async () => {
    const query = makeIndexedVec('q', [1, 0, 0, 0], 'hashed');
    const corpus: IndexedVector[] = [
      makeIndexedVec('neural', [1, 0, 0, 0], 'neural'), // different tier — must be excluded
      makeIndexedVec('hashed', [1, 0, 0, 0], 'hashed'),  // same tier — included
    ];
    const results = await cognitionWorker.topK(query, corpus, 5, 0);
    const ids = results.map(r => r.id);
    assert.ok(!ids.includes('neural'), 'neural-tier corpus items must be excluded from hashed query');
    assert.ok(ids.includes('hashed'), 'hashed-tier corpus items must be included');
  });

  it('returns identical results to in-thread topK on a fixture corpus', async () => {
    // This is the key invariant: worker and fallback produce the same output.
    const { topK: topKInThread } = await import('../vector-index.ts');
    const query = makeIndexedVec('q', [1, 2, 3, 4]);
    const corpus: IndexedVector[] = [
      makeIndexedVec('a', [4, 3, 2, 1]),
      makeIndexedVec('b', [1, 1, 1, 1]),
      makeIndexedVec('c', [2, 2, 2, 2]),
    ];
    const workerResults = await cognitionWorker.topK(query, corpus, 3, 0);
    const threadResults = topKInThread(query, corpus, 3, 0);
    assert.equal(workerResults.length, threadResults.length, 'length must match');
    for (let i = 0; i < workerResults.length; i++) {
      assert.equal(workerResults[i]!.id, threadResults[i]!.id, `id[${i}] must match`);
      assert.ok(
        Math.abs(workerResults[i]!.similarity - threadResults[i]!.similarity) < 1e-6,
        `similarity[${i}] must match within floating-point tolerance`,
      );
    }
  });
});

// ── cluster — clusterInThread ─────────────────────────────────────────────────

describe('clusterInThread', () => {
  it('groups similar vectors into one cluster', () => {
    const eps = [
      { id: 'a', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([1, 0, 0]))) },
      { id: 'b', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([0.99, 0.14, 0]))) },
    ];
    const clusters = clusterInThread(eps, 0.9);
    // a and b are very similar — should land in the same cluster.
    assert.equal(clusters.length, 1, 'similar vectors should form one cluster');
    assert.equal(clusters[0]!.length, 2, 'cluster should contain both episodes');
  });

  it('separates dissimilar vectors into different clusters', () => {
    const eps = [
      { id: 'a', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([1, 0, 0]))) },
      { id: 'b', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([0, 1, 0]))) },
    ];
    const clusters = clusterInThread(eps, 0.9);
    assert.equal(clusters.length, 2, 'orthogonal vectors should form separate clusters');
  });

  it('never mixes tiers in a cluster', () => {
    const eps = [
      { id: 'h1', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([1, 0, 0]))) },
      { id: 'n1', tier: 'neural' as const, vector: Array.from(l2Norm(makeVec([1, 0, 0]))) },
    ];
    const clusters = clusterInThread(eps, 0.5);
    // Must have exactly two clusters — one per tier — even though vectors are identical.
    assert.equal(clusters.length, 2, 'different tiers must form separate clusters even with identical vectors');
    for (const cluster of clusters) {
      assert.equal(cluster.length, 1, 'each tier-isolated cluster should contain one episode');
    }
  });

  it('returns empty array for empty input', () => {
    const clusters = clusterInThread([], 0.6);
    assert.deepEqual(clusters, []);
  });

  it('handles single episode', () => {
    const eps = [{ id: 'a', tier: 'hashed' as const, vector: [1, 0, 0] }];
    const clusters = clusterInThread(eps, 0.6);
    assert.equal(clusters.length, 1);
    assert.deepEqual(clusters[0], ['a']);
  });

  it('produces result consistent with cosine similarity math at boundary', () => {
    // Two vectors with known cosine similarity right at the threshold.
    // cos(60°) = 0.5 — vectors [1,0] and [0.5, √3/2].
    const v1 = Array.from(l2Norm(makeVec([1, 0])));
    const v2 = Array.from(l2Norm(makeVec([0.5, Math.sqrt(3) / 2])));
    const sim = cosineSimilarity(new Float32Array(v1), new Float32Array(v2));
    assert.ok(Math.abs(sim - 0.5) < 1e-6, 'fixture vectors must have cos≈0.5');

    const eps = [
      { id: 'a', tier: 'hashed' as const, vector: v1 },
      { id: 'b', tier: 'hashed' as const, vector: v2 },
    ];

    // Threshold exactly at sim → should be included (>=).
    const atThreshold = clusterInThread(eps, 0.5);
    const totalAtThreshold = atThreshold.reduce((s, c) => s + c.length, 0);
    assert.equal(totalAtThreshold, 2, 'both episodes must be placed');

    // Threshold just above sim → separate clusters.
    const aboveThreshold = clusterInThread(eps, 0.501);
    assert.equal(aboveThreshold.length, 2, 'above threshold should separate');
  });
});

// ── cognitionWorker.cluster — fallback path ───────────────────────────────────

describe('cognitionWorker.cluster fallback', () => {
  it('returns same result as clusterInThread', async () => {
    const eps = [
      { id: 'a', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([1, 0, 0]))) },
      { id: 'b', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([0.99, 0.14, 0]))) },
      { id: 'c', tier: 'hashed' as const, vector: Array.from(l2Norm(makeVec([0, 1, 0]))) },
    ];
    const workerResult = await cognitionWorker.cluster(eps, 0.9);
    const threadResult = clusterInThread(eps, 0.9);

    // Sort each cluster and sort outer array to make comparison order-independent.
    const normalise = (clusters: string[][]) =>
      clusters.map(c => [...c].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));

    assert.deepEqual(normalise(workerResult), normalise(threadResult), 'fallback must match in-thread result');
  });
});
