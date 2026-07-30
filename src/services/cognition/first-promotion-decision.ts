/**
 * ACC-404 — First production promotion decision.
 *
 * Pure decision recorder over ACC-402 gate outputs. The roadmap's
 * contract: promote a challenger only if it passes every gate;
 * otherwise record `REJECTED` (evidence was sufficient, quality/safety
 * gates failed) or continue `MONITOR` with the EXACT missing evidence
 * (evidence floors not met). A no-promotion result is a valid, complete
 * decision — the point is that it is evidence-backed and recorded, not
 * that something gets promoted.
 *
 * Per-challenger verdict:
 *   - gate recommendation 'promote'           → PROMOTE
 *   - a min-pairs gate failed                 → MONITOR (missingEvidence
 *     lists each unmet floor verbatim from the gate details)
 *   - floors met but any other gate failed    → REJECTED (failingGates
 *     lists each failure verbatim)
 *
 * Overall record outcome:
 *   - any challenger PROMOTE   → 'PROMOTE' (promotedChallengerId set)
 *   - else any REJECTED        → 'REJECTED'
 *   - else                     → 'MONITOR'
 *
 * Pure module — no DOM, no fetch, no globals, no Date.now(). Persistence
 * is a thin injectable-storage helper under
 * 'crystalball-acc404-first-decision-v1'.
 */

import type { PromotionDecision } from './promotion-gate';

// ── Public types ──────────────────────────────────────────────────────

export type FirstPromotionOutcome = 'PROMOTE' | 'REJECTED' | 'MONITOR';

export interface ChallengerDecisionInput {
  runId: string;
  challengerId: string;
  decision: PromotionDecision;
}

export interface ChallengerVerdict {
  runId: string;
  challengerId: string;
  verdict: FirstPromotionOutcome;
  evidenceCount: number;
  /** Unmet evidence floors, verbatim from the gate (MONITOR only). */
  missingEvidence: string[];
  /** Failed quality/safety gates, verbatim (REJECTED only). */
  failingGates: string[];
}

export interface FirstPromotionDecisionRecord {
  schemaVersion: 1;
  slot: string;
  decidedAt: number;
  outcome: FirstPromotionOutcome;
  /** Set only when outcome is 'PROMOTE'. */
  promotedChallengerId?: string;
  verdicts: ChallengerVerdict[];
  /** One-paragraph human summary of the decision. */
  summary: string;
}

export interface DecideFirstPromotionInput {
  slot: string;
  challengers: readonly ChallengerDecisionInput[];
  /** ms timestamp stamped on the record (injected — pure module). */
  decidedAt: number;
}

export const FIRST_DECISION_STORAGE_KEY = 'crystalball-acc404-first-decision-v1';

const EVIDENCE_GATE_IDS = new Set(['min-pairs-overall', 'min-pairs-per-domain']);

// ── Decide ────────────────────────────────────────────────────────────

export function decideFirstPromotion(input: DecideFirstPromotionInput): FirstPromotionDecisionRecord {
  const verdicts = input.challengers.map((c) => challengerVerdict(c));
  const promoted = verdicts.find((v) => v.verdict === 'PROMOTE');
  let outcome: FirstPromotionOutcome = 'MONITOR';
  if (promoted) outcome = 'PROMOTE';
  else if (verdicts.some((v) => v.verdict === 'REJECTED')) outcome = 'REJECTED';
  return {
    schemaVersion: 1,
    slot: input.slot,
    decidedAt: input.decidedAt,
    outcome,
    ...(promoted ? { promotedChallengerId: promoted.challengerId } : {}),
    verdicts,
    summary: summarize(input.slot, outcome, verdicts, promoted?.challengerId),
  };
}

function challengerVerdict(c: ChallengerDecisionInput): ChallengerVerdict {
  const d = c.decision;
  const failedEvidence = d.gates.filter((g) => !g.pass && EVIDENCE_GATE_IDS.has(g.id));
  const failedQuality = d.gates.filter((g) => !g.pass && !EVIDENCE_GATE_IDS.has(g.id));
  let verdict: FirstPromotionOutcome = 'REJECTED';
  if (d.recommendation === 'promote') verdict = 'PROMOTE';
  else if (failedEvidence.length > 0) verdict = 'MONITOR';
  return {
    runId: c.runId,
    challengerId: c.challengerId,
    verdict,
    evidenceCount: d.pairCount,
    missingEvidence: verdict === 'MONITOR' ? failedEvidence.map((g) => g.detail) : [],
    failingGates: verdict === 'REJECTED' ? failedQuality.map((g) => g.detail) : [],
  };
}

function summarize(
  slot: string,
  outcome: FirstPromotionOutcome,
  verdicts: readonly ChallengerVerdict[],
  promotedId?: string,
): string {
  if (outcome === 'PROMOTE') {
    return `Promote '${promotedId}' into slot '${slot}' — every gate passed on ${verdicts.find((v) => v.challengerId === promotedId)?.evidenceCount ?? 0} joined pairs.`;
  }
  const parts = verdicts.map((v) => {
    if (v.verdict === 'REJECTED') return `${v.challengerId}: REJECTED (${v.failingGates.length} failing gates)`;
    if (v.verdict === 'PROMOTE') return `${v.challengerId}: promotable`;
    return `${v.challengerId}: MONITOR (${v.evidenceCount} pairs)`;
  });
  const head = outcome === 'REJECTED'
    ? `No promotion into slot '${slot}' — at least one challenger had sufficient evidence and failed quality/safety gates.`
    : `No promotion into slot '${slot}' — no challenger has met the evidence floors yet; continue monitoring.`;
  return `${head} ${parts.join('; ')}.`;
}

// ── Persistence (injectable storage) ─────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function persistFirstPromotionDecision(
  record: FirstPromotionDecisionRecord,
  storage: StorageLike,
): void {
  try {
    storage.setItem(FIRST_DECISION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // best effort — the durable record also lives in docs/decisions/.
  }
}

export function loadFirstPromotionDecision(
  storage: StorageLike,
): FirstPromotionDecisionRecord | null {
  try {
    const raw = storage.getItem(FIRST_DECISION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirstPromotionDecisionRecord | null;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.verdicts)) return null;
    return parsed;
  } catch {
    return null;
  }
}
