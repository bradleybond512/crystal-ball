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
   * Replay-fixture + backtest results fed to the policy gate. Default false
   * (conservative): the gate then holds every tuning for approval.
   *
   * NOTE (B2-enable investigation, 2026-06-06): these are NOT auto-derived
   * from the existing harnesses, and deliberately so. The replay-fixtures
   * CATALOG is a set of known-FAILING regression demos (its aggregate
   * verdict is permanently `fail`), so feeding it here would build a gate
   * that can never open. The backtest-engine models driver-weights /
   * severity-bands, not algorithm-tuning knobs like
   * `big-event-detector.threshold`, so it would trivially "pass" without
   * actually testing the change. An honest auto-apply switch needs
   * purpose-built tuning-safety fixtures (a suite a BAD tuning would
   * regress) — see the gameplan's revised B2-enable step. Until then the
   * caller must pass an explicit, honestly-computed boolean.
   */
  replayPassed?: boolean;
  backtestPassed?: boolean;
  /** Apply sink — defaults to the tunable-params store. */
  apply?: (algorithmId: string, parameterId: string, value: number) => void;
}

/**
 * Run one tuning-apply pass. Side effects: writes accepted values to the
 * tunable-params store and logs them. Safe to call repeatedly. Injectable for
 * tests.
 */
export function runTuningApply(deps: TuningApplyDeps = {}): TuningApplyResult {
  const ledger = deps.ledger ?? getAlgorithmEvaluationLedger();
  const definitions = deps.definitions ?? getAlgorithmDefinitions();
  const apply = deps.apply ?? setTunedParam;
  const tunings = deps.tunings ?? getTunings();
  const replayPassed = deps.replayPassed ?? false;
  const backtestPassed = deps.backtestPassed ?? false;
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

    const prior = p.priorValue ?? Number.NaN;
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
