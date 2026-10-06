/**
 * Notification Router — single chokepoint that fans out a ReactorAlert
 * into all configured output channels (inbox, toast, native notification,
 * map marker). Severity-gated, deduped against alertDB, rate-limited per
 * severity for native notifications only. Honors Ghost Mode by skipping
 * native notification + map marker. An alert whose native send was not
 * delivered stays pending; when the reactor offers it again, only the
 * native send is retried (R4-BUG-002).
 */

import type { ReactorAlert } from './threat-reactor';
import type { UnifiedAlert, AlertSeverity } from './unified-alerts';
import { getNotificationTraceRegistry } from './diagnostics/diagnostics-state';
import type { NotificationTraceRegistry, NotificationUrgency } from './diagnostics/notification-trace';
import type { NativeNotifyOutcome, NativePriority } from './native-notify';

type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface RouterConfig {
  minSeverity: Severity;
  notifyNative: boolean;
  notifyToast: boolean;
  notifyMap: boolean;
}

export interface RouterDeps {
  alertDB: {
 put: (a: UnifiedAlert) => Promise<void>;
 getAll: (opts?: { since?: number }) => Promise<UnifiedAlert[]>;
  };
  /** Must report the real native outcome — only `delivered` counts as seen. */
  sendNativeNotification: (title: string, body: string, priority: NativePriority) => Promise<NativeNotifyOutcome>;
  showToast: (title: string, body: string, severity: AlertSeverity) => void;
  addMapMarker: (lat: number, lon: number, alertId: string) => void;
  isGhostMode: () => boolean | Promise<boolean>;
  now: () => number;
}

const STORAGE_KEY = 'crystalball-cyber-reactor-config';
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MARKER_TTL_MS = 5 * 60 * 1000;
const MARKER_LAYER = 'cyber-reactor-markers';

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const RATE_LIMIT_MS: Record<Severity, number> = {
  critical: 0,
  high: 60_000,
  medium: 300_000,
  low: 300_000,
};

const lastNotifiedBySeverity = new Map<Severity, number>();
/**
 * Alerts whose native send was attempted but not delivered, by alert id and
 * the time of that first attempt. In memory only: after a restart the stored
 * inbox row dedupes the alert as before.
 */
const pendingNative = new Map<string, number>();
let nextTraceId = 1;

const DEFAULT_CONFIG: RouterConfig = {
  minSeverity: 'medium',
  notifyNative: true,
  notifyToast: true,
  notifyMap: true,
};

function loadConfig(): RouterConfig {
  try {
 if (typeof localStorage === 'undefined') return { ...DEFAULT_CONFIG };
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return { ...DEFAULT_CONFIG };
 const parsed = JSON.parse(raw) as Partial<RouterConfig>;
 return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
 return { ...DEFAULT_CONFIG };
  }
}

let config: RouterConfig = loadConfig();

export function getRouterConfig(): RouterConfig {
  return { ...config };
}

export function updateRouterConfig(patch: Partial<RouterConfig>): void {
  config = { ...config, ...patch };
  try {
 if (typeof localStorage !== 'undefined') {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
 }
  } catch {
 // ignore
  }
}

// ── Default real-world implementations (lazy/dynamic) ──────────────────

async function defaultIsGhostMode(): Promise<boolean> {
  const override = (
 globalThis as unknown as { __wmGhost?: () => boolean }
  ).__wmGhost;
  if (typeof override === 'function') {
 try {
 return override();
 } catch {
 return false;
 }
  }
  try {
 const mod = (await import('./mode-manager')) as {
 isGhostMode?: () => boolean;
 };
 return typeof mod.isGhostMode === 'function' ? mod.isGhostMode() : false;
  } catch {
 return false;
  }
}

async function defaultAlertDBPut(a: UnifiedAlert): Promise<void> {
  const mod = await import('./alert-store');
  await mod.alertDB.put(a);
}

async function defaultAlertDBGetAll(opts?: {
  since?: number;
}): Promise<UnifiedAlert[]> {
  const mod = await import('./alert-store');
  return mod.alertDB.getAll(opts);
}

async function defaultSendNativeNotification(
  title: string,
  body: string,
  priority: NativePriority,
): Promise<NativeNotifyOutcome> {
  try {
    const mod = await import('./native-notify');
    return await mod.notifyNative({ title, body, priority });
  } catch {
    return 'failed';
  }
}

/** Life-safety `critical` maps to the native critical lane; `high` to high. */
export function routerNativePriority(severity: Severity): NativePriority {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  return 'normal';
}

function defaultShowToast(title: string): void {
  // No standalone toast service yet — wire up in a follow-up task.
  // For now, surface to the optional global hook if present.
  const hook = (
 globalThis as unknown as { __wmShowToast?: (t: string) => void }
  ).__wmShowToast;
  if (typeof hook === 'function') {
 try {
 hook(title);
 } catch {
 // ignore
 }
  }
}

function defaultAddMapMarker(lat: number, lon: number, alertId: string): void {
  void (async () => {
 try {
 const mod = (await import('../components/DeckGLMap')) as Record<
 string,
 unknown
 >;
 const add = mod.addCyberReactorMarker as
 | ((layer: string, lat: number, lon: number, id: string) => void)
 | undefined;
 const remove = mod.removeCyberReactorMarker as
 | ((layer: string, id: string) => void)
 | undefined;
 if (typeof add === 'function') {
 add(MARKER_LAYER, lat, lon, alertId);
 setTimeout(() => {
 try {
 remove?.(MARKER_LAYER, alertId);
 } catch {
 // ignore
 }
 }, MARKER_TTL_MS);
 }
 } catch {
 // map module not initialized — swallow
 }
  })();
}

function defaultDeps(): RouterDeps {
  return {
 alertDB: { put: defaultAlertDBPut, getAll: defaultAlertDBGetAll },
 sendNativeNotification: defaultSendNativeNotification,
 showToast: defaultShowToast,
 addMapMarker: defaultAddMapMarker,
 isGhostMode: defaultIsGhostMode,
 now: () => Date.now(),
  };
}

// ── Core delivery ──────────────────────────────────────────────────────

let activeDeps: RouterDeps | null = null;
let routerStarted = false;

function alertToUnified(alert: ReactorAlert): UnifiedAlert {
  const { threat, relevance, alertId, createdAt } = alert;
  return {
 id: alertId,
 source: 'cyber',
 severity: threat.severity,
 title: threat.title,
 body: threat.body,
 timestamp: createdAt,
 location:
 typeof threat.lat === 'number' && typeof threat.lon === 'number'
 ? { lat: threat.lat, lon: threat.lon }
 : undefined,
 relevanceScore: relevance.score,
 acknowledged: false,
 pinned: false,
 raw: { threat, relevance },
  };
}

async function isDuplicate(
  alert: ReactorAlert,
  deps: RouterDeps,
  nowMs: number,
): Promise<boolean> {
  try {
 const recent = await deps.alertDB.getAll({
 since: nowMs - DEDUPE_WINDOW_MS,
 });
 return recent.some((r) => r.id === alert.alertId);
  } catch {
 return false;
  }
}

async function safeIsGhost(deps: RouterDeps): Promise<boolean> {
  try {
 return await deps.isGhostMode();
  } catch {
 return false;
  }
}

async function safePut(deps: RouterDeps, unified: UnifiedAlert): Promise<void> {
  try {
 await deps.alertDB.put(unified);
  } catch {
 // ignore inbox failure
  }
}

function safeToast(deps: RouterDeps, alert: ReactorAlert): void {
  if (!config.notifyToast) return;
  try {
 deps.showToast(alert.threat.title, alert.threat.body, alert.threat.severity);
  } catch {
 // ignore
  }
}

/**
 * `skipped`: native is disabled, Ghost Mode is on, or the router's own
 * per-severity window is still open.
 */
type NativeAttempt = 'delivered' | 'not_delivered' | 'skipped';

async function safeNative(
  deps: RouterDeps,
  alert: ReactorAlert,
  ghost: boolean,
  nowMs: number,
  trace?: RouterTrace,
): Promise<NativeAttempt> {
  if (!config.notifyNative) {
 recordRouterNativeResult(trace, { delivered: false, surface: 'in_app', error: 'native-disabled' });
 return 'skipped';
  }
  if (ghost) {
 recordRouterNativeResult(trace, { delivered: false, surface: 'in_app', error: 'ghost-mode' });
 return 'skipped';
  }
  const sev = alert.threat.severity;
  const limit = RATE_LIMIT_MS[sev];
  const last = lastNotifiedBySeverity.get(sev) ?? 0;
  if (limit !== 0 && nowMs - last < limit) {
 recordRouterNativeResult(trace, { delivered: false, surface: 'in_app', error: 'severity-rate-limit' });
 return 'skipped';
  }
  let outcome: NativeNotifyOutcome;
  try {
 outcome = await deps.sendNativeNotification(alert.threat.title, alert.threat.body, routerNativePriority(sev));
  } catch {
 outcome = 'failed';
  }
  // Only a delivered notification counts: it starts the per-severity window
  // and settles the alert. Any other outcome is traced as not delivered and
  // leaves the alert pending for the next reactor ingest (R4-BUG-002).
  if (outcome === 'delivered') {
 lastNotifiedBySeverity.set(sev, nowMs);
 recordRouterNativeResult(trace, {
 delivered: true,
 surface: sev === 'critical' ? 'critical' : 'banner',
 });
  } else if (outcome === 'rate_limited') {
 recordRouterNativeResult(trace, { delivered: false, surface: 'in_app', error: 'native-rate-limited' });
  } else if (outcome === 'unavailable') {
 recordRouterNativeResult(trace, { delivered: false, surface: 'in_app', error: 'native-unavailable' });
  } else {
 recordRouterNativeResult(trace, { delivered: false, surface: 'failed', error: 'native-delivery-failed' });
  }
  return outcome === 'delivered' ? 'delivered' : 'not_delivered';
}

function safeMarker(deps: RouterDeps, alert: ReactorAlert, ghost: boolean): void {
  if (!config.notifyMap || ghost) return;
  const { lat, lon } = alert.threat;
  if (typeof lat !== 'number' || typeof lon !== 'number') return;
  try {
 deps.addMapMarker(lat, lon, alert.alertId);
  } catch {
 // ignore
  }
}

/**
 * Fans one reactor alert out to the inbox, toast, native notification and map
 * marker. Resolves `false` only while a native send it attempted is still
 * undelivered, so the reactor offers the alert again on its next ingest
 * (R4-BUG-002). The inbox row, toast and marker are one-time.
 */
async function deliver(alert: ReactorAlert, deps: RouterDeps): Promise<boolean> {
  const nowMs = deps.now();
  prunePendingNative(nowMs);
  const trace = createRouterTrace(alert, nowMs);
  if (SEVERITY_RANK[alert.threat.severity] < SEVERITY_RANK[config.minSeverity]) {
    suppressRouterTrace(trace, 'below-min-severity');
    return true;
  }
  if (pendingNative.has(alert.alertId)) return retryNative(alert, deps, nowMs, trace);
  if (await isDuplicate(alert, deps, nowMs)) {
    suppressRouterTrace(trace, 'duplicate-within-window');
    return true;
  }
  const ghost = await safeIsGhost(deps);
  await safePut(deps, alertToUnified(alert));
  safeToast(deps, alert);
  dispatchRouterTrace(trace, nowMs);
  const attempt = await safeNative(deps, alert, ghost, nowMs, trace);
  safeMarker(deps, alert, ghost);
  if (attempt !== 'not_delivered') return true;
  pendingNative.set(alert.alertId, nowMs);
  return false;
}

/**
 * The same alert again after an undelivered native send: retry only the native
 * send, under the current Ghost Mode, settings and severity window. The alert
 * stays pending until a send is delivered or the dedupe window passes.
 */
async function retryNative(
  alert: ReactorAlert,
  deps: RouterDeps,
  nowMs: number,
  trace: RouterTrace | undefined,
): Promise<boolean> {
  recordRouterEvent(trace, 'Native retry after an undelivered send; inbox, toast and map are not repeated.');
  dispatchRouterTrace(trace, nowMs);
  const ghost = await safeIsGhost(deps);
  if ((await safeNative(deps, alert, ghost, nowMs, trace)) !== 'delivered') return false;
  pendingNative.delete(alert.alertId);
  return true;
}

function prunePendingNative(nowMs: number): void {
  for (const [alertId, firstAttempt] of pendingNative) {
    if (nowMs - firstAttempt > DEDUPE_WINDOW_MS) pendingNative.delete(alertId);
  }
}

interface RouterTrace {
  registry: NotificationTraceRegistry;
  candidateId: string;
}

function routerUrgency(severity: Severity): NotificationUrgency {
  switch (severity) {
    case 'critical': { return 'critical'; }
    case 'high': { return 'high'; }
    case 'medium': { return 'normal'; }
    case 'low': { return 'low'; }
  }
}

function normalizedTraceScore(score: number): number {
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score / 100)) : 0;
}

function createRouterTrace(alert: ReactorAlert, nowMs: number): RouterTrace | undefined {
  try {
    const registry = getNotificationTraceRegistry();
    const candidateId = `router-${alert.alertId}-${nowMs}-${nextTraceId++}`;
    const severity = alert.threat.severity;
    registry.register({
      candidateId,
      situationId: alert.alertId,
      domain: 'cyber',
      urgency: routerUrgency(severity),
      confidence: normalizedTraceScore(alert.relevance.score),
      userRelevance: normalizedTraceScore(alert.relevance.score),
      safetyCritical: severity === 'critical',
      createdAt: nowMs,
      headline: alert.threat.title,
    });
    registry.recordEvent(candidateId, {
      kind: 'urgency_check',
      reason: `Severity ${severity}; minimum ${config.minSeverity}.`,
    });
    return { registry, candidateId };
  } catch {
    return undefined;
  }
}

function suppressRouterTrace(trace: RouterTrace | undefined, reason: string): void {
  try {
    trace?.registry.suppress(trace.candidateId, reason);
  } catch { /* diagnostics must not block delivery */ }
}

function recordRouterEvent(trace: RouterTrace | undefined, reason: string): void {
  try {
    trace?.registry.recordEvent(trace.candidateId, { kind: 'dedupe_check', reason });
  } catch { /* diagnostics must not block delivery */ }
}

function dispatchRouterTrace(trace: RouterTrace | undefined, at: number): void {
  try {
    trace?.registry.dispatch(trace.candidateId, 'in_app', at);
  } catch { /* diagnostics must not block delivery */ }
}

function recordRouterNativeResult(
  trace: RouterTrace | undefined,
  result: Parameters<NotificationTraceRegistry['recordNativeResult']>[1],
): void {
  try {
    trace?.registry.recordNativeResult(trace.candidateId, result);
  } catch { /* diagnostics must not block delivery */ }
}

const NOOP = (): void => {
  // no-op
};

export function startNotificationRouter(deps?: RouterDeps): () => void {
  if (routerStarted) return NOOP;
  routerStarted = true;
  const resolved = deps ?? defaultDeps();
  activeDeps = resolved;

  let unsubscribe: () => void = NOOP;
  void (async () => {
 try {
 const mod = await import('./threat-reactor');
 // deliver() resolves false while a native send is undelivered; the
 // reactor then offers the same alert again on its next ingest.
 unsubscribe = mod.onAlert((alert) => deliver(alert, resolved));
 } catch {
 // threat-reactor not available — router is inert
 }
  })();

  return () => {
 try {
 unsubscribe();
 } finally {
 if (activeDeps === resolved) activeDeps = null;
 }
  };
}

/** Test hook: deliver an alert directly through the active deps. */
export async function __deliverForTesting(alert: ReactorAlert): Promise<void> {
  if (!activeDeps) throw new Error('router not started');
  await deliver(alert, activeDeps);
}

/** Test hook: reset module state. */
export function __resetForTesting(): void {
  lastNotifiedBySeverity.clear();
  pendingNative.clear();
  nextTraceId = 1;
  config = { ...DEFAULT_CONFIG };
  activeDeps = null;
  routerStarted = false;
}
