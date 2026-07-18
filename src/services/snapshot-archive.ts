/**
 * Snapshot Archive — persistent ring buffer of analyst snapshots.
 *
 * Enables the HUD's replay scrubber: given a timestamp, we can
 * reconstruct the top hypotheses as they existed at that point in
 * time. Complements `briefing-archive` (briefs) and `hypothesis-threads`
 * (per-signature trajectory) — this one captures the full list.
 *
 * Capped at 120 snapshots (~10 hours at 5-min cadence). Persists to
 * localStorage (compact) and IDB (durable).
 */

import type { AnalystSnapshot } from './analyst-loop';
import { getMemory, putMemory } from './reasoning-memory';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-snapshot-archive-v1';
const MAX_SNAPSHOTS = 120;
const EVENT_NAME = 'cb:snapshot-archived';

// ── State ─────────────────────────────────────────────────────────────────────

const archive: AnalystSnapshot[] = [];
let loaded = false;
let writtenSinceLoad = false;

function applyLoaded(arr: AnalystSnapshot[] | null): void {
  if (!Array.isArray(arr)) return;
  archive.length = 0;
  archive.push(...arr);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as AnalystSnapshot[]);
  } catch { /* ignore */ }
  // Async IDB hydrate must not clobber writes that landed while it was
  // in flight (the analyst-loop's first cycle can fire within a tick
  // of load() being called).
  void getMemory<AnalystSnapshot[]>(STORAGE_KEY).then(arr => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  }).catch(() => { /* IDB unavailable; localStorage bootstrap still valid */ });
}

function save(): void {
  writtenSinceLoad = true;
  const tail = archive.slice(-MAX_SNAPSHOTS);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tail)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, tail).catch(() => { /* IDB write failed */ });
}

// ── Ingestion ────────────────────────────────────────────────────────────────

function ingest(snapshot: AnalystSnapshot): void {
  load();
  // De-dupe: if the most recent snapshot has the same timestamp, replace it.
  const prev = archive[archive.length - 1];
  if (prev?.timestamp === snapshot.timestamp) {
    archive[archive.length - 1] = snapshot;
  } else {
    archive.push(snapshot);
    if (archive.length > MAX_SNAPSHOTS) archive.splice(0, archive.length - MAX_SNAPSHOTS);
  }
  save();
  document.dispatchEvent(new CustomEvent<AnalystSnapshot>(EVENT_NAME, { detail: snapshot }));
}

// ── Public read API ──────────────────────────────────────────────────────────

/** All archived snapshots, oldest first. */
export function getAllSnapshots(): AnalystSnapshot[] {
  load();
  return [...archive];
}

/** Count of archived snapshots. */
export function getSnapshotCount(): number {
  load();
  return archive.length;
}

/**
 * Snapshot at the given index (0 = oldest). Returns null for out-of-range.
 * Used by the replay scrubber.
 */
export function getSnapshotAt(index: number): AnalystSnapshot | null {
  load();
  if (index < 0 || index >= archive.length) return null;
  return archive[index] ?? null;
}

/**
 * Find the snapshot whose timestamp is closest to `at` (unix ms).
 * Returns null if the archive is empty.
 */
export function findNearestSnapshot(at: number): AnalystSnapshot | null {
  load();
  if (archive.length === 0) return null;
  let best = archive[0] ?? null;
  if (!best) return null;
  let bestDelta = Math.abs((best.timestamp ?? 0) - at);
  for (const snap of archive) {
    const delta = Math.abs((snap.timestamp ?? 0) - at);
    if (delta < bestDelta) {
      best = snap;
      bestDelta = delta;
    }
  }
  return best;
}

export function resetSnapshotArchive(): void {
  archive.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  void putMemory(STORAGE_KEY, []);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startSnapshotArchive(): void {
  if (started) return;
  started = true;
  load();
  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    ingest(ce.detail);
  });
}

export function subscribeSnapshotArchive(cb: (snapshot: AnalystSnapshot) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
