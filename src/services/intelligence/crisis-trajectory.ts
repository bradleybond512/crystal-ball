/**
 * Crisis Trajectory Projector — for each active Situation, projects
 * the expected severity at 6h / 24h / 72h horizons using (in priority
 * order):
 *
 *   1. signature-matched: an injected CrisisSignatureLibrary returns
 *      a matching historical pattern → use its peakSeverityNum +
 *      avgDurationHours to model a rise-then-decay curve.
 *   2. recovery-model: an injected RecoveryModelingEngine returns an
 *      active profile → project linearly from current severity using
 *      its recoveryRate.
 *   3. extrapolation: ≥3 observations → linear fit on the most
 *      recent points, project forward.
 *   4. historical-average: gentle decay from current severity when
 *      none of the above apply.
 *
 * Confidence decays 20% per horizon (1.0 → 0.8 → 0.6). All providers
 * are injectable so the projector stays decoupled from upstream
 * signature/recovery PRs and unit tests run without any of them.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type { Situation } from './situation-store-v2';

// ── Public types ─────────────────────────────────────────────────────────

export type ProjectionBasis =
  | 'signature-matched' | 'recovery-model' | 'historical-average' | 'extrapolation';

export interface TrajectoryPoint {
  hoursFromNow: number;
  projectedSeverityNum: number;
  projectedSeverityLabel: string;
  confidence: number;
}

export interface CrisisTrajectory {
  situationId: string;
  domain: string;
  currentSeverityNum: number;
  projectionHorizons: readonly number[];
  trajectoryPoints: TrajectoryPoint[];
  projectionBasis: ProjectionBasis;
  matchedSignatureId: string | null;
  worstCaseAt: number | null;
  expectedResolutionAt: number | null;
  generatedAt: number;
}

export interface CrisisSignature {
  id: string;
  domain: string;
  cascadeRisk: number;
  avgDurationHours: number;
  peakSeverityNum: number;
}

export interface RecoveryProjectionProfile {
  situationId: string;
  domain: string;
  currentSeverityNum: number;
  recoveryRate: number;
}

export interface SignatureMatchProvider {
  findMatch(situation: Situation, observations: readonly ObservationEvent[]): CrisisSignature | null;
}

export interface RecoveryProjectionProvider {
  getProfile(situationId: string): RecoveryProjectionProfile | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CrisisTrajectoryProjectorOptions {
  storage?: StorageLike | null;
  now?: () => number;
  signatureProvider?: SignatureMatchProvider | null;
  recoveryProvider?: RecoveryProjectionProvider | null;
}

export interface CrisisTrajectoryProjector {
  project(situation: Situation, observations: readonly ObservationEvent[]): CrisisTrajectory;
  getTrajectory(situationId: string): CrisisTrajectory | undefined;
  getActiveTrajectories(): CrisisTrajectory[];
  subscribe(cb: (trajectories: CrisisTrajectory[]) => void): void;
  unsubscribe(cb: (trajectories: CrisisTrajectory[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-crisis-trajectories';
export const MAX_TRAJECTORIES = 100;
export const HORIZONS = [6, 24, 72] as const;
export const CONFIDENCE_BY_HORIZON: Readonly<Record<number, number>> = {
  6: 1,
  24: 0.8,
  72: 0.6,
};

const SEVERITY_NUM: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};
const SEVERITY_LABEL_BY_NUM: readonly string[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RESOLUTION_THRESHOLD = 1; // LOW
const SITUATION_SEVERITY_NUM: Record<string, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function clampSeverity(n: number): number {
  return Math.max(0, Math.min(4, n));
}

function severityLabel(severityNum: number): string {
  const rounded = Math.round(clampSeverity(severityNum));
  return SEVERITY_LABEL_BY_NUM[rounded] ?? 'INFO';
}

function currentSeverityNumFor(situation: Situation, observations: readonly ObservationEvent[]): number {
  if (observations.length > 0) {
    const sorted = [...observations].sort((a, b) => b.timestamp - a.timestamp);
    return SEVERITY_NUM[sorted[0]!.severity];
  }
  return SITUATION_SEVERITY_NUM[situation.severity] ?? 2;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneTrajectory(t: CrisisTrajectory): CrisisTrajectory {
  return {
    ...t,
    projectionHorizons: [...t.projectionHorizons],
    trajectoryPoints: t.trajectoryPoints.map((p) => ({ ...p })),
  };
}

// ── Projection strategies ────────────────────────────────────────────────

interface ProjectionInput {
  currentSeverityNum: number;
  signature: CrisisSignature | null;
  recovery: RecoveryProjectionProfile | null;
  observations: readonly ObservationEvent[];
  now: number;
}

interface ProjectionOutcome {
  basis: ProjectionBasis;
  matchedSignatureId: string | null;
  /** Function returning projected severityNum for an offset in hours. */
  predict: (hoursFromNow: number) => number;
}

function chooseStrategy(input: ProjectionInput): ProjectionOutcome {
  if (input.signature) {
    return {
      basis: 'signature-matched',
      matchedSignatureId: input.signature.id,
      predict: (h) => signatureCurve(h, input.signature!, input.currentSeverityNum),
    };
  }
  if (input.recovery) {
    return {
      basis: 'recovery-model',
      matchedSignatureId: null,
      predict: (h) => clampSeverity(input.recovery!.currentSeverityNum - input.recovery!.recoveryRate * h),
    };
  }
  if (input.observations.length >= 3) {
    const slopePerHour = computeExtrapolationSlope(input.observations);
    return {
      basis: 'extrapolation',
      matchedSignatureId: null,
      predict: (h) => clampSeverity(input.currentSeverityNum + slopePerHour * h),
    };
  }
  return {
    basis: 'historical-average',
    matchedSignatureId: null,
    predict: (h) => clampSeverity(input.currentSeverityNum - 0.05 * h),
  };
}

/** Bell-shaped curve anchored at currentSeverityNum, peaking near
 *  avgDurationHours / 3, returning toward LOW by avgDurationHours. */
function signatureCurve(
  hoursFromNow: number,
  signature: CrisisSignature,
  currentSeverityNum: number,
): number {
  const dur = Math.max(1, signature.avgDurationHours);
  const peakHour = dur / 3;
  const peak = Math.max(currentSeverityNum, signature.peakSeverityNum);
  const t = hoursFromNow;
  if (t <= peakHour) {
    const frac = peakHour === 0 ? 1 : t / peakHour;
    return clampSeverity(currentSeverityNum + (peak - currentSeverityNum) * frac);
  }
  const decayFrac = Math.min(1, (t - peakHour) / Math.max(1, dur - peakHour));
  return clampSeverity(peak - (peak - 1) * decayFrac);
}

function computeExtrapolationSlope(observations: readonly ObservationEvent[]): number {
  const window = [...observations]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-5);
  if (window.length < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const o of window) {
    const xHours = o.timestamp / 3_600_000;
    const y = SEVERITY_NUM[o.severity];
    sumX += xHours; sumY += y; sumXY += xHours * y; sumXX += xHours * xHours;
  }
  const n = window.length;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ── Worst-case / resolution derivation ──────────────────────────────────

function computeWorstCaseAt(
  trajectoryPoints: readonly TrajectoryPoint[],
  currentSeverityNum: number,
  now: number,
): number | null {
  if (trajectoryPoints.length === 0) return null;
  let bestSev = currentSeverityNum;
  let bestHours = 0;
  for (const p of trajectoryPoints) {
    if (p.projectedSeverityNum > bestSev) {
      bestSev = p.projectedSeverityNum;
      bestHours = p.hoursFromNow;
    }
  }
  return now + bestHours * 3_600_000;
}

function computeExpectedResolutionAt(
  trajectoryPoints: readonly TrajectoryPoint[],
  now: number,
): number | null {
  for (const p of trajectoryPoints) {
    if (p.projectedSeverityNum <= RESOLUTION_THRESHOLD) {
      return now + p.hoursFromNow * 3_600_000;
    }
  }
  return null;
}

// ── Persistence ─────────────────────────────────────────────────────────

function rehydrate(storage: StorageLike | null): CrisisTrajectory[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: CrisisTrajectory[] = [];
  for (const t of parsed) {
    if (!t || typeof t !== 'object') continue;
    const r = t as CrisisTrajectory;
    if (typeof r.situationId !== 'string') continue;
    const horizons: number[] = Array.isArray(r.projectionHorizons)
      ? (r.projectionHorizons as number[]).map((n) => Number(n))
      : [...HORIZONS];
    out.push({
      ...r,
      projectionHorizons: horizons,
      trajectoryPoints: Array.isArray(r.trajectoryPoints)
        ? r.trajectoryPoints.map((p) => ({ ...p })) : [],
    });
  }
  return out;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createCrisisTrajectoryProjector(
  options: CrisisTrajectoryProjectorOptions = {},
): CrisisTrajectoryProjector {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const signatureProvider = options.signatureProvider ?? null;
  const recoveryProvider = options.recoveryProvider ?? null;
  const trajectories: CrisisTrajectory[] = rehydrate(storage);
  const listeners = new Set<(trajectories: CrisisTrajectory[]) => void>();

  function persist(): void {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(trajectories)); }
    catch { /* non-critical */ }
  }

  function notify(): void {
    const snapshot = trajectories.map((t) => cloneTrajectory(t));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function evictIfOverCapacity(): void {
    if (trajectories.length <= MAX_TRAJECTORIES) return;
    trajectories.splice(0, trajectories.length - MAX_TRAJECTORIES);
  }

  return {
    project(situation, observations): CrisisTrajectory {
      const now = clock();
      const currentSeverityNum = currentSeverityNumFor(situation, observations);
      const signature = signatureProvider?.findMatch(situation, observations) ?? null;
      const recovery = signature ? null : recoveryProvider?.getProfile(situation.id) ?? null;
      const outcome = chooseStrategy({
        currentSeverityNum, signature, recovery, observations, now,
      });

      const trajectoryPoints: TrajectoryPoint[] = HORIZONS.map((h) => {
        const projected = outcome.predict(h);
        return {
          hoursFromNow: h,
          projectedSeverityNum: projected,
          projectedSeverityLabel: severityLabel(projected),
          confidence: CONFIDENCE_BY_HORIZON[h] ?? 0.5,
        };
      });

      const trajectory: CrisisTrajectory = {
        situationId: situation.id,
        domain: situation.domain,
        currentSeverityNum,
        projectionHorizons: [...HORIZONS],
        trajectoryPoints,
        projectionBasis: outcome.basis,
        matchedSignatureId: outcome.matchedSignatureId,
        worstCaseAt: computeWorstCaseAt(trajectoryPoints, currentSeverityNum, now),
        expectedResolutionAt: computeExpectedResolutionAt(trajectoryPoints, now),
        generatedAt: now,
      };

      const existingIdx = trajectories.findIndex((t) => t.situationId === situation.id);
      if (existingIdx === -1) trajectories.push(trajectory);
      else trajectories[existingIdx] = trajectory;
      evictIfOverCapacity();
      persist();
      notify();
      return cloneTrajectory(trajectory);
    },

    getTrajectory(situationId): CrisisTrajectory | undefined {
      const found = trajectories.find((t) => t.situationId === situationId);
      return found ? cloneTrajectory(found) : undefined;
    },

    getActiveTrajectories(): CrisisTrajectory[] {
      return trajectories.map((t) => cloneTrajectory(t));
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: CrisisTrajectoryProjector | null = null;

export function getCrisisTrajectoryProjector(): CrisisTrajectoryProjector {
  _singleton ??= createCrisisTrajectoryProjector();
  return _singleton;
}

export function _resetCrisisTrajectoryProjectorSingletonForTests(): void {
  _singleton = null;
}
