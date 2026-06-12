/**
 * EEW alert ledger persistence — Layer 8.
 *
 * Survives the in-memory `EewAlertLedger` across app restarts so dedup
 * + upgrade detection work after a relaunch. Without this, every restart
 * within the 1h dedup window would re-fire alerts that were already
 * delivered.
 *
 * Mirrors `algorithm-ledger-persistence.ts` shape:
 *   - hydrate / persist functions
 *   - corrupt payloads fail closed (in-memory ledger left empty)
 *   - injectable read/write/now adapters for tests
 *   - status singleton observable for the diagnostics surface
 */

import type {
  EewAlert,
  EewAlertLedger,
  EewLedgerEvent,
  EewTier,
} from './eew-alert-engine';
import { emptyLedger } from './eew-alert-engine';

// `persistent-cache.ts` pulls Vite's `import.meta.glob` transitively
// through the runtime/tauri-bridge/i18n chain — dynamic-import inside
// the default adapters keeps unit tests free of that chain (they inject
// their own read/write).
type PersistentCacheModule = typeof import('../persistent-cache');
let cacheModule: Promise<PersistentCacheModule> | undefined;
function loadPersistentCache(): Promise<PersistentCacheModule> {
  cacheModule ??= import('../persistent-cache');
  return cacheModule;
}

// ── Public constants ───────────────────────────────────────────────────

export const EEW_LEDGER_CACHE_KEY = 'eew-alert-ledger:v1';
export const EEW_RECENT_ALERTS_CAP = 200;

// ── Public types ───────────────────────────────────────────────────────

export type LedgerPersistenceLifecycle = 'idle' | 'ok' | 'error';

export interface EewLedgerPersistenceStatus {
  lastLoadStatus: LedgerPersistenceLifecycle;
  lastLoadedAt: number | null;
  lastSaveStatus: LedgerPersistenceLifecycle;
  lastSavedAt: number | null;
  eventCount: number;
  recentAlertsCount: number;
  rejectedCount: number;
  lastError: string | null;
}

export interface EewLedgerPayload {
  schemaVersion: 1;
  ledger: EewAlertLedger;
  recentAlerts: EewAlert[];
}

export interface EewPersistenceDeps {
  /** Returns null when nothing is cached. May throw — hydrate treats any
   *  throw as a corrupt-payload event. */
  read?: (key: string) => Promise<EewLedgerPayload | null>;
  write?: (key: string, payload: EewLedgerPayload) => Promise<void>;
  now?: () => number;
}

// ── Module-level state ─────────────────────────────────────────────────

let status: EewLedgerPersistenceStatus = freshStatus();
let inMemoryLedger: EewAlertLedger = emptyLedger();
let recentAlerts: EewAlert[] = [];

function freshStatus(): EewLedgerPersistenceStatus {
  return {
    lastLoadStatus: 'idle',
    lastLoadedAt: null,
    lastSaveStatus: 'idle',
    lastSavedAt: null,
    eventCount: 0,
    recentAlertsCount: 0,
    rejectedCount: 0,
    lastError: null,
  };
}

export function getEewLedgerPersistenceStatus(): EewLedgerPersistenceStatus {
  return { ...status };
}

export function getInMemoryLedger(): EewAlertLedger {
  return inMemoryLedger;
}

export function setInMemoryLedger(next: EewAlertLedger): void {
  inMemoryLedger = next;
  status = { ...status, eventCount: Object.keys(next.events).length };
}

export function getRecentAlerts(): readonly EewAlert[] {
  return recentAlerts;
}

export function appendRecentAlerts(alerts: readonly EewAlert[]): void {
  if (alerts.length === 0) return;
  recentAlerts = [...recentAlerts, ...alerts].slice(-EEW_RECENT_ALERTS_CAP);
  status = { ...status, recentAlertsCount: recentAlerts.length };
}

/** Test-only reset. */
export function resetEewLedgerPersistence(): void {
  status = freshStatus();
  inMemoryLedger = emptyLedger();
  recentAlerts = [];
}

// ── Hydrate ────────────────────────────────────────────────────────────

export async function hydrateEewLedger(
  deps: EewPersistenceDeps = {},
): Promise<EewLedgerPersistenceStatus> {
  const read = deps.read ?? defaultRead;
  const now = deps.now ?? Date.now;

  let raw: EewLedgerPayload | null;
  try {
    raw = await read(EEW_LEDGER_CACHE_KEY);
  } catch (error) {
    return failLoad(error, now);
  }

  if (raw === null) {
    status = {
      ...status,
      lastLoadStatus: 'ok',
      lastLoadedAt: now(),
      eventCount: Object.keys(inMemoryLedger.events).length,
      recentAlertsCount: recentAlerts.length,
      lastError: null,
    };
    return getEewLedgerPersistenceStatus();
  }

  const validated = validatePayload(raw);
  if (!validated.ok) {
    status = {
      ...status,
      lastLoadStatus: 'error',
      lastLoadedAt: now(),
      rejectedCount: status.rejectedCount + 1,
      lastError: validated.reason,
    };
    // Fail closed: leave in-memory ledger as-is (typically empty at boot).
    return getEewLedgerPersistenceStatus();
  }

  inMemoryLedger = validated.payload.ledger;
  recentAlerts = validated.payload.recentAlerts.slice(-EEW_RECENT_ALERTS_CAP);
  status = {
    ...status,
    lastLoadStatus: 'ok',
    lastLoadedAt: now(),
    eventCount: Object.keys(inMemoryLedger.events).length,
    recentAlertsCount: recentAlerts.length,
    lastError: null,
  };
  return getEewLedgerPersistenceStatus();
}

// ── Persist ────────────────────────────────────────────────────────────

export async function persistEewLedger(
  deps: EewPersistenceDeps = {},
): Promise<EewLedgerPersistenceStatus> {
  const write = deps.write ?? defaultWrite;
  const now = deps.now ?? Date.now;

  const payload: EewLedgerPayload = {
    schemaVersion: 1,
    ledger: inMemoryLedger,
    recentAlerts,
  };

  try {
    await write(EEW_LEDGER_CACHE_KEY, payload);
  } catch (error) {
    return failSave(error, now);
  }
  status = {
    ...status,
    lastSaveStatus: 'ok',
    lastSavedAt: now(),
    eventCount: Object.keys(inMemoryLedger.events).length,
    recentAlertsCount: recentAlerts.length,
    lastError: null,
  };
  return getEewLedgerPersistenceStatus();
}

// ── Validation ─────────────────────────────────────────────────────────

interface ValidationOk { ok: true; payload: EewLedgerPayload }
interface ValidationFail { ok: false; reason: string }

export function validatePayload(raw: unknown): ValidationOk | ValidationFail {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 1) return { ok: false, reason: `unsupported schemaVersion ${String(r.schemaVersion)}` };

  const ledger = r.ledger;
  if (!ledger || typeof ledger !== 'object') return { ok: false, reason: 'ledger missing or not an object' };
  const ledgerEvents = (ledger as Record<string, unknown>).events;
  if (!ledgerEvents || typeof ledgerEvents !== 'object') {
    return { ok: false, reason: 'ledger.events missing or not an object' };
  }

  const validatedEvents: Record<string, EewLedgerEvent> = {};
  for (const [key, value] of Object.entries(ledgerEvents)) {
    const entry = validateLedgerEvent(value);
    if (!entry) return { ok: false, reason: `ledger.events[${key}] failed shape check` };
    validatedEvents[key] = entry;
  }

  const recentRaw = Array.isArray(r.recentAlerts) ? r.recentAlerts : [];
  const recentAlerts: EewAlert[] = [];
  for (const item of recentRaw) {
    const alert = validateAlert(item);
    if (alert) recentAlerts.push(alert);
  }

  return {
    ok: true,
    payload: {
      schemaVersion: 1,
      ledger: { events: validatedEvents },
      recentAlerts,
    },
  };
}

const TIERS: ReadonlySet<EewTier> = new Set([
  'TIER_1_INFO', 'TIER_2_WATCH', 'TIER_3_WARNING', 'TIER_4_SEVERE', 'TIER_5_EXTREME',
]);

function isTier(value: unknown): value is EewTier {
  return typeof value === 'string' && TIERS.has(value as EewTier);
}

function validateLedgerEvent(value: unknown): EewLedgerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isTier(v.highestTier)) return null;
  const fired = v.tierFiredAt;
  if (!fired || typeof fired !== 'object') return null;
  const tierFiredAt: Partial<Record<EewTier, number>> = {};
  for (const [tier, ts] of Object.entries(fired as Record<string, unknown>)) {
    if (!isTier(tier)) return null;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
    tierFiredAt[tier] = ts;
  }
  return { highestTier: v.highestTier, tierFiredAt };
}

function validateAlert(value: unknown): EewAlert | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.eventId !== 'string' || v.eventId.length === 0) return null;
  if (!isTier(v.tier)) return null;
  if (typeof v.reason !== 'string') return null;
  if (typeof v.triggeredAt !== 'number' || !Number.isFinite(v.triggeredAt)) return null;
  return {
    eventId: v.eventId,
    tier: v.tier,
    reason: v.reason,
    triggeredAt: v.triggeredAt,
    upgradedFrom: isTier(v.upgradedFrom) ? v.upgradedFrom : undefined,
    imessageStatus: isImessageStatus(v.imessageStatus) ? v.imessageStatus : undefined,
    imessageError: typeof v.imessageError === 'string' ? v.imessageError : undefined,
  };
}

function isImessageStatus(value: unknown): value is 'pending' | 'sent' | 'failed' | 'disabled' {
  return value === 'pending' || value === 'sent' || value === 'failed' || value === 'disabled';
}

// ── Defaults ───────────────────────────────────────────────────────────

async function defaultRead(key: string): Promise<EewLedgerPayload | null> {
  const { getPersistentCache } = await loadPersistentCache();
  const envelope = await getPersistentCache<EewLedgerPayload>(key);
  return envelope ? envelope.data : null;
}

async function defaultWrite(key: string, payload: EewLedgerPayload): Promise<void> {
  const { setPersistentCache } = await loadPersistentCache();
  await setPersistentCache<EewLedgerPayload>(key, payload, 365 * 24 * 60 * 60 * 1000);
}

function failLoad(error: unknown, now: () => number): EewLedgerPersistenceStatus {
  const reason = error instanceof Error ? error.message : String(error);
  status = {
    ...status,
    lastLoadStatus: 'error',
    lastLoadedAt: now(),
    lastError: reason,
  };
  return getEewLedgerPersistenceStatus();
}

function failSave(error: unknown, now: () => number): EewLedgerPersistenceStatus {
  const reason = error instanceof Error ? error.message : String(error);
  status = {
    ...status,
    lastSaveStatus: 'error',
    lastSavedAt: now(),
    lastError: reason,
  };
  return getEewLedgerPersistenceStatus();
}
