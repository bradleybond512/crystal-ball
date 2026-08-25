import type { LocalLogisticsSnapshot } from '../services/local-logistics-types';
import { projectLocalLogisticsCoverage } from '../services/local-logistics';

export const MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS = 60 * 60_000;
export type LifelineExpiryKind = 'evidence' | 'provider-coverage';

export interface LifelineEvidenceIdentity {
  placeId: string;
  queryFingerprint: string;
}

interface LifelineEvidenceExpirySchedulerOptions {
  onExpiry: (snapshot: LocalLogisticsSnapshot, expiresAt: number, kind: LifelineExpiryKind) => void;
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

interface LifelineExpiryDeadline {
  expiresAt: number;
  kind: LifelineExpiryKind;
}

function expiryDeadlines(snapshot: LocalLogisticsSnapshot, now: number): LifelineExpiryDeadline[] {
  const providerDeadlines = projectLocalLogisticsCoverage(snapshot, now).providers
    .filter((provider) => provider.state === 'current-complete' || provider.state === 'current-partial')
    .map((provider) => ({
      expiresAt: provider.projectedExpiresAt?.getTime() ?? Number.NaN,
      kind: 'provider-coverage' as const,
    }));
  return [
    ...[
      ...snapshot.nodes,
      ...snapshot.observations,
      ...snapshot.areaConditions,
    ].map((item) => ({ expiresAt: item.expiresAt.getTime(), kind: 'evidence' as const })),
    ...providerDeadlines,
  ]
    .filter((deadline) => Number.isFinite(deadline.expiresAt));
}

function nextFutureExpiry(snapshot: LocalLogisticsSnapshot, now: number): LifelineExpiryDeadline | null {
  let next: LifelineExpiryDeadline | null = null;
  for (const deadline of expiryDeadlines(snapshot, now)) {
    // Already-expired evidence is already rendered as unknown. Ignoring it
    // here prevents a zero-delay rescheduling loop.
    if (deadline.expiresAt <= now) continue;
    if (next === null
      || deadline.expiresAt < next.expiresAt
      || (deadline.expiresAt === next.expiresAt
        && deadline.kind === 'evidence'
        && next.kind === 'provider-coverage')) next = deadline;
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
    const deadline = nextFutureExpiry(snapshot, now);
    if (deadline === null) return;
    const delayMs = Math.min(deadline.expiresAt - now, MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS);
    this.timer = this.setTimer(() => {
      if (this.destroyed || generation !== this.generation || this.currentSnapshot !== snapshot) return;
      this.timer = null;
      if (this.now() < deadline.expiresAt) {
        this.schedule(snapshot, generation);
        return;
      }
      try {
        this.onExpiry(snapshot, deadline.expiresAt, deadline.kind);
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
