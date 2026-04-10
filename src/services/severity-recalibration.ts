/**
 * Auto-severity recalibration — adjusts per-source scoring multipliers
 * based on forecast accuracy data and negative evidence decay rates.
 *
 * Sources that produce many false positives get downweighted;
 * sources with high accuracy get boosted. Runs every 10 minutes.
 */

import type { AlertSource } from './unified-alerts';
import { getForecastAccuracy } from './forecast-accuracy';

const STORAGE_KEY = 'crystalball-severity-recal-v1';
const RECAL_MS = 10 * 60_000;

interface SourceRecal {
  hitCount: number;
  missCount: number;
  multiplier: number;
}

const recalMap = new Map<string, SourceRecal>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SourceRecal>;
    for (const [k, v] of Object.entries(obj)) recalMap.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, SourceRecal> = {};
  for (const [k, v] of recalMap) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

function recalibrate(): void {
  const accuracy = getForecastAccuracy();
  if (accuracy.totalPredictions < 5) return;

  const globalAccuracy = accuracy.accuracy / 100;
  const globalMult = 0.8 + globalAccuracy * 0.4;

  for (const [, entry] of recalMap) {
    const total = entry.hitCount + entry.missCount;
    if (total < 3) { entry.multiplier = 1; continue; }
    const sourceAccuracy = entry.hitCount / total;
    entry.multiplier = Math.max(0.6, Math.min(1.4, 0.7 + sourceAccuracy * 0.7));
  }

  if (globalMult < 0.9) {
    for (const entry of recalMap.values()) {
      entry.multiplier = Math.max(0.6, entry.multiplier * 0.95);
    }
  }

  save();
}

/** Record a hit or miss for a specific source. */
export function recordSourceOutcome(source: AlertSource, hit: boolean): void {
  let entry = recalMap.get(source);
  if (!entry) { entry = { hitCount: 0, missCount: 0, multiplier: 1 }; recalMap.set(source, entry); }
  if (hit) entry.hitCount++; else entry.missCount++;
}

/** Get the recalibrated multiplier for a source. */
export function getRecalMult(source: AlertSource): number {
  return recalMap.get(source)?.multiplier ?? 1;
}

let started = false;
export function startSeverityRecalibration(): void {
  if (started) return;
  started = true;
  load();
  window.setTimeout(recalibrate, 30_000);
  window.setInterval(recalibrate, RECAL_MS);
}
