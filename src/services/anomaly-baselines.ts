 
/**
 * Anomaly baselines — per-source 7-day rolling rate (alerts per hour).
 * Flags when a source is 3σ above its own baseline ("burst"), or silent
 * when it's normally chatty ("unusually quiet").
 *
 * Stored in localStorage as a ring buffer of hourly counts per source.
 */

import { unifiedAlertStore, type AlertSource, type UnifiedAlert } from './unified-alerts';
import { debounce } from '../utils';

const STORAGE_KEY = 'crystalball-anomaly-baselines-v1';
const HOURS = 24 * 7; // 168 hour ring
const BURST_SIGMA = 3;

interface SourceRing {
  counts: number[];    // length HOURS, index = hourBucket % HOURS
  lastBucket: number;  // last hour bucket we wrote
}

const rings = new Map<AlertSource, SourceRing>();
const seenIds = new Set<string>();

function hourBucket(ts: number): number {
  return Math.floor(ts / 3_600_000);
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SourceRing>;
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v.counts) && v.counts.length === HOURS) {
        rings.set(k as AlertSource, v);
      }
    }
  } catch { /* noop */ }
}
function save(): void {
  const obj: Record<string, SourceRing> = {};
  for (const [k, v] of rings) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(): void {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    save();
    saveTimeout = null;
  }, 2000);
}

function bump(source: AlertSource, ts: number): void {
  const bucket = hourBucket(ts);
  let ring = rings.get(source);
  if (!ring) {
    ring = { counts: Array.from({ length: HOURS }, () => 0), lastBucket: bucket };
    rings.set(source, ring);
  }
  // Zero-fill any hours we skipped so stale entries don't linger.
  if (ring.lastBucket < bucket) {
    const gap = Math.min(HOURS, bucket - ring.lastBucket);
    for (let i = 1; i <= gap; i++) {
      ring.counts[(ring.lastBucket + i) % HOURS] = 0;
    }
    ring.lastBucket = bucket;
  }
  ring.counts[bucket % HOURS] = (ring.counts[bucket % HOURS] ?? 0) + 1;
}

export interface BaselineStats {
  source: AlertSource;
  mean: number;      // per-hour mean over 7d
  stdev: number;
  current: number;   // count in the current hour bucket
  zScore: number;    // (current - mean) / stdev
  status: 'burst' | 'quiet' | 'normal';
}

export function getBaselineStats(): BaselineStats[] {
  const now = hourBucket(Date.now());
  const out: BaselineStats[] = [];
  for (const [source, ring] of rings) {
    const current = ring.counts[now % HOURS] ?? 0;
    const sum = ring.counts.reduce((s, x) => s + x, 0);
    const mean = sum / HOURS;
    const variance = ring.counts.reduce((s, x) => s + (x - mean) ** 2, 0) / HOURS;
    const stdev = Math.sqrt(variance);
    const zScore = stdev > 0 ? (current - mean) / stdev : 0;
    let status: BaselineStats['status'] = 'normal';
    if (zScore >= BURST_SIGMA && current >= 3) status = 'burst';
    else if (mean >= 1 && current === 0 && stdev > 0) status = 'quiet';
    out.push({ source, mean, stdev, current, zScore, status });
  }
  return out.sort((a, b) => b.zScore - a.zScore);
}

export function getAnomalies(): BaselineStats[] {
  return getBaselineStats().filter(s => s.status !== 'normal');
}

function observe(alerts: UnifiedAlert[]): void {
  for (const a of alerts) {
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    bump(a.source, a.timestamp);
  }
  debouncedSave();
}

let started = false;
export function startAnomalyBaselines(): void {
  if (started) return;
  started = true;
  load();
  // Seed with what's already in the store.
  observe(unifiedAlertStore.getAll());
  const _debouncedObserve = debounce(
    (() => observe(unifiedAlertStore.getAll())) as (...args: unknown[]) => void,
    300,
  );
  unifiedAlertStore.subscribe(_debouncedObserve);
  // Periodic prune of seen-ids set to bound memory.
  window.setInterval(() => {
    if (seenIds.size > 5000) seenIds.clear();
  }, 30 * 60_000);
}
