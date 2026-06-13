/**
 * Mission Outcome Grader — closes the Brier-score learning loop.
 *
 * Subscribes to the MissionLedgerBridge for terminal-status entries
 * (resolved_hit / resolved_miss / expired / cancelled) and for each:
 *   1. Records a MissionOutcome into the ClosedLoopMissionLedger so
 *      per-algorithm calibration tracks the verdict.
 *   2. Logs a PredictionRecord into a ForecastCalibrationStore and
 *      immediately resolves it so Brier scores stay current.
 *   3. Triggers AttentionAllocator.recompute() to propagate the new
 *      calibration into the per-domain attention multipliers.
 *
 * Exposes `brierDomainMultiplier(domain)` — a 0.5–1.5 signal that
 * downstream scorers can apply to adjust domain trust.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 */

import {
  getClosedLoopMissionLedger,
  type ClosedLoopMissionLedger,
} from './closed-loop-mission-ledger';
import {
  getMissionLedgerBridge,
  type MissionLedgerBridge,
  type BridgedEntry,
} from './mission-ledger-bridge';
import {
  getAttentionAllocator,
  type AttentionAllocator,
} from './attention-allocator';
import {
  createForecastCalibrationStore,
  type ForecastCalibrationStore,
  type PredictionRecord,
} from './forecast-calibration';
import { getMissionLedger } from '../ops/mission-state';
import type { MissionLedger } from '../ops/mission-ledger';
import type { MissionDomain, MissionRecord, MissionStatus } from '../ops/mission-types';
import type { FactDomain } from './types';

// ── Public types ──────────────────────────────────────────────────────

export interface GraderStats {
  totalGraded: number;
  accurateCount: number;
  inaccurateCount: number;
  lastGradedAt: number | null;
}

export interface MissionOutcomeGraderOptions {
  closedLoopLedger?: ClosedLoopMissionLedger;
  bridge?: MissionLedgerBridge;
  attentionAllocator?: AttentionAllocator;
  missionLedger?: MissionLedger;
  /** Override Date.now(). */
  clock?: () => number;
  /** Lead-time window (ms) for the wasTimely flag. Defaults to 24 h. */
  timelyThresholdMs?: number;
  /** Minimum resolved predictions before brierDomainMultiplier moves
   *  away from 1.0 (neutral). */
  minSamplesForMultiplier?: number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TIMELY_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_SAMPLES = 5;
/** Missions represent high-confidence alerts; use 0.8 as the canonical
 *  forecast probability when synthesising PredictionRecord entries. */
const MISSION_FORECAST_PROBABILITY = 0.8;

/** Canonical mapping from ops MissionDomain to the free-form domain
 *  strings used by the OutcomeLedger and ForecastCalibrationStore.
 *  Mirrors the mapping in MissionLedgerBridge so per-domain calibration
 *  aggregates under the same keys. */
const DOMAIN_MAP: Record<MissionDomain, string> = {
  weather_safety: 'weather',
  conflict_escalation: 'conflict',
  cyber_exposure: 'cyber',
  food_commodity_shortage: 'food',
  energy_fuel_stress: 'energy',
  travel_disruption: 'travel',
  market_portfolio_risk: 'finance',
  local_infrastructure: 'infra',
};

const TERMINAL_STATUSES: ReadonlySet<MissionStatus> = new Set([
  'resolved_hit', 'resolved_miss', 'expired', 'cancelled',
]);

// ── Grader ────────────────────────────────────────────────────────────

export class MissionOutcomeGrader {
  private readonly opts: Required<Omit<MissionOutcomeGraderOptions,
    'closedLoopLedger' | 'bridge' | 'attentionAllocator' | 'missionLedger'>>;
  private readonly closedLoopLedger: ClosedLoopMissionLedger;
  private readonly bridge: MissionLedgerBridge;
  private readonly allocator: AttentionAllocator;
  private readonly missionLedger: MissionLedger;
  private readonly calibrationStore: ForecastCalibrationStore;
  private unsubscribe: (() => void) | null = null;

  private totalGraded = 0;
  private accurateCount = 0;
  private inaccurateCount = 0;
  private lastGradedAt: number | null = null;

  constructor(options: MissionOutcomeGraderOptions = {}) {
    this.opts = {
      clock: options.clock ?? (() => Date.now()),
      timelyThresholdMs: options.timelyThresholdMs ?? DEFAULT_TIMELY_THRESHOLD_MS,
      minSamplesForMultiplier: options.minSamplesForMultiplier ?? DEFAULT_MIN_SAMPLES,
    };
    this.closedLoopLedger = options.closedLoopLedger ?? getClosedLoopMissionLedger();
    this.bridge = options.bridge ?? getMissionLedgerBridge();
    this.allocator = options.attentionAllocator ?? getAttentionAllocator();
    this.missionLedger = options.missionLedger ?? getMissionLedger();
    this.calibrationStore = createForecastCalibrationStore();
  }

  /** Subscribe to the bridge and begin grading terminal missions.
   *  Idempotent — calling connect() twice is safe. */
  connect(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bridge.subscribe((entry) => this.gradeEntry(entry));
  }

  /** Remove the bridge subscription. Safe to call when not connected. */
  disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  isConnected(): boolean {
    return this.unsubscribe !== null;
  }

  /**
   * Grade a single bridged entry. Only processes `status`-triggered
   * entries that represent terminal mission resolution — event-triggered
   * entries (user actions, near-miss signals, etc.) are silently ignored.
   * Tests can call this directly without starting the bridge timer.
   */
  gradeEntry(entry: BridgedEntry): void {
    if (entry.trigger !== 'status') return;
    const mission = this.missionLedger.get(entry.missionId);
    if (!mission) return;
    if (!TERMINAL_STATUSES.has(mission.status)) return;

    const wasAccurate = mission.status === 'resolved_hit';
    const domain = DOMAIN_MAP[mission.domain] ?? mission.domain;
    const now = this.opts.clock();
    const resolvedAt = mission.resolvedAt ?? now;
    const leadTimeMs = Math.max(0, resolvedAt - mission.createdAt);

    const outcome = {
      situationId: mission.factId ?? mission.id,
      domain,
      detectedAt: mission.createdAt,
      resolvedAt,
      leadTimeMs,
      wasAccurate,
      wasTimely: leadTimeMs <= this.opts.timelyThresholdMs,
      algorithmIds: mission.originAlgorithmId ? [mission.originAlgorithmId] : [],
    };

    try {
      this.closedLoopLedger.recordOutcome(outcome, { algorithmIdsRequired: false });
    } catch {
      // Non-fatal — calibration continues even if recording fails.
    }

    this.recordInCalibrationStore(mission, wasAccurate, domain, resolvedAt);

    try {
      this.allocator.recompute();
    } catch {
      // Non-fatal — attention allocation is best-effort.
    }

    this.totalGraded += 1;
    if (wasAccurate) {
      this.accurateCount += 1;
    } else {
      this.inaccurateCount += 1;
    }
    this.lastGradedAt = now;
  }

  /** Brier-derived multiplier for `domain` (0.5–1.5). Returns 1.0 when
   *  there is insufficient data (fewer than `minSamplesForMultiplier`
   *  resolved predictions for the domain). */
  brierDomainMultiplier(domain: string): number {
    const domainAccuracies = this.calibrationStore.byDomain();
    const entry = domainAccuracies.find((a) => a.domain === (domain as FactDomain));
    if (!entry || entry.predictionCount < this.opts.minSamplesForMultiplier) {
      return 1;
    }
    return clamp(0.5, 1.5, 1.5 - 2 * entry.brier);
  }

  stats(): GraderStats {
    return {
      totalGraded: this.totalGraded,
      accurateCount: this.accurateCount,
      inaccurateCount: this.inaccurateCount,
      lastGradedAt: this.lastGradedAt,
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private recordInCalibrationStore(
    mission: MissionRecord,
    wasAccurate: boolean,
    domain: string,
    resolvedAt: number,
  ): void {
    const predictionId = `${mission.id}:${mission.status}`;
    const prediction: PredictionRecord = {
      id: predictionId,
      sourceId: mission.originAlgorithmId ?? domain,
      domain: domain as FactDomain,
      claim: mission.description,
      probability: MISSION_FORECAST_PROBABILITY,
      predictedAt: mission.createdAt,
      resolveBy: resolvedAt,
      status: 'pending',
      algorithmVersion: mission.originAlgorithmId,
    };
    this.calibrationStore.record(prediction);
    this.calibrationStore.resolve(predictionId, wasAccurate, resolvedAt);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: MissionOutcomeGrader | null = null;

export function getMissionOutcomeGrader(): MissionOutcomeGrader {
  _singleton ??= new MissionOutcomeGrader();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetMissionOutcomeGraderSingleton(): void {
  _singleton = null;
}
