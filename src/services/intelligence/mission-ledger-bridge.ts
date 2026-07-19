/**
 * Mission Ledger Bridge — closes the learning loop.
 *
 * Subscribes to the per-mission event ledger (`src/services/ops/
 * mission-ledger.ts`) and translates each new MissionEvent or
 * status transition into an OutcomeRecord on the intelligence
 * `OutcomeLedger`. That feeds back into per-domain calibration
 * so the next round of scoring learns from what actually happened.
 *
 * The upstream ledger has no subscribe API, so the bridge polls
 * `getMissionLedger().all()` on a configurable interval and diffs
 * the snapshot against an in-memory cursor. Tests drive `poll()`
 * directly without starting the timer.
 *
 * Pure module — no DOM, no fetch at import time. Persists the
 * processed-cursor state to localStorage under `wm-mission-ledger-bridge`
 * so a renderer reload doesn't re-emit historical outcomes.
 */

import {
  getOutcomeLedger,
  type OutcomeAction,
  type OutcomeLedger,
  type OutcomeRecord,
  type PredictedSeverity,
} from './outcome-ledger';
import { logDebug } from '../reasoning-debug';
import { getMissionLedger } from '../ops/mission-state';
import type { MissionLedger } from '../ops/mission-ledger';
import type {
  MissionDomain,
  MissionEvent,
  MissionEventKind,
  MissionRecord,
  MissionStatus,
} from '../ops/mission-types';

// ── Public types ──────────────────────────────────────────────────────

export interface BridgedEntry {
  /** The OutcomeRecord written to the intelligence ledger. */
  outcome: OutcomeRecord;
  /** Mission that triggered the bridge to fire. */
  missionId: string;
  /** Mission event the entry is anchored on. Empty for status-only
   *  transitions (resolve / expire / cancel). */
  missionEventId: string | null;
  /** Trigger kind for diagnostics: 'event' = user action / near miss;
   *  'status' = mission resolved or otherwise terminal. */
  trigger: 'event' | 'status';
}

export interface BridgeStats {
  totalRecorded: number;
  todayRecorded: number;
  /** Counts per OutcomeAction across every recorded entry. */
  byAction: Record<OutcomeAction, number>;
  /** ISO timestamp of the most recent bridged entry. */
  lastRecordedAt: string | null;
}

export type BridgeListener = (entry: BridgedEntry) => void;

export interface MissionLedgerBridgeOptions {
  /** Override the upstream mission ledger. Defaults to the global
   *  singleton from `src/services/ops/mission-state.ts`. */
  missionLedger?: MissionLedger;
  /** Override the outcome ledger. Defaults to the global singleton. */
  outcomeLedger?: OutcomeLedger;
  /** Override Date.now(). */
  clock?: () => number;
  /** Polling interval when `connect()` starts the timer. */
  intervalMs?: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-mission-ledger-bridge';
const DEFAULT_INTERVAL_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** MissionDomain → OutcomeLedger domain string. The intelligence
 *  ledger uses free-form domain strings; this gives the bridge a
 *  stable canonical mapping so per-domain calibration aggregates
 *  cleanly. */
const DOMAIN_MAP: Record<MissionDomain, string> = {
  weather_safety: 'weather',
  conflict_escalation: 'conflict',
  cyber_exposure: 'cyber',
  food_commodity_shortage: 'food',
  energy_fuel_stress: 'energy',
  travel_disruption: 'travel',
  market_portfolio_risk: 'finance',
  local_infrastructure: 'infra',
};

const TERMINAL_STATUSES: ReadonlySet<MissionStatus> = new Set([
  'resolved_hit', 'resolved_miss', 'expired', 'cancelled',
]);

// ── Bridge ────────────────────────────────────────────────────────────

interface CursorState {
  /** Mission id → set of event ids the bridge has already emitted. */
  processedEvents: Record<string, string[]>;
  /** Mission id → status the last time the bridge processed it. */
  lastStatus: Record<string, MissionStatus>;
}

export class MissionLedgerBridge {
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<BridgeListener>();
  private recorded: BridgedEntry[] = [];
  private cursor: CursorState = { processedEvents: {}, lastStatus: {} };
  private hydrated = false;
  private opts: Required<Omit<MissionLedgerBridgeOptions, 'missionLedger' | 'outcomeLedger'>>;
  private missionLedger?: MissionLedger;
  private outcomeLedger?: OutcomeLedger;

  constructor(options: MissionLedgerBridgeOptions = {}) {
    this.missionLedger = options.missionLedger;
    this.outcomeLedger = options.outcomeLedger;
    this.opts = {
      clock: options.clock ?? (() => Date.now()),
      intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
    };
  }

  /** Start the polling timer. Idempotent — no-op when already running. */
  connect(): void {
    this.ensureHydrated();
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => {
      try { this.poll(); } catch (error) { logDebug({ level: 'warn', category: 'other', source: 'mission-ledger-bridge', message: 'poll error', data: { error: error instanceof Error ? error.message : String(error) } }); }
    }, this.opts.intervalMs);
  }

  /** Stop the polling timer. Safe to call when not connected. */
  disconnect(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isConnected(): boolean {
    return this.timer !== null;
  }

  /** Run one pass over the mission ledger, emitting new outcomes for
   *  every unseen event + status transition. Returns the entries that
   *  were emitted this pass. Tests call this directly. */
  poll(): BridgedEntry[] {
    this.ensureHydrated();
    const missions = this.resolveMissionLedger().all();
    const fresh: BridgedEntry[] = [];
    for (const mission of missions) {
      this.processMission(mission, fresh);
    }
    if (fresh.length > 0) this.persist();
    return fresh;
  }

  private processMission(mission: MissionRecord, sink: BridgedEntry[]): void {
    const seen = new Set(this.cursor.processedEvents[mission.id]);
    for (const event of mission.events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const action = mapEventToAction(event.kind);
      if (action) {
        const outcome = this.emit(mission, event, action);
        const entry: BridgedEntry = {
          outcome,
          missionId: mission.id,
          missionEventId: event.id,
          trigger: 'event',
        };
        sink.push(entry);
        this.notify(entry);
      }
    }
    this.cursor.processedEvents[mission.id] = [...seen];

    const previousStatus = this.cursor.lastStatus[mission.id];
    if (previousStatus !== mission.status && TERMINAL_STATUSES.has(mission.status)) {
      const action = mapResolutionToAction(mission);
      const outcome = this.emit(mission, null, action);
      const entry: BridgedEntry = {
        outcome,
        missionId: mission.id,
        missionEventId: null,
        trigger: 'status',
      };
      sink.push(entry);
      this.notify(entry);
    }
    this.cursor.lastStatus[mission.id] = mission.status;
  }

  private emit(
    mission: MissionRecord,
    event: MissionEvent | null,
    action: OutcomeAction,
  ): OutcomeRecord {
    const outcome = this.resolveOutcomeLedger().record({
      domain: DOMAIN_MAP[mission.domain] ?? mission.domain,
      predictedSeverity: inferSeverity(mission),
      actualOutcome: action,
      alertId: mission.factId,
      situationId: mission.factId,
      recordedAt: new Date(event?.at ?? this.opts.clock()),
      notes: event
        ? `Mission "${mission.description}" — ${event.kind}: ${event.label}`
        : `Mission "${mission.description}" resolved (${mission.status})`,
    });
    this.recorded.push({
      outcome,
      missionId: mission.id,
      missionEventId: event?.id ?? null,
      trigger: event ? 'event' : 'status',
    });
    return outcome;
  }

  private notify(entry: BridgedEntry): void {
    for (const listener of this.listeners) {
      try { listener(entry); } catch { /* isolate */ }
    }
  }

  // ── Reads ────────────────────────────────────────────────────────

  /** All bridge entries recorded since this instance was created
   *  (newest last). */
  getRecorded(): BridgedEntry[] {
    return this.recorded.map((e) => ({ ...e, outcome: { ...e.outcome } }));
  }

  /** Most-recent N entries (newest first), capped at the requested
   *  count. Defaults to 5 to match the panel's "last 5" pane. */
  getRecent(limit = 5): BridgedEntry[] {
    if (limit <= 0) return [];
    const tail = this.recorded.slice(-limit);
    const reversed: BridgedEntry[] = [];
    for (let i = tail.length - 1; i >= 0; i -= 1) reversed.push(tail[i]!);
    return reversed.map((e) => ({ ...e, outcome: { ...e.outcome } }));
  }

  stats(): BridgeStats {
    const byAction: Record<OutcomeAction, number> = {
      dismissed: 0,
      'acted-on': 0,
      escalated: 0,
      'de-escalated': 0,
      'confirmed-real': 0,
      'marked-false-positive': 0,
    };
    const now = this.opts.clock();
    const todayCutoff = now - DAY_MS;
    let todayRecorded = 0;
    let lastRecordedAt: string | null = null;
    for (const entry of this.recorded) {
      byAction[entry.outcome.actualOutcome] += 1;
      const at = entry.outcome.recordedAt.getTime();
      if (at >= todayCutoff) todayRecorded += 1;
      if (!lastRecordedAt || at > new Date(lastRecordedAt).getTime()) {
        lastRecordedAt = entry.outcome.recordedAt.toISOString();
      }
    }
    return {
      totalRecorded: this.recorded.length,
      todayRecorded,
      byAction,
      lastRecordedAt,
    };
  }

  subscribe(listener: BridgeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — clears cursor + recorded + persisted state. Does NOT
   *  touch the underlying outcome/mission ledgers. */
  resetForTesting(): void {
    this.disconnect();
    this.cursor = { processedEvents: {}, lastStatus: {} };
    this.recorded = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private resolveMissionLedger(): MissionLedger {
    return this.missionLedger ?? getMissionLedger();
  }

  private resolveOutcomeLedger(): OutcomeLedger {
    return this.outcomeLedger ?? getOutcomeLedger();
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as CursorState | null;
      if (!parsed || typeof parsed !== 'object') return;
      this.cursor = {
        processedEvents: sanitizeProcessedEvents(parsed.processedEvents),
        lastStatus: sanitizeLastStatus(parsed.lastStatus),
      };
    } catch {
      // corrupt blob — leave defaults
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.cursor));
    } catch {
      // quota / disabled — best effort
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function mapEventToAction(kind: MissionEventKind): OutcomeAction | null {
  switch (kind) {
    case 'user_acknowledged': { return 'acted-on';
    }
    case 'user_action_taken': { return 'acted-on';
    }
    case 'official_confirmed': { return 'confirmed-real';
    }
    case 'near_miss': { return 'marked-false-positive';
    }
    // The remaining kinds are pre-resolution noise; resolution events
    // are emitted via mapResolutionToAction when status flips.
    default: { return null;
    }
  }
}

function mapResolutionToAction(mission: MissionRecord): OutcomeAction {
  const userActed = mission.events.some(
    (e) => e.kind === 'user_action_taken' || e.kind === 'user_acknowledged',
  );
  switch (mission.status) {
    case 'resolved_hit': {
      return userActed ? 'acted-on' : 'confirmed-real';
    }
    case 'resolved_miss': {
      return 'marked-false-positive';
    }
    case 'expired': {
      return 'dismissed';
    }
    case 'cancelled': {
      return 'dismissed';
    }
    default: {
      return 'dismissed';
    }
  }
}

function inferSeverity(mission: MissionRecord): PredictedSeverity {
  // We don't carry a numeric severity on missions yet; collapse the
  // explanation score band into the outcome ledger's 4-tier ladder.
  const score = mission.explanationScore;
  if (typeof score !== 'number') return 'medium';
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

function sanitizeProcessedEvents(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string[]> = {};
  for (const [missionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof missionId !== 'string') continue;
    if (!Array.isArray(value)) continue;
    out[missionId] = value.filter((v): v is string => typeof v === 'string');
  }
  return out;
}

function sanitizeLastStatus(raw: unknown): Record<string, MissionStatus> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, MissionStatus> = {};
  const allowed: ReadonlySet<MissionStatus> = new Set([
    'active', 'resolved_hit', 'resolved_miss', 'expired', 'cancelled',
  ]);
  for (const [missionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof missionId !== 'string') continue;
    if (typeof value === 'string' && allowed.has(value as MissionStatus)) {
      out[missionId] = value as MissionStatus;
    }
  }
  return out;
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: MissionLedgerBridge | null = null;

export function getMissionLedgerBridge(): MissionLedgerBridge {
  _singleton ??= new MissionLedgerBridge();
  return _singleton;
}

export function __resetMissionLedgerBridgeSingleton(): void {
  _singleton?.disconnect();
  _singleton = null;
}

export const __internals = {
  DOMAIN_MAP,
  TERMINAL_STATUSES,
  mapEventToAction,
  mapResolutionToAction,
  inferSeverity,
  STORAGE_KEY,
  DEFAULT_INTERVAL_MS,
};
