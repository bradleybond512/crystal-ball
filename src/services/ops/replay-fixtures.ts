/**
 * Replay fixtures — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 6.
 *
 * Turns mission records and near-miss reports into JSON fixtures
 * the replay harness can re-feed into the algorithms to ask
 * "would Crystal Ball have warned me?". The gameplan's
 * Simulation/Replay section lists the cases: severe storm miss,
 * market shock, cyber exploit, hurricane landfall, oil disruption,
 * food shortage. Every miss becomes a regression test.
 *
 * Pure deterministic.
 */

import type { MissionRecord } from './mission-types';
import type { NearMissReport } from './near-miss';

// ── Public API ──────────────────────────────────────────────────────────

export interface ReplayFixture {
  /** Schema version. Bumped on shape changes. */
  schemaVersion: 1;
  /** Stable id derived from mission id + kind. */
  fixtureId: string;
  /** ms timestamp when the fixture was generated. */
  generatedAt: number;
  /** Source mission record (events kept as-is for replay). */
  mission: MissionRecord;
  /** The near-miss kind being replayed (when applicable). */
  nearMissKind?: string;
  /** Free-text rationale — why this case is worth replaying. */
  rationale: string;
  /** Pivot timestamps the replay harness uses for assertions. */
  pivots: {
    signalAt?: number;
    warningAt?: number;
    impactAt?: number;
  };
  /** Expected behavior the harness should assert. */
  expectations: ReplayExpectation[];
}

export interface ReplayExpectation {
  /** Stable id, e.g. "warning_before_impact". */
  id: string;
  description: string;
  /** Concrete check the harness can run. */
  check: ReplayCheck;
}

export type ReplayCheck =
  | { kind: 'warning_before_impact'; minLeadTimeMs: number }
  | { kind: 'no_silent_signal' }
  | { kind: 'requires_confirmation' }
  | { kind: 'user_action_observed' };

export interface BuildReplayFixturesInput {
  generatedAt?: number;
  /** Missions to consider. */
  missions: readonly MissionRecord[];
  /** Optional pre-computed near-miss reports — when present, every
   *  mission with a near-miss becomes a fixture. */
  nearMisses?: readonly NearMissReport[];
  /** Default minimum lead time for the warning_before_impact check.
   *  Domain-specific values can be passed in via overrides. */
  defaultMinLeadTimeMs?: number;
}

const DEFAULT_MIN_LEAD_TIME_MS = 5 * 60 * 1000; // 5 minutes is the floor for "we knew before"

export function buildReplayFixtures(
  input: BuildReplayFixturesInput,
): ReplayFixture[] {
  const generatedAt = input.generatedAt ?? Date.now();
  const minLead = input.defaultMinLeadTimeMs ?? DEFAULT_MIN_LEAD_TIME_MS;
  const nearMissByMission = new Map<string, NearMissReport>();
  for (const nm of input.nearMisses ?? []) {
    nearMissByMission.set(nm.missionId, nm);
  }
  const out: ReplayFixture[] = [];
  for (const m of input.missions) {
    const fixture = buildOneFixture(m, nearMissByMission.get(m.id), minLead, generatedAt);
    if (fixture) out.push(fixture);
  }
  return out;
}

function buildOneFixture(
  m: MissionRecord,
  nm: NearMissReport | undefined,
  minLead: number,
  generatedAt: number,
): ReplayFixture | undefined {
  if (m.status !== 'resolved_miss' && !nm && !worthHitFixture(m)) return undefined;
  const pivots = extractPivots(m);
  const expectations = buildExpectations(m, nm, pivots, minLead);
  return {
    schemaVersion: 1,
    fixtureId: `fixture-${m.id}-${nm?.kind ?? m.status}`,
    generatedAt,
    mission: cloneMission(m),
    nearMissKind: nm?.kind,
    rationale: buildRationale(m, nm),
    pivots,
    expectations,
  };
}

function buildExpectations(
  m: MissionRecord,
  nm: NearMissReport | undefined,
  pivots: ReplayFixture['pivots'],
  minLead: number,
): ReplayExpectation[] {
  const expectations: ReplayExpectation[] = [];
  if (nm?.kind === 'late_warning' || (m.status === 'resolved_miss' && pivots.impactAt !== undefined)) {
    expectations.push({
      id: 'warning_before_impact',
      description: `Warning must fire ≥ ${formatMs(minLead)} before impact.`,
      check: { kind: 'warning_before_impact', minLeadTimeMs: minLead },
    });
  }
  if (nm?.kind === 'silent_signal') {
    expectations.push({
      id: 'no_silent_signal',
      description: 'A weak signal must always lead to either dismissal or a notification.',
      check: { kind: 'no_silent_signal' },
    });
  }
  if (nm?.kind === 'unconfirmed') {
    expectations.push({
      id: 'requires_confirmation',
      description: 'Watch must require a confirmed source before alerting.',
      check: { kind: 'requires_confirmation' },
    });
  }
  if (nm?.kind === 'low_follow_through') {
    expectations.push({
      id: 'user_action_observed',
      description: 'Notification should drive a user acknowledgement.',
      check: { kind: 'user_action_observed' },
    });
  }
  if (expectations.length === 0) {
    expectations.push({
      id: 'warning_before_impact',
      description: `Default check: warning fires ≥ ${formatMs(minLead)} before impact.`,
      check: { kind: 'warning_before_impact', minLeadTimeMs: minLead },
    });
  }
  return expectations;
}

function buildRationale(m: MissionRecord, nm: NearMissReport | undefined): string {
  if (nm?.description) return nm.description;
  if (m.status === 'resolved_miss') {
    return 'Mission resolved as a miss — replay fixture for the next algorithm tweak.';
  }
  return 'Hit with thin lead time — replay to keep the early-warning behavior pinned.';
}

// ── Helpers ─────────────────────────────────────────────────────────────

function extractPivots(m: MissionRecord): ReplayFixture['pivots'] {
  let signalAt: number | undefined;
  let warningAt: number | undefined;
  let impactAt: number | undefined;
  for (const e of m.events) {
    if (e.kind === 'weak_signal' && (signalAt === undefined || e.at < signalAt)) signalAt = e.at;
    if (e.kind === 'user_notified' && (warningAt === undefined || e.at < warningAt)) warningAt = e.at;
    if (e.kind === 'actual_impact' && (impactAt === undefined || e.at < impactAt)) impactAt = e.at;
  }
  return { signalAt, warningAt, impactAt };
}

function worthHitFixture(m: MissionRecord): boolean {
  if (m.status !== 'resolved_hit') return false;
  const pivots = extractPivots(m);
  if (pivots.warningAt === undefined || pivots.impactAt === undefined) return false;
  // "Thin lead time" = ≤ 10 min — small enough to be worth pinning.
  return pivots.impactAt - pivots.warningAt <= 10 * 60 * 1000;
}

function cloneMission(m: MissionRecord): MissionRecord {
  return {
    ...m,
    events: m.events.map((e) => ({ ...e, detail: e.detail ? { ...e.detail } : undefined })),
  };
}

function formatMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)} h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)} d`;
}
