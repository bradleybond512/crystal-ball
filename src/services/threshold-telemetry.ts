const STORAGE_KEY = 'crystalball-threshold-telemetry-v1';
const MAX_EVENTS = 500;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NEAR_MISS_RATIO = 0.8;

export interface ThresholdEvent {
  thresholdId: string;
  value: number;
  threshold: number;
  crossed: boolean;
  timestamp: number;
}

export interface ThresholdStats {
  thresholdId: string;
  crossings: number;
  nearMisses: number;
  avgValueAtCrossing: number;
  lastCrossed: number;
}

function loadEvents(): ThresholdEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ThresholdEvent[];
  } catch {
    return [];
  }
}

function saveEvents(events: ThresholdEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function pruneOldEvents(events: ThresholdEvent[]): ThresholdEvent[] {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  return events.filter(e => e.timestamp >= cutoff);
}

export function recordThresholdCheck(thresholdId: string, value: number, threshold: number): void {
  const crossed = value >= threshold;
  const isNearMiss = !crossed && value >= threshold * NEAR_MISS_RATIO;

  if (!crossed && !isNearMiss) return;

  let events = pruneOldEvents(loadEvents());

  events.push({
    thresholdId,
    value,
    threshold,
    crossed,
    timestamp: Date.now(),
  });

  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }

  saveEvents(events);
}

export function getThresholdStats(thresholdId?: string): ThresholdStats[] {
  const events = pruneOldEvents(loadEvents());
  const grouped = new Map<string, ThresholdEvent[]>();

  for (const e of events) {
    if (thresholdId !== undefined && e.thresholdId !== thresholdId) continue;
    let bucket = grouped.get(e.thresholdId);
    if (!bucket) {
      bucket = [];
      grouped.set(e.thresholdId, bucket);
    }
    bucket.push(e);
  }

  const stats: ThresholdStats[] = [];
  for (const [id, bucket] of grouped) {
    const crossings = bucket.filter(e => e.crossed);
    const nearMisses = bucket.filter(e => !e.crossed);
    const sumAtCrossing = crossings.reduce((s, e) => s + e.value, 0);
    const lastCrossed = crossings.reduce((max, e) => Math.max(max, e.timestamp), 0);

    stats.push({
      thresholdId: id,
      crossings: crossings.length,
      nearMisses: nearMisses.length,
      avgValueAtCrossing: crossings.length > 0 ? sumAtCrossing / crossings.length : 0,
      lastCrossed,
    });
  }

  return stats;
}

export function resetThresholdTelemetry(): void {
  localStorage.removeItem(STORAGE_KEY);
}
