/**
 * What Changed v2 — world-state diff engine.
 *
 * Operates on ObservationEvents (PR #469) and Situations (PR #421)
 * rather than raw alert state. Produces typed WorldDeltas so UI surfaces
 * can render "what's different since 5 minutes ago" without re-running
 * domain-specific comparison logic.
 *
 * Pure deterministic: no DOM, no fetch. Persistence is delegated to a
 * StorageLike seam so tests can pass an in-memory map.
 */

import type { ObservationEvent } from './observation-adapters';
import type { Situation } from '@/types/intelligence';

export type DeltaType =
  | 'new-observation'
  | 'severity-escalated'
  | 'severity-deescalated'
  | 'situation-opened'
  | 'situation-updated'
  | 'situation-resolved'
  | 'entity-risk-changed'
  | 'feed-recovered'
  | 'feed-degraded';

export type DeltaSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface WorldDelta {
  id: string;
  type: DeltaType;
  domain: string;
  summary: string;
  severity: DeltaSeverity;
  previousValue?: unknown;
  currentValue?: unknown;
  entityIds?: string[];
  location?: { lat: number; lon: number };
  detectedAt: Date;
  situationId?: string;
}

export type FeedHealth = 'healthy' | 'degraded' | 'down';

export interface WorldSnapshot {
  id: string;
  takenAt: Date;
  observationIds: string[];
  /** Severity keyed by observation id — lets the diff detect
   *  per-observation escalations/de-escalations without the caller
   *  having to re-pass the prior observations. */
  observationSeverityById: Record<string, string>;
  activeSituationIds: string[];
  /** Status keyed by situation id — covers BOTH active and resolved so
   *  the diff can detect status transitions for known ids. */
  situationStatuses: Record<string, string>;
  /** Observation count per situation id — drives situation-updated
   *  deltas without needing to inspect Situation.updatedAt. */
  situationObservationCounts: Record<string, number>;
  feedHealthSummary: Record<string, FeedHealth>;
  /** Counts keyed by ObservationSeverity (uppercase). */
  severityCount: Record<string, number>;
  entityRiskScores: Record<string, number>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WhatChangedV2Options {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

const DEFAULT_CAPACITY = 500;
const DEFAULT_RECENT_WINDOW_MS = 60 * 60 * 1000;
const ENTITY_RISK_THRESHOLD = 0.15;
export const STORAGE_KEY = 'wm-what-changed-v2';

const SEVERITY_RANK: Record<string, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

function toDeltaSeverity(s: string): DeltaSeverity {
  if (s === 'CRITICAL') return 'critical';
  if (s === 'HIGH') return 'high';
  if (s === 'MEDIUM') return 'medium';
  return 'low';
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

interface SerializedDelta extends Omit<WorldDelta, 'detectedAt'> {
  detectedAt: number;
}

export class WhatChangedV2 {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly buffer: WorldDelta[] = [];
  private readonly ids = new Set<string>();
  private readonly subscribers = new Set<(d: WorldDelta) => void>();
  private snapshotCounter = 0;

  constructor(opts: WhatChangedV2Options = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  // ── Snapshot ────────────────────────────────────────────────────────

  snapshot(
    observations: readonly ObservationEvent[],
    situations: readonly Situation[],
    feedHealth: Record<string, FeedHealth>,
    entityRiskScores: Record<string, number> = {},
  ): WorldSnapshot {
    const observationIds = observations.map((o) => o.id);
    const observationSeverityById: Record<string, string> = {};
    const severityCount: Record<string, number> = {};
    for (const o of observations) {
      observationSeverityById[o.id] = o.severity;
      severityCount[o.severity] = (severityCount[o.severity] ?? 0) + 1;
    }
    const activeSituationIds: string[] = [];
    const situationStatuses: Record<string, string> = {};
    const situationObservationCounts: Record<string, number> = {};
    for (const s of situations) {
      situationStatuses[s.id] = s.status;
      situationObservationCounts[s.id] = s.observationIds.length;
      if (s.status !== 'resolved') activeSituationIds.push(s.id);
    }
    return {
      id: `snap-${this.clock()}-${this.snapshotCounter++}`,
      takenAt: new Date(this.clock()),
      observationIds,
      observationSeverityById,
      activeSituationIds,
      situationStatuses,
      situationObservationCounts,
      feedHealthSummary: { ...feedHealth },
      severityCount,
      entityRiskScores: { ...entityRiskScores },
    };
  }

  // ── Diff ────────────────────────────────────────────────────────────

  diff(
    prev: WorldSnapshot,
    curr: WorldSnapshot,
    observations: readonly ObservationEvent[],
    situations: readonly Situation[],
  ): WorldDelta[] {
    const out: WorldDelta[] = [];
    const detectedAt = curr.takenAt;

    diffObservations(prev, curr, observations, detectedAt, out);
    diffSituations(prev, curr, situations, detectedAt, out);
    diffEntityRisk(prev, curr, detectedAt, out);
    diffFeeds(prev, curr, detectedAt, out);

    return out;
  }

  // ── Recording / accessors ──────────────────────────────────────────

  record(delta: WorldDelta): boolean {
    if (this.ids.has(delta.id)) return false;
    this.ids.add(delta.id);
    this.buffer.push(delta);
    if (this.buffer.length > this.capacity) {
      const dropped = this.buffer.shift();
      if (dropped) this.ids.delete(dropped.id);
    }
    this.persist();
    for (const cb of this.subscribers) cb(delta);
    return true;
  }

  /** Most-recent first. Default window is 60 minutes — pass
   *  `Number.POSITIVE_INFINITY` to get the whole buffer. */
  getRecent(sinceMs: number = DEFAULT_RECENT_WINDOW_MS): WorldDelta[] {
    const cutoff = this.clock() - sinceMs;
    const out: WorldDelta[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const d = this.buffer[i];
      if (d && d.detectedAt.getTime() >= cutoff) out.push(d);
    }
    return out;
  }

  getByDomain(domain: string): WorldDelta[] {
    return this.buffer.filter((d) => d.domain === domain);
  }

  getByType(type: DeltaType): WorldDelta[] {
    return this.buffer.filter((d) => d.type === type);
  }

  getSummary(sinceMs: number = DEFAULT_RECENT_WINDOW_MS): string {
    const recent = this.getRecent(sinceMs);
    if (recent.length === 0) return 'No changes detected.';
    const counts = countDeltas(recent);
    return formatSummary(counts);
  }

  subscribe(cb: (delta: WorldDelta) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  clear(): void {
    this.buffer.length = 0;
    this.ids.clear();
    this.persist();
  }

  // ── Internals ──────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SerializedDelta[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (this.ids.has(item.id)) continue;
        const delta: WorldDelta = { ...item, detectedAt: new Date(item.detectedAt) };
        this.ids.add(delta.id);
        this.buffer.push(delta);
        if (this.buffer.length > this.capacity) {
          const dropped = this.buffer.shift();
          if (dropped) this.ids.delete(dropped.id);
        }
      }
    } catch {
      this.buffer.length = 0;
      this.ids.clear();
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: SerializedDelta[] = this.buffer.map((d) => ({
        ...d,
        detectedAt: d.detectedAt.getTime(),
      }));
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Diff helpers ──────────────────────────────────────────────────────

function diffObservations(
  prev: WorldSnapshot,
  curr: WorldSnapshot,
  observations: readonly ObservationEvent[],
  detectedAt: Date,
  out: WorldDelta[],
): void {
  const prevSet = new Set(prev.observationIds);
  const observationById = new Map<string, ObservationEvent>();
  for (const o of observations) observationById.set(o.id, o);

  for (const id of curr.observationIds) {
    if (prevSet.has(id)) continue;
    const event = observationById.get(id);
    if (event) out.push(buildNewObservationDelta(event, detectedAt));
  }

  for (const [id, currSev] of Object.entries(curr.observationSeverityById)) {
    const prevSev = prev.observationSeverityById[id];
    const transition = severityTransition(prevSev, currSev);
    if (!transition) continue;
    out.push(buildSeverityDelta(id, prevSev as string, currSev, transition, observationById.get(id), detectedAt));
  }
}

function severityTransition(prevSev: string | undefined, currSev: string): DeltaType | undefined {
  if (prevSev === undefined || prevSev === currSev) return undefined;
  const prevRank = SEVERITY_RANK[prevSev] ?? 0;
  const currRank = SEVERITY_RANK[currSev] ?? 0;
  if (currRank === prevRank) return undefined;
  return currRank > prevRank ? 'severity-escalated' : 'severity-deescalated';
}

function buildNewObservationDelta(event: ObservationEvent, detectedAt: Date): WorldDelta {
  return {
    id: `delta-new-${event.id}`,
    type: 'new-observation',
    domain: event.domain,
    summary: event.title || `New ${event.domain} event`,
    severity: toDeltaSeverity(event.severity),
    currentValue: { id: event.id, severity: event.severity },
    entityIds: event.entityIds.length > 0 ? [...event.entityIds] : undefined,
    location: event.location ? { lat: event.location.lat, lon: event.location.lon } : undefined,
    detectedAt,
  };
}

function buildSeverityDelta(
  id: string,
  prevSev: string,
  currSev: string,
  type: DeltaType,
  event: ObservationEvent | undefined,
  detectedAt: Date,
): WorldDelta {
  return {
    id: `delta-sev-${id}-${detectedAt.getTime()}`,
    type,
    domain: event?.domain ?? 'unknown',
    summary: `${event?.title ?? id}: severity ${prevSev} → ${currSev}`,
    severity: toDeltaSeverity(currSev),
    previousValue: { severity: prevSev },
    currentValue: { severity: currSev },
    entityIds: event && event.entityIds.length > 0 ? [...event.entityIds] : undefined,
    location: event?.location ? { lat: event.location.lat, lon: event.location.lon } : undefined,
    detectedAt,
  };
}

function diffSituations(
  prev: WorldSnapshot,
  curr: WorldSnapshot,
  situations: readonly Situation[],
  detectedAt: Date,
  out: WorldDelta[],
): void {
  const byId = new Map<string, Situation>();
  for (const s of situations) byId.set(s.id, s);
  const prevActive = new Set(prev.activeSituationIds);

  for (const id of curr.activeSituationIds) {
    const sit = byId.get(id);
    if (!sit) continue;
    if (prevActive.has(id)) {
      const update = buildSituationUpdatedDelta(sit, prev, curr, detectedAt);
      if (update) out.push(update);
    } else {
      out.push(buildSituationOpenedDelta(sit, detectedAt));
    }
  }

  for (const id of prev.activeSituationIds) {
    if (curr.situationStatuses[id] !== 'resolved') continue;
    out.push(buildSituationResolvedDelta(id, byId.get(id), detectedAt));
  }
}

function buildSituationOpenedDelta(sit: Situation, detectedAt: Date): WorldDelta {
  return {
    id: `delta-sit-open-${sit.id}-${detectedAt.getTime()}`,
    type: 'situation-opened',
    domain: sit.domain,
    summary: `Situation opened: ${sit.name}`,
    severity: situationDeltaSeverity(sit.severity),
    situationId: sit.id,
    currentValue: { status: sit.status },
    detectedAt,
  };
}

function buildSituationUpdatedDelta(
  sit: Situation,
  prev: WorldSnapshot,
  curr: WorldSnapshot,
  detectedAt: Date,
): WorldDelta | undefined {
  const prevCount = prev.situationObservationCounts[sit.id] ?? 0;
  const currCount = curr.situationObservationCounts[sit.id] ?? 0;
  if (currCount <= prevCount) return undefined;
  return {
    id: `delta-sit-update-${sit.id}-${detectedAt.getTime()}`,
    type: 'situation-updated',
    domain: sit.domain,
    summary: `Situation updated: ${sit.name} (${prevCount} → ${currCount} observations)`,
    severity: situationDeltaSeverity(sit.severity),
    situationId: sit.id,
    previousValue: { observationCount: prevCount },
    currentValue: { observationCount: currCount },
    detectedAt,
  };
}

function buildSituationResolvedDelta(
  id: string,
  sit: Situation | undefined,
  detectedAt: Date,
): WorldDelta {
  return {
    id: `delta-sit-resolve-${id}-${detectedAt.getTime()}`,
    type: 'situation-resolved',
    domain: sit?.domain ?? 'unknown',
    summary: sit ? `Situation resolved: ${sit.name}` : `Situation ${id} resolved`,
    severity: 'low',
    situationId: id,
    previousValue: { status: 'active' },
    currentValue: { status: 'resolved' },
    detectedAt,
  };
}

function situationDeltaSeverity(s: Situation['severity']): DeltaSeverity {
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'moderate') return 'medium';
  return 'low';
}

function diffEntityRisk(
  prev: WorldSnapshot,
  curr: WorldSnapshot,
  detectedAt: Date,
  out: WorldDelta[],
): void {
  for (const [entityId, currScore] of Object.entries(curr.entityRiskScores)) {
    const prevScore = prev.entityRiskScores[entityId] ?? 0;
    const change = Math.abs(currScore - prevScore);
    if (change <= ENTITY_RISK_THRESHOLD) continue;
    out.push({
      id: `delta-risk-${entityId}-${detectedAt.getTime()}`,
      type: 'entity-risk-changed',
      domain: 'entity',
      summary: `Entity ${entityId} risk ${prevScore.toFixed(2)} → ${currScore.toFixed(2)}`,
      severity: currScore >= 0.7 ? 'high' : 'medium',
      previousValue: prevScore,
      currentValue: currScore,
      entityIds: [entityId],
      detectedAt,
    });
  }
}

function diffFeeds(
  prev: WorldSnapshot,
  curr: WorldSnapshot,
  detectedAt: Date,
  out: WorldDelta[],
): void {
  const allKeys = new Set([
    ...Object.keys(prev.feedHealthSummary),
    ...Object.keys(curr.feedHealthSummary),
  ]);
  for (const feedId of allKeys) {
    const prevHealth = prev.feedHealthSummary[feedId];
    const currHealth = curr.feedHealthSummary[feedId];
    if (prevHealth === currHealth) continue;
    if (currHealth === undefined || prevHealth === undefined) continue;
    if (prevHealth !== 'healthy' && currHealth === 'healthy') {
      out.push({
        id: `delta-feed-recovered-${feedId}-${detectedAt.getTime()}`,
        type: 'feed-recovered',
        domain: 'feed-health',
        summary: `Feed ${feedId} recovered (${prevHealth} → healthy)`,
        severity: 'low',
        previousValue: prevHealth,
        currentValue: currHealth,
        entityIds: [feedId],
        detectedAt,
      });
    } else if (prevHealth === 'healthy' && currHealth !== 'healthy') {
      out.push({
        id: `delta-feed-degraded-${feedId}-${detectedAt.getTime()}`,
        type: 'feed-degraded',
        domain: 'feed-health',
        summary: `Feed ${feedId} ${currHealth} (was healthy)`,
        severity: currHealth === 'down' ? 'high' : 'medium',
        previousValue: prevHealth,
        currentValue: currHealth,
        entityIds: [feedId],
        detectedAt,
      });
    }
  }
}

// ── Summary formatter ────────────────────────────────────────────────

interface DeltaCounts {
  newObservations: number;
  highSeverityNew: number;
  situationsOpened: number;
  situationsResolved: number;
  situationsUpdated: number;
  feedsRecovered: number;
  feedsDegraded: number;
  riskChanges: number;
  escalations: number;
}

function countDeltas(deltas: readonly WorldDelta[]): DeltaCounts {
  const c: DeltaCounts = {
    newObservations: 0, highSeverityNew: 0,
    situationsOpened: 0, situationsResolved: 0, situationsUpdated: 0,
    feedsRecovered: 0, feedsDegraded: 0,
    riskChanges: 0, escalations: 0,
  };
  for (const d of deltas) {
    if (d.type === 'new-observation') {
      c.newObservations++;
      if (d.severity === 'high' || d.severity === 'critical') c.highSeverityNew++;
    } else if (d.type === 'situation-opened') c.situationsOpened++;
    else if (d.type === 'situation-resolved') c.situationsResolved++;
    else if (d.type === 'situation-updated') c.situationsUpdated++;
    else if (d.type === 'feed-recovered') c.feedsRecovered++;
    else if (d.type === 'feed-degraded') c.feedsDegraded++;
    else if (d.type === 'entity-risk-changed') c.riskChanges++;
    else if (d.type === 'severity-escalated') c.escalations++;
  }
  return c;
}

function formatSummary(c: DeltaCounts): string {
  const parts: string[] = [];
  if (c.highSeverityNew > 0) parts.push(`${c.highSeverityNew} new high-severity event${pluralS(c.highSeverityNew)}`);
  else if (c.newObservations > 0) parts.push(`${c.newObservations} new event${pluralS(c.newObservations)}`);
  if (c.escalations > 0) parts.push(`${c.escalations} severity escalation${pluralS(c.escalations)}`);
  if (c.situationsOpened > 0) parts.push(`${c.situationsOpened} situation${pluralS(c.situationsOpened)} opened`);
  if (c.situationsResolved > 0) parts.push(`${c.situationsResolved} situation${pluralS(c.situationsResolved)} resolved`);
  if (c.situationsUpdated > 0) parts.push(`${c.situationsUpdated} situation${pluralS(c.situationsUpdated)} updated`);
  if (c.riskChanges > 0) parts.push(`${c.riskChanges} entity risk shift${pluralS(c.riskChanges)}`);
  if (c.feedsRecovered > 0) parts.push(`${c.feedsRecovered} feed${pluralS(c.feedsRecovered)} recovered`);
  if (c.feedsDegraded > 0) parts.push(`${c.feedsDegraded} feed${pluralS(c.feedsDegraded)} degraded`);
  if (parts.length === 0) return 'No notable changes.';
  return parts.join(', ') + '.';
}

function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: WhatChangedV2 | undefined;

export function getWhatChangedV2(): WhatChangedV2 {
  singleton ??= new WhatChangedV2();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}
