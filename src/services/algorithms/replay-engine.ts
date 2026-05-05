/**
 * Replay Engine — PR 7 of the Algorithm Accuracy Enhancement Plan.
 *
 * Records canonical algorithm inputs as JSON fixtures and replays them
 * against the current algorithm implementation to detect regressions.
 *
 * Sampling rule: 10% of low-severity runs, 100% of high-severity runs.
 * Per-algorithm cap: 500 fixtures with LRU eviction (oldest first).
 *
 * Regression rule: replaying the most recent 50 fixtures with > 10%
 * decision changes emits a regression warning.
 *
 * Pure deterministic. The fixture store is in-memory; persistence is
 * the caller's job (caller can write the JSON returned from
 * `exportFixtures` to disk).
 */

// Public types

export interface ReplayFixture<TInputs = unknown, TDecision = unknown> {
  /** Stable id (hash of inputs is the recommended scheme). */
  id: string;
  algorithmId: string;
  /** ms timestamp when the fixture was recorded. */
  recordedAt: number;
  inputs: TInputs;
  decision: TDecision;
  /** Severity at time of recording (used for sampling rule). */
  severity?: number;
  /** Ground truth observation if known. */
  groundTruth?: unknown;
  /** Free-text label for the situation - "tornado warning Thu 15:42". */
  label?: string;
}

export interface ReplayDiff<TDecision = unknown> {
  fixtureId: string;
  changed: boolean;
  before: TDecision;
  after: TDecision;
}

export interface ReplayReport<TDecision = unknown> {
  algorithmId: string;
  total: number;
  changedCount: number;
  changedFraction: number;
  /** True when changedFraction > regressionThreshold. */
  regression: boolean;
  /** Up to 5 examples of changed decisions. */
  examples: ReplayDiff<TDecision>[];
}

export interface SamplingPolicy {
  /** Fraction in [0,1] of low-severity runs to record. */
  lowSeverityRate: number;
  /** Severity threshold above which sampling is forced to 1.0. */
  highSeverityThreshold: number;
}

export const DEFAULT_SAMPLING_POLICY: SamplingPolicy = {
  lowSeverityRate: 0.1,
  highSeverityThreshold: 0.75,
};

export const DEFAULT_FIXTURE_CAP = 500;
export const DEFAULT_REGRESSION_WINDOW = 50;
export const DEFAULT_REGRESSION_THRESHOLD = 0.1;

// Module state

const store = new Map<string, ReplayFixture[]>();

// Sampling

export function shouldRecordFixture(
  severity: number | undefined,
  random: () => number = Math.random,
  policy: SamplingPolicy = DEFAULT_SAMPLING_POLICY,
): boolean {
  if (typeof severity === 'number' && severity >= policy.highSeverityThreshold) {
    return true;
  }
  return random() < policy.lowSeverityRate;
}

// Recording

export interface RecordFixtureInput<TInputs = unknown, TDecision = unknown> {
  algorithmId: string;
  recordedAt: number;
  inputs: TInputs;
  decision: TDecision;
  severity?: number;
  groundTruth?: unknown;
  label?: string;
  id?: string;
}

let nextFixtureId = 1;

export function recordFixture<TInputs = unknown, TDecision = unknown>(
  input: RecordFixtureInput<TInputs, TDecision>,
  cap: number = DEFAULT_FIXTURE_CAP,
): ReplayFixture<TInputs, TDecision> {
  const fixture: ReplayFixture<TInputs, TDecision> = {
    id: input.id ?? `fix-${nextFixtureId++}`,
    algorithmId: input.algorithmId,
    recordedAt: input.recordedAt,
    inputs: input.inputs,
    decision: input.decision,
    severity: input.severity,
    groundTruth: input.groundTruth,
    label: input.label,
  };
  const list = (store.get(input.algorithmId) ?? []) as ReplayFixture[];
  list.push(fixture as ReplayFixture);
  while (list.length > cap) list.shift();
  store.set(input.algorithmId, list);
  return fixture;
}

export function listFixtures<TInputs = unknown, TDecision = unknown>(
  algorithmId: string,
): ReplayFixture<TInputs, TDecision>[] {
  return ((store.get(algorithmId) ?? []) as ReplayFixture<TInputs, TDecision>[]).map(
    (f) => ({ ...f }),
  );
}

export function fixtureCount(algorithmId: string): number {
  return (store.get(algorithmId) ?? []).length;
}

export function clearFixtures(): void {
  store.clear();
  nextFixtureId = 1;
}

// Replay

export function decisionsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface RunReplayOptions {
  algorithmId: string;
  /** Pure function: takes fixture inputs, returns the algorithm's
   *  current decision. */
  rerun: (inputs: unknown) => unknown;
  /** Most-recent N fixtures to replay. Default 50. */
  windowSize?: number;
  regressionThreshold?: number;
}

export function runReplay<TDecision = unknown>(
  options: RunReplayOptions,
): ReplayReport<TDecision> {
  const fixtures = (store.get(options.algorithmId) ?? []) as ReplayFixture<
    unknown,
    TDecision
  >[];
  const windowSize = options.windowSize ?? DEFAULT_REGRESSION_WINDOW;
  const threshold = options.regressionThreshold ?? DEFAULT_REGRESSION_THRESHOLD;
  const recent = fixtures.slice(-windowSize);
  const examples: ReplayDiff<TDecision>[] = [];
  let changedCount = 0;
  for (const fixture of recent) {
    const after = options.rerun(fixture.inputs) as TDecision;
    const changed = !decisionsEqual(fixture.decision, after);
    if (changed) {
      changedCount += 1;
      if (examples.length < 5) {
        examples.push({
          fixtureId: fixture.id,
          changed: true,
          before: fixture.decision,
          after,
        });
      }
    }
  }
  const total = recent.length;
  const changedFraction = total === 0 ? 0 : changedCount / total;
  return {
    algorithmId: options.algorithmId,
    total,
    changedCount,
    changedFraction,
    regression: changedFraction > threshold,
    examples,
  };
}

// Persistence helpers

export function exportFixtures(): Record<string, ReplayFixture[]> {
  const out: Record<string, ReplayFixture[]> = {};
  for (const [algorithmId, list] of store) {
    out[algorithmId] = list.map((f) => ({ ...f }));
  }
  return out;
}

export function importFixtures(payload: Record<string, ReplayFixture[]>): void {
  store.clear();
  for (const [algorithmId, list] of Object.entries(payload)) {
    if (!Array.isArray(list)) continue;
    store.set(algorithmId, list.map((f) => ({ ...f })));
  }
}
