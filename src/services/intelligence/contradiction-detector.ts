/**
 * Contradiction Detector — flags when different feeds or sources
 * report conflicting world states about the same entity or region.
 *
 * Groups observations by shared entityId, falling back to
 * (domain + coarse location grid). Within a group, runs 5 detectors:
 *
 *   - severity-mismatch:   severity delta ≥ 2 bands
 *   - status-conflict:     active vs resolved/closed/cleared tags
 *   - location-conflict:   same entity reported > 500 km apart
 *   - trend-reversal:      HIGH → LOW → HIGH within 2 h
 *   - source-disagreement: ≥ 3 sources span ≥ 2 severity bands
 *
 * Pure service with injectable Storage so unit tests run without a DOM.
 * Contradictions persist to localStorage with a 300-item ring buffer
 * and survive across sessions until resolved or dismissed.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public types ─────────────────────────────────────────────────────────

export type ConflictType =
  | 'severity-mismatch'
  | 'status-conflict'
  | 'location-conflict'
  | 'trend-reversal'
  | 'source-disagreement';

export type ContradictionStatus = 'open' | 'resolved' | 'dismissed';

export interface Contradiction {
  id: string;
  entityId: string;
  region: string;
  domain: string;
  conflictType: ConflictType;
  observationA: ObservationEvent;
  observationB: ObservationEvent;
  severityDelta: number;
  confidence: number;
  detectedAt: number;
  status: ContradictionStatus;
  resolvedAt?: number;
  dismissReason?: string;
}

export interface ContradictionStats {
  totalDetected: number;
  openCount: number;
  byType: Record<string, number>;
  avgResolutionMinutes: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ContradictionDetectorOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface ContradictionDetector {
  scan(observations: readonly ObservationEvent[]): Contradiction[];
  getOpen(): Contradiction[];
  getAll(): Contradiction[];
  resolve(id: string): void;
  dismiss(id: string, reason: string): void;
  stats(): ContradictionStats;
  subscribe(cb: (items: Contradiction[]) => void): void;
  unsubscribe(cb: (items: Contradiction[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-contradiction-detector';
export const MAX_CONTRADICTIONS = 300;

export const CONFIDENCE_BY_TYPE: Record<ConflictType, number> = {
  'severity-mismatch': 0.9,
  'status-conflict': 0.85,
  'source-disagreement': 0.8,
  'trend-reversal': 0.7,
  'location-conflict': 0.6,
};

const SEVERITY_RANK: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

const SEVERITY_MISMATCH_DELTA = 2;
const LOCATION_CONFLICT_KM = 500;
const TREND_REVERSAL_WINDOW_MS = 2 * 60 * 60_000;
const SOURCE_DISAGREEMENT_MIN_SOURCES = 3;
const GRID_DEG = 1; // ~110 km — coarse fallback grouping

const ACTIVE_TAGS = new Set(['active', 'ongoing', 'open', 'issued', 'warning', 'in-progress']);
const RESOLVED_TAGS = new Set(['resolved', 'closed', 'cleared', 'lifted', 'cancelled', 'canceled', 'all-clear']);

// ── Geometry / helpers ──────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function severityRank(s: ObservationSeverity): number {
  return SEVERITY_RANK[s];
}

function gridCell(obs: ObservationEvent): string {
  if (!obs.location) return 'noloc';
  const lat = Math.round(obs.location.lat / GRID_DEG) * GRID_DEG;
  const lon = Math.round(obs.location.lon / GRID_DEG) * GRID_DEG;
  return `${lat.toFixed(0)},${lon.toFixed(0)}`;
}

/** Group key: shared entityId is the primary grouping signal. When no
 *  entityId is present, fall back to `domain@grid`. */
function groupKey(obs: ObservationEvent): string {
  if ((obs.entityIds ?? []).length > 0) return `ent:${obs.entityIds[0]}`;
  return `dom:${obs.domain}@${gridCell(obs)}`;
}

function regionFor(group: readonly ObservationEvent[]): string {
  for (const o of group) {
    if ((o.entityIds ?? []).length > 0) return o.entityIds[0]!;
    if (o.location) return `${o.location.lat.toFixed(1)},${o.location.lon.toFixed(1)}`;
  }
  return 'global';
}

function entityIdFor(group: readonly ObservationEvent[]): string {
  for (const o of group) {
    if ((o.entityIds ?? []).length > 0) return o.entityIds[0]!;
  }
  return '';
}

function hasAny(tags: readonly string[], set: ReadonlySet<string>): boolean {
  for (const t of tags) if (set.has(t.toLowerCase())) return true;
  return false;
}

function sortedPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function contradictionId(type: ConflictType, a: ObservationEvent, b: ObservationEvent): string {
  return `${type}-${sortedPair(a.id, b.id)}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneContradiction(c: Contradiction): Contradiction {
  return { ...c };
}

// ── Detectors ────────────────────────────────────────────────────────────

interface DetectorContext {
  group: ObservationEvent[];
  entityId: string;
  region: string;
  domain: string;
  now: number;
}

function detectSeverityMismatch(ctx: DetectorContext): Contradiction[] {
  const out: Contradiction[] = [];
  const group = ctx.group;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!;
      const b = group[j]!;
      const delta = Math.abs(severityRank(a.severity) - severityRank(b.severity));
      if (delta < SEVERITY_MISMATCH_DELTA) continue;
      out.push(buildContradiction('severity-mismatch', a, b, delta, ctx));
    }
  }
  return out;
}

function detectStatusConflict(ctx: DetectorContext): Contradiction[] {
  const out: Contradiction[] = [];
  const group = ctx.group;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!;
      const b = group[j]!;
      const aActive = hasAny(a.tags, ACTIVE_TAGS);
      const aResolved = hasAny(a.tags, RESOLVED_TAGS);
      const bActive = hasAny(b.tags, ACTIVE_TAGS);
      const bResolved = hasAny(b.tags, RESOLVED_TAGS);
      if ((aActive && bResolved) || (aResolved && bActive)) {
        const delta = Math.abs(severityRank(a.severity) - severityRank(b.severity));
        out.push(buildContradiction('status-conflict', a, b, delta, ctx));
      }
    }
  }
  return out;
}

function detectLocationConflict(ctx: DetectorContext): Contradiction[] {
  if (ctx.entityId === '') return [];
  const out: Contradiction[] = [];
  const group = ctx.group.filter((o) => o.location);
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!;
      const b = group[j]!;
      const dist = haversineKm(
        a.location!.lat, a.location!.lon,
        b.location!.lat, b.location!.lon,
      );
      if (dist <= LOCATION_CONFLICT_KM) continue;
      out.push(buildContradiction('location-conflict', a, b,
        Math.abs(severityRank(a.severity) - severityRank(b.severity)), ctx));
    }
  }
  return out;
}

function detectTrendReversal(ctx: DetectorContext): Contradiction[] {
  if (ctx.group.length < 3) return [];
  const sorted = [...ctx.group].sort((a, b) => a.timestamp - b.timestamp);
  const out: Contradiction[] = [];
  // Slide a 3-element window; flag HIGH → LOW → HIGH (or CRITICAL surrogate)
  // within TREND_REVERSAL_WINDOW_MS spanning the outer pair.
  for (let i = 0; i + 2 < sorted.length; i++) {
    const [a, b, c] = [sorted[i]!, sorted[i + 1]!, sorted[i + 2]!];
    const span = c.timestamp - a.timestamp;
    if (span > TREND_REVERSAL_WINDOW_MS) continue;
    const ra = severityRank(a.severity);
    const rb = severityRank(b.severity);
    const rc = severityRank(c.severity);
    // Reversal: outer two are high (≥3) and middle dips by ≥2.
    if (ra >= SEVERITY_RANK.HIGH && rc >= SEVERITY_RANK.HIGH && ra - rb >= 2 && rc - rb >= 2) {
      out.push(buildContradiction('trend-reversal', a, c, Math.abs(ra - rb), ctx));
    }
  }
  return out;
}

function detectSourceDisagreement(ctx: DetectorContext): Contradiction[] {
  const sources = new Map<string, ObservationEvent>();
  for (const o of ctx.group) {
    if (!sources.has(o.sourceId)) sources.set(o.sourceId, o);
  }
  if (sources.size < SOURCE_DISAGREEMENT_MIN_SOURCES) return [];
  const all = [...sources.values()];
  let highest = all[0]!;
  let lowest = all[0]!;
  for (const o of all) {
    if (severityRank(o.severity) > severityRank(highest.severity)) highest = o;
    if (severityRank(o.severity) < severityRank(lowest.severity)) lowest = o;
  }
  const delta = severityRank(highest.severity) - severityRank(lowest.severity);
  if (delta < SEVERITY_MISMATCH_DELTA) return [];
  return [buildContradiction('source-disagreement', highest, lowest, delta, ctx)];
}

function buildContradiction(
  type: ConflictType,
  a: ObservationEvent,
  b: ObservationEvent,
  severityDelta: number,
  ctx: DetectorContext,
): Contradiction {
  return {
    id: contradictionId(type, a, b),
    entityId: ctx.entityId,
    region: ctx.region,
    domain: ctx.domain,
    conflictType: type,
    observationA: a,
    observationB: b,
    severityDelta,
    confidence: CONFIDENCE_BY_TYPE[type],
    detectedAt: ctx.now,
    status: 'open',
  };
}

// ── Persistence ─────────────────────────────────────────────────────────

interface Persisted extends Omit<Contradiction, 'observationA' | 'observationB'> {
  observationA: ObservationEvent;
  observationB: ObservationEvent;
}

function rehydrate(storage: StorageLike | null): Contradiction[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: Contradiction[] = [];
  for (const p of parsed) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Persisted;
    if (typeof r.id !== 'string') continue;
    out.push({ ...r });
  }
  return out;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createContradictionDetector(
  options: ContradictionDetectorOptions = {},
): ContradictionDetector {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const items: Contradiction[] = rehydrate(storage);
  const listeners = new Set<(items: Contradiction[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = items.map((c) => cloneContradiction(c));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function addUnique(found: Contradiction[]): Contradiction[] {
    const existing = new Set(items.map((c) => c.id));
    const added: Contradiction[] = [];
    for (const c of found) {
      if (existing.has(c.id)) continue;
      items.push(c);
      added.push(c);
      existing.add(c.id);
    }
    if (items.length > MAX_CONTRADICTIONS) {
      items.splice(0, items.length - MAX_CONTRADICTIONS);
    }
    return added;
  }

  return {
    scan(observations): Contradiction[] {
      if (observations.length < 2) return [];
      const groups = new Map<string, ObservationEvent[]>();
      for (const o of observations) {
        const key = groupKey(o);
        const arr = groups.get(key);
        if (arr) arr.push(o);
        else groups.set(key, [o]);
      }
      const allFound: Contradiction[] = [];
      const now = clock();
      for (const [, group] of groups) {
        if (group.length < 2) continue;
        const ctx: DetectorContext = {
          group, now,
          entityId: entityIdFor(group),
          region: regionFor(group),
          domain: group[0]!.domain,
        };
        allFound.push(
          ...detectSeverityMismatch(ctx),
          ...detectStatusConflict(ctx),
          ...detectLocationConflict(ctx),
          ...detectTrendReversal(ctx),
          ...detectSourceDisagreement(ctx),
        );
      }
      const added = addUnique(allFound);
      if (added.length > 0) {
        persist();
        notify();
      }
      return added.map((c) => cloneContradiction(c));
    },

    getOpen(): Contradiction[] {
      return items.filter((c) => c.status === 'open').map((c) => cloneContradiction(c));
    },

    getAll(): Contradiction[] {
      return items.map((c) => cloneContradiction(c));
    },

    resolve(id): void {
      const item = items.find((c) => c.id === id);
      if (item?.status !== 'open') return;
      item.status = 'resolved';
      item.resolvedAt = clock();
      persist();
      notify();
    },

    dismiss(id, reason): void {
      const item = items.find((c) => c.id === id);
      if (item?.status !== 'open') return;
      item.status = 'dismissed';
      item.resolvedAt = clock();
      item.dismissReason = reason;
      persist();
      notify();
    },

    stats(): ContradictionStats {
      const byType: Record<string, number> = {};
      let open = 0;
      let resolutionSumMin = 0;
      let resolvedCount = 0;
      for (const c of items) {
        byType[c.conflictType] = (byType[c.conflictType] ?? 0) + 1;
        if (c.status === 'open') open += 1;
        if (c.status !== 'open' && typeof c.resolvedAt === 'number') {
          resolutionSumMin += (c.resolvedAt - c.detectedAt) / 60_000;
          resolvedCount += 1;
        }
      }
      return {
        totalDetected: items.length,
        openCount: open,
        byType,
        avgResolutionMinutes: resolvedCount === 0 ? 0 : resolutionSumMin / resolvedCount,
      };
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: ContradictionDetector | null = null;

export function getContradictionDetector(): ContradictionDetector {
  _singleton ??= createContradictionDetector();
  return _singleton;
}

export function _resetContradictionDetectorSingletonForTests(): void {
  _singleton = null;
}
