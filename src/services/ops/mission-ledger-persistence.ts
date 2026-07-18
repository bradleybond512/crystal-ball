/**
 * Mission ledger persistence — per
 * docs/CLAUDE_ALGORITHM_ACCURACY_ENHANCEMENT_PLAN_2026-05-05.md PR 2.
 *
 * Mirrors `algorithm-ledger-persistence.ts` for the mission ledger so
 * mission timelines (detection -> warning -> action -> outcome) survive
 * app restarts. Without this, every restart wipes the audit trail the
 * outcome resolver (PR 3) needs to grade past algorithm decisions.
 *
 * Plan invariants:
 *   - Active missions are NEVER trimmed regardless of age or count cap.
 *   - Completed missions are trimmed by age cutoff first, then by count
 *     cap if still over the limit.
 *   - Corrupt persisted payloads must NOT crash startup. Fail closed.
 *   - Compact persisted form: event.detail is stripped from events on
 *     resolved missions to keep storage bounded; active missions keep
 *     full detail since downstream consumers may still need it.
 */

import { getDefaultDiagnosticBus } from '../diagnostics/diagnostic-events';
// NOTE: Do NOT import getMissionLedger at module scope — mission-state also
// imports resetMissionLedgerPersistence from this file, creating a real runtime
// circular dependency. The lazy getter below breaks the cycle. (arch-audit 2026-07-17)
import type {
  MissionDomain,
  MissionEvent,
  MissionEventKind,
  MissionRecord,
  MissionStatus,
} from './mission-types';
import type { MissionLedger } from './mission-ledger';

// mission-state registers its getter here at load (see arch-audit note above)
// so this file needs no back-import of mission-state — breaking the static
// cycle while staying synchronous and browser-safe (require() is undefined in
// the Vite/browser ESM runtime).
let _defaultMissionLedgerProvider: (() => MissionLedger) | null = null;

export function setDefaultMissionLedgerProvider(provider: () => MissionLedger): void {
  _defaultMissionLedgerProvider = provider;
}

function getDefaultMissionLedger(): MissionLedger {
  if (!_defaultMissionLedgerProvider) {
    throw new Error('[mission-ledger-persistence] default mission ledger provider not registered — import mission-state or pass an explicit ledger');
  }
  return _defaultMissionLedgerProvider();
}

// `persistent-cache.ts` pulls Vite's `import.meta.glob` transitively
// through the runtime/tauri-bridge/i18n chain, which makes a top-level
// import unsafe under plain `tsx --test`. Dynamic-import inside the
// default adapters keeps the unit tests free of that chain — they
// inject their own read/write anyway.
type PersistentCacheModule = typeof import('../persistent-cache');
let cacheModule: Promise<PersistentCacheModule> | undefined;
function loadPersistentCache(): Promise<PersistentCacheModule> {
  cacheModule ??= import('../persistent-cache');
  return cacheModule;
}

// ── Public constants ────────────────────────────────────────────────────

export const MISSION_LEDGER_CACHE_KEY = 'mission-ledger:v1';
export const DEFAULT_MAX_MISSIONS = 500;
export const DEFAULT_MAX_COMPLETED_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// ── Public types ────────────────────────────────────────────────────────

export type MissionPersistenceLifecycle = 'idle' | 'ok' | 'error';

export interface MissionLedgerPersistenceStatus {
  lastLoadStatus: MissionPersistenceLifecycle;
  lastLoadedAt: number | null;
  lastSaveStatus: MissionPersistenceLifecycle;
  lastSavedAt: number | null;
  /** Missions held in the in-memory ledger after the last hydrate /
   *  persist / trim pass. */
  missionCount: number;
  /** Missions dropped by the most recent
   *  `trimAndPersistMissionLedger` call. Resets each trim. */
  trimmedCount: number;
  /** Cumulative records dropped due to corrupt-payload rejection across
   *  the lifetime of this process. */
  rejectedCount: number;
  lastError: string | null;
}

export type MissionDiagnosticEmitter = (
  severity: 'info' | 'warning' | 'error' | 'critical',
  message: string,
  detail?: Record<string, unknown>,
) => void;

export interface MissionLedgerPersistenceDeps {
  ledger?: MissionLedger;
  read?: (key: string) => Promise<MissionRecord[] | null>;
  write?: (key: string, records: MissionRecord[]) => Promise<void>;
  emitDiagnostic?: MissionDiagnosticEmitter;
  now?: () => number;
}

export interface MissionTrimAndPersistOptions {
  maxMissions?: number;
  maxCompletedAgeMs?: number;
}

// ── Module-level status singleton ───────────────────────────────────────

let status: MissionLedgerPersistenceStatus = freshStatus();

function freshStatus(): MissionLedgerPersistenceStatus {
  return {
    lastLoadStatus: 'idle',
    lastLoadedAt: null,
    lastSaveStatus: 'idle',
    lastSavedAt: null,
    missionCount: 0,
    trimmedCount: 0,
    rejectedCount: 0,
    lastError: null,
  };
}

export function getMissionLedgerPersistenceStatus(): MissionLedgerPersistenceStatus {
  return { ...status };
}

/** Reset module state. Tests use this; app code does not. */
export function resetMissionLedgerPersistence(): void {
  status = freshStatus();
}

// ── Hydrate ─────────────────────────────────────────────────────────────

export async function hydrateMissionLedger(
  deps: MissionLedgerPersistenceDeps = {},
): Promise<MissionLedgerPersistenceStatus> {
  const ledger = deps.ledger ?? getDefaultMissionLedger();
  const read = deps.read ?? defaultRead;
  const emit = deps.emitDiagnostic ?? defaultEmit;
  const now = deps.now ?? Date.now;

  let raw: unknown;
  try {
    raw = await read(MISSION_LEDGER_CACHE_KEY);
  } catch (error) {
    return failLoad(error, emit, now);
  }

  if (raw == null) {
    status = {
      ...status,
      lastLoadStatus: 'ok',
      lastLoadedAt: now(),
      missionCount: ledger.all().length,
      lastError: null,
    };
    return getMissionLedgerPersistenceStatus();
  }

  const validated = validateMissionRecords(raw);
  if (!validated.ok) {
    status = {
      ...status,
      lastLoadStatus: 'error',
      lastLoadedAt: now(),
      rejectedCount: status.rejectedCount + (Array.isArray(raw) ? raw.length : 0),
      lastError: validated.reason,
    };
    emit('warning', 'Mission ledger persisted payload rejected as corrupt', {
      reason: validated.reason,
      key: MISSION_LEDGER_CACHE_KEY,
    });
    return getMissionLedgerPersistenceStatus();
  }

  ledger.loadJson(validated.records);
  status = {
    ...status,
    lastLoadStatus: 'ok',
    lastLoadedAt: now(),
    missionCount: ledger.all().length,
    lastError: null,
  };
  return getMissionLedgerPersistenceStatus();
}

// ── Persist ─────────────────────────────────────────────────────────────

export async function persistMissionLedger(
  deps: MissionLedgerPersistenceDeps = {},
): Promise<MissionLedgerPersistenceStatus> {
  const ledger = deps.ledger ?? getDefaultMissionLedger();
  const write = deps.write ?? defaultWrite;
  const emit = deps.emitDiagnostic ?? defaultEmit;
  const now = deps.now ?? Date.now;

  const compact = ledger.toJson().map((m) => toCompactMission(m));
  try {
    await write(MISSION_LEDGER_CACHE_KEY, compact);
  } catch (error) {
    return failSave(error, emit, now, compact.length);
  }
  status = {
    ...status,
    lastSaveStatus: 'ok',
    lastSavedAt: now(),
    missionCount: compact.length,
    lastError: null,
  };
  return getMissionLedgerPersistenceStatus();
}

// ── Trim + persist ──────────────────────────────────────────────────────

export async function trimAndPersistMissionLedger(
  options: MissionTrimAndPersistOptions = {},
  deps: MissionLedgerPersistenceDeps = {},
): Promise<MissionLedgerPersistenceStatus> {
  const ledger = deps.ledger ?? getDefaultMissionLedger();
  const now = deps.now ?? Date.now;
  const maxMissions = options.maxMissions ?? DEFAULT_MAX_MISSIONS;
  const maxCompletedAgeMs = options.maxCompletedAgeMs ?? DEFAULT_MAX_COMPLETED_AGE_MS;

  const before = ledger.all();
  const kept = applyMissionTrimPolicy(before, {
    maxMissions,
    maxCompletedAgeMs,
    nowMs: now(),
  });
  const trimmedCount = before.length - kept.length;

  if (trimmedCount > 0) {
    ledger.loadJson(kept);
  }

  status = { ...status, trimmedCount };
  return persistMissionLedger({ ...deps, ledger });
}

/** Deterministic trim used by `trimAndPersistMissionLedger`. Active
 *  missions are preserved regardless of age or count cap. Exposed for
 *  unit tests. */
export function applyMissionTrimPolicy(
  records: readonly MissionRecord[],
  options: { maxMissions: number; maxCompletedAgeMs: number; nowMs: number },
): MissionRecord[] {
  const { maxMissions, maxCompletedAgeMs, nowMs } = options;
  const ageCutoff = nowMs - maxCompletedAgeMs;

  // Phase A: drop completed missions whose resolvedAt (or createdAt
  // fallback) is older than the age cutoff. Active missions always
  // survive.
  const phaseA = records.filter((m) => {
    if (!isResolvedMission(m)) return true;
    const ts = m.resolvedAt ?? m.createdAt;
    return ts >= ageCutoff;
  });

  if (phaseA.length <= maxMissions) {
    return [...phaseA].sort((a, b) => a.createdAt - b.createdAt);
  }

  // Phase B: still over count cap. Drop oldest completed first; never
  // drop active missions.
  const sorted = [...phaseA].sort((a, b) => a.createdAt - b.createdAt);
  const active = sorted.filter((m) => !isResolvedMission(m));
  const completed = sorted.filter((m) => isResolvedMission(m));

  if (active.length >= maxMissions) {
    // Active missions alone exceed the cap. Per the plan, active
    // missions must be preserved — keep them all, drop every completed.
    return [...active].sort((a, b) => a.createdAt - b.createdAt);
  }

  const completedSlots = maxMissions - active.length;
  const keptCompleted = completed.slice(completed.length - completedSlots);
  return [...active, ...keptCompleted].sort((a, b) => a.createdAt - b.createdAt);
}

// ── Compaction ──────────────────────────────────────────────────────────

/** Strip event.detail from events on resolved missions to keep the
 *  persisted form compact and reduce stored detail surface. Active
 *  missions retain full detail because downstream consumers (outcome
 *  resolver, replay) may still need it. */
export function toCompactMission(record: MissionRecord): MissionRecord {
  if (!isResolvedMission(record)) {
    return record;
  }
  return {
    ...record,
    events: record.events.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      label: e.label,
      uncertaintyMs: e.uncertaintyMs,
    })),
  };
}

// ── Validation ──────────────────────────────────────────────────────────

interface MissionValidationOk {
  ok: true;
  records: MissionRecord[];
}
interface MissionValidationFail {
  ok: false;
  reason: string;
}

export function validateMissionRecords(raw: unknown): MissionValidationOk | MissionValidationFail {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'payload is not an array' };
  }
  const out: MissionRecord[] = [];
  let index = 0;
  for (const item of raw as readonly unknown[]) {
    if (!isMissionRecord(item)) {
      return { ok: false, reason: `mission at index ${index} failed shape check` };
    }
    out.push(item);
    index += 1;
  }
  return { ok: true, records: out };
}

const DOMAINS: ReadonlySet<MissionDomain> = new Set([
  'weather_safety',
  'conflict_escalation',
  'cyber_exposure',
  'food_commodity_shortage',
  'energy_fuel_stress',
  'travel_disruption',
  'market_portfolio_risk',
  'local_infrastructure',
]);

const STATUSES: ReadonlySet<MissionStatus> = new Set([
  'active',
  'resolved_hit',
  'resolved_miss',
  'expired',
  'cancelled',
]);

const EVENT_KINDS: ReadonlySet<MissionEventKind> = new Set([
  'weak_signal',
  'app_watch',
  'user_notified',
  'official_confirmed',
  'estimated_impact',
  'actual_impact',
  'user_acknowledged',
  'user_action_taken',
  'forecast_resolved',
  'near_miss',
]);

function isMissionRecord(value: unknown): value is MissionRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.description !== 'string') return false;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return false;
  if (typeof r.domain !== 'string' || !DOMAINS.has(r.domain as MissionDomain)) return false;
  if (typeof r.status !== 'string' || !STATUSES.has(r.status as MissionStatus)) return false;
  if (!Array.isArray(r.events)) return false;
  for (const event of r.events as readonly unknown[]) {
    if (!isMissionEvent(event)) return false;
  }
  return true;
}

function isMissionEvent(value: unknown): value is MissionEvent {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0) return false;
  if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return false;
  if (typeof e.label !== 'string') return false;
  if (typeof e.kind !== 'string' || !EVENT_KINDS.has(e.kind as MissionEventKind)) return false;
  return true;
}

function isResolvedMission(record: MissionRecord): boolean {
  return record.status !== 'active';
}

// ── Defaults ────────────────────────────────────────────────────────────

async function defaultRead(key: string): Promise<MissionRecord[] | null> {
  const { getPersistentCache } = await loadPersistentCache();
  const envelope = await getPersistentCache<MissionRecord[]>(key);
  return envelope ? envelope.data : null;
}

async function defaultWrite(key: string, records: MissionRecord[]): Promise<void> {
  const { setPersistentCache } = await loadPersistentCache();
  await setPersistentCache<MissionRecord[]>(key, records, 365 * 24 * 60 * 60 * 1000);
}

const defaultEmit: MissionDiagnosticEmitter = (severity, message, detail) => {
  try {
    getDefaultDiagnosticBus().emit({
      severity,
      kind: severity === 'info' ? 'service_success' : 'service_failure',
      serviceId: 'mission-ledger-persistence',
      message,
      detail,
    });
  } catch {
    // The diagnostic bus must never crash a persistence call.
  }
};

// ── Failure helpers ─────────────────────────────────────────────────────

function failLoad(
  error: unknown,
  emit: MissionDiagnosticEmitter,
  now: () => number,
): MissionLedgerPersistenceStatus {
  const reason = error instanceof Error ? error.message : String(error);
  status = {
    ...status,
    lastLoadStatus: 'error',
    lastLoadedAt: now(),
    lastError: reason,
  };
  emit('error', 'Mission ledger hydrate failed', {
    reason,
    key: MISSION_LEDGER_CACHE_KEY,
  });
  return getMissionLedgerPersistenceStatus();
}

function failSave(
  error: unknown,
  emit: MissionDiagnosticEmitter,
  now: () => number,
  attemptedCount: number,
): MissionLedgerPersistenceStatus {
  const reason = error instanceof Error ? error.message : String(error);
  status = {
    ...status,
    lastSaveStatus: 'error',
    lastSavedAt: now(),
    lastError: reason,
  };
  emit('error', 'Mission ledger persist failed', {
    reason,
    attemptedCount,
    key: MISSION_LEDGER_CACHE_KEY,
  });
  return getMissionLedgerPersistenceStatus();
}
