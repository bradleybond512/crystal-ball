/**
 * Notification history — append-only ring of the last 200 notifications
 * the producer pipeline made a decision about (fired / suppressed /
 * escalated). Pure helpers ship a deterministic in-memory ring; the
 * persistence wrapper writes to IndexedDB under
 * `wm-notification-history` so the panel survives reloads.
 *
 * No DOM, no globals. The wiring helper (`recordToHistory`) is the only
 * side-effecting export — push-notifier calls it per decision.
 */

/* eslint-disable sonarjs/cognitive-complexity -- the filter helper merges
   four independent predicates in one pass; splitting hurts readability */

export type HistoryDomain =
  | 'seismic'
  | 'geomagnetic'
  | 'solar_flare'
  | 'cap'
  | 'hurricane'
  | 'wildfire'
  | 'air_quality'
  | 'market'
  | 'cyber'
  | 'unknown';

export type HistoryAction = 'fired' | 'suppressed' | 'escalated';

export type HistorySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationHistoryEntry {
  /** Auto-generated unique id. */
  id: string;
  /** ms since epoch the producer decided. */
  recordedAt: number;
  domain: HistoryDomain;
  /** Producer name — typically the notifier module that fired (e.g. "push-notifier"). */
  source: string;
  action: HistoryAction;
  title: string;
  /** Short body line shown to the user. */
  body: string;
  severity: HistorySeverity;
  /** When `action === 'suppressed'`, this is the reason the producer
   *  returned (kp-below-threshold, magnitude-below-threshold, etc.). */
  suppressedReason?: string;
  /** Rule id that fired this notification (e.g. "default-seismic"). */
  ruleId?: string;
  /** Free-form raw payload — surfaces inside the expanded row. */
  payload?: Record<string, unknown>;
}

export const HISTORY_LIMIT = 200;
export const HISTORY_IDB_KEY = 'wm-notification-history';
export const HISTORY_SCHEMA_VERSION = 1;

// ── Pure helpers ──────────────────────────────────────────────────────────

let _idCounter = 0;

export function nextHistoryId(now = Date.now()): string {
  _idCounter += 1;
  return `nh-${now.toString(36)}-${_idCounter}`;
}

/** Map an internal threatType to a coarse domain label. */
export function domainForThreatType(threatType: string | undefined): HistoryDomain {
  if (!threatType) return 'unknown';
  if (threatType.startsWith('seismic_')) return 'seismic';
  if (threatType.startsWith('geomagnetic_')) return 'geomagnetic';
  if (threatType.startsWith('solar_flare_')) return 'solar_flare';
  if (threatType.startsWith('cap_')) return 'cap';
  if (threatType.startsWith('hurricane_')) return 'hurricane';
  if (threatType.startsWith('wildfire_')) return 'wildfire';
  if (threatType.startsWith('air_quality_')) return 'air_quality';
  if (threatType.startsWith('market_')) return 'market';
  if (threatType.startsWith('cyber_')) return 'cyber';
  return 'unknown';
}

export const DOMAIN_ICON: Record<HistoryDomain, string> = {
  seismic: '🌋',
  geomagnetic: '☀️',
  solar_flare: '🔆',
  cap: '🚨',
  hurricane: '🌀',
  wildfire: '🔥',
  air_quality: '🌫️',
  market: '📉',
  cyber: '🛡️',
  unknown: '❔',
};

export const SEVERITY_BADGE: Record<HistorySeverity, { color: string; label: string }> = {
  critical: { color: 'var(--severity-critical)', label: 'CRITICAL' },
  high:     { color: 'var(--severity-high)',     label: 'HIGH' },
  medium:   { color: 'var(--severity-medium)',   label: 'MEDIUM' },
  low:      { color: 'var(--severity-low)',      label: 'LOW' },
};

export const ACTION_BADGE: Record<HistoryAction, { color: string; label: string }> = {
  fired:      { color: 'var(--severity-ok)',       label: 'FIRED' },
  suppressed: { color: 'var(--severity-info)',     label: 'SUPPRESSED' },
  escalated:  { color: 'var(--severity-critical)', label: 'ESCALATED' },
};

// ── Filtering ─────────────────────────────────────────────────────────────

export interface HistoryFilter {
  domain?: HistoryDomain | 'all';
  severity?: HistorySeverity | 'all';
  action?: HistoryAction | 'all';
  /** Lower bound (inclusive) on recordedAt. */
  sinceMs?: number;
  /** Upper bound (exclusive) on recordedAt. */
  untilMs?: number;
}

export function filterHistory(
  entries: readonly NotificationHistoryEntry[],
  filter: HistoryFilter = {},
): NotificationHistoryEntry[] {
  return entries.filter((e) => {
    if (filter.domain && filter.domain !== 'all' && e.domain !== filter.domain) return false;
    if (filter.severity && filter.severity !== 'all' && e.severity !== filter.severity) return false;
    if (filter.action && filter.action !== 'all' && e.action !== filter.action) return false;
    if (filter.sinceMs !== undefined && e.recordedAt < filter.sinceMs) return false;
    if (filter.untilMs !== undefined && e.recordedAt >= filter.untilMs) return false;
    return true;
  });
}

// ── In-memory ring + persistence ──────────────────────────────────────────

let _entries: NotificationHistoryEntry[] = [];

/** Append an entry to the in-memory ring with FIFO eviction at HISTORY_LIMIT.
 *  Returns the appended entry — the caller can use the id for cross-refs. */
export function record(
  partial: Omit<NotificationHistoryEntry, 'id' | 'recordedAt'> & { recordedAt?: number },
): NotificationHistoryEntry {
  const recordedAt = partial.recordedAt ?? Date.now();
  const entry: NotificationHistoryEntry = {
    id: nextHistoryId(recordedAt),
    recordedAt,
    ...partial,
  };
  _entries.push(entry);
  if (_entries.length > HISTORY_LIMIT) {
    _entries.splice(0, _entries.length - HISTORY_LIMIT);
  }
  persistAsync();
  return entry;
}

export function getHistory(filter?: HistoryFilter): NotificationHistoryEntry[] {
  const src = filter ? filterHistory(_entries, filter) : _entries;
  const out: NotificationHistoryEntry[] = Array.from({length: src.length});
  for (let i = 0; i < src.length; i += 1) {
    out[i] = src[src.length - 1 - i]!;
  }
  return out;
}

export function clear(): void {
  _entries = [];
  persistAsync();
}

/** Hydrate from a JSON-serialized snapshot. Caller-supplied input is
 *  validated — bad rows are silently dropped. */
export function loadFromSnapshot(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object') return;
  const obj = snapshot as { version?: number; entries?: unknown };
  if (obj.version !== HISTORY_SCHEMA_VERSION) return;
  if (!Array.isArray(obj.entries)) return;
  _entries = obj.entries.filter((e) => isValidEntry(e)).slice(-HISTORY_LIMIT);
}

export function snapshot(): { version: number; entries: NotificationHistoryEntry[] } {
  return { version: HISTORY_SCHEMA_VERSION, entries: [..._entries] };
}

function isValidEntry(value: unknown): value is NotificationHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.recordedAt === 'number'
    && typeof v.domain === 'string'
    && typeof v.source === 'string'
    && typeof v.action === 'string'
    && typeof v.title === 'string'
    && typeof v.body === 'string'
    && typeof v.severity === 'string';
}

/** Test seam — drops the in-memory ring without persisting. */
export function __reset(): void {
  _entries = [];
}

// ── IndexedDB persistence ─────────────────────────────────────────────────

const DB_NAME = 'crystalball_db';
const STORE = 'kv';

let _dbPromise: Promise<IDBDatabase> | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function isIndexedDbAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const attach = (db: IDBDatabase): void => {
      db.addEventListener('close', () => { _dbPromise = null; });
      // Yield to another module (reasoning-memory / alert-store) bumping the
      // shared crystalball_db version — otherwise this open connection blocks
      // their upgrade. Reopened lazily on the next openDb() call.
      db.addEventListener('versionchange', () => {
        db.close();
        _dbPromise = null;
      });
      resolve(db);
    };

    const openWithUpgrade = (currentVersion: number): void => {
      const up = indexedDB.open(DB_NAME, currentVersion + 1);
      up.addEventListener('error', () => reject(up.error ?? new Error('Failed to upgrade IndexedDB')));
      up.addEventListener('blocked', () => reject(new Error('IndexedDB upgrade blocked')));
      up.addEventListener('upgradeneeded', () => {
        if (!up.result.objectStoreNames.contains(STORE)) up.result.createObjectStore(STORE);
      });
      up.addEventListener('success', () => attach(up.result));
    };

    // Open without a version first so we never request a version *lower* than
    // what alert-store / reasoning-memory may have already bumped the shared
    // crystalball_db to (which throws a VersionError and silently disabled
    // notification-history persistence on already-upgraded databases).
    const probe = indexedDB.open(DB_NAME);
    probe.addEventListener('error', () => reject(probe.error ?? new Error('Failed to open IndexedDB')));
    // Fires only when the DB does not exist yet — create our store in the fresh v1.
    probe.addEventListener('upgradeneeded', () => {
      if (!probe.result.objectStoreNames.contains(STORE)) probe.result.createObjectStore(STORE);
    });
    probe.addEventListener('success', () => {
      const db = probe.result;
      if (db.objectStoreNames.contains(STORE)) { attach(db); return; }
      const currentVersion = db.version;
      db.close();
      openWithUpgrade(currentVersion);
    });
  });
  return _dbPromise;
}

function persistAsync(): void {
  // Debounce — coalesce a burst of record() calls into a single write.
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    void persistNow();
  }, 250);
}

async function persistNow(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.addEventListener('complete', () => resolve());
      tx.addEventListener('error', () => reject(tx.error ?? new Error('IDB tx error')));
      tx.objectStore(STORE).put(snapshot(), HISTORY_IDB_KEY);
    });
  } catch {
    // Quota / corruption — drop the write; in-memory ring is canonical.
  }
}

/** Read the persisted ring from IDB and replace the in-memory store. */
export async function hydrateFromIdb(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const snap = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(HISTORY_IDB_KEY);
      req.addEventListener('success', () => resolve(req.result));
      req.addEventListener('error', () => reject(req.error ?? new Error('IDB read error')));
    });
    if (snap) loadFromSnapshot(snap);
  } catch {
    // Ignore — fresh start with empty ring.
  }
}
