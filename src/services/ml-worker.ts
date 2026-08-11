/* eslint-disable no-console, unicorn/prefer-add-event-listener -- pre-existing in this file; lint:ci lints changed files, so they surface on any edit here */
/**
 * ML Worker Manager
 * Provides typed async interface to the ML Web Worker for ONNX inference
 */

import { detectMLCapabilities, type MLCapabilities } from './ml-capabilities';
import { AbandonedRequestIds, inferenceTimeoutFor } from './ml-request-budget';
import { ML_THRESHOLDS, MODEL_CONFIGS } from '@/config/ml-config';

/**
 * How the manager obtains its worker.
 *
 * The default uses Vite's `?worker` syntax, which only the Vite build can
 * resolve. Importing it dynamically keeps that specifier out of the module's
 * static graph, so the manager's request bookkeeping — timeout budgets, late
 * replies, termination — can be exercised against a fake worker outside Vite.
 */
export type MLWorkerFactory = () => Worker | Promise<Worker>;

const defaultWorkerFactory: MLWorkerFactory = async () => {
  const { default: MLWorkerClass } = await import('@/workers/ml.worker?worker');
  return new MLWorkerClass();
};

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface NEREntity {
  text: string;
  type: string;
  confidence: number;
  start: number;
  end: number;
}

interface SentimentResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
}

type WorkerResult =
  | { type: 'worker-ready' }
  | { type: 'ready'; id: string }
  | { type: 'model-loaded'; id: string; modelId: string }
  | { type: 'model-unloaded'; id: string; modelId: string }
  | { type: 'model-progress'; modelId: string; progress: number }
  | { type: 'embed-result'; id: string; embeddings: number[][] }
  | { type: 'summarize-result'; id: string; summaries: string[] }
  | { type: 'sentiment-result'; id: string; results: SentimentResult[] }
  | { type: 'entities-result'; id: string; entities: NEREntity[][] }
  | { type: 'cluster-semantic-result'; id: string; clusters: number[][] }
  | { type: 'status-result'; id: string; loadedModels: string[] }
  | { type: 'model-evicted'; modelId: string }
  | { type: 'reset-complete' }
  | { type: 'error'; id?: string; error: string };

export class MLWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private requestIdCounter = 0;
  private isReady = false;
  private capabilities: MLCapabilities | null = null;
  private loadedModels = new Set<string>();
  private readyResolve: (() => void) | null = null;
  private modelProgressCallbacks = new Map<string, (progress: number) => void>();
  private abandonedRequestIds = new AbandonedRequestIds();

  private static readonly READY_TIMEOUT_MS = 10_000;

  constructor(private readonly createWorker: MLWorkerFactory = defaultWorkerFactory) {}

  /**
 * Initialize the ML worker. Returns false if ML is not supported.
 */
  async init(): Promise<boolean> {
 if (this.isReady) return true;

 // Detect capabilities
 this.capabilities = await detectMLCapabilities();

 if (!this.capabilities.isSupported) {
 return false;
 }

 return this.initWorker();
  }

  private initWorker(): Promise<boolean> {
 if (this.worker) return Promise.resolve(this.isReady);

 return new Promise((resolve) => {
 const readyTimeout = setTimeout(() => {
 if (!this.isReady) {
 console.error('[MLWorker] Worker failed to become ready');
 this.cleanup();
 resolve(false);
 }
 }, MLWorkerManager.READY_TIMEOUT_MS);

 void (async () => {
 let worker: Worker;
 try {
 worker = await this.createWorker();
 } catch (error) {
 console.error('[MLWorker] Failed to create worker:', error);
 clearTimeout(readyTimeout);
 this.cleanup();
 resolve(false);
 return;
 }
 this.worker = worker;

 worker.onmessage = (event: MessageEvent<WorkerResult>) => {
 const data = event.data;

 if (data.type === 'worker-ready') {
 this.isReady = true;
 clearTimeout(readyTimeout);
 this.readyResolve?.();
 resolve(true);
 return;
 }

 if (data.type === 'model-progress') {
 const callback = this.modelProgressCallbacks.get(data.modelId);
 callback?.(data.progress);
 return;
 }

 // Unsolicited model-loaded notification (implicit load inside summarize/sentiment/etc.)
 if (data.type === 'model-loaded' && !('id' in data && data.id)) {
 this.loadedModels.add(data.modelId);
 return;
 }

 // The worker caps how many pipelines it keeps in memory, so a model can
 // leave without anyone asking. Believing it is still resident charges the
 // next request for it the warm budget, and its implicit reload then times
 // out mid-download — the failure `inferenceTimeoutFor` exists to prevent.
 if (data.type === 'model-evicted') {
 this.loadedModels.delete(data.modelId);
 return;
 }

 if (data.type === 'error') {
 this.handleWorkerError(data.id, data.error);
 return;
 }

 if ('id' in data && data.id) {
 this.settlePendingRequest(data.id, data);
 }
 };

 worker.onerror = (error) => {
 console.error('[MLWorker] Error:', error);

 if (!this.isReady) {
 clearTimeout(readyTimeout);
 this.cleanup();
 resolve(false);
 return;
 }

 this.rejectAllPending(`Worker error: ${error.message}`);
 };
 })();
 });
  }

  private cleanup(): void {
 if (this.worker) {
 this.worker.terminate();
 this.worker = null;
 }
 this.isReady = false;
 this.rejectAllPending('ML worker terminated');
 this.loadedModels.clear();
  }

  /**
 * Settle every in-flight caller. Dropping the entries without settling them
 * strands each caller until its own timeout fires — up to the cold-load
 * budget — and that timeout then records the id as abandoned, so the reply
 * that never comes is accounted for as one the manager stopped waiting on.
 */
  private rejectAllPending(reason: string): void {
 for (const [id, pending] of this.pendingRequests) {
 clearTimeout(pending.timeout);
 this.pendingRequests.delete(id);
 pending.reject(new Error(reason));
 }
  }

  private generateRequestId(): string {
 return `ml-${++this.requestIdCounter}-${Date.now()}`;
  }

  private timeoutForInference(modelId: string): number {
 return inferenceTimeoutFor(this.loadedModels.has(modelId));
  }

  /** Resolve the pending request this reply belongs to, if it is still waiting. */
  private settlePendingRequest(id: string, data: WorkerResult): void {
 const pending = this.pendingRequests.get(id);
 if (!pending) return;

 clearTimeout(pending.timeout);
 this.pendingRequests.delete(id);

 switch (data.type) {
 case 'model-loaded': {
 this.loadedModels.add(data.modelId);
 pending.resolve(true);
 break;
 }
 case 'model-unloaded': {
 this.loadedModels.delete(data.modelId);
 pending.resolve(true);
 break;
 }
 case 'embed-result': {
 pending.resolve(data.embeddings);
 break;
 }
 case 'summarize-result': {
 pending.resolve(data.summaries);
 break;
 }
 case 'sentiment-result': {
 pending.resolve(data.results);
 break;
 }
 case 'entities-result': {
 pending.resolve(data.entities);
 break;
 }
 case 'cluster-semantic-result': {
 pending.resolve(data.clusters);
 break;
 }
 case 'status-result': {
 pending.resolve(data.loadedModels);
 break;
 }
 }
  }

  /**
 * Route an error the worker reported. A reply whose request already timed out
 * has no pending entry left: its caller was rejected at the timeout, so logging
 * it at error level would report the same failure twice.
 */
  private handleWorkerError(id: string | undefined, error: string): void {
 const pending = id ? this.pendingRequests.get(id) : null;
 if (pending) {
 clearTimeout(pending.timeout);
 this.pendingRequests.delete(id!);
 pending.reject(new Error(error));
 return;
 }

 if (id && this.abandonedRequestIds.claim(id)) {
 console.debug('[MLWorker] Late error for abandoned request:', error);
 return;
 }

 console.error('[MLWorker] Error:', error);
  }

  private request<T>(
 type: string,
 data: Record<string, unknown>,
 timeoutMs = ML_THRESHOLDS.inferenceTimeoutMs
  ): Promise<T> {
 return new Promise((resolve, reject) => {
 if (!this.worker || !this.isReady) {
 reject(new Error('ML Worker not initialized'));
 return;
 }

 const id = this.generateRequestId();
 const timeout = setTimeout(() => {
 this.pendingRequests.delete(id);
 this.abandonedRequestIds.add(id);
 reject(new Error(`ML request ${type} timed out after ${timeoutMs}ms`));
 }, timeoutMs);

 this.pendingRequests.set(id, {
 resolve: resolve as (value: unknown) => void,
 reject,
 timeout,
 });

 this.worker.postMessage({ type, id, ...data });
 });
  }

  /**
 * Load a model by ID
 */
  async loadModel(
 modelId: string,
 onProgress?: (progress: number) => void
  ): Promise<boolean> {
 if (!this.isReady) return false;
 if (this.loadedModels.has(modelId)) return true;

 if (onProgress) {
 this.modelProgressCallbacks.set(modelId, onProgress);
 }

 try {
 return await this.request<boolean>(
 'load-model',
 { modelId },
 ML_THRESHOLDS.modelLoadTimeoutMs
 );
 } finally {
 this.modelProgressCallbacks.delete(modelId);
 }
  }

  /**
 * Unload a model to free memory
 */
  async unloadModel(modelId: string): Promise<boolean> {
 if (!this.isReady || !this.loadedModels.has(modelId)) return false;
 try {
 return await this.request<boolean>('unload-model', { modelId });
 } catch {
 this.loadedModels.delete(modelId);
 return false;
 }
  }

  /**
 * Unload all optional models (non-required)
 */
  async unloadOptionalModels(): Promise<void> {
 const optionalModels = MODEL_CONFIGS.filter(m => !m.required);
 for (const model of optionalModels) {
 if (this.loadedModels.has(model.id)) {
 await this.unloadModel(model.id);
 }
 }
  }

  /**
 * Generate embeddings for texts
 */
  async embedTexts(texts: string[]): Promise<number[][]> {
 if (!this.isReady) throw new Error('ML Worker not ready');
 return this.request<number[][]>('embed', { texts }, this.timeoutForInference('embeddings'));
  }

  /**
 * Generate summaries for texts
 */
  async summarize(texts: string[], modelId?: string): Promise<string[]> {
 if (!this.isReady) throw new Error('ML Worker not ready');
 return this.request<string[]>(
 'summarize',
 { texts, ...(modelId && { modelId }) },
 this.timeoutForInference(modelId ?? 'summarization')
 );
  }

  /**
 * Classify sentiment for texts
 */
  async classifySentiment(texts: string[]): Promise<SentimentResult[]> {
 if (!this.isReady) throw new Error('ML Worker not ready');
 return this.request<SentimentResult[]>(
 'classify-sentiment',
 { texts },
 this.timeoutForInference('sentiment')
 );
  }

  /**
 * Extract named entities from texts
 */
  async extractEntities(texts: string[]): Promise<NEREntity[][]> {
 if (!this.isReady) throw new Error('ML Worker not ready');
 return this.request<NEREntity[][]>('extract-entities', { texts }, this.timeoutForInference('ner'));
  }

  /**
 * Perform semantic clustering on embeddings
 */
  async semanticCluster(
 embeddings: number[][],
 threshold = ML_THRESHOLDS.semanticClusterThreshold
  ): Promise<number[][]> {
 if (!this.isReady) throw new Error('ML Worker not ready');
 return this.request<number[][]>('cluster-semantic', { embeddings, threshold });
  }

  /**
 * High-level: Cluster items by semantic similarity
 */
  async clusterBySemanticSimilarity(
 items: { id: string; text: string }[],
 threshold = ML_THRESHOLDS.semanticClusterThreshold
  ): Promise<string[][]> {
 const embeddings = await this.embedTexts(items.map(i => i.text));
 const clusterIndices = await this.semanticCluster(embeddings, threshold);
 return clusterIndices.map(cluster =>
 cluster.map(idx => items[idx]?.id).filter((id): id is string => id !== undefined)
 );
  }

  /**
 * Get status of loaded models
 */
  async getStatus(): Promise<string[]> {
 if (!this.isReady) return [];
 return this.request<string[]>('status', {});
  }

  /**
 * Reset the worker (unload all models)
 */
  reset(): void {
 if (this.worker) {
 this.worker.postMessage({ type: 'reset' });
 this.loadedModels.clear();
 }
  }

  /**
 * Terminate the worker completely
 */
  terminate(): void {
 this.cleanup();
  }

  /**
 * Check if ML features are available
 */
  get isAvailable(): boolean {
 return this.isReady && (this.capabilities?.isSupported ?? false);
  }

  /**
 * Get detected capabilities
 */
  get mlCapabilities(): MLCapabilities | null {
 return this.capabilities;
  }

  /**
 * Get list of currently loaded models
 */
  get loadedModelIds(): string[] {
 return [...this.loadedModels];
  }

  /**
 * Check if a specific model is already loaded (no waiting)
 */
  isModelLoaded(modelId: string): boolean {
 return this.loadedModels.has(modelId);
  }
}

// Export singleton instance
export const mlWorker = new MLWorkerManager();
