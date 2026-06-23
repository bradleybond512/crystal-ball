/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Correlation feedback — tracks user reactions to synthesized correlation
 * alerts, keyed by causal pair. A pair that's repeatedly dismissed fast
 * gets its confidence dampened; one that gets pinned or lingers gets
 * boosted slightly.
 *
 * Multiplier range: 0.5 (noise) → 1.2 (trusted).
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';

const STORAGE_KEY = 'crystalball-correlation-feedback-v1';
const FAST_ACK_MS = 10_000;
const MIN_SAMPLES = 3;

interface PairStats { ack: number; fastAck: number; pinned: number; }
const stats = new Map<string, PairStats>();
const firstSeen = new Map<string, number>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, PairStats>;
    for (const [k, v] of Object.entries(obj)) stats.set(k, v);
  } catch { /* noop */ }
}
function save(): void {
  const obj: Record<string, PairStats> = {};
  for (const [k, v] of stats) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

function pairKeyFor(a: UnifiedAlert): string | null {
  if (a.source !== 'correlation' || !a.correlationPair) return null;
  return `${a.correlationPair[0]}|${a.correlationPair[1]}`;
}

/** 0.5–1.2 multiplier applied to synthesized correlation confidence. */
export function getPairFeedbackMult(pairKey: string): number {
  const s = stats.get(pairKey);
  if (!s || (s.ack + s.pinned) < MIN_SAMPLES) return 1;
  const total = s.ack + s.pinned;
  const fastRatio = s.fastAck / Math.max(1, s.ack);
  const pinRatio = s.pinned / total;
  // Fast-dismiss pushes toward 0.5, pinning pushes toward 1.2.
  return Math.max(0.5, Math.min(1.2, 1 - (fastRatio * 0.5) + (pinRatio * 0.2)));
}

let started = false;
export function startCorrelationFeedback(): void {
  if (started) return;
  started = true;
  load();

  for (const a of unifiedAlertStore.getAll()) {
    if (a.source === 'correlation' && !firstSeen.has(a.id)) firstSeen.set(a.id, Date.now());
  }

  let prevAcked = new Set<string>();
  let prevPinned = new Set<string>();
  for (const a of unifiedAlertStore.getAll()) {
    if (a.source === 'correlation' && a.acknowledged) prevAcked.add(a.id);
    if (a.source === 'correlation' && a.pinned) prevPinned.add(a.id);
  }

  unifiedAlertStore.subscribe(() => {
    const now = Date.now();
    const nowAcked = new Set<string>();
    const nowPinned = new Set<string>();
    const currentIds = new Set<string>();
    for (const a of unifiedAlertStore.getAll()) {
      if (a.source !== 'correlation') continue;
      currentIds.add(a.id);
      if (!firstSeen.has(a.id)) firstSeen.set(a.id, now);
      if (a.acknowledged) nowAcked.add(a.id);
      if (a.pinned) nowPinned.add(a.id);
    }
    let changed = false;
    for (const id of nowAcked) {
      if (prevAcked.has(id)) continue;
      const a = unifiedAlertStore.getAll().find(x => x.id === id);
      if (!a) continue;
      const pk = pairKeyFor(a);
      if (!pk) continue;
      const seen = firstSeen.get(id) ?? now;
      const cur = stats.get(pk) ?? { ack: 0, fastAck: 0, pinned: 0 };
      cur.ack += 1;
      if (now - seen < FAST_ACK_MS) cur.fastAck += 1;
      stats.set(pk, cur);
      changed = true;
    }
    for (const id of nowPinned) {
      if (prevPinned.has(id)) continue;
      const a = unifiedAlertStore.getAll().find(x => x.id === id);
      if (!a) continue;
      const pk = pairKeyFor(a);
      if (!pk) continue;
      const cur = stats.get(pk) ?? { ack: 0, fastAck: 0, pinned: 0 };
      cur.pinned += 1;
      stats.set(pk, cur);
      changed = true;
    }
    if (changed) save();
    // Bound firstSeen to live correlation alerts — its only use is the fast-ack
    // window per id, so ids no longer in the store are dead weight.
    for (const id of firstSeen.keys()) {
      if (!currentIds.has(id)) firstSeen.delete(id);
    }
    prevAcked = nowAcked;
    prevPinned = nowPinned;
  });
}
