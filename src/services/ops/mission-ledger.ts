/**
 * Mission ledger — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 1 (lines 430-438).
 *
 * Pure deterministic in-memory store with serialize / loadJson for
 * persistence. Tracks mission events across detection, warning,
 * action, and outcome.
 *
 * No DOM, no fetch, no globals at import time. PR 2 (time-to-warn),
 * PR 3 (explanation QA), PR 4-N (effectiveness, near-miss, replay)
 * read from this ledger.
 *
 * Plan invariants:
 *   - Every event is timestamped + carries a stable id
 *   - Mission records are JSON-serializable (audit trail + replay)
 *   - Resolution is one-shot: once a mission is resolved, the ledger
 *     refuses to flip it back to 'active'
 */

import type {
  MissionDomain,
  MissionEvent,
  MissionEventKind,
  MissionLedgerSnapshot,
  MissionRecord,
  MissionStatus,
} from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface MissionLedger {
  /** Open a new mission. The id is yours; the ledger generates one
   *  if you pass an empty string. Throws when the id collides. */
  openMission: (record: Omit<MissionRecord, 'events' | 'status'> & {
    events?: readonly MissionEvent[];
    status?: MissionStatus;
  }) => MissionRecord;
  /** Append an event to a mission. Returns the recorded event with
   *  id assigned. Throws when the mission doesn't exist or has
   *  already been resolved. */
  recordEvent: (
    missionId: string,
    event: Omit<MissionEvent, 'id'> & { id?: string },
  ) => MissionEvent;
  /** Resolve a mission with the given status + reason. Refuses to
   *  re-resolve an already-resolved mission. */
  resolveMission: (
    missionId: string,
    status: Extract<MissionStatus, 'resolved_hit' | 'resolved_miss' | 'expired' | 'cancelled'>,
    reason: string,
    resolvedAt?: number,
  ) => MissionRecord;
  /** Get a mission by id. */
  get: (missionId: string) => MissionRecord | undefined;
  /** All missions, oldest first by createdAt. */
  all: () => MissionRecord[];
  /** Snapshot for diagnostic surfaces. */
  snapshot: () => MissionLedgerSnapshot;
  /** Serialize for persistence. */
  toJson: () => MissionRecord[];
  /** Bulk-load from a previous toJson result. Replaces current state. */
  loadJson: (records: readonly MissionRecord[]) => void;
}

export interface MissionLedgerOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export function createMissionLedger(options: MissionLedgerOptions = {}): MissionLedger {
  const now = options.now ?? (() => Date.now());
  const missions = new Map<string, MissionRecord>();
  let nextEventId = 1;
  let nextMissionId = 1;

  function ensureMissionId(provided: string | undefined): string {
    if (!provided) return `mission-${nextMissionId++}`;
    return provided;
  }

  function openMission(input: Omit<MissionRecord, 'events' | 'status'> & {
    events?: readonly MissionEvent[];
    status?: MissionStatus;
  }): MissionRecord {
    const id = ensureMissionId(input.id);
    if (missions.has(id)) {
      throw new Error(`Mission "${id}" already exists`);
    }
    const record: MissionRecord = {
      id,
      domain: input.domain,
      description: input.description,
      createdAt: input.createdAt ?? now(),
      status: input.status ?? 'active',
      events: input.events ?? [],
      factId: input.factId,
      placeId: input.placeId,
      originAlgorithmId: input.originAlgorithmId,
      explanationScore: input.explanationScore,
      resolvedAt: input.resolvedAt,
      resolutionReason: input.resolutionReason,
    };
    missions.set(id, record);
    return cloneMission(record);
  }

  function recordEvent(
    missionId: string,
    event: Omit<MissionEvent, 'id'> & { id?: string },
  ): MissionEvent {
    const mission = missions.get(missionId);
    if (!mission) throw new Error(`Mission "${missionId}" not found`);
    if (isResolved(mission.status)) {
      throw new Error(`Mission "${missionId}" is resolved; no further events allowed`);
    }
    const recorded: MissionEvent = {
      id: event.id ?? `me-${nextEventId++}`,
      at: event.at,
      kind: event.kind,
      label: event.label,
      detail: event.detail,
      uncertaintyMs: event.uncertaintyMs,
    };
    missions.set(missionId, {
      ...mission,
      events: [...mission.events, recorded],
    });
    return { ...recorded };
  }

  function resolveMission(
    missionId: string,
    status: Extract<MissionStatus, 'resolved_hit' | 'resolved_miss' | 'expired' | 'cancelled'>,
    reason: string,
    resolvedAt?: number,
  ): MissionRecord {
    const mission = missions.get(missionId);
    if (!mission) throw new Error(`Mission "${missionId}" not found`);
    if (isResolved(mission.status)) {
      throw new Error(`Mission "${missionId}" already resolved as ${mission.status}`);
    }
    const updated: MissionRecord = {
      ...mission,
      status,
      resolvedAt: resolvedAt ?? now(),
      resolutionReason: reason,
    };
    missions.set(missionId, updated);
    return cloneMission(updated);
  }

  function get(missionId: string): MissionRecord | undefined {
    const m = missions.get(missionId);
    return m ? cloneMission(m) : undefined;
  }

  function all(): MissionRecord[] {
    return [...missions.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => cloneMission(m));
  }

  function snapshot(): MissionLedgerSnapshot {
    const list = all();
    const countsByDomain = emptyDomainMap();
    const countsByStatus = emptyStatusMap();
    for (const mission of list) {
      countsByDomain[mission.domain] += 1;
      countsByStatus[mission.status] += 1;
    }
    return {
      generatedAt: now(),
      missions: list,
      countsByDomain,
      countsByStatus,
    };
  }

  function toJson(): MissionRecord[] {
    return all();
  }

  function loadJson(records: readonly MissionRecord[]): void {
    missions.clear();
    nextMissionId = 1;
    nextEventId = 1;
    for (const record of records) {
      missions.set(record.id, cloneMission(record));
      bumpIdCountersFromRecord(record);
    }
  }

  function bumpIdCountersFromRecord(record: MissionRecord): void {
    for (const event of record.events) {
      const n = parseTrailingNumber(event.id, 'me-');
      if (n !== undefined && n >= nextEventId) nextEventId = n + 1;
    }
    const m = parseTrailingNumber(record.id, 'mission-');
    if (m !== undefined && m >= nextMissionId) nextMissionId = m + 1;
  }

  return {
    openMission,
    recordEvent,
    resolveMission,
    get,
    all,
    snapshot,
    toJson,
    loadJson,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseTrailingNumber(id: string, prefix: string): number | undefined {
  if (!id.startsWith(prefix)) return undefined;
  const tail = id.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return undefined;
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : undefined;
}

function isResolved(status: MissionStatus): boolean {
  return status === 'resolved_hit' || status === 'resolved_miss' ||
    status === 'expired' || status === 'cancelled';
}

function cloneMission(m: MissionRecord): MissionRecord {
  return {
    ...m,
    events: m.events.map((e) => ({ ...e, detail: e.detail ? { ...e.detail } : undefined })),
  };
}

function emptyDomainMap(): Record<MissionDomain, number> {
  return {
    weather_safety: 0,
    conflict_escalation: 0,
    cyber_exposure: 0,
    food_commodity_shortage: 0,
    energy_fuel_stress: 0,
    travel_disruption: 0,
    market_portfolio_risk: 0,
    local_infrastructure: 0,
  };
}

function emptyStatusMap(): Record<MissionStatus, number> {
  return {
    active: 0,
    resolved_hit: 0,
    resolved_miss: 0,
    expired: 0,
    cancelled: 0,
  };
}

// ── Convenience: filter helpers ─────────────────────────────────────────

export function eventsByKind(
  mission: MissionRecord,
  kind: MissionEventKind,
): MissionEvent[] {
  return mission.events.filter((e) => e.kind === kind);
}

export function firstEventOfKind(
  mission: MissionRecord,
  kind: MissionEventKind,
): MissionEvent | undefined {
  return mission.events.find((e) => e.kind === kind);
}
