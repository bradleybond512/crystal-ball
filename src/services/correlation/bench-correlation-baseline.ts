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

import type {
  BenchEdgeRow, BenchPairRow, CorrelationBenchReport,
} from './bench-correlation';

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

/**
 * The baseline shape this module knows how to compare. A baseline from an older
 * schema is missing fields that now feed gates, and every missing field reads as
 * `undefined` — which the operand checks catch one at a time, with a pile of
 * confusing reasons, only for the fields that happen to be gated. Pin the
 * version and say so once, plainly.
 */
export const CORRELATION_BENCH_SCHEMA_VERSION = 5;

/**
 * `goldenCorpusDigest()` emits exactly 32 lowercase hex characters. Comparing
 * the two digests with a bare `!==` treats "both sides absent" as agreement:
 * delete the field from the baseline JSON and from the report and
 * `undefined === undefined` passes corpus identity, which is the one check that
 * makes every number below comparable at all. Both operands must LOOK like a
 * digest before their equality means anything.
 */
const DIGEST_PATTERN = /^[\da-f]{32}$/;

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
 *
 * Positive is necessary but NOT sufficient wherever the gate is a TOLERANCE on
 * the distance from the baseline. `meanTruePairConfidence: 0.05` under a 0.05
 * drop tolerance is positive, passes every check, and accepts a live value of
 * exactly 0 — a metric that measured nothing, scored as no-regression. Each
 * such field therefore names the tolerance it is spent against, and must exceed
 * it, so the gate still has somewhere to fall.
 */
const MUST_ARM_ITS_GATE: readonly [
  field: keyof CorrelationBenchBaseline,
  spentAgainst: keyof CorrelationBenchTolerances | null,
][] = [
  ['streamCount', null],
  ['observationCount', null],
  ['plantedCausalCount', null],
  ['significantEdgeCount', null],
  ['learnedRuleCount', null],
  ['causalLearnedRuleCount', 'causalLearnedRuleShrink'],
  ['causalLearnedRulePairCount', null],
  ['minCausalLearnedRulePairCount', null],
  ['learnedRulePairCount', null],
  ['truePairUniverse', null],
  // Higher-is-better, so a zero seed silences it permanently: re-seeding both
  // sides at 0 while 17 false edges remain would retire the 8.49 → 0 collapse
  // from the gate entirely.
  ['edgeEvidenceSeparation', 'edgeEvidenceSeparationDrop'],
  ['enginePairCount', null],
  ['distinctEnginePairCount', 'enginePairShrink'],
  ['couplingPrecision', 'couplingPrecisionDrop'],
  ['couplingRecall', 'couplingRecallDrop'],
  ['pairPrecision', 'pairPrecisionDrop'],
  ['pairRecall', 'pairRecallDrop'],
  ['meanTruePairConfidence', 'meanTruePairConfidenceDrop'],
];

function checkBaselineArmsItsGates(
  reasons: string[],
  baseline: CorrelationBenchBaseline,
  tol: CorrelationBenchTolerances,
): void {
  for (const [field, spentAgainst] of MUST_ARM_ITS_GATE) {
    const value: unknown = baseline[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      const shown = typeof value === 'number' ? String(value) : JSON.stringify(value);
      reasons.push(
        `baseline "${String(field)}" is ${shown} — a non-positive baseline permanently ` +
        `disarms the gate it feeds; re-seed from a run that actually measured it`,
      );
      continue;
    }
    if (spentAgainst === null) continue;
    const allowance = tol[spentAgainst];
    if (value <= allowance) {
      reasons.push(
        `baseline "${String(field)}" is ${value}, at or below its own "${spentAgainst}" ` +
        `tolerance of ${allowance} — the gate would accept a live value of 0, scoring a ` +
        `metric that measured nothing as no-regression`,
      );
    }
  }
}

/**
 * Corpus identity is checked for FORMAT before it is checked for equality: two
 * absent digests are `undefined === undefined`, which is the identity gate
 * passing on the absence of identity — the one comparison that must never be
 * satisfiable by deleting a field from both operands.
 */
function checkDigestFormat(
  reasons: string[],
  report: CorrelationBenchReport,
  baseline: CorrelationBenchBaseline,
): void {
  for (const [side, digest] of [
    ['baseline', baseline.corpusDigest], ['live', report.corpusDigest],
  ] as const) {
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      reasons.push(
        `${side} corpusDigest is not a 32-character hex digest (${JSON.stringify(digest)}) — ` +
        `corpus identity cannot be established, so no number below is comparable`,
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

  // ── Schema: an older baseline is missing fields that now feed gates ────
  if (baseline.schemaVersion !== CORRELATION_BENCH_SCHEMA_VERSION) {
    reasons.push(
      `baseline schemaVersion is ${String(baseline.schemaVersion)}, expected ` +
      `${CORRELATION_BENCH_SCHEMA_VERSION} — it predates fields this gate reads; re-seed it`,
    );
    return { ok: false, reasons };
  }

  checkDigestFormat(reasons, report, baseline);
  if (reasons.length > 0) return { ok: false, reasons };

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
  checkBaselineArmsItsGates(reasons, baseline, tol);
  if (reasons.length > 0) return { ok: false, reasons };

  // ── Internal consistency: BOTH sides must agree with themselves ────────
  // Several gates below trust a single summary field to stand for a set of
  // detail fields. A report that disagrees with itself is not a passing run
  // with one odd number in it — it is a report that cannot be graded at all.
  //
  // The same is true of the baseline, and for a while only the live side was
  // checked: a committed baseline claiming 99 learned-rule false positives out
  // of 12 learned rules is not a strict reference to measure against, it is a
  // number with no run behind it, and every "no growth since baseline" gate
  // spends its whole budget against the fiction.
  checkSummaryArithmetic(reasons, 'baseline', baseline);
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
 * The numeric surface both a live report and a committed baseline expose. The
 * arithmetic below holds of any real correlation pass, so it is checked against
 * BOTH — a baseline that could not have come from a run is not a reference.
 */
type BenchSummary = Pick<CorrelationBenchBaseline,
  | 'plantedCausalCount' | 'truePairUniverse'
  | 'couplingPrecision' | 'couplingRecall' | 'significantEdgeCount'
  | 'confoundedFalsePositives' | 'mediatedFalsePositives' | 'independentFalsePositives'
  | 'inhibitoryEdgesReported' | 'unplantedFalsePositives' | 'falseEdgeCount'
  | 'learnedRuleCount' | 'learnedRuleFalsePositives' | 'causalLearnedRuleCount'
  | 'enginePairCount' | 'distinctEnginePairCount' | 'pairPrecision' | 'pairRecall'
  | 'decoyPairsEmitted' | 'meanTruePairConfidence'
  | 'learnedRulePairCount' | 'causalLearnedRulePairCount' | 'minCausalLearnedRulePairCount'>;

/**
 * Every rate here is a ratio of two integers the same pass also reports, so a
 * rate that cannot be one — `couplingRecall` implying 3.4 recovered couplings
 * out of 7 — describes no run that ever happened. `ratio()` rounds to 4dp, so
 * the implied count is allowed to miss an integer by the rounding slack its own
 * denominator carries.
 */
function checkImpliedCount(
  reasons: string[],
  side: string,
  label: string,
  rate: number,
  denominator: number,
): number | null {
  const implied = rate * denominator;
  const nearest = Math.round(implied);
  if (Math.abs(implied - nearest) > Math.max(denominator, 1) * RATIO_EPSILON) {
    reasons.push(
      `${side} is internally inconsistent: ${label}=${rate} over ${denominator} implies ` +
      `${implied.toFixed(4)} items, which is not a whole count — no run produces a fractional ` +
      `numerator`,
    );
    return null;
  }
  return nearest;
}

/**
 * Cross-checks the summary fields the gates rely on against each other. Without
 * this, a side can claim a perfect miner (`falseEdgeCount: 0`) while its own
 * breakdown still lists false positives, and the perfect-miner exception below
 * would honor the claim.
 */
function checkSummaryArithmetic(reasons: string[], side: string, s: BenchSummary): void {
  const breakdown =
    s.confoundedFalsePositives +
    s.mediatedFalsePositives +
    s.independentFalsePositives +
    s.inhibitoryEdgesReported +
    s.unplantedFalsePositives;
  if (breakdown !== s.falseEdgeCount) {
    reasons.push(
      `${side} is internally inconsistent: falseEdgeCount=${s.falseEdgeCount} but the ` +
      `false-positive breakdown sums to ${breakdown} (confounded/mediated/independent/` +
      `inhibitory/unplanted) — the run cannot be graded`,
    );
  }
  if (s.falseEdgeCount > s.significantEdgeCount) {
    reasons.push(
      `${side} is internally inconsistent: falseEdgeCount=${s.falseEdgeCount} exceeds ` +
      `significantEdgeCount=${s.significantEdgeCount}, which it is a subset of`,
    );
  }
  if (s.causalLearnedRuleCount + s.learnedRuleFalsePositives !== s.learnedRuleCount) {
    reasons.push(
      `${side} is internally inconsistent: causalLearnedRuleCount=` +
      `${s.causalLearnedRuleCount} plus learnedRuleFalsePositives=` +
      `${s.learnedRuleFalsePositives} does not equal learnedRuleCount=` +
      `${s.learnedRuleCount}`,
    );
  }
  if (s.causalLearnedRulePairCount > s.learnedRulePairCount) {
    reasons.push(
      `${side} is internally inconsistent: causalLearnedRulePairCount=` +
      `${s.causalLearnedRulePairCount} exceeds learnedRulePairCount=` +
      `${s.learnedRulePairCount}, which it is a subset of`,
    );
  }
  // The weakest rule cannot out-emit the whole causal set, and every one of the
  // `causalLearnedRuleCount` rules emits at least the weakest volume.
  if (s.minCausalLearnedRulePairCount * s.causalLearnedRuleCount > s.causalLearnedRulePairCount) {
    reasons.push(
      `${side} is internally inconsistent: ${s.causalLearnedRuleCount} causal rule(s) each ` +
      `emitting at least ${s.minCausalLearnedRulePairCount} pair(s) needs at least ` +
      `${s.minCausalLearnedRulePairCount * s.causalLearnedRuleCount}, but ` +
      `causalLearnedRulePairCount=${s.causalLearnedRulePairCount}`,
    );
  }
  if (s.distinctEnginePairCount > s.enginePairCount) {
    reasons.push(
      `${side} is internally inconsistent: distinctEnginePairCount=` +
      `${s.distinctEnginePairCount} exceeds raw enginePairCount=${s.enginePairCount}`,
    );
  }
  if (s.decoyPairsEmitted > s.enginePairCount) {
    reasons.push(
      `${side} is internally inconsistent: decoyPairsEmitted=${s.decoyPairsEmitted} exceeds ` +
      `raw enginePairCount=${s.enginePairCount}`,
    );
  }
  if (s.significantEdgeCount === 0) {
    // `ratio()` reports 0/0 as 0, so a pass that mined nothing cannot honestly
    // claim a rate. A cleared ledger with the rates left at 1.0 is the whole
    // PASS-on-nothing shape this function exists to reject.
    if (s.couplingPrecision > 0 || s.couplingRecall > 0) {
      reasons.push(
        `${side} is internally inconsistent: couplingPrecision=${s.couplingPrecision} / ` +
        `couplingRecall=${s.couplingRecall} are positive while the miner produced zero ` +
        `significant edges — the miner measurement did not happen`,
      );
    }
  } else {
    const derived = (s.significantEdgeCount - s.falseEdgeCount) / s.significantEdgeCount;
    if (Math.abs(derived - s.couplingPrecision) > RATIO_EPSILON) {
      reasons.push(
        `${side} is internally inconsistent: couplingPrecision=${s.couplingPrecision} but ` +
        `${s.significantEdgeCount - s.falseEdgeCount}/${s.significantEdgeCount} ` +
        `causal edges implies ${derived.toFixed(4)}`,
      );
    }
  }
  const recovered = checkImpliedCount(
    reasons, side, 'couplingRecall', s.couplingRecall, s.plantedCausalCount,
  );
  if (recovered !== null && recovered > s.plantedCausalCount) {
    reasons.push(
      `${side} is internally inconsistent: couplingRecall=${s.couplingRecall} claims ` +
      `${recovered} recovered couplings from only ${s.plantedCausalCount} planted`,
    );
  }
  checkPairArithmetic(reasons, side, s);
}

function checkReportConsistency(reasons: string[], report: CorrelationBenchReport): void {
  checkSummaryArithmetic(reasons, 'report', report);
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
  // `significantEdges()` filters the mined set, so the mined population is an
  // upper bound on it. `minedEdgeCount: 0` alongside a populated ledger says the
  // miner never ran and the rows came from somewhere else.
  if (!Number.isInteger(report.minedEdgeCount)
    || report.minedEdgeCount < report.significantEdgeCount) {
    reasons.push(
      `report is internally inconsistent: minedEdgeCount=${String(report.minedEdgeCount)} is ` +
      `below significantEdgeCount=${report.significantEdgeCount}, but significant edges are a ` +
      `filtered subset of the mined ones`,
    );
  }
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
  checkEdgeRows(reasons, report);
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
 * `bench-correlation` clamps `+Infinity` z to this before averaging, and the
 * separation re-derivation below has to clamp identically or it would
 * "discover" a mismatch on every corpus containing a certainty edge.
 */
const Z_CAP = 50;

/**
 * Two fields of each edge row were read — `verdict` and `becameLearnedRule` —
 * and everything else in the row went unexamined, so a ledger of stub rows
 * carrying only those two fields reconciled perfectly against every summary.
 * A row has to look like something the miner could have produced, and the
 * separation the gate spends its budget on has to be RE-DERIVABLE from the
 * evidence in the rows rather than merely asserted alongside them.
 */
function checkEdgeRows(reasons: string[], report: CorrelationBenchReport): void {
  const seen = new Set<string>();
  const causalZ: number[] = [];
  const falseZ: number[] = [];
  for (const [i, e] of report.edges.entries()) {
    const where = `edge row ${i} (${String(e.from)}->${String(e.to)})`;
    if (typeof e.from !== 'string' || typeof e.to !== 'string' || e.from === '' || e.to === ''
      || e.from === e.to) {
      reasons.push(`report is internally inconsistent: ${where} has no distinct endpoints`);
      continue;
    }
    const key = `${e.from}->${e.to}@${String(e.windowHours)}`;
    if (seen.has(key)) {
      reasons.push(
        `report is internally inconsistent: ${where} repeats an earlier row at the same ` +
        `window — the miner emits one edge per directed pair, so a duplicate is padding`,
      );
    }
    seen.add(key);
    if (!checkEdgeRowThresholds(reasons, where, e)) continue;
    // A null z is +Infinity upstream — "certain", capped rather than dropped,
    // exactly as the report's own mean does it.
    (e.verdict === 'causal' ? causalZ : falseZ).push(Math.min(Z_CAP, e.zScore ?? Z_CAP));
  }
  checkSeparationDerivation(reasons, report, causalZ, falseZ);
}

/**
 * `significantEdges()` admits nothing below lift 2 / z 2 / support 3, so a row
 * under any of those thresholds cannot have come through that filter.
 *
 * Returns whether the row's z-score is usable for the separation derivation.
 */
function checkEdgeRowThresholds(
  reasons: string[],
  where: string,
  e: BenchEdgeRow,
): boolean {
  const bad = `report is internally inconsistent: ${where} has`;
  if (!Number.isInteger(e.support) || e.support < 3) {
    reasons.push(
      `${bad} support=${String(e.support)}, below the minimum 3 that significantEdges() admits`,
    );
  }
  if (!Number.isInteger(e.antecedents) || e.antecedents < e.support) {
    reasons.push(
      `${bad} ${String(e.antecedents)} antecedent(s) carrying ${String(e.support)} support — ` +
      `support counts a subset of the antecedents`,
    );
  }
  if (e.lift !== null && (!Number.isFinite(e.lift) || e.lift < 2)) {
    reasons.push(
      `${bad} lift=${String(e.lift)}, below the minimum 2 that significantEdges() admits`,
    );
  }
  if (!Number.isFinite(e.strength) || e.strength < 0 || e.strength > 1) {
    reasons.push(
      `${bad} strength=${String(e.strength)}, outside the [0,1] blend the miner produces`,
    );
  }
  if (e.zScore !== null && (!Number.isFinite(e.zScore) || e.zScore < 2)) {
    reasons.push(
      `${bad} zScore=${String(e.zScore)}, below the minimum 2 that significantEdges() admits`,
    );
    return false;
  }
  return true;
}

/** `null` separation means "no false edges at all" on both routes, or neither. */
function checkSeparationDerivation(
  reasons: string[],
  report: CorrelationBenchReport,
  causalZ: readonly number[],
  falseZ: readonly number[],
): void {
  const derived = falseZ.length === 0 || causalZ.length === 0
    ? null
    : average(causalZ) - average(falseZ);
  if (derived === null || report.edgeEvidenceSeparation === null) {
    if (derived !== report.edgeEvidenceSeparation) {
      reasons.push(
        `report is internally inconsistent: edgeEvidenceSeparation=` +
        `${String(report.edgeEvidenceSeparation)} but the edge ledger derives ` +
        `${String(derived)} (${causalZ.length} causal / ${falseZ.length} false z-score(s))`,
      );
    }
    return;
  }
  if (Math.abs(derived - report.edgeEvidenceSeparation) > SEPARATION_EPSILON) {
    reasons.push(
      `report is internally inconsistent: edgeEvidenceSeparation=` +
      `${report.edgeEvidenceSeparation} but the ledger's ${causalZ.length} causal and ` +
      `${falseZ.length} false z-score(s) derive ${derived.toFixed(4)}`,
    );
  }
}

/** The report rounds its separation to 4dp; the re-derivation must allow that. */
const SEPARATION_EPSILON = 1e-3;

function average(xs: readonly number[]): number {
  return xs.reduce((sum, v) => sum + v, 0) / xs.length;
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
  checkPairRows(reasons, report);
}

/**
 * The pair half of the run had no row-level detail at all: six summaries —
 * raw count, distinct count, precision, recall, decoy count, mean true
 * confidence — produced by one pass, reconciled only against each other. Set
 * them coherently by hand and nothing could contradict them. Every one of the
 * six is now re-derived from the emitted pairs themselves.
 */
/**
 * One row of the pair ledger, as something the grader could have emitted.
 *
 * Returns whether the row's tallies may be folded into the totals — a row that
 * fails here has already been reported, and counting it would produce a second,
 * derivative complaint about the same defect.
 */
function checkPairRowShape(
  reasons: string[],
  where: string,
  p: BenchPairRow,
  seen: Set<string>,
): boolean {
  const bad = `report is internally inconsistent: ${where}`;
  if (typeof p.key !== 'string' || p.key === '' || seen.has(p.key)) {
    reasons.push(
      `${bad} has a missing or duplicated key — the ledger is one row per DISTINCT pair, so a ` +
      `repeat inflates the precision denominator`,
    );
    return false;
  }
  seen.add(p.key);
  if (!Array.isArray(p.ruleIds) || !Array.isArray(p.confidences)
    || p.ruleIds.length !== p.confidences.length || p.ruleIds.length === 0) {
    reasons.push(
      `${bad} carries ${Array.isArray(p.ruleIds) ? p.ruleIds.length : String(p.ruleIds)} rule ` +
      `id(s) against ` +
      `${Array.isArray(p.confidences) ? p.confidences.length : String(p.confidences)} ` +
      `confidence(s) — a distinct pair exists because at least one rule emitted it`,
    );
    return false;
  }
  if (p.ruleIds.some((id) => typeof id !== 'string' || id === '')) {
    reasons.push(`${bad} has an unnamed emitting rule`);
  }
  if (p.confidences.some((c) => typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1)) {
    reasons.push(`${bad} has a confidence outside [0,1] (${p.confidences.join(', ')})`);
    return false;
  }
  if (!Number.isInteger(p.decoyEmissions)
    || p.decoyEmissions < 0 || p.decoyEmissions > p.ruleIds.length) {
    reasons.push(
      `${bad} attributes ${String(p.decoyEmissions)} decoy emission(s) to ` +
      `${p.ruleIds.length} emission(s)`,
    );
    return false;
  }
  return true;
}

function checkPairRows(reasons: string[], report: CorrelationBenchReport): void {
  const rows = report.pairs;
  if (!Array.isArray(rows) || rows.length !== report.distinctEnginePairCount) {
    reasons.push(
      `report is internally inconsistent: distinctEnginePairCount=` +
      `${report.distinctEnginePairCount} but the pair ledger holds ` +
      `${Array.isArray(rows) ? rows.length : String(rows)} row(s)`,
    );
    return; // every check below reads that ledger
  }
  const seen = new Set<string>();
  let emissions = 0;
  let decoyEmissions = 0;
  const trueConfidences: number[] = [];
  let trueRows = 0;
  for (const [i, p] of rows.entries()) {
    if (!checkPairRowShape(reasons, `pair row ${i} (${String(p.key)})`, p, seen)) continue;
    emissions += p.ruleIds.length;
    decoyEmissions += p.decoyEmissions;
    if (p.isTruePair) {
      trueRows += 1;
      trueConfidences.push(...p.confidences);
    }
  }
  checkPairLedgerTotals(reasons, report, { emissions, decoyEmissions, trueRows, trueConfidences });
}

/** The five pair summaries the ledger's tallies reproduce, or contradict. */
function checkPairLedgerTotals(
  reasons: string[],
  report: CorrelationBenchReport,
  tally: {
    emissions: number;
    decoyEmissions: number;
    trueRows: number;
    trueConfidences: readonly number[];
  },
): void {
  const { emissions, decoyEmissions, trueRows, trueConfidences } = tally;
  if (emissions !== report.enginePairCount) {
    reasons.push(
      `report is internally inconsistent: enginePairCount=${report.enginePairCount} but the ` +
      `pair ledger accounts for ${emissions} raw emission(s)`,
    );
  }
  if (decoyEmissions !== report.decoyPairsEmitted) {
    reasons.push(
      `report is internally inconsistent: decoyPairsEmitted=${report.decoyPairsEmitted} but the ` +
      `pair ledger accounts for ${decoyEmissions} decoy-touching emission(s)`,
    );
  }
  // Precision and recall share this numerator over two different denominators,
  // so the ledger pins both rates at once.
  const expectPrecision = report.distinctEnginePairCount === 0
    ? 0
    : trueRows / report.distinctEnginePairCount;
  if (Math.abs(expectPrecision - report.pairPrecision) > RATIO_EPSILON) {
    reasons.push(
      `report is internally inconsistent: pairPrecision=${report.pairPrecision} but ` +
      `${trueRows}/${report.distinctEnginePairCount} true pair row(s) implies ` +
      `${expectPrecision.toFixed(4)}`,
    );
  }
  const expectRecall = report.truePairUniverse === 0 ? 0 : trueRows / report.truePairUniverse;
  if (Math.abs(expectRecall - report.pairRecall) > RATIO_EPSILON) {
    reasons.push(
      `report is internally inconsistent: pairRecall=${report.pairRecall} but ` +
      `${trueRows}/${report.truePairUniverse} planted true pair(s) implies ` +
      `${expectRecall.toFixed(4)}`,
    );
  }
  const expectMean = trueConfidences.length === 0 ? 0 : average(trueConfidences);
  if (Math.abs(expectMean - report.meanTruePairConfidence) > RATIO_EPSILON) {
    reasons.push(
      `report is internally inconsistent: meanTruePairConfidence=` +
      `${report.meanTruePairConfidence} but the ${trueConfidences.length} true-pair emission(s) ` +
      `in the ledger average ${expectMean.toFixed(4)}`,
    );
  }
}

/**
 * Precision and recall are two routes to the SAME quantity — how many planted
 * true pairs this pass emitted — over different denominators. Checking each one
 * for plausibility in isolation misses combinations that are arithmetically
 * impossible together: with 22 planted true pairs, `distinct: 23` at precision
 * 1.0 claims 23 true emissions out of a universe of 22.
 */
function checkPairArithmetic(reasons: string[], side: string, s: BenchSummary): void {
  const fromPrecision = s.pairPrecision * s.distinctEnginePairCount;
  const fromRecall = s.pairRecall * s.truePairUniverse;
  if (Math.abs(fromPrecision - fromRecall) > s.distinctEnginePairCount * RATIO_EPSILON
    + s.truePairUniverse * RATIO_EPSILON) {
    reasons.push(
      `${side} is internally inconsistent: pairPrecision × ${s.distinctEnginePairCount} ` +
      `distinct pairs implies ${fromPrecision.toFixed(2)} true emissions, but pairRecall × ` +
      `${s.truePairUniverse} planted true pairs implies ${fromRecall.toFixed(2)}`,
    );
  }
  if (fromPrecision > s.truePairUniverse + 0.5) {
    reasons.push(
      `${side} is internally inconsistent: pairPrecision=${s.pairPrecision} over ` +
      `${s.distinctEnginePairCount} distinct pairs claims ${fromPrecision.toFixed(2)} true ` +
      `emissions from a universe of only ${s.truePairUniverse} planted true pairs`,
    );
  }
  checkImpliedCount(reasons, side, 'pairPrecision', s.pairPrecision, s.distinctEnginePairCount);
  checkImpliedCount(reasons, side, 'pairRecall', s.pairRecall, s.truePairUniverse);
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
