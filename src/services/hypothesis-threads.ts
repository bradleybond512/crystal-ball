/**
 * Hypothesis Threads — continuity tracker across analyst snapshots.
 *
 * Each analyst-loop cycle emits a fresh list of hypotheses with fresh IDs,
 * so a Taiwan convergence hypothesis at 10:00 and its continuation at 10:05
 * look unrelated at the ID level. This service matches successive snapshots
 * by `signatureFor()` and maintains per-thread state: age, confidence
 * trajectory, and peak risk. The HUD consumes threads to show "4th cycle,
 * confidence strengthening 0.62 → 0.78" instead of a context-less snapshot.
 */

import type { Hypothesis, AnalystSnapshot } from './analyst-loop';
import type { EscalationRisk } from './threat-synthesis';
import { signatureFor } from './hypothesis-feedback';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Trajectory = 'strengthening' | 'stable' | 'weakening' | 'new';

export interface HypothesisThread {
  /** Stable signature that identifies this thread across cycles. */
  signature: string;
  kind: Hypothesis['kind'];
  region?: string;
  /** Timestamp this thread was first observed. */
  firstSeen: number;
  /** Timestamp of the most recent observation. */
  lastSeen: number;
  /** Number of distinct cycles this signature has been observed in. */
  cycleCount: number;
  /** Most recent hypothesis snapshot for this thread. */
  latest: Hypothesis;
  /** Previous confidence (for delta computation). */
  previousConfidence: number;
  /** Short history of confidence readings (capped). */
  confidenceHistory: number[];
  /** Highest risk this thread has reached. */
  peakRisk: EscalationRisk;
  trajectory: Trajectory;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-hypothesis-threads-v1';
const EVENT_NAME = 'cb:hypothesis-threads';
const HISTORY_MAX = 12;
const THREAD_STALE_MS = 30 * 60 * 1000; // 30 minutes since last observation
const CONFIDENCE_DELTA_EPSILON = 0.03;

const RISK_RANK: Record<EscalationRisk, number> = {
  critical: 3, high: 2, moderate: 1, low: 0,
};

// ── State ─────────────────────────────────────────────────────────────────────

const threads = new Map<string, HypothesisThread>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as HypothesisThread[];
    for (const t of arr) threads.set(t.signature, t);
  } catch { /* ignore */ }
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...threads.values()])); }
  catch { /* quota */ }
}

// ── Thread update ────────────────────────────────────────────────────────────

function computeTrajectory(prev: number, current: number): Trajectory {
  const delta = current - prev;
  if (Math.abs(delta) < CONFIDENCE_DELTA_EPSILON) return 'stable';
  return delta > 0 ? 'strengthening' : 'weakening';
}

function maxRisk(a: EscalationRisk, b: EscalationRisk): EscalationRisk {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

function upsertThread(h: Hypothesis, now: number): HypothesisThread {
  const sig = signatureFor(h);
  const existing = threads.get(sig);
  if (!existing) {
    const created: HypothesisThread = {
      signature: sig,
      kind: h.kind,
      region: h.region,
      firstSeen: h.timestamp,
      lastSeen: now,
      cycleCount: 1,
      latest: h,
      previousConfidence: h.confidence,
      confidenceHistory: [h.confidence],
      peakRisk: h.risk,
      trajectory: 'new',
    };
    threads.set(sig, created);
    return created;
  }
  const history = [...existing.confidenceHistory, h.confidence].slice(-HISTORY_MAX);
  const updated: HypothesisThread = {
    ...existing,
    lastSeen: now,
    cycleCount: existing.cycleCount + 1,
    latest: h,
    previousConfidence: existing.latest.confidence,
    confidenceHistory: history,
    peakRisk: maxRisk(existing.peakRisk, h.risk),
    trajectory: computeTrajectory(existing.latest.confidence, h.confidence),
  };
  threads.set(sig, updated);
  return updated;
}

function pruneStale(now: number): void {
  for (const [sig, t] of threads) {
    if (now - t.lastSeen > THREAD_STALE_MS) threads.delete(sig);
  }
}

function handleSnapshot(snapshot: AnalystSnapshot): void {
  load();
  const now = Date.now();
  for (const h of snapshot.hypotheses) upsertThread(h, now);
  pruneStale(now);
  save();
  document.dispatchEvent(new CustomEvent<HypothesisThread[]>(EVENT_NAME, {
    detail: [...threads.values()],
  }));
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Get the thread state for a given hypothesis, if one exists. */
export function getThreadFor(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): HypothesisThread | null {
  load();
  return threads.get(signatureFor(h)) ?? null;
}

/** All current threads, sorted by peak risk then cycle count. */
export function getAllThreads(): HypothesisThread[] {
  load();
  return [...threads.values()].sort((a, b) => {
    const riskDelta = RISK_RANK[b.peakRisk] - RISK_RANK[a.peakRisk];
    if (riskDelta !== 0) return riskDelta;
    return b.cycleCount - a.cycleCount;
  });
}

export function resetThreads(): void {
  threads.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startHypothesisThreads(): void {
  if (started) return;
  started = true;
  load();
  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    handleSnapshot(ce.detail);
  });
}

export function subscribeThreads(cb: (threads: HypothesisThread[]) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<HypothesisThread[]>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
