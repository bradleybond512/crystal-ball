/**
 * Briefing Archive — persistent timeline of every auto-brief.
 *
 * The `auto-brief` service only retains the latest brief per domain.
 * This service subscribes to `cb:auto-brief` and archives each brief
 * into the IDB reasoning_memory store with a bounded ring buffer
 * (200 briefs), giving the HUD a scrollable history.
 *
 * Archives are also accessible via MCP through the existing analyst
 * state channel if we want to surface them to external agents later.
 */

import type { AutoBrief } from './auto-brief';
import { subscribeAutoBrief } from './auto-brief';
import { getMemory, putMemory } from './reasoning-memory';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-briefing-archive-v1';
const MAX_BRIEFS = 200;
const EVENT_NAME = 'cb:briefing-archived';

// ── State ─────────────────────────────────────────────────────────────────────

const archive: AutoBrief[] = [];
let loaded = false;
let writtenSinceLoad = false;

function applyLoaded(arr: AutoBrief[] | null): void {
  if (!Array.isArray(arr)) return;
  archive.length = 0;
  archive.push(...arr);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as AutoBrief[]);
  } catch { /* ignore */ }
  void getMemory<AutoBrief[]>(STORAGE_KEY).then(arr => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  }).catch(() => { /* IDB unavailable; localStorage bootstrap still valid */ });
}

function save(): void {
  writtenSinceLoad = true;
  // Only keep the last MAX_BRIEFS in localStorage to stay under quota;
  // full archive also lives in IDB which has more headroom.
  const tail = archive.slice(-MAX_BRIEFS);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tail)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, tail).catch(() => { /* IDB write failed */ });
}

// ── Write API ────────────────────────────────────────────────────────────────

function archiveBrief(brief: AutoBrief): void {
  load();
  archive.push(brief);
  if (archive.length > MAX_BRIEFS) archive.splice(0, archive.length - MAX_BRIEFS);
  save();
  document.dispatchEvent(new CustomEvent<AutoBrief>(EVENT_NAME, { detail: brief }));
}

// ── Read API ─────────────────────────────────────────────────────────────────

function reversedCopy<T>(arr: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** Newest-first timeline of archived briefs. */
export function getArchive(): AutoBrief[] {
  load();
  return reversedCopy(archive);
}

/** Filter to a specific domain, newest first. */
export function getArchiveForDomain(domain: AutoBrief['domain'], limit = 20): AutoBrief[] {
  load();
  return reversedCopy(archive.filter(b => b.domain === domain).slice(-limit));
}

/** Briefs generated in the last `windowMs` milliseconds. */
export function getRecentBriefs(windowMs: number): AutoBrief[] {
  load();
  const cutoff = Date.now() - windowMs;
  return reversedCopy(archive.filter(b => b.generatedAt >= cutoff));
}

export function resetArchive(): void {
  archive.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  void putMemory(STORAGE_KEY, []);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startBriefingArchive(): void {
  if (started) return;
  started = true;
  load();
  subscribeAutoBrief(archiveBrief);
}

export function subscribeBriefingArchive(cb: (brief: AutoBrief) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<AutoBrief>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
