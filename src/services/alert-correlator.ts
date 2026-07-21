/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, sonarjs/reduce-initial-value, unicorn/prefer-math-trunc, unicorn/prefer-code-point, sonarjs/no-nested-conditional, @typescript-eslint/prefer-for-of, @typescript-eslint/prefer-nullish-coalescing, sonarjs/no-nested-template-literals */
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
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';
import { getTunedParam } from '@/services/algorithms/tunable-params-store';
import { runIntel } from './intel-provider';
import { getEnabledCustomRules } from './custom-correlation-rules';
import {
  islandLedgerMult,
  recordIslandPrediction,
  startIslandOutcomeTracking,
} from '@/services/correlation/island-calibration';

const WINDOW_MS = 30 * 60_000;            // widened so chain links can catch up
const SCAN_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;
const SYNTH_TTL_MS = 6 * 60 * 60_000;
const NEG_EVIDENCE_KEY = 'crystalball-neg-evidence-v1';
const CHAIN_SYNTH_PREFIX = 'chain-';

interface CausalRule {
  cause: AlertSource;
  effect: AlertSource;
  maxLagMs: number;     // effect must arrive within this window after cause
  radiusKm: number;     // spatial tolerance (or fallback for radiusFn)
  /** Negative-evidence guard: return false to reject the cause for this rule. */
  guard?: (cause: UnifiedAlert) => boolean;
  /** Magnitude-aware radius override. Returns km. */
  radiusFn?: (cause: UnifiedAlert) => number;
}

/** Parse a quake magnitude from a title like "M6.5 — 30km off Honshu". */
function parseMagnitude(a: UnifiedAlert): number | null {
  const m = /\bM\s*(\d+(?:\.\d+)?)/i.exec(a.title);
  return m ? Number.parseFloat(m[1]!) : null;
}

/** Tsunami requires a large quake. Severity proxies "shallow + offshore". */
function tsunamiGuard(cause: UnifiedAlert): boolean {
  const mag = parseMagnitude(cause);
  if (mag !== null && mag < 6.5) return false;
  return cause.severity === 'critical' || cause.severity === 'high';
}

/** Quake-magnitude-scaled radius. M<6.5 → 15%, M6.5+ → 40%, M7.5+ → 75%, M8.5+ → 100%. */
function quakeRadius(base: number): (cause: UnifiedAlert) => number {
  return (cause: UnifiedAlert) => {
    const mag = parseMagnitude(cause);
    if (mag === null) return base * 0.3;
    if (mag >= 8.5) return base;
    if (mag >= 7.5) return base * 0.75;
    if (mag >= 6.5) return base * 0.4;
    return base * 0.15;
  };
}

/** Directional causal rules — cause precedes effect within maxLagMs. */
const CAUSAL_RULES: readonly CausalRule[] = [
  { cause: 'earthquake', effect: 'tsunami',       maxLagMs: 60 * 60_000, radiusKm: 2000, guard: tsunamiGuard, radiusFn: quakeRadius(2000) },
  { cause: 'earthquake', effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 300, radiusFn: quakeRadius(300) },
  { cause: 'earthquake', effect: 'volcano',       maxLagMs: 24 * 60 * 60_000, radiusKm: 200, radiusFn: quakeRadius(200) },
  { cause: 'volcano',    effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 300 },
  { cause: 'cyclone',    effect: 'gdacs',         maxLagMs: 12 * 60 * 60_000, radiusKm: 500 },
  { cause: 'cyclone',    effect: 'nws',           maxLagMs: 12 * 60 * 60_000, radiusKm: 500 },
  { cause: 'fire',       effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 200 },
  { cause: 'fire',       effect: 'nws',           maxLagMs: 6 * 60 * 60_000, radiusKm: 200 },
  { cause: 'cyber',      effect: 'breaking-news', maxLagMs: 6 * 60 * 60_000, radiusKm: 10_000 },
  { cause: 'oref',       effect: 'breaking-news', maxLagMs: 2 * 60 * 60_000, radiusKm: 500 },
  { cause: 'nws',        effect: 'breaking-news', maxLagMs: 2 * 60 * 60_000, radiusKm: 500 },
  { cause: 'gdacs',      effect: 'breaking-news', maxLagMs: 6 * 60 * 60_000, radiusKm: 1000 },
  { cause: 'hazard',     effect: 'breaking-news', maxLagMs: 2 * 60 * 60_000, radiusKm: 500 },
  { cause: 'power-grid', effect: 'breaking-news', maxLagMs: 6 * 60 * 60_000, radiusKm: 800 },
  { cause: 'power-grid', effect: 'comms-health',  maxLagMs: 2 * 60 * 60_000, radiusKm: 5000 },
  { cause: 'cyclone',    effect: 'power-grid',    maxLagMs: 12 * 60 * 60_000, radiusKm: 800 },
  { cause: 'cyber',      effect: 'power-grid',    maxLagMs: 6 * 60 * 60_000, radiusKm: 5000 },
  // Cyber kill-chain: a known threat seen by your local sensors = it's hitting you.
  { cause: 'cyber',      effect: 'local-ids',     maxLagMs: 24 * 60 * 60_000, radiusKm: 50 },
  // Conflict escalation: airstrike then rocket alert nearby = active engagement.
  { cause: 'oref',       effect: 'gdacs',         maxLagMs: 6 * 60 * 60_000, radiusKm: 200 },
  { cause: 'gdacs',      effect: 'oref',          maxLagMs: 6 * 60 * 60_000, radiusKm: 200 },
  // Cross-channel rules unlocked by intel-channels-bridge:
  // Geomagnetic storm → grid stress (global effect, huge radius)
  { cause: 'space-weather', effect: 'power-grid', maxLagMs: 12 * 60 * 60_000, radiusKm: 20_000 },
  { cause: 'space-weather', effect: 'comms-health', maxLagMs: 12 * 60 * 60_000, radiusKm: 20_000 },
  { cause: 'space-weather', effect: 'aviation-hazard', maxLagMs: 12 * 60 * 60_000, radiusKm: 20_000 },
  // Volcano → aviation ash SIGMETs + nearby air quality
  { cause: 'volcano',    effect: 'aviation-hazard', maxLagMs: 24 * 60 * 60_000, radiusKm: 1500 },
  { cause: 'volcano',    effect: 'air-quality',    maxLagMs: 24 * 60 * 60_000, radiusKm: 500 },
  // Major quake → radiation (reactor proximity heuristic, small radius)
  { cause: 'earthquake', effect: 'radiation',       maxLagMs: 24 * 60 * 60_000, radiusKm: 150, guard: tsunamiGuard },
  // Disease outbreak → travel advisory
  { cause: 'disease',    effect: 'travel-advisory', maxLagMs: 7 * 24 * 60 * 60_000, radiusKm: 2000 },
  // SPC severe convective outlook → grid stress
  { cause: 'spc',        effect: 'power-grid',      maxLagMs: 12 * 60 * 60_000, radiusKm: 600 },
  { cause: 'spc',        effect: 'nws',             maxLagMs: 6 * 60 * 60_000, radiusKm: 400 },
  // Cyclone → maritime + aviation + travel
  { cause: 'cyclone',    effect: 'maritime',        maxLagMs: 24 * 60 * 60_000, radiusKm: 1500 },
  { cause: 'cyclone',    effect: 'aviation-hazard', maxLagMs: 24 * 60 * 60_000, radiusKm: 1500 },
  { cause: 'cyclone',    effect: 'travel-advisory', maxLagMs: 48 * 60 * 60_000, radiusKm: 1500 },
  // Radiation spike → disease/health + travel
  { cause: 'radiation',  effect: 'travel-advisory', maxLagMs: 48 * 60 * 60_000, radiusKm: 500 },
  // Fire → air quality downwind
  { cause: 'fire',       effect: 'air-quality',     maxLagMs: 24 * 60 * 60_000, radiusKm: 800 },
  // ── Weather cascade rules ──────────────────────────────────────────────
  // NWS severe weather → grid stress
  { cause: 'nws',        effect: 'power-grid',      maxLagMs: 12 * 60 * 60_000, radiusKm: 600 },
  // NWS severe weather → communications disruption
  { cause: 'nws',        effect: 'comms-health',    maxLagMs: 12 * 60 * 60_000, radiusKm: 500 },
  // GDACS disaster → supply chain / maritime disruption
  { cause: 'gdacs',      effect: 'maritime',         maxLagMs: 48 * 60 * 60_000, radiusKm: 1500 },
  // Earthquake → infrastructure cascade
  { cause: 'earthquake', effect: 'power-grid',      maxLagMs: 6 * 60 * 60_000, radiusKm: 300, radiusFn: quakeRadius(300) },
  { cause: 'earthquake', effect: 'comms-health',    maxLagMs: 6 * 60 * 60_000, radiusKm: 300, radiusFn: quakeRadius(300) },
  // Cyclone → air quality (wind-driven debris, industrial damage)
  { cause: 'cyclone',    effect: 'air-quality',     maxLagMs: 48 * 60 * 60_000, radiusKm: 500 },
  // Disease → breaking news (major outbreak always becomes news)
  { cause: 'disease',    effect: 'breaking-news',   maxLagMs: 48 * 60 * 60_000, radiusKm: 5000 },
  // NWS severe weather → aviation hazards
  { cause: 'nws',        effect: 'aviation-hazard', maxLagMs: 6 * 60 * 60_000, radiusKm: 500 },
];

// ── Negative evidence decay ──────────────────────────────────────────────
// When a cause fires but the expected effect doesn't arrive within the lag
// window, we record a miss. Repeated misses shrink the rule's effective
// confidence multiplier (0.5–1.0). Hits restore it.

interface NegEvidence { hits: number; misses: number; }
const negEvidence = new Map<string, NegEvidence>();
/** Pending causes waiting for effects. Keyed by `cause|effect`, value = cause timestamps. */
const pendingCauses = new Map<string, number[]>();

function loadNegEvidence(): void {
  try {
    const raw = localStorage.getItem(NEG_EVIDENCE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, NegEvidence>;
    for (const [k, v] of Object.entries(obj)) negEvidence.set(k, v);
  } catch { /* noop */ }
}
function saveNegEvidence(): void {
  const obj: Record<string, NegEvidence> = {};
  for (const [k, v] of negEvidence) obj[k] = v;
  try { localStorage.setItem(NEG_EVIDENCE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

function negEvidenceMult(pairKey: string): number {
  const ne = negEvidence.get(pairKey);
  if (!ne || (ne.hits + ne.misses) < 3) return 1;
  const missRatio = ne.misses / (ne.hits + ne.misses);
  return Math.max(0.5, 1 - missRatio * 0.5);
}

function recordNegHit(pairKey: string): void {
  const cur = negEvidence.get(pairKey) ?? { hits: 0, misses: 0 };
  cur.hits += 1;
  negEvidence.set(pairKey, cur);
}

function recordNegMiss(pairKey: string): void {
  const cur = negEvidence.get(pairKey) ?? { hits: 0, misses: 0 };
  cur.misses += 1;
  negEvidence.set(pairKey, cur);
}

/** Track pending causes and check for expired expectations. */
function updateNegativeEvidence(alerts: UnifiedAlert[]): void {
  const now = Date.now();
  const sourceSet = new Set(alerts.map(a => a.source));

  // Register new pending causes for each rule.
  for (const r of CAUSAL_RULES) {
    const pk = `${r.cause}|${r.effect}`;
    const causesPresent = alerts.filter(a => a.source === r.cause);
    if (causesPresent.length > 0) {
      const pending = pendingCauses.get(pk) ?? [];
      for (const c of causesPresent) {
        if (pending.length >= 1000) continue;
        if (!pending.some(t => Math.abs(t - c.timestamp) < 60_000)) {
          pending.push(c.timestamp);
        }
      }
      pendingCauses.set(pk, pending);
    }
  }

  // Check for expired expectations or fulfilled ones.
  for (const [pk, timestamps] of pendingCauses) {
    const [, effect] = pk.split('|') as [string, AlertSource];
    const rule = CAUSAL_RULES.find(r => `${r.cause}|${r.effect}` === pk);
    if (!rule) continue;
    const remaining: number[] = [];
    for (const ts of timestamps) {
      if (now - ts > rule.maxLagMs) {
        // Window expired — did the effect arrive?
        if (sourceSet.has(effect)) recordNegHit(pk);
        else recordNegMiss(pk);
      } else {
        remaining.push(ts);
      }
    }
    if (remaining.length > 0) pendingCauses.set(pk, remaining);
    else pendingCauses.delete(pk);
  }
  saveNegEvidence();
}

// ── Temporal chain detection ────────────────────────────────────────────
// Compose pairwise rules: if A→B and B→C exist, detect A→B→C.
// Emit early-warning chain alerts when A→B fires and B→C is expected.

interface CausalChain {
  steps: AlertSource[];           // e.g. ['earthquake', 'tsunami', 'gdacs']
  rules: CausalRule[];            // the 2+ rules composing this chain
  totalMaxLagMs: number;
}

/** Pre-compute all 3-step chains from the pairwise rules. */
function buildChainIndex(): CausalChain[] {
  const chains: CausalChain[] = [];
  const rulesByEffect = new Map<AlertSource, CausalRule[]>();
  for (const r of CAUSAL_RULES) {
    const arr = rulesByEffect.get(r.cause) ?? [];
    arr.push(r);
    rulesByEffect.set(r.cause, arr);
  }
  for (const r1 of CAUSAL_RULES) {
    const nextRules = rulesByEffect.get(r1.effect);
    if (!nextRules) continue;
    for (const r2 of nextRules) {
      // Avoid trivial loops.
      if (r2.effect === r1.cause) continue;
      chains.push({
        steps: [r1.cause, r1.effect, r2.effect],
        rules: [r1, r2],
        totalMaxLagMs: r1.maxLagMs + r2.maxLagMs,
      });
    }
  }
  return chains;
}

const CHAIN_INDEX = buildChainIndex();

/** Detect chains where the first link has fired (A→B present) but the last
 *  step (C) hasn't yet. Emit an early-warning synthetic alert. */
function detectChains(leaders: UnifiedAlert[], now: number): UnifiedAlert[] {
  const bySource = new Map<AlertSource, UnifiedAlert[]>();
  for (const a of leaders) {
    const arr = bySource.get(a.source) ?? [];
    arr.push(a);
    bySource.set(a.source, arr);
  }

  const chainAlerts: UnifiedAlert[] = [];
  for (const chain of CHAIN_INDEX) {
    const [stepA, stepB, stepC] = chain.steps as [AlertSource, AlertSource, AlertSource];
    const aAlerts = bySource.get(stepA);
    const bAlerts = bySource.get(stepB);
    if (!aAlerts || !bAlerts) continue;

    // Check if we already have stepC alerts (chain already materialized — skip).
    const cAlerts = bySource.get(stepC);

    for (const a of aAlerts) {
      for (const b of bAlerts) {
        if (!a.location || !b.location) continue;
        const dtAB = b.timestamp - a.timestamp;
        if (dtAB < 0 || dtAB > chain.rules[0]!.maxLagMs) continue;
        const r0 = chain.rules[0]!;
        const radius0 = r0.radiusFn ? r0.radiusFn(a) : r0.radiusKm;
        const dist = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
        if (dist > radius0) continue;
        if (r0.guard && !r0.guard(a)) continue;

        // A→B link confirmed. Check if C already exists nearby.
        const r1 = chain.rules[1]!;
        const radius1 = r1.radiusFn ? r1.radiusFn(b) : r1.radiusKm;
        const cExists = cAlerts?.some(c => {
          if (!c.location || !b.location) return false;
          const dtBC = c.timestamp - b.timestamp;
          if (dtBC < 0 || dtBC > r1.maxLagMs) return false;
          return computeDistanceKm(b.location.lat, b.location.lon, c.location.lat, c.location.lon) <= radius1;
        });

        const id = `${CHAIN_SYNTH_PREFIX}${stepA}-${stepB}-${stepC}-${hashString(a.id + b.id)}`;
        if (synthesized.has(id)) continue;

        const negMult = negEvidenceMult(`${stepA}|${stepB}`) * negEvidenceMult(`${stepB}|${stepC}`);
        const confidence = Math.max(0.15, 0.6 * negMult);

        if (cExists) {
          // Full chain materialized — emit a confirmed chain alert.
          synthesized.set(id, { ts: now, alertId: id, memberIds: [a.id, b.id] });
          chainAlerts.push({
            id,
            source: 'correlation',
            severity: 'high',
            title: `Chain: ${stepA} → ${stepB} → ${stepC}`,
            body: `Causal chain confirmed.\n• [${stepA}] ${a.title}\n• [${stepB}] ${b.title}\nDownstream ${stepC} already observed.`,
            timestamp: now,
            location: b.location,
            relevanceScore: Math.round(100 * Math.min(1, confidence * 1.3)),
            acknowledged: false,
            pinned: false,
            correlationMembers: [a.id, b.id],
            correlationPair: [stepA, stepC],
          });
        } else {
          // Early warning — C expected but not yet seen.
          synthesized.set(id, { ts: now, alertId: id, memberIds: [a.id, b.id] });
          const remainMs = r1.maxLagMs - (now - b.timestamp);
          const remainLabel = remainMs > 0 ? `${Math.round(remainMs / 60_000)}min` : 'overdue';
          chainAlerts.push({
            id,
            source: 'correlation',
            severity: 'medium',
            title: `Chain warning: ${stepA} → ${stepB} → ${stepC}?`,
            body: `${stepA} → ${stepB} confirmed. Downstream ${stepC} expected within ${remainLabel} (${radius1}km radius).\n• [${stepA}] ${a.title}\n• [${stepB}] ${b.title}`,
            timestamp: now,
            location: b.location,
            relevanceScore: Math.round(100 * confidence),
            acknowledged: false,
            pinned: false,
            correlationMembers: [a.id, b.id],
            correlationPair: [stepB, stepC],
          });
        }
        break; // one chain alert per A→B pair
      }
    }
  }
  return chainAlerts;
}

/** Auto-disable rules whose user-feedback multiplier has collapsed (sustained dismissals). */
function ruleEnabled(r: CausalRule): boolean {
  // Read the tuned threshold from the store (falls back to 0.55 when unset).
  const threshold = getTunedParam('correlation-feedback', 'feedbackThreshold', 0.55);
  return getPairFeedbackMult(`${r.cause}|${r.effect}`) >= threshold;
}

const distanceCache = new Map<string, number>();

function cachedDistanceKm(a: UnifiedAlert, b: UnifiedAlert): number {
  const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  let d = distanceCache.get(key);
  if (d === undefined) {
    d = computeDistanceKm(a.location!.lat, a.location!.lon, b.location!.lat, b.location!.lon);
    distanceCache.set(key, d);
  }
  return d;
}

function tryRule(r: CausalRule, cause: UnifiedAlert, effect: UnifiedAlert, dt: number): boolean {
  if (dt < 0 || dt > r.maxLagMs) return false;
  if (r.guard && !r.guard(cause)) return false;
  if (!ruleEnabled(r)) return false;
  const radius = r.radiusFn ? r.radiusFn(cause) : r.radiusKm;
  const d = cachedDistanceKm(cause, effect);
  return d <= radius;
}

/** Match a directional pair against rules, order-sensitive. Returns rule or null. */
function matchRule(a: UnifiedAlert, b: UnifiedAlert): CausalRule | null {
  if (!a.location || !b.location) return null;
  const dt = b.timestamp - a.timestamp;
  for (const r of CAUSAL_RULES) {
    if (r.cause === a.source && r.effect === b.source && tryRule(r, a, b, dt)) return r;
    if (r.cause === b.source && r.effect === a.source && tryRule(r, b, a, -dt)) return r;
  }
  // Check user-defined custom rules.
  for (const cr of getEnabledCustomRules()) {
    const customRule: CausalRule = { cause: cr.cause, effect: cr.effect, maxLagMs: cr.maxLagMs, radiusKm: cr.radiusKm };
    if (cr.cause === a.source && cr.effect === b.source && tryRule(customRule, a, b, dt)) return customRule;
    if (cr.cause === b.source && cr.effect === a.source && tryRule(customRule, b, a, -dt)) return customRule;
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
    const memberSet = new Set<string>([seed.id]);
    let seedRule: CausalRule | null = null;
    // Iterative growth: keep adding any alert that rule-matches ANY current member.
    let grew = true;
    while (grew) {
      grew = false;
      for (const other of leaders) {
        if (used.has(other.id)) continue;
        if (memberSet.has(other.id)) continue;
        for (const m of members) {
          const r = matchRule(m, other);
          if (r) {
            members.push(other);
            memberSet.add(other.id);
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
  distanceCache.clear();
  const now = Date.now();
  const recent = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged
    && (!a.snoozedUntil || a.snoozedUntil < now)
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
    // Member-set dedup: skip if a recent synth shares ≥70% of these members.
    const memberSet = new Set(members.map(m => m.id));
    let dup = false;
    for (const v of synthesized.values()) {
      if (now - v.ts > 30 * 60_000) continue;
      const inter = v.memberIds.filter(mid => memberSet.has(mid)).length;
      const union = new Set([...v.memberIds, ...memberSet]).size;
      if (union > 0 && inter / union >= 0.7) { dup = true; break; }
    }
    if (dup) continue;

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
    const _t0 = Date.now();
    const feedbackMult = getPairFeedbackMult(pairKey);
    // Shared calibration spine (correlation next-gen): once the ledger
    // has ≥5 resolved outcomes for this rule, its bounded [0.5, 1.5]
    // reliability REPLACES the legacy pair-feedback multiplier — both
    // learn from the same user gestures, and multiplying them would
    // double-count (5 fast dismissals ≈ 0.5 × 0.5). Until then the
    // legacy multiplier governs alone.
    const ledgerMult = islandLedgerMult(pairKey, now);
    const learnedMult = ledgerMult ?? feedbackMult;
    const confidence = Math.max(0.1, Math.min(1, baseConfidence * learnedMult));
    try {
      recordAlgorithmEvaluation('correlation-feedback', {
        durationMs: Date.now() - _t0,
        score: confidence,
        label: learnedMult >= 1 ? 'boosted' : 'suppressed',
        detail: { cause: rule.cause, effect: rule.effect, members: members.length },
      });
    } catch { /* ledger unavailable */ }

    const sources = [...new Set(members.map(m => m.source))];
    synthesized.set(id, { ts: now, alertId: id, memberIds: members.map(m => m.id) });
    try {
      recordIslandPrediction(id, pairKey, rule.cause, confidence, now);
    } catch { /* ledger unavailable — never block synthesis */ }
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

  // Temporal chain detection: compose pairwise rules into A→B→C.
  const chainAlerts = detectChains(leaders, now);
  synthetic.push(...chainAlerts);

  // Negative evidence tracking: record misses when expected effects don't arrive.
  updateNegativeEvidence(recent);

  if (synthetic.length > 0) {
    unifiedAlertStore.ingest(synthetic);
    void validateWithLlm(synthetic);
  }
}

const MAX_LLM_VALIDATIONS = 5;

async function validateWithLlm(alerts: UnifiedAlert[]): Promise<void> {
  const toValidate = alerts.filter(a => a.correlationPair).slice(0, MAX_LLM_VALIDATIONS);
  for (const a of toValidate) {
    const pair = a.correlationPair!;
    const prompt = `You are a situational-awareness analyst. A system clustered these alerts as causally related (${pair[0]} -> ${pair[1]}):\n\n${a.body}\n\nIs this a real causal correlation or coincidence? Respond with exactly one line:\nVERDICT: <REAL|WEAK|COINCIDENCE>\nREASON: <one short sentence>`;
    try {
      const r = await runIntel(prompt, { maxTokens: 80, temperature: 0.1 });
      const m = /VERDICT:\s*(REAL|WEAK|COINCIDENCE)/i.exec(r.response);
      if (!m) continue;
      const verdict = m[1]!.toUpperCase();
      const mult = verdict === 'REAL' ? 1.15 : (verdict === 'COINCIDENCE' ? 0.5 : 0.85);
      const newScore = Math.round(Math.max(10, Math.min(100, (a.relevanceScore ?? 50) * mult)));
      const reason = /REASON:\s*(.+)/i.exec(r.response)?.[1]?.trim() ?? '';
      unifiedAlertStore.ingest([{ ...a, relevanceScore: newScore, body: `${a.body}\n\nLLM ${verdict}${reason ? `: ${reason}` : ''}` }]);
    } catch { /* local model unavailable */ }
  }
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
let _scanTimer: number | null = null;
let _pruneTimer: number | null = null;
let _initialScanTimer: number | null = null;
let _unsubStore: (() => void) | null = null;
let _stopOutcomeTracking: (() => void) | null = null;

export function startAlertCorrelator(): void {
  if (started) return;
  started = true;
  loadNegEvidence();
  _scanTimer = window.setInterval(scan, SCAN_INTERVAL_MS);
  _pruneTimer = window.setInterval(pruneSynth, PRUNE_INTERVAL_MS);
  _unsubStore = unifiedAlertStore.subscribe(decayAcked);
  _stopOutcomeTracking = startIslandOutcomeTracking(unifiedAlertStore);
  _initialScanTimer = window.setTimeout(scan, 5000);
}

export function stopAlertCorrelator(): void {
  if (_scanTimer !== null) { clearInterval(_scanTimer); _scanTimer = null; }
  if (_pruneTimer !== null) { clearInterval(_pruneTimer); _pruneTimer = null; }
  if (_initialScanTimer !== null) { clearTimeout(_initialScanTimer); _initialScanTimer = null; }
  // Drop the store subscription so stop/start doesn't stack decayAcked subscribers.
  _unsubStore?.();
  _unsubStore = null;
  _stopOutcomeTracking?.();
  _stopOutcomeTracking = null;
  started = false;
}
