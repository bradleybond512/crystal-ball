import { interruptResolutionRunStreak, recordResolutionRun, resetResolutionRunSession, type ResolutionRunInput } from './resolution-run-receipts';
import type { BridgePassMetrics, ResolverPassMetrics } from './resolver-pass-metrics';

const PERIOD = 15 * 60_000;
const HOUR = 4 * PERIOD;
const LOCK = 'cb:forecast-calibration:resolution-v1';

interface Callbacks {
  isReady(): boolean;
  isBridgeReady(): boolean;
  enabled(): boolean;
  hasDueWork(now: number): boolean;
  resolve(now: number): ResolverPassMetrics;
  bridge(): BridgePassMetrics;
}

interface Environment {
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  locks: Pick<LockManager, 'request'>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  record(input: ResolutionRunInput): void;
  interrupt(): void;
  reset(): void;
}

function browser(): Environment {
  return {
    document, get locks() { return navigator.locks; }, get storage() { return localStorage; },
    record: recordResolutionRun, interrupt: interruptResolutionRunStreak, reset: resetResolutionRunSession,
  };
}

type Kind = ResolutionRunInput['kind'];
interface Owner { callbacks: Callbacks }
type Readiness = ResolutionRunInput['readiness'];

function unavailable(owner: Owner, env: Environment, kind: Kind): Readiness | undefined {
  // The existing hourly bridge also performs generic expiry when cognition is off.
  if (kind !== 'bridge' && env.document.hidden) return 'hidden';
  if (kind !== 'bridge' && !owner.callbacks.enabled()) return 'cognition-disabled';
  if (!(kind === 'bridge' ? owner.callbacks.isBridgeReady() : owner.callbacks.isReady())) return 'not-hydrated';
}

function nextAllowed(env: Environment, key: string): number {
  const last = env.storage.getItem(key);
  if (last === null) return 0;
  const timestamp = Number(last);
  if (!/^\d{1,15}$/.test(last) || !Number.isSafeInteger(timestamp)) throw new Error('Invalid calibration run clock');
  return timestamp + (key.endsWith('bridge') ? HOUR : PERIOD);
}

class ResolutionSession {
  readonly owners = new Set<Owner>();
  private timer?: ReturnType<typeof setTimeout>;
  private bridgeTimer?: ReturnType<typeof setTimeout>;
  private active = true;
  private generation = 0;
  private typedPending = false;
  private refreshRequested = false;
  private nextDue = Date.now() + PERIOD;

  constructor(private readonly env: Environment) {
    env.reset();
    env.document.addEventListener('visibilitychange', this.onVisibility);
    env.document.addEventListener('cb:cognition-flags-changed', this.onCognition);
    this.armTyped();
    this.armBridge(Date.now() + HOUR);
  }

  stop(): void {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.bridgeTimer);
    this.env.document.removeEventListener('visibilitychange', this.onVisibility);
    this.env.document.removeEventListener('cb:cognition-flags-changed', this.onCognition);
    this.env.interrupt();
  }

  private readonly onVisibility = (): void => {
    this.generation++;
    this.env.interrupt();
    clearTimeout(this.timer);
    if (!this.env.document.hidden) {
      this.catchUp();
      if (this.nextDue <= Date.now()) this.nextDue = Date.now() + PERIOD;
      this.armTyped();
    }
  };

  private readonly onCognition = (event: Event): void => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== 'outcome-resolvers') return;
    this.generation++;
    this.env.interrupt();
    this.catchUp();
  };

  catchUp(): void {
    if (this.env.document.hidden) return;
    if (this.typedPending) {
      this.refreshRequested = true;
      return;
    }
    void this.attempt('catchup', Math.min(Date.now(), this.nextDue));
  }

  private armTyped(): void {
    clearTimeout(this.timer);
    if (!this.active || this.env.document.hidden) return;
    this.timer = setTimeout(() => {
      const due = this.nextDue;
      this.nextDue = Date.now() + PERIOD;
      this.armTyped();
      void this.attempt('scheduled', due);
    }, Math.max(1, this.nextDue - Date.now()));
  }

  private armBridge(due: number): void {
    this.bridgeTimer = setTimeout(() => {
      this.armBridge(Date.now() + HOUR);
      void this.attempt('bridge', due);
    }, Math.max(1, due - Date.now()));
  }

  private skip(kind: Kind, due: number, readiness: Readiness): void {
    const now = Date.now();
    this.env.record({ kind, dueAt: Math.min(due, now), startedAt: now, completedAt: now, readiness, outcome: 'skipped', metrics: null });
    if (kind !== 'bridge') this.env.interrupt();
  }

  private execute(callbacks: Callbacks, kind: Kind, due: number, startedAt: number): void {
    const times = { dueAt: Math.min(due, startedAt), startedAt, readiness: 'ready' as const };
    try {
      if (kind === 'bridge') {
        const metrics = callbacks.bridge();
        this.env.record({ ...times, kind, completedAt: Date.now(), outcome: metrics.failed ? 'failed' : 'completed', metrics });
      } else {
        const metrics = callbacks.resolve(startedAt);
        const failed = metrics.persistenceFailures > 0 || metrics.rejectedWrites > 0;
        this.env.record({ ...times, kind, completedAt: Date.now(), outcome: failed ? 'failed' : 'completed', metrics });
      }
    } catch {
      this.env.record({ ...times, kind, completedAt: Date.now(), outcome: 'failed', metrics: null });
    }
  }

  private admit(owner: Owner, kind: Kind, due: number): void {
    const reason = unavailable(owner, this.env, kind);
    if (reason) { this.skip(kind, due, reason); return; }
    const now = Date.now();
    const key = LOCK + (kind === 'bridge' ? ':bridge' : ':typed');
    const allowed = nextAllowed(this.env, key);
    if (allowed > now) {
      if (kind !== 'bridge') {
        if (kind === 'scheduled') this.env.interrupt();
        this.nextDue = Math.min(allowed, now + PERIOD);
        this.armTyped();
      }
      return;
    }
    if (kind === 'catchup' && !owner.callbacks.hasDueWork(now)) return;
    this.env.storage.setItem(key, String(now));
    if (kind !== 'bridge') {
      if (now - due >= PERIOD) this.env.interrupt();
      this.nextDue = now + PERIOD;
      this.armTyped();
    }
    this.execute(owner.callbacks, kind, due, now);
  }

  private async attempt(kind: Kind, due: number): Promise<void> {
    if (!this.active || (kind !== 'bridge' && this.typedPending)) return;
    const token = this.generation;
    if (kind !== 'bridge') this.typedPending = true;
    try {
      // Bound lock admission. An hourly bridge and a typed pass can coincide; both
      // get their slot without racing the same persisted ledger.
      await this.env.locks.request(LOCK, { signal: AbortSignal.timeout(5000) }, lock => {
        if (!this.active || (kind !== 'bridge' && token !== this.generation)) return;
        const owner = [...this.owners].find(item => !unavailable(item, this.env, kind)) ?? this.owners.values().next().value;
        if (!owner) return;
        if (!lock) { this.skip(kind, due, 'coordination-unavailable'); return; }
        this.admit(owner, kind, due);
      });
    } catch {
      if (this.active) this.skip(kind, due, 'coordination-unavailable');
    } finally {
      if (kind !== 'bridge') {
        this.typedPending = false;
        if (this.refreshRequested) {
          this.refreshRequested = false;
          if (this.active && token !== this.generation) this.catchUp();
        }
      }
    }
  }
}

const sessions = new WeakMap<Environment['document'], ResolutionSession>();

export function startCalibrationResolutionScheduler(callbacks: Callbacks, env = browser()): { notifyReady(): void; stop(): void } {
  const owner = { callbacks };
  const session = sessions.get(env.document) ?? new ResolutionSession(env);
  sessions.set(env.document, session);
  session.owners.add(owner);
  session.catchUp();
  return {
    notifyReady: () => { if (session.owners.has(owner)) session.catchUp(); },
    stop: () => {
      if (!session.owners.delete(owner) || session.owners.size) return;
      session.stop();
      sessions.delete(env.document);
    },
  };
}
