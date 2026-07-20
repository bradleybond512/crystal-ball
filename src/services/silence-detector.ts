 
/**
 * Silence detector — flags feeds that have gone unusually quiet.
 *
 * For each source we keep a rolling estimate of the typical inter-event
 * interval (EWMA). If the time since the last event exceeds 3× that
 * estimate AND the typical interval was short enough to matter (< 6h),
 * we synthesize a low-severity "Silence" alert. Sustained silence on a
 * normally-noisy feed often means upstream outage, blackout, or censorship
 * — itself useful intel.
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSource } from './unified-alerts';
import { formatDurationMinutes } from '@/utils/format-duration';

const SCAN_INTERVAL_MS = 60_000;
const ALPHA = 0.3;                       // EWMA weight on new samples
const SILENCE_RATIO = 3;                 // current gap must exceed N× normal
const MAX_NORMAL_INTERVAL_MS = 6 * 3_600_000; // ignore feeds that are normally rare anyway
const MIN_SAMPLES = 4;

interface FeedStats {
  lastTimestamp: number;
  ewmaIntervalMs: number;
  samples: number;
  silenceFiredAt: number | null;
}

const stats = new Map<AlertSource, FeedStats>();
const seenIds = new Set<string>();

function update(a: UnifiedAlert): void {
  const cur = stats.get(a.source);
  if (!cur) {
    stats.set(a.source, {
      lastTimestamp: a.timestamp,
      ewmaIntervalMs: 0,
      samples: 1,
      silenceFiredAt: null,
    });
    return;
  }
  const dt = Math.max(0, a.timestamp - cur.lastTimestamp);
  if (dt > 0) {
    cur.ewmaIntervalMs = cur.ewmaIntervalMs === 0
      ? dt
      : (ALPHA * dt) + ((1 - ALPHA) * cur.ewmaIntervalMs);
  }
  cur.lastTimestamp = a.timestamp;
  cur.samples += 1;
  // If we previously fired a silence alert and the feed is back, clear it.
  if (cur.silenceFiredAt !== null) cur.silenceFiredAt = null;
}

function ingestNew(): void {
  for (const a of unifiedAlertStore.getAll()) {
    if (a.source === 'correlation') continue;
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    update(a);
  }
}

function scan(): void {
  ingestNew();
  const now = Date.now();
  const synthetic: UnifiedAlert[] = [];
  for (const [source, s] of stats) {
    if (s.samples < MIN_SAMPLES) continue;
    if (s.ewmaIntervalMs <= 0 || s.ewmaIntervalMs > MAX_NORMAL_INTERVAL_MS) continue;
    const gap = now - s.lastTimestamp;
    if (gap < s.ewmaIntervalMs * SILENCE_RATIO) continue;
    // Don't re-fire within 1 hour.
    if (s.silenceFiredAt !== null && now - s.silenceFiredAt < 3_600_000) continue;
    s.silenceFiredAt = now;

    const normalLabel = formatDurationMinutes(s.ewmaIntervalMs / 60_000);
    const gapLabel = formatDurationMinutes(gap / 60_000);
    synthetic.push({
      id: `silence-${source}-${Math.floor(now / 3_600_000)}`,
      source: 'correlation',
      severity: 'low',
      title: `Silence: ${source} feed quiet for ${gapLabel}`,
      body: `Normally fires every ~${normalLabel}. ${gapLabel} since last event — possible outage, blackout, or upstream failure.`,
      timestamp: now,
      relevanceScore: 50,
      acknowledged: false,
      pinned: false,
    });
  }
  if (synthetic.length > 0) unifiedAlertStore.ingest(synthetic);
}

let started = false;
export function startSilenceDetector(): void {
  if (started) return;
  started = true;
  // Seed from existing alerts so we don't immediately false-fire.
  for (const a of unifiedAlertStore.getAll()) {
    seenIds.add(a.id);
    update(a);
  }
  unifiedAlertStore.subscribe(ingestNew);
  window.setInterval(scan, SCAN_INTERVAL_MS);
}
