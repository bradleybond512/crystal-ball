/**
 * Source reliability leaderboard — tracks per-source prediction accuracy
 * over a rolling 7-day window. Ranks sources from most to least reliable.
 */

import type { AlertSource } from './unified-alerts';
import { getRecalMult } from './severity-recalibration';
import { getSourceTrust } from './source-trust';
import { getSourceFeedbackMult } from './source-feedback';

const STORAGE_KEY = 'crystalball-source-reliability-v1';

interface SourceRecord {
  source: AlertSource;
  correctPredictions: number;
  totalPredictions: number;
  dailySnapshots: { date: string; accuracy: number }[];
}

const records = new Map<string, SourceRecord>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, SourceRecord>;
    for (const [k, v] of Object.entries(obj)) records.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, SourceRecord> = {};
  for (const [k, v] of records) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

/** Record whether a source's alert was validated or not. */
export function recordSourceReliability(source: AlertSource, correct: boolean): void {
  const rec = records.get(source) ?? { source, correctPredictions: 0, totalPredictions: 0, dailySnapshots: [] };
  rec.totalPredictions++;
  if (correct) rec.correctPredictions++;
  records.set(source, rec);
  save();
}

export interface ReliabilityEntry {
  source: AlertSource;
  accuracy: number;
  total: number;
  trend: 'up' | 'down' | 'stable';
  compositeTrust: number;
}

/** Get the leaderboard sorted by composite trust (reliability + trust + feedback). */
export function getReliabilityLeaderboard(): ReliabilityEntry[] {
  const entries: ReliabilityEntry[] = [];

  for (const [source, rec] of records) {
    if (rec.totalPredictions < 3) continue;
    const accuracy = rec.correctPredictions / rec.totalPredictions;
    const snapshots = rec.dailySnapshots;
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (snapshots.length >= 2) {
      const recent = snapshots[snapshots.length - 1]!.accuracy;
      const prev = snapshots[snapshots.length - 2]!.accuracy;
      if (recent - prev > 0.05) trend = 'up';
      else if (prev - recent > 0.05) trend = 'down';
    }

    const baseTrust = getSourceTrust(source as AlertSource);
    const feedback = getSourceFeedbackMult(source as AlertSource);
    const recal = getRecalMult(source as AlertSource);
    const compositeTrust = accuracy * 0.4 + baseTrust * 0.3 + feedback * recal * 0.3;

    entries.push({
      source: source as AlertSource,
      accuracy: Math.round(accuracy * 100),
      total: rec.totalPredictions,
      trend,
      compositeTrust,
    });
  }

  return entries.sort((a, b) => b.compositeTrust - a.compositeTrust);
}

/** Take a daily snapshot for trend tracking. */
export function snapshotDaily(): void {
  const today = new Date().toISOString().slice(0, 10);
  for (const rec of records.values()) {
    if (rec.totalPredictions === 0) continue;
    const accuracy = rec.correctPredictions / rec.totalPredictions;
    if (rec.dailySnapshots.length > 0 && rec.dailySnapshots[rec.dailySnapshots.length - 1]!.date === today) continue;
    rec.dailySnapshots.push({ date: today, accuracy });
    if (rec.dailySnapshots.length > 7) rec.dailySnapshots.shift();
  }
  save();
}

export function initSourceReliability(): void {
  load();
}
