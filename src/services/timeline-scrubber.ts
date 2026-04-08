/**
 * Timeline Scrubber — temporal event store for timeline playback
 *
 * Stores timestamped geo-events sourced from any Crystal Ball panel so the
 * UI can scrub through time, render histograms, and identify spatial hotspots.
 *
 * Deduplication: events of the same type at the same lat/lon within a 1-hour
 * window are collapsed into the first-seen entry.
 *
 * Limits: max 10 000 events. Events older than 7 days are pruned automatically
 * on every add. IDs are generated as `tl-{counter}`.
 *
 * No external dependencies, no network calls. All state is in-memory.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Vocabulary of event categories */
export type TimelineEventType =
  | 'earthquake'
  | 'conflict'
  | 'cyber'
  | 'weather'
  | 'military'
  | 'protest'
  | 'infrastructure'
  | 'nuclear'
  | 'fire'
  | 'airstrike'
  | 'sigint'
  | 'maritime';

/** Severity levels ordered low → critical */
export type TimelineEventSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A single timestamped geo-event */
export interface TimelineEvent {
  /** Auto-generated stable identifier */
  id: string;
  /** Event category */
  type: TimelineEventType;
  /** WGS-84 latitude */
  lat: number;
  /** WGS-84 longitude */
  lon: number;
  /** Unix ms — when the event occurred (caller-supplied, not insertion time) */
  timestamp: number;
  /** Short human-readable title */
  title: string;
  /** Impact / urgency level */
  severity: TimelineEventSeverity;
  /** Originating data source or feed name */
  source: string;
  /** Arbitrary key/value annotations */
  metadata?: Record<string, string>;
}

/** A point-in-time snapshot of active events for playback rendering */
export interface TimelineSnapshot {
  /** The reference timestamp for this snapshot */
  timestamp: number;
  /** Events that fall within the snapshot window */
  events: TimelineEvent[];
  /** Alias for events.length — convenience for display */
  activeCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_EVENTS = 10_000;
const AUTO_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_SNAPSHOT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_BUCKET_MS = 60 * 60 * 1000; // 1 hour
/** Lat/lon grid cell size in degrees for hotspot clustering */
const DEFAULT_GRID_SIZE = 1.0;

// ── State ──────────────────────────────────────────────────────────────────

/** Primary store — insertion order is preserved for fast range scans */
const _events: TimelineEvent[] = [];

/**
 * Dedup index — key: `${type}::${latBucket}::${lonBucket}::${hourBucket}` → true
 * Buckets discretise lat/lon to 0.01° and time to 1-hour windows.
 */
const _dedupKeys = new Set<string>();

let _counter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  _counter += 1;
  return `tl-${_counter}`;
}

function dedupKey(type: TimelineEventType, lat: number, lon: number, timestamp: number): string {
  const latBucket = Math.round(lat * 100);
  const lonBucket = Math.round(lon * 100);
  const hourBucket = Math.floor(timestamp / DEDUP_WINDOW_MS);
  return `${type}::${latBucket}::${lonBucket}::${hourBucket}`;
}

/** Remove events older than AUTO_PRUNE_AGE_MS and rebuild dedup index */
function autoPrune(): void {
  const cutoff = Date.now() - AUTO_PRUNE_AGE_MS;
  let removed = false;
  for (let i = _events.length - 1; i >= 0; i--) {
 const ev = _events[i]!;
 if (ev.timestamp < cutoff) {
 _events.splice(i, 1);
 removed = true;
 }
  }
  if (removed) {
 // Rebuild dedup set from remaining events
 _dedupKeys.clear();
 for (const ev of _events) {
 _dedupKeys.add(dedupKey(ev.type, ev.lat, ev.lon, ev.timestamp));
 }
  }
}

/** Evict the oldest events (by event timestamp) to satisfy MAX_EVENTS */
function evictIfNeeded(): void {
  if (_events.length < MAX_EVENTS) return;
  // Sort by timestamp ascending so splice(0, n) removes the oldest
  _events.sort((a, b) => a.timestamp - b.timestamp);
  const removeCount = Math.ceil(MAX_EVENTS * 0.05); // evict 5 %
  const removed = _events.splice(0, removeCount);
  for (const ev of removed) {
 _dedupKeys.delete(dedupKey(ev.type, ev.lat, ev.lon, ev.timestamp));
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Add a timestamped geo-event. Duplicate events (same type + lat/lon within
 * the 1-hour dedup window) are silently dropped and the existing id is
 * returned. Otherwise returns the new event id.
 */
export function addTimelineEvent(
  type: TimelineEventType,
  lat: number,
  lon: number,
  timestamp: number,
  title: string,
  severity: TimelineEventSeverity,
  source: string,
  metadata?: Record<string, string>,
): string {
  // Auto-prune stale events first
  autoPrune();

  const key = dedupKey(type, lat, lon, timestamp);
  if (_dedupKeys.has(key)) {
 // Find and return the id of the existing event
 const existing = _events.find(
 e =>
 e.type === type &&
 Math.abs(e.lat - lat) < 0.01 &&
 Math.abs(e.lon - lon) < 0.01 &&
 Math.abs(e.timestamp - timestamp) < DEDUP_WINDOW_MS,
 );
 return existing?.id ?? '';
  }

  evictIfNeeded();

  const id = generateId();
  const event: TimelineEvent = {
 id,
 type,
 lat,
 lon,
 timestamp,
 title,
 severity,
 source,
 metadata: metadata ? { ...metadata } : undefined,
  };

  _events.push(event);
  _dedupKeys.add(key);
  return id;
}

/**
 * Returns the earliest and latest event timestamps in the store, or
 * { earliest: 0, latest: 0 } when the store is empty.
 */
export function getTimelineRange(): { earliest: number; latest: number } {
  if (_events.length === 0) return { earliest: 0, latest: 0 };
  let earliest = _events[0]!.timestamp;
  let latest = _events[0]!.timestamp;
  for (const ev of _events) {
 if (ev.timestamp < earliest) earliest = ev.timestamp;
 if (ev.timestamp > latest) latest = ev.timestamp;
  }
  return { earliest, latest };
}

/**
 * Return all events whose timestamp falls within [startMs, endMs] inclusive,
 * sorted by timestamp ascending.
 */
export function getEventsInWindow(startMs: number, endMs: number): TimelineEvent[] {
  return _events
 .filter(e => e.timestamp >= startMs && e.timestamp <= endMs)
 .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Return a snapshot centred on timestamp, including all events within
 * ±(windowMs / 2). Default window is 1 hour.
 */
export function getSnapshot(timestamp: number, windowMs = DEFAULT_SNAPSHOT_WINDOW_MS): TimelineSnapshot {
  const half = windowMs / 2;
  const events = getEventsInWindow(timestamp - half, timestamp + half);
  return { timestamp, events, activeCount: events.length };
}

/**
 * Partition events into fixed-width time buckets and return a histogram
 * suitable for rendering a timeline scrubber bar. Each bucket reports total
 * count and a per-severity breakdown.
 *
 * @param bucketMs  Bucket width in ms (default 1 h)
 * @param startMs Histogram start — defaults to earliest event
 * @param endMs Histogram end — defaults to latest event
 */
export function getTimelineBuckets(
  bucketMs = DEFAULT_BUCKET_MS,
  startMs?: number,
  endMs?: number,
): Array<{ timestamp: number; count: number; bySeverity: Record<TimelineEventSeverity, number> }> {
  if (_events.length === 0) return [];

  const range = getTimelineRange();
  const start = startMs ?? range.earliest;
  const end = endMs ?? range.latest;

  if (start > end) return [];

  const buckets = new Map<number, { count: number; bySeverity: Record<TimelineEventSeverity, number> }>();

  // Pre-create all bucket slots so empty ones appear in output
  for (let t = Math.floor(start / bucketMs) * bucketMs; t <= end; t += bucketMs) {
 buckets.set(t, { count: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } });
  }

  for (const ev of _events) {
 if (ev.timestamp < start || ev.timestamp > end) continue;
 const bucketTs = Math.floor(ev.timestamp / bucketMs) * bucketMs;
 const bucket = buckets.get(bucketTs);
 if (!bucket) continue;
 bucket.count += 1;
 bucket.bySeverity[ev.severity] += 1;
  }

  return Array.from(buckets.entries())
 .sort(([a], [b]) => a - b)
 .map(([timestamp, data]) => ({ timestamp, ...data }));
}

/**
 * Spatial clustering over a time range. Events are snapped to a lat/lon grid
 * (default 1°×1° cells) and aggregated. Returns cells sorted by count
 * descending.
 *
 * @param startMs Range start (inclusive)
 * @param endMs Range end (inclusive)
 * @param gridSize  Grid cell size in degrees (default 1.0)
 */
export function getHotspots(
  startMs: number,
  endMs: number,
  gridSize = DEFAULT_GRID_SIZE,
): Array<{ lat: number; lon: number; count: number; types: Set<TimelineEventType> }> {
  const eventsInRange = getEventsInWindow(startMs, endMs);
  const cellMap = new Map<string, { lat: number; lon: number; count: number; types: Set<TimelineEventType> }>();

  for (const ev of eventsInRange) {
 const cellLat = Math.round(ev.lat / gridSize) * gridSize;
 const cellLon = Math.round(ev.lon / gridSize) * gridSize;
 const cellKey = `${cellLat}::${cellLon}`;

 let cell = cellMap.get(cellKey);
 if (!cell) {
 cell = { lat: cellLat, lon: cellLon, count: 0, types: new Set() };
 cellMap.set(cellKey, cell);
 }
 cell.count += 1;
 cell.types.add(ev.type);
  }

  return Array.from(cellMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * Remove all events whose timestamp is older than ageMs milliseconds from now.
 * Rebuilds the dedup index after pruning.
 */
export function pruneOlderThan(ageMs: number): void {
  const cutoff = Date.now() - ageMs;
  let i = _events.length;
  let removed = false;
  while (i--) {
 if (_events[i]!.timestamp < cutoff) {
 _events.splice(i, 1);
 removed = true;
 }
  }
  if (removed) {
 _dedupKeys.clear();
 for (const ev of _events) {
 _dedupKeys.add(dedupKey(ev.type, ev.lat, ev.lon, ev.timestamp));
 }
  }
}

/** Total number of events currently in the store */
export function getEventCount(): number {
  return _events.length;
}
