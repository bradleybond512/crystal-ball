/* eslint-disable sonarjs/void-use, sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, sonarjs/reduce-initial-value, unicorn/prefer-math-trunc, unicorn/prefer-code-point, sonarjs/no-nested-conditional, @typescript-eslint/prefer-for-of, @typescript-eslint/prefer-nullish-coalescing */
/**
 * Alert correlator — synthesize `correlation` alerts when ≥2 alerts from
 * causally-compatible sources cluster in space and time.
 *
 * Accuracy pass:
 *  - Causal rules are directional (cause→effect) with per-pair max lag + radius.
 *  - Clustering uses true haversine distance, not grid cells.
 *  - Chains grow iteratively — a quake→tsunami cluster can absorb a later
 *    GDACS aftermath alert via a second rule.
 *  - Synthesized alerts get their own confidence score from member count,
 *    tightness, trust, and lag fit.
 *  - Synthesized-id cache is pruned hourly so it doesn't grow unbounded.
 *  - When every member of a correlation is acknowledged, the correlation
 *    is auto-acknowledged too (member-linked decay).
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSource, computeDistanceKm } from './unified-alerts';
import { getSourceTrust } from './source-trust';
import { canonicalEntityKey } from './entity-key';
import { recordCoOccurrence } from './pair-discovery';
import { getPairFeedbackMult } from './correlation-feedback';

const WINDOW_MS = 30 * 60_000;            // widened so chain links can catch up
const SCAN_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;
const SYNTH_TTL_MS = 6 * 60 * 60_000;

interface CausalRule {
  cause: AlertSource;
  effect: AlertSource;
  maxLagMs: number;     // effect must arrive within this window after cause
  radiusKm: number;     // spatial tolerance between cause and effect
}

/** Directional causal rules — cause precedes effect within maxLagMs. */
const CAUSAL_RULES: readonly CausalRule[] = [
  { cause: 'earthquake', effect: 'tsunami',       maxLagMs: 60 * 60_000, radiusKm: 2000 }, // basin-scale
  { cause: 'earthquake', effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 300 },
  { cause: 'earthquake', effect: 'volcano',       maxLagMs: 24 * 60 * 60_000, radiusKm: 200 },
  { cause: 'volcano',    effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 300 },
  { cause: 'cyclone',    effect: 'gdacs',         maxLagMs: 12 * 60 * 60_000, radiusKm: 500 },
  { cause: 'cyclone',    effect: 'nws',           maxLagMs: 12 * 60 * 60_000, radiusKm: 500 },
  { cause: 'fire',       effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 200 },
  { cause: 'fire',       effect: 'nws',           maxLagMs: 6 * 60 * 60_000, radiusKm: 200 },
  { cause: 'cyber',      effect: 'local-ids',     maxLagMs: 30 * 60_000, radiusKm: 50 },
  { cause: 'cyber',      effect: 'breaking-news', maxLagMs: 6 * 60 * 60_000, radiusKm: 10_000 },
  { cause: 'oref',       effect: 'breaking-news', maxLagMs: 2 * 60 * 60_000, radiusKm: 500 },
  { cause: 'nws',        effect: 'breaking-news', maxLagMs: 2 * 60 * 60_000, radiusKm: 500 },
  { cause: 'gdacs',      effect: 'breaking-news', maxLagMs: 6 * 60 * 60_000, radiusKm: 1000 },
  { cause: 'hazard',     effect: 'breaking-news', maxLagMs: 2 * 60 * 60_000, radiusKm: 500 },
  { cause: 'power-grid', effect: 'breaking-news', maxLagMs: 6 * 60 * 60_000, radiusKm: 800 },
  { cause: 'power-grid', effect: 'comms-health',  maxLagMs: 2 * 60 * 60_000, radiusKm: 5000 },
  { cause: 'cyclone',    effect: 'power-grid',    maxLagMs: 12 * 60 * 60_000, radiusKm: 800 },
  { cause: 'cyber',      effect: 'power-grid',    maxLagMs: 6 * 60 * 60_000, radiusKm: 5000 },
];

/** Match a directional pair against rules, order-sensitive. Returns rule or null. */
function matchRule(a: UnifiedAlert, b: UnifiedAlert): CausalRule | null {
  const dt = b.timestamp - a.timestamp;
  if (!a.location || !b.location) return null;
  // a is cause, b is effect
  if (dt >= 0) {
    for (const r of CAUSAL_RULES) {
      if (r.cause !== a.source || r.effect !== b.source) continue;
      if (dt > r.maxLagMs) continue;
      const d = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
      if (d > r.radiusKm) continue;
      return r;
    }
  }
  // b is cause, a is effect
  const dt2 = a.timestamp - b.timestamp;
  if (dt2 >= 0) {
    for (const r of CAUSAL_RULES) {
      if (r.cause !== b.source || r.effect !== a.source) continue;
      if (dt2 > r.maxLagMs) continue;
      const d = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
      if (d > r.radiusKm) continue;
      return r;
    }
  }
  return null;
}

interface SynthEntry { ts: number; alertId: string; memberIds: string[]; }
const synthesized = new Map<string, SynthEntry>();

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Confidence 0–1 from member count, trust average, tightness, and rule fit. */
function computeConfidence(
  members: UnifiedAlert[],
  rule: CausalRule,
  maxDistKm: number,
  maxLagMs: number,
): number {
  const trustAvg = members.reduce((s, m) => s + getSourceTrust(m.source), 0) / members.length;
  const sizeBoost = Math.min(1, (members.length - 1) * 0.25); // 2 → 0.25, 5+ → 1
  const spaceFit = Math.max(0, 1 - (maxDistKm / rule.radiusKm));
  const timeFit = Math.max(0, 1 - (maxLagMs / rule.maxLagMs));
  return Math.min(1, 0.25 + (trustAvg * 0.3) + (sizeBoost * 0.15) + (spaceFit * 0.15) + (timeFit * 0.15));
}

/** Cluster via rule matching — iterative chain growth. */
function buildClusters(leaders: UnifiedAlert[]): { members: UnifiedAlert[]; rule: CausalRule }[] {
  const clusters: { members: UnifiedAlert[]; rule: CausalRule }[] = [];
  const used = new Set<string>();

  for (let i = 0; i < leaders.length; i++) {
    const seed = leaders[i]!;
    if (used.has(seed.id)) continue;
    const members: UnifiedAlert[] = [seed];
    let seedRule: CausalRule | null = null;
    // Iterative growth: keep adding any alert that rule-matches ANY current member.
    let grew = true;
    while (grew) {
      grew = false;
      for (const other of leaders) {
        if (used.has(other.id)) continue;
        if (members.includes(other)) continue;
        for (const m of members) {
          const r = matchRule(m, other);
          if (r) {
            members.push(other);
            if (!seedRule) seedRule = r;
            grew = true;
            break;
          }
        }
      }
    }
    if (members.length >= 2 && seedRule) {
      for (const m of members) used.add(m.id);
      clusters.push({ members, rule: seedRule });
    }
  }
  return clusters;
}

function scan(): void {
  const now = Date.now();
  const recent = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged
    && a.source !== 'correlation'
    && a.location
    && now - a.timestamp < WINDOW_MS,
  );

  // Collapse same-entity duplicates.
  const byEntity = new Map<string, UnifiedAlert[]>();
  for (const a of recent) {
    const k = canonicalEntityKey(a);
    const arr = byEntity.get(k) ?? [];
    arr.push(a);
    byEntity.set(k, arr);
  }
  const leaders: UnifiedAlert[] = [];
  for (const group of byEntity.values()) {
    let best = group[0]!;
    for (const a of group) {
      if (getSourceTrust(a.source) > getSourceTrust(best.source)) best = a;
    }
    leaders.push(best);
  }

  // Co-occurrence logging for pair discovery (independent of clustering gate).
  recordCoOccurrence(leaders);

  const clusters = buildClusters(leaders);
  const synthetic: UnifiedAlert[] = [];

  for (const { members, rule } of clusters) {
    const idHash = members.map(m => m.id).sort().join(',');
    const id = `corr-${members.length}-${hashString(idHash)}`;
    if (synthesized.has(id)) continue;

    const sevRank: Record<UnifiedAlert['severity'], number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const top = members.reduce((a, b) => sevRank[b.severity] > sevRank[a.severity] ? b : a);
    const center = members[0]!.location!;

    // Tightness metrics for confidence.
    let maxDist = 0;
    let maxLag = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!, b = members[j]!;
        if (a.location && b.location) {
          const d = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
          if (d > maxDist) maxDist = d;
        }
        const lag = Math.abs(a.timestamp - b.timestamp);
        if (lag > maxLag) maxLag = lag;
      }
    }
    const baseConfidence = computeConfidence(members, rule, maxDist, maxLag);
    const pairKey = `${rule.cause}|${rule.effect}`;
    const confidence = Math.max(0.1, Math.min(1, baseConfidence * getPairFeedbackMult(pairKey)));

    const sources = [...new Set(members.map(m => m.source))];
    synthesized.set(id, { ts: now, alertId: id, memberIds: members.map(m => m.id) });
    synthetic.push({
      id,
      source: 'correlation',
      severity: top.severity,
      title: `${members.length} correlated alerts (${sources.join(' + ')})`,
      body: `Rule: ${rule.cause} → ${rule.effect}  ·  confidence ${(confidence * 100).toFixed(0)}%\n`
        + members.slice(0, 5).map(m => `• [${m.source}] ${m.title}`).join('\n'),
      timestamp: now,
      location: center,
      relevanceScore: Math.round(100 * confidence),
      acknowledged: false,
      pinned: false,
      correlationMembers: members.map(m => m.id),
      correlationPair: [rule.cause, rule.effect],
    });
  }

  if (synthetic.length > 0) unifiedAlertStore.ingest(synthetic);
}

/** Prune synthesized cache entries older than TTL. */
function pruneSynth(): void {
  const now = Date.now();
  for (const [k, v] of synthesized) {
    if (now - v.ts > SYNTH_TTL_MS) synthesized.delete(k);
  }
}

/** Member-linked decay: if every member of a correlation is acked, ack the correlation. */
function decayAcked(): void {
  const all = unifiedAlertStore.getAll();
  const byId = new Map(all.map(a => [a.id, a]));
  for (const a of all) {
    if (a.source !== 'correlation' || a.acknowledged) continue;
    if (!a.correlationMembers || a.correlationMembers.length === 0) continue;
    const allAcked = a.correlationMembers.every(id => {
      const m = byId.get(id);
      return !m || m.acknowledged;
    });
    if (allAcked) unifiedAlertStore.acknowledge(a.id);
  }
}

let started = false;
export function startAlertCorrelator(): void {
  if (started) return;
  started = true;
  window.setInterval(scan, SCAN_INTERVAL_MS);
  window.setInterval(pruneSynth, PRUNE_INTERVAL_MS);
  unifiedAlertStore.subscribe(decayAcked);
  window.setTimeout(scan, 5000);
}
