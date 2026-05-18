/**
 * AlertEscalationService — auto-escalate unacknowledged alerts after a
 * configurable timeout. Critical alerts escalate faster than low-severity
 * ones. Tracks escalation history and prevents high-priority alerts from
 * being silently missed.
 *
 * Pure deterministic; no DOM, no fetch. Injectable Storage + clock keep
 * tests hermetic.
 */

// ── Public types ─────────────────────────────────────────────────────

export type EscalationStatus = 'pending' | 'escalated' | 'acknowledged' | 'expired';

export interface EscalationPolicy {
  domain: string;
  severityTimeouts: Record<string, number>;
}

export interface EscalationRecord {
  id: string;
  alertId: string;
  domain: string;
  severity: string;
  status: EscalationStatus;
  registeredAt: number;
  escalatedAt?: number;
  acknowledgedAt?: number;
  expiresAt: number;
  escalationLevel: number;
}

export interface EscalationSummary {
  pending: number;
  escalated: number;
  avgTimeToEscalateMs: number | null;
  byDomain: Record<string, number>;
}

export interface EscalationFilter {
  status?: EscalationStatus;
  domain?: string;
}

export type EscalationListener = (record: EscalationRecord) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AlertEscalationServiceOptions {
  storage?: StorageLike | null;
  now?: () => number;
  maxRecords?: number;
}

// ── Constants ────────────────────────────────────────────────────────

export const RECORDS_STORAGE_KEY = 'wm-escalation-records';
export const POLICIES_STORAGE_KEY = 'wm-escalation-policies';
export const MAX_RECORDS = 2000;
export const MAX_ESCALATION_LEVEL = 3;

export const DEFAULT_SEVERITY_TIMEOUTS: Record<string, number> = {
  critical: 5 * 60 * 1000,      // 5 min
  high: 15 * 60 * 1000,         // 15 min
  medium: 60 * 60 * 1000,       // 1 hr
  low: 4 * 60 * 60 * 1000,      // 4 hr
};

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedRecords { records: EscalationRecord[] }
interface PersistedPolicies { policies: EscalationPolicy[] }

export class AlertEscalationService {
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly maxRecords: number;
  private readonly records: EscalationRecord[] = [];
  private readonly policies = new Map<string, EscalationPolicy>();
  private readonly subscribers = new Set<EscalationListener>();
  private idCounter = 0;

  constructor(opts: AlertEscalationServiceOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.maxRecords = opts.maxRecords ?? MAX_RECORDS;
    this.hydrate();
  }

  register(alertId: string, domain: string, severity: string): EscalationRecord {
    const registeredAt = this.clock();
    const timeout = this.timeoutFor(domain, severity);
    this.idCounter++;
    const record: EscalationRecord = {
      id: `esc-${registeredAt}-${this.idCounter}`,
      alertId,
      domain,
      severity,
      status: 'pending',
      registeredAt,
      expiresAt: registeredAt + timeout,
      escalationLevel: 1,
    };
    this.records.push(record);
    while (this.records.length > this.maxRecords) this.records.shift();
    this.persistRecords();
    return cloneRecord(record);
  }

  tick(): number {
    const now = this.clock();
    let escalatedCount = 0;
    for (const rec of this.records) {
      if (rec.status !== 'pending' && rec.status !== 'escalated') continue;
      if (rec.expiresAt > now) continue;
      this.applyEscalation(rec, now);
      escalatedCount += 1;
      for (const cb of this.subscribers) cb(cloneRecord(rec));
    }
    if (escalatedCount > 0) this.persistRecords();
    return escalatedCount;
  }

  acknowledge(alertId: string): EscalationRecord | null {
    const now = this.clock();
    const rec = this.findActiveRecord(alertId);
    if (!rec) return null;
    rec.status = 'acknowledged';
    rec.acknowledgedAt = now;
    this.persistRecords();
    for (const cb of this.subscribers) cb(cloneRecord(rec));
    return cloneRecord(rec);
  }

  getPolicy(domain: string): EscalationPolicy {
    const existing = this.policies.get(domain);
    if (existing) return clonePolicy(existing);
    return { domain, severityTimeouts: { ...DEFAULT_SEVERITY_TIMEOUTS } };
  }

  setPolicy(domain: string, partial: Partial<EscalationPolicy>): EscalationPolicy {
    const current = this.policies.get(domain) ?? { domain, severityTimeouts: { ...DEFAULT_SEVERITY_TIMEOUTS } };
    const next: EscalationPolicy = {
      domain,
      severityTimeouts: partial.severityTimeouts
        ? { ...current.severityTimeouts, ...partial.severityTimeouts }
        : { ...current.severityTimeouts },
    };
    this.policies.set(domain, next);
    this.persistPolicies();
    return clonePolicy(next);
  }

  getRecords(filter?: EscalationFilter, limit?: number): EscalationRecord[] {
    const reversed: EscalationRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      const rec = this.records[i]!;
      if (filter && !matchesFilter(rec, filter)) continue;
      reversed.push(cloneRecord(rec));
      if (limit && reversed.length >= limit) break;
    }
    return reversed;
  }

  getSummary(): EscalationSummary {
    let pending = 0; let escalated = 0;
    let escalateTotal = 0; let escalateCount = 0;
    const byDomain: Record<string, number> = {};
    for (const rec of this.records) {
      byDomain[rec.domain] = (byDomain[rec.domain] ?? 0) + 1;
      if (rec.status === 'pending') pending += 1;
      if (rec.status === 'escalated') escalated += 1;
      if (rec.escalatedAt !== undefined) {
        escalateTotal += rec.escalatedAt - rec.registeredAt;
        escalateCount += 1;
      }
    }
    return {
      pending,
      escalated,
      avgTimeToEscalateMs: escalateCount === 0 ? null : Math.round(escalateTotal / escalateCount),
      byDomain,
    };
  }

  subscribe(cb: EscalationListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: EscalationListener): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.records.length = 0;
    this.policies.clear();
    this.persistRecords();
    this.persistPolicies();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private applyEscalation(rec: EscalationRecord, now: number): void {
    rec.escalatedAt ??= now;
    rec.escalationLevel += 1;
    if (rec.escalationLevel > MAX_ESCALATION_LEVEL) {
      rec.status = 'expired';
      return;
    }
    rec.status = 'escalated';
    const baseTimeout = this.timeoutFor(rec.domain, rec.severity);
    rec.expiresAt = now + baseTimeout * rec.escalationLevel;
  }

  private findActiveRecord(alertId: string): EscalationRecord | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const rec = this.records[i]!;
      if (rec.alertId !== alertId) continue;
      if (rec.status === 'pending' || rec.status === 'escalated') return rec;
    }
    return undefined;
  }

  private timeoutFor(domain: string, severity: string): number {
    const policy = this.policies.get(domain);
    const timeouts = policy?.severityTimeouts ?? DEFAULT_SEVERITY_TIMEOUTS;
    return timeouts[severity] ?? DEFAULT_SEVERITY_TIMEOUTS[severity] ?? DEFAULT_SEVERITY_TIMEOUTS.medium!;
  }

  private hydrate(): void {
    if (!this.storage) return;
    this.hydrateRecords();
    this.hydratePolicies();
  }

  private hydrateRecords(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(RECORDS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedRecords;
      if (parsed && Array.isArray(parsed.records)) {
        for (const r of parsed.records) this.records.push(r);
        while (this.records.length > this.maxRecords) this.records.shift();
      }
    } catch {
      this.records.length = 0;
    }
  }

  private hydratePolicies(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(POLICIES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedPolicies;
      if (parsed && Array.isArray(parsed.policies)) {
        for (const p of parsed.policies) this.policies.set(p.domain, p);
      }
    } catch {
      this.policies.clear();
    }
  }

  private persistRecords(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(RECORDS_STORAGE_KEY, JSON.stringify({ records: this.records } satisfies PersistedRecords));
    } catch {
      // non-fatal
    }
  }

  private persistPolicies(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(POLICIES_STORAGE_KEY, JSON.stringify({ policies: [...this.policies.values()] } satisfies PersistedPolicies));
    } catch {
      // non-fatal
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: AlertEscalationService | undefined;

export function getAlertEscalationService(): AlertEscalationService {
  singleton ??= new AlertEscalationService();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function matchesFilter(rec: EscalationRecord, filter: EscalationFilter): boolean {
  if (filter.status && rec.status !== filter.status) return false;
  if (filter.domain && rec.domain !== filter.domain) return false;
  return true;
}

function cloneRecord(r: EscalationRecord): EscalationRecord { return { ...r }; }
function clonePolicy(p: EscalationPolicy): EscalationPolicy {
  return { domain: p.domain, severityTimeouts: { ...p.severityTimeouts } };
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
