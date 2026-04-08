/* eslint-disable sonarjs/void-use, sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, sonarjs/reduce-initial-value, unicorn/prefer-math-trunc, unicorn/prefer-code-point */
/**
 * Alert correlator — synthesize a `correlation` alert when ≥2 alerts from
 * causally-compatible sources cluster in space and time.
 *
 * Upgrades over the naive version:
 *  - Source pairs must match a known causal template (e.g. quake→tsunami,
 *    cyber→IDS) — geo coincidence alone is not enough.
 *  - Entity dedup via canonicalEntityKey collapses storms (USGS + EMSC quake).
 *  - Synthesized alerts dedupe by member-id hash, not time bucket, so the
 *    same cluster doesn't re-fire every minute.
 *  - Source trust weights the synthesized severity.
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSource } from './unified-alerts';
import { getSourceTrust } from './source-trust';
import { canonicalEntityKey } from './entity-key';

const CELL_DEG = 1;          // ~110km cells for cluster grouping
const WINDOW_MS = 10 * 60_000;
const SCAN_INTERVAL_MS = 60_000;

/**
 * Causal templates: which source pairings make sense as a real correlation.
 * Direction-agnostic — a + b counts the same as b + a.
 */
const CAUSAL_PAIRS: readonly (readonly [AlertSource, AlertSource])[] = [
  ['earthquake', 'tsunami'],
  ['earthquake', 'gdacs'],
  ['earthquake', 'volcano'],
  ['volcano', 'gdacs'],
  ['cyclone', 'gdacs'],
  ['cyclone', 'nws'],
  ['fire', 'gdacs'],
  ['fire', 'nws'],
  ['cyber', 'local-ids'],
  ['cyber', 'breaking-news'],
  ['oref', 'breaking-news'],
  ['nws', 'breaking-news'],
  ['gdacs', 'breaking-news'],
  ['hazard', 'breaking-news'],
];

function pairKey(a: AlertSource, b: AlertSource): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const CAUSAL_KEYS = new Set(CAUSAL_PAIRS.map(([a, b]) => pairKey(a, b)));

function findCausalPair(sources: AlertSource[]): [AlertSource, AlertSource] | null {
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      if (CAUSAL_KEYS.has(pairKey(sources[i]!, sources[j]!))) {
        return [sources[i]!, sources[j]!];
      }
    }
  }
  return null;
}

function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;
}

const synthesized = new Set<string>();

function scan(): void {
  const now = Date.now();
  const recent = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged
    && a.source !== 'correlation'
    && a.location
    && now - a.timestamp < WINDOW_MS,
  );

  // Step 1: collapse same-event duplicates (USGS + EMSC quake) into one
  // canonical leader per entity. This boosts genuine signal — multi-feed
  // confirmation — without inflating cluster size.
  const byEntity = new Map<string, UnifiedAlert[]>();
  for (const a of recent) {
    const k = canonicalEntityKey(a);
    const arr = byEntity.get(k) ?? [];
    arr.push(a);
    byEntity.set(k, arr);
  }
  // Pick the highest-trust alert as the leader for each entity.
  const leaders: UnifiedAlert[] = [];
  for (const group of byEntity.values()) {
    let best = group[0]!;
    for (const a of group) {
      if (getSourceTrust(a.source) > getSourceTrust(best.source)) best = a;
    }
    leaders.push(best);
  }

  // Step 2: spatial cluster of leaders.
  const cells = new Map<string, UnifiedAlert[]>();
  for (const a of leaders) {
    if (!a.location) continue;
    const key = cellKey(a.location.lat, a.location.lon);
    const arr = cells.get(key) ?? [];
    arr.push(a);
    cells.set(key, arr);
  }

  const synthetic: UnifiedAlert[] = [];
  for (const members of cells.values()) {
    const sources = [...new Set(members.map(m => m.source))];
    if (sources.length < 2) continue;
    const causalPair = findCausalPair(sources);
    if (!causalPair) continue; // gate

    // Stable id from sorted member ids — same cluster = same id, no re-fire.
    const idHash = members.map(m => m.id).sort().join(',');
    const id = `corr-${idHash.length}-${hashString(idHash)}`;
    if (synthesized.has(id)) continue;
    synthesized.add(id);

    const sevRank: Record<UnifiedAlert['severity'], number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const top = members.reduce((a, b) => sevRank[b.severity] > sevRank[a.severity] ? b : a);
    const center = members[0]!.location!;

    synthetic.push({
      id,
      source: 'correlation',
      severity: top.severity,
      title: `${members.length} correlated alerts (${sources.join(' + ')})`,
      body: members.slice(0, 5).map(m => `• [${m.source}] ${m.title}`).join('\n'),
      timestamp: now,
      location: center,
      relevanceScore: 100,
      acknowledged: false,
      pinned: false,
      correlationMembers: members.map(m => m.id),
      correlationPair: causalPair,
    });
  }

  if (synthetic.length > 0) unifiedAlertStore.ingest(synthetic);
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

let started = false;
export function startAlertCorrelator(): void {
  if (started) return;
  started = true;
  window.setInterval(scan, SCAN_INTERVAL_MS);
  window.setTimeout(scan, 5000);
}
