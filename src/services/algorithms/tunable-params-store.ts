/**
 * Tunable Parameter Store — B2 vertical slice (self-improvement gameplan).
 *
 * The closed-loop tuner (`safe-adjustment` / `adaptive-tuner`) computes
 * parameter adjustments, but the algorithms read hardcoded constants, so a
 * proposal had nowhere to land. This store is the missing apply target: a
 * small persisted map of tunable parameter values that:
 *   - algorithms (via their orchestration call sites) read their CURRENT value
 *     from, falling back to the hardcoded default when unset;
 *   - the tuning-apply runner writes accepted (policy-gated) values into.
 *
 * Values are always clamped to the declared [min, max] bound on both read and
 * write, so a corrupted store or an out-of-range proposal can never push a
 * parameter outside its safe envelope.
 *
 * Start small: one declared knob (big-event-detector threshold). Add more by
 * extending DECLARATIONS once the slice is proven.
 */

import type { AlgorithmAdjustmentTuning, TunableParameter, ParameterDirection } from './safe-adjustment';

const STORAGE_KEY = 'crystalball-tunable-params-v1';

interface TunableDeclaration {
  algorithmId: string;
  parameterId: string;
  /** Hardcoded default the algorithm used before it was made tunable. */
  default: number;
  min: number;
  max: number;
  step: number;
  /** Direction the tuner nudges this param when the algorithm is unhealthy. */
  fixDirection: ParameterDirection;
  description: string;
  /** True when changing this param alters what the user is notified about.
   *  The policy gate applies a stricter notification-specific approval rule,
   *  so a tuning here can never silently change notification behavior. */
  affectsNotifications: boolean;
}

/** The declared knobs the tuner is allowed to turn. */
const DECLARATIONS: readonly TunableDeclaration[] = [
  {
    algorithmId: 'big-event-detector',
    parameterId: 'threshold',
    default: 40,
    min: 20,
    max: 60,
    step: 5,
    // When the detector is unhealthy (over-firing / low precision), raise the
    // bar so fewer borderline events qualify.
    fixDirection: 'increase',
    description: 'Total-score threshold above which an event is "big".',
    // This threshold gates whether weather alerts enter the notification
    // ladder, so tuning it is a notification-affecting change.
    affectsNotifications: true,
  },
  {
    algorithmId: 'negative-evidence',
    parameterId: 'maxPenalty',
    default: 0.6,
    min: 0.2,
    max: 0.9,
    step: 0.1,
    // Graded on whether the missing signals truly never arrived: a "miss"
    // means the absence penalty was wrong (the signal showed up after all),
    // so when it mis-grades, reduce the max penalty — be less aggressive
    // about penalizing absence.
    fixDirection: 'decrease',
    description: 'Maximum absence penalty applied when expected follow-on signals are missing.',
    // Confidence-scoring knob in the intelligence layer — it does not
    // directly control any notification rung / suppression / bypass.
    affectsNotifications: false,
  },
  {
    algorithmId: 'correlation-feedback',
    parameterId: 'feedbackThreshold',
    default: 0.55,
    min: 0.3,
    max: 0.8,
    step: 0.05,
    // Correlation rules whose user-feedback multiplier drops below this
    // threshold are disabled. A "miss" (predicted correlated pair that
    // turned out to be noise) means the threshold is too permissive —
    // raise it to require stronger feedback confirmation before enabling
    // a correlation rule.
    fixDirection: 'increase',
    description: 'Minimum feedback multiplier for a correlation rule to stay enabled.',
    // Outputs risk_score/ranking for the correlations panel only — does
    // not gate any notification rung, suppression window, or bypass.
    affectsNotifications: false,
  },

  // ── Cognition layer tunables (PR 12) ──────────────────────────────────
  // These eight knobs expose the constants in src/services/cognition/
  // that were identified as high-leverage tuning targets. The bounds
  // come directly from docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 12 section.
  // None of these directly gate a notification rung or suppression window,
  // so affectsNotifications is false for all of them.

  {
    algorithmId: 'episodic-analog',
    parameterId: 'minSim',
    default: 0.45,
    min: 0.30,
    max: 0.60,
    step: 0.05,
    // When episodic recall quality degrades (too many low-quality analogs),
    // raise the threshold to require tighter semantic similarity before a
    // recall qualifies for the analog score. Lower it if the system can't
    // find enough analogs to produce a score (recall = null too often).
    fixDirection: 'increase',
    description: 'Minimum cosine similarity for an episode to qualify as an analog (episodic recall threshold).',
    affectsNotifications: false,
  },
  {
    algorithmId: 'episodic-analog',
    parameterId: 'analogBlendConstant',
    default: 5,
    min: 3,
    max: 10,
    step: 1,
    // The Bayesian pseudo-count in blendWithEpisodic: rate weight =
    // analogN / (analogN + constant). Larger constant means the static
    // base rate dominates until many analogs accumulate. Tune down if
    // episodic data is trustworthy; tune up if base rates are more reliable.
    fixDirection: 'increase',
    description: 'Pseudo-count denominator for blending episodic analog score with static base rate.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'cognition-recalibration',
    parameterId: 'shrinkagePrior',
    default: 10,
    min: 5,
    max: 20,
    step: 1,
    // Laplace shrinkage: bin correction is shrunk by n/(n + prior). A
    // larger prior means bin corrections require more data before they
    // move the calibrated probability. Tune up when small bins
    // over-correct; tune down when the calibration curve is too flat.
    fixDirection: 'increase',
    description: 'Laplace shrinkage pseudo-count for per-bin calibration corrections.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'superforecast',
    parameterId: 'extremizationK',
    default: 1.3,
    min: 1.0,
    max: 1.8,
    step: 0.1,
    // Extremization sharpening exponent. k=1 is identity; larger values
    // push aggregated probabilities toward 0 or 1. Tune up when the
    // system is underconfident (calibration shows predicted probs cluster
    // near 0.5 more than observed rates warrant); tune down when it's
    // over-confident or high spread makes sharpening unsafe.
    fixDirection: 'decrease',
    description: 'Extremization sharpening exponent k (p\' = p^k / (p^k + (1-p)^k)).',
    affectsNotifications: false,
  },
  {
    algorithmId: 'superforecast',
    parameterId: 'spreadSkipThreshold',
    default: 0.25,
    min: 0.15,
    max: 0.40,
    step: 0.05,
    // When spread (max-min of estimates) exceeds this, extremization is
    // skipped because high disagreement means sharpening is unsafe. Tune
    // up to permit extremization even when forecasters disagree more;
    // tune down to skip extremization more conservatively.
    fixDirection: 'increase',
    description: 'Spread threshold above which extremization is skipped (high-disagreement guard).',
    affectsNotifications: false,
  },
  {
    algorithmId: 'entity-trajectory',
    parameterId: 'heatHalfLifeHours',
    default: 72,
    min: 24,
    max: 168,
    step: 12,
    // Half-life of entity heat decay. Shorter half-life makes entity
    // heat decay quickly (fast-breaking events dominate, old events
    // rapidly forgotten). Longer half-life maintains heat for slow-
    // moving geopolitical or market situations. Tune down when entity
    // heat is too "sticky" and old events crowd out fresh signals.
    fixDirection: 'decrease',
    description: 'Entity heat score exponential decay half-life in hours.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'operator-ranking',
    parameterId: 'interestDecayHalfLifeDays',
    default: 7,
    min: 3,
    max: 21,
    step: 1,
    // Half-life of operator interest weight decay. Shorter half-life
    // makes the operator model track only very recent engagement.
    // Longer half-life makes interests more persistent. Tune down if
    // operator interests shift rapidly; tune up for domain experts.
    fixDirection: 'increase',
    description: 'Operator interest weight decay half-life in days.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'episodic-analog',
    parameterId: 'consolidationClusterThreshold',
    default: 0.6,
    min: 0.5,
    max: 0.75,
    step: 0.05,
    // Cosine similarity threshold for greedy episode clustering during
    // memory consolidation. Higher threshold → tighter clusters, more
    // specific learned schemas. Lower threshold → broader clusters,
    // more general schemas. Tune down if consolidation rarely finds
    // clusters large enough to learn from; tune up if schemas are too
    // coarse-grained.
    fixDirection: 'increase',
    description: 'Cosine similarity threshold for greedy episode clustering during memory consolidation.',
    affectsNotifications: false,
  },

  // ── PR 15: LLM quality engineering ───────────────────────────────────
  {
    algorithmId: 'superforecast',
    parameterId: 'selfConsistencyK',
    default: 3,
    min: 1,
    max: 5,
    step: 1,
    // Number of samples drawn per persona probability elicitation when the
    // budget allows. k=1 is byte-identical to the pre-PR-15 path (no extra
    // calls, no median logic). k=3 is the default: each persona elicitation
    // draws 3 samples and the median is used, reducing variance. k=5 gives
    // the tightest estimates at the highest cloud-call cost.
    // Tune down if cloud budget is tight; tune up if persona disagreement
    // (spread) is persistently high and budget permits extra sampling.
    fixDirection: 'decrease',
    description: 'Number of self-consistency samples per persona probability elicitation (k=1 = legacy, k=3 = default).',
    affectsNotifications: false,
  },
];

type Store = Record<string, number>; // `${algorithmId}:${parameterId}` -> value

function storageKey(algorithmId: string, parameterId: string): string {
  return `${algorithmId}:${parameterId}`;
}

function declarationFor(algorithmId: string, parameterId: string): TunableDeclaration | undefined {
  return DECLARATIONS.find((d) => d.algorithmId === algorithmId && d.parameterId === parameterId);
}

function clampToBound(decl: TunableDeclaration | undefined, value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (!decl) return value;
  return Math.min(decl.max, Math.max(decl.min, value));
}

function load(): Store {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Guard against a stored `"null"` / array / primitive — JSON.parse
    // succeeds but the value isn't an indexable record, which would make
    // `load()[key]` throw downstream.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Store)
      : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable — tuning falls back to defaults next read */
  }
}

/**
 * Current value for a tunable parameter, clamped to its declared bound.
 * Returns the declared default (or the caller's fallback) when unset/invalid.
 */
export function getTunedParam(algorithmId: string, parameterId: string, fallback: number): number {
  const decl = declarationFor(algorithmId, parameterId);
  const base = decl?.default ?? fallback;
  const raw = load()[storageKey(algorithmId, parameterId)];
  if (typeof raw !== 'number') return clampToBound(decl, base, base);
  return clampToBound(decl, raw, base);
}

/** Persist a new value for a tunable parameter (clamped to its bound). */
export function setTunedParam(algorithmId: string, parameterId: string, value: number): void {
  const decl = declarationFor(algorithmId, parameterId);
  const store = load();
  store[storageKey(algorithmId, parameterId)] = clampToBound(decl, value, decl?.default ?? value);
  save(store);
}

/**
 * Declared tunings with their CURRENT values resolved from the store — the
 * shape `proposeAdjustments` / the diagnostic panel expect.
 */
export function getTunings(): AlgorithmAdjustmentTuning[] {
  const byAlgorithm = new Map<string, TunableParameter[]>();
  for (const d of DECLARATIONS) {
    const param: TunableParameter = {
      parameterId: d.parameterId,
      current: getTunedParam(d.algorithmId, d.parameterId, d.default),
      min: d.min,
      max: d.max,
      step: d.step,
      fixDirection: d.fixDirection,
      description: d.description,
    };
    const list = byAlgorithm.get(d.algorithmId) ?? [];
    list.push(param);
    byAlgorithm.set(d.algorithmId, list);
  }
  return [...byAlgorithm.entries()].map(([algorithmId, parameters]) => ({ algorithmId, parameters }));
}

/** Whether tuning this parameter alters notification behavior (drives the
 *  policy gate's notification-specific approval rule). */
export function tunableAffectsNotifications(algorithmId: string, parameterId: string): boolean {
  return declarationFor(algorithmId, parameterId)?.affectsNotifications ?? false;
}

/** Test/diagnostic helper: clear all stored overrides. */
export function _resetTunedParamsForTests(): void {
  save({});
}
