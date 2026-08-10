/**
 * Worker Manager for heavy computational tasks.
 * Provides typed async interface to the analysis Web Worker.
 */

import type { NewsItem, ClusteredEvent, MarketData } from '@/types';
import type { PredictionMarket } from '@/services/prediction';
import type { CorrelationSignal } from './correlation';
import { SOURCE_TIERS, SOURCE_TYPES, type SourceType } from '@/config/feeds';
import { boundCorrelationClusters, shouldExtendAnalysisTimeout } from './analysis-input';
import { slog } from './structured-log';

// Import worker using Vite's worker syntax
import AnalysisWorker from '@/workers/analysis.worker?worker';

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AnalysisWorkerManagerOptions {
  createWorker?: () => Worker;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface ClusterResult {
  type: 'cluster-result';
  id: string;
  clusters: ClusteredEvent[];
}

interface CorrelationResult {
  type: 'correlation-result';
  id: string;
  signals: CorrelationSignal[];
}

type WorkerResult = ClusterResult | CorrelationResult | { type: 'ready' };

export class AnalysisWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private requestIdCounter = 0;
  private isReady = false;

  private readonly createWorker: () => Worker;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(options: AnalysisWorkerManagerOptions = {}) {
 this.createWorker = options.createWorker ?? (() => new AnalysisWorker());
 this.now = options.now ?? (() => performance.now());
 this.setTimer = options.setTimer ?? setTimeout;
 this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  /**
 * Initialize the worker. Called lazily on first use.
 */
  private initWorker(): void {
 if (this.worker) return;

 let worker: Worker;
 try {
 worker = this.createWorker();
 } catch (error) {
 const workerError = error instanceof Error ? error : new Error(String(error));
 slog('error', 'analysis-worker', 'Failed to create worker', {
 fields: { error: workerError.message },
 });
 throw workerError;
 }
 this.worker = worker;

 worker.addEventListener('message', (event: MessageEvent<WorkerResult>) => {
 if (this.worker !== worker) return;
 const data = event.data;

 if (data.type === 'ready') {
 this.isReady = true;
 return;
 }

 if ('id' in data) {
 const pending = this.pendingRequests.get(data.id);
 if (pending) {
 this.clearTimer(pending.timeout);
 this.pendingRequests.delete(data.id);

 if (data.type === 'cluster-result') {
 // Deserialize dates
 const clusters = data.clusters.map(cluster => ({
 ...cluster,
 firstSeen: new Date(cluster.firstSeen),
 lastUpdated: new Date(cluster.lastUpdated),
 evidence: cluster.evidence ? {
 ...cluster.evidence,
 firstSeen: new Date(cluster.evidence.firstSeen),
 lastUpdated: new Date(cluster.evidence.lastUpdated),
 } : undefined,
 allItems: cluster.allItems.map(item => ({
 ...item,
 pubDate: new Date(item.pubDate),
 })),
 }));
 pending.resolve(clusters);
 } else if (data.type === 'correlation-result') {
 // Deserialize dates
 const signals = data.signals.map(signal => ({
 ...signal,
 timestamp: new Date(signal.timestamp),
 evidence: signal.evidence ? {
 ...signal.evidence,
 firstSeen: new Date(signal.evidence.firstSeen),
 lastUpdated: new Date(signal.evidence.lastUpdated),
 } : undefined,
 }));
 pending.resolve(signals);
 }
 }
 }
 });

 worker.addEventListener('error', (error) => {
 if (this.worker !== worker) return;
 slog('error', 'analysis-worker', 'Worker error', { fields: { error: error.message } });

 // Reject all pending requests
 for (const [id, pending] of this.pendingRequests) {
 this.clearTimer(pending.timeout);
 pending.reject(new Error(`Worker error: ${error.message}`));
 this.pendingRequests.delete(id);
 }
 this.cleanup();
 });
  }

  /**
 * Cleanup worker state (for re-initialization)
 */
  private cleanup(): void {
 if (this.worker) {
 this.worker.terminate();
 this.worker = null;
 }
 this.isReady = false;
 }

  /**
 * Generate unique request ID
 */
  private generateId(): string {
 return `req-${++this.requestIdCounter}-${Date.now()}`;
  }

  /**
 * Cluster news articles using Web Worker.
 * Runs O(n²) Jaccard similarity off the main thread.
 */
  async clusterNews(items: NewsItem[]): Promise<ClusteredEvent[]> {
 this.initWorker();

 return new Promise((resolve, reject) => {
 const id = this.generateId();

 // Set timeout (30 seconds - clustering can take a while for large datasets)
 const timeout = this.setTimer(() => {
 this.pendingRequests.delete(id);
 reject(new Error('Clustering request timed out'));
 }, 30_000);

 this.pendingRequests.set(id, {
 resolve: resolve as (value: unknown) => void,
 reject,
 timeout,
 });

 this.worker!.postMessage({
 type: 'cluster',
 id,
 items,
 sourceTiers: SOURCE_TIERS,
 });
 });
  }

  /**
 * Run correlation analysis using Web Worker.
 * Detects signal patterns across news, markets, and predictions.
 */
  async analyzeCorrelations(
 clusters: ClusteredEvent[],
 predictions: PredictionMarket[],
 markets: MarketData[]
  ): Promise<CorrelationSignal[]> {
 this.initWorker();
 const boundedClusters = boundCorrelationClusters(clusters);

 return new Promise((resolve, reject) => {
 const id = this.generateId();
 const timeoutMs = 10_000;
 let deadlineMs = this.now() + timeoutMs;
 let timeoutExtended = false;

 // Set timeout (10 seconds should be plenty for correlation)
 const onTimeout = () => {
 const pending = this.pendingRequests.get(id);
 if (!pending) return;
 if (shouldExtendAnalysisTimeout(this.now(), deadlineMs, timeoutExtended)) {
 timeoutExtended = true;
 deadlineMs = this.now() + timeoutMs;
 pending.timeout = this.setTimer(onTimeout, timeoutMs);
 return;
 }
 this.pendingRequests.delete(id);
 reject(new Error('Correlation analysis request timed out'));
 };
 const timeout = this.setTimer(onTimeout, timeoutMs);

 this.pendingRequests.set(id, {
 resolve: resolve as (value: unknown) => void,
 reject,
 timeout,
 });

 this.worker!.postMessage({
 type: 'correlation',
 id,
 clusters: boundedClusters,
 predictions,
 markets,
 sourceTypes: SOURCE_TYPES as Record<string, SourceType>,
 });
 });
  }

  /**
 * Reset worker state (useful for testing)
 */
  reset(): void {
 // Reject all pending requests - reset worker won't answer old queries
 for (const pending of this.pendingRequests.values()) {
 this.clearTimer(pending.timeout);
 pending.reject(new Error('Worker reset'));
 }
 this.pendingRequests.clear();

 if (this.worker) {
 this.worker.postMessage({ type: 'reset' });
 }
  }

  /**
 * Terminate worker (cleanup)
 */
  terminate(): void {
 // Reject all pending requests
 for (const [id, pending] of this.pendingRequests) {
 this.clearTimer(pending.timeout);
 pending.reject(new Error('Worker terminated'));
 this.pendingRequests.delete(id);
 }
 this.cleanup();
  }

  /**
 * Check if worker is available and ready
 */
  get ready(): boolean {
 return this.isReady;
  }
}

// Singleton instance
export const analysisWorker = new AnalysisWorkerManager();

// Export types for consumers


export {type CorrelationSignal} from './correlation';
