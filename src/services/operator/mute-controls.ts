/**
 * Operator per-domain mute controls.
 *
 * Lets the user silence a notification domain for a fixed window (1h /
 * 4h / 24h). State is stored as a `{ [domain]: muteUntilMs }` map in
 * localStorage `wm-operator-mutes`. Pure helpers are exported so tests
 * can pin expiry behaviour without a clock or storage.
 */

import type { NotificationDomain } from '@/services/notifications/notification-settings-service';

export const STORAGE_KEY = 'wm-operator-mutes';

export type MuteDurationLabel = '1h' | '4h' | '24h';

export const MUTE_DURATIONS: Record<MuteDurationLabel, number> = {
  '1h':  60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export type MuteMap = Partial<Record<NotificationDomain, number>>;

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/** Parse stored payload, dropping any malformed / expired entries. */
export function parseMutes(raw: string | null, now: number): MuteMap {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: MuteMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value <= now) continue; // already expired — prune on read
    out[key as NotificationDomain] = value;
  }
  return out;
}

/** Compute mute-until timestamp for a given duration. */
export function muteUntil(now: number, duration: MuteDurationLabel): number {
  return now + MUTE_DURATIONS[duration];
}

/** Pure: is this domain currently muted? */
export function isMuted(mutes: MuteMap, domain: NotificationDomain, now: number): boolean {
  const until = mutes[domain];
  return typeof until === 'number' && until > now;
}

/** Pure: ms remaining on the mute, or 0 when not muted / already expired. */
export function remainingMs(mutes: MuteMap, domain: NotificationDomain, now: number): number {
  const until = mutes[domain];
  if (typeof until !== 'number') return 0;
  return Math.max(0, until - now);
}

/** Pure: drop all expired entries from a mute map (returns a fresh map). */
export function pruneExpired(mutes: MuteMap, now: number): MuteMap {
  const out: MuteMap = {};
  for (const [k, v] of Object.entries(mutes)) {
    if (typeof v === 'number' && v > now) out[k as NotificationDomain] = v;
  }
  return out;
}

/**
 * Format remaining time as a short "1h 23m" / "12m" / "39s" label for
 * the chip UI. Returns '' when the mute is expired.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// ── Persistent store ─────────────────────────────────────────────────────

export interface MuteStore {
  /** Snapshot of current (non-expired) mutes. */
  list(): MuteMap;
  mute(domain: NotificationDomain, duration: MuteDurationLabel): number;
  unmute(domain: NotificationDomain): void;
  isMuted(domain: NotificationDomain): boolean;
  remainingMs(domain: NotificationDomain): number;
}

export function createMuteStore(
  storage: StorageLike | null = defaultStorage(),
  now: () => number = Date.now,
): MuteStore {
  const persist = (mutes: MuteMap): void => {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(mutes)); }
    catch { /* quota / disabled — best-effort */ }
  };
  const read = (): MuteMap => parseMutes(storage?.getItem(STORAGE_KEY) ?? null, now());

  return {
    list() { return read(); },
    mute(domain, duration) {
      const mutes = read();
      const until = muteUntil(now(), duration);
      mutes[domain] = until;
      persist(mutes);
      return until;
    },
    unmute(domain) {
      const mutes = read();
      if (!(domain in mutes)) return;
      delete mutes[domain];
      persist(mutes);
    },
    isMuted(domain) {
      return isMuted(read(), domain, now());
    },
    remainingMs(domain) {
      return remainingMs(read(), domain, now());
    },
  };
}
