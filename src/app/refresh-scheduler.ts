import type { AppContext, AppModule } from '@/app/app-context';
import { getGhostRefreshMultiplier } from '@/services/mode-manager';

export interface RefreshRegistration {
  name: string;
  fn: () => Promise<boolean | void>;
  intervalMs: number;
  condition?: () => boolean;
}

export class RefreshScheduler implements AppModule {
  private ctx: AppContext;
  private refreshTimeoutIds = new Map<string, ReturnType<typeof setTimeout>>();
  private refreshRunners = new Map<string, { run: () => Promise<void>; intervalMs: number }>();
  private hiddenSince = 0;

  constructor(ctx: AppContext) {
 this.ctx = ctx;
  }

  init(): void {
    // No initialization needed — scheduling happens via registerAll()
  }

  destroy(): void {
 for (const timeoutId of this.refreshTimeoutIds.values()) {
 clearTimeout(timeoutId);
 }
 this.refreshTimeoutIds.clear();
 this.refreshRunners.clear();
 this.flushQueue = [];
 this.flushInFlight = 0;
  }

  setHiddenSince(ts: number): void {
 this.hiddenSince = ts;
  }

  getHiddenSince(): number {
 return this.hiddenSince;
  }

  scheduleRefresh(
 name: string,
 fn: () => Promise<boolean | void>,
 intervalMs: number,
 condition?: () => boolean
  ): void {
 const HIDDEN_REFRESH_MULTIPLIER = 10;
 const JITTER_FRACTION = 0.1;
 const MIN_REFRESH_MS = 1000;
 // Max effective interval: intervalMs * 4 (backoff) * 10 (hidden) = 40x base
 const MAX_BACKOFF_MULTIPLIER = 4;

 let currentMultiplier = 1;

 const computeDelay = (baseMs: number, isHidden: boolean) => {
 const ghostMultiplier = getGhostRefreshMultiplier();
 const adjusted = baseMs * ghostMultiplier * (isHidden ? HIDDEN_REFRESH_MULTIPLIER : 1);
 const jitterRange = adjusted * JITTER_FRACTION;
 // eslint-disable-next-line sonarjs/pseudo-random
 const jittered = adjusted + (Math.random() * 2 - 1) * jitterRange;
 return Math.max(MIN_REFRESH_MS, Math.round(jittered));
 };
 const scheduleNext = (delay: number) => {
 if (this.ctx.isDestroyed) return;
 const timeoutId = setTimeout(run, delay);
 this.refreshTimeoutIds.set(name, timeoutId);
 };
 const run = async () => {
 if (this.ctx.isDestroyed) return;
 const isHidden = document.visibilityState === 'hidden';
 if (condition && !condition()) {
 scheduleNext(computeDelay(intervalMs * currentMultiplier, isHidden));
 return;
 }
 if (this.ctx.inFlight.has(name)) {
 scheduleNext(computeDelay(intervalMs * currentMultiplier, isHidden));
 return;
 }
 this.ctx.inFlight.add(name);
 try {
 const changed = await fn();
 currentMultiplier = changed === false ? Math.min(currentMultiplier * 2, MAX_BACKOFF_MULTIPLIER) : 1;
 } catch (error) {
 // eslint-disable-next-line no-console
 console.error(`[App] Refresh ${name} failed:`, error);
 currentMultiplier = 1;
 } finally {
 this.ctx.inFlight.delete(name);
 scheduleNext(computeDelay(intervalMs * currentMultiplier, isHidden));
 }
 };
 this.refreshRunners.set(name, { run, intervalMs });
 scheduleNext(computeDelay(intervalMs, document.visibilityState === 'hidden'));
  }

  private static readonly MAX_CONCURRENT_FLUSHES = 6;
  private flushQueue: { name: string; run: () => Promise<void> }[] = [];
  private flushInFlight = 0;

  flushStaleRefreshes(): void {
 if (!this.hiddenSince) return;
 const hiddenMs = Date.now() - this.hiddenSince;
 this.hiddenSince = 0;

 // Collect stale refreshes
 const stale: { name: string; run: () => Promise<void>; intervalMs: number }[] = [];
 for (const [name, { run, intervalMs }] of this.refreshRunners) {
 if (hiddenMs < intervalMs) continue;
 const pending = this.refreshTimeoutIds.get(name);
 if (pending) clearTimeout(pending);
 stale.push({ name, run, intervalMs });
 }

 // Sort by interval (shortest first = most time-sensitive)
 stale.sort((a, b) => a.intervalMs - b.intervalMs);

 this.flushQueue = stale;
 this.flushInFlight = 0;
 this.drainFlushQueue();
  }

  private drainFlushQueue(): void {
 while (this.flushInFlight < RefreshScheduler.MAX_CONCURRENT_FLUSHES && this.flushQueue.length > 0) {
 const item = this.flushQueue.shift()!;
 this.flushInFlight++;
 // Stagger each launch by 200ms * position to avoid burst
 const delay = this.flushInFlight * 200;
 this.refreshTimeoutIds.set(item.name, setTimeout(() => {
 void item.run().finally(() => {
  this.flushInFlight--;
  this.drainFlushQueue();
 });
 }, delay));
 }
  }

  registerAll(registrations: RefreshRegistration[]): void {
 for (const reg of registrations) {
 this.scheduleRefresh(reg.name, reg.fn, reg.intervalMs, reg.condition);
 }
  }
}
