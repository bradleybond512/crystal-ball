/**
 * Correlation benchmark baseline comparison — single source of truth for "did
 * the correlation stack regress since the last reviewed baseline?"
 *
 * Mirrors src/services/cognition/bench-baseline.ts exactly (a committed JSON
 * baseline next to this module, a pure comparison function, consumed by a CLI
 * script for the CI gate).
 *
 * Every tolerance below is ONE-SIDED. Improving a metric passes silently —
 * ACC-502 through ACC-506 are supposed to move these numbers in the good
 * direction, and a gate that fails on improvement is a gate people delete.
 * Regression past the tolerance fails. Corpus-identity fields are compared for
 * EXACT equality: if `golden-streams.ts` changes, the numbers are not
 * comparable and the baseline must be re-seeded deliberately, in a reviewed
 * diff.
 *
 * Two properties are load-bearing and easy to lose:
 *
 *   fail CLOSED — every gated number on BOTH sides is validated finite before
 *     it is compared. A `NaN` (missing JSON field, corrupt report) makes
 *     `delta > tolerance` false, so a naive directional check reports a clean
 *     PASS on a benchmark that measured nothing at all.
 *   gate USEFULNESS, not just blast radius — a stack that emits no learned
 *     rules and no pairs has zero false positives and zero volume. Every
 *     "lower is better" gate is therefore paired with a "higher is better" one.
 *
 * Consumers:
 *   - scripts/correlation-benchmark.mts (`npm run bench:correlation`, CI gate)
 *   - src/services/correlation/__tests__/bench-correlation.test.mts
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

import type { CorrelationBenchReport } from './bench-correlation';

export interface CorrelationBenchTolerances {
  /** Max allowed absolute drop in miner coupling precision. */
  couplingPrecisionDrop: number;
  /** Max allowed absolute drop in miner coupling recall. */
  couplingRecallDrop: number;
  /** Max allowed absolute drop in built-in-rule pair precision. */
  pairPrecisionDrop: number;
  /** Max allowed absolute drop in built-in-rule pair recall. */
  pairRecallDrop: number;
  /** Max allowed absolute drop in causal-vs-false edge evidence (z) separation. */
  edgeEvidenceSeparationDrop: number;
  /** Max allowed absolute drop in mean confidence on true pairs. */
  meanTruePairConfidenceDrop: number;
  /** Max allowed growth in graded false edges (count). */
  falseEdgeGrowth: number;
  /** Max allowed shrink in learned rules descended from a causal edge (count). */
  causalLearnedRuleShrink: number;
  /** Max allowed growth in learned-rule false positives (count). */
  learnedRuleFalsePositiveGrowth: number;
  /** Max allowed growth in learned-rule pair volume (count). */
  learnedRulePairGrowth: number;
  /**
   * Max allowed FRACTIONAL shrink in causal learned-rule pair volume.
   *
   * Absolute volume is not the goal here — ACC-502..504 legitimately thin the
   * learned-rule set — but the causal subset going almost dark is a broken
   * install/match path, not a win. A bare "must not be exactly 0" check missed
   * 19 → 1, which is the same failure with one pair left alive.
   */
  causalLearnedRulePairShrinkRatio: number;
  /** Max allowed shrink in distinct built-in-rule pair emissions (count). */
  enginePairShrink: number;
}

/**
 * The largest value each gate may be loosened to in a committed baseline.
 *
 * Validating tolerances as "finite and non-negative" only stops the NaN class.
 * A reviewer walking a diff sees twelve plausible-looking numbers, and
 * `causalLearnedRulePairShrinkRatio: 1` plus `enginePairShrink: 22` plus rate
 * drops of `1` is a fully-armed-looking block under which a run that measures
 * NOTHING — zero edges, zero rules, zero pairs, zero precision — still returns
 * PASS. A ceiling makes the disarmed state unrepresentable rather than merely
 * conspicuous. Every ceiling is comfortably above the value in the committed
 * baseline; raising one is a source change, which is a different review.
 */
const TOLERANCE_CEILINGS: CorrelationBenchTolerances = {
  couplingPrecisionDrop: 0.1,
  couplingRecallDrop: 0.1,
  pairPrecisionDrop: 0.1,
  pairRecallDrop: 0.1,
  edgeEvidenceSeparationDrop: 3,
  meanTruePairConfidenceDrop: 0.1,
  falseEdgeGrowth: 3,
  causalLearnedRuleShrink: 1,
  learnedRuleFalsePositiveGrowth: 3,
  learnedRulePairGrowth: 25,
  causalLearnedRulePairShrinkRatio: 0.5,
  enginePairShrink: 2,
};

export interface CorrelationBenchBaseline {
  /** Bumped only when the baseline's own shape changes. */
  schemaVersion: number;
  /** ISO date the baseline was seeded — informational, never compared. */
  seededAt: string;
  /** Human note on what the numbers meant when they were frozen. */
  note: string;

  // corpus identity — exact equality
  streamCount: number;
  observationCount: number;
  plantedCausalCount: number;
  truePairUniverse: number;
  corpusDigest: string;

  // graded metrics
  couplingPrecision: number;
  couplingRecall: number;
  significantEdgeCount: number;
  confoundedFalsePositives: number;
  mediatedFalsePositives: number;
  independentFalsePositives: number;
  inhibitoryEdgesReported: number;
  unplantedFalsePositives: number;
  falseEdgeCount: number;
  edgeEvidenceSeparation: number;
  learnedRuleCount: number;
  learnedRuleFalsePositives: number;
  causalLearnedRuleCount: number;
  enginePairCount: number;
  distinctEnginePairCount: number;
  pairPrecision: number;
  pairRecall: number;
  decoyPairsEmitted: number;
  meanTruePairConfidence: number;
  learnedRulePairCount: number;
  causalLearnedRulePairCount: number;
  minCausalLearnedRulePairCount: number;

  tolerances: CorrelationBenchTolerances;
}

export interface CorrelationBenchComparison {
  ok: boolean;
  reasons: string[];
}

/**
 * The required shape of a baseline's `tolerances` block, and the value each
 * gate takes. This is NOT a fallback: a baseline that omits the block, or omits
 * any single key in it, is rejected. Silently substituting compiled defaults
 * for a corrupt on-disk block is exactly the failure mode the rest of this file
 * exists to prevent — the gate would still report PASS while comparing against
 * numbers nobody reviewed.
 */
export const DEFAULT_CORRELATION_BENCH_TOLERANCES: CorrelationBenchTolerances = {
  couplingPrecisionDrop: 0.02,
  couplingRecallDrop: 0,
  pairPrecisionDrop: 0,
  pairRecallDrop: 0,
  edgeEvidenceSeparationDrop: 1,
  meanTruePairConfidenceDrop: 0.05,
  falseEdgeGrowth: 0,
  causalLearnedRuleShrink: 0,
  learnedRuleFalsePositiveGrowth: 0,
  learnedRulePairGrowth: 5,
  causalLearnedRulePairShrinkRatio: 0.5,
  enginePairShrink: 0,
};

/**
 * The baseline is JSON on disk, so its tolerance block is untyped at runtime.
 * A string or null operand makes every directional comparison NaN, and every
 * `NaN > tolerance` is false — one bad edit silently disarms the whole gate.
 *
 * Validation runs in BOTH directions. Checking only the keys that are present
 * is a one-way gate: `tolerances: null`, a scalar, or a block missing half its
 * keys all fall through to the compiled defaults and can still report PASS.
 */
function resolveTolerances(
  reasons: string[],
  // `unknown`, not the declared type: the declared type is a lie about a value
  // that was parsed out of JSON, and every check below exists to catch the
  // shapes the type system has already promised are impossible.
  raw: unknown,
): CorrelationBenchTolerances {
  const tol = { ...DEFAULT_CORRELATION_BENCH_TOLERANCES };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    reasons.push(
      `baseline "tolerances" is not an object (${String(raw)}) — every gate would fall back ` +
      `to the compiled defaults and compare against numbers nobody reviewed`,
    );
    return tol;
  }
  for (const key of Object.keys(DEFAULT_CORRELATION_BENCH_TOLERANCES)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      reasons.push(
        `baseline "tolerances" is missing gate "${key}" — the baseline predates a gate that ` +
        `now exists; re-seed it rather than silently applying the compiled default`,
      );
    }
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // An own-property test, not `key in tol`: `in` walks the prototype chain,
    // so "constructor" / "toString" / "__proto__" would pass as known gates —
    // and `__proto__` assignment would reach the setter rather than the object.
    // (`Object.hasOwn` is ES2022; this tsconfig's lib predates it.)
    if (!Object.prototype.hasOwnProperty.call(tol, key)) {
      reasons.push(`tolerance "${key}" is not a known gate — the baseline is stale or corrupt`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      reasons.push(
        `tolerance "${key}" is not a finite non-negative number (${String(value)}) — ` +
        `it would make its comparison NaN, which passes every directional check`,
      );
      continue;
    }
    const ceiling = TOLERANCE_CEILINGS[key as keyof CorrelationBenchTolerances];
    if (value > ceiling) {
      reasons.push(
        `tolerance "${key}" is ${value}, above its ${ceiling} ceiling — a tolerance wide enough ` +
        `to absorb the whole measurement disarms its gate while still looking armed`,
      );
      continue;
    }
    tol[key as keyof CorrelationBenchTolerances] = value;
  }
  return tol;
}

/**
 * An explicit `null` separation is legitimate live — see the separation gate —
 * and is excused from the finite check. A MISSING field must NOT be excused,
 * which is exactly why this is an `=== null` branch and not `?? 0`.
 */
function separationOperand(value: number | null | undefined): unknown {
  if (value === null) return 0;
  return value;
}

/** The range a gated metric is DEFINED over — see `checkOperand`. */
type GateRange = 'rate' | 'count' | 'separation';

/**
 * `bench-correlation` clamps every edge z-score into `[0, 50]` before averaging,
 * and `significantEdges` only admits edges at z ≥ 2, so the difference of two
 * such means cannot leave `[-48, 48]`. Anything outside that is not a large
 * separation, it is a fabricated one — and separation is a higher-is-better
 * gate, so `1e300` reads as the largest improvement the gate can express.
 */
const SEPARATION_BOUND = 48;
type GatedMetric = [label: string, kind: GateRange, want: unknown, got: unknown];

const BASELINE_HINT =
  'the committed baseline is missing a field or corrupt; re-seed it rather than trusting this run';
const LIVE_HINT =
  'the benchmark did not measure this metric, which fails closed rather than scoring as ' +
  'no-regression';

function checkOperand(
  reasons: string[],
  label: string,
  kind: GateRange,
  value: unknown,
  hint: string,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reasons.push(`${label} value is not a finite number (${String(value)}) — ${hint}`);
    return;
  }
  if (kind === 'rate' && (value < 0 || value > 1)) {
    reasons.push(
      `${label} value ${value} is outside [0,1] — a rate cannot exceed 1, and an impossible ` +
      `value reads as an improvement against every directional check`,
    );
  }
  if (kind === 'count' && (value < 0 || !Number.isInteger(value))) {
    reasons.push(`${label} value ${value} is not a non-negative integer count`);
  }
  // Negative is legitimate here — it means false edges outscore causal ones,
  // which is a real regression the drop gate should report, not an invalid
  // measurement. Only the magnitude is bounded.
  if (kind === 'separation' && Math.abs(value) > SEPARATION_BOUND) {
    reasons.push(
      `${label} value ${value} is outside [−${SEPARATION_BOUND},${SEPARATION_BOUND}] — z-scores ` +
      `are clamped to [2,50], so no real pass can separate by more than that`,
    );
  }
}

/**
 * Every gate below is baseline-relative, so a baseline that seeds a gate at
 * zero (or at a perfect rate with nothing behind it) disarms that gate for
 * good. These fields must be positive for their gate to have any teeth.
 */
const MUST_ARM_ITS_GATE: readonly (keyof CorrelationBenchBaseline)[] = [
  'streamCount',
  'observationCount',
  'plantedCausalCount',
  'significantEdgeCount',
  'learnedRuleCount',
  'causalLearnedRuleCount',
  'causalLearnedRulePairCount',
  'minCausalLearnedRulePairCount',
  'learnedRulePairCount',
  'truePairUniverse',
  // Higher-is-better, so a zero seed silences it permanently: re-seeding both
  // sides at 0 while 17 false edges remain would retire the 8.49 → 0 collapse
  // from the gate entirely.
  'edgeEvidenceSeparation',
  'enginePairCount',
  'distinctEnginePairCount',
  'couplingPrecision',
  'couplingRecall',
  'pairPrecision',
  'pairRecall',
  'meanTruePairConfidence',
];

function checkBaselineArmsItsGates(
  reasons: string[],
  baseline: CorrelationBenchBaseline,
): void {
  for (const field of MUST_ARM_ITS_GATE) {
    const value: unknown = baseline[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      const shown = typeof value === 'number' ? String(value) : JSON.stringify(value);
      reasons.push(
        `baseline "${String(field)}" is ${shown} — a non-positive baseline permanently ` +
        `disarms the gate it feeds; re-seed from a run that actually measured it`,
      );
    }
  }
}

export function compareCorrelationBenchToBaseline(
  report: CorrelationBenchReport,
  baseline: CorrelationBenchBaseline,
): CorrelationBenchComparison {
  const reasons: string[] = [];
  const tol = resolveTolerances(reasons, baseline.tolerances);
  if (reasons.length > 0) return { ok: false, reasons };

  // ── Corpus identity: any drift invalidates every comparison below ──────
  const identity: [string, unknown, unknown][] = [
    ['golden-stream count', baseline.streamCount, report.streamCount],
    ['observation count', baseline.observationCount, report.observationCount],
    ['planted causal coupling count', baseline.plantedCausalCount, report.plantedCausalCount],
    ['planted true-pair universe', baseline.truePairUniverse, report.truePairUniverse],
    ['corpus content digest', baseline.corpusDigest, report.corpusDigest],
  ];
  for (const [label, want, got] of identity) {
    if (want !== got) {
      reasons.push(
        `${label} changed: baseline=${String(want)} live=${String(got)} ` +
        `(golden-streams.ts was edited — re-seed bench-correlation-baseline.json ` +
        `deliberately, in a reviewed diff)`,
      );
    }
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // ── Fail closed on anything non-numeric BEFORE any directional check ───
  // A missing JSON field or a corrupt report yields NaN, and `NaN > tolerance`
  // is false — every gate below would silently pass on a benchmark that
  // measured nothing.
  //
  // Finiteness alone is not enough: `pairPrecision: 2` is finite, and every
  // directional check reads it as an improvement over 1.0. Each gated metric
  // therefore declares the range it is DEFINED over — a rate outside [0,1] or a
  // negative count is an impossible measurement, not a good one.
  const gated: GatedMetric[] = [
    ['miner coupling precision', 'rate',
      baseline.couplingPrecision, report.couplingPrecision],
    ['miner coupling recall', 'rate',
      baseline.couplingRecall, report.couplingRecall],
    ['built-in pair precision', 'rate',
      baseline.pairPrecision, report.pairPrecision],
    ['built-in pair recall', 'rate',
      baseline.pairRecall, report.pairRecall],
    ['mean true-pair confidence', 'rate',
      baseline.meanTruePairConfidence, report.meanTruePairConfidence],
    ['graded false edges', 'count',
      baseline.falseEdgeCount, report.falseEdgeCount],
    ['causal learned rules', 'count',
      baseline.causalLearnedRuleCount, report.causalLearnedRuleCount],
    ['learned-rule false positives', 'count',
      baseline.learnedRuleFalsePositives, report.learnedRuleFalsePositives],
    ['learned-rule pair volume', 'count',
      baseline.learnedRulePairCount, report.learnedRulePairCount],
    ['causal learned-rule pair volume', 'count',
      baseline.causalLearnedRulePairCount, report.causalLearnedRulePairCount],
    ['raw built-in pair emissions', 'count',
      baseline.enginePairCount, report.enginePairCount],
    ['distinct built-in pair emissions', 'count',
      baseline.distinctEnginePairCount, report.distinctEnginePairCount],
    ['near-miss decoy pairs', 'count',
      baseline.decoyPairsEmitted, report.decoyPairsEmitted],
    ['smallest per-rule causal learned pair volume', 'count',
      baseline.minCausalLearnedRulePairCount, report.minCausalLearnedRulePairCount],
    // The five false-positive components. They are summed against
    // `falseEdgeCount` below, and a sum reconciles just as happily against
    // `-1 + 17` as against `0 + 16` — so each component is range-checked too.
    ['confounded false positives', 'count',
      baseline.confoundedFalsePositives, report.confoundedFalsePositives],
    ['mediated false positives', 'count',
      baseline.mediatedFalsePositives, report.mediatedFalsePositives],
    ['independent false positives', 'count',
      baseline.independentFalsePositives, report.independentFalsePositives],
    ['inhibitory edges reported', 'count',
      baseline.inhibitoryEdgesReported, report.inhibitoryEdgesReported],
    ['unplanted false positives', 'count',
      baseline.unplantedFalsePositives, report.unplantedFalsePositives],
    ['significant edges', 'count',
      baseline.significantEdgeCount, report.significantEdgeCount],
    ['learned rules', 'count', baseline.learnedRuleCount, report.learnedRuleCount],
    ['causal-vs-false edge evidence separation', 'separation',
      baseline.edgeEvidenceSeparation, separationOperand(report.edgeEvidenceSeparation)],
  ];
  for (const [label, kind, want, got] of gated) {
    checkOperand(reasons, `${label}: baseline`, kind, want, BASELINE_HINT);
    checkOperand(reasons, `${label}: live`, kind, got, LIVE_HINT);
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // A gate armed off a zero baseline is a gate that cannot fire. Re-seeding is
  // a reviewed diff, but "reviewed" is a human reading numbers — make the
  // dead-gate seeds impossible to commit rather than merely unlikely.
  checkBaselineArmsItsGates(reasons, baseline);
  if (reasons.length > 0) return { ok: false, reasons };

  // ── Internal consistency: the report must agree with itself ────────────
  // Several gates below trust a single summary field to stand for a set of
  // detail fields. A report that disagrees with itself is not a passing run
  // with one odd number in it — it is a report that cannot be graded at all.
  checkReportConsistency(reasons, report);
  if (reasons.length > 0) return { ok: false, reasons };

  // ── Miner quality ──────────────────────────────────────────────────────
  checkDrop(reasons, 'miner coupling precision',
    baseline.couplingPrecision, report.couplingPrecision, tol.couplingPrecisionDrop);
  checkDrop(reasons, 'miner coupling recall',
    baseline.couplingRecall, report.couplingRecall, tol.couplingRecallDrop);

  // The precision RATIO alone is too coarse: on a deterministic corpus two
  // extra false edges move 0.2273 → 0.2083, inside the 0.02 tolerance. Count
  // them discretely too.
  checkGrowth(reasons, 'graded false edges',
    baseline.falseEdgeCount, report.falseEdgeCount, tol.falseEdgeGrowth);

  checkSeparation(reasons, report, baseline, tol.edgeEvidenceSeparationDrop);

  // ── Engine quality (built-in rules only) ───────────────────────────────
  checkDrop(reasons, 'built-in pair precision',
    baseline.pairPrecision, report.pairPrecision, tol.pairPrecisionDrop);
  checkDrop(reasons, 'built-in pair recall',
    baseline.pairRecall, report.pairRecall, tol.pairRecallDrop);
  // Membership gates alone would pass a kernel that scored every pair 0: the
  // right pairs would still be emitted, just worthlessly ranked.
  checkDrop(reasons, 'mean true-pair confidence',
    baseline.meanTruePairConfidence, report.meanTruePairConfidence,
    tol.meanTruePairConfidenceDrop);

  // ── Zero-tolerance gate ────────────────────────────────────────────────
  // The near-miss decoys each fail exactly one rule clause. A pair here means
  // a rule got looser, which is how a correlation engine starts hallucinating.
  if (report.decoyPairsEmitted > baseline.decoyPairsEmitted) {
    reasons.push(
      `near-miss decoy pairs emitted: baseline=${baseline.decoyPairsEmitted} ` +
      `live=${report.decoyPairsEmitted} (a built-in rule clause loosened — zero tolerance)`,
    );
  }

  // ── Learned rules: usefulness first, then blast radius ─────────────────
  // Order matters for the reader: without the shrink gate, deleting the mining
  // pipeline outright satisfies both growth gates perfectly.
  checkDrop(reasons, 'causal learned rules',
    baseline.causalLearnedRuleCount, report.causalLearnedRuleCount, tol.causalLearnedRuleShrink);
  checkGrowth(reasons, 'learned-rule false positives',
    baseline.learnedRuleFalsePositives, report.learnedRuleFalsePositives,
    tol.learnedRuleFalsePositiveGrowth);
  checkGrowth(reasons, 'learned-rule pair volume',
    baseline.learnedRulePairCount, report.learnedRulePairCount, tol.learnedRulePairGrowth);
  // Liveness, not volume: driving TOTAL learned-rule pairs down is a goal, so
  // no absolute shrink tolerance applies to them — but the causal subset going
  // dark means the synthesize → install → match path broke, and every
  // count-based gate above would still read green. Gated proportionally rather
  // than at exactly zero, because 19 → 1 is the same failure with one survivor.
  const floor = baseline.causalLearnedRulePairCount * (1 - tol.causalLearnedRulePairShrinkRatio);
  if (report.causalLearnedRulePairCount < floor) {
    reasons.push(
      `causal learned rules went quiet: baseline emitted ` +
      `${baseline.causalLearnedRulePairCount} pairs, live emitted ` +
      `${report.causalLearnedRulePairCount} (floor ${floor.toFixed(2)} at a ` +
      `${tol.causalLearnedRulePairShrinkRatio} shrink ratio) while still synthesizing ` +
      `${report.causalLearnedRuleCount} causal rule(s) — the rules are built but barely fire`,
    );
  }
  // The aggregate above is a sum, and a sum hides its own zeros: at 7/6/6 one
  // rule can stop firing entirely and the total only falls 19 → 13, well inside
  // a 9.5 floor. Apply the same proportional floor to the WEAKEST rule so a
  // single dead matcher cannot hide behind two healthy ones.
  const perRuleFloor =
    baseline.minCausalLearnedRulePairCount * (1 - tol.causalLearnedRulePairShrinkRatio);
  if (report.minCausalLearnedRulePairCount < perRuleFloor) {
    reasons.push(
      `a causal learned rule went dark: the weakest rule emitted ` +
      `${report.minCausalLearnedRulePairCount} pair(s) against a baseline weakest of ` +
      `${baseline.minCausalLearnedRulePairCount} (floor ${perRuleFloor.toFixed(2)}); per-rule ` +
      `volumes were [${report.causalLearnedRulePairsPerRule.join(', ')}]`,
    );
  }

  // Built-in rules over a frozen corpus are deterministic, so their emission
  // volume shrinking at all means a rule stopped matching. Growth is left to
  // the precision and decoy gates above.
  checkDrop(reasons, 'distinct built-in pair emissions',
    baseline.distinctEnginePairCount, report.distinctEnginePairCount, tol.enginePairShrink);

  return { ok: reasons.length === 0, reasons };
}

/**
 * Cross-checks the summary fields the gates rely on against the detail fields
 * they summarize. Without this, a report can claim a perfect miner
 * (`falseEdgeCount: 0`) while its own breakdown still lists false positives,
 * and the perfect-miner exception below would honor the claim.
 */
function checkReportConsistency(reasons: string[], report: CorrelationBenchReport): void {
  const breakdown =
    report.confoundedFalsePositives +
    report.mediatedFalsePositives +
    report.independentFalsePositives +
    report.inhibitoryEdgesReported +
    report.unplantedFalsePositives;
  if (breakdown !== report.falseEdgeCount) {
    reasons.push(
      `report is internally inconsistent: falseEdgeCount=${report.falseEdgeCount} but the ` +
      `false-positive breakdown sums to ${breakdown} (confounded/mediated/independent/` +
      `inhibitory/unplanted) — the run cannot be graded`,
    );
  }
  if (report.causalLearnedRuleCount + report.learnedRuleFalsePositives !== report.learnedRuleCount) {
    reasons.push(
      `report is internally inconsistent: causalLearnedRuleCount=` +
      `${report.causalLearnedRuleCount} plus learnedRuleFalsePositives=` +
      `${report.learnedRuleFalsePositives} does not equal learnedRuleCount=` +
      `${report.learnedRuleCount}`,
    );
  }
  if (report.causalLearnedRulePairCount > report.learnedRulePairCount) {
    reasons.push(
      `report is internally inconsistent: causalLearnedRulePairCount=` +
      `${report.causalLearnedRulePairCount} exceeds learnedRulePairCount=` +
      `${report.learnedRulePairCount}, which it is a subset of`,
    );
  }
  if (report.distinctEnginePairCount > report.enginePairCount) {
    reasons.push(
      `report is internally inconsistent: distinctEnginePairCount=` +
      `${report.distinctEnginePairCount} exceeds raw enginePairCount=` +
      `${report.enginePairCount}`,
    );
  }
  checkEdgeLedger(reasons, report);
  checkPairLedger(reasons, report);
}

/**
 * The five breakdown fields summing correctly proves the summary agrees with
 * five OTHER summaries, all produced by the same pass — coordinated edits set
 * every one of them to 0 and buy the perfect-miner exemption while `edges`
 * still lists 17 false verdicts. Reconcile against the row-level detail and
 * against the precision ratio, which is derived independently.
 */
function checkEdgeLedger(reasons: string[], report: CorrelationBenchReport): void {
  if (report.edges.length !== report.significantEdgeCount) {
    reasons.push(
      `report is internally inconsistent: significantEdgeCount=${report.significantEdgeCount} ` +
      `but the edge ledger holds ${report.edges.length} row(s)`,
    );
    return; // every check below reads that ledger
  }
  const falseRows = report.edges.filter((e) => e.verdict !== 'causal').length;
  if (falseRows !== report.falseEdgeCount) {
    reasons.push(
      `report is internally inconsistent: falseEdgeCount=${report.falseEdgeCount} but the edge ` +
      `ledger holds ${falseRows} non-causal verdict(s) — the summary does not describe the run`,
    );
  }
  // Learned rules are synthesized FROM these rows, so the two rule summaries
  // must be reproducible from the ledger. Without this, `learnedRuleCount` and
  // its causal/false split are three more same-pass summaries agreeing with
  // each other.
  const ruleRows = report.edges.filter((e) => e.becameLearnedRule);
  if (ruleRows.length !== report.learnedRuleCount) {
    reasons.push(
      `report is internally inconsistent: learnedRuleCount=${report.learnedRuleCount} but ` +
      `${ruleRows.length} edge row(s) are marked becameLearnedRule`,
    );
  }
  const causalRuleRows = ruleRows.filter((e) => e.verdict === 'causal').length;
  if (causalRuleRows !== report.causalLearnedRuleCount) {
    reasons.push(
      `report is internally inconsistent: causalLearnedRuleCount=` +
      `${report.causalLearnedRuleCount} but ${causalRuleRows} causal edge row(s) became rules`,
    );
  }
  if (report.significantEdgeCount === 0) {
    // `ratio()` reports 0/0 as 0, so a pass that mined nothing cannot honestly
    // claim a rate. A cleared ledger with the rates left at 1.0 is the whole
    // PASS-on-nothing shape this function exists to reject.
    if (report.couplingPrecision > 0 || report.couplingRecall > 0) {
      reasons.push(
        `report is internally inconsistent: couplingPrecision=${report.couplingPrecision} / ` +
        `couplingRecall=${report.couplingRecall} are positive while the miner produced zero ` +
        `significant edges — the miner measurement did not happen`,
      );
    }
    return;
  }
  const derived = (report.significantEdgeCount - report.falseEdgeCount)
    / report.significantEdgeCount;
  if (Math.abs(derived - report.couplingPrecision) > RATIO_EPSILON) {
    reasons.push(
      `report is internally inconsistent: couplingPrecision=${report.couplingPrecision} but ` +
      `${report.significantEdgeCount - report.falseEdgeCount}/${report.significantEdgeCount} ` +
      `causal edges implies ${derived.toFixed(4)}`,
    );
  }
  // Recall has its own independent witness: the couplings the miner MISSED are
  // listed by name, so the rate is reproducible without trusting any count.
  if (report.plantedCausalCount > 0) {
    const recovered = report.plantedCausalCount - report.missingCouplings.length;
    const derivedRecall = recovered / report.plantedCausalCount;
    if (Math.abs(derivedRecall - report.couplingRecall) > RATIO_EPSILON) {
      reasons.push(
        `report is internally inconsistent: couplingRecall=${report.couplingRecall} but ` +
        `${recovered}/${report.plantedCausalCount} recovered couplings ` +
        `(${report.missingCouplings.length} listed as missing) implies ` +
        `${derivedRecall.toFixed(4)}`,
      );
    }
  }
}

/**
 * Pair rates are ratios over `distinctEnginePairCount`, and `0/0` is reported
 * as 0 — but a hand-edited report can keep precision and recall at 1.0 with
 * both pair counts at zero, which reads as a flawless pass over no measurement
 * at all. A positive rate requires pairs behind it.
 */
function checkPairLedger(reasons: string[], report: CorrelationBenchReport): void {
  const claimsPairs = report.pairPrecision > 0
    || report.pairRecall > 0
    || report.meanTruePairConfidence > 0;
  if (claimsPairs && report.distinctEnginePairCount === 0) {
    reasons.push(
      `report is internally inconsistent: pairPrecision=${report.pairPrecision} / ` +
      `pairRecall=${report.pairRecall} / meanTruePairConfidence=` +
      `${report.meanTruePairConfidence} are positive while the pass emitted zero distinct ` +
      `pairs — the built-in-rule measurement did not happen`,
    );
  }
  if (report.causalLearnedRulePairCount > 0 && report.causalLearnedRuleCount === 0) {
    reasons.push(
      `report is internally inconsistent: ${report.causalLearnedRulePairCount} causal ` +
      `learned-rule pair(s) were attributed to zero causal learned rules`,
    );
  }
  if (report.causalLearnedRulePairsPerRule.length === report.causalLearnedRuleCount) {
    const summed = report.causalLearnedRulePairsPerRule.reduce((a, b) => a + b, 0);
    if (summed !== report.causalLearnedRulePairCount) {
      reasons.push(
        `report is internally inconsistent: per-rule causal pair tallies sum to ${summed} but ` +
        `causalLearnedRulePairCount=${report.causalLearnedRulePairCount}`,
      );
    }
    const min = Math.min(...report.causalLearnedRulePairsPerRule);
    if (report.causalLearnedRulePairsPerRule.length > 0
      && min !== report.minCausalLearnedRulePairCount) {
      reasons.push(
        `report is internally inconsistent: minCausalLearnedRulePairCount=` +
        `${report.minCausalLearnedRulePairCount} but the smallest per-rule tally is ${min}`,
      );
    }
  } else {
    reasons.push(
      `report is internally inconsistent: ${report.causalLearnedRulePairsPerRule.length} ` +
      `per-rule causal pair tallies for ${report.causalLearnedRuleCount} causal learned rule(s)`,
    );
  }
  checkPairArithmetic(reasons, report);
}

/**
 * Precision and recall are two routes to the SAME quantity — how many planted
 * true pairs this pass emitted — over different denominators. Checking each one
 * for plausibility in isolation misses combinations that are arithmetically
 * impossible together: with 22 planted true pairs, `distinct: 23` at precision
 * 1.0 claims 23 true emissions out of a universe of 22.
 */
function checkPairArithmetic(reasons: string[], report: CorrelationBenchReport): void {
  const fromPrecision = report.pairPrecision * report.distinctEnginePairCount;
  const fromRecall = report.pairRecall * report.truePairUniverse;
  if (Math.abs(fromPrecision - fromRecall) > report.distinctEnginePairCount * RATIO_EPSILON
    + report.truePairUniverse * RATIO_EPSILON) {
    reasons.push(
      `report is internally inconsistent: pairPrecision × ${report.distinctEnginePairCount} ` +
      `distinct pairs implies ${fromPrecision.toFixed(2)} true emissions, but pairRecall × ` +
      `${report.truePairUniverse} planted true pairs implies ${fromRecall.toFixed(2)}`,
    );
  }
  if (fromPrecision > report.truePairUniverse + 0.5) {
    reasons.push(
      `report is internally inconsistent: pairPrecision=${report.pairPrecision} over ` +
      `${report.distinctEnginePairCount} distinct pairs claims ${fromPrecision.toFixed(2)} true ` +
      `emissions from a universe of only ${report.truePairUniverse} planted true pairs`,
    );
  }
}

/** `ratio()` rounds to 4dp, so a derived cross-check must allow that rounding. */
const RATIO_EPSILON = 1.1e-4;

/**
 * Evidence separation is `null` when the miner reported no false edges at all —
 * a perfect miner, which is the goal of ACC-502..504. Coercing that to 0 turns
 * the best possible outcome into the single largest regression the gate can
 * report, so it is scored as the improvement it is.
 */
function checkSeparation(
  reasons: string[],
  report: CorrelationBenchReport,
  baseline: CorrelationBenchBaseline,
  tolerance: number,
): void {
  if (report.edgeEvidenceSeparation === null) {
    if (report.falseEdgeCount === 0) return; // nothing to separate FROM — improvement
    reasons.push(
      'causal-vs-false edge evidence separation is null while false edges exist ' +
      `(${report.falseEdgeCount}) — the benchmark failed to score them`,
    );
    return;
  }
  checkDrop(reasons, 'causal-vs-false edge evidence separation',
    baseline.edgeEvidenceSeparation, report.edgeEvidenceSeparation, tolerance);
}

/** Higher is better: fail when `live` falls more than `tolerance` below baseline. */
function checkDrop(
  reasons: string[],
  label: string,
  baseline: number,
  live: number,
  tolerance: number,
): void {
  const delta = baseline - live;
  if (delta > tolerance) {
    reasons.push(
      `${label} regressed: baseline=${baseline.toFixed(4)} live=${live.toFixed(4)} ` +
      `(Δ=−${delta.toFixed(4)} exceeds ${tolerance} tolerance)`,
    );
  }
}

/** Lower is better: fail when `live` rises more than `tolerance` above baseline. */
function checkGrowth(
  reasons: string[],
  label: string,
  baseline: number,
  live: number,
  tolerance: number,
): void {
  const delta = live - baseline;
  if (delta > tolerance) {
    reasons.push(
      `${label} grew: baseline=${baseline} live=${live} ` +
      `(Δ=+${delta} exceeds ${tolerance} tolerance)`,
    );
  }
}
