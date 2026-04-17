/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Alert lifecycle tracker — tracks each alert's trajectory over time
 * (rising → peaked → cooling → resolved) by sampling the alert store
 * every 5 minutes and comparing mention velocity.
 *
 * Powers the lifecycle indicator on Triage items.
 */

import { unifiedAlertStore } from './unified-alerts';

export type LifecyclePhase = 'rising' | 'peaked' | 'cooling' | 'resolved';

interface LifecycleEntry {
  firstSeen: number;
  peakScore: number;
  peakTs: number;
  samples: number[];  // last 12 scores (1h at 5min intervals)
  phase: LifecyclePhase;
}

const STORAGE_KEY = 'crystalball-alert-lifecycle-v1';
const SAMPLE_MS = 5 * 60_000;
const MAX_SAMPLES = 12;

const lifecycles = new Map<string, LifecycleEntry>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, LifecycleEntry>;
    for (const [k, v] of Object.entries(obj)) lifecycles.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  // Only persist entries from the last 12h.
  const cutoff = Date.now() - 12 * 60 * 60_000;
  const obj: Record<string, LifecycleEntry> = {};
  for (const [k, v] of lifecycles) {
    if (v.peakTs > cutoff) obj[k] = v;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

function computePhase(entry: LifecycleEntry): LifecyclePhase {
  const s = entry.samples;
  if (s.length < 2) return 'rising';
  const latest = s[s.length - 1]!;
  const prev = s[s.length - 2]!;

  if (latest <= 0) return 'resolved';
  if (latest >= entry.peakScore * 0.9 && latest >= prev) return 'rising';
  if (latest >= entry.peakScore * 0.5) return 'peaked';
  return 'cooling';
}

function sample(): void {
  const now = Date.now();
  const alerts = unifiedAlertStore.getAll();
  const scoreMap = new Map<string, number>();

  // Use relevanceScore as the lifecycle score proxy.
  for (const a of alerts) {
    if (a.acknowledged) continue;
    const score = a.relevanceScore ?? 0;
    scoreMap.set(a.id, score);
  }

  // Update existing entries and create new ones.
  for (const [id, score] of scoreMap) {
    let entry = lifecycles.get(id);
    if (!entry) {
      entry = { firstSeen: now, peakScore: score, peakTs: now, samples: [], phase: 'rising' };
      lifecycles.set(id, entry);
    }
    entry.samples.push(score);
    if (entry.samples.length > MAX_SAMPLES) entry.samples.shift();
    if (score > entry.peakScore) {
      entry.peakScore = score;
      entry.peakTs = now;
    }
    entry.phase = computePhase(entry);
  }

  // Mark missing alerts as resolved.
  for (const [id, entry] of lifecycles) {
    if (!scoreMap.has(id) && entry.phase !== 'resolved') {
      entry.samples.push(0);
      if (entry.samples.length > MAX_SAMPLES) entry.samples.shift();
      entry.phase = 'resolved';
    }
  }

  save();
}

/** Get lifecycle phase for a specific alert. */
export function getLifecyclePhase(alertId: string): LifecyclePhase {
  return lifecycles.get(alertId)?.phase ?? 'rising';
}

/** Get the raw sample history for a specific alert (for sparklines). */
export function getLifecycleSamples(alertId: string): number[] {
  return lifecycles.get(alertId)?.samples ?? [];
}

/** Get lifecycle data for all tracked alerts. */
export function getAllLifecycles(): Map<string, LifecyclePhase> {
  const result = new Map<string, LifecyclePhase>();
  for (const [id, entry] of lifecycles) result.set(id, entry.phase);
  return result;
}

let started = false;
export function startAlertLifecycle(): void {
  if (started) return;
  started = true;
  load();
  sample();
  window.setInterval(sample, SAMPLE_MS);
}
