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
}

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
  pairPrecision: number;
  pairRecall: number;
  decoyPairsEmitted: number;
  meanTruePairConfidence: number;
  learnedRulePairCount: number;
  causalLearnedRulePairCount: number;

  tolerances: CorrelationBenchTolerances;
}

export interface CorrelationBenchComparison {
  ok: boolean;
  reasons: string[];
}

/** Fallback used only when a baseline omits its own `tolerances` block. */
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
};

/**
 * The baseline is JSON on disk, so its tolerance block is untyped at runtime.
 * A string or null operand makes every directional comparison NaN, and every
 * `NaN > tolerance` is false — one bad edit silently disarms the whole gate.
 */
function resolveTolerances(
  reasons: string[],
  raw: Partial<CorrelationBenchTolerances> | undefined,
): CorrelationBenchTolerances {
  const tol = { ...DEFAULT_CORRELATION_BENCH_TOLERANCES };
  for (const [key, value] of Object.entries(raw ?? {})) {
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
  const gated: [string, unknown, unknown][] = [
    ['miner coupling precision', baseline.couplingPrecision, report.couplingPrecision],
    ['miner coupling recall', baseline.couplingRecall, report.couplingRecall],
    ['built-in pair precision', baseline.pairPrecision, report.pairPrecision],
    ['built-in pair recall', baseline.pairRecall, report.pairRecall],
    ['mean true-pair confidence', baseline.meanTruePairConfidence, report.meanTruePairConfidence],
    ['graded false edges', baseline.falseEdgeCount, report.falseEdgeCount],
    ['causal learned rules', baseline.causalLearnedRuleCount, report.causalLearnedRuleCount],
    [
      'learned-rule false positives',
      baseline.learnedRuleFalsePositives,
      report.learnedRuleFalsePositives,
    ],
    ['learned-rule pair volume', baseline.learnedRulePairCount, report.learnedRulePairCount],
    [
      'causal learned-rule pair volume',
      baseline.causalLearnedRulePairCount,
      report.causalLearnedRulePairCount,
    ],
    ['near-miss decoy pairs', baseline.decoyPairsEmitted, report.decoyPairsEmitted],
    [
      'causal-vs-false edge evidence separation',
      baseline.edgeEvidenceSeparation,
      separationOperand(report.edgeEvidenceSeparation),
    ],
  ];
  for (const [label, want, got] of gated) {
    if (typeof want !== 'number' || !Number.isFinite(want)) {
      reasons.push(
        `${label}: baseline value is not a finite number (${String(want)}) — the committed ` +
        `baseline is missing a field or corrupt; re-seed it rather than trusting this run`,
      );
    }
    if (typeof got !== 'number' || !Number.isFinite(got)) {
      reasons.push(
        `${label}: live value is not a finite number (${String(got)}) — the benchmark did not ` +
        `measure this metric, which fails closed rather than scoring as no-regression`,
      );
    }
  }
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
  // Liveness, not volume: driving learned-rule pairs DOWN is a goal, so no
  // shrink tolerance applies — but a run where the causal rules fire zero times
  // means the synthesize → install → match path is dead, and every count-based
  // gate above would still read green.
  if (baseline.causalLearnedRulePairCount > 0 && report.causalLearnedRulePairCount === 0) {
    reasons.push(
      'causal learned rules matched nothing: baseline emitted ' +
      `${baseline.causalLearnedRulePairCount} pairs, live emitted 0 while still synthesizing ` +
      `${report.causalLearnedRuleCount} causal rule(s) — the rules are built but never fire`,
    );
  }

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
}

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
