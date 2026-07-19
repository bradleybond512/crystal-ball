/**
 * Driver-based scoring engine — evidence-weighted severity scoring
 * for ObservationEvents and v2 Situations.
 *
 * Replaces hard threshold math ("magnitude > 6.5 = high") with
 * normalized, weighted driver contributions. Each domain registers
 * one or more ScoringDrivers; the engine composes them at scoring
 * time and projects the result onto a 4-tier severity ladder.
 *
 * Pure deterministic; no DOM, no fetch, no globals at import time.
 */

import type { ObservationEvent } from './observation-adapters';
import type { EvidenceEdge, Situation } from './situation-store-v2';
import { getAttentionAllocator } from './attention-allocator';
import { buildInputHash, getAlgoEvalLedger } from './algo-eval-ledger';
import type { BeliefValue } from '@/types/belief';
import { createBelief } from './belief-helpers';

// ── Public types ──────────────────────────────────────────────────────

export interface ScoringDriver {
  id: string;
  name: string;
  domain: string;
  /** Relative weight in the per-domain composite. Re-normalized at
   *  scoring time so callers don't have to make weights sum to 1.0. */
  weight: number;
  /** Pull the raw value from an observation. Return null when the
   *  field isn't present — the driver still appears in the output but
   *  contributes 0 to the score. */
  extractValue: (obs: ObservationEvent) => number | null;
  /** Map raw value → 0..1 normalized score. The engine clamps the
   *  output to [0,1]; drivers should still try to stay in band so
   *  log-friendly raw values stay readable. */
  normalizeValue: (raw: number) => number;
  description: string;
}

export type DerivedSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface DriverScore {
  driverId: string;
  driverName: string;
  rawValue: number | null;
  normalizedScore: number;
  /** The driver's normalized weight (per-domain weights are re-scaled
   *  to sum to 1.0). */
  weight: number;
  weightedContribution: number;
}

export interface EvidenceScore {
  observationId: string;
  domain: string;
  driverScores: DriverScore[];
  baseScore: number;
  edgeBonus: number;
  /** Per-domain attention multiplier from AttentionAllocator, applied
   *  to `(baseScore + edgeBonus)` before severity-band lookup. 1.0 when
   *  the domain has no learned calibration yet. */
  attentionMultiplier: number;
  finalScore: number;
  derivedSeverity: DerivedSeverity;
  /** First-class probability view of `finalScore` (AI-2 BeliefValue). The
   *  legacy numeric score is retained for existing callers; the belief adds a
   *  confidence interval, provenance, and an ICD-203-labelable point estimate
   *  that the epistemic layer can propagate. */
  belief: BeliefValue;
  explanation: string;
}

export interface SituationScore {
  situationId: string;
  observationScores: EvidenceScore[];
  aggregateScore: number;
  derivedSeverity: DerivedSeverity;
  topDrivers: DriverScore[];
  explanation: string;
}

// ── Constants ────────────────────────────────────────────────────────

const SEVERITY_BANDS: { min: number; severity: DerivedSeverity }[] = [
  { min: 0.8, severity: 'critical' },
  { min: 0.6, severity: 'high' },
  { min: 0.35, severity: 'medium' },
  { min: 0, severity: 'low' },
];

const EDGE_BONUS_PER_EDGE = 0.05;
const EDGE_BONUS_CAP = 0.2;
const TOP_DRIVERS = 3;
/** Aggregate weighting half-life for situation observations. Recent
 *  observations dominate; older ones still contribute. 24 hours feels
 *  right for the kinds of incidents these scores describe. */
const RECENCY_HALF_LIFE_MS = 24 * 60 * 60 * 1000;

// ── Engine ───────────────────────────────────────────────────────────

export class DriverScoringEngine {
  private readonly drivers = new Map<string, ScoringDriver>();

  registerDriver(driver: ScoringDriver): void {
    this.drivers.set(driver.id, driver);
  }

  unregisterDriver(id: string): void {
    this.drivers.delete(id);
  }

  getDrivers(): ScoringDriver[] {
    return [...this.drivers.values()];
  }

  getDriversByDomain(domain: string): ScoringDriver[] {
    return this.getDrivers().filter((d) => d.domain === domain);
  }

  scoreObservation(obs: ObservationEvent, edges: readonly EvidenceEdge[] = []): EvidenceScore {
    const domainDrivers = this.getDriversByDomain(obs.domain);
    const driverScores = scoreDrivers(domainDrivers, obs);
    const baseScore = driverScores.reduce((s, d) => s + d.weightedContribution, 0);
    const edgeBonus = computeEdgeBonus(obs.id, edges);
    // Pull the per-domain attention multiplier learned from previous
    // user feedback. Unknown domains return the neutral 1.0, so this
    // is a no-op for early-history scoring.
    const attentionMultiplier = safe(() => getAttentionAllocator().getMultiplier(obs.domain)) ?? 1;
    const finalScore = Math.min(1, (baseScore + edgeBonus) * attentionMultiplier);
    const score: EvidenceScore = {
      observationId: obs.id,
      domain: obs.domain,
      driverScores,
      baseScore,
      edgeBonus,
      attentionMultiplier,
      finalScore,
      derivedSeverity: severityFor(finalScore),
      belief: createBelief(finalScore, { provenance: [obs.id] }),
      explanation: explainEvidence(obs, driverScores, baseScore, edgeBonus, attentionMultiplier, finalScore),
    };
    // Side-effect: hand the prediction to the eval ledger so the
    // OutcomeLedger can resolve it later via `resolveByInputHash`. The
    // join key matches what outcome-ledger emits on resolution.
    safe(() => {
      getAlgoEvalLedger().record({
        algorithmId: 'driver-scorer',
        domain: obs.domain,
        inputHash: buildInputHash(obs.domain, obs.id),
        predictedValue: score.derivedSeverity,
        predictedAt: new Date(),
      });
    });
    return score;
  }

  scoreSituation(situation: Situation): SituationScore {
    const observationScores = situation.observations.map((obs) =>
      this.scoreObservation(obs, situation.edges),
    );
    const aggregate = aggregateScores(observationScores, situation.observations);
    const top = topDrivers(observationScores);
    return {
      situationId: situation.id,
      observationScores,
      aggregateScore: aggregate,
      derivedSeverity: severityFor(aggregate),
      topDrivers: top,
      explanation: explainSituation(situation, top, aggregate),
    };
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: DriverScoringEngine | undefined;

export function getDriverScoringEngine(): DriverScoringEngine {
  singleton ??= new DriverScoringEngine();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Internals ────────────────────────────────────────────────────────

function scoreDrivers(drivers: readonly ScoringDriver[], obs: ObservationEvent): DriverScore[] {
  if (drivers.length === 0) return [];
  const totalWeight = drivers.reduce((s, d) => s + Math.max(0, d.weight), 0);
  return drivers.map((d) => {
    const rawValue = safe(() => d.extractValue(obs)) ?? null;
    const normalizedScore = rawValue === null ? 0 : clamp01(safe(() => d.normalizeValue(rawValue)) ?? 0);
    const weight = totalWeight > 0 ? Math.max(0, d.weight) / totalWeight : 0;
    return {
      driverId: d.id,
      driverName: d.name,
      rawValue,
      normalizedScore,
      weight,
      weightedContribution: normalizedScore * weight,
    };
  });
}

function computeEdgeBonus(observationId: string, edges: readonly EvidenceEdge[]): number {
  let bonus = 0;
  for (const edge of edges) {
    if (edge.targetEventId !== observationId) continue;
    if (edge.type !== 'caused_by' && edge.type !== 'confirms') continue;
    bonus += clamp01(edge.confidence) * EDGE_BONUS_PER_EDGE;
    if (bonus >= EDGE_BONUS_CAP) return EDGE_BONUS_CAP;
  }
  return Math.min(EDGE_BONUS_CAP, bonus);
}

function severityFor(score: number): DerivedSeverity {
  for (const band of SEVERITY_BANDS) {
    if (score >= band.min) return band.severity;
  }
  return 'low';
}

function aggregateScores(
  scores: readonly EvidenceScore[],
  observations: readonly ObservationEvent[],
): number {
  if (scores.length === 0) return 0;
  const now = latestTimestamp(observations);
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [i, score] of scores.entries()) {
    const obs = observations[i];
    if (!obs) continue;
    const ageMs = Math.max(0, now - obs.timestamp);
    const w = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
    weightedSum += (score?.finalScore ?? 0) * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(4)) : 0;
}

function latestTimestamp(observations: readonly ObservationEvent[]): number {
  let max = 0;
  for (const o of observations) if (o.timestamp > max) max = o.timestamp;
  return max;
}

function topDrivers(scores: readonly EvidenceScore[]): DriverScore[] {
  const flat: DriverScore[] = [];
  for (const s of scores) flat.push(...s.driverScores);
  flat.sort((a, b) => b.weightedContribution - a.weightedContribution);
  return flat.slice(0, TOP_DRIVERS);
}

function explainEvidence(
  obs: ObservationEvent,
  driverScores: readonly DriverScore[],
  baseScore: number,
  edgeBonus: number,
  attentionMultiplier: number,
  finalScore: number,
): string {
  if (driverScores.length === 0) {
    return `${obs.title || obs.id}: no drivers registered for domain "${obs.domain}".`;
  }
  const contributing = driverScores.filter((d) => d.weightedContribution > 0);
  const sorted = [...contributing].sort((a, b) => b.weightedContribution - a.weightedContribution);
  const top = sorted.slice(0, 2).map((d) => `${d.driverName} ${d.normalizedScore.toFixed(2)}`);
  const head = obs.title || obs.id;
  const driverPart = top.length > 0 ? top.join(' + ') : 'no contributing drivers';
  const bonusPart = edgeBonus > 0 ? ` + edge bonus ${edgeBonus.toFixed(2)}` : '';
  const attentionPart = attentionMultiplier === 1
    ? ''
    : ` × attention ${attentionMultiplier.toFixed(2)}`;
  return `${head}: ${driverPart}${bonusPart}${attentionPart} → ${severityFor(finalScore)} (${finalScore.toFixed(2)} from base ${baseScore.toFixed(2)}).`;
}

function explainSituation(
  situation: Situation,
  top: readonly DriverScore[],
  aggregate: number,
): string {
  if (top.length === 0) {
    return `${situation.name}: no scored evidence yet (${aggregate.toFixed(2)}).`;
  }
  const drivers = top.map((d) => d.driverName).join(', ');
  return `${situation.name}: ${severityFor(aggregate)} (${aggregate.toFixed(2)}) — top drivers: ${drivers}.`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
