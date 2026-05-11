/**
 * Observation Store — 1000-event ring buffer for normalized ObservationEvents.
 *
 * Uses a fixed-size array + head pointer so inserts are O(1). The oldest
 * event is silently overwritten when the buffer is full.
 *
 * Thread-safety note: JavaScript is single-threaded, so concurrent mutation
 * during a query snapshot is not possible.
 */

import type { ObservationEvent } from '@/types/intelligence';

const CAPACITY = 1000;

const buffer: (ObservationEvent | undefined)[] = Array.from({ length: CAPACITY });
let head = 0;
let count = 0;

/** Append one or more events. Overwrites oldest when buffer is full. */
export function ingest(events: ObservationEvent | ObservationEvent[]): void {
  const evts = Array.isArray(events) ? events : [events];
  for (const evt of evts) {
    buffer[head] = evt;
    head = (head + 1) % CAPACITY;
    if (count < CAPACITY) count++;
  }
}

export interface ObservationQuery {
  domain?: string;
  sourceId?: string;
  /** Only include events at or after this epoch ms. */
  since?: number;
  /** Only include events at or before this epoch ms. */
  until?: number;
  /** Filter by tag (event must include this tag). */
  tag?: string;
  /** Max results to return, newest first. Default: 100. */
  limit?: number;
}

function matchesQuery(evt: ObservationEvent, q: ObservationQuery): boolean {
  if (q.domain && evt.domain !== q.domain) return false;
  if (q.sourceId && evt.sourceId !== q.sourceId) return false;
  if (q.since != null && evt.timestamp < q.since) return false;
  if (q.until != null && evt.timestamp > q.until) return false;
  if (q.tag && !evt.tags.includes(q.tag)) return false;
  return true;
}

/** Return matching events, newest first. */
export function query(q: ObservationQuery = {}): ObservationEvent[] {
  const limit = q.limit ?? 100;
  const results: ObservationEvent[] = [];

  // Walk backwards from head - 1 (newest) to head (oldest)
  for (let i = 0; i < count; i++) {
    const idx = (head - 1 - i + CAPACITY) % CAPACITY;
    const evt = buffer[idx];
    if (!evt) continue;
    if (!matchesQuery(evt, q)) continue;
    results.push(evt);
    if (results.length >= limit) break;
  }

  return results;
}

/** Return up to `n` most-recent events across all domains. */
export function getRecent(n = 20): ObservationEvent[] {
  return query({ limit: n });
}

export function storeSize(): number {
  return count;
}

/** Exposed for tests only. */
export function _clearStoreForTests(): void {
  buffer.fill(undefined);
  head = 0;
  count = 0;
}
