/**
 * Cognition Web Worker — offloads CPU-intensive cognition tasks from the main thread.
 *
 * Handles two task kinds:
 *   - topk: cosine similarity scan over a corpus of vectors (up to 2000 × 768)
 *   - cluster: greedy threshold clustering for memory consolidation
 *
 * Same Vite ?worker import pattern as ml.worker.ts. Request/response correlation
 * via a per-request string id. Falls back to the main-thread path when Worker is
 * unavailable (Node.js tests, SSR, older browsers).
 *
 * Pure math only — this worker imports vector-index.ts for cosine ops.
 * No fetch, no DOM, no globals at import time.
 */

import { cosineSimilarity, topK } from '@/services/cognition/vector-index';
import type { IndexedVector, SimilarityResult } from '@/services/cognition/vector-index';

// ── Message types ─────────────────────────────────────────────────────────────

export interface TopKRequest {
  type: 'topk';
  id: string;
  query: { id: string; vector: number[]; tier: 'neural' | 'hashed' };
  corpus: Array<{ id: string; vector: number[]; tier: 'neural' | 'hashed' }>;
  k: number;
  minSim: number;
}

export interface ClusterRequest {
  type: 'cluster';
  id: string;
  /** Flat list of episodes; each carries its vector as a plain number[]. */
  episodes: Array<{
    id: string;
    tier: 'neural' | 'hashed';
    vector: number[];
    resolvedAt?: number;
    outcome?: string;
  }>;
  simThreshold: number;
}

export interface TopKResponse {
  type: 'topk-result';
  id: string;
  results: SimilarityResult[];
}

export interface ClusterResponse {
  type: 'cluster-result';
  id: string;
  /** Each inner array is a cluster of episode ids. */
  clusters: string[][];
}

export interface ErrorResponse {
  type: 'error';
  id?: string;
  error: string;
}

export interface ReadyResponse {
  type: 'worker-ready';
}

export type CognitionWorkerRequest = TopKRequest | ClusterRequest;
export type CognitionWorkerResponse = TopKResponse | ClusterResponse | ErrorResponse | ReadyResponse;

// ── Clustering logic (mirrors consolidation.ts — logic lives HERE, no duplication) ──

interface EpisodeRef {
  id: string;
  tier: 'neural' | 'hashed';
  vector: number[];
}

/**
 * Greedy threshold clustering of episodes by cosine similarity.
 * Same algorithm as consolidation.ts — the worker imports it from here
 * (consolidation.ts delegates via cognition-worker.ts when the Worker is available).
 * Pure math: no imports beyond vector-index.
 */
function clusterEpisodes(episodes: EpisodeRef[], simThreshold: number): string[][] {
  if (episodes.length === 0) return [];

  // Group by tier — never compare across tiers (vector-index invariant).
  const byTier = new Map<string, EpisodeRef[]>();
  for (const ep of episodes) {
    const group = byTier.get(ep.tier) ?? [];
    group.push(ep);
    byTier.set(ep.tier, group);
  }

  const allClusters: string[][] = [];

  for (const [, tierEps] of byTier) {
    const unassigned = new Set<number>(tierEps.map((_, i) => i));

    while (unassigned.size > 0) {
      // Seed: unassigned episode with highest L2 norm.
      let seedIdx = -1;
      let bestNorm = -1;
      for (const i of unassigned) {
        const ep = tierEps[i]!;
        let norm = 0;
        for (const v of ep.vector) norm += v * v;
        if (norm > bestNorm) { bestNorm = norm; seedIdx = i; }
      }
      if (seedIdx === -1) break;

      unassigned.delete(seedIdx);
      const seed = tierEps[seedIdx]!;
      const seedVec = new Float32Array(seed.vector);
      const clusterIds: string[] = [seed.id];

      for (const i of [...unassigned]) {
        const candidate = tierEps[i]!;
        if (candidate.vector.length !== seedVec.length) continue;
        const sim = cosineSimilarity(seedVec, new Float32Array(candidate.vector));
        if (sim >= simThreshold) {
          clusterIds.push(candidate.id);
          unassigned.delete(i);
        }
      }

      allClusters.push(clusterIds);
    }
  }

  return allClusters;
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<CognitionWorkerRequest>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'topk': {
        const queryVec: IndexedVector = {
          id: msg.query.id,
          vector: new Float32Array(msg.query.vector),
          tier: msg.query.tier,
        };
        const corpusVecs: IndexedVector[] = msg.corpus.map(c => ({
          id: c.id,
          vector: new Float32Array(c.vector),
          tier: c.tier,
        }));
        const results = topK(queryVec, corpusVecs, msg.k, msg.minSim);
        const response: TopKResponse = { type: 'topk-result', id: msg.id, results };
        self.postMessage(response);
        break;
      }

      case 'cluster': {
        const clusters = clusterEpisodes(msg.episodes, msg.simThreshold);
        const response: ClusterResponse = { type: 'cluster-result', id: msg.id, clusters };
        self.postMessage(response);
        break;
      }

      default: {
        const response: ErrorResponse = {
          type: 'error',
          error: `Unknown message type: ${String((msg as { type: string }).type)}`,
        };
        self.postMessage(response);
      }
    }
  } catch (err) {
    const response: ErrorResponse = {
      type: 'error',
      id: (msg as { id?: string }).id,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

// Signal ready on load.
const readyMsg: ReadyResponse = { type: 'worker-ready' };
self.postMessage(readyMsg);
