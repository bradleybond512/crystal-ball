/**
 * Cross-Algorithm Correlation — PR 16.
 *
 * Compute the Pearson correlation of decision confidence scores
 * across pairs of algorithms over the trailing 500 paired decisions.
 *
 * Pairs of records are matched by inputHash (when available) or by
 * record id. The matrix is updated weekly in production but is
 * recomputable on demand here.
 *
 * Pure deterministic.
 */

import type { EvaluationRecord } from './algorithm-evaluation-ledger.ts';

// ── Types ──────────────────────────────────────────────────────────────

export type CorrelationKind = 'redundant' | 'disagreement' | 'independent' | 'mild';

export interface PairCorrelation {
  algorithmA: string;
  algorithmB: string;
  /** Pearson r in [-1, 1]. NaN when pair count is too small. */
  r: number;
  /** Number of paired observations the r was computed over. */
  pairs: number;
  classification: CorrelationKind;
}

export interface CorrelationMatrix {
  algorithmIds: readonly string[];
  pairs: readonly PairCorrelation[];
  /** Generated-at ms timestamp. */
  generatedAt: number;
}

export interface CorrelationOptions {
  /** Trailing window length (most-recent N records per algorithm
   *  considered). Default 500 per spec. */
  windowSize?: number;
  /** Minimum paired observations required to produce a non-NaN r. */
  minPairs?: number;
  /** |r| ≥ this is "redundant". Default 0.8. */
  redundantThreshold?: number;
  /** r ≤ this is "disagreement" (anti-correlated). Default -0.3. */
  disagreementThreshold?: number;
  /** |r| ≤ this is "independent". Default 0.2. */
  independentThreshold?: number;
  now?: () => number;
}

const DEFAULTS: Required<Omit<CorrelationOptions, 'now'>> = {
  windowSize: 500,
  minPairs: 5,
  redundantThreshold: 0.8,
  disagreementThreshold: -0.3,
  independentThreshold: 0.2,
};

// ── Pearson math ──────────────────────────────────────────────────────

/** Pearson correlation coefficient. Returns NaN for series shorter
 *  than 2 or when one series has zero variance. */
export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) {
    throw new Error('pearsonCorrelation: series length mismatch');
  }
  const n = xs.length;
  if (n < 2) return Number.NaN;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return Number.NaN;
  return num / Math.sqrt(denomX * denomY);
}

// ── Classification ────────────────────────────────────────────────────

export function classifyCorrelation(
  r: number,
  options: Pick<CorrelationOptions, 'redundantThreshold' | 'disagreementThreshold' | 'independentThreshold'> = {},
): CorrelationKind {
  const redundant = options.redundantThreshold ?? DEFAULTS.redundantThreshold;
  const disagreement = options.disagreementThreshold ?? DEFAULTS.disagreementThreshold;
  const independent = options.independentThreshold ?? DEFAULTS.independentThreshold;
  if (Number.isNaN(r)) return 'independent';
  if (r >= redundant) return 'redundant';
  if (r <= disagreement) return 'disagreement';
  if (Math.abs(r) <= independent) return 'independent';
  return 'mild';
}

// ── Pair extraction ───────────────────────────────────────────────────

/** Collect the most-recent windowSize records for one algorithm,
 *  keyed by inputHash || id. Most-recent wins on duplicate keys. */
function collectKeyed(
  records: readonly EvaluationRecord[],
  algorithmId: string,
  windowSize: number,
): Map<string, number> {
  const filtered = records.filter((r) => r.algorithmId === algorithmId);
  filtered.sort((a, b) => a.at - b.at);
  const recent = filtered.slice(-windowSize);
  const map = new Map<string, number>();
  for (const r of recent) {
    if (r.score === undefined) continue;
    const key = r.inputHash ?? r.id;
    map.set(key, r.score);
  }
  return map;
}

/** Build paired (xs, ys) confidence series for two algorithms. */
export function buildPairedConfidenceSeries(
  records: readonly EvaluationRecord[],
  algorithmA: string,
  algorithmB: string,
  windowSize: number,
): { xs: number[]; ys: number[] } {
  const a = collectKeyed(records, algorithmA, windowSize);
  const b = collectKeyed(records, algorithmB, windowSize);
  const xs: number[] = [];
  const ys: number[] = [];
  // Iterate over the smaller map for efficiency.
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  const swap = a.size > b.size;
  for (const [key, value] of smaller) {
    const other = larger.get(key);
    if (other === undefined) continue;
    if (swap) {
      xs.push(other);
      ys.push(value);
    } else {
      xs.push(value);
      ys.push(other);
    }
  }
  return { xs, ys };
}

// ── Matrix builder ────────────────────────────────────────────────────

export function buildCorrelationMatrix(
  records: readonly EvaluationRecord[],
  algorithmIds: readonly string[],
  options: CorrelationOptions = {},
): CorrelationMatrix {
  const windowSize = options.windowSize ?? DEFAULTS.windowSize;
  const minPairs = options.minPairs ?? DEFAULTS.minPairs;
  const generatedAt = (options.now ?? (() => Date.now()))();

  const out: PairCorrelation[] = [];
  for (let i = 0; i < algorithmIds.length; i += 1) {
    for (let j = i + 1; j < algorithmIds.length; j += 1) {
      const a = algorithmIds[i]!;
      const b = algorithmIds[j]!;
      const { xs, ys } = buildPairedConfidenceSeries(records, a, b, windowSize);
      const r = xs.length >= minPairs ? pearsonCorrelation(xs, ys) : Number.NaN;
      out.push({
        algorithmA: a,
        algorithmB: b,
        r,
        pairs: xs.length,
        classification: classifyCorrelation(r, options),
      });
    }
  }
  return {
    algorithmIds: [...algorithmIds],
    pairs: out,
    generatedAt,
  };
}

// ── Ensemble composition optimization ─────────────────────────────────

/** Suggest an ensemble composition by greedily picking the lowest-
 *  correlation algorithm relative to the current set. Always seeds
 *  with the candidate that has the most paired observations. */
export function suggestDiverseEnsemble(
  matrix: CorrelationMatrix,
  candidates: readonly string[],
  size: number,
): string[] {
  if (size <= 0) return [];
  const candidateSet = new Set(candidates);
  const filteredCandidates = matrix.algorithmIds.filter((id) => candidateSet.has(id));
  if (filteredCandidates.length === 0) return [];

  const out: string[] = [];
  const seed = pickSeedByPairCount(matrix, candidateSet, filteredCandidates);
  out.push(seed);

  while (out.length < size && out.length < filteredCandidates.length) {
    const next = pickNextLowestCorrelated(matrix, filteredCandidates, out);
    if (!next) break;
    out.push(next);
  }
  return out;
}

function pickSeedByPairCount(
  matrix: CorrelationMatrix,
  candidateSet: Set<string>,
  filteredCandidates: readonly string[],
): string {
  const pairCount = new Map<string, number>();
  for (const p of matrix.pairs) {
    if (!candidateSet.has(p.algorithmA) || !candidateSet.has(p.algorithmB)) continue;
    pairCount.set(p.algorithmA, (pairCount.get(p.algorithmA) ?? 0) + p.pairs);
    pairCount.set(p.algorithmB, (pairCount.get(p.algorithmB) ?? 0) + p.pairs);
  }
  const sorted = [...filteredCandidates].sort((x, y) => {
    const a = pairCount.get(x) ?? 0;
    const b = pairCount.get(y) ?? 0;
    return b - a;
  });
  return sorted[0]!;
}

function pickNextLowestCorrelated(
  matrix: CorrelationMatrix,
  candidates: readonly string[],
  alreadyPicked: readonly string[],
): string | undefined {
  let best: { id: string; cost: number } | undefined;
  for (const id of candidates) {
    if (alreadyPicked.includes(id)) continue;
    const cost = sumAbsCorrelationToSet(matrix, id, alreadyPicked);
    if (!best || cost < best.cost) best = { id, cost };
  }
  return best?.id;
}

function sumAbsCorrelationToSet(
  matrix: CorrelationMatrix,
  id: string,
  set: readonly string[],
): number {
  let total = 0;
  for (const peer of set) {
    const r = lookupR(matrix, id, peer);
    if (Number.isNaN(r)) {
      // Treat unknown as independent (zero cost).
      continue;
    }
    total += Math.abs(r);
  }
  return total;
}

function lookupR(matrix: CorrelationMatrix, a: string, b: string): number {
  for (const p of matrix.pairs) {
    if ((p.algorithmA === a && p.algorithmB === b) || (p.algorithmA === b && p.algorithmB === a)) {
      return p.r;
    }
  }
  return Number.NaN;
}

// ── Last-matrix cache (sidecar mirror) ────────────────────────────────

let lastMatrix: CorrelationMatrix | undefined;

export function recordCorrelationMatrix(matrix: CorrelationMatrix): void {
  lastMatrix = matrix;
}

export function getLastCorrelationMatrix(): CorrelationMatrix | undefined {
  return lastMatrix;
}

export function _resetCorrelationCacheForTests(): void {
  lastMatrix = undefined;
}
