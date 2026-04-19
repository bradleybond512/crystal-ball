// Frontend → desktop log bridge.
// Forwards renderer-side errors, performance regressions, and lifecycle events
// to the Rust side so they land in ~/Library/Logs/com.bradleybond.crystalball/
// instead of dying in WebInspector. Also maintains an in-memory breadcrumb
// ring buffer that is dumped alongside crash reports and Cmd+Shift+D diagnostics.
import { invokeTauri } from '@/services/tauri-bridge';

let installed = false;

const noop = (): void => { /* deliberately empty */ };

// ─── Breadcrumb ring buffer ─────────────────────────────────────────────────
// Keeps the last N events so a crash / frozen-UI report can include context
// about what happened leading up to the failure without shipping the full log
// history. Size is small on purpose — too large defeats readability.
export interface Breadcrumb {
  ts: number;
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'PERF';
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

const BREADCRUMB_CAPACITY = 100;
const breadcrumbs: Breadcrumb[] = [];

export function recordBreadcrumb(
  level: Breadcrumb['level'],
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  breadcrumbs.push({ ts: Date.now(), level, category, message, data });
  if (breadcrumbs.length > BREADCRUMB_CAPACITY) breadcrumbs.shift();
}

export function getBreadcrumbs(): readonly Breadcrumb[] {
  return breadcrumbs;
}

function fmtArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message;
  if (a !== null && typeof a === 'object') {
 try { return JSON.stringify(a).slice(0, 500); } catch { return '[object]'; }
  }
  if (typeof a === 'symbol') return a.toString();
  return String(a as string | number | boolean | bigint | null | undefined);
}

export function logToDesktop(
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG',
  message: string,
  context?: Record<string, unknown>,
): void {
  const ctx = context ? JSON.stringify(context).slice(0, 500) : undefined;
  // Mirror into breadcrumbs so the ring buffer captures the same signal.
  recordBreadcrumb(level, 'log', message.slice(0, 200), context);
  void invokeTauri<void>('log_frontend', {
 level,
 message: message.slice(0, 1000),
 context: ctx,
  }).catch(noop);
}

// ─── Performance signals ────────────────────────────────────────────────────
// Long-task observer catches any main-thread work >50 ms. Useful for hunting
// input-latency and jank sources. Threshold is deliberately above 50 ms for
// signal-to-noise.
const LONG_TASK_REPORT_THRESHOLD_MS = 100;
// Slow-refresh threshold for panel data loads before we consider them a
// regression worth logging. Refresh cycles are async and expected to take time,
// but anything beyond this likely indicates a real problem.
const SLOW_REFRESH_THRESHOLD_MS = 2000;

let longTaskObserver: PerformanceObserver | null = null;

function installLongTaskObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  // WebKit (Safari/Tauri) doesn't support 'longtask' entryType — feature-check
  // before registering to avoid a noisy console warning.
  const supported = PerformanceObserver.supportedEntryTypes;
  if (!supported?.includes('longtask')) return;

  try {
 longTaskObserver = new PerformanceObserver((list) => {
 for (const entry of list.getEntries()) {
 if (entry.duration < LONG_TASK_REPORT_THRESHOLD_MS) continue;
 recordBreadcrumb('PERF', 'longtask', `${Math.round(entry.duration)}ms main-thread block`, {
 name: entry.name,
 startTime: Math.round(entry.startTime),
 });
 logToDesktop('WARN', `longtask ${Math.round(entry.duration)}ms`, {
 startTime: Math.round(entry.startTime),
 });
 }
 });
 longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
 // PerformanceObserver rejected — not fatal.
 longTaskObserver = null;
  }
}

/**
 * Time an async operation and emit a breadcrumb/log if it exceeds the slow
 * threshold. Returns the operation's result or error unchanged.
 *
 *   const data = await traceRefresh('news', () => fetchNews());
 */
export async function traceRefresh<T>(
  name: string,
  fn: () => Promise<T>,
  thresholdMs = SLOW_REFRESH_THRESHOLD_MS,
): Promise<T> {
  const start = performance.now();
  try {
 const result = await fn();
 const elapsed = performance.now() - start;
 if (elapsed >= thresholdMs) {
 recordBreadcrumb('PERF', 'slow-refresh', `${name} took ${Math.round(elapsed)}ms`, {
 thresholdMs,
 });
 logToDesktop('WARN', `slow refresh: ${name} ${Math.round(elapsed)}ms`, { thresholdMs });
 }
 return result;
  } catch (error) {
 const elapsed = performance.now() - start;
 recordBreadcrumb('ERROR', 'refresh-failed', `${name} failed after ${Math.round(elapsed)}ms`, {
 error: error instanceof Error ? error.message : String(error),
 });
 throw error;
  }
}

interface MemoryInfo extends Record<string, unknown> {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function snapshotMemory(): MemoryInfo | null {
  const perf = performance as Performance & { memory?: MemoryInfo };
  const mem = perf.memory;
  if (!mem) return null;
  return {
 usedJSHeapSize: mem.usedJSHeapSize,
 totalJSHeapSize: mem.totalJSHeapSize,
 jsHeapSizeLimit: mem.jsHeapSizeLimit,
  };
}

function installMemoryWatchdog(): void {
  const mem = snapshotMemory();
  if (!mem) return; // Chromium-only; Safari/WebKit don't expose it.

  // Periodically record memory pressure. 60s is infrequent enough that the
  // telemetry is cheap but frequent enough to catch a memory-leak trajectory.
  const intervalMs = 60_000;
  // eslint-disable-next-line sonarjs/pseudo-random -- jitter only, not security
  const jitter = Math.floor(Math.random() * 5000);
  setTimeout(function tick() {
 const snap = snapshotMemory();
 if (snap) {
 const usedMb = Math.round(snap.usedJSHeapSize / 1024 / 1024);
 const limitMb = Math.round(snap.jsHeapSizeLimit / 1024 / 1024);
 recordBreadcrumb('PERF', 'memory', `heap ${usedMb}/${limitMb} MB`, snap);
 // Only log to desktop when we're >70% of the heap limit — otherwise too chatty.
 if (snap.usedJSHeapSize / snap.jsHeapSizeLimit > 0.7) {
 logToDesktop('WARN', `high heap usage: ${usedMb}MB (limit ${limitMb}MB)`, snap);
 }
 }
 setTimeout(tick, intervalMs);
  }, intervalMs + jitter);
}

function installVisibilityBreadcrumbs(): void {
  document.addEventListener('visibilitychange', () => {
 recordBreadcrumb('INFO', 'visibility', `document.visibilityState=${document.visibilityState}`);
  });
  window.addEventListener('online', () => recordBreadcrumb('INFO', 'network', 'online'));
  window.addEventListener('offline', () => recordBreadcrumb('WARN', 'network', 'offline'));
}

// ─── Interaction latency (INP-style) ────────────────────────────────────────
// Use PerformanceObserver 'event' entries to catch interactions that take >200
// ms to next-paint — the standard INP "needs improvement" threshold. Feature-
// checked; WebKit doesn't yet support 'event' entryType so we no-op.
const INP_REPORT_THRESHOLD_MS = 200;
let inpObserver: PerformanceObserver | null = null;

function installInteractionLatencyObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (!supported?.includes('event')) return;
  try {
 inpObserver = new PerformanceObserver((list) => {
 for (const entry of list.getEntries()) {
 const duration = (entry as PerformanceEntry & { duration: number }).duration;
 if (duration < INP_REPORT_THRESHOLD_MS) continue;
 recordBreadcrumb('PERF', 'slow-interaction', `${entry.name} took ${Math.round(duration)}ms to next paint`, {
 startTime: Math.round(entry.startTime),
 });
 }
 });
 inpObserver.observe({ type: 'event', buffered: true, durationThreshold: INP_REPORT_THRESHOLD_MS } as PerformanceObserverInit);
  } catch {
 inpObserver = null;
  }
}

// ─── Fetch failure rate tracker ─────────────────────────────────────────────
// Wraps window.fetch so we can count recent failures per host (rolling
// 5-minute window). Useful for distinguishing "everything is down" from
// "one upstream is flaky". Results surface through `getFetchFailureSummary()`
// which the diagnostics bundle can include.
interface FetchStat { ok: number; fail: number; lastErrorAt: number }
const FETCH_WINDOW_MS = 5 * 60 * 1000;
const fetchStats = new Map<string, FetchStat>();
const fetchFailureTimes = new Map<string, number[]>();

function bumpFetchStat(host: string, ok: boolean): void {
  const stat = fetchStats.get(host) ?? { ok: 0, fail: 0, lastErrorAt: 0 };
  if (ok) stat.ok += 1;
  else { stat.fail += 1; stat.lastErrorAt = Date.now(); }
  fetchStats.set(host, stat);

  if (!ok) {
 const arr = fetchFailureTimes.get(host) ?? [];
 arr.push(Date.now());
 // Trim to window
 const cutoff = Date.now() - FETCH_WINDOW_MS;
 while (arr.length > 0 && arr[0]! < cutoff) arr.shift();
 fetchFailureTimes.set(host, arr);
 // Log an alarm if 5+ failures for the same host in the window.
 if (arr.length === 5) {
 recordBreadcrumb('WARN', 'fetch-burst', `${host}: ${arr.length} failures in <5m`);
 logToDesktop('WARN', `fetch failure burst: ${host} (${arr.length} in <5m)`);
 }
  }
}

function installFetchInstrumentation(): void {
  // Idempotent — installLogBridge is idempotent so this is fine.
  const origFetch = window.fetch.bind(window);
  window.fetch = async function instrumentedFetch(input, init) {
 let host = 'unknown';
 try {
 let url: string;
 if (typeof input === 'string') url = input;
 else if (input instanceof Request) url = input.url;
 else url = String(input);
 host = new URL(url, location.href).host;
 } catch { /* unparseable; keep 'unknown' */ }
 try {
 const resp = await origFetch(input, init);
 bumpFetchStat(host, resp.ok);
 return resp;
 } catch (error) {
 bumpFetchStat(host, false);
 throw error;
 }
  };
}

export function getFetchFailureSummary(): { host: string; ok: number; fail: number; failureRate: number }[] {
  const out: { host: string; ok: number; fail: number; failureRate: number }[] = [];
  for (const [host, stat] of fetchStats) {
 const total = stat.ok + stat.fail;
 if (total === 0) continue;
 out.push({ host, ok: stat.ok, fail: stat.fail, failureRate: stat.fail / total });
  }
  out.sort((a, b) => b.fail - a.fail);
  return out;
}

export function installLogBridge(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (e) => {
 const err = e.error as Error | undefined;
 logToDesktop('ERROR', `window.onerror: ${e.message}`, {
 filename: e.filename,
 line: e.lineno,
 col: e.colno,
 stack: err?.stack?.slice(0, 800),
 breadcrumbTail: recentBreadcrumbTail(10),
 });
  });

  window.addEventListener('unhandledrejection', (e) => {
 const reason: unknown = e.reason;
 const msg = reason instanceof Error ? reason.message : String(reason);
 logToDesktop('ERROR', `unhandledrejection: ${msg}`, {
 stack: reason instanceof Error ? reason.stack?.slice(0, 800) : undefined,
 breadcrumbTail: recentBreadcrumbTail(10),
 });
  });

  // eslint-disable-next-line no-console
  const origError = console.error.bind(console);
  // eslint-disable-next-line no-console
  const origWarn = console.warn.bind(console);

  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
 origError(...args);
 try {
 logToDesktop('ERROR', `console.error: ${args.map(a => fmtArg(a)).join(' ').slice(0, 1000)}`);
 } catch { /* safe */ }
  };
  // eslint-disable-next-line no-console
  console.warn = (...args: unknown[]) => {
 origWarn(...args);
 try {
 logToDesktop('WARN', `console.warn: ${args.map(a => fmtArg(a)).join(' ').slice(0, 1000)}`);
 } catch { /* safe */ }
  };

  installLongTaskObserver();
  installInteractionLatencyObserver();
  installMemoryWatchdog();
  installVisibilityBreadcrumbs();
  installFetchInstrumentation();

  // Cmd+Shift+D — copy diagnostics bundle to clipboard
  document.addEventListener('keydown', (e) => {
 if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
 e.preventDefault();
 void copyDiagnostics();
 }
  });

  logToDesktop('INFO', 'log-bridge installed', {
 userAgent: navigator.userAgent,
 hardwareConcurrency: navigator.hardwareConcurrency,
 deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
  });
}

function recentBreadcrumbTail(n: number): Breadcrumb[] {
  return breadcrumbs.slice(-n);
}

async function copyDiagnostics(): Promise<void> {
  try {
 const bundle = await invokeTauri<string>('copy_diagnostics', {});
 const clientSummary = [
 '',
 '--- Client breadcrumbs (most recent last) ---',
 ...breadcrumbs.slice(-30).map(b => {
 const t = new Date(b.ts).toISOString();
 const data = b.data ? ` ${JSON.stringify(b.data).slice(0, 200)}` : '';
 return `${t} [${b.level}] ${b.category}: ${b.message}${data}`;
 }),
 ].join('\n');
 const full = (bundle ?? '') + clientSummary;
 if (full) {
 await navigator.clipboard.writeText(full);
 showToast('Diagnostics copied to clipboard');
 logToDesktop('INFO', 'diagnostics bundle copied via Cmd+Shift+D');
 }
  } catch (error) {
 const msg = error instanceof Error ? error.message : String(error);
 showToast(`Diagnostics copy failed: ${msg}`);
  }
}

function showToast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 14px;border-radius:6px;font:12px -apple-system,sans-serif;z-index:99999;pointer-events:none;';
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}
