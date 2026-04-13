/* eslint-disable sonarjs/void-use, sonarjs/cognitive-complexity */
/**
 * Pair discovery — logs observed (sourceA, sourceB) co-occurrences within
 * a loose spatiotemporal window. Does NOT act on them; surfaces top
 * candidates for the developer to promote into CAUSAL_RULES.
 *
 * Read via `getTopPairCandidates()` from the console or Cmd+K.
 */

import type { UnifiedAlert, AlertSource } from './unified-alerts';
import { computeDistanceKm } from './unified-alerts';

const STORAGE_KEY = 'crystalball-pair-discovery-v1';
const WINDOW_MS = 15 * 60_000;
const RADIUS_KM = 300;
const MAX_PAIRS = 200;

interface PairStat { count: number; lastSeen: number; }
const counts = new Map<string, PairStat>();

function key(a: AlertSource, b: AlertSource): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, PairStat>;
    for (const [k, v] of Object.entries(obj)) counts.set(k, v);
  } catch { /* noop */ }
}
function save(): void {
  const obj: Record<string, PairStat> = {};
  // Keep top MAX_PAIRS by count.
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, MAX_PAIRS);
  for (const [k, v] of sorted) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

let loaded = false;
export function recordCoOccurrence(leaders: UnifiedAlert[]): void {
  if (!loaded) { load(); loaded = true; }
  const now = Date.now();
  let changed = false;
  for (let i = 0; i < leaders.length; i++) {
    const a = leaders[i]!;
    if (!a.location) continue;
    for (let j = i + 1; j < leaders.length; j++) {
      const b = leaders[j]!;
      if (!b.location) continue;
      if (a.source === b.source) continue;
      if (Math.abs(a.timestamp - b.timestamp) > WINDOW_MS) continue;
      const d = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
      if (d > RADIUS_KM) continue;
      const k = key(a.source, b.source);
      const cur = counts.get(k) ?? { count: 0, lastSeen: 0 };
      cur.count += 1;
      cur.lastSeen = now;
      counts.set(k, cur);
      changed = true;
    }
  }
  if (changed) save();
}

export function getTopPairCandidates(limit = 20): { pair: string; count: number; lastSeen: number }[] {
  if (!loaded) { load(); loaded = true; }
  return [...counts.entries()]
    .map(([pair, s]) => ({ pair, count: s.count, lastSeen: s.lastSeen }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
