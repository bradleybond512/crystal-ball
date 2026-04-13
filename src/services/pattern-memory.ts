/**
 * Pattern memory — detects recurring source-pair sequences from the
 * correlator's history and surfaces predictions when the leading
 * signal fires again.
 *
 * Tracks cause→effect pairs and their hit rates. When a cause fires
 * and the pair has ≥3 historical hits with ≥60% hit rate, emits a
 * `cb:pattern-prediction` event.
 */

import { unifiedAlertStore, type AlertSource } from './unified-alerts';

const STORAGE_KEY = 'crystalball-pattern-memory-v1';
const SCAN_MS = 2 * 60_000;
const MIN_HITS = 3;
const MIN_HIT_RATE = 0.6;
const PREDICTION_COOLDOWN_MS = 30 * 60_000;

interface PairMemory {
  cause: AlertSource;
  effect: AlertSource;
  hits: number;
  misses: number;
  avgLagMs: number;
  lastPredictionTs: number;
}

const memory = new Map<string, PairMemory>();

function pairKey(cause: AlertSource, effect: AlertSource): string {
  return `${cause}|${effect}`;
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, PairMemory>;
    for (const [k, v] of Object.entries(obj)) memory.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, PairMemory> = {};
  for (const [k, v] of memory) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

/** Record a confirmed cause→effect correlation hit. */
export function recordPatternHit(cause: AlertSource, effect: AlertSource, lagMs: number): void {
  const k = pairKey(cause, effect);
  const entry = memory.get(k) ?? { cause, effect, hits: 0, misses: 0, avgLagMs: 0, lastPredictionTs: 0 };
  entry.avgLagMs = (entry.avgLagMs * entry.hits + lagMs) / (entry.hits + 1);
  entry.hits++;
  memory.set(k, entry);
  save();
}

/** Record a cause that fired without the expected effect. */
export function recordPatternMiss(cause: AlertSource, effect: AlertSource): void {
  const k = pairKey(cause, effect);
  const entry = memory.get(k);
  if (entry) { entry.misses++; save(); }
}

/** Get all learned patterns with hit rate above threshold. */
export function getLearnedPatterns(): PairMemory[] {
  return [...memory.values()]
    .filter(p => p.hits >= MIN_HITS && p.hits / (p.hits + p.misses) >= MIN_HIT_RATE)
    .sort((a, b) => b.hits - a.hits);
}

function scan(): void {
  const now = Date.now();
  const recent = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged && now - a.timestamp < 10 * 60_000,
  );

  for (const alert of recent) {
    for (const pattern of getLearnedPatterns()) {
      if (alert.source !== pattern.cause) continue;
      if (now - pattern.lastPredictionTs < PREDICTION_COOLDOWN_MS) continue;

      const hitRate = pattern.hits / (pattern.hits + pattern.misses);
      pattern.lastPredictionTs = now;
      save();

      document.dispatchEvent(new CustomEvent('cb:pattern-prediction', {
        detail: {
          cause: pattern.cause,
          effect: pattern.effect,
          probability: Math.round(hitRate * 100),
          expectedLagMin: Math.round(pattern.avgLagMs / 60_000),
          triggerAlertId: alert.id,
        },
      }));
    }
  }
}

let started = false;
export function startPatternMemory(): void {
  if (started) return;
  started = true;
  load();
  window.setTimeout(scan, 15_000);
  window.setInterval(scan, SCAN_MS);
}
