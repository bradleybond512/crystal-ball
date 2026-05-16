/**
 * Bridge between EvidenceGraphV2 and the existing `evidence-graph-ux`
 * report shape consumed by the Evidence Graph panel.
 *
 * The v2 Situation carries observations + typed evidence edges directly
 * on the object. This bridge takes a single Situation, indexes it into
 * a fresh `EvidenceGraphV2`, and returns the `EvidenceAssembly` rollup
 * shape the UI / briefing layer expects.
 *
 * The "EvidenceAssembly" type defined here mirrors the legacy
 * `EvidenceReport` from `evidence-graph-ux.ts` for new v2 callers.
 * The legacy report is still produced from v1 Situations by that
 * module — this bridge is the v2 path.
 */

import type { ObservationEvent } from './observation-adapters';
import {
  EvidenceGraphV2,
  type EdgeTypeCounts,
  type GraphStats,
} from './evidence-graph-v2';
import type {
  EvidenceEdge,
  EvidenceEdgeType,
  Situation,
} from './situation-store-v2';

// ── Types ─────────────────────────────────────────────────────────────

export interface EvidenceSourceRow {
  sourceId: string;
  domain: string;
  title: string;
  timestamp: number;
  confidence: number;
}

export interface ContradictingRow {
  sourceId: string;
  domain: string;
  title: string;
  timestamp: number;
  reason: string;
}

export interface MissingSignal {
  domain: string;
  expectedSignal: string;
}

export interface StaleInput {
  sourceId: string;
  domain: string;
  title: string;
  ageMs: number;
}

/** Normalized per-edge-type confidence weights, scaled to [0, 1]. */
export type ConfidenceBreakdown = Record<EvidenceEdgeType, number>;

export interface EvidenceAssembly {
  situationId: string;
  confirming: EvidenceSourceRow[];
  contradicting: ContradictingRow[];
  missing: MissingSignal[];
  stale: StaleInput[];
  confidenceBreakdown: ConfidenceBreakdown;
  lastVerified: number;
  /** Snapshot of the underlying graph stats — useful for diagnostics. */
  graphStats: GraphStats;
}

export interface AssembleOptions {
  /** Override the clock — defaults to `Date.now()`. Tests inject this. */
  now?: number;
  /** Minimum edge confidence treated as "strong / confirming". */
  minConfirmingConfidence?: number;
}

// ── Domain refresh budgets + expected follow-on signals ──────────────

const DEFAULT_REFRESH_BUDGET_MS = 30 * 60 * 1000;
const DEFAULT_STRONG_CONFIDENCE = 0.6;

const REFRESH_BUDGET_MS: Record<string, number> = {
  weather: 10 * 60 * 1000,
  earthquake: 5 * 60 * 1000,
  seismic: 5 * 60 * 1000,
  cyber: 30 * 60 * 1000,
  maritime: 15 * 60 * 1000,
  aviation: 15 * 60 * 1000,
  conflict: 60 * 60 * 1000,
  wildfire: 15 * 60 * 1000,
  space: 30 * 60 * 1000,
  health: 60 * 60 * 1000,
  economic: 60 * 60 * 1000,
};

const EXPECTED_SIGNALS: Record<string, readonly { sourceId: string; label: string }[]> = {
  earthquake: [
    { sourceId: 'usgs-shakemap', label: 'USGS ShakeMap report' },
    { sourceId: 'noaa-tsunami', label: 'NOAA tsunami advisory' },
  ],
  seismic: [
    { sourceId: 'usgs-shakemap', label: 'USGS ShakeMap report' },
    { sourceId: 'noaa-tsunami', label: 'NOAA tsunami advisory' },
  ],
  weather: [
    { sourceId: 'nws-alert', label: 'NWS polygon alert' },
    { sourceId: 'nws-radar', label: 'NEXRAD radar update' },
  ],
  cyber: [
    { sourceId: 'cisa-kev', label: 'CISA KEV / advisory' },
    { sourceId: 'cert', label: 'CERT bulletin' },
  ],
};

// ── Bridge ────────────────────────────────────────────────────────────

export function assembleSituationEvidence(
  situation: Situation,
  options: AssembleOptions = {},
): EvidenceAssembly {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(situation);
  const now = options.now ?? Date.now();
  const minStrong = options.minConfirmingConfidence ?? DEFAULT_STRONG_CONFIDENCE;

  const strong = graph.getStrongEdges(minStrong)
    .filter((e) => e.type === 'confirms' || e.type === 'co-located');
  const contradictions = graph.getContradictions();
  const observationsById = indexObservations(situation.observations);

  const confirming = buildConfirmingRows(strong, observationsById);
  const contradicting = buildContradictingRows(contradictions, observationsById);

  const missing = detectMissing(situation, observationsById);
  const stale = detectStale(situation, now);

  const stats = graph.stats();
  const confidenceBreakdown = normalizeBreakdown(stats.byEdgeType);
  const lastVerified = computeLastVerified(situation, confirming);

  return {
    situationId: situation.id,
    confirming,
    contradicting,
    missing,
    stale,
    confidenceBreakdown,
    lastVerified,
    graphStats: stats,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function indexObservations(observations: readonly ObservationEvent[]): Map<string, ObservationEvent> {
  const out = new Map<string, ObservationEvent>();
  for (const o of observations) out.set(o.id, o);
  return out;
}

function buildConfirmingRows(
  edges: readonly EvidenceEdge[],
  observations: ReadonlyMap<string, ObservationEvent>,
): EvidenceSourceRow[] {
  const seen = new Set<string>();
  const rows: EvidenceSourceRow[] = [];
  for (const edge of edges) {
    pushIfNew(observations, edge.sourceEventId, edge.confidence, seen, rows);
    pushIfNew(observations, edge.targetEventId, edge.confidence, seen, rows);
  }
  return rows;
}

function pushIfNew(
  observations: ReadonlyMap<string, ObservationEvent>,
  observationId: string,
  confidence: number,
  seen: Set<string>,
  rows: EvidenceSourceRow[],
): void {
  if (seen.has(observationId)) return;
  const obs = observations.get(observationId);
  if (!obs) return;
  seen.add(observationId);
  rows.push({
    sourceId: obs.sourceId,
    domain: obs.domain,
    title: obs.title,
    timestamp: obs.timestamp,
    confidence,
  });
}

function buildContradictingRows(
  edges: readonly EvidenceEdge[],
  observations: ReadonlyMap<string, ObservationEvent>,
): ContradictingRow[] {
  const rows: ContradictingRow[] = [];
  for (const edge of edges) {
    const target = observations.get(edge.targetEventId);
    if (!target) continue;
    rows.push({
      sourceId: target.sourceId,
      domain: target.domain,
      title: target.title,
      timestamp: target.timestamp,
      reason: edge.ruleId
        ? `Contradicting evidence flagged by rule ${edge.ruleId} (confidence ${edge.confidence.toFixed(2)})`
        : `Contradicting evidence (confidence ${edge.confidence.toFixed(2)})`,
    });
  }
  return rows;
}

function detectMissing(
  situation: Situation,
  observations: ReadonlyMap<string, ObservationEvent>,
): MissingSignal[] {
  const expected = EXPECTED_SIGNALS[situation.domain];
  if (!expected || expected.length === 0) return [];
  const seenSources = new Set<string>();
  const seenTagFragments = new Set<string>();
  for (const obs of observations.values()) {
    seenSources.add(obs.sourceId);
    for (const tag of obs.tags) seenTagFragments.add(tag.toLowerCase());
  }
  const out: MissingSignal[] = [];
  for (const sig of expected) {
    if (seenSources.has(sig.sourceId)) continue;
    if (seenTagFragments.has(sig.sourceId.toLowerCase())) continue;
    out.push({ domain: situation.domain, expectedSignal: sig.label });
  }
  return out;
}

function detectStale(situation: Situation, now: number): StaleInput[] {
  const out: StaleInput[] = [];
  for (const obs of situation.observations) {
    const budget = REFRESH_BUDGET_MS[obs.domain] ?? DEFAULT_REFRESH_BUDGET_MS;
    const ageMs = now - obs.timestamp;
    if (ageMs <= budget) continue;
    out.push({
      sourceId: obs.sourceId,
      domain: obs.domain,
      title: obs.title,
      ageMs,
    });
  }
  return out;
}

function normalizeBreakdown(counts: EdgeTypeCounts): ConfidenceBreakdown {
  let total = 0;
  for (const v of Object.values(counts)) total += v;
  if (total === 0) {
    return {
      caused_by: 0,
      'co-located': 0,
      'temporally-adjacent': 0,
      contradicts: 0,
      confirms: 0,
    };
  }
  return {
    caused_by: Number((counts.caused_by / total).toFixed(4)),
    'co-located': Number((counts['co-located'] / total).toFixed(4)),
    'temporally-adjacent': Number((counts['temporally-adjacent'] / total).toFixed(4)),
    contradicts: Number((counts.contradicts / total).toFixed(4)),
    confirms: Number((counts.confirms / total).toFixed(4)),
  };
}

function computeLastVerified(
  situation: Situation,
  confirming: readonly EvidenceSourceRow[],
): number {
  let max = 0;
  for (const r of confirming) max = Math.max(max, r.timestamp);
  if (max === 0) {
    for (const o of situation.observations) max = Math.max(max, o.timestamp);
  }
  return max;
}
