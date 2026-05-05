/**
 * Black Swan Detector — PR 17.
 *
 * Watches the input-feature distribution for events that fall outside
 * every algorithm's training distribution. Uses a simplified
 * Isolation Forest: build T random trees over history, isolate the
 * query point, average path length, convert to an anomaly score.
 *
 * Pure deterministic given an injectable RNG.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface EventFeatures {
  /** Stable id for this event. */
  id: string;
  /** The feature vector. Order MUST be stable across history. */
  features: readonly number[];
  /** ms timestamp. Used to age the event. */
  at: number;
}

export type BlackSwanAction =
  | 'monitor'
  | 'expand_window'
  | 'consult_analog'
  | 'escalate_to_review';

export interface BlackSwanAlert {
  detectedAt: number;
  eventId: string;
  /** Higher = more anomalous, 0..1. */
  anomalyScore: number;
  /** Algorithms whose decisions on this event are now suspect. */
  affectedAlgorithms: readonly string[];
  /** Optional nearest historical analog id (e.g. from sequence-matcher).
   *  Null when no analog could be located. */
  nearestHistoricalAnalog: string | null;
  suggestedAction: BlackSwanAction;
}

export interface BlackSwanStatus {
  /** Per-event anomaly scores recently computed. */
  recentScores: readonly { id: string; score: number; at: number }[];
  /** Active alerts (one per anomalous event in the recent window). */
  alerts: readonly BlackSwanAlert[];
  generatedAt: number;
}

export interface IsolationForestOptions {
  /** Number of trees. Default 50. */
  trees?: number;
  /** Sample size per tree. Default 32. */
  sampleSize?: number;
  /** Maximum tree depth (the spec's c(n) cap). Default ceil(log2(sampleSize)). */
  maxDepth?: number;
  rng?: () => number;
}

const DEFAULTS = {
  trees: 50,
  sampleSize: 32,
};

// ── Tree types ────────────────────────────────────────────────────────

type TreeNode =
  | { kind: 'leaf'; size: number }
  | { kind: 'split'; featureIndex: number; threshold: number; left: TreeNode; right: TreeNode };

// ── Tree building ─────────────────────────────────────────────────────

function buildTree(
  points: number[][],
  depth: number,
  maxDepth: number,
  rng: () => number,
): TreeNode {
  if (depth >= maxDepth || points.length <= 1) {
    return { kind: 'leaf', size: points.length };
  }
  const numFeatures = points[0]!.length;
  if (numFeatures === 0) return { kind: 'leaf', size: points.length };
  const featureIndex = Math.floor(rng() * numFeatures);
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = p[featureIndex] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return { kind: 'leaf', size: points.length };
  const threshold = min + rng() * (max - min);
  const left: number[][] = [];
  const right: number[][] = [];
  for (const p of points) {
    if ((p[featureIndex] ?? 0) < threshold) left.push(p);
    else right.push(p);
  }
  if (left.length === 0 || right.length === 0) {
    return { kind: 'leaf', size: points.length };
  }
  return {
    kind: 'split',
    featureIndex,
    threshold,
    left: buildTree(left, depth + 1, maxDepth, rng),
    right: buildTree(right, depth + 1, maxDepth, rng),
  };
}

// ── Path length ───────────────────────────────────────────────────────

/** Average path length of an unsuccessful BST search (used to
 *  normalize iForest scores). */
function avgPathLength(n: number): number {
  if (n <= 1) return 0;
  const harmonic = Math.log(n - 1) + 0.577_215_664_9; // Euler-Mascheroni
  return 2 * harmonic - (2 * (n - 1)) / n;
}

function pathLength(node: TreeNode, point: readonly number[], depth = 0): number {
  if (node.kind === 'leaf') {
    return depth + avgPathLength(node.size);
  }
  const v = point[node.featureIndex] ?? 0;
  return v < node.threshold
    ? pathLength(node.left, point, depth + 1)
    : pathLength(node.right, point, depth + 1);
}

// ── Forest API ────────────────────────────────────────────────────────

export interface IsolationForest {
  trees: readonly TreeNode[];
  sampleSize: number;
}

export function buildIsolationForest(
  history: readonly EventFeatures[],
  options: IsolationForestOptions = {},
): IsolationForest {
  const trees = options.trees ?? DEFAULTS.trees;
  const sampleSize = Math.min(options.sampleSize ?? DEFAULTS.sampleSize, history.length);
  const maxDepth = options.maxDepth ?? Math.max(1, Math.ceil(Math.log2(Math.max(2, sampleSize))));
  const rng = options.rng ?? Math.random;
  const out: TreeNode[] = [];
  if (history.length === 0) return { trees: [], sampleSize: 0 };

  // Materialize features as plain arrays for fast indexing.
  const features = history.map((h) => [...h.features]);
  for (let i = 0; i < trees; i += 1) {
    const sample = randomSample(features, sampleSize, rng);
    out.push(buildTree(sample, 0, maxDepth, rng));
  }
  return { trees: out, sampleSize };
}

function randomSample<T>(items: readonly T[], k: number, rng: () => number): T[] {
  if (k >= items.length) return [...items];
  const result: T[] = [];
  const indices = new Set<number>();
  while (indices.size < k) {
    const idx = Math.floor(rng() * items.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      result.push(items[idx]!);
    }
  }
  return result;
}

/** Score a single point's anomaly score in [0, 1]. Combines the
 *  classic iForest path-length score with a bounding-box distance
 *  signal, since pure iForest underestimates anomaly scores for
 *  points far outside the training distribution (the "ride-along"
 *  problem — an extreme outlier walks down the tree alongside the
 *  in-distribution maxima rather than getting isolated faster). */
export function isolationForestScore(
  forest: IsolationForest,
  point: readonly number[],
  options: { historyBounds?: { min: number; max: number }[] } = {},
): number {
  if (forest.trees.length === 0 || forest.sampleSize === 0) return 0;
  let total = 0;
  for (const tree of forest.trees) total += pathLength(tree, point);
  const meanPath = total / forest.trees.length;
  const c = avgPathLength(forest.sampleSize);
  if (c === 0) return 0;
  const treeScore = 2 ** (-meanPath / c);
  const boxScore = options.historyBounds
    ? boundingBoxAnomaly(point, options.historyBounds)
    : 0;
  return Math.max(treeScore, boxScore);
}

/** Distance signal: 0 when the point is fully inside the per-feature
 *  bounding box; saturates toward 1 as the point moves multiple
 *  feature spans away from the box. */
function boundingBoxAnomaly(
  point: readonly number[],
  bounds: readonly { min: number; max: number }[],
): number {
  let outsideFeatures = 0;
  let totalRelativeDistance = 0;
  for (const [i, b] of bounds.entries()) {
    const v = point[i] ?? 0;
    const span = Math.max(1e-9, b.max - b.min);
    if (v < b.min) {
      outsideFeatures += 1;
      totalRelativeDistance += (b.min - v) / span;
    } else if (v > b.max) {
      outsideFeatures += 1;
      totalRelativeDistance += (v - b.max) / span;
    }
  }
  if (outsideFeatures === 0) return 0;
  // Saturate: 1 feature span out → 0.85, 2+ → ≥0.92, 5+ → ≥0.97
  return 1 - 1 / (1 + totalRelativeDistance);
}

/** Compute per-feature [min, max] from history. */
export function computeHistoryBounds(history: readonly EventFeatures[]): { min: number; max: number }[] {
  if (history.length === 0) return [];
  const numFeatures = history[0]!.features.length;
  const out: { min: number; max: number }[] = Array.from({ length: numFeatures }, () => ({
    min: Infinity,
    max: -Infinity,
  }));
  for (const ev of history) {
    for (let i = 0; i < numFeatures; i += 1) {
      const v = ev.features[i] ?? 0;
      const b = out[i]!;
      if (v < b.min) b.min = v;
      if (v > b.max) b.max = v;
    }
  }
  return out;
}

// ── Alert generation ──────────────────────────────────────────────────

export interface DetectBlackSwanInput {
  candidate: EventFeatures;
  history: readonly EventFeatures[];
  /** Algorithms whose decisions touched this event. */
  affectedAlgorithms?: readonly string[];
  /** Optional analog lookup result. */
  nearestHistoricalAnalog?: string | null;
  /** Anomaly score threshold. Default 0.85. */
  threshold?: number;
  forestOptions?: IsolationForestOptions;
  now?: () => number;
}

export function detectBlackSwan(input: DetectBlackSwanInput): {
  score: number;
  alert: BlackSwanAlert | null;
} {
  const threshold = input.threshold ?? 0.85;
  const forest = buildIsolationForest(input.history, input.forestOptions);
  const bounds = computeHistoryBounds(input.history);
  const score = isolationForestScore(forest, input.candidate.features, { historyBounds: bounds });
  if (score <= threshold) return { score, alert: null };
  const now = (input.now ?? (() => Date.now()))();
  return {
    score,
    alert: {
      detectedAt: now,
      eventId: input.candidate.id,
      anomalyScore: score,
      affectedAlgorithms: [...(input.affectedAlgorithms ?? [])],
      nearestHistoricalAnalog: input.nearestHistoricalAnalog ?? null,
      suggestedAction: scoreToAction(score),
    },
  };
}

function scoreToAction(score: number): BlackSwanAction {
  if (score >= 0.97) return 'escalate_to_review';
  if (score >= 0.92) return 'consult_analog';
  if (score >= 0.85) return 'expand_window';
  return 'monitor';
}

// ── Status cache (sidecar mirror) ─────────────────────────────────────

const recentScores: { id: string; score: number; at: number }[] = [];
const activeAlerts: BlackSwanAlert[] = [];

export function recordBlackSwanScore(eventId: string, score: number, at: number): void {
  recentScores.push({ id: eventId, score, at });
  while (recentScores.length > 200) recentScores.shift();
}

export function recordBlackSwanAlert(alert: BlackSwanAlert): void {
  activeAlerts.push({ ...alert });
  while (activeAlerts.length > 50) activeAlerts.shift();
}

export function getBlackSwanStatus(now: number = Date.now()): BlackSwanStatus {
  return {
    recentScores: [...recentScores],
    alerts: [...activeAlerts],
    generatedAt: now,
  };
}

export function _resetBlackSwanCacheForTests(): void {
  recentScores.length = 0;
  activeAlerts.length = 0;
}
