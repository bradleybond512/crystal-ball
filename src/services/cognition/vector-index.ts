/**
 * Vector Index — pure cosine similarity + top-K retrieval.
 *
 * Brute-force scan is intentional: the episode cap is 2 000 (episodic-memory.ts),
 * so worst case is 2 000 × 768 multiply-adds ≈ 1.5 M flops — sub-millisecond.
 * No ANN library is introduced; this module has zero new runtime dependencies.
 *
 * Tier partitioning: vectors of different tiers (neural vs hashed) are NEVER
 * compared against each other. topK filters the corpus to the query's tier
 * before computing any similarities. This prevents apples-to-oranges comparison
 * when Ollama comes and goes.
 *
 * Pure module: no DOM, no fetch, no globals at import time. All functions are
 * deterministic given their inputs and are safe to call in Node.js test runners.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface IndexedVector {
  id: string;
  vector: Float32Array;
  tier: 'neural' | 'hashed';
}

export interface SimilarityResult {
  id: string;
  similarity: number; // 0–1
}

// ── Core math ─────────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two L2-normalized vectors.
 *
 * Assumes both vectors are already L2-normalized (as produced by
 * embedHashed and tryNeuralEmbedding in embedding-provider.ts).
 * For normalized vectors, cosine similarity = dot product.
 *
 * Returns a value in [-1, 1]; for unit embeddings this is effectively [0, 1].
 * Throws if vectors differ in length.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `[vector-index] dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  // Clamp to [-1, 1] to absorb floating-point error on pre-normalized inputs.
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Return the top-K most similar vectors from corpus to the query, filtering
 * by tier first (never compare across tiers) and applying an optional
 * minimum similarity threshold.
 *
 * Results are sorted descending by similarity. If fewer than K items clear
 * the threshold, the shorter list is returned (no padding).
 */
export function topK(
  query: IndexedVector,
  corpus: readonly IndexedVector[],
  k: number,
  minSim = 0,
): SimilarityResult[] {
  const sameTier = corpus.filter(v => v.tier === query.tier && v.id !== query.id);
  const scored: SimilarityResult[] = [];
  for (const candidate of sameTier) {
    const sim = cosineSimilarity(query.vector, candidate.vector);
    if (sim >= minSim) {
      scored.push({ id: candidate.id, similarity: sim });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}
