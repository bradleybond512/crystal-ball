/* eslint-disable no-console */
 
/**
 * Offline Staleness Monitor
 *
 * Tracks the last time each data source successfully refreshed, detects
 * when the app has been offline or backgrounded for long periods, and
 * emits events so UI elements can display UNMISTAKABLE staleness warnings.
 *
 * Design principle: stale intelligence is misleading intelligence. The
 * banner must be impossible to miss. Cached data is NEVER presented as
 * "current" — always with an explicit age.
 */

export type OfflineStatus = 'fresh' | 'stale' | 'very-stale' | 'offline';

export interface OfflineState {
  isOnline: boolean;
  lastOnlineAt: number;
  offlineDurationMs: number;
  oldestCachedDataAgeMs: number;
  status: OfflineStatus;
  bannerLabel: string;
  bannerSubtext: string;
}

const STORAGE_KEY = 'cb-source-updates';
const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;
const VERY_STALE_MS = 60 * 60 * 1000;
const OFFLINE_GRACE_MS = 30 * 1000;
const OFFLINE_VERY_STALE_MS = 5 * 60 * 1000;

type Listener = (state: OfflineState) => void;
const listeners = new Set<Listener>();

let lastOnlineAt = Date.now();
let monitorStarted = false;

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors — staleness tracking is best-effort
  }
}

export function recordSourceUpdate(sourceId: string, timestamp: number = Date.now()): void {
  const map = readMap();
  map[sourceId] = timestamp;
  writeMap(map);
  lastOnlineAt = Math.max(lastOnlineAt, timestamp);
  emit();
}

export function getSourceAge(sourceId: string): number | null {
  const map = readMap();
  const ts = map[sourceId];
  if (typeof ts !== 'number') return null;
  return Math.max(0, Date.now() - ts);
}

function oldestCachedAge(): number {
  const map = readMap();
  const entries = Object.values(map);
  if (entries.length === 0) return Number.POSITIVE_INFINITY;
  const now = Date.now();
  let oldest = 0;
  for (const ts of entries) {
    const age = Math.max(0, now - ts);
    if (age > oldest) oldest = age;
  }
  return oldest;
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return 'NEVER';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}m AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h AGO`;
  return `${Math.floor(hrs / 24)}d AGO`;
}

export function getOfflineState(): OfflineState {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const offlineDurationMs = isOnline ? 0 : Math.max(0, Date.now() - lastOnlineAt);
  const oldestAge = oldestCachedAge();

  let status: OfflineStatus = 'fresh';
  if (!isOnline && offlineDurationMs > OFFLINE_GRACE_MS) {
    status = 'offline';
  } else if (offlineDurationMs > OFFLINE_VERY_STALE_MS || oldestAge > VERY_STALE_MS) {
    status = 'very-stale';
  } else if (oldestAge > STALE_MS || (!isOnline && offlineDurationMs > 0)) {
    status = 'stale';
  } else if (oldestAge > FRESH_MS) {
    status = 'stale';
  }

  const ageLabel = formatAge(oldestAge);
  let bannerLabel = '';
  let bannerSubtext = '';
  if (status === 'offline') {
    bannerLabel = `\u26A0 OFFLINE \u2014 CACHED DATA ${ageLabel}`;
    bannerSubtext = 'NO LIVE CONNECTION. DO NOT USE FOR OPERATIONAL DECISIONS.';
  } else if (status === 'very-stale') {
    bannerLabel = `\u26A0 STALE DATA \u2014 LAST UPDATE ${ageLabel}`;
    bannerSubtext = 'NOT CURRENT. VERIFY BEFORE OPERATIONAL USE.';
  } else if (status === 'stale') {
    bannerLabel = `\u26A0 CACHED DATA \u2014 LAST UPDATE ${ageLabel}`;
    bannerSubtext = 'NOT CURRENT. VERIFY BEFORE OPERATIONAL USE.';
  }

  return {
    isOnline,
    lastOnlineAt,
    offlineDurationMs,
    oldestCachedDataAgeMs: oldestAge,
    status,
    bannerLabel,
    bannerSubtext,
  };
}

function emit(): void {
  const state = getOfflineState();
  for (const cb of listeners) {
    try { cb(state); } catch (error) { console.warn('[offline-staleness] listener error', error); }
  }
}

export function subscribeOfflineState(cb: Listener): () => void {
  listeners.add(cb);
  try { cb(getOfflineState()); } catch (error) { console.warn('[offline-staleness] initial cb error', error); }
  return () => { listeners.delete(cb); };
}

export function startOfflineMonitor(): void {
  if (monitorStarted) return;
  monitorStarted = true;
  if (typeof window === 'undefined') return;

  window.addEventListener('online', () => {
    lastOnlineAt = Date.now();
    emit();
  });
  window.addEventListener('offline', () => {
    emit();
  });
  setInterval(emit, 30 * 1000);
  if (navigator.onLine !== false) lastOnlineAt = Date.now();
  emit();
}
