/**
 * Notification Router — single chokepoint that fans out a ReactorAlert
 * into all configured output channels (inbox, toast, native notification,
 * map marker). Severity-gated, deduped against alertDB, rate-limited per
 * severity for native notifications only. Honors Ghost Mode by skipping
 * native notification + map marker.
 */

import type { ReactorAlert } from './threat-reactor';
import type { UnifiedAlert, AlertSeverity } from './unified-alerts';

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
  sendNativeNotification: (title: string, body: string) => Promise<void> | void;
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
): Promise<void> {
  try {
 const mod = (await import('./tauri-bridge')) as {
 tryInvokeTauri?: (
 cmd: string,
 args: Record<string, unknown>,
 ) => Promise<unknown>;
 };
 if (typeof mod.tryInvokeTauri === 'function') {
 await mod.tryInvokeTauri('send_notification', {
 title,
 body,
 });
 }
  } catch {
 // swallow — notifications are best-effort
  }
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

async function safeNative(
  deps: RouterDeps,
  alert: ReactorAlert,
  ghost: boolean,
  nowMs: number,
): Promise<void> {
  if (!config.notifyNative || ghost) return;
  const sev = alert.threat.severity;
  const limit = RATE_LIMIT_MS[sev];
  const last = lastNotifiedBySeverity.get(sev) ?? 0;
  if (limit !== 0 && nowMs - last < limit) return;
  lastNotifiedBySeverity.set(sev, nowMs);
  try {
 await deps.sendNativeNotification(alert.threat.title, alert.threat.body);
  } catch {
 // ignore
  }
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

async function deliver(alert: ReactorAlert, deps: RouterDeps): Promise<void> {
  if (SEVERITY_RANK[alert.threat.severity] < SEVERITY_RANK[config.minSeverity]) {
 return;
  }
  const nowMs = deps.now();
  if (await isDuplicate(alert, deps, nowMs)) return;
  const ghost = await safeIsGhost(deps);
  await safePut(deps, alertToUnified(alert));
  safeToast(deps, alert);
  await safeNative(deps, alert, ghost, nowMs);
  safeMarker(deps, alert, ghost);
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
 unsubscribe = mod.onAlert((alert) => {
 void deliver(alert, resolved);
 });
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
  config = { ...DEFAULT_CONFIG };
  activeDeps = null;
  routerStarted = false;
}
