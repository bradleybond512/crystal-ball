/**
 * AlertDeduplicationService — suppress near-duplicate alerts within a
 * configurable time and geographic window.
 *
 * For each domain, "duplicate" means: same domain (always), within
 * `windowMs` time of a prior alert, optional severity match, optional
 * distance check (skipped when `maxDistanceKm` is null OR the alert
 * has no lat/lon).
 *
 * When a duplicate is detected, the result's `primaryAlertId` points
 * to the *root* primary — duplicate-of-duplicate is flattened to the
 * original survivor. Every check is recorded for diagnostics.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import { haversineKm } from '../proximity-filter';

// ── Public types ─────────────────────────────────────────────────────

export interface DeduplicationConfig {
  domain: string;
  windowMs: number;
  /** null disables the distance check for this domain. */
  maxDistanceKm: number | null;
  matchSeverity: boolean;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  primaryAlertId: string | null;
  reason: string | null;
}

export interface DeduplicationRecord {
  id: string;
  alertId: string;
  domain: string;
  severity: string;
  lat?: number;
  lon?: number;
  timestamp: number;
  primaryAlertId: string | null;
  isDuplicate: boolean;
  recordedAt: number;
}

export interface DeduplicationStats {
  total: number;
  duplicates: number;
  suppressionRate: number;
  byDomain: Record<string, { total: number; duplicates: number }>;
}

export type DeduplicationListener = (record: DeduplicationRecord) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AlertInput {
  id: string;
  domain: string;
  severity: string;
  lat?: number;
  lon?: number;
  timestamp: number;
}

export interface AlertDeduplicationServiceOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 5000;
export const CONFIGS_STORAGE_KEY = 'wm-dedup-configs';
export const RECORDS_STORAGE_KEY = 'wm-dedup-records';

const GLOBAL_DEFAULT_CONFIG: Omit<DeduplicationConfig, 'domain'> = {
  windowMs: 60 * 60_000,
  maxDistanceKm: 250,
  matchSeverity: true,
};

const DOMAIN_DEFAULT_OVERRIDES: Record<string, Omit<DeduplicationConfig, 'domain'>> = {
  cyber: {
    windowMs: 30 * 60_000,
    maxDistanceKm: null,
    matchSeverity: false,
  },
};

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedConfigs {
  configs: DeduplicationConfig[];
}

interface PersistedRecords {
  records: DeduplicationRecord[];
}

export class AlertDeduplicationService {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly configs = new Map<string, DeduplicationConfig>();
  private readonly records: DeduplicationRecord[] = [];
  private readonly subscribers = new Set<DeduplicationListener>();
  private idCounter = 0;

  constructor(opts: AlertDeduplicationServiceOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  check(alert: AlertInput): DeduplicationResult {
    const config = this.getConfig(alert.domain);
    const now = this.clock();
    const primary = this.findPrimaryFor(alert, config, now);
    this.idCounter++;
    const record: DeduplicationRecord = {
      id: `dd-${now}-${this.idCounter}`,
      alertId: alert.id,
      domain: alert.domain,
      severity: alert.severity,
      lat: alert.lat,
      lon: alert.lon,
      timestamp: alert.timestamp,
      primaryAlertId: primary?.alertId ?? null,
      isDuplicate: primary !== undefined,
      recordedAt: now,
    };
    this.records.push(record);
    while (this.records.length > this.capacity) this.records.shift();
    this.persistRecords();
    for (const cb of this.subscribers) cb(record);
    return {
      isDuplicate: record.isDuplicate,
      primaryAlertId: record.primaryAlertId,
      reason: record.isDuplicate
        ? describeMatchReason(alert, primary!, config)
        : null,
    };
  }

  getConfig(domain: string): DeduplicationConfig {
    const stored = this.configs.get(domain);
    if (stored) return stored;
    const override = DOMAIN_DEFAULT_OVERRIDES[domain] ?? GLOBAL_DEFAULT_CONFIG;
    return { domain, ...override };
  }

  setConfig(domain: string, partial: Partial<DeduplicationConfig>): void {
    const current = this.getConfig(domain);
    const next: DeduplicationConfig = {
      ...current,
      ...partial,
      domain,
    };
    this.configs.set(domain, next);
    this.persistConfigs();
  }

  getRecords(filter: { domain?: string; isDuplicate?: boolean } = {}, limit?: number): DeduplicationRecord[] {
    const out: DeduplicationRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (filter.domain !== undefined && r.domain !== filter.domain) continue;
      if (filter.isDuplicate !== undefined && r.isDuplicate !== filter.isDuplicate) continue;
      out.push(r);
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  getStats(): DeduplicationStats {
    const byDomain: Record<string, { total: number; duplicates: number }> = {};
    let total = 0;
    let duplicates = 0;
    for (const r of this.records) {
      total++;
      if (r.isDuplicate) duplicates++;
      const cell = byDomain[r.domain] ?? { total: 0, duplicates: 0 };
      cell.total++;
      if (r.isDuplicate) cell.duplicates++;
      byDomain[r.domain] = cell;
    }
    return {
      total,
      duplicates,
      suppressionRate: total === 0 ? 0 : Number((duplicates / total).toFixed(4)),
      byDomain,
    };
  }

  subscribe(cb: DeduplicationListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: DeduplicationListener): void {
    this.subscribers.delete(cb);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private findPrimaryFor(alert: AlertInput, config: DeduplicationConfig, now: number): DeduplicationRecord | undefined {
    // Walk records newest-first. The first matching record is the
    // immediate primary; flatten to its root by following
    // primaryAlertId chains in the record set.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const candidate = this.records[i]!;
      if (!matchesCandidate(alert, candidate, config, now)) continue;
      return this.flattenToRoot(candidate);
    }
    return undefined;
  }

  private flattenToRoot(record: DeduplicationRecord): DeduplicationRecord {
    if (!record.isDuplicate || record.primaryAlertId === null) return record;
    // Walk the primaryAlertId chain. Bound iterations by record count
    // so a corrupted chain can't loop forever.
    let current = record;
    let safetyBudget = this.records.length;
    while (safetyBudget > 0) {
      if (!current.isDuplicate || current.primaryAlertId === null) return current;
      const parent = this.records.find((r) => r.alertId === current.primaryAlertId);
      if (!parent || parent === current) return current;
      current = parent;
      safetyBudget--;
    }
    return current;
  }

  private hydrate(): void {
    if (!this.storage) return;
    this.hydrateConfigs();
    this.hydrateRecords();
  }

  private hydrateConfigs(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CONFIGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedConfigs;
      if (!parsed || !Array.isArray(parsed.configs)) return;
      for (const c of parsed.configs) this.configs.set(c.domain, c);
    } catch {
      this.configs.clear();
    }
  }

  private hydrateRecords(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(RECORDS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedRecords;
      if (!parsed || !Array.isArray(parsed.records)) return;
      for (const r of parsed.records) this.records.push(r);
      while (this.records.length > this.capacity) this.records.shift();
    } catch {
      this.records.length = 0;
    }
  }

  private persistConfigs(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedConfigs = { configs: [...this.configs.values()] };
      this.storage.setItem(CONFIGS_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }

  private persistRecords(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedRecords = { records: this.records };
      this.storage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: AlertDeduplicationService | undefined;

export function getAlertDeduplicationService(): AlertDeduplicationService {
  singleton ??= new AlertDeduplicationService();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function matchesCandidate(
  alert: AlertInput,
  candidate: DeduplicationRecord,
  config: DeduplicationConfig,
  now: number,
): boolean {
  if (candidate.domain !== alert.domain) return false;
  if (now - candidate.timestamp >= config.windowMs) return false;
  if (config.matchSeverity && candidate.severity !== alert.severity) return false;
  if (config.maxDistanceKm !== null) {
    if (alert.lat === undefined || alert.lon === undefined) return false;
    if (candidate.lat === undefined || candidate.lon === undefined) return false;
    const distance = haversineKm(alert.lat, alert.lon, candidate.lat, candidate.lon);
    if (distance > config.maxDistanceKm) return false;
  }
  return true;
}

function describeMatchReason(
  alert: AlertInput,
  primary: DeduplicationRecord,
  config: DeduplicationConfig,
): string {
  const parts: string[] = [`same domain (${alert.domain})`];
  if (config.matchSeverity) parts.push(`same severity (${alert.severity})`);
  if (config.maxDistanceKm !== null && alert.lat !== undefined && alert.lon !== undefined && primary.lat !== undefined && primary.lon !== undefined) {
    const distance = haversineKm(alert.lat, alert.lon, primary.lat, primary.lon);
    parts.push(`within ${config.maxDistanceKm}km (actual ${distance.toFixed(1)}km)`);
  }
  const ageMs = Math.max(0, alert.timestamp - primary.timestamp);
  parts.push(`within ${(config.windowMs / 60_000).toFixed(0)}min window (actual ${(ageMs / 60_000).toFixed(1)}min)`);
  return parts.join(', ');
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
