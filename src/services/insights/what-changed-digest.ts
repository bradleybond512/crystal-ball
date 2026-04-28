/**
 * What Changed Digest — per
 * docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md sections 4 + 13
 * and PR 2 (lines 379-388).
 *
 * The plan's worked example (lines 89-97):
 *   Since you last checked:
 *   - Iran escalation risk rose from 48 -> 71
 *   - Diesel stress risk rose from Watch -> Elevated
 *   - Hurricane track shifted 90 miles west
 *   - Two sources now confirm the port closure
 *   - No tsunami bulletin appeared, lowering quake cascade risk
 *
 * This module compares two sets of SituationSnapshots and emits a list
 * of human-readable change lines, each tagged with delta direction,
 * magnitude, and (when applicable) a category bucket so the digest
 * UI can group by domain.
 *
 * Pure deterministic. No DOM, no fetch.
 *
 * Plan invariant: "Digests should summarize meaning, not dump alerts."
 * The output here is heavily filtered — only meaningful deltas appear.
 */

import type { SituationSnapshot } from './change-memory';

// ── Public types ─────────────────────────────────────────────────────────

export type ChangeKind =
  | 'new'                    // situation didn't exist before
  | 'cleared'                // existed before, gone now
  | 'score_rose'             // numeric score increased meaningfully
  | 'score_fell'             // numeric score decreased meaningfully
  | 'tier_escalated'         // categorical tier moved up
  | 'tier_de_escalated'      // categorical tier moved down
  | 'sources_confirming'     // new providers attested
  | 'sources_lost'           // providers stopped attesting
  | 'meta_changed';          // free-form meta delta (e.g. centroid shift)

export interface ChangeLine {
  /** The id of the situation that changed. Same id appears across
   *  multiple change kinds when several aspects shifted. */
  id: string;
  kind: ChangeKind;
  /** One-line summary suitable for direct UI display. */
  text: string;
  /** Numeric magnitude of the change when meaningful (score delta,
   *  source count delta, distance shift). */
  magnitude?: number;
  /** Polarity from the user's perspective. 'worse' = situation has
   *  deteriorated; 'better' = improved; 'neutral' = informational. */
  polarity: 'worse' | 'better' | 'neutral';
  /** Display category (passes through from snapshot.category) for
   *  digest grouping. */
  category: string;
  /** Sort weight: 1 = most prominent. Lower = higher priority. */
  weight: number;
}

export interface DigestOptions {
  /** Minimum numeric score delta to surface. Default 10. Smaller
   *  fluctuations are noise. */
  scoreDeltaThreshold?: number;
  /** Maximum lines to emit. Default 20. Older or smaller deltas
   *  are dropped first. */
  maxLines?: number;
  /** When set, drop changes for snapshots whose recordedAt is older
   *  than this cutoff. */
  freshAfter?: number;
  /** Tier ordering used to detect escalation/de-escalation. The
   *  comparison is index-based: items earlier in the array are
   *  considered LOWER tiers. Default matches the insights plan's
   *  Situation Severity Tiers (FYI < Watch < Elevated < Critical <
   *  Emergency). */
  tierOrder?: readonly string[];
}

const DEFAULT_TIER_ORDER: readonly string[] = ['fyi', 'watch', 'elevated', 'critical', 'emergency'];

// ── Top-level diff ───────────────────────────────────────────────────────

export function computeDigest(
  previous: readonly SituationSnapshot[],
  current: readonly SituationSnapshot[],
  options: DigestOptions = {},
): ChangeLine[] {
  const opts = {
    scoreDeltaThreshold: options.scoreDeltaThreshold ?? 10,
    maxLines: options.maxLines ?? 20,
    freshAfter: options.freshAfter,
    tierOrder: (options.tierOrder ?? DEFAULT_TIER_ORDER).map((t) => t.toLowerCase()),
  };

  const prevById = indexById(previous);
  const currById = indexById(current);
  const lines: ChangeLine[] = [];

  collectAppearances(lines, current, prevById, opts.tierOrder);
  collectClearances(lines, previous, currById, opts.tierOrder);
  collectCommonDeltas(lines, current, prevById, opts);

  const filtered = filterByFreshness(lines, currById, prevById, opts.freshAfter);
  // Sort: weight asc (lower = more prominent), then magnitude desc.
  filtered.sort((a, b) => a.weight - b.weight || (b.magnitude ?? 0) - (a.magnitude ?? 0));
  if (filtered.length > opts.maxLines) filtered.length = opts.maxLines;
  return filtered;
}

function collectAppearances(
  lines: ChangeLine[],
  current: readonly SituationSnapshot[],
  prevById: Map<string, SituationSnapshot>,
  tierOrder: readonly string[],
): void {
  for (const c of current) {
    if (prevById.has(c.id)) continue;
    const tierIdx = c.tier ? tierOrder.indexOf(c.tier.toLowerCase()) : -1;
    lines.push({
      id: c.id,
      kind: 'new',
      text: `New: ${c.title}`,
      polarity: tierIdx >= 2 ? 'worse' : 'neutral',
      category: c.category,
      weight: 2,
    });
  }
}

function collectClearances(
  lines: ChangeLine[],
  previous: readonly SituationSnapshot[],
  currById: Map<string, SituationSnapshot>,
  tierOrder: readonly string[],
): void {
  for (const p of previous) {
    if (currById.has(p.id)) continue;
    // Only surface "cleared" for situations that mattered.
    const tierIdx = p.tier ? tierOrder.indexOf(p.tier.toLowerCase()) : -1;
    if (tierIdx < 2) continue;
    lines.push({
      id: p.id,
      kind: 'cleared',
      text: `Cleared: ${p.title}`,
      polarity: 'better',
      category: p.category,
      weight: 5,
    });
  }
}

function collectCommonDeltas(
  lines: ChangeLine[],
  current: readonly SituationSnapshot[],
  prevById: Map<string, SituationSnapshot>,
  opts: { scoreDeltaThreshold: number; tierOrder: readonly string[] },
): void {
  for (const c of current) {
    const p = prevById.get(c.id);
    if (!p) continue;
    addScoreDelta(lines, p, c, opts.scoreDeltaThreshold);
    addTierDelta(lines, p, c, opts.tierOrder);
    addSourceDelta(lines, p, c);
    addMetaDelta(lines, p, c);
  }
}

function filterByFreshness(
  lines: ChangeLine[],
  currById: Map<string, SituationSnapshot>,
  prevById: Map<string, SituationSnapshot>,
  freshAfter: number | undefined,
): ChangeLine[] {
  if (typeof freshAfter !== 'number') return lines;
  return lines.filter((l) => {
    const snap = currById.get(l.id) ?? prevById.get(l.id);
    return snap ? snap.recordedAt >= freshAfter : true;
  });
}

// ── Per-axis delta functions ────────────────────────────────────────────

function addScoreDelta(
  lines: ChangeLine[],
  prev: SituationSnapshot,
  curr: SituationSnapshot,
  threshold: number,
): void {
  const delta = curr.score - prev.score;
  if (Math.abs(delta) < threshold) return;
  const rose = delta > 0;
  lines.push({
    id: curr.id,
    kind: rose ? 'score_rose' : 'score_fell',
    text: `${curr.title} ${rose ? 'rose' : 'fell'} from ${prev.score} → ${curr.score}`,
    magnitude: Math.abs(delta),
    polarity: rose ? 'worse' : 'better',
    category: curr.category,
    weight: rose ? 1 : 4,
  });
}

function addTierDelta(
  lines: ChangeLine[],
  prev: SituationSnapshot,
  curr: SituationSnapshot,
  tierOrder: readonly string[],
): void {
  if (!prev.tier || !curr.tier) return;
  const pi = tierOrder.indexOf(prev.tier.toLowerCase());
  const ci = tierOrder.indexOf(curr.tier.toLowerCase());
  if (pi === -1 || ci === -1 || pi === ci) return;
  const escalated = ci > pi;
  lines.push({
    id: curr.id,
    kind: escalated ? 'tier_escalated' : 'tier_de_escalated',
    text: `${curr.title} ${escalated ? 'escalated' : 'de-escalated'} ${prev.tier} → ${curr.tier}`,
    magnitude: Math.abs(ci - pi),
    polarity: escalated ? 'worse' : 'better',
    category: curr.category,
    weight: escalated ? 1 : 4,
  });
}

function addSourceDelta(
  lines: ChangeLine[],
  prev: SituationSnapshot,
  curr: SituationSnapshot,
): void {
  const prevSet = new Set(prev.sources);
  const currSet = new Set(curr.sources);
  const added = [...currSet].filter((s) => !prevSet.has(s));
  const removed = [...prevSet].filter((s) => !currSet.has(s));

  if (added.length > 0) {
    lines.push({
      id: curr.id,
      kind: 'sources_confirming',
      text: `${added.length} new source${added.length === 1 ? '' : 's'} confirming ${curr.title}`,
      magnitude: added.length,
      polarity: 'worse', // more sources = more confidence the bad thing is real
      category: curr.category,
      weight: 3,
    });
  }
  if (removed.length > 0) {
    lines.push({
      id: curr.id,
      kind: 'sources_lost',
      text: `${removed.length} source${removed.length === 1 ? '' : 's'} dropped from ${curr.title}`,
      magnitude: removed.length,
      polarity: 'better',
      category: curr.category,
      weight: 5,
    });
  }
}

function addMetaDelta(
  lines: ChangeLine[],
  prev: SituationSnapshot,
  curr: SituationSnapshot,
): void {
  // Only emit meta-change lines when both sides have metas and at
  // least one *interesting* key differs. We special-case `centroid`
  // and `distanceKm` because they're the most concrete spatial deltas;
  // the plan's worked example "Hurricane track shifted 90 miles west"
  // is exactly this case.
  if (!prev.meta || !curr.meta) return;

  const prevCentroid = readCoord(prev.meta.centroid);
  const currCentroid = readCoord(curr.meta.centroid);
  if (prevCentroid && currCentroid) {
    const km = haversineKm(
      prevCentroid.lat,
      prevCentroid.lon,
      currCentroid.lat,
      currCentroid.lon,
    );
    if (km >= 25) {
      lines.push({
        id: curr.id,
        kind: 'meta_changed',
        text: `${curr.title} centroid shifted ${km.toFixed(0)} km`,
        magnitude: km,
        polarity: 'neutral',
        category: curr.category,
        weight: 6,
      });
    }
  }

  const prevDistance = numberOrUndefined(prev.meta.distanceKm);
  const currDistance = numberOrUndefined(curr.meta.distanceKm);
  if (prevDistance !== undefined && currDistance !== undefined) {
    const delta = prevDistance - currDistance; // positive = closer
    if (delta >= 5) {
      lines.push({
        id: curr.id,
        kind: 'meta_changed',
        text: `${curr.title} moved ${delta.toFixed(0)} km closer (now ${currDistance.toFixed(0)} km)`,
        magnitude: delta,
        polarity: 'worse',
        category: curr.category,
        weight: 2,
      });
    } else if (delta <= -5) {
      lines.push({
        id: curr.id,
        kind: 'meta_changed',
        text: `${curr.title} moved ${(-delta).toFixed(0)} km farther`,
        magnitude: -delta,
        polarity: 'better',
        category: curr.category,
        weight: 5,
      });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function indexById(items: readonly SituationSnapshot[]): Map<string, SituationSnapshot> {
  const map = new Map<string, SituationSnapshot>();
  for (const s of items) map.set(s.id, s);
  return map;
}

function readCoord(value: unknown): { lat: number; lon: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { lat?: unknown; lon?: unknown };
  if (typeof v.lat !== 'number' || typeof v.lon !== 'number') return undefined;
  return { lat: v.lat, lon: v.lon };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
