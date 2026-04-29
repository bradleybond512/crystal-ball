/**
 * Quality-debt singleton + live collector — per
 * docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md
 * Priority 4.
 *
 * Until now the quality-debt registry existed and the four adapters
 * (smoke / provider / algorithm-health / failure-prediction) existed,
 * but nothing fed live diagnostic state into them. This module:
 *
 *   1. Holds the singleton registry the host loop writes to.
 *   2. Exposes collectLiveQualityDebt() — runs the adapters against
 *      the current diagnostics snapshot + algorithm health and
 *      upserts seeds into the registry. Idempotent: re-running with
 *      the same inputs collapses to the same id set.
 *   3. Exposes getActiveQualityDebt() so panels (System Diagnostic,
 *      Command Center) and the export bundle composer can read it.
 *
 * Pure-ish: takes Date.now() and reads diagnostics-state singletons,
 * but the seeds the adapters produce are deterministic given input.
 */

import {
  createQualityDebtRegistry,
  type DebtItem,
  type QualityDebtRegistry,
} from './quality-debt';
import {
  debtFromAlgorithmHealth,
  debtFromFailurePrediction,
  debtFromProviderSnapshots,
  debtFromSmokeOutcomes,
  type DebtSeed,
  type SmokePanelOutcome,
} from './quality-debt-adapters';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import type { ProviderSnapshot } from '@/services/diagnostics/provider-redundancy';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import type { PredictedRiskReport } from '@/services/diagnostics/failure-prediction';

// ── Singleton ───────────────────────────────────────────────────────────

let registry: QualityDebtRegistry | undefined;

export function getQualityDebtRegistry(): QualityDebtRegistry {
  registry ??= createQualityDebtRegistry();
  return registry;
}

/** Reset for tests. */
export function resetQualityDebtForTests(): void {
  registry = undefined;
}

// ── Live collector ──────────────────────────────────────────────────────

export interface CollectLiveQualityDebtInput {
  /** Optional smoke-test outcomes (CI / dev). */
  smokeOutcomes?: readonly SmokePanelOutcome[];
  /** Optional provider redundancy snapshots. */
  providerSnapshots?: readonly ProviderSnapshot[];
  /** Optional algorithm health rows. */
  algorithmHealth?: readonly AlgorithmHealth[];
  /** Optional failure prediction report. */
  failurePrediction?: PredictedRiskReport;
  /** Optional clock for tests. */
  now?: () => number;
}

/**
 * Run the four adapters against the live state, dedupe seeds by id,
 * and upsert into the singleton registry. Returns the resulting
 * active-debt list (open + acknowledged + in_progress, sorted by
 * impact desc).
 *
 * Calling with no inputs is a no-op — the host can pass partial input
 * and the collector will only update the categories that have data.
 */
export function collectLiveQualityDebt(
  input: CollectLiveQualityDebtInput = {},
): readonly DebtItem[] {
  const now = input.now ?? Date.now;
  const reg = getQualityDebtRegistry();

  const seeds: DebtSeed[] = [];
  if (input.smokeOutcomes && input.smokeOutcomes.length > 0) {
    seeds.push(...debtFromSmokeOutcomes(input.smokeOutcomes, now()));
  }
  if (input.providerSnapshots && input.providerSnapshots.length > 0) {
    seeds.push(...debtFromProviderSnapshots(input.providerSnapshots, now()));
  }
  if (input.algorithmHealth && input.algorithmHealth.length > 0) {
    seeds.push(...debtFromAlgorithmHealth(input.algorithmHealth, now()));
  }
  if (input.failurePrediction) {
    seeds.push(...debtFromFailurePrediction(input.failurePrediction, now()));
  }

  // Dedupe seeds by id within this batch (an algorithm might appear
  // in both health and failure-prediction, for instance).
  const byId = new Map<string, DebtSeed>();
  for (const seed of seeds) byId.set(seed.id, seed);

  for (const seed of byId.values()) {
    const existing = reg.get(seed.id);
    if (existing) {
      // Already in registry; nothing to update — adapters produce
      // identical fields for identical signals, so this is a no-op
      // by design (re-running keeps the recordedAt timestamp from
      // the first observation).
      continue;
    }
    reg.record({ ...seed });
  }

  return reg.active();
}

/** Read-only accessor used by panels + export bundle composer. */
export function getActiveQualityDebt(): readonly DebtItem[] {
  return getQualityDebtRegistry().active();
}

/** Convenience: pull the live snapshot's panels (silent/errored only)
 *  and convert them into smoke outcomes the collector can consume.
 *  Useful when the host wants to feed runtime panel state without
 *  running the smoke harness. */
export function smokeOutcomesFromLiveSnapshot(): readonly SmokePanelOutcome[] {
  const snapshot = getLiveDiagnosticsSnapshot();
  const outcomes: SmokePanelOutcome[] = [];
  for (const p of snapshot.panels) {
    if (p.status === 'failing' || p.status === 'unsafe') {
      outcomes.push({
        panelId: p.panelId,
        state: p.status === 'unsafe' ? 'errored' : 'silent',
        reason: `panel-health status=${p.status}`,
      });
    }
  }
  return outcomes;
}
