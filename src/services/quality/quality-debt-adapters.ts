/**
 * Quality Debt Adapters — turn real diagnostics signals into
 * `DebtItem` rows the registry can ingest.
 *
 * The registry itself stays append-only and category-strict; these
 * adapters do the translation work. Each adapter takes a snapshot
 * of one diagnostic surface and returns a (possibly empty) array
 * of debt items keyed deterministically so re-running the adapter
 * with the same inputs produces the same ids — letting the host
 * dedup safely.
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable.
 *   - Deterministic — same snapshot ⇒ same debt-item list.
 *   - Adapter ids are namespaced by source so a future second source
 *     of the same category doesn't collide.
 */

import type {
  DebtItem,
  DebtSeverity,
} from './quality-debt';
import type { PredictedRiskReport } from '@/services/diagnostics/failure-prediction';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import type { ProviderSnapshot } from '@/services/diagnostics/provider-redundancy';

// ── Public API ──────────────────────────────────────────────────────────

export type DebtSeed = Omit<DebtItem, 'id' | 'status' | 'recordedAt'> & { id: string };

export interface SmokePanelOutcome {
  panelId: string;
  state: 'rendered' | 'degraded' | 'silent' | 'errored' | 'skipped';
  reason: string;
}

// ── Adapters ────────────────────────────────────────────────────────────

/**
 * Map panel-smoke outcomes → debt items. Only `silent` and `errored`
 * states produce debt — `degraded` is the documented contract for
 * panels that show a banner with reason, so it isn't debt.
 */
export function debtFromSmokeOutcomes(
  outcomes: readonly SmokePanelOutcome[],
  now: number = Date.now(),
): DebtSeed[] {
  const items: DebtSeed[] = [];
  for (const outcome of outcomes) {
    if (outcome.state === 'rendered' || outcome.state === 'degraded' || outcome.state === 'skipped') continue;
    const severity: DebtSeverity = outcome.state === 'errored' ? 'high' : 'medium';
    items.push({
      id: `panel-smoke:${outcome.panelId}:${outcome.state}`,
      category: 'untested_domains',
      severity,
      ownerArea: 'diagnostics',
      impact: `Panel ${outcome.panelId} is ${outcome.state} in the smoke harness`,
      recommendedFix: outcome.state === 'errored'
        ? `Fix the throw in ${outcome.panelId} (see harness reason: ${outcome.reason})`
        : `Have ${outcome.panelId} render a placeholder / degraded banner so the user knows it loaded`,
      evidence: {
        sourceId: 'panel-smoke',
        detail: { panelId: outcome.panelId, state: outcome.state, reason: outcome.reason },
        at: now,
      },
    });
  }
  return items;
}

/**
 * Map provider-redundancy snapshots → debt items. Silent or all-down
 * primary providers without backups are real debt; redundant
 * agreement is healthy.
 */
export function debtFromProviderSnapshots(
  snapshots: readonly ProviderSnapshot[],
  now: number = Date.now(),
): DebtSeed[] {
  const items: DebtSeed[] = [];
  for (const snap of snapshots) {
    if (snap.level === 'silent') {
      items.push({
        id: `provider:${snap.providerId}:silent`,
        category: 'missing_sources',
        severity: 'critical',
        ownerArea: 'providers',
        impact: `Provider ${snap.providerId} has been silent — single-source coverage breaks for ${snap.domain}`,
        recommendedFix: `Add a backup provider for the ${snap.domain} domain or restore ${snap.providerId}`,
        evidence: {
          sourceId: 'provider-redundancy',
          detail: { providerId: snap.providerId, domain: snap.domain, health: snap.level },
          at: now,
        },
      });
    } else if (snap.level === 'failing' || snap.level === 'degraded') {
      items.push({
        id: `provider:${snap.providerId}:${snap.level}`,
        category: 'insufficient_provider_redundancy',
        severity: snap.level === 'failing' ? 'high' : 'medium',
        ownerArea: 'providers',
        impact: `Provider ${snap.providerId} for ${snap.domain} is ${snap.level}`,
        recommendedFix: `Investigate ${snap.providerId} or rotate the domain to a backup`,
        evidence: {
          sourceId: 'provider-redundancy',
          detail: { providerId: snap.providerId, domain: snap.domain, health: snap.level },
          at: now,
        },
      });
    }
  }
  return items;
}

/**
 * Map algorithm-health rows → debt items. Algorithms in `unknown`
 * status from sample-size starvation, `failing` / `unsafe`, or
 * `degraded` produce different categories.
 */
export function debtFromAlgorithmHealth(
  rows: readonly AlgorithmHealth[],
  now: number = Date.now(),
): DebtSeed[] {
  const items: DebtSeed[] = [];
  for (const row of rows) {
    if (row.status === 'healthy') continue;
    if (row.status === 'unknown') {
      items.push({
        id: `algo:${row.algorithmId}:unknown`,
        category: 'unknown_algorithm_health',
        severity: row.criticality === 'safety' ? 'high' : 'low',
        ownerArea: 'algorithms',
        impact: `${row.label} (${row.criticality}) is in unknown health: ${row.reason}`,
        recommendedFix: 'Collect more graded samples or lower the minGradedSamples threshold',
        evidence: {
          sourceId: 'algorithm-health',
          detail: { algorithmId: row.algorithmId, status: row.status, reason: row.reason },
          at: now,
        },
      });
    } else if (row.status === 'failing' || row.status === 'unsafe') {
      items.push({
        id: `algo:${row.algorithmId}:${row.status}`,
        category: 'noisy_algorithms',
        severity: row.criticality === 'safety' ? 'critical' : 'high',
        ownerArea: 'algorithms',
        impact: `${row.label} (${row.criticality}) is ${row.status}: ${row.reason}`,
        recommendedFix: 'Tune the algorithm — see explanation lines in algorithm-health',
        evidence: {
          sourceId: 'algorithm-health',
          detail: { algorithmId: row.algorithmId, status: row.status, reason: row.reason },
          at: now,
        },
      });
    } else if (row.status === 'degraded') {
      items.push({
        id: `algo:${row.algorithmId}:degraded`,
        category: 'noisy_algorithms',
        severity: 'medium',
        ownerArea: 'algorithms',
        impact: `${row.label} is degraded: ${row.reason}`,
        recommendedFix: 'Watch the trend; tune if it persists across the next sample window',
        evidence: {
          sourceId: 'algorithm-health',
          detail: { algorithmId: row.algorithmId, status: row.status },
          at: now,
        },
      });
    }
  }
  return items;
}

/**
 * Map failure-prediction → debt items. We surface only `unsafe` and
 * `high` levels; `elevated` is a watch state that becomes debt only
 * if it persists (a future closed-loop concern).
 */
export function debtFromFailurePrediction(
  report: PredictedRiskReport,
  now: number = Date.now(),
): DebtSeed[] {
  const items: DebtSeed[] = [];
  for (const pred of report.predictions) {
    if (pred.level !== 'unsafe' && pred.level !== 'high') continue;
    const severity: DebtSeverity = pred.level === 'unsafe' ? 'critical' : 'high';
    items.push({
      id: `failure-prediction:${pred.capabilityId}:${pred.level}`,
      category: pred.reasons.some((r) => r.id === 'capability_not_ready')
        ? 'missing_mission_bridges'
        : 'noisy_algorithms',
      severity,
      ownerArea: 'ops',
      impact: `Capability ${pred.capabilityId} predicted ${pred.level}: ${pred.reasons[0]?.text ?? 'no reason'}`,
      recommendedFix: pred.recommendations[0]?.text ?? 'Investigate the capability\'s upstream signals',
      evidence: {
        sourceId: 'failure-prediction',
        detail: { capabilityId: pred.capabilityId, level: pred.level, score: pred.score },
        at: now,
      },
    });
  }
  return items;
}
