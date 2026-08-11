// Frontend → desktop log bridge.
// Forwards renderer-side errors, performance regressions, and lifecycle events
// to the Rust side so they land in ~/Library/Logs/com.bradleybond.crystalball/
// instead of dying in WebInspector. Also maintains an in-memory breadcrumb
// ring buffer that is dumped alongside crash reports and Cmd+Shift+D diagnostics.
import { invokeTauri } from '@/services/tauri-bridge';
import { fetchTargetHost, isDesktopRuntime } from '@/services/runtime';

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

// ─── Synchronous freeze-surviving boot trace ────────────────────────────────
// The console→desktop.log bridge forwards over async IPC, so a mark emitted
// right before a main-thread freeze never flushes before the watchdog reloads
// the webview — the file log loses exactly the lines that bracket the stall.
// localStorage.setItem is SYNCHRONOUS and durable, so a breadcrumb written just
// before a heavy op survives even if the very next line wedges the thread, and
// is readable after the reload. Keep it tiny (a short ring in one key) so it
// never contributes to the localStorage-quota pressure it's diagnosing.
const BOOT_TRACE_KEY = 'cb-boot-trace';
const BOOT_TRACE_MAX = 60;
const bootT0 = typeof performance === 'undefined' ? 0 : performance.now();

export function bootTrace(label: string): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return;
    const ms = typeof performance === 'undefined' ? 0 : Math.round(performance.now() - bootT0);
    const prev = ls.getItem(BOOT_TRACE_KEY) ?? '';
    const lines = prev ? prev.split('\n') : [];
    lines.push(`${ms}\t${label}`);
    while (lines.length > BOOT_TRACE_MAX) lines.shift();
    ls.setItem(BOOT_TRACE_KEY, lines.join('\n'));
  } catch { /* trace must never throw into the boot path */ }
}

/** Clear the boot trace at the very start of a boot so each run is self-contained. */
export function resetBootTrace(): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(BOOT_TRACE_KEY, ''); } catch { /* ignore */ }
}

export function formatLogArgument(a: unknown): string {
  if (a instanceof Error) {
 const message = a.message.trim();
 const stack = a.stack?.trim() ?? '';
 if (!stack) return message || a.name || 'Error';
 if (!message || stack.includes(message)) return stack;
 return `${message}\n${stack}`;
  }
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
  /\bfetch (?:failed|failure|is aborted)\b/i,
  /\bHTTP\s+[45]\d\d\b/i,
  /\breturned\s+[45]\d\d\b/i,
  /\bstatus\s+[45]\d\d\b/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i,
  /networkerror|failed to load resource/i,
  /upstream (?:may be )?(?:down|unavailable)/i,
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
 * BOOT-TTI probe (permanent). Logs `[BOOT-TTI] <ms>` when the FIRST input event
 * is dispatched after launch — `performance.now()` is relative to timeOrigin
 * (≈ launch), so a main thread wedged through boot (input queues, dispatches
 * late) shows up as a large TTI. One line per boot ⇒ the trend is trackable.
 */
function installBootTtiProbe(): void {
  if (typeof document === 'undefined') return;
  let logged = false;
  const types = ['pointerdown', 'keydown', 'click'] as const;
  const onFirstInput = (e: Event): void => {
    if (logged) return;
    logged = true;
    const ms = typeof performance === 'undefined' ? 0 : Math.round(performance.now());
    for (const t of types) document.removeEventListener(t, onFirstInput, true);
    logToDesktop('INFO', `[BOOT-TTI] first input at ${ms}ms since launch (${e.type} on ${describeEventTarget(e.target)})`);
  };
  for (const t of types) document.addEventListener(t, onFirstInput, true);
}

const INPUT_LATENCY_THRESHOLD_MS = 500;
let eventTimingObserver: PerformanceObserver | null = null;

/** Short human descriptor of the interacted element, as a "what was slow" hint
 *  (the Event Timing API exposes the target node, not the JS handler name). */
function describeEventTarget(target: unknown): string {
  const el = target as (Element & { dataset?: DOMStringMap }) | null;
  if (!el || typeof el.tagName !== 'string') return 'unknown';
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const data = el.dataset ? Object.entries(el.dataset)[0] : undefined;
  if (data) return `${tag}[data-${data[0]}=${String(data[1]).slice(0, 24)}]`;
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/)[0]}` : '';
  const text = (el.textContent ?? '').trim().slice(0, 24);
  const textPart = text ? ` "${text}"` : '';
  return `${tag}${cls}${textPart}`;
}

/**
 * Input-latency probe (permanent). WebKit supports the Event Timing API, which
 * reports input events whose dispatch→handlers-complete exceeded a threshold.
 * Warns to the file log with the event type, latency, and target — so a slow
 * interaction is named in evidence the day it regresses.
 */
function installInputLatencyProbe(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  if (!PerformanceObserver.supportedEntryTypes?.includes('event')) return;
  try {
    eventTimingObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { processingStart?: number; processingEnd?: number; target?: unknown };
        if (entry.duration < INPUT_LATENCY_THRESHOLD_MS) continue;
        const handlerMs = (e.processingEnd ?? 0) - (e.processingStart ?? 0);
        const where = describeEventTarget(e.target);
        recordBreadcrumb('PERF', 'input-latency', `${entry.name} ${Math.round(entry.duration)}ms on ${where}`, {});
        logToDesktop('WARN', `[INPUT-LATENCY] ${entry.name} ${Math.round(entry.duration)}ms (handlers ${Math.round(handlerMs)}ms) on ${where}`);
      }
    });
    // durationThreshold floors at 16ms; the loop filters to >=500ms.
    eventTimingObserver.observe({ type: 'event', durationThreshold: INPUT_LATENCY_THRESHOLD_MS, buffered: true } as PerformanceObserverInit);
  } catch {
    eventTimingObserver = null;
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

// ─── Main-thread stall detector (WebKit-viable long-task substitute) ────────
// WKWebView doesn't support the 'longtask' PerformanceObserver, so
// installLongTaskObserver() no-ops on desktop. A self-rescheduling timer works
// everywhere: an oversized gap between fires means the main thread was blocked
// (a long task / stall). This won't fire DURING a total hang (the timer stops
// too — that's the Rust renderer watchdog's job), but it leaves a breadcrumb +
// log line for recoverable jank and the leading edge of a stall.
//
// IMPORTANT: this uses setTimeout, NOT requestAnimationFrame. A rAF loop runs
// the callback every frame (~60fps), and each serviced rAF forces WebKit to run
// the WHOLE rendering-update pipeline (style/layout flush + compositing-overlap
// recompute + event-region recompute + observer servicing) every frame — so the
// detector meant to catch idle stalls was itself pinning the render pipeline at
// 60fps and burning ~80% CPU on an idle dashboard. setTimeout is queued on the
// main thread just like rAF (so a blocked thread delays it identically), but it
// does NOT schedule a rendering update, so the pipeline stays quiet at idle.
const FRAME_STALL_THRESHOLD_MS = 5000;
// Poll once a second: fine-grained enough to catch the leading edge of a ≥5s
// stall, coarse enough to cost nothing.
const STALL_PROBE_INTERVAL_MS = 1000;

function installFrameStallDetector(): void {
  if (typeof setTimeout !== 'function') return;
  let last = performance.now();
  // Timers keep firing (throttled to ≥1s) while hidden/blurred, and the gap
  // then reflects throttling rather than a real stall. Rebaseline on unhide and
  // refocus and only log when the window is visible AND focused, so a resume
  // never reads as a stall.
  let skipNext = false;
  const rebaseline = (): void => { skipNext = true; last = performance.now(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rebaseline();
  });
  window.addEventListener('focus', rebaseline);
  const probe = (): void => {
    const now = performance.now();
    // Total time since the previous probe. Healthy ≈ STALL_PROBE_INTERVAL_MS; a
    // blocked main thread delays this probe, inflating the gap. Threshold on the
    // whole gap (NOT gap-minus-interval): a block that begins mid-interval hides
    // up to one interval's worth of delay, so subtracting the interval could let
    // a real ≥5s stall slip under the bar. Since the healthy gap (~1s) is far
    // below the 5s threshold, thresholding the raw gap can't false-positive.
    const gap = now - last;
    last = now;
    if (skipNext) { skipNext = false; setTimeout(probe, STALL_PROBE_INTERVAL_MS); return; }
    if (gap >= FRAME_STALL_THRESHOLD_MS && document.visibilityState === 'visible' && document.hasFocus()) {
      recordBreadcrumb('PERF', 'frame-stall', `${Math.round(gap)}ms main-thread stall`, {});
      logToDesktop('WARN', `frame stall ${Math.round(gap)}ms — main thread blocked between probes`);
    }
    setTimeout(probe, STALL_PROBE_INTERVAL_MS);
  };
  setTimeout(probe, STALL_PROBE_INTERVAL_MS);
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

let _heartbeatTimer: number | null = null;

function installRendererHeartbeat(): void {
  if (!isDesktopRuntime()) return;
  beatRendererHeartbeat();
  _heartbeatTimer = window.setInterval(beatRendererHeartbeat, 3000);
}

export function stopRendererHeartbeat(): void {
  if (_heartbeatTimer !== null) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

// After a watchdog reload the renderer boots fresh; ask the Rust side once
// whether this boot followed a stall reload and, if so, surface a recovery
// toast. The flag is consumed atomically so the toast shows exactly once.
async function checkWatchdogRecovery(): Promise<void> {
  if (!isDesktopRuntime()) return;
  try {
    const recovered = await invokeTauri<boolean>('take_watchdog_recovery');
    if (recovered) showToast('Renderer recovered — reloaded after a stall');
  } catch { /* command unavailable — ignore */ }
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

// Exported for tests: binds attribution to the wrapper as installed, not just to
// the helper it calls.
export function installFetchInstrumentation(): void {
  // Idempotent — installLogBridge is idempotent so this is fine.
  const origFetch = window.fetch.bind(window);
  window.fetch = async function instrumentedFetch(input, init) {
 // This wrapper is installed from App.ts, i.e. OUTSIDE the routing wrappers in
 // runtime.ts, so it observes app-origin URLs before they are rewritten.
 // fetchTargetHost reuses the routers' own predicate to name the real host.
 const host = fetchTargetHost(input);
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
 const feedMsg = args.map(a => formatLogArgument(a)).join(' ').slice(0, 1000);
   if (isExpectedFeedFailure(feedMsg)) logToDesktop('WARN', `[FEED] ${feedMsg}`);
   else logToDesktop('ERROR', `console.error: ${feedMsg}`);
 } catch { /* safe */ }
  };
  // eslint-disable-next-line no-console
  console.warn = (...args: unknown[]) => {
 origWarn(...args);
 try {
 logToDesktop('WARN', `console.warn: ${args.map(a => formatLogArgument(a)).join(' ').slice(0, 1000)}`);
 } catch { /* safe */ }
  };

  installLongTaskObserver();
  installInputLatencyProbe();
  installBootTtiProbe();
  installFrameStallDetector();
  installRendererHeartbeat();
  void checkWatchdogRecovery();
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
