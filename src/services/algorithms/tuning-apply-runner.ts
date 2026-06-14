/**
 * Tuning Apply Runner — B2 of the self-improvement gameplan.
 *
 * Closes the loop: builds the algorithm health report from the (now graded)
 * evaluation ledger, asks `safe-adjustment` for parameter proposals against
 * the declared tunables, runs each through the governance `policy-gate`, and
 * AUTO-APPLIES only those the gate marks `allow_auto` — writing the new value
 * into the tunable-params store and logging the before/after with a revert.
 *
 * "Auto-apply safe" (locked gameplan decision): the policy gate auto-denies
 * safety-critical algorithms and requires evidence/approval otherwise, so a
 * change only lands when it clears every gate. Proposals that need approval
 * are counted and surfaced (the AlgorithmDiagnosticPanel renders them), never
 * silently applied.
 */

import { getAlgorithmEvaluationLedger, getAlgorithmDefinitions } from './algorithms-state';
import { summarizeCalibration, type AlgorithmEvaluationLedger } from './algorithm-evaluation-ledger';
import { aggregateAlgorithmHealth, type AlgorithmDefinition } from './algorithm-health';
import { proposeAdjustments } from './safe-adjustment';
import { gateAdjustmentProposal } from '@/services/governance/policy-gate';
import { getTunings, setTunedParam, tunableAffectsNotifications } from './tunable-params-store';
import { recordTuningDecision } from './tuning-decision-log';
import { proposeTuningSafety } from './tuning-safety-fixtures';
import { backtestChange, isBacktestable, type BacktestResult } from './historical-backtest';
import type { AlgorithmAdjustmentTuning } from './safe-adjustment';

export interface TuningApplyResult {
  /** Proposals whose verdict was 'apply' (a concrete value change). */
  proposed: number;
  /** Changes auto-applied (gate said allow_auto) and written to the store. */
  applied: number;
  /** Changes the gate held back for user approval / denied. */
  heldForApproval: number;
}

export interface TuningApplyDeps {
  ledger?: AlgorithmEvaluationLedger;
  definitions?: readonly AlgorithmDefinition[];
  /** Declared tunables to propose against. Defaults to the live store.
   *  Injectable so the auto-apply path can be exercised end-to-end in a
   *  test without mutating the production declaration set. */
  tunings?: readonly AlgorithmAdjustmentTuning[];
  /**
   * Explicit override for the gate's `replayPassed` signal. When UNSET
   * (the production default), the runner computes it PER PROPOSAL from the
   * tuning-safety fixtures via `safetyCheck` below — honestly: a candidate
   * value passes only if it does not regress the knob's safety suite, and a
   * knob with no suite fails closed. Set explicitly only in tests.
   *
   * (B2-enable, 2026-06-06: this replaced the always-false default. The
   * replay-fixtures CATALOG and the backtest-engine cannot supply an honest
   * per-tuning boolean — see `tuning-safety-fixtures.ts` and the gameplan.)
   */
  replayPassed?: boolean;
  /**
   * Explicit override for the gate's `backtestPassed` signal. When UNSET (the
   * production default), the runner computes it PER PROPOSAL by replaying the
   * candidate value against the last 30 days of graded ledger history via
   * `historical-backtest` — honestly: a change passes only if it does not
   * regress the algorithm's accuracy over that window, and a knob that isn't
   * backtestable (its score isn't comparable to the threshold) fails closed.
   * Set explicitly only in tests.
   *
   * (Backtest-before-apply gate, Phase 4: this replaced the always-false
   * default. The synthetic `backtest-engine` cannot score an arbitrary knob;
   * see `historical-backtest.ts`.)
   */
  backtestPassed?: boolean;
  /** Reference clock for the backtest's rolling window. Defaults to Date.now().
   *  Injectable so the historical window is reproducible in tests. */
  now?: () => number;
  /** Per-proposal safety signal (algorithmId, parameterId, current, next) →
   *  safe?. Defaults to the tuning-safety fixtures. Injectable for tests. */
  safetyCheck?: (algorithmId: string, parameterId: string, currentValue: number, nextValue: number) => boolean;
  /** Apply sink — defaults to the tunable-params store. */
  apply?: (algorithmId: string, parameterId: string, value: number) => void;
}

/**
 * Run one tuning-apply pass. Side effects: writes accepted values to the
 * tunable-params store and logs them. Safe to call repeatedly. Injectable for
 * tests.
 */
/** Per-proposal safety evaluation that fails closed on a non-finite prior or
 *  a throwing scorer — a bad proposal can never abort the whole pass. */
function safetyPasses(
  check: (algorithmId: string, parameterId: string, currentValue: number, nextValue: number) => boolean,
  algorithmId: string,
  parameterId: string,
  prior: number,
  next: number,
): boolean {
  if (!Number.isFinite(prior)) return false;
  try {
    return check(algorithmId, parameterId, prior, next);
  } catch {
    return false;
  }
}

export function runTuningApply(deps: TuningApplyDeps = {}): TuningApplyResult {
  const ledger = deps.ledger ?? getAlgorithmEvaluationLedger();
  const definitions = deps.definitions ?? getAlgorithmDefinitions();
  const apply = deps.apply ?? setTunedParam;
  const tunings = deps.tunings ?? getTunings();
  const safetyCheck = deps.safetyCheck ?? proposeTuningSafety;
  const now = deps.now ?? (() => Date.now());
  const calibrations = summarizeCalibration(ledger.all());
  const report = aggregateAlgorithmHealth({ definitions, calibrations });
  const proposals = proposeAdjustments({ reports: [...report.algorithms], tunings });

  const defById = new Map(definitions.map((d) => [d.algorithmId, d]));
  let proposed = 0;
  let applied = 0;
  let heldForApproval = 0;

  for (const p of proposals) {
    if (p.verdict !== 'apply' || p.parameterId === undefined || p.nextValue === undefined) continue;
    proposed += 1;

    const def = defById.get(p.algorithmId);
    const cal = report.algorithms.find((a) => a.algorithmId === p.algorithmId)?.calibration;
    const prior = p.priorValue ?? Number.NaN;
    // Honest per-proposal safety signal: a candidate value passes only if it
    // does not regress the knob's safety fixtures. Without a finite prior we
    // can't assess the change; and a throwing scorer must fail closed for
    // THIS proposal only (never abort the pass or leave partial applies).
    const replayPassed = deps.replayPassed ?? safetyPasses(safetyCheck, p.algorithmId, p.parameterId, prior, p.nextValue);
    // Honest per-proposal backtest: replay the candidate against the last 30
    // days of graded history. A non-backtestable knob or a regressing change
    // fails closed, so the gate can never auto-apply a change we can't prove
    // doesn't hurt accuracy. (The result is surfaced when it blocks a change.)
    let backtestResult: BacktestResult | undefined;
    let backtestPassed: boolean;
    if (deps.backtestPassed !== undefined) {
      backtestPassed = deps.backtestPassed;
    } else {
      backtestResult = backtestChange(
        { algorithmId: p.algorithmId, parameterId: p.parameterId, priorValue: prior, nextValue: p.nextValue },
        ledger.byAlgorithm(p.algorithmId),
        { now: now() },
      );
      backtestPassed = backtestResult.verdict === 'pass';
    }
    // Hard backtest enforcement, independent of criticality. The policy gate
    // only consults `backtestPassed` for high-criticality tunings and promotes,
    // so a backtestable knob that REGRESSES accuracy could otherwise still
    // auto-apply at low/medium criticality if it cleared the other signals.
    // When we actually replayed the change (no test override) and it failed for
    // a knob we know how to backtest, block it here — hold for approval — before
    // the gate ever sees it. Non-backtestable knobs are NOT short-circuited
    // here: they fall through to the gate (which fails them closed only where it
    // requires a backtest), so the live loop is never frozen by this guard.
    if (backtestResult && backtestResult.verdict === 'fail' && isBacktestable(p.algorithmId, p.parameterId)) {
      heldForApproval += 1;
      recordTuningDecision({
        at: p.generatedAt,
        algorithmId: p.algorithmId,
        parameterId: p.parameterId,
        priorValue: prior,
        nextValue: p.nextValue,
        kind: 'held_for_approval',
        ruleId: 'backtest_blocked',
        reason: backtestResult.reason,
      });
      // eslint-disable-next-line no-console -- bridged to the desktop log; a blocked regression must be auditable
      console.warn(`[backtest] held ${p.algorithmId}.${p.parameterId} ${prior} → ${p.nextValue}: ${backtestResult.reason}`);
      continue;
    }
    const gated = gateAdjustmentProposal({
      proposal: p,
      algorithm: def ? { id: def.algorithmId, criticality: def.criticality, domain: def.domain } : undefined,
      evidenceCount: cal?.graded ?? 0,
      replayPassed,
      backtestPassed,
      // Notification-affecting knobs get the gate's stricter approval rule so
      // auto-tuning can never silently change what the user is alerted about.
      affectsNotifications: tunableAffectsNotifications(p.algorithmId, p.parameterId),
    });

    if (gated.verdict.decision === 'allow_auto') {
      apply(p.algorithmId, p.parameterId, p.nextValue);
      applied += 1;
      recordTuningDecision({
        at: p.generatedAt,
        algorithmId: p.algorithmId,
        parameterId: p.parameterId,
        priorValue: prior,
        nextValue: p.nextValue,
        kind: 'applied',
        ruleId: gated.verdict.ruleId,
        reason: gated.verdict.reason,
      });
      // eslint-disable-next-line no-console -- bridged to the desktop log; auto-apply must be auditable
      console.warn(
        `[tuning] auto-applied ${p.algorithmId}.${p.parameterId}: ${prior} → ${p.nextValue}`
        + ` | ${p.rationale}`
        + ` | revert: setTunedParam('${p.algorithmId}','${p.parameterId}',${prior})`,
      );
    } else {
      heldForApproval += 1;
      recordTuningDecision({
        at: p.generatedAt,
        algorithmId: p.algorithmId,
        parameterId: p.parameterId,
        priorValue: prior,
        nextValue: p.nextValue,
        kind: 'held_for_approval',
        ruleId: gated.verdict.ruleId,
        reason: gated.verdict.reason,
      });
    }
  }

  return { proposed, applied, heldForApproval };
}

const DEFAULT_CADENCE_MS = 6 * 60 * 60 * 1000; // every 6h

let _timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic tuning-apply cadence (idempotent). Returns a stop fn. */
export function startTuningApplyCadence(intervalMs: number = DEFAULT_CADENCE_MS): () => void {
  if (_timer !== null) return stopTuningApplyCadence;
  _timer = setInterval(() => {
    try {
      runTuningApply();
    } catch {
      /* never let the cadence throw */
    }
  }, intervalMs);
  (_timer as unknown as { unref?: () => void }).unref?.();
  return stopTuningApplyCadence;
}

export function stopTuningApplyCadence(): void {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
}
