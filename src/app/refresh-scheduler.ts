import type { AppContext, AppModule } from '@/app/app-context';
import { getGhostRefreshMultiplier } from '@/services/mode-manager';
import { isAlwaysOn } from '@/services/always-on';

/** Hidden-window slowdown factor. Always-on disables the slowdown entirely. */
export function hiddenMultiplier(isHidden: boolean, alwaysOn: boolean): number {
  if (!isHidden || alwaysOn) return 1;
  return 10;
}

export interface RefreshRegistration {
  name: string;
  fn: () => Promise<boolean | void>;
  intervalMs: number;
  condition?: () => boolean;
}

// Anything slower than this gets a console.warn that log-bridge captures as a
// perf breadcrumb. Chosen to trip on clear regressions, not noisy batch work.
const SLOW_REFRESH_THRESHOLD_MS = 15_000;
// Hard ceiling on a single refresh. WKWebView suspends a hidden window's fetch
// (and its abort timer) for the whole hidden period; without this cap a refresh
// could stay "in-flight" for 40+ minutes and then settle in a resume stampede
// that pegged the main thread into a freeze (Defect A). Time-boxing guarantees
// the runner reschedules cleanly instead of waiting on a suspended fetch.
const REFRESH_TIMEOUT_MS = 45_000;

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
 const JITTER_FRACTION = 0.1;
 const MIN_REFRESH_MS = 1000;
 // Max effective interval: intervalMs * 4 (backoff) * 10 (hidden) = 40x base
 const MAX_BACKOFF_MULTIPLIER = 4;

 let currentMultiplier = 1;

 const computeDelay = (baseMs: number, isHidden: boolean) => {
 const ghostMultiplier = getGhostRefreshMultiplier();
 const adjusted = baseMs * ghostMultiplier * hiddenMultiplier(isHidden, isAlwaysOn());
 const jitterRange = adjusted * JITTER_FRACTION;
 // eslint-disable-next-line sonarjs/pseudo-random
 const jittered = adjusted + (Math.random() * 2 - 1) * jitterRange;
 return Math.max(MIN_REFRESH_MS, Math.round(jittered));
 };
 const scheduleNext = (delay: number) => {
 if (this.ctx.isDestroyed) return;
 const timeoutId = setTimeout(() => { void run(); }, delay);
 this.refreshTimeoutIds.set(name, timeoutId);
 };
 const run = async () => {
 if (this.ctx.isDestroyed) return;
 const isHidden = document.visibilityState === 'hidden';
 // Pause network refreshes while the window is hidden. WKWebView suspends the
 // underlying fetch regardless, so running them just accumulates in-flight
 // awaits that ALL settle in one burst on resume — the stampede that pegged
 // the main thread into a freeze (Defect A). flushStaleRefreshes() catches up
 // on resume with bounded concurrency (6 at a time, staggered).
 if (isHidden) {
 scheduleNext(computeDelay(intervalMs * currentMultiplier, true));
 return;
 }
 if (condition && !condition()) {
 scheduleNext(computeDelay(intervalMs * currentMultiplier, isHidden));
 return;
 }
 if (this.ctx.inFlight.has(name)) {
 scheduleNext(computeDelay(intervalMs * currentMultiplier, isHidden));
 return;
 }
 this.ctx.inFlight.add(name);
 const refreshStart = performance.now();
 try {
 // Time-box the refresh so a single slow/suspended fetch can never hold the
 // runner in-flight indefinitely (a 40-minute await was the freeze trigger).
 const changed = await Promise.race([
 fn(),
 new Promise<never>((_, reject) =>
 setTimeout(() => reject(new Error(`refresh timed out after ${REFRESH_TIMEOUT_MS}ms`)), REFRESH_TIMEOUT_MS),
 ),
 ]);
 const elapsed = performance.now() - refreshStart;
 if (elapsed >= SLOW_REFRESH_THRESHOLD_MS) {
 // console.warn is intercepted by log-bridge so this reaches ~/Library/Logs
 // automatically in desktop builds and stays as a breadcrumb in web builds.
 // eslint-disable-next-line no-console
 console.warn(`[App] Slow refresh: ${name} took ${Math.round(elapsed)}ms`);
 }
 currentMultiplier = changed === false ? Math.min(currentMultiplier * 2, MAX_BACKOFF_MULTIPLIER) : 1;
 } catch (error) {
 const elapsed = performance.now() - refreshStart;
 // eslint-disable-next-line no-console
 console.error(`[App] Refresh ${name} failed after ${Math.round(elapsed)}ms:`, error);
 currentMultiplier = Math.min(currentMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
 } finally {
 this.ctx.inFlight.delete(name);
 scheduleNext(computeDelay(intervalMs * currentMultiplier, isHidden));
 }
 };
 this.refreshRunners.set(name, { run, intervalMs });
 scheduleNext(computeDelay(intervalMs, document.visibilityState === 'hidden'));
  }

  static readonly MAX_CONCURRENT_FLUSHES = 6;
  static readonly FLUSH_STAGGER_MS = 150;
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
 // First flushed item fires immediately; subsequent items stagger to avoid burst.
 const delay = (this.flushInFlight - 1) * RefreshScheduler.FLUSH_STAGGER_MS;
 this.refreshTimeoutIds.set(item.name, setTimeout(() => {
 // Wrap in Promise.resolve so runners that forget to return a Promise don't crash the chain.
 Promise.resolve(item.run()).finally(() => {
  this.flushInFlight--;
  this.drainFlushQueue();
 }).catch(() => { /* errors are already logged by the caller */ });
 }, delay));
 }
  }

  registerAll(registrations: RefreshRegistration[]): void {
 for (const reg of registrations) {
 this.scheduleRefresh(reg.name, reg.fn, reg.intervalMs, reg.condition);
 }
  }
}
