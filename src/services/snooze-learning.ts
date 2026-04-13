/**
 * Smart snooze learning — records snooze durations per source/severity
 * and computes a median suggestion after enough samples.
 */

import type { AlertSource, AlertSeverity } from './unified-alerts';

const STORAGE_KEY = 'crystalball-snooze-learn-v1';
const MIN_SAMPLES = 10;
const MAX_HISTORY = 50;

interface SnoozeHistory {
  durations: number[];  // milliseconds
}

const history = new Map<string, SnoozeHistory>();

function key(source: AlertSource, severity: AlertSeverity): string {
  return `${source}:${severity}`;
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SnoozeHistory>;
    for (const [k, v] of Object.entries(obj)) history.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, SnoozeHistory> = {};
  for (const [k, v] of history) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

/** Record a snooze event. */
export function recordSnooze(source: AlertSource, severity: AlertSeverity, durationMs: number): void {
  const k = key(source, severity);
  let entry = history.get(k);
  if (!entry) { entry = { durations: [] }; history.set(k, entry); }
  entry.durations.push(durationMs);
  if (entry.durations.length > MAX_HISTORY) entry.durations = entry.durations.slice(-MAX_HISTORY);
  save();
}

/** Get the suggested snooze duration (median) for a source/severity, or null if insufficient data. */
export function getSnoozeSuggestion(source: AlertSource, severity: AlertSeverity): number | null {
  const k = key(source, severity);
  const entry = history.get(k);
  if (!entry || entry.durations.length < MIN_SAMPLES) return null;
  const sorted = [...entry.durations].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Format milliseconds to a human-friendly label. */
export function formatSnoozeDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function initSnoozeLearning(): void {
  load();
}
