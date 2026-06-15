/**
 * Bayesian Online Change-Point Detection (BOCPD) for baseline-deviation series.
 *
 * Z-scores from baseline-deviation.ts answer "is now abnormal?"
 * BOCPD answers "did the regime just *shift*?" — earlier detection on slow
 * drifts and fewer false alarms than threshold crossings.
 *
 * Algorithm: constant-time Gaussian BOCPD with conjugate Normal-Gamma prior.
 * Run-length posterior is maintained as a truncated probability vector;
 * a change-point is declared when the hazard-weighted probability of run-length
 * 0 (new epoch) exceeds a configurable threshold.
 *
 * Reference: Adams & MacKay (2007) "Bayesian Online Changepoint Detection"
 * arXiv:0710.3742 — the core recursion is ~10 lines.
 *
 * Plan invariants:
 *   - Pure deterministic; no DOM, no fetch, no globals at import time.
 *   - Every emitted RegimeShift includes an explanation string (plan invariant).
 *   - Testable with static fixture sequences.
 */

import type { MetricKey } from '../intelligence/baseline-deviation';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegimeShift {
  metric: MetricKey;
  detectedAt: number;           // epoch ms when the shift was declared
  /** Value that triggered detection. */
  triggerValue: number;
  /** Run-length at the most probable change-point (samples since last shift). */
  runLength: number;
  /** Probability mass on run-length = 0 (new epoch), 0–1. */
  changeProbability: number;
  /** Direction of the new regime relative to the prior mean. */
  direction: 'up' | 'down' | 'unclear';
  /** Plain-English explanation (plan invariant: every score has an explanation). */
  explanation: string;
}

export interface BOCPDOptions {
  /**
   * Hazard rate — expected probability of a change-point at any given step.
   * Higher = more sensitive. Default 1/50 (expect a shift every ~50 samples).
   */
  hazardRate?: number;
  /**
   * Log Bayes factor threshold for declaring a regime shift.
   * A shift is declared when log P(x | prior) - log P(x | fitted_posterior) >= threshold.
   * Higher = fewer false alarms. Default 3.0 (moderate-to-strong Bayesian evidence).
   * Set to 1.5 for more sensitive detection on clear step changes.
   */
  changeThreshold?: number;
  /**
   * Maximum run-length tracked before older run-lengths are pruned.
   * Bounds memory to O(maxRunLength). Default 200.
   */
  maxRunLength?: number;
  /**
   * Normal-Gamma prior parameters for the Gaussian likelihood.
   * These are the conjugate prior hyperparameters:
   *   mu0    = prior mean (default 0)
   *   kappa0 = strength of mean prior (default 1)
   *   alpha0 = shape of variance prior (default 1)
   *   beta0  = rate of variance prior (default 1)
   */
  mu0?: number;
  kappa0?: number;
  alpha0?: number;
  beta0?: number;
  /**
   * Minimum samples before a shift is ever declared. Avoids noisy startup.
   * Default 10.
   */
  minSamplesBeforeShift?: number;
}

export interface BOCPDState {
  /** Series identifier this detector tracks. */
  metric: MetricKey;
  /** Number of samples seen so far. */
  n: number;
  /**
   * Run-length posterior: runProbs[r] = P(run-length = r | data).
   * Index 0 = new epoch. Kept normalized.
   */
  runProbs: number[];
  /**
   * Normal-Gamma sufficient statistics for each run length r:
   *   stats[r] = { mu, kappa, alpha, beta }
   */
  stats: Array<{ mu: number; kappa: number; alpha: number; beta: number }>;
  /** Most recent detected shift, if any. */
  lastShift?: RegimeShift;
}

const DEFAULTS = {
  hazardRate: 1 / 50,
  changeThreshold: 3.0,   // log Bayes factor — moderate-to-strong evidence
  maxRunLength: 200,
  mu0: 0,
  kappa0: 1,
  alpha0: 1,
  beta0: 1,
  minSamplesBeforeShift: 10,
};

// ── Core BOCPD recursion ──────────────────────────────────────────────────────

/**
 * Create a fresh BOCPD state for a metric.
 */
export function createBOCPDState(metric: MetricKey, opts: BOCPDOptions = {}): BOCPDState {
  const { mu0, kappa0, alpha0, beta0 } = { ...DEFAULTS, ...opts };
  return {
    metric,
    n: 0,
    runProbs: [1.0],                   // P(run-length=0) = 1 initially
    stats: [{ mu: mu0, kappa: kappa0, alpha: alpha0, beta: beta0 }],
  };
}

/**
 * Student-t predictive probability: p(x | stats[r]).
 * The conjugate posterior predictive for a Normal-Gamma prior is a
 * Student-t with 2*alpha degrees of freedom.
 */
function predictiveProb(x: number, s: { mu: number; kappa: number; alpha: number; beta: number }): number {
  const { mu, kappa, alpha, beta } = s;
  const df = 2 * alpha;
  const scale2 = (beta * (kappa + 1)) / (alpha * kappa);
  const t = (x - mu) / Math.sqrt(scale2);
  // Log Student-t density for numerical stability, then exp.
  // lgamma approximation via Lanczos coefficients for df ∈ (0, ∞).
  const logProb =
    lgamma((df + 1) / 2) -
    lgamma(df / 2) -
    0.5 * Math.log(df * Math.PI * scale2) -
    ((df + 1) / 2) * Math.log(1 + (t * t) / df);
  return Math.exp(logProb);
}

/** Lanczos approximation of log-gamma, accurate to ~1e-9 for x > 0. */
function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0] as number;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += (c[i] as number) / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Normal-Gamma posterior update: incorporate observation x into stats[r].
 */
function updateStats(
  s: { mu: number; kappa: number; alpha: number; beta: number },
  x: number,
): { mu: number; kappa: number; alpha: number; beta: number } {
  const { mu, kappa, alpha, beta } = s;
  const kappa1 = kappa + 1;
  const mu1 = (kappa * mu + x) / kappa1;
  const alpha1 = alpha + 0.5;
  const beta1 = beta + (kappa * (x - mu) * (x - mu)) / (2 * kappa1);
  return { mu: mu1, kappa: kappa1, alpha: alpha1, beta: beta1 };
}

/**
 * Ingest one sample; returns a RegimeShift if a change-point is detected.
 */
export function ingestSample(
  state: BOCPDState,
  value: number,
  timestampMs: number,
  opts: BOCPDOptions = {},
): RegimeShift | null {
  const { hazardRate, changeThreshold, maxRunLength, mu0, kappa0, alpha0, beta0, minSamplesBeforeShift } = {
    ...DEFAULTS,
    ...opts,
  };
  state.n++;

  const R = state.runProbs.length;
  const newProbs: number[] = new Array(R + 1).fill(0);
  const newStats: Array<{ mu: number; kappa: number; alpha: number; beta: number }> = new Array(R + 1).fill(null);

  // P(run-length = 0 | data[1:t]) — reset/change point
  // = sum_r  P(x_t | stats[r]) * hazard * P(run-length = r-1)
  let changeProb = 0;
  let growProb = 0;

  for (let r = 0; r < R; r++) {
    const rStats = state.stats[r]!;
    const rProb = state.runProbs[r]!;
    const pp = predictiveProb(value, rStats);
    const h = hazardRate;

    // Change-point contribution (run-length collapses to 0)
    changeProb += pp * h * rProb;

    // Growth contribution (run-length increments by 1)
    if (r + 1 <= maxRunLength) {
      newProbs[r + 1] = (newProbs[r + 1] ?? 0) + pp * (1 - h) * rProb;
      newStats[r + 1] = updateStats(rStats, value);
      growProb += pp * (1 - h) * rProb;
    }
  }

  // New epoch (run-length = 0) gets the prior
  newProbs[0] = changeProb;
  newStats[0] = { mu: mu0, kappa: kappa0, alpha: alpha0, beta: beta0 };

  // Normalize
  const total = newProbs.reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (let i = 0; i < newProbs.length; i++) newProbs[i] = (newProbs[i] ?? 0) / total;
  }

  // ── logBF detection — must use PRE-UPDATE state ──────────────────────────
  // state.runProbs / state.stats still hold the old-regime posterior here.
  // Computing logBF after the state overwrite (the prior bug) caused ppMAP to
  // use the NEWLY updated posterior, which already absorbed the outlier and
  // widened its variance — making ppPrior ≈ ppMAP and logBF ≈ 0.
  const prior = { mu: mu0, kappa: kappa0, alpha: alpha0, beta: beta0 };
  const ppPrior = predictiveProb(value, prior);

  // MAP run-length from the OLD (pre-update) posterior
  let mapR = 0;
  for (let r = 1; r < state.runProbs.length; r++) {
    if ((state.runProbs[r] ?? 0) > (state.runProbs[mapR] ?? 0)) mapR = r;
  }
  const ppMAP = mapR > 0 ? predictiveProb(value, state.stats[mapR]!) : ppPrior;
  const logBF = Math.log(ppPrior + 1e-300) - Math.log(ppMAP + 1e-300);

  // Save old-regime baseline before state is overwritten
  const preUpdateFittedMean = mapR > 0 ? (state.stats[mapR]?.mu ?? mu0) : mu0;
  const preUpdateRunLength = mapR;

  // ── Commit state update ───────────────────────────────────────────────────
  state.runProbs = newProbs.slice(0, maxRunLength + 1);
  state.stats = newStats.slice(0, maxRunLength + 1);

  if (state.n >= minSamplesBeforeShift && logBF >= changeThreshold) {
    const direction: RegimeShift['direction'] =
      value > preUpdateFittedMean + 0.5 ? 'up' :
      value < preUpdateFittedMean - 0.5 ? 'down' :
      'unclear';

    // Map logBF to a rough posterior probability via sigmoid: p = 1/(1+e^(-logBF/3)).
    const changeProbEst = Math.min(0.999, 1 / (1 + Math.exp(-logBF / 3)));
    const shift: RegimeShift = {
      metric: state.metric,
      detectedAt: timestampMs,
      triggerValue: value,
      runLength: preUpdateRunLength,
      changeProbability: Math.round(changeProbEst * 1000) / 1000,
      direction,
      explanation: buildExplanation(state.metric, value, changeProbEst, preUpdateRunLength, direction),
    };
    state.lastShift = shift;
    return shift;
  }

  return null;
}

function buildExplanation(
  metric: MetricKey,
  value: number,
  prob: number,
  runLength: number,
  direction: RegimeShift['direction'],
): string {
  const pct = Math.round(prob * 100);
  const dirLabel = direction === 'up' ? 'upward' : direction === 'down' ? 'downward' : '';
  const dirPart = dirLabel ? ` ${dirLabel}` : '';
  const epochPart = runLength > 0 ? ` after ${runLength}-sample stable period` : '';
  return `${pct}% probability of a${dirPart} regime shift in "${metric}" (value ${round2(value)})${epochPart}.`;
}

function round2(x: number): number { return Math.round(x * 100) / 100; }

// ── Multi-metric detector ─────────────────────────────────────────────────────

/**
 * Maintains one BOCPDState per MetricKey.
 * Call `feed(metric, value, ts)` as new samples arrive; register listeners
 * via `onShift`. Designed to be driven by the same samples that go into
 * `BaselineStore.record()`.
 */
export interface RegimeDetector {
  /** Feed a new observation. Returns a shift if one was detected. */
  feed: (metric: MetricKey, value: number, timestampMs: number) => RegimeShift | null;
  /** Register a listener for regime shifts. Returns unsubscribe fn. */
  onShift: (cb: (shift: RegimeShift) => void) => () => void;
  /** Current state for a metric (for diagnostics / serialization). */
  stateFor: (metric: MetricKey) => BOCPDState | undefined;
  /** All tracked metrics. */
  metrics: () => MetricKey[];
  /** Remove state for a metric (e.g. after a worktree cleanup). */
  reset: (metric?: MetricKey) => void;
}

export function createRegimeDetector(opts: BOCPDOptions = {}): RegimeDetector {
  const states = new Map<MetricKey, BOCPDState>();
  const listeners = new Set<(shift: RegimeShift) => void>();

  function feed(metric: MetricKey, value: number, timestampMs: number): RegimeShift | null {
    let state = states.get(metric);
    if (!state) {
      state = createBOCPDState(metric, opts);
      states.set(metric, state);
    }
    const shift = ingestSample(state, value, timestampMs, opts);
    if (shift) {
      listeners.forEach(cb => {
        try { cb(shift); } catch { /* listeners must not crash the detector */ }
      });
    }
    return shift;
  }

  function onShift(cb: (shift: RegimeShift) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }

  function stateFor(metric: MetricKey): BOCPDState | undefined {
    return states.get(metric);
  }

  function metrics(): MetricKey[] {
    return [...states.keys()];
  }

  function reset(metric?: MetricKey): void {
    if (metric) { states.delete(metric); } else { states.clear(); }
  }

  return { feed, onShift, stateFor, metrics, reset };
}

// ── Singleton for app-wide use ─────────────────────────────────────────────────

let _singleton: RegimeDetector | null = null;

export function getRegimeDetector(): RegimeDetector {
  if (!_singleton) _singleton = createRegimeDetector();
  return _singleton;
}

/** Replace the singleton (for tests). */
export function setRegimeDetector(d: RegimeDetector | null): void {
  _singleton = d;
}
