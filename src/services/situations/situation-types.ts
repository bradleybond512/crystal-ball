/**
 * High-Impact Situation Model — per
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md Phase 1.
 *
 * Shared cross-domain model for "the few things that could matter."
 * Distinct from the legacy `src/services/situation-types.ts` which
 * powers the older situation-engine + scenario projector. The legacy
 * engine continues to run; this model is a higher-level normalizer
 * that ties military, cyber, weather, and compound events into one
 * shape every consumer (Command Center, notifications, after-action
 * review, diagnostics export) can read.
 *
 * Plan invariants:
 *   - Pure deterministic types. No DOM, no fetch.
 *   - JSON-serializable so situations can flow through the diagnostics
 *     export bundle and the agent handoff packet.
 *   - Every field that drives a UI / notification decision has an
 *     explicit numeric or enum value (no implicit "if the string
 *     looks scary").
 *   - Every situation carries a DiagnosticsTrace explaining why it
 *     was created at this severity / confidence / urgency.
 */

// ── Public API ──────────────────────────────────────────────────────────

/** Cross-domain category. `compound` is reserved for situations that
 *  span multiple domains and merge into one story. */
export type SituationDomain = 'military' | 'cyber' | 'weather' | 'compound';

/** Severity tier from FYI to Emergency. Drives notification ladder
 *  and command-center prominence (see vision doc § Notification Ladder).
 *  - fyi:       background / inbox only
 *  - watch:     digest-level; calm wording
 *  - elevated:  banner + command-center prominence
 *  - critical:  native notification + persistent in-app status
 *  - emergency: persistent critical alert; quiet-hours bypass available
 */
export type SituationSeverity =
  | 'fyi'
  | 'watch'
  | 'elevated'
  | 'critical'
  | 'emergency';

/** Phase signalling continuity over time — a situation moves through
 *  these as new evidence arrives. Phase 1 emits 'emerging' /
 *  'developing' / 'active' from adapters; Phase 3 will add decay logic. */
export type SituationPhase = 'emerging' | 'developing' | 'active' | 'resolved';

// ── Personal exposure ──────────────────────────────────────────────────

/** User-facing impact translation. Phase 1 ships shape-only; Phase 2
 *  fills in real per-user reasoning from the Personal Exposure Graph. */
export interface PersonalImpact {
  /** One-line "how this affects you." Calm wording — avoid panic. */
  summary: string;
  /** Coarse user-facing impact band. */
  level: 'none' | 'low' | 'medium' | 'high' | 'severe';
  /** Concrete reasons exposure is non-zero (saved place inside polygon,
   *  watchlisted ticker exposed to commodity shock, etc.). */
  reasons: readonly string[];
}

// ── Evidence + provenance ──────────────────────────────────────────────

/** A single source-attributed evidence row. Intentionally close to
 *  the existing EvidencePack shape but flatter so adapters can build
 *  it without depending on the legacy module. */
export interface SituationEvidence {
  /** Stable id for the source document or signal. */
  id: string;
  /** Short label for the source — e.g. "NWS", "CISA KEV", "OpenSky". */
  source: string;
  /** Plain-English claim or observation. */
  claim: string;
  /** ms timestamp the evidence was observed. */
  observedAt: number;
  /** Optional URL to the underlying record. */
  url?: string;
  /** Per-evidence weight in the truth/severity computation, 0..1. */
  weight: number;
}

/** Source-agreement summary across the evidence list. The vision doc
 *  asks for an explicit agreement-vs-disagreement breakdown so the UI
 *  can show "X agree, Y contradict" without inferring it from text. */
export interface SourceAgreement {
  /** Source labels (e.g. "NWS", "OpenSky") that corroborate the claim. */
  agreeing: readonly string[];
  /** Source labels that contradict the claim, if any. */
  disagreeing: readonly string[];
  /** Independent-source count (deduped by source label). */
  independentSourceCount: number;
}

// ── Watch windows ──────────────────────────────────────────────────────

/** Signals the system expects to see if this situation is real. Drives
 *  Phase 3 confidence-decay logic (when expected signals fail to
 *  appear in the watch window, urgency drops). */
export interface ExpectedSignal {
  id: string;
  description: string;
  /** ms by which this signal should appear if the situation is real. */
  expectByMs?: number;
}

/** Signals that, if observed, would invalidate the situation (e.g.
 *  "NWS retracts the warning", "CISA removes from KEV"). */
export interface InvalidationSignal {
  id: string;
  description: string;
}

// ── Recommended actions + timeline ─────────────────────────────────────

/** Calm, concrete user action. Phase 1 produces shape-correct entries;
 *  Phase 4 adds full Action Brief integration. */
export interface RecommendedAction {
  id: string;
  /** Short imperative — e.g. "Avoid low-water crossings for 2 hours." */
  text: string;
  /** Cue for UI grouping. */
  urgency: 'immediate' | 'soon' | 'monitor' | 'fyi';
}

/** Time-ordered narrative entry — a single "what changed" line. */
export interface TimelineEvent {
  ts: number;
  text: string;
  /** Optional source label so the UI can show provenance. */
  source?: string;
}

// ── Diagnostics + outcome tracking ─────────────────────────────────────

/** Why this situation has the severity / confidence / urgency it does.
 *  Required on every emitted situation (see vision doc § Testing And
 *  Diagnostics Requirements). */
export interface DiagnosticsTrace {
  /** Why the situation was created. */
  createdReason: string;
  /** Free-text breakdown of severity decision (rule names, contributing
   *  thresholds). */
  severityRationale: string;
  /** Why confidence is at this level. */
  confidenceRationale: string;
  /** Why user exposure is at this level. */
  exposureRationale: string;
  /** Source contributions, e.g. "NWS=0.6, OpenSky=0.3". */
  sourceContributions: Record<string, number>;
  /** Threshold cuts that fired (rule ids). */
  thresholdsCrossed: readonly string[];
}

/** Filled in only after the situation resolves; supports the
 *  after-action review / self-learning loop (Phase 6). */
export interface PredictionOutcome {
  resolvedAt?: number;
  /** Was the alert correct, late, early, false-positive, or missed? */
  verdict?: 'correct' | 'late' | 'early' | 'false_positive' | 'missed' | 'unknown';
  /** Free-text after-action notes. */
  notes?: string;
}

// ── The Situation ─────────────────────────────────────────────────────

/** What changed since the user's last look. Empty array on first emit. */
export type WhatChangedEntry = TimelineEvent;

/** The shared cross-domain situation model. */
export interface Situation {
  id: string;
  domain: SituationDomain;
  title: string;
  summary: string;
  severity: SituationSeverity;
  /** 0..1 confidence the situation is real. */
  confidence: number;
  /** 0..1 urgency — how time-sensitive is action? */
  urgency: number;
  /** 0..1 user exposure — how directly does this affect the user? */
  userExposure: number;
  /** Per-user impact translation. */
  personalImpact: PersonalImpact;
  /** Source-attributed evidence backing the situation. */
  evidence: readonly SituationEvidence[];
  /** Source agreement / disagreement summary. */
  sourceAgreement: SourceAgreement;
  /** Time-ordered "what changed" narrative since last emit. */
  whatChanged: readonly WhatChangedEntry[];
  /** Signals to watch for that would confirm the situation. */
  expectedNextSignals: readonly ExpectedSignal[];
  /** Signals that would invalidate the situation. */
  invalidationSignals: readonly InvalidationSignal[];
  /** User actions, sorted by urgency. */
  recommendedActions: readonly RecommendedAction[];
  /** Full timeline (most recent last). */
  timeline: readonly TimelineEvent[];
  /** Why this situation has these scores. */
  diagnosticsTrace: DiagnosticsTrace;
  /** Phase 6 outcome data. Empty until the situation resolves. */
  predictionOutcome: PredictionOutcome;
  /** Lifecycle phase. */
  phase: SituationPhase;
  /** ms timestamp of first emission. */
  firstSeen: number;
  /** ms timestamp of last update. */
  lastUpdated: number;
}

// ── Severity / phase helpers ──────────────────────────────────────────

/** Numeric severity rank for sorting (higher = more severe). */
export const SEVERITY_RANK: Record<SituationSeverity, number> = {
  fyi: 0,
  watch: 1,
  elevated: 2,
  critical: 3,
  emergency: 4,
};

/** Compose the four signals into a single 0..1 ranking score that
 *  the Command Center uses to pick the top N situations. Higher is
 *  more important. */
export function rankingScore(s: Pick<Situation, 'severity' | 'confidence' | 'urgency' | 'userExposure'>): number {
  // Severity is the dominant axis (4× weight). Confidence multiplies
  // the whole thing — a low-confidence emergency must not outrank a
  // high-confidence elevated. Urgency and userExposure are additive
  // bumps for tie-breaking.
  const severityNorm = SEVERITY_RANK[s.severity] / 4; // 0..1
  const base = severityNorm * 4 + s.urgency + s.userExposure;
  return base * Math.max(s.confidence, 0.1); // floor on confidence so a
                                              // 0-confidence situation
                                              // still has comparative
                                              // ordering
}

/** Convenience: derive severity tier from a 0..1 composite score
 *  using a stable ladder. Adapters can produce raw scores and let
 *  this helper do the bucketing so the ladder stays consistent
 *  across military / cyber / weather. */
export function severityFromScore(score: number): SituationSeverity {
  if (score >= 0.85) return 'emergency';
  if (score >= 0.65) return 'critical';
  if (score >= 0.45) return 'elevated';
  if (score >= 0.25) return 'watch';
  return 'fyi';
}
