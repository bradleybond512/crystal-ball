/* eslint-disable sonarjs/void-use, sonarjs/cognitive-complexity */
/**
 * Source feedback learning — observes user ack/snooze behavior per source
 * and produces a feedback multiplier (0.5–1.0) used to dampen score on
 * sources the user consistently treats as noise.
 *
 * Heuristic: if median time-to-ack for a source is under 10 seconds, the
 * user is dismissing them on sight → noise. Cap dampening at 0.5 so we
 * never fully silence a source via behavior alone.
 */

import { unifiedAlertStore, type AlertSource } from './unified-alerts';

const STORAGE_KEY = 'crystalball-source-feedback-v1';
const FAST_ACK_MS = 10_000;
const MIN_SAMPLES = 5;

interface SourceStats {
  ackCount: number;
  fastAckCount: number;
  snoozeCount: number;
}

const stats = new Map<AlertSource, SourceStats>();
const sourceByAlertId = new Map<string, { source: AlertSource; firstSeenAt: number }>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SourceStats>;
    for (const [k, v] of Object.entries(obj)) stats.set(k as AlertSource, v);
  } catch { /* noop */ }
}
function save(): void {
  const obj: Record<string, SourceStats> = {};
  for (const [k, v] of stats) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

function bump(source: AlertSource, field: keyof SourceStats): void {
  const cur = stats.get(source) ?? { ackCount: 0, fastAckCount: 0, snoozeCount: 0 };
  cur[field] += 1;
  stats.set(source, cur);
  save();
}

/** 0.5–1.0 multiplier — closer to 0.5 means user treats this source as noise. */
export function getSourceFeedbackMult(source: AlertSource): number {
  const s = stats.get(source);
  if (!s || s.ackCount < MIN_SAMPLES) return 1;
  const fastRatio = s.fastAckCount / s.ackCount;
  // Snoozes count as a stronger "not now" signal than a fast-ack.
  const snoozeRatio = s.snoozeCount / Math.max(1, s.ackCount + s.snoozeCount);
  const noise = Math.min(1, (fastRatio * 0.5) + (snoozeRatio * 0.7));
  return Math.max(0.5, 1 - (noise * 0.5));
}

let started = false;
export function startSourceFeedback(): void {
  if (started) return;
  started = true;
  load();

  // Track when each alert is first observed.
  const observe = (): void => {
    const now = Date.now();
    for (const a of unifiedAlertStore.getAll()) {
      if (!sourceByAlertId.has(a.id)) {
        sourceByAlertId.set(a.id, { source: a.source, firstSeenAt: now });
      }
    }
  };
  observe();

  let prevAckedIds = new Set<string>();
  let prevSnoozedIds = new Set<string>();
  for (const a of unifiedAlertStore.getAll()) {
    if (a.acknowledged) prevAckedIds.add(a.id);
    if (a.snoozedUntil && a.snoozedUntil > Date.now()) prevSnoozedIds.add(a.id);
  }

  unifiedAlertStore.subscribe(() => {
    observe();
    const now = Date.now();
    const nowAcked = new Set<string>();
    const nowSnoozed = new Set<string>();
    for (const a of unifiedAlertStore.getAll()) {
      if (a.acknowledged) nowAcked.add(a.id);
      if (a.snoozedUntil && a.snoozedUntil > now) nowSnoozed.add(a.id);
    }
    for (const id of nowAcked) {
      if (prevAckedIds.has(id)) continue;
      const meta = sourceByAlertId.get(id);
      if (!meta) continue;
      bump(meta.source, 'ackCount');
      if (now - meta.firstSeenAt < FAST_ACK_MS) bump(meta.source, 'fastAckCount');
    }
    for (const id of nowSnoozed) {
      if (prevSnoozedIds.has(id)) continue;
      const meta = sourceByAlertId.get(id);
      if (meta) bump(meta.source, 'snoozeCount');
    }
    prevAckedIds = nowAcked;
    prevSnoozedIds = nowSnoozed;
  });
}
