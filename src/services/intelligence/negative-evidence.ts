/**
 * Negative evidence — per
 * docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md PR 3 (lines 525-539).
 *
 * The plan: "Generalize negative evidence beyond alert correlation."
 * Adds:
 *   - expected follow-on signals
 *   - waiting windows
 *   - missing-signal penalties
 *   - confidence decay
 *   - missing-confirmation output
 *
 * The idea: when a primary fact occurs (M6.5 quake, tornado warning,
 * CVE publication, large refinery outage), certain follow-on signals
 * are EXPECTED within a domain-specific window. If those signals do
 * NOT appear by the window's end, that absence is itself information —
 * it should reduce confidence in the cascade narrative, not be
 * silently ignored.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 *
 * Plan invariant: "Stale data should reduce confidence, not silently
 * disappear." This module is the inverse — *missing* expected data
 * also reduces confidence and surfaces *why*.
 */

import type { FactDomain, NormalizedFact } from './types';

// ── Expected signals ─────────────────────────────────────────────────────

export interface ExpectedSignal {
  /** Stable id so the UI can reference a specific expected signal
   *  across multiple evaluations. */
  id: string;
  /** Human-readable description for the UI ("tsunami warning issued",
   *  "aftershock ≥ M4.0", "CISA KEV addition"). */
  label: string;
  /** Domain where the signal would appear. */
  domain: FactDomain;
  /** Optional eventType match — when set, only facts with this
   *  eventType count as observation of the signal. */
  eventType?: string;
  /** Optional substring match against fact.claim (case-insensitive)
   *  for cases where eventType isn't reliably tagged. */
  claimSubstring?: string;
  /** Optional entity match — at least one of these entity ids must
   *  appear in the candidate fact for it to count. Empty = no entity
   *  filter. */
  entities?: readonly string[];
  /** Earliest the signal is plausible (ms after parent.occurredAt). */
  windowStartMs: number;
  /** By this time after parent.occurredAt, the absence becomes
   *  meaningful and a penalty is applied. */
  windowEndMs: number;
  /** Penalty to subtract from confidence (0-1) when the signal is
   *  expected but missing. Default 0.1 per signal. */
  absencePenalty: number;
}

// ── Result ───────────────────────────────────────────────────────────────

export interface ObservedSignal {
  signal: ExpectedSignal;
  observedFactId: string;
}

export interface PendingSignal {
  signal: ExpectedSignal;
  /** ms remaining until windowEndMs. Negative once the window has closed. */
  msUntilWindowEnd: number;
}

export interface MissingSignal {
  signal: ExpectedSignal;
  /** Penalty actually applied (= signal.absencePenalty). */
  appliedPenalty: number;
}

export interface NegativeEvidenceResult {
  parentFactId: string;
  /** Signals that were expected for this parent. */
  expected: ExpectedSignal[];
  /** Signals that have been observed (matched candidate facts). */
  observed: ObservedSignal[];
  /** Signals whose window has not yet closed — keep watching. */
  pending: PendingSignal[];
  /** Signals whose window closed without an observation — penalty applied. */
  missing: MissingSignal[];
  /** Sum of applied penalties. Subtract from baseConfidence to get
   *  `adjustedConfidence`. Capped at 0.6 so even many missing
   *  signals can't crash confidence to 0. */
  totalAbsencePenalty: number;
  /** baseConfidence - totalAbsencePenalty, clamped to [0, 1]. */
  adjustedConfidence: number;
  /** Plain-text "missing confirmation" lines for the UI. The plan's
   *  Next Best Source Recommendation surface. */
  missingConfirmation: string[];
}

// ── Top-level evaluator ──────────────────────────────────────────────────

export interface NegativeEvidenceOptions {
  /** Defaults to Date.now(). Inject for tests. */
  now?: number;
  /** Maximum total penalty. Default 0.6. */
  maxPenalty?: number;
}

export function evaluateNegativeEvidence(
  parent: NormalizedFact,
  expected: readonly ExpectedSignal[],
  candidates: readonly NormalizedFact[],
  baseConfidence: number,
  options: NegativeEvidenceOptions = {},
): NegativeEvidenceResult {
  const now = options.now ?? Date.now();
  const maxPenalty = options.maxPenalty ?? 0.6;
  const observed: ObservedSignal[] = [];
  const pending: PendingSignal[] = [];
  const missing: MissingSignal[] = [];

  for (const signal of expected) {
    const match = findMatch(parent, signal, candidates);
    if (match) {
      observed.push({ signal, observedFactId: match.id });
      continue;
    }
    const elapsed = now - parent.occurredAt;
    if (elapsed < signal.windowEndMs) {
      pending.push({ signal, msUntilWindowEnd: signal.windowEndMs - elapsed });
    } else {
      // Default to the documented 0.1 per-signal penalty if a caller passes a
      // non-finite absencePenalty — a single undefined/NaN here would otherwise
      // make rawPenalty (and totalAbsencePenalty) NaN and poison the score.
      const penalty = Number.isFinite(signal.absencePenalty) ? signal.absencePenalty : 0.1;
      missing.push({ signal, appliedPenalty: penalty });
    }
  }

  const rawPenalty = missing.reduce((s, m) => s + m.appliedPenalty, 0);
  const totalAbsencePenalty = Math.min(maxPenalty, rawPenalty);
  const adjustedConfidence = clamp01(baseConfidence - totalAbsencePenalty);

  return {
    parentFactId: parent.id,
    expected: [...expected],
    observed,
    pending,
    missing,
    totalAbsencePenalty: round3(totalAbsencePenalty),
    adjustedConfidence: round3(adjustedConfidence),
    missingConfirmation: buildMissingConfirmation(missing, pending),
  };
}

// ── Match logic ──────────────────────────────────────────────────────────

function findMatch(
  parent: NormalizedFact,
  signal: ExpectedSignal,
  candidates: readonly NormalizedFact[],
): NormalizedFact | undefined {
  return candidates.find((c) => candidateMatchesSignal(parent, signal, c));
}

function candidateMatchesSignal(
  parent: NormalizedFact,
  signal: ExpectedSignal,
  c: NormalizedFact,
): boolean {
  if (c.id === parent.id) return false;
  if (c.domain !== signal.domain) return false;
  if (signal.eventType && c.eventType !== signal.eventType) return false;
  if (signal.claimSubstring && !c.claim.toLowerCase().includes(signal.claimSubstring.toLowerCase())) {
    return false;
  }
  if (!entityMatches(parent, signal, c)) return false;
  const dt = c.occurredAt - parent.occurredAt;
  return dt >= signal.windowStartMs && dt <= signal.windowEndMs;
}

function entityMatches(
  parent: NormalizedFact,
  signal: ExpectedSignal,
  c: NormalizedFact,
): boolean {
  if (signal.entities && signal.entities.length > 0) {
    return signal.entities.some((e) => c.entities.includes(e));
  }
  // Default scoping: if parent has entities and signal didn't override,
  // candidate must share at least one.
  if (parent.entities.length > 0) {
    return parent.entities.some((e) => c.entities.includes(e));
  }
  return true;
}

// ── Missing-confirmation strings ────────────────────────────────────────

function buildMissingConfirmation(
  missing: readonly MissingSignal[],
  pending: readonly PendingSignal[],
): string[] {
  const out: string[] = [];
  for (const m of missing) {
    out.push(`Missing: ${m.signal.label}`);
  }
  for (const p of pending) {
    const min = Math.max(0, Math.round(p.msUntilWindowEnd / 60_000));
    out.push(`Watching: ${p.signal.label} (${min} min remaining)`);
  }
  return out;
}

// ── Default catalog of expected signals by parent eventType ─────────────
//
// Callers can pass their own ExpectedSignal[] (preferred for domain-
// specific tuning), or they can use the default catalog as a starting
// point. Each entry handles one common parent eventType.

const DEFAULT_CATALOG: Record<string, readonly ExpectedSignal[]> = {
  // M≥6 quake: expect tsunami advisory (issued or canceled) within
  // 30 min for coastal events, plus aftershock report within 60 min.
  'earthquake-major': [
    {
      id: 'tsunami-status',
      label: 'tsunami advisory issued or canceled',
      domain: 'humanitarian',
      claimSubstring: 'tsunami',
      windowStartMs: 0,
      windowEndMs: 30 * 60 * 1000,
      absencePenalty: 0.1,
    },
    {
      id: 'aftershock',
      label: 'aftershock ≥ M4.0',
      domain: 'space',
      eventType: 'earthquake',
      windowStartMs: 5 * 60 * 1000,
      windowEndMs: 60 * 60 * 1000,
      absencePenalty: 0.05,
    },
  ],
  // Tornado warning: expect spotter confirmation OR damage report
  // within 30 min, otherwise the warning may be radar-only.
  'tornado-warning': [
    {
      id: 'spotter-or-damage',
      label: 'spotter confirmation or damage report',
      domain: 'weather',
      claimSubstring: 'spotter',
      windowStartMs: 0,
      windowEndMs: 30 * 60 * 1000,
      absencePenalty: 0.1,
    },
  ],
  // CVE published: expect EPSS score appearance within 24h, KEV
  // addition within 7 days for the highest-severity ones.
  'cve-published': [
    {
      id: 'epss-score',
      label: 'EPSS exploitation probability score',
      domain: 'cyber',
      claimSubstring: 'epss',
      windowStartMs: 0,
      windowEndMs: 24 * 60 * 60 * 1000,
      absencePenalty: 0.05,
    },
    {
      id: 'kev-addition',
      label: 'CISA KEV addition (if exploited)',
      domain: 'cyber',
      claimSubstring: 'kev',
      windowStartMs: 24 * 60 * 60 * 1000,
      windowEndMs: 7 * 24 * 60 * 60 * 1000,
      absencePenalty: 0.05,
    },
  ],
  // Refinery outage: expect crack spread widening + retail price tick
  // within 7 days. Their absence weakens the "outage causes shortage"
  // narrative.
  'refinery-outage': [
    {
      id: 'crack-spread-widening',
      label: 'crack spread widening',
      domain: 'markets',
      claimSubstring: 'crack',
      windowStartMs: 0,
      windowEndMs: 3 * 24 * 60 * 60 * 1000,
      absencePenalty: 0.1,
    },
    {
      id: 'retail-price-tick',
      label: 'retail fuel price tick up',
      domain: 'markets',
      claimSubstring: 'retail',
      windowStartMs: 0,
      windowEndMs: 7 * 24 * 60 * 60 * 1000,
      absencePenalty: 0.05,
    },
  ],
};

/** Lookup the default expected-signals catalog by eventType. Returns
 *  an empty array when there's no entry — callers should still pass
 *  their own catalog for unknown event types. */
export function defaultExpectedSignalsFor(eventType: string): readonly ExpectedSignal[] {
  return DEFAULT_CATALOG[eventType] ?? [];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
