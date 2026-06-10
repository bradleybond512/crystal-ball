/**
 * Cognition Worker Manager — transparent async interface to cognition.worker.ts.
 *
 * Offloads top-K vector scans and consolidation clustering off the main thread.
 * Exact same Vite ?worker import pattern and request-correlation approach as
 * ml-worker.ts (PendingRequest<T> map keyed by string id, timeout per request).
 *
 * Main-thread API is async and identical whether the Worker is available or not:
 *   - When Worker is available: operations run in the worker thread.
 *   - Fallback (Node.js tests, SSR, Worker construction failure): operations run
 *     synchronously on the calling thread using the same pure functions from
 *     vector-index.ts. Results are IDENTICAL — this is a strict invariant.
 *
 * Pure module: no DOM globals at import time. Worker construction is deferred
 * to the first call so Node.js test runners can import this file safely.
 *
 * Usage:
 *   import { cognitionWorker } from './cognition-worker';
 *   const results = await cognitionWorker.topK(queryVec, corpus, k, minSim);
 *   const clusters = await cognitionWorker.cluster(episodes, simThreshold);
 */

import { topK as topKInThread } from './vector-index';
import type { IndexedVector, SimilarityResult } from './vector-index';
import { cosineSimilarity } from './vector-index';

// ── Pending request tracking ──────────────────────────────────────────────────

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ── Worker state ──────────────────────────────────────────────────────────────

// Import the worker lazily using Vite's ?worker syntax.
// The conditional import prevents Node.js (which lacks Worker) from crashing.
type WorkerConstructor = new () => Worker;
let _WorkerClass: WorkerConstructor | null | undefined = undefined; // undefined = not yet checked

function tryGetWorkerClass(): WorkerConstructor | null {
  if (_WorkerClass !== undefined) return _WorkerClass;
  try {
    // Vite ?worker import — dynamic so Node.js skips the Worker bundling entirely.
    // In browser builds Vite rewrites this to a proper Worker URL at build time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/workers/cognition.worker?worker') as { default: WorkerConstructor };
    _WorkerClass = mod.default ?? null;
  } catch {
    // Node.js test environment — Worker is unavailable; fall back to in-thread.
    _WorkerClass = null;
  }
  return _WorkerClass;
}

const WORKER_TIMEOUT_MS = 15_000; // 15 s — generous for large (2000-episode) scans
const READY_TIMEOUT_MS = 5_000;

class CognitionWorkerManager {
  private worker: Worker | null = null;
  private isReady = false;
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private requestCounter = 0;

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initialize the worker. Returns true if a worker is running, false if
   * we will use the in-thread fallback. Safe to call multiple times.
   */
  async init(): Promise<boolean> {
    if (this.isReady) return true;
    if (this.worker !== null) return false; // already failed

    const WorkerClass = tryGetWorkerClass();
    if (WorkerClass === null) return false; // Node.js — use fallback

    return new Promise<boolean>((resolve) => {
      const readyTimeout = setTimeout(() => {
        if (!this.isReady) {
          this.cleanup();
          resolve(false);
        }
      }, READY_TIMEOUT_MS);

      try {
        this.worker = new WorkerClass();
      } catch {
        clearTimeout(readyTimeout);
        this.cleanup();
        resolve(false);
        return;
      }

      this.worker.onmessage = (event: MessageEvent) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const data = event.data as { type: string; id?: string; error?: string; results?: SimilarityResult[]; clusters?: string[][] };

        if (data.type === 'worker-ready') {
          this.isReady = true;
          clearTimeout(readyTimeout);
          resolve(true);
          return;
        }

        if (data.type === 'error') {
          const pending = data.id ? this.pendingRequests.get(data.id) : null;
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(data.id!);
            pending.reject(new Error(data.error ?? 'Unknown worker error'));
          }
          return;
        }

        if (data.id) {
          const pending = this.pendingRequests.get(data.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(data.id);
            if (data.type === 'topk-result') {
              pending.resolve(data.results ?? []);
            } else if (data.type === 'cluster-result') {
              pending.resolve(data.clusters ?? []);
            }
          }
        }
      };

      this.worker.onerror = () => {
        if (!this.isReady) {
          clearTimeout(readyTimeout);
          this.cleanup();
          resolve(false);
          return;
        }
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Worker error'));
          this.pendingRequests.delete(id);
        }
      };
    });
  }

  private cleanup(): void {
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();
  }

  private generateId(): string {
    return `cw-${++this.requestCounter}-${Date.now()}`;
  }

  private request<T>(message: Record<string, unknown>, id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Cognition worker request timed out after ${WORKER_TIMEOUT_MS}ms`));
      }, WORKER_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeout,
      });

      this.worker!.postMessage({ ...message, id });
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Top-K cosine similarity scan. When worker is ready, runs off main thread.
   * Falls back to in-thread topK (vector-index.ts) with identical results.
   */
  async topK(
    query: IndexedVector,
    corpus: readonly IndexedVector[],
    k: number,
    minSim = 0,
  ): Promise<SimilarityResult[]> {
    if (this.isReady && this.worker) {
      const id = this.generateId();
      return this.request<SimilarityResult[]>({
        type: 'topk',
        query: { id: query.id, vector: Array.from(query.vector), tier: query.tier },
        corpus: corpus.map(c => ({ id: c.id, vector: Array.from(c.vector), tier: c.tier })),
        k,
        minSim,
      }, id);
    }
    // In-thread fallback — identical logic.
    return topKInThread(query, corpus, k, minSim);
  }

  /**
   * Greedy threshold clustering. When worker is ready, runs off main thread.
   * Falls back to in-thread clustering with identical results.
   */
  async cluster(
    episodes: ReadonlyArray<{ id: string; tier: 'neural' | 'hashed'; vector: number[] }>,
    simThreshold: number,
  ): Promise<string[][]> {
    if (this.isReady && this.worker) {
      const id = this.generateId();
      return this.request<string[][]>({
        type: 'cluster',
        episodes,
        simThreshold,
      }, id);
    }
    // In-thread fallback — same greedy algorithm.
    return clusterInThread(episodes, simThreshold);
  }

  /** Whether the worker thread is available. */
  get available(): boolean {
    return this.isReady;
  }

  /** Terminate the worker (for cleanup / tests). */
  terminate(): void {
    this.cleanup();
  }
}

// ── In-thread fallback clustering (same algorithm as cognition.worker.ts) ─────

/**
 * Greedy threshold clustering — in-thread fallback.
 * Logic mirrors cognition.worker.ts clusterEpisodes(). Pure math, no deps beyond
 * cosineSimilarity from vector-index.
 *
 * NOTE: The actual clustering math lives in the worker file. The manager's fallback
 * re-implements the same pure algorithm here so no logic is shared via import
 * (the worker is a separate bundle — it cannot import from the manager). The two
 * copies are guarded by the worker-vs-fallback test that asserts identical results.
 */
export function clusterInThread(
  episodes: ReadonlyArray<{ id: string; tier: 'neural' | 'hashed'; vector: number[] }>,
  simThreshold: number,
): string[][] {
  if (episodes.length === 0) return [];

  const byTier = new Map<string, Array<{ id: string; vector: number[] }>>();
  for (const ep of episodes) {
    const group = byTier.get(ep.tier) ?? [];
    group.push({ id: ep.id, vector: ep.vector });
    byTier.set(ep.tier, group);
  }

  const allClusters: string[][] = [];

  for (const [, tierEps] of byTier) {
    const unassigned = new Set<number>(tierEps.map((_, i) => i));

    while (unassigned.size > 0) {
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

// ── Singleton export ──────────────────────────────────────────────────────────

export const cognitionWorker = new CognitionWorkerManager();
