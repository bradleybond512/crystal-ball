/**
 * Crystal Ball intelligence layer — shared types.
 *
 * Per docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 1: every score
 * must include an explanation, every source-derived claim needs
 * provenance, contradictions surface (don't average away), stale data
 * reduces confidence (not silently disappear).
 *
 * These types are deliberately framework-free: no DOM, no fetch, no
 * runtime config. They're plain TypeScript so they can be tested with
 * static fixtures and reused across the rest of the intelligence
 * services (situation clustering PR 2, negative evidence PR 3, etc.).
 */

// ── NormalizedFact ────────────────────────────────────────────────────────
//
// The atomic unit of intelligence. A fact is one specific claim about the
// world, normalized across providers. Two providers reporting "M6.2 quake
// at 35.2N 139.7E at 2026-04-27T10:15Z" are TWO source attestations of the
// SAME fact (matched by event type + location + time + entity).

export type FactDomain =
  | 'weather'
  | 'cyber'
  | 'aviation'
  | 'maritime'
  | 'markets'
  | 'conflict'
  | 'humanitarian'
  | 'space'
  | 'infra'
  | 'macro'
  | 'other';

export type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

/** Granularity of where a fact happened. Drives `precision` scoring —
 *  point is the most credible (a single coordinate), country is least. */
export type LocationPrecision =
  | 'point'        // single lat/lon, < 1 km
  | 'local'        // city / facility, < 50 km
  | 'regional'     // state/province, < 500 km
  | 'country'      // nation-scale
  | 'global';      // unbounded

export interface SourceAttestation {
  /** Provider id (matches the provider registry in
   *  src/services/providers/registry.ts when available). */
  providerId: string;
  /** Source URL or document path the claim came from, for provenance. */
  url?: string;
  /** Epoch ms when this provider observed/reported the fact. */
  observedAt: number;
  /** Optional raw payload for debugging — not used in scoring. */
  raw?: unknown;
  /** True if this attestation is upstream-of another (e.g. NewsAPI
   *  re-publishing GDELT). Drives sourceDiversity scoring. */
  derivedFrom?: string;
}

export interface NormalizedFact {
  /** Stable id, ideally a hash of (domain + eventType + location + time
   *  bucket) so two providers observing the same event collide. */
  id: string;
  domain: FactDomain;
  /** Subtype within the domain — 'earthquake', 'cve-published',
   *  'flight-emergency', 'ais-gap', 'rate-decision', etc. */
  eventType: string;
  /** Free-text claim (e.g. "M6.2 earthquake near Tokyo"). */
  claim: string;
  /** Severity at observation time, 'info' if unknown. */
  severity: Severity;
  /** When the fact occurred (not when it was reported). */
  occurredAt: number;
  /** Location info. Lat/lon optional for global/macro facts. */
  lat?: number;
  lon?: number;
  locationPrecision: LocationPrecision;
  /** Affected entity IDs (country code, ticker, ICAO hex, etc.). */
  entities: string[];
  /** All providers that attested to this fact. ≥1 always. */
  sources: SourceAttestation[];
  /** IDs of NormalizedFacts that DIRECTLY contradict this one
   *  (e.g. tsunami warning issued vs. tsunami warning canceled). */
  contradictedBy?: string[];
}

// ── Evidence Graph ────────────────────────────────────────────────────────
//
// A graph where facts, sources, locations, entities, and forecasts are
// connected. Nodes carry typed metadata; edges carry semantic relations.
// The graph exists to (a) explain WHY a confidence score is what it is,
// and (b) surface contradictions that "averaging" would hide.

export type EvidenceNodeKind =
  | 'fact'         // a NormalizedFact
  | 'source'       // a provider attestation
  | 'location'     // a place/region
  | 'entity'       // a country/asset/ticker/etc.
  | 'forecast'     // a prediction
  | 'watchlist'    // a user-tracked thing
  | 'situation';   // a clustered set of facts (PR 2 will populate)

export interface EvidenceNode {
  id: string;
  kind: EvidenceNodeKind;
  /** Display label. */
  label: string;
  /** Domain for fact/forecast/situation nodes; null otherwise. */
  domain?: FactDomain;
  /** Free-form metadata; consumers cast appropriately. */
  meta?: Record<string, unknown>;
}

export type EvidenceEdgeKind =
  | 'corroborates'         // A supports B
  | 'contradicts'          // A disagrees with B
  | 'caused_by'            // A is consequence of B
  | 'same_location'        // A and B share a location node
  | 'same_entity'          // A and B share an entity node
  | 'same_time_window'     // A and B fall in same temporal bucket
  | 'escalates_to'         // A may evolve into B (forecast)
  | 'impacts'              // A affects B (entity/asset)
  | 'invalidates'          // A nullifies an earlier B
  | 'attests';             // source -> fact

export interface EvidenceEdge {
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  kind: EvidenceEdgeKind;
  /** Edge weight in [0, 1]. Higher = stronger relation. Used by the
   *  explanation walker to rank evidence paths. */
  weight: number;
  /** Free-form metadata. */
  meta?: Record<string, unknown>;
}

// ── Truth Score ───────────────────────────────────────────────────────────

/** Five-point label per the plan doc (lines 102-107). */
export type TruthLabel = 'confirmed' | 'likely' | 'plausible' | 'weak' | 'disputed';

export interface TruthScoreComponents {
  /** Average source reliability over attesting providers, 0-1. */
  reliability: number;
  /** How fresh the fact is relative to its domain TTL, 0-1. */
  freshness: number;
  /** Cross-source agreement strength, 0-1. */
  corroboration: number;
  /** Independence of attesting sources (penalize echo chambers), 0-1. */
  sourceDiversity: number;
  /** Geographic precision multiplier from LocationPrecision, 0-1. */
  precision: number;
  /** Historical accuracy of the attesting sources for this domain, 0-1.
   *  Defaults to 0.7 ("no calibration data yet, assume above-average"). */
  historicalAccuracy: number;
  /** Penalty subtracted from the weighted sum when contradictions
   *  exist. 0 if none. Designed so a single contradiction can pull a
   *  high score down to 'disputed'. */
  contradictionPenalty: number;
}

export interface TruthScore {
  /** Numeric score in [0, 1] after the formula + penalty. */
  score: number;
  /** Categorical label derived from score + contradictions. */
  label: TruthLabel;
  /** Per-component breakdown driving the score. */
  components: TruthScoreComponents;
  /** Provider IDs that attested to the fact. */
  contributingProviders: string[];
  /** True if `label === 'disputed'` because contradictions outweighed
   *  agreement. */
  disputed: boolean;
}

// ── Algorithm Explanation ─────────────────────────────────────────────────

/** Human-readable line. The `weight` field tells the UI how prominently
 *  to display it (1 = top line, descending). */
export interface ExplanationLine {
  text: string;
  /** 'positive' = adds confidence, 'negative' = subtracts. */
  polarity: 'positive' | 'negative' | 'neutral';
  weight: number;
  /** Optional pointer to the EvidenceNode this line refers to. */
  nodeId?: string;
}

export interface AlgorithmExplanation {
  /** Title shown to the user. */
  headline: string;
  /** Ordered evidence-and-reasoning lines, top first. */
  lines: ExplanationLine[];
  /** What additional source/data would resolve the lowest-confidence
   *  component. Empty when confidence is already 'confirmed'. */
  missingConfirmation: string[];
}

// ── Confidence Breakdown ──────────────────────────────────────────────────

/** Per the plan's "Confidence Decomposition" section: every score
 *  rendered to a user MUST be explainable as a sum of weighted
 *  sub-scores so the UI can show "Risk: 82 = 22/25 + 13/15 + 21/25 +
 *  14/15 + 7/10 - 2". */
export interface ConfidenceBreakdownItem {
  label: string;
  /** Earned points. */
  value: number;
  /** Maximum possible for this component. */
  max: number;
  /** Used to detect contradictions in the rendered output. */
  polarity: 'positive' | 'negative';
}

export interface ConfidenceBreakdown {
  /** Sum of (item.value) - (penalties), clamped to [0, max]. */
  total: number;
  /** Sum of items[].max, used as the rendered denominator. */
  max: number;
  items: ConfidenceBreakdownItem[];
}
