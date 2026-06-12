/**
 * Bias scan cadence — Phase 4B PR 2.
 *
 * Assembles BiasScanInput from the real stores every CADENCE_MS and runs the
 * pure batch bias-detector. Snapshot diffing lives here so bias-detector stays
 * pure:
 *  - per-situation snapshots feed the delta fields (latestConfidenceDelta,
 *    addedObservationsInLastUpdate);
 *  - a report signature gate suppresses identical re-scans so the evaluation
 *    ledger is not spammed with duplicate rows every 15 minutes.
 *
 * Honesty caps (logged in the evaluation detail, never silent):
 *  - driverScores are re-scored from the observation store's current window
 *    (getRecent), not a 30-day archive;
 *  - domainRollingAverages are computed over that same window;
 *  - outcomeRecords cover only ledger records that already carry a graded
 *    outcome.
 *
 * bias-detector is not registered in algorithm-registry.ts until PR 1 of this
 * stack lands; until then recordAlgorithmEvaluation throws UnknownAlgorithmError
 * and the recorder call is swallowed by the isolating try/catch in runOnce.
 */

import { getSituationStoreV2 } from './situation-store-v2';
import type { Situation } from './situation-store-v2';
import { getRecent } from './observation-store';
import { getDriverScoringEngine } from './driver-scores';
import { getCompetitiveHypothesisEngine } from './competitive-hypothesis';
import { getMetaConfidenceService } from './meta-confidence';
import { getBiasDetectorService } from './bias-detector';
import type {
  BiasReport, BiasScanInput, BiasSituation, BiasDriverScore,
  BiasHypothesisSet, BiasOutcomeRecord, BiasMetaConfidence,
} from './bias-detector';
import { getAlgorithmEvaluationLedger } from '@/services/algorithms/algorithms-state';
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';
import type { ObservationEvent } from '@/types/intelligence';

const CADENCE_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
const OBSERVATION_WINDOW = 100;
const HYPOTHESIS_SET_LIMIT = 50;

const OUTCOME_MAP: Record<string, BiasOutcomeRecord['actualOutcome'] | undefined> = {
  hit: 'confirmed-real',
  miss: 'marked-false-positive',
  partial: 'acted-on',
  inconclusive: undefined, // skipped
};

const SEVERITY_LABELS = new Set(['low', 'medium', 'high', 'critical']);

// Narrow structural views of the singletons so the cadence is trivially
// injectable in tests without reconstructing the full service classes.
interface SituationSource {
  getActive(): Situation[];
}
interface ScoringEngineLike {
  scoreObservation(o: ObservationEvent): { finalScore: number; derivedSeverity: BiasDriverScore['derivedSeverity'] };
}
interface HypothesisSetView {
  situationId: string;
  leadingHypothesis: { confidence: number } | null;
  hypotheses: { createdAt: number; evidence: { alignment: string }[] }[];
}
interface HypothesisSource {
  getAllSets(limit?: number): HypothesisSetView[];
}
interface MetaSource {
  getAllEstimates(): { targetId: string; metaConfidence: number }[];
}
interface LedgerLike {
  all(): { domain: string; outcome?: string; label?: string; at: number }[];
}
interface DetectorLike {
  scan(input: BiasScanInput): BiasReport;
}

export interface BiasScanDeps {
  store?: SituationSource;
  recentObservations?: (n?: number) => ObservationEvent[];
  scoringEngine?: ScoringEngineLike;
  hypothesisEngine?: HypothesisSource;
  metaService?: MetaSource;
  ledger?: LedgerLike;
  detector?: DetectorLike;
  clock?: () => number;
  recorder?: typeof recordAlgorithmEvaluation;
}

interface SituationSnapshot {
  confidence: number;
  observationCount: number;
}

/** Stable fingerprint of a scan report over fields that survive a re-scan —
 *  the per-signal `id`/`detectedAt` are timestamped and non-deterministic, so
 *  they are excluded; otherwise the gate would never suppress anything. */
function signatureOf(report: BiasReport): string {
  const sig = report.signals
    .map((s) => `${s.type}|${s.domain}|${s.severity}|${s.evidence}`)
    .sort()
    .join('\n');
  return `${report.overallBiasRisk}::${report.dominantBias ?? 'none'}::${sig}`;
}

export function createBiasScanCadence(deps: BiasScanDeps = {}) {
  const store = deps.store ?? getSituationStoreV2();
  const recent = deps.recentObservations ?? getRecent;
  const engine = deps.scoringEngine ?? getDriverScoringEngine();
  const hypotheses = deps.hypothesisEngine ?? (getCompetitiveHypothesisEngine() as unknown as HypothesisSource);
  const meta = deps.metaService ?? getMetaConfidenceService();
  const ledger = deps.ledger ?? (getAlgorithmEvaluationLedger() as unknown as LedgerLike);
  const detector = deps.detector ?? getBiasDetectorService();
  const clock = deps.clock ?? (() => Date.now());
  const recorder = deps.recorder ?? recordAlgorithmEvaluation;

  const previous = new Map<string, SituationSnapshot>();
  let lastSignature: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstTimer: ReturnType<typeof setTimeout> | null = null;

  function assemble(now: number, active: Situation[]): BiasScanInput {
    const biasSituations: BiasSituation[] = active.map((s) => {
      const prev = previous.get(s.id);
      return {
        id: s.id,
        domain: s.domain,
        confidence: s.confidence,
        latestConfidenceDelta: prev ? s.confidence - prev.confidence : 0,
        addedObservationsInLastUpdate:
          prev ? Math.max(0, s.observations.length - prev.observationCount) : s.observations.length,
        updatedAt: new Date(s.updatedAt),
      };
    });

    // Re-score the current observation window through the pure engine.
    const driverScores: BiasDriverScore[] = recent(OBSERVATION_WINDOW).map((o) => {
      const score = engine.scoreObservation(o);
      return {
        observationId: o.id,
        domain: o.domain,
        finalScore: score.finalScore,
        derivedSeverity: score.derivedSeverity,
        observedAt: new Date(o.timestamp),
      };
    });

    const rolling: Record<string, number> = {};
    const byDomain = new Map<string, number[]>();
    for (const d of driverScores) {
      if (!byDomain.has(d.domain)) byDomain.set(d.domain, []);
      byDomain.get(d.domain)!.push(d.finalScore);
    }
    for (const [domain, scores] of byDomain) {
      rolling[domain] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    const hypothesisSets: BiasHypothesisSet[] = hypotheses.getAllSets(HYPOTHESIS_SET_LIMIT).map((set) => ({
      id: set.situationId,
      domain: active.find((s) => s.id === set.situationId)?.domain ?? 'unknown',
      leadingPosterior: set.leadingHypothesis?.confidence ?? 0,
      contradictingObservationCount: set.hypotheses.reduce(
        (n, h) => n + h.evidence.filter((e) => e.alignment === 'contradicting').length, 0),
      createdAt: new Date(set.hypotheses[0]?.createdAt ?? now),
    }));

    const outcomeRecords: BiasOutcomeRecord[] = [];
    for (const r of ledger.all()) {
      if (!r.outcome) continue;
      const mapped = OUTCOME_MAP[r.outcome];
      if (!mapped) continue;
      outcomeRecords.push({
        domain: r.domain,
        actualOutcome: mapped,
        predictedSeverity: (r.label && SEVERITY_LABELS.has(r.label) ? r.label : 'medium') as BiasOutcomeRecord['predictedSeverity'],
        recordedAt: new Date(r.at),
      });
    }

    // Meta estimates lack a domain — resolve via the active situations; skip
    // estimates whose target situation has rotated out of the active set.
    const metaEstimates: BiasMetaConfidence[] = [];
    for (const e of meta.getAllEstimates()) {
      const sit = active.find((s) => s.id === e.targetId);
      if (sit) metaEstimates.push({ domain: sit.domain, metaConfidence: e.metaConfidence });
    }

    return {
      situations: biasSituations,
      driverScores,
      hypothesisSets,
      outcomeRecords,
      metaEstimates,
      domainRollingAverages: rolling,
      now: new Date(now),
    };
  }

  function runOnce(): void {
    const active = store.getActive();
    if (active.length === 0) return; // nothing to scan — no-op, no ledger write

    const now = clock();
    const input = assemble(now, active);
    const startedAt = clock();
    try {
      const report = detector.scan(input);
      const signature = signatureOf(report);
      // Delta gate: only record when the bias picture actually changed.
      if (signature !== lastSignature) {
        lastSignature = signature;
        recorder('bias-detector', {
          durationMs: clock() - startedAt,
          score: Math.min(1, report.signals.length / 5),
          label: report.overallBiasRisk,
          detail: {
            signalCount: report.signals.length,
            dominantBias: report.dominantBias ?? 'none',
            situationCount: input.situations.length,
            outcomeRecordCount: input.outcomeRecords.length,
            observationWindow: OBSERVATION_WINDOW,
          },
        });
      }
    } catch { /* isolated — bias-detector unregistered until PR 1 lands */ }

    // Snapshot AFTER scanning so deltas describe the inter-scan change.
    for (const s of active) {
      previous.set(s.id, { confidence: s.confidence, observationCount: s.observations.length });
    }
  }

  function start(): () => void {
    if (timer || firstTimer) return stop;
    firstTimer = setTimeout(() => { firstTimer = null; runOnce(); }, FIRST_RUN_DELAY_MS);
    timer = setInterval(runOnce, CADENCE_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    (firstTimer as unknown as { unref?: () => void }).unref?.();
    return stop;
  }

  function stop(): void {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { start, stop, runOnce };
}

let activeCadence: ReturnType<typeof createBiasScanCadence> | null = null;

/** Start the singleton bias-scan cadence (idempotent). Returns a stop fn. */
export function startBiasScanCadence(deps: BiasScanDeps = {}): () => void {
  if (activeCadence) return () => activeCadence?.stop();
  activeCadence = createBiasScanCadence(deps);
  activeCadence.start();
  return () => { activeCadence?.stop(); activeCadence = null; };
}

export const __internals = { CADENCE_MS, FIRST_RUN_DELAY_MS, OBSERVATION_WINDOW, HYPOTHESIS_SET_LIMIT, OUTCOME_MAP };
