/**
 * Request-budget helpers for the ML worker manager.
 *
 * Kept pure and separate from `ml-worker.ts` so the timeout arithmetic and the
 * abandoned-request bookkeeping can be exercised without constructing a Worker.
 */

import { ML_THRESHOLDS } from '@/config/ml-config';

/**
 * How long the manager should wait for an inference request.
 *
 * An inference request loads its model first whenever that model is cold, and a
 * cold load is budgeted at `modelLoadTimeoutMs` — twenty times the inference
 * budget. Charging such a request only `inferenceTimeoutMs` guarantees the
 * manager gives up while the download is still in flight: the caller gets a
 * misleading "timed out", and the worker's real failure arrives afterwards
 * against a request id nobody is waiting on any more.
 */
export function inferenceTimeoutFor(isModelLoaded: boolean): number {
  return isModelLoaded
 ? ML_THRESHOLDS.inferenceTimeoutMs
 : ML_THRESHOLDS.modelLoadTimeoutMs + ML_THRESHOLDS.inferenceTimeoutMs;
}

/**
 * Bounded record of request ids the manager stopped waiting on, so a late reply
 * from the worker can be recognized as already-reported rather than unsolicited.
 *
 * Reporting a late reply at error level counts one failure twice: the caller was
 * already rejected when the request timed out.
 */
export class AbandonedRequestIds {
  private readonly ids = new Set<string>();

  constructor(private readonly limit = 100) {}

  /** Record an id, evicting the oldest once the cap is reached. */
  add(id: string): void {
 if (this.ids.size >= this.limit) {
 const oldest = this.ids.values().next().value;
 if (oldest !== undefined) this.ids.delete(oldest);
 }
 this.ids.add(id);
  }

  /**
 * True when this id was abandoned. Consumes the entry, so a repeat reply for
 * the same id is treated as genuinely unsolicited rather than silenced twice.
 */
  claim(id: string): boolean {
 return this.ids.delete(id);
  }

  get size(): number {
 return this.ids.size;
  }
}
