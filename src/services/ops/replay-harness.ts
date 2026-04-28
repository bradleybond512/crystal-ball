/**
 * Replay harness — gap #8 from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md (closed-loop replay).
 *
 * Takes a list of ReplayFixture objects and executes each fixture's
 * expectations against the fixture's mission events. Returns a
 * deterministic pass/fail report so the test runner + CI can prove
 * "would Crystal Ball warn earlier next time?".
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * The harness implements four expectation kinds:
 *   - warning_before_impact — first user_notified must precede first
 *     actual_impact by at least minLeadTimeMs.
 *   - no_silent_signal — every weak_signal must lead to either a
 *     user_notified OR an explicit dismissal/cancellation.
 *   - requires_confirmation — an app_watch must be paired with an
 *     official_confirmed before any user_notified fires.
 *   - user_action_observed — at least one user_acknowledged or
 *     user_action_taken event must follow the user_notified.
 */

import type { MissionRecord, MissionEvent, MissionEventKind } from './mission-types';
import type { ReplayFixture, ReplayCheck } from './replay-fixtures';

// ── Public API ──────────────────────────────────────────────────────────

export type ExpectationOutcome = 'pass' | 'fail' | 'inapplicable';

export interface ExpectationResult {
  expectationId: string;
  description: string;
  outcome: ExpectationOutcome;
  reason: string;
  /** Pivot timestamps that drove the verdict. */
  pivots?: Record<string, number | undefined>;
}

export interface FixtureRunResult {
  fixtureId: string;
  missionId: string;
  domain: MissionRecord['domain'];
  results: readonly ExpectationResult[];
  /** Worst outcome across this fixture's expectations. */
  outcome: ExpectationOutcome;
  /** Plain-English summary. */
  summary: string;
}

export interface ReplayHarnessReport {
  generatedAt: number;
  results: readonly FixtureRunResult[];
  /** Counts by outcome across all fixtures × expectations. */
  counts: Record<ExpectationOutcome, number>;
  /** Aggregate verdict: 'pass' iff every fixture passed. */
  verdict: ExpectationOutcome;
  /** Plain-English summary. */
  summary: string;
}

export interface RunReplayInput {
  /** ms timestamp for the report. Defaults to Date.now(). */
  generatedAt?: number;
  fixtures: readonly ReplayFixture[];
}

export function runReplay(input: RunReplayInput): ReplayHarnessReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const results = input.fixtures.map((f) => runOne(f));
  const counts: Record<ExpectationOutcome, number> = { pass: 0, fail: 0, inapplicable: 0 };
  for (const r of results) {
    for (const er of r.results) counts[er.outcome] += 1;
  }
  const verdict = decideVerdict(results);
  return {
    generatedAt,
    results,
    counts,
    verdict,
    summary: describeSummary(verdict, counts, results.length),
  };
}

function runOne(fixture: ReplayFixture): FixtureRunResult {
  const events = fixture.mission.events;
  const results = fixture.expectations.map((e) => evaluate(e.id, e.description, e.check, events));
  const outcome = decideFixtureOutcome(results);
  return {
    fixtureId: fixture.fixtureId,
    missionId: fixture.mission.id,
    domain: fixture.mission.domain,
    results,
    outcome,
    summary: describeFixtureSummary(outcome, results),
  };
}

// ── Expectation evaluators ─────────────────────────────────────────────

function evaluate(
  expectationId: string,
  description: string,
  check: ReplayCheck,
  events: readonly MissionEvent[],
): ExpectationResult {
  switch (check.kind) {
    case 'warning_before_impact': {
      return evalWarningBeforeImpact(expectationId, description, check.minLeadTimeMs, events);
    }
    case 'no_silent_signal': {
      return evalNoSilentSignal(expectationId, description, events);
    }
    case 'requires_confirmation': {
      return evalRequiresConfirmation(expectationId, description, events);
    }
    case 'user_action_observed': {
      return evalUserActionObserved(expectationId, description, events);
    }
  }
}

function evalWarningBeforeImpact(
  expectationId: string,
  description: string,
  minLeadTimeMs: number,
  events: readonly MissionEvent[],
): ExpectationResult {
  const warning = firstAt(events, 'user_notified');
  const impact = firstAt(events, 'actual_impact');
  if (impact === undefined) {
    return {
      expectationId,
      description,
      outcome: 'inapplicable',
      reason: 'No actual_impact event recorded.',
      pivots: { warning, impact },
    };
  }
  if (warning === undefined) {
    return {
      expectationId,
      description,
      outcome: 'fail',
      reason: 'Impact occurred but no user_notified event was recorded.',
      pivots: { warning, impact },
    };
  }
  const lead = impact - warning;
  if (lead >= minLeadTimeMs) {
    return {
      expectationId,
      description,
      outcome: 'pass',
      reason: `Warning fired ${formatMs(lead)} before impact (≥ ${formatMs(minLeadTimeMs)}).`,
      pivots: { warning, impact, leadMs: lead },
    };
  }
  return {
    expectationId,
    description,
    outcome: 'fail',
    reason: lead < 0
      ? `Warning fired ${formatMs(-lead)} AFTER impact.`
      : `Lead time ${formatMs(lead)} below the ${formatMs(minLeadTimeMs)} threshold.`,
    pivots: { warning, impact, leadMs: lead },
  };
}

function evalNoSilentSignal(
  expectationId: string,
  description: string,
  events: readonly MissionEvent[],
): ExpectationResult {
  const signals = events.filter((e) => e.kind === 'weak_signal');
  if (signals.length === 0) {
    return {
      expectationId,
      description,
      outcome: 'inapplicable',
      reason: 'No weak_signal events to check.',
    };
  }
  // A weak signal is "silent" if no user_notified or forecast_resolved
  // / cancelled event followed it (the gameplan's "every weak signal
  // either escalates or is explicitly dismissed" rule).
  const followers = events.filter((e) =>
    e.kind === 'user_notified' || e.kind === 'forecast_resolved' || e.kind === 'near_miss');
  if (followers.length === 0) {
    return {
      expectationId,
      description,
      outcome: 'fail',
      reason: 'Weak signal recorded but never escalated, dismissed, or flagged as a near-miss.',
    };
  }
  // At least one follower exists for every weak signal in time-order.
  for (const sig of signals) {
    const hasFollower = followers.some((f) => f.at >= sig.at);
    if (!hasFollower) {
      return {
        expectationId,
        description,
        outcome: 'fail',
        reason: `Weak signal at ${new Date(sig.at).toISOString()} never escalated.`,
      };
    }
  }
  return {
    expectationId,
    description,
    outcome: 'pass',
    reason: `${signals.length} weak signal${signals.length === 1 ? '' : 's'} all escalated, dismissed, or flagged.`,
  };
}

function evalRequiresConfirmation(
  expectationId: string,
  description: string,
  events: readonly MissionEvent[],
): ExpectationResult {
  const watch = firstAt(events, 'app_watch');
  const notified = firstAt(events, 'user_notified');
  const confirmed = firstAt(events, 'official_confirmed');
  if (watch === undefined) {
    return {
      expectationId,
      description,
      outcome: 'inapplicable',
      reason: 'No app_watch event — confirmation rule does not apply.',
    };
  }
  if (notified === undefined) {
    return {
      expectationId,
      description,
      outcome: 'pass',
      reason: 'No user_notified event fired — nothing to validate against confirmation.',
      pivots: { watch, confirmed, notified },
    };
  }
  if (confirmed === undefined || confirmed > notified) {
    return {
      expectationId,
      description,
      outcome: 'fail',
      reason: 'user_notified fired without a prior official_confirmed.',
      pivots: { watch, confirmed, notified },
    };
  }
  return {
    expectationId,
    description,
    outcome: 'pass',
    reason: 'Confirmation observed before notification.',
    pivots: { watch, confirmed, notified },
  };
}

function evalUserActionObserved(
  expectationId: string,
  description: string,
  events: readonly MissionEvent[],
): ExpectationResult {
  const notified = firstAt(events, 'user_notified');
  if (notified === undefined) {
    return {
      expectationId,
      description,
      outcome: 'inapplicable',
      reason: 'No user_notified event to follow.',
    };
  }
  const ack = events.find(
    (e) => (e.kind === 'user_acknowledged' || e.kind === 'user_action_taken') && e.at >= notified,
  );
  if (!ack) {
    return {
      expectationId,
      description,
      outcome: 'fail',
      reason: 'User notification was sent but never acknowledged or acted upon.',
      pivots: { notified },
    };
  }
  return {
    expectationId,
    description,
    outcome: 'pass',
    reason: `User ${ack.kind} at ${new Date(ack.at).toISOString()}.`,
    pivots: { notified, ack: ack.at },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function firstAt(events: readonly MissionEvent[], kind: MissionEventKind): number | undefined {
  let best: number | undefined;
  for (const e of events) {
    if (e.kind !== kind) continue;
    if (best === undefined || e.at < best) best = e.at;
  }
  return best;
}

const OUTCOME_RANK: Record<ExpectationOutcome, number> = {
  pass: 0,
  inapplicable: 1,
  fail: 2,
};

function worstOutcome(items: readonly { outcome: ExpectationOutcome }[]): ExpectationOutcome {
  if (items.length === 0) return 'inapplicable';
  let worst: ExpectationOutcome = 'pass';
  for (const r of items) {
    if (OUTCOME_RANK[r.outcome] > OUTCOME_RANK[worst]) worst = r.outcome;
  }
  return worst;
}

const decideFixtureOutcome = worstOutcome;
const decideVerdict = worstOutcome;

function describeFixtureSummary(
  outcome: ExpectationOutcome,
  results: readonly ExpectationResult[],
): string {
  if (results.length === 0) return 'No expectations declared.';
  const counts = { pass: 0, fail: 0, inapplicable: 0 };
  for (const r of results) counts[r.outcome] += 1;
  if (outcome === 'pass') return `All ${results.length} expectations passed.`;
  if (outcome === 'inapplicable') return `Inapplicable (${counts.inapplicable} of ${results.length}).`;
  const failing = counts.fail;
  return `${failing} of ${results.length} expectation${results.length === 1 ? '' : 's'} failed.`;
}

function describeSummary(
  verdict: ExpectationOutcome,
  counts: Record<ExpectationOutcome, number>,
  fixtureCount: number,
): string {
  if (fixtureCount === 0) return 'No replay fixtures supplied.';
  const inapplicableSuffix = counts.inapplicable
    ? `, ${counts.inapplicable} inapplicable`
    : '';
  if (verdict === 'pass') {
    return `All ${fixtureCount} fixtures pass (${counts.pass} expectations satisfied${inapplicableSuffix}).`;
  }
  return `Replay verdict: ${verdict.toUpperCase()} — ${counts.fail} failed, ${counts.pass} passed${inapplicableSuffix}.`;
}

function formatMs(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return `${Math.round(ms / 1000)}s`;
  if (abs < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  if (abs < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)} h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)} d`;
}
