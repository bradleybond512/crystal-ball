/**
 * Periodicity detector — identifies sources that fire at regular
 * intervals and flags when a periodic source misses its expected window.
 */

import { unifiedAlertStore, type AlertSource } from './unified-alerts';
import { logDebug } from './reasoning-debug';

const STORAGE_KEY = 'crystalball-periodicity-v1';
const SCAN_INTERVAL = 5 * 60_000;
const MIN_SAMPLES = 5;
const CV_THRESHOLD = 0.3;

interface PeriodicityRecord {
  source: AlertSource;
  intervals: number[];
  meanIntervalMs: number;
  lastSeen: number;
}

const records = new Map<string, PeriodicityRecord>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, PeriodicityRecord>;
    for (const [k, v] of Object.entries(obj)) records.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, PeriodicityRecord> = {};
  for (const [k, v] of records) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

function updateRecords(): void {
  const alerts = unifiedAlertStore.getAll();
  const bySource = new Map<string, number[]>();
  for (const a of alerts) {
    const arr = bySource.get(a.source) ?? [];
    arr.push(a.timestamp);
    bySource.set(a.source, arr);
  }

  for (const [source, timestamps] of bySource) {
    if (timestamps.length < MIN_SAMPLES) continue;
    timestamps.sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i]! - timestamps[i - 1]!);
    }
    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    records.set(source, {
      source: source as AlertSource,
      intervals: intervals.slice(-20),
      meanIntervalMs: mean,
      lastSeen: timestamps[timestamps.length - 1]!,
    });
  }
  save();
}

function checkForMissedBeats(): void {
  const now = Date.now();
  for (const rec of records.values()) {
    if (rec.intervals.length < MIN_SAMPLES) continue;
    const mean = rec.meanIntervalMs;
    const stddev = Math.sqrt(
      rec.intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / rec.intervals.length,
    );
    const cv = stddev / mean;
    if (cv > CV_THRESHOLD) continue;

    const elapsed = now - rec.lastSeen;
    if (elapsed > mean * 1.5 && elapsed > mean + stddev * 2) {
      document.dispatchEvent(new CustomEvent('cb:missed-beat', {
        detail: {
          source: rec.source,
          expectedIntervalMin: Math.round(mean / 60_000),
          silenceMin: Math.round(elapsed / 60_000),
        },
      }));
    }
  }
}

export interface PeriodicSource {
  source: AlertSource;
  meanIntervalMin: number;
  cv: number;
  lastSeenAgoMin: number;
  overdue: boolean;
}

export function getPeriodicSources(): PeriodicSource[] {
  const now = Date.now();
  const results: PeriodicSource[] = [];
  for (const rec of records.values()) {
    if (rec.intervals.length < MIN_SAMPLES) continue;
    const mean = rec.meanIntervalMs;
    const stddev = Math.sqrt(
      rec.intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / rec.intervals.length,
    );
    const cv = stddev / mean;
    if (cv > CV_THRESHOLD) continue;
    const elapsed = now - rec.lastSeen;
    results.push({
      source: rec.source,
      meanIntervalMin: Math.round(mean / 60_000),
      cv: Math.round(cv * 100) / 100,
      lastSeenAgoMin: Math.round(elapsed / 60_000),
      overdue: elapsed > mean * 1.5,
    });
  }
  return results.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || a.cv - b.cv);
}

function scan(): void {
  updateRecords();
  checkForMissedBeats();
}

function safeScan(): void {
  try { scan(); } catch (error) {
    logDebug({ level: 'warn', category: 'other', source: 'periodicity-detector', message: 'scan error', data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

let started = false;
export function startPeriodicityDetector(): void {
  if (started) return;
  started = true;
  load();
  window.setInterval(safeScan, SCAN_INTERVAL);
  window.setTimeout(safeScan, 30_000);
}
