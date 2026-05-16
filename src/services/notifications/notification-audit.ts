/**
 * Notification audit — provenance-tracked history of every notification
 * that was either sent or suppressed.
 *
 * Distinct from the older notification-history-service.ts (IDB-backed,
 * fired/suppressed/escalated taxonomy). This module persists to
 * localStorage and stores full provenance: producer, alertId,
 * situationId, ruleId, channels, and a structured suppression reason.
 *
 * Pure store + injectable Storage so unit tests can run without a DOM.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type SuppressionReason =
  | 'quiet-hours' | 'rate-limit' | 'threshold' | 'user-muted';

export interface NotificationRecord {
  id: string;
  domain: string;
  severity: Severity;
  title: string;
  body: string;
  channels: string[];
  sentAt: Date;
  suppressedBy?: SuppressionReason;
  wasSuppressed: boolean;
  alertId?: string;
  situationId?: string;
  producerName: string;
  ruleId?: string;
  readAt?: Date;
}

export interface NotificationStats {
  total: number;
  sent: number;
  suppressed: number;
  byDomain: Record<string, number>;
  bySuppressReason: Record<string, number>;
  byChannel: Record<string, number>;
}

export const STORAGE_KEY = 'wm-notification-audit';
export const RING_BUFFER_LIMIT = 1000;
const DEFAULT_RECENT_WINDOW_MS = 24 * 60 * 60_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface NotificationAuditService {
  record(input: Omit<NotificationRecord, 'id'>): NotificationRecord;
  recordSuppressed(
    input: Omit<NotificationRecord, 'id'>,
    reason: SuppressionReason,
  ): NotificationRecord;
  getAll(): NotificationRecord[];
  getRecent(sinceMs?: number, now?: number): NotificationRecord[];
  getByDomain(domain: string): NotificationRecord[];
  getSuppressed(): NotificationRecord[];
  markRead(id: string): void;
  markAllRead(): void;
  unreadCount(): number;
  stats(sinceMs?: number, now?: number): NotificationStats;
  clear(): void;
  subscribe(cb: (records: NotificationRecord[]) => void): () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  // Date-based prefix keeps ids loosely sortable; counter guarantees uniqueness
  // even when two records land in the same millisecond.
  return `n-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

function tryResolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneRecord(r: NotificationRecord): NotificationRecord {
  return {
    ...r,
    channels: [...r.channels],
    sentAt: new Date(r.sentAt),
    readAt: r.readAt ? new Date(r.readAt) : undefined,
  };
}

function serialize(records: NotificationRecord[]): string {
  return JSON.stringify(records.map((r) => ({
    ...r,
    sentAt: r.sentAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : undefined,
  })));
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function deserializeOne(raw: unknown): NotificationRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const sentAt = parseDate(r.sentAt);
  if (!sentAt) return null;
  const readAt = parseDate(r.readAt) ?? undefined;
  const severity: Severity = (r.severity === 'low' || r.severity === 'medium'
    || r.severity === 'high' || r.severity === 'critical')
    ? r.severity : 'medium';
  return {
    id: r.id,
    domain: typeof r.domain === 'string' ? r.domain : 'unknown',
    severity,
    title: typeof r.title === 'string' ? r.title : '',
    body: typeof r.body === 'string' ? r.body : '',
    channels: Array.isArray(r.channels) ? r.channels.map(String) : [],
    sentAt,
    suppressedBy: typeof r.suppressedBy === 'string'
      ? (r.suppressedBy as SuppressionReason) : undefined,
    wasSuppressed: !!r.wasSuppressed,
    alertId: typeof r.alertId === 'string' ? r.alertId : undefined,
    situationId: typeof r.situationId === 'string' ? r.situationId : undefined,
    producerName: typeof r.producerName === 'string' ? r.producerName : 'unknown',
    ruleId: typeof r.ruleId === 'string' ? r.ruleId : undefined,
    readAt,
  };
}

function deserialize(raw: string): NotificationRecord[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => deserializeOne(p))
      .filter((r): r is NotificationRecord => r !== null);
  } catch {
    return [];
  }
}

function recordWindowed(records: readonly NotificationRecord[], sinceMs: number, nowMs: number): NotificationRecord[] {
  const floor = nowMs - sinceMs;
  return records.filter((r) => r.sentAt.getTime() >= floor);
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createNotificationAuditService(
  storage?: StorageLike,
): NotificationAuditService {
  const resolvedStorage = tryResolveStorage(storage);
  let records: NotificationRecord[] = [];
  const listeners = new Set<(snapshot: NotificationRecord[]) => void>();

  if (resolvedStorage) {
    const raw = resolvedStorage.getItem(STORAGE_KEY);
    if (raw) records = deserialize(raw);
  }

  function persistAndNotify(): void {
    if (resolvedStorage) {
      try { resolvedStorage.setItem(STORAGE_KEY, serialize(records)); }
      catch { /* quota / private-mode — in-memory remains source of truth */ }
    }
    const snapshot = records.map((r) => cloneRecord(r));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* defensive */ }
    }
  }

  function insert(input: Omit<NotificationRecord, 'id'>): NotificationRecord {
    const rec: NotificationRecord = {
      ...input,
      id: nextId(),
      channels: [...input.channels],
      sentAt: new Date(input.sentAt),
      readAt: input.readAt ? new Date(input.readAt) : undefined,
    };
    records.push(rec);
    if (records.length > RING_BUFFER_LIMIT) {
      records.splice(0, records.length - RING_BUFFER_LIMIT);
    }
    persistAndNotify();
    return cloneRecord(rec);
  }

  return {
    record(input): NotificationRecord {
      return insert({ ...input, wasSuppressed: !!input.wasSuppressed });
    },

    recordSuppressed(input, reason): NotificationRecord {
      return insert({ ...input, wasSuppressed: true, suppressedBy: reason });
    },

    getAll(): NotificationRecord[] {
      return records.map((r) => cloneRecord(r));
    },

    getRecent(sinceMs, now): NotificationRecord[] {
      const window = sinceMs ?? DEFAULT_RECENT_WINDOW_MS;
      const nowMs = now ?? Date.now();
      const windowed = [...recordWindowed(records, window, nowMs)];
      windowed.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
      return windowed.map((r) => cloneRecord(r));
    },

    getByDomain(domain): NotificationRecord[] {
      return records.filter((r) => r.domain === domain).map((r) => cloneRecord(r));
    },

    getSuppressed(): NotificationRecord[] {
      return records.filter((r) => r.wasSuppressed).map((r) => cloneRecord(r));
    },

    markRead(id): void {
      const found = records.find((r) => r.id === id);
      if (!found || found.readAt) return;
      found.readAt = new Date();
      persistAndNotify();
    },

    markAllRead(): void {
      const now = new Date();
      let changed = false;
      for (const r of records) {
        if (!r.readAt) { r.readAt = now; changed = true; }
      }
      if (changed) persistAndNotify();
    },

    unreadCount(): number {
      let n = 0;
      for (const r of records) if (!r.readAt) n += 1;
      return n;
    },

    stats(sinceMs, now): NotificationStats {
      const nowMs = now ?? Date.now();
      const windowed = sinceMs === undefined
        ? records
        : recordWindowed(records, sinceMs, nowMs);
      const byDomain: Record<string, number> = {};
      const bySuppressReason: Record<string, number> = {};
      const byChannel: Record<string, number> = {};
      let sent = 0;
      let suppressed = 0;
      for (const r of windowed) {
        byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
        if (r.wasSuppressed) {
          suppressed += 1;
          const key = r.suppressedBy ?? 'unknown';
          bySuppressReason[key] = (bySuppressReason[key] ?? 0) + 1;
        } else {
          sent += 1;
          for (const ch of r.channels) byChannel[ch] = (byChannel[ch] ?? 0) + 1;
        }
      }
      return { total: windowed.length, sent, suppressed, byDomain, bySuppressReason, byChannel };
    },

    clear(): void {
      records = [];
      persistAndNotify();
    },

    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

// ── Lazy singleton ────────────────────────────────────────────────────────

let _singleton: NotificationAuditService | null = null;

export function getNotificationAuditService(): NotificationAuditService {
  _singleton ??= createNotificationAuditService();
  return _singleton;
}

export function _resetNotificationAuditSingletonForTests(): void {
  _singleton = null;
}
