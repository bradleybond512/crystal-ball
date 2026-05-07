// Append-only notification ledger.
//
// Same shape pattern as src/services/ops/mission-ledger.ts: pure types +
// in-memory store with serialize / loadJson for persistence. The desktop
// app persists the JSON to ~/Library/Application Support/Crystal Ball
// via the existing ledger persistence helper; tests run with no-op
// persistence.

export type NotificationChannel = 'push' | 'imessage' | 'voice';

export type NotificationThreatType =
  | 'seismic_tier2'
  | 'seismic_tier3'
  | 'seismic_tier4'
  | 'seismic_tier5'
  | 'geomagnetic_g4'
  | 'cap_extreme'
  | 'wildfire_extreme'
  | 'hurricane_cat3';

export type NotificationThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationLedgerEntry {
  id: string;
  recordedAt: number;
  channel: NotificationChannel;
  threatType: NotificationThreatType;
  threatLevel: NotificationThreatLevel;
  title: string;
  body: string;
  /** Stable key used for dedupe within `dedupeWindowMs`. Optional —
   *  if absent, every append is a fresh entry. */
  dedupeKey?: string;
  /** Free-form payload tied to the alert, e.g. { magnitude, lat, lon }. */
  meta?: Record<string, unknown>;
}

export interface NotificationLedger {
  append: (
    entry: Omit<NotificationLedgerEntry, 'id' | 'recordedAt'>,
    opts?: { recordedAt?: number },
  ) => NotificationLedgerEntry;
  list: () => readonly NotificationLedgerEntry[];
  listSince: (cutoffMs: number) => readonly NotificationLedgerEntry[];
  serialize: () => string;
  loadJson: (json: string) => void;
}

interface LedgerOptions {
  /** Entries with the same dedupeKey within this window collapse to
   *  the first. Default 0 disables dedupe. */
  dedupeWindowMs?: number;
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `notif-${Date.now().toString(36)}-${_idCounter}`;
}

function isEntry(value: unknown): value is NotificationLedgerEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.recordedAt === 'number'
    && typeof v.channel === 'string'
    && typeof v.threatType === 'string'
    && typeof v.title === 'string'
    && typeof v.body === 'string';
}

export function createNotificationLedger(opts: LedgerOptions = {}): NotificationLedger {
  const dedupeWindowMs = opts.dedupeWindowMs ?? 0;
  let entries: NotificationLedgerEntry[] = [];

  function append(
    input: Omit<NotificationLedgerEntry, 'id' | 'recordedAt'>,
    callOpts?: { recordedAt?: number },
  ): NotificationLedgerEntry {
    const recordedAt = callOpts?.recordedAt ?? Date.now();
    if (input.dedupeKey && dedupeWindowMs > 0) {
      const cutoff = recordedAt - dedupeWindowMs;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const e = entries[i];
        if (!e || e.recordedAt < cutoff) break;
        if (e.dedupeKey === input.dedupeKey) return e;
      }
    }
    const entry: NotificationLedgerEntry = { ...input, id: nextId(), recordedAt };
    entries.push(entry);
    return entry;
  }

  return {
    append,
    list: () => [...entries],
    listSince: (cutoffMs: number) => entries.filter(e => e.recordedAt > cutoffMs),
    serialize: () => JSON.stringify({ version: 1, entries }),
    loadJson(json: string) {
      try {
        const parsed = JSON.parse(json) as { entries?: unknown };
        const arr = Array.isArray(parsed.entries) ? parsed.entries : [];
        entries = arr.filter(v => isEntry(v));
      } catch {
        entries = [];
      }
    },
  };
}
