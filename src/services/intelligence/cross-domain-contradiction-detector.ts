/**
 * Cross-Domain Contradiction Detector — flags when two different
 * domains report conflicting severity for the same region inside a
 * 2-hour window. Distinct from the per-entity contradiction detector
 * in `contradiction-detector.ts` (which groups by entityId and runs
 * five intra-domain conflict types). This one cares about
 * cross-domain disagreement at the regional scale: e.g. weather says
 * CRITICAL for east-asia while geopolitical says LOW.
 *
 * Pure store: injectable Storage + clock. Records persist in a
 * 300-record ring buffer under `wm-cross-domain-contradiction-detector`.
 * Re-running `checkForContradictions` over the same observations is a
 * no-op (de-duplicated by canonical key derived from region + domain
 * pair + observation ids).
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public types ─────────────────────────────────────────────────────────

export type ContradictionSeverity = 'low' | 'medium' | 'high';

export interface ContradictionRecord {
  id: string;
  detectedAt: number;
  domainA: string;
  domainB: string;
  description: string;
  severity: ContradictionSeverity;
  region?: string;
  observationAId: string;
  observationBId: string;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface ContradictionStats {
  total: number;
  active: number;
  byDomain: Record<string, number>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CrossDomainContradictionDetectorOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-cross-domain-contradiction-detector';
export const MAX_RECORDS = 300;
export const WINDOW_MS = 2 * 60 * 60 * 1000;

const SEVERITY_RANK: Record<ObservationSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `xdc-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

/**
 * Returns the first `region:<value>` tag, or undefined if none.
 * Observations without a region tag are skipped entirely — we can't
 * group cross-domain claims without a regional anchor.
 */
function regionFor(obs: ObservationEvent): string | undefined {
  for (const tag of obs.tags) {
    if (tag.startsWith('region:')) return tag.slice('region:'.length);
  }
  return undefined;
}

function classifySeverity(
  rankA: number,
  rankB: number,
): ContradictionSeverity | null {
  if (rankA === rankB) return null;
  const high = Math.max(rankA, rankB);
  const low = Math.min(rankA, rankB);
  if (high >= 3 && low <= 1) return 'high'; // HIGH+ vs LOW-
  if (high >= 2 && low <= 1) return 'medium'; // MEDIUM vs LOW/INFO
  return null;
}

function canonicalKey(
  region: string,
  domainA: string,
  domainB: string,
  obsAId: string,
  obsBId: string,
): string {
  const [da, db] = domainA < domainB ? [domainA, domainB] : [domainB, domainA];
  const [oa, ob] = obsAId < obsBId ? [obsAId, obsBId] : [obsBId, obsAId];
  return `${region}|${da}|${db}|${oa}|${ob}`;
}

function deserialize(raw: unknown): ContradictionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.domainA !== 'string' || typeof r.domainB !== 'string') return null;
  if (typeof r.detectedAt !== 'number') return null;
  const severity: ContradictionSeverity =
    r.severity === 'low' || r.severity === 'medium' || r.severity === 'high'
      ? r.severity : 'low';
  return {
    id: r.id,
    detectedAt: r.detectedAt,
    domainA: r.domainA,
    domainB: r.domainB,
    description: typeof r.description === 'string' ? r.description : '',
    severity,
    region: typeof r.region === 'string' ? r.region : undefined,
    observationAId: typeof r.observationAId === 'string' ? r.observationAId : '',
    observationBId: typeof r.observationBId === 'string' ? r.observationBId : '',
    resolvedAt: typeof r.resolvedAt === 'number' ? r.resolvedAt : undefined,
    resolvedBy: typeof r.resolvedBy === 'string' ? r.resolvedBy : undefined,
  };
}

function rehydrate(storage: StorageLike | null): ContradictionRecord[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ContradictionRecord[] = [];
  for (const p of parsed) {
    const d = deserialize(p);
    if (d) out.push(d);
  }
  return out;
}

// ── Class ────────────────────────────────────────────────────────────────

export class CrossDomainContradictionDetector {
  private static _instance: CrossDomainContradictionDetector | null = null;

  static getInstance(): CrossDomainContradictionDetector {
    CrossDomainContradictionDetector._instance ??= new CrossDomainContradictionDetector();
    return CrossDomainContradictionDetector._instance;
  }

  static _resetSingletonForTests(): void {
    CrossDomainContradictionDetector._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly records: ContradictionRecord[];
  private readonly keys: Set<string>;

  constructor(options: CrossDomainContradictionDetectorOptions = {}) {
    this.storage = resolveLocalStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.records = rehydrate(this.storage);
    this.keys = new Set<string>();
    for (const r of this.records) {
      this.keys.add(canonicalKey(r.region ?? '', r.domainA, r.domainB, r.observationAId, r.observationBId));
    }
  }

  checkForContradictions(observations: readonly ObservationEvent[]): ContradictionRecord[] {
    if (observations.length < 2) return [];
    const buckets = this.groupByRegion(observations);
    const created: ContradictionRecord[] = [];
    const nowMs = this.clock();
    for (const [region, items] of buckets) {
      this.checkRegionPairs(region, items, nowMs, created);
    }
    if (created.length > 0) {
      this.capRingBuffer();
      this.persist();
    }
    return created;
  }

  private checkRegionPairs(
    region: string,
    items: ObservationEvent[],
    nowMs: number,
    out: ContradictionRecord[],
  ): void {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        this.checkPair(items[i], items[j], region, nowMs, out);
      }
    }
  }

  private checkPair(
    obsA: ObservationEvent | undefined,
    obsB: ObservationEvent | undefined,
    region: string,
    nowMs: number,
    out: ContradictionRecord[],
  ): void {
    if (!obsA || !obsB) return;
    if (obsA.domain === obsB.domain) return;
    if (Math.abs(obsA.timestamp - obsB.timestamp) > WINDOW_MS) return;
    const severity = classifySeverity(SEVERITY_RANK[obsA.severity], SEVERITY_RANK[obsB.severity]);
    if (!severity) return;
    const record = this.buildRecord(obsA, obsB, region, severity, nowMs);
    if (!record) return;
    this.records.push(record);
    this.keys.add(canonicalKey(record.region ?? '', record.domainA, record.domainB, record.observationAId, record.observationBId));
    out.push(record);
  }

  getActive(): ContradictionRecord[] {
    return [...this.records]
      .filter((r) => r.resolvedAt === undefined)
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .map((r) => ({ ...r }));
  }

  getAll(): ContradictionRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  resolve(id: string, resolvedBy: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;
    if (record.resolvedAt !== undefined) return;
    record.resolvedAt = this.clock();
    record.resolvedBy = resolvedBy;
    this.persist();
  }

  getStats(): ContradictionStats {
    const byDomain: Record<string, number> = {};
    let active = 0;
    for (const r of this.records) {
      byDomain[r.domainA] = (byDomain[r.domainA] ?? 0) + 1;
      byDomain[r.domainB] = (byDomain[r.domainB] ?? 0) + 1;
      if (r.resolvedAt === undefined) active += 1;
    }
    return { total: this.records.length, active, byDomain };
  }

  private groupByRegion(observations: readonly ObservationEvent[]): Map<string, ObservationEvent[]> {
    const buckets = new Map<string, ObservationEvent[]>();
    for (const obs of observations) {
      const region = regionFor(obs);
      if (region === undefined) continue;
      let list = buckets.get(region);
      if (!list) {
        list = [];
        buckets.set(region, list);
      }
      list.push(obs);
    }
    return buckets;
  }

  private buildRecord(
    obsA: ObservationEvent,
    obsB: ObservationEvent,
    region: string,
    severity: ContradictionSeverity,
    nowMs: number,
  ): ContradictionRecord | null {
    const [domainA, domainB, idA, idB, sevA, sevB] = obsA.domain < obsB.domain
      ? [obsA.domain, obsB.domain, obsA.id, obsB.id, obsA.severity, obsB.severity]
      : [obsB.domain, obsA.domain, obsB.id, obsA.id, obsB.severity, obsA.severity];
    const key = canonicalKey(region, domainA, domainB, idA, idB);
    if (this.keys.has(key)) return null;
    return {
      id: nextId(nowMs),
      detectedAt: nowMs,
      domainA,
      domainB,
      description: `Conflicting severities in region "${region}": ${domainA}=${sevA} vs ${domainB}=${sevB}.`,
      severity,
      region,
      observationAId: idA,
      observationBId: idB,
    };
  }

  private capRingBuffer(): void {
    if (this.records.length <= MAX_RECORDS) return;
    const drop = this.records.length - MAX_RECORDS;
    const removed = this.records.splice(0, drop);
    for (const r of removed) {
      this.keys.delete(canonicalKey(r.region ?? '', r.domainA, r.domainB, r.observationAId, r.observationBId));
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch { /* quota / private-mode — non-critical */ }
  }
}
