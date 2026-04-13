/**
 * Alert fatigue detection — tracks bulk-dismiss patterns and surfaces
 * suggestions when the user appears to be overwhelmed by alert volume.
 *
 * Fires `cb:fatigue-warning` when fatigue is detected.
 */

import { unifiedAlertStore } from './unified-alerts';

const STORAGE_KEY = 'crystalball-alert-fatigue-v1';
const CHECK_MS = 60_000;
const BULK_THRESHOLD = 10;
const BULK_WINDOW_MS = 5000;
const COOLDOWN_MS = 30 * 60_000;

interface FatigueState {
  ackTimestamps: number[];
  lastWarningTs: number;
  bulkDismissCount: number;
}

let state: FatigueState = { ackTimestamps: [], lastWarningTs: 0, bulkDismissCount: 0 };

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<FatigueState>) };
  } catch { /* noop */ }
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

function recordAck(): void {
  state.ackTimestamps.push(Date.now());
  if (state.ackTimestamps.length > 100) state.ackTimestamps = state.ackTimestamps.slice(-50);
}

function checkFatigue(): void {
  const now = Date.now();
  const recent = state.ackTimestamps.filter(t => now - t < BULK_WINDOW_MS);
  if (recent.length >= BULK_THRESHOLD && now - state.lastWarningTs > COOLDOWN_MS) {
    state.bulkDismissCount++;
    state.lastWarningTs = now;
    save();
    document.dispatchEvent(new CustomEvent('cb:fatigue-warning', {
      detail: {
        acksInWindow: recent.length,
        suggestion: state.bulkDismissCount > 3
          ? 'Consider raising the minimum severity filter to HIGH+ to reduce noise.'
          : 'You\'re bulk-dismissing alerts quickly. Consider using domain filters to focus on what matters.',
      },
    }));
  }
}

/** Get fatigue stats for display. */
export function getFatigueStats(): { bulkDismissCount: number; lastWarningTs: number } {
  return { bulkDismissCount: state.bulkDismissCount, lastWarningTs: state.lastWarningTs };
}

let started = false;
export function startAlertFatigue(): void {
  if (started) return;
  started = true;
  load();

  let prevAckSet = new Set(
    unifiedAlertStore.getAll().filter(a => a.acknowledged).map(a => a.id),
  );

  unifiedAlertStore.subscribe(() => {
    const currentAcked = new Set(
      unifiedAlertStore.getAll().filter(a => a.acknowledged).map(a => a.id),
    );
    for (const id of currentAcked) {
      if (!prevAckSet.has(id)) recordAck();
    }
    prevAckSet = currentAcked;
  });

  window.setInterval(checkFatigue, CHECK_MS);
}
