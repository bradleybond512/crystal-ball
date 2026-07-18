/**
 * BeliefValue — a first-class probability type for Crystal Ball.
 *
 * Represents a probability estimate with:
 * - point: the best-guess probability [0, 1]
 * - lower/upper: 90% confidence interval
 * - stalenessFactor: how much to widen the interval due to stale inputs (0 = fresh, 1 = fully stale)
 * - provenance: IDs of evidence nodes contributing to this value
 * - assumptionIds: IDs of tracked assumptions this estimate depends on
 * - updatedAt: when this belief was last computed
 * - staleAt: when inputs feeding this belief expire (if known)
 *
 * This is the foundational probability type (AI-2 of the v3.0 architectural
 * imperatives). Everything epistemic — competitive hypotheses, assumption
 * tracking, calibration curves — is meant to build on it. Keep it a plain
 * data shape: all behaviour lives in `src/services/intelligence/belief-helpers.ts`
 * so the type stays import-cheap and free of runtime dependencies.
 * (The old `src/components/belief-helpers.ts` path is now a re-export shim.)
 */
export interface BeliefValue {
  /** Best-guess probability, [0, 1]. */
  point: number;
  /** Lower bound of the 90% confidence interval, [0, 1]. */
  lower: number;
  /** Upper bound of the 90% confidence interval, [0, 1]. */
  upper: number;
  /** [0, 1]: 0 = fully fresh, 1 = maximally stale. Drives interval widening. */
  stalenessFactor: number;
  /** Evidence node IDs that contributed to this value. */
  provenance: string[];
  /** Assumption IDs this estimate depends on. */
  assumptionIds: string[];
  /** ISO timestamp of when this belief was last computed. */
  updatedAt: string;
  /** ISO timestamp of when this belief becomes stale, if known. */
  staleAt?: string;
  /** How this belief was combined from its inputs. */
  combiningRule: CombiningRule;
}

export type CombiningRule = 'noisy-or' | 'min' | 'max' | 'average' | 'log-odds';

/**
 * ICD 203 probability lexicon. The Intelligence Community's "Words of
 * Estimative Probability" — a fixed vocabulary so that "likely" means the
 * same thing to every reader. The numeric bands attached to each label live
 * in `getProbabilityLabel`.
 */
export type ProbabilityLabel =
  | 'almost-certainly'   // 95-99%
  | 'very-likely'        // 85-95%
  | 'likely'             // 70-85%
  | 'roughly-even'       // 45-55%
  | 'unlikely'           // 30-45% (complement: likely)
  | 'very-unlikely'      // 15-30%
  | 'almost-certainly-not'; // 1-5%
