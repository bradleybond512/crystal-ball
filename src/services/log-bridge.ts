// Frontend → desktop log bridge.
// Forwards renderer-side errors, performance regressions, and lifecycle events
// to the Rust side so they land in ~/Library/Logs/com.bradleybond.crystalball/
// instead of dying in WebInspector. Also maintains an in-memory breadcrumb
// ring buffer that is dumped alongside crash reports and Cmd+Shift+D diagnostics.
import { invokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';

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

// Expected upstream/data-fetch failures: rate limits, 4xx/5xx, DNS, refused
// connections — network conditions, not app bugs. The console.error bridge logs
// these as a distinct [FEED] WARN instead of ERROR so genuine errors stay
// scannable in the desktop log. Patterns are deliberately network-specific to
// avoid masking real logic errors.
const FEED_FAILURE_PATTERNS: RegExp[] = [
  /failed to fetch/i,
  /fetch failed/i,
  /\bHTTP\s+[45]\d\d\b/i,
  /\breturned\s+[45]\d\d\b/i,
  /\bstatus\s+[45]\d\d\b/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i,
  /networkerror|failed to load resource/i,
];

export function isExpectedFeedFailure(message: string): boolean {
  return FEED_FAILURE_PATTERNS.some((re) => re.test(message));
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

// ─── Frame-stall detector (WebKit-viable long-task substitute) ──────────────
// WKWebView doesn't support the 'longtask' PerformanceObserver, so
// installLongTaskObserver() no-ops on desktop. A requestAnimationFrame loop
// works everywhere: an oversized gap between frames means the main thread was
// blocked (a long task / stall). This won't fire DURING a total hang (rAF
// stops too — that's the Rust renderer watchdog's job), but it leaves a
// breadcrumb + log line for recoverable jank and the leading edge of a stall.
const FRAME_STALL_THRESHOLD_MS = 5000;

function installFrameStallDetector(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  let last = performance.now();
  // rAF is throttled to ~0 while hidden, so the first frame after unhide shows
  // a gap == the entire hidden duration. Skip that one frame to avoid a false
  // "stall" on every resume.
  // rAF is ALSO throttled while the window is merely unfocused (backgrounded but
  // still visible), so a gap while blurred is a WebKit throttle artifact, not a
  // main-thread stall. Rebaseline on both unhide and refocus, and only log when
  // the window is visible AND focused.
  let skipNext = false;
  const rebaseline = (): void => { skipNext = true; last = performance.now(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rebaseline();
  });
  window.addEventListener('focus', rebaseline);
  const tick = (): void => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (skipNext) { skipNext = false; requestAnimationFrame(tick); return; }
    if (gap >= FRAME_STALL_THRESHOLD_MS && document.visibilityState === 'visible' && document.hasFocus()) {
      recordBreadcrumb('PERF', 'frame-stall', `${Math.round(gap)}ms main-thread stall`, {});
      logToDesktop('WARN', `frame stall ${Math.round(gap)}ms — main thread blocked between frames`);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── Renderer heartbeat (paired with the Rust-side renderer watchdog) ───────
// Beat every 3s. A hung main thread (e.g. the Defect-A infinite JS loop) stops
// these beats; the Rust watchdog notices the silence, logs it, and reloads the
// webview to recover — the only thing that helps when JS itself is wedged, and
// exactly the freeze that previously required a manual kill -9.
function beatRendererHeartbeat(): void {
  void invokeTauri<void>('renderer_heartbeat', {
    visible: document.visibilityState === 'visible',
  }).catch(noop);
}

function installRendererHeartbeat(): void {
  if (!isDesktopRuntime()) return;
  beatRendererHeartbeat();
  setInterval(beatRendererHeartbeat, 3000);
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
// Startup grace period — panels initialize simultaneously on launch and hit the
// sidecar before it is ready, producing a burst of expected failures. Suppress
// the burst alarm until the app has been running for this long.
const BURST_ALARM_GRACE_MS = 20_000;
let bridgeInstalledAt = 0;
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
 // Log an alarm if 5+ failures for the same host in the window, but skip
 // the grace period after startup so panel-initialization races don't fire it.
 const inGrace = bridgeInstalledAt > 0 && Date.now() - bridgeInstalledAt < BURST_ALARM_GRACE_MS;
 if (arr.length === 5 && !inGrace) {
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
  bridgeInstalledAt = Date.now();

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
 const feedMsg = args.map(a => fmtArg(a)).join(' ').slice(0, 1000);
   if (isExpectedFeedFailure(feedMsg)) logToDesktop('WARN', `[FEED] ${feedMsg}`);
   else logToDesktop('ERROR', `console.error: ${feedMsg}`);
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
  installFrameStallDetector();
  installRendererHeartbeat();
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
 // Frontend bundle first (schema v2 + strategic sections + redacted).
 const { composeFrontendDiagnosticsExport } = await import(
 '@/services/diagnostics/frontend-export-composer'
 );

 // Pull app metadata. Version + variant come from Vite's __APP_VERSION__
 // / __APP_VARIANT__ globals when available; otherwise fall back to
 // safe placeholders so the bundle still ships.
 const appMeta = readAppMeta();
 const envMeta = readEnvMeta();

 // Rust appendix is best-effort — if invokeTauri throws (web build
 // or unavailable command), we ship the frontend bundle alone.
 let appendix = '';
 if (isDesktopRuntime()) {
 try {
 appendix = (await invokeTauri<string>('copy_diagnostics', {})) ?? '';
 } catch (error) {
 appendix = `(copy_diagnostics failed: ${
 error instanceof Error ? error.message : String(error)
 })`;
 }
 }

 const breadcrumbTail = breadcrumbs.slice(-30).map(b => {
 const t = new Date(b.ts).toISOString();
 const data = b.data ? ` ${JSON.stringify(b.data).slice(0, 200)}` : '';
 return `${t} [${b.level}] ${b.category}: ${b.message}${data}`;
 }).join('\n');

 const combinedAppendix = [
 appendix,
 breadcrumbTail
 ? `\n--- Client breadcrumbs (most recent last) ---\n${breadcrumbTail}`
 : '',
 ].filter(Boolean).join('\n').trim();

 const { markdown } = composeFrontendDiagnosticsExport({
 app: appMeta,
 env: envMeta,
 appendix: combinedAppendix || undefined,
 });

 await navigator.clipboard.writeText(markdown);
 showToast('Diagnostics copied to clipboard');
 logToDesktop('INFO', 'diagnostics bundle copied via Cmd+Shift+D', {
 schemaVersion: 2,
 markdownChars: markdown.length,
 hasRustAppendix: appendix.length > 0,
 });
  } catch (error) {
 const msg = error instanceof Error ? error.message : String(error);
 showToast(`Diagnostics copy failed: ${msg}`);
  }
}

function readAppMeta(): { variant: string; version: string; runtime: 'desktop' | 'web' } {
  const g = globalThis as unknown as { __APP_VERSION__?: string; __APP_VARIANT__?: string };
  const version = g.__APP_VERSION__ ?? '0.0.0';
  const variant = g.__APP_VARIANT__ ?? 'full';
  // We avoid awaiting isDesktopRuntime() here because this helper runs
  // sync inside an already-async block; the import already happened.
  // Best-effort detection: __TAURI_INTERNALS__ is the Tauri 2 marker.
  const runtime: 'desktop' | 'web' =
    (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ===
    undefined
      ? 'web'
      : 'desktop';
  return { variant, version, runtime };
}

function readEnvMeta(): { locale?: string; timezone?: string; isMacOs?: boolean } {
  return {
    locale: typeof navigator === 'undefined' ? undefined : navigator.language,
    timezone:
      typeof Intl === 'undefined' ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone,
    isMacOs:
      typeof navigator === 'undefined' ? undefined : /mac/i.test(navigator.platform ?? ''),
  };
}

function showToast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 14px;border-radius:6px;font:12px -apple-system,sans-serif;z-index:99999;pointer-events:none;';
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}
