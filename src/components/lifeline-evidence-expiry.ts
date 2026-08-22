import type { LocalLogisticsSnapshot } from '../services/local-logistics-types';

export const MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS = 60 * 60_000;

export interface LifelineEvidenceIdentity {
  placeId: string;
  queryFingerprint: string;
}

interface LifelineEvidenceExpirySchedulerOptions {
  onExpiry: (snapshot: LocalLogisticsSnapshot, expiresAt: number) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface ExpiredLifelineEvidenceEffects {
  isCurrent: (identity: LifelineEvidenceIdentity) => boolean;
  renderAtExpiry: () => void;
  clearExactOverlay: (identity: LifelineEvidenceIdentity) => void;
  publishSnapshot: (snapshot: LocalLogisticsSnapshot) => void;
}

function expiryTimes(snapshot: LocalLogisticsSnapshot): number[] {
  return [
    ...snapshot.nodes,
    ...snapshot.observations,
    ...snapshot.areaConditions,
  ].map((item) => item.expiresAt.getTime()).filter((expiresAt) => Number.isFinite(expiresAt));
}

function nextFutureExpiry(snapshot: LocalLogisticsSnapshot, now: number): number | null {
  let next: number | null = null;
  for (const expiresAt of expiryTimes(snapshot)) {
    // Already-expired evidence is already rendered as unknown. Ignoring it
    // here prevents a zero-delay rescheduling loop.
    if (expiresAt <= now) continue;
    if (next === null || expiresAt < next) next = expiresAt;
  }
  return next;
}

/**
 * Owns at most one timer for an accepted exact-place Lifelines snapshot.
 * Long waits are chunked so browser timer overflow or a wall-clock change
 * cannot strand an expiry transition indefinitely.
 */
export class LifelineEvidenceExpiryScheduler {
  private readonly onExpiry: LifelineEvidenceExpirySchedulerOptions['onExpiry'];
  private readonly now: () => number;
  private readonly setTimer: NonNullable<LifelineEvidenceExpirySchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<LifelineEvidenceExpirySchedulerOptions['clearTimer']>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentSnapshot: LocalLogisticsSnapshot | null = null;
  private generation = 0;
  private destroyed = false;

  constructor(options: LifelineEvidenceExpirySchedulerOptions) {
    this.onExpiry = options.onExpiry;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => globalThis.clearTimeout(handle));
  }

  public track(snapshot: LocalLogisticsSnapshot | null): void {
    if (this.destroyed) return;
    this.generation += 1;
    this.cancelTimer();
    this.currentSnapshot = snapshot;
    if (snapshot) this.schedule(snapshot, this.generation);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.currentSnapshot = null;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(snapshot: LocalLogisticsSnapshot, generation: number): void {
    if (this.destroyed || generation !== this.generation || this.currentSnapshot !== snapshot) return;
    const now = this.now();
    const expiresAt = nextFutureExpiry(snapshot, now);
    if (expiresAt === null) return;
    const delayMs = Math.min(expiresAt - now, MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS);
    this.timer = this.setTimer(() => {
      if (this.destroyed || generation !== this.generation || this.currentSnapshot !== snapshot) return;
      this.timer = null;
      if (this.now() < expiresAt) {
        this.schedule(snapshot, generation);
        return;
      }
      try {
        this.onExpiry(snapshot, expiresAt);
      } finally {
        if (!this.destroyed && generation === this.generation && this.currentSnapshot === snapshot) {
          this.schedule(snapshot, generation);
        }
      }
    }, delayMs);
  }
}

/** Apply the three visible expiry effects only to the still-current exact query. */
export function applyExpiredLifelineEvidenceTransition(
  snapshot: LocalLogisticsSnapshot,
  effects: ExpiredLifelineEvidenceEffects,
): boolean {
  const identity = {
    placeId: snapshot.placeId,
    queryFingerprint: snapshot.queryFingerprint,
  };
  if (!effects.isCurrent(identity)) return false;
  effects.renderAtExpiry();
  effects.clearExactOverlay(identity);
  effects.publishSnapshot(snapshot);
  return true;
}
