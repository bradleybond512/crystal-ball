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
  {
    algorithmId: 'big-event-detector',
    parameterId: 'rapidJumpDelta',
    default: 25,
    min: 15,
    max: 40,
    step: 5,
    // Over-firing on small severity wiggles → require a bigger jump.
    fixDirection: 'increase',
    description: 'Severity-points jump (current − previous) that fires rapid_severity_jump.',
    // Trigger feeds the big-event score that gates the notification ladder.
    affectsNotifications: true,
  },
  {
    algorithmId: 'big-event-detector',
    parameterId: 'exposureFloor',
    default: 70,
    min: 50,
    max: 90,
    step: 5,
    // Personal-exposure trigger firing on weak exposure → raise the floor.
    fixDirection: 'increase',
    description: 'User-exposure score (0-100) above which high_personal_exposure fires.',
    affectsNotifications: true,
  },
  {
    algorithmId: 'hypothesis-feedback',
    parameterId: 'downPenalty',
    default: 0.5,
    min: 0.3,
    max: 0.7,
    step: 0.05,
    // Hypotheses graded as misses despite down-votes not sinking them →
    // weight down-votes harder.
    fixDirection: 'increase',
    description: 'Weight applied to the down-vote ratio in the hypothesis feedback multiplier.',
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

  // ── PR 12: Self-tuning cognition ──────────────────────────────────────
  // Every cognition constant becomes a declared tunable with bounds
  // (docs/COGNITIVE_ENHANCEMENT_PLAN.md Part D PR 12). The cognition
  // modules read these via getTunedParam with the old hardcoded value as
  // the fallback default, so an empty store is byte-identical to the
  // pre-PR-12 behavior.
  {
    algorithmId: 'episodic-analog',
    parameterId: 'minSim',
    default: 0.45,
    min: 0.3,
    max: 0.6,
    step: 0.05,
    // Misses mean noisy analogs are qualifying (weak matches driving the
    // analog score the wrong way) → raise the similarity bar.
    fixDirection: 'increase',
    description: 'Minimum cosine similarity for a past episode to qualify as an analog.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'episodic-analog',
    parameterId: 'analogBlendK',
    default: 5,
    min: 3,
    max: 10,
    step: 1,
    // Misses mean thin episodic history is moving the blended base rate
    // too far → require more analogs before episodic evidence dominates.
    fixDirection: 'increase',
    description: 'Bayesian pseudo-count in the episodic blend weight analogN/(analogN+k).',
    affectsNotifications: false,
  },
  {
    algorithmId: 'recalibration',
    parameterId: 'shrinkPrior',
    default: 10,
    min: 5,
    max: 20,
    step: 1,
    // Misses mean the reliability curve is overcorrecting on thin bins →
    // shrink corrections harder toward identity.
    fixDirection: 'increase',
    description: 'Laplace shrinkage pseudo-count pulling per-bin calibration corrections toward 0.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'superforecast',
    parameterId: 'extremizeK',
    default: 1.3,
    min: 1,
    max: 1.8,
    step: 0.1,
    // Misses mean the aggregate is over-sharpened → move k back toward
    // the identity (k=1, no extremization).
    fixDirection: 'decrease',
    description: 'Satopää extremization exponent applied to the geometric-mean-of-odds aggregate.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'superforecast',
    parameterId: 'spreadSkipThreshold',
    default: 0.25,
    min: 0.15,
    max: 0.4,
    step: 0.05,
    // Misses mean contested estimates are still being sharpened → skip
    // extremization at lower disagreement.
    fixDirection: 'decrease',
    description: 'Persona-estimate spread above which extremization is skipped (disagreement guard).',
    affectsNotifications: false,
  },
  {
    algorithmId: 'entity-trajectory',
    parameterId: 'heatHalfLifeHours',
    default: 72,
    min: 24,
    max: 168,
    step: 12,
    // Misses mean stale entities still read as hot → decay heat faster.
    fixDirection: 'decrease',
    description: 'Exponential half-life (hours) of the entity dossier heat score.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'operator-ranking',
    parameterId: 'interestHalfLifeHours',
    default: 168,
    min: 72,
    max: 336,
    step: 24,
    // Misses mean stale interests are still boosting rankings → forget
    // unreinforced interest terms faster.
    fixDirection: 'decrease',
    description: 'Half-life (hours) of operator interest-term weights without reinforcement.',
    affectsNotifications: false,
  },
  {
    algorithmId: 'consolidation',
    parameterId: 'clusterSimThreshold',
    default: 0.6,
    min: 0.5,
    max: 0.75,
    step: 0.05,
    // Bad learned schemas mean clusters are too loose → require tighter
    // cosine similarity before episodes consolidate into a schema.
    fixDirection: 'increase',
    description: 'Cosine similarity threshold for episode clustering during memory consolidation.',
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
