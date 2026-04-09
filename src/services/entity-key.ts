/* eslint-disable sonarjs/void-use */
/**
 * Entity canonicalization — collapses different feeds reporting the same
 * real-world event into a single key. Two alerts with the same canonical key
 * are the same event regardless of feed.
 *
 * Strategy: round coordinates to a coarse cell (~25km), bucket time to the
 * nearest 30 minutes, normalize the event-type from the source category.
 * It's a heuristic — perfect dedup would need entity NER. This catches the
 * easy 80%.
 */

import type { UnifiedAlert, AlertSource } from './unified-alerts';

const COORD_CELL_DEG = 0.25;       // ~28 km at the equator
const TIME_BUCKET_MS = 30 * 60_000;

const SOURCE_EVENT_TYPE: Record<AlertSource, string> = {
  'breaking-news': 'news',
  'nws': 'weather',
  'gdacs': 'disaster',
  'tsunami': 'tsunami',
  'volcano': 'volcano',
  'oref': 'rocket',
  'hazard': 'hazard',
  'correlation': 'meta',
  'cyber': 'cyber',
  'resource': 'infrastructure',
  'local-ids': 'cyber',
  'earthquake': 'earthquake',
  'fire': 'fire',
  'cyclone': 'cyclone',
  'power-grid': 'infrastructure',
  'comms-health': 'infrastructure',
  'space-weather': 'space-weather',
  'spc': 'weather',
  'disease': 'health',
  'maritime': 'maritime',
  'travel-advisory': 'travel',
  'radiation': 'radiation',
  'air-quality': 'air-quality',
  'aviation-hazard': 'aviation',
};

export function canonicalEntityKey(a: UnifiedAlert): string {
  const evt = SOURCE_EVENT_TYPE[a.source] ?? 'unknown';
  const tBucket = Math.floor(a.timestamp / TIME_BUCKET_MS);
  if (a.location) {
    const lat = Math.round(a.location.lat / COORD_CELL_DEG);
    const lon = Math.round(a.location.lon / COORD_CELL_DEG);
    return `${evt}:${lat}:${lon}:${tBucket}`;
  }
  // No coords — fall back to normalized title head + time bucket.
  const head = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40);
  return `${evt}:${head}:${tBucket}`;
}

/** Group an alert list by canonical entity. The first alert in each group is the leader. */
export function groupByEntity(alerts: UnifiedAlert[]): Map<string, UnifiedAlert[]> {
  const map = new Map<string, UnifiedAlert[]>();
  for (const a of alerts) {
    const k = canonicalEntityKey(a);
    const arr = map.get(k) ?? [];
    arr.push(a);
    map.set(k, arr);
  }
  return map;
}
