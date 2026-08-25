import type { ObservationEvent } from '../intelligence/observation-adapters';

export const CROSS_EVENT_HISTORY_LIMIT = 512;
export const CROSS_EVENT_HISTORY_WINDOW_MS = 14 * 24 * 60 * 60_000;
export const CROSS_EVENT_MAX_FUTURE_SKEW_MS = 5 * 60_000;

type Correlate = (
  current: ObservationEvent,
  history: readonly ObservationEvent[],
) => void;

type Schedule = (callback: () => void) => (() => void) | void;

export interface CrossEventCorrelationHandoffOptions {
  correlate: Correlate;
  schedule?: Schedule;
  clock?: () => number;
  maxEvents?: number;
  maxAgeMs?: number;
}

export class CrossEventCorrelationHandoff {
  private readonly correlate: Correlate;
  private readonly schedule: Schedule;
  private readonly clock: () => number;
  private readonly maxEvents: number;
  private readonly maxAgeMs: number;
  private readonly history: ObservationEvent[] = [];
  private readonly pending: ObservationEvent[] = [];
  private readonly retainedIds = new Set<string>();
  private watermark = Number.NEGATIVE_INFINITY;
  private cancelScheduled?: () => void;
  private scheduled = false;
  private stopped = false;

  constructor(options: CrossEventCorrelationHandoffOptions) {
    this.correlate = options.correlate;
    this.schedule = options.schedule ?? ((callback) => {
      const timer = setTimeout(callback, 0);
      return () => clearTimeout(timer);
    });
    this.clock = options.clock ?? Date.now;
    this.maxEvents = positiveInteger(options.maxEvents) ?? CROSS_EVENT_HISTORY_LIMIT;
    this.maxAgeMs = positiveFinite(options.maxAgeMs) ?? CROSS_EVENT_HISTORY_WINDOW_MS;
  }

  offer(event: ObservationEvent): boolean {
    const now = this.clock();
    if (
      this.stopped
      || !Number.isFinite(now)
      || !Number.isFinite(event.timestamp)
      || event.timestamp > now + CROSS_EVENT_MAX_FUTURE_SKEW_MS
      || this.retainedIds.has(event.id)
    ) {
      return false;
    }
    this.watermark = Math.max(this.watermark, event.timestamp);
    this.pruneExpired();
    while (this.history.length + this.pending.length >= this.maxEvents) {
      this.evictOldest();
    }
    this.pending.push(event);
    this.retainedIds.add(event.id);
    return true;
  }

  resume(): void {
    if (this.stopped || this.scheduled || this.pending.length === 0) return;
    this.scheduled = true;
    const cancel = this.schedule(() => {
      this.scheduled = false;
      this.cancelScheduled = undefined;
      if (this.stopped) return;
      const current = this.pending.shift();
      if (!current) return;
      try {
        this.correlate(current, this.history);
      } catch {
        // Correlation is derived work and cannot interrupt observation ingestion.
      }
      this.history.push(current);
      this.pruneExpired();
      this.resume();
    });
    if (this.scheduled) this.cancelScheduled = cancel ?? undefined;
  }

  pause(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = undefined;
    this.scheduled = false;
  }

  stop(): void {
    this.stopped = true;
    this.pause();
    this.history.length = 0;
    this.pending.length = 0;
    this.retainedIds.clear();
  }

  stats(): { history: number; pending: number } {
    return { history: this.history.length, pending: this.pending.length };
  }

  private pruneExpired(): void {
    if (!Number.isFinite(this.watermark)) return;
    const minimumTimestamp = this.watermark - this.maxAgeMs;
    this.removeWhere(this.history, (event) => event.timestamp < minimumTimestamp);
    this.removeWhere(this.pending, (event) => event.timestamp < minimumTimestamp);
  }

  private removeWhere(
    events: ObservationEvent[],
    predicate: (event: ObservationEvent) => boolean,
  ): void {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (!predicate(event)) continue;
      events.splice(index, 1);
      this.retainedIds.delete(event.id);
    }
  }

  private evictOldest(): void {
    let oldestList = this.history;
    let oldestIndex = 0;
    let oldest = this.history[0];
    for (const list of [this.history, this.pending]) {
      for (let index = 0; index < list.length; index += 1) {
        const candidate = list[index]!;
        if (!oldest || candidate.timestamp < oldest.timestamp) {
          oldest = candidate;
          oldestList = list;
          oldestIndex = index;
        }
      }
    }
    if (!oldest) return;
    oldestList.splice(oldestIndex, 1);
    this.retainedIds.delete(oldest.id);
  }
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined;
}

function positiveFinite(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value : undefined;
}
