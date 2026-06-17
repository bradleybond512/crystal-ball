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

import { dataFreshness } from './data-freshness';

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
  if (!Number.isFinite(ms)) return 'never';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// A feed that is actively erroring stops writing cb-source-updates, so the
// age-only check below can report "fresh" while a source is silently failing.
// Consult the freshness tracker's error state so the banner reflects reality.
function feedHasRecentError(): boolean {
  try { return dataFreshness.hasRecentError(); } catch { return false; }
}

export function getOfflineState(): OfflineState {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const offlineDurationMs = isOnline ? 0 : Math.max(0, Date.now() - lastOnlineAt);
  const oldestAge = oldestCachedAge();
  const feedError = feedHasRecentError();

  let status: OfflineStatus = 'fresh';
  if (!isOnline && offlineDurationMs > OFFLINE_GRACE_MS) {
    status = 'offline';
  } else if (offlineDurationMs > OFFLINE_VERY_STALE_MS || oldestAge > VERY_STALE_MS) {
    status = 'very-stale';
  } else if (oldestAge > STALE_MS || (!isOnline && offlineDurationMs > 0)) {
    status = 'stale';
  } else if (oldestAge > FRESH_MS || feedError) {
    status = 'stale';
  }

  const ageLabel = formatAge(oldestAge);
  let bannerLabel = '';
  let bannerSubtext = '';
  if (status === 'offline') {
    bannerLabel = 'No connection';
    bannerSubtext = `Viewing cached data from ${ageLabel}`;
  } else if (status === 'very-stale') {
    bannerLabel = 'Data is very old';
    bannerSubtext = `Last updated ${ageLabel} \u2014 verify before use`;
  } else if (status === 'stale' && feedError && oldestAge <= STALE_MS) {
    bannerLabel = 'A data feed is not updating';
    bannerSubtext = `Some sources may be out of date — last refresh ${ageLabel}`;
  } else if (status === 'stale') {
    bannerLabel = 'Viewing cached data';
    bannerSubtext = `Last updated ${ageLabel}`;
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
