/**
 * Algorithm Evaluation Ledger — per
 * docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md PR 2.
 *
 * Logs every algorithm decision (truth-score, evidence-graph,
 * situation-clustering, baseline-deviation, compound-risk,
 * forecast-calibration, watchlist-relevance, …) and its outcome when
 * known. The closed-loop self-improvement layer (PR 4) reads this
 * ledger to grade calibration, detect drift, and produce regression
 * fixtures for the replay engine.
 *
 * Pure deterministic in-memory store with serialize / loadJson for
 * persistence. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants:
 *   - Every record is JSON-serializable for the export bundle and
 *     the closed-loop ops surface
 *   - Outcomes are append-only — once a hit / miss / partial is
 *     recorded, the ledger refuses to overwrite it (a calibration
 *     ground-truth shouldn't be retconned)
 *   - The ledger never stores raw inputs; callers hash large payloads
 *     and pass the hash. This keeps the ledger small enough to ship
 *     with the diagnostics export bundle.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type AlgorithmDomain =
  | 'truth_score'
  | 'evidence_graph'
  | 'situation_clustering'
  | 'baseline_deviation'
  | 'compound_risk'
  | 'forecast_calibration'
  | 'watchlist_relevance'
  | 'negative_evidence'
  | 'shortage_score'
  | 'weather_polygon'
  | 'weather_urgency'
  | 'reasoning_hypothesis'
  | 'other';

export type EvaluationOutcome = 'hit' | 'miss' | 'partial' | 'inconclusive';

export interface EvaluationRecord {
  /** Stable id for this evaluation. */
  id: string;
  algorithmId: string;
  domain: AlgorithmDomain;
  /** Optional algorithm version label (semver / git hash / explicit
   *  release tag). The closed-loop layer uses this to compare versions. */
  version?: string;
  /** ms timestamp when the algorithm ran. */
  at: number;
  /** Latency of the algorithm call in ms. */
  durationMs: number;
  /** Cheap hash / fingerprint of the inputs the caller fed in. The
   *  ledger never stores raw inputs. */
  inputHash?: string;
  /** Score the algorithm produced (0..1 by convention; not enforced). */
  score?: number;
  /** Discrete label the algorithm produced (e.g. "stale", "matched",
   *  "bullish"). */
  label?: string;
  /** Free-text notes about the decision — surfaced in the inspector. */
  notes?: string;
  /** Optional structured detail for replay fixtures. */
  detail?: Record<string, unknown>;
  /** Ground truth — populated later, once the outcome is observable. */
  outcome?: EvaluationOutcome;
  /** ms timestamp of the outcome record. */
  outcomeAt?: number;
  /** Free-text outcome reason ("warning fired 22 min before tornado",
   *  "alert never escalated"). */
  outcomeReason?: string;
}

export interface AlgorithmEvaluationLedger {
  /** Record an algorithm decision. Returns the recorded record with
   *  id assigned (when not provided). */
  recordEvaluation: (input: Omit<EvaluationRecord, 'id' | 'outcome' | 'outcomeAt' | 'outcomeReason'> & { id?: string }) => EvaluationRecord;
  /** Append the ground-truth outcome to a recorded evaluation. Throws
   *  when the id is unknown. Throws when an outcome is already present. */
  recordOutcome: (id: string, outcome: EvaluationOutcome, reason: string, at?: number) => EvaluationRecord;
  get: (id: string) => EvaluationRecord | undefined;
  /** All records, oldest first by `at`. */
  all: () => EvaluationRecord[];
  byAlgorithm: (algorithmId: string) => EvaluationRecord[];
  byDomain: (domain: AlgorithmDomain) => EvaluationRecord[];
  /** Records for which an outcome has been observed. */
  graded: () => EvaluationRecord[];
  /** Records still waiting for ground truth. */
  pending: () => EvaluationRecord[];
  /** Trim the ledger down to `maxRecords` entries (oldest first dropped).
   *  Returns the number of dropped records. */
  trim: (maxRecords: number) => number;
  /** Bulk-load (replaces current state). */
  loadJson: (records: readonly EvaluationRecord[]) => void;
  toJson: () => EvaluationRecord[];
  /** Reset to empty. */
  clear: () => void;
}

export interface AlgorithmEvaluationLedgerOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export function createAlgorithmEvaluationLedger(
  options: AlgorithmEvaluationLedgerOptions = {},
): AlgorithmEvaluationLedger {
  const now = options.now ?? (() => Date.now());
  const records = new Map<string, EvaluationRecord>();
  let nextId = 1;

  function freshId(): string {
    return `eval-${nextId++}`;
  }

  function bumpIdFromRecord(record: EvaluationRecord): void {
    if (!record.id.startsWith('eval-')) return;
    const tail = record.id.slice('eval-'.length);
    if (!/^\d+$/.test(tail)) return;
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
  }

  function recordEvaluation(
    input: Omit<EvaluationRecord, 'id' | 'outcome' | 'outcomeAt' | 'outcomeReason'> & {
      id?: string;
    },
  ): EvaluationRecord {
    const id = input.id ?? freshId();
    if (records.has(id)) {
      throw new Error(`Evaluation "${id}" already exists`);
    }
    // Score-sanity gate: a non-finite score (NaN / ±Infinity) permanently
    // poisons every mean-based hit-rate and weighted-accuracy aggregate that
    // reads this ledger — one bad record makes the whole algorithm's stats NaN
    // forever, with no visible cause. Reject it at the boundary. Range (0..1) is
    // left unenforced by design: some algorithms log on other scales.
    if (input.score !== undefined && !Number.isFinite(input.score)) {
      throw new Error(`Evaluation score must be finite, got ${String(input.score)} (algorithm "${input.algorithmId}")`);
    }
    const record: EvaluationRecord = {
      id,
      algorithmId: input.algorithmId,
      domain: input.domain,
      version: input.version,
      at: input.at,
      durationMs: input.durationMs,
      inputHash: input.inputHash,
      score: input.score,
      label: input.label,
      notes: input.notes,
      detail: input.detail ? { ...input.detail } : undefined,
    };
    records.set(id, record);
    return cloneRecord(record);
  }

  function recordOutcome(
    id: string,
    outcome: EvaluationOutcome,
    reason: string,
    at?: number,
  ): EvaluationRecord {
    const existing = records.get(id);
    if (!existing) throw new Error(`Evaluation "${id}" not found`);
    if (existing.outcome) {
      throw new Error(`Evaluation "${id}" already graded as ${existing.outcome}`);
    }
    const updated: EvaluationRecord = {
      ...existing,
      outcome,
      outcomeAt: at ?? now(),
      outcomeReason: reason,
    };
    records.set(id, updated);
    return cloneRecord(updated);
  }

  function get(id: string): EvaluationRecord | undefined {
    const r = records.get(id);
    return r ? cloneRecord(r) : undefined;
  }

  function all(): EvaluationRecord[] {
    return [...records.values()].sort((a, b) => a.at - b.at).map((r) => cloneRecord(r));
  }

  function byAlgorithm(algorithmId: string): EvaluationRecord[] {
    return all().filter((r) => r.algorithmId === algorithmId);
  }

  function byDomain(domain: AlgorithmDomain): EvaluationRecord[] {
    return all().filter((r) => r.domain === domain);
  }

  function graded(): EvaluationRecord[] {
    return all().filter((r) => r.outcome !== undefined);
  }

  function pending(): EvaluationRecord[] {
    return all().filter((r) => r.outcome === undefined);
  }

  function trim(maxRecords: number): number {
    if (records.size <= maxRecords) return 0;
    const sorted = [...records.values()].sort((a, b) => a.at - b.at);
    const removeCount = sorted.length - maxRecords;
    for (let i = 0; i < removeCount; i += 1) {
      records.delete(sorted[i]!.id);
    }
    return removeCount;
  }

  function loadJson(input: readonly EvaluationRecord[]): void {
    records.clear();
    nextId = 1;
    for (const r of input) {
      records.set(r.id, cloneRecord(r));
      bumpIdFromRecord(r);
    }
  }

  function toJson(): EvaluationRecord[] {
    return all();
  }

  function clear(): void {
    records.clear();
    nextId = 1;
  }

  return {
    recordEvaluation,
    recordOutcome,
    get,
    all,
    byAlgorithm,
    byDomain,
    graded,
    pending,
    trim,
    loadJson,
    toJson,
    clear,
  };
}

// ── Calibration roll-up helper ─────────────────────────────────────────

export interface CalibrationSummary {
  algorithmId: string;
  domain: AlgorithmDomain;
  /** Total graded evaluations included in this roll-up. */
  graded: number;
  hits: number;
  misses: number;
  partials: number;
  inconclusive: number;
  /** hits / graded. NaN when graded=0. */
  hitRate: number;
  /** (hits + 0.5 * partials) / graded. NaN when graded=0. */
  weightedHitRate: number;
  /** Mean latency over graded evaluations. NaN when graded=0. */
  meanDurationMs: number;
}

/** Per-algorithm roll-up of graded outcomes. The closed-loop self-
 *  improvement layer reads this to detect drift and decide whether an
 *  algorithm needs adjustment. */
export function summarizeCalibration(
  records: readonly EvaluationRecord[],
): CalibrationSummary[] {
  const buckets = new Map<string, EvaluationRecord[]>();
  for (const r of records) {
    if (r.outcome === undefined) continue;
    const key = `${r.domain}|${r.algorithmId}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const out: CalibrationSummary[] = [];
  for (const [key, list] of buckets) {
    const [domain, algorithmId] = key.split('|') as [AlgorithmDomain, string];
    const graded = list.length;
    let hits = 0;
    let misses = 0;
    let partials = 0;
    let inconclusive = 0;
    let totalDuration = 0;
    for (const r of list) {
      switch (r.outcome) {
        case 'hit': {
          hits += 1;
          break;
        }
        case 'miss': {
          misses += 1;
          break;
        }
        case 'partial': {
          partials += 1;
          break;
        }
        case 'inconclusive': {
          inconclusive += 1;
          break;
        }
      }
      totalDuration += r.durationMs;
    }
    out.push({
      algorithmId,
      domain,
      graded,
      hits,
      misses,
      partials,
      inconclusive,
      hitRate: graded === 0 ? Number.NaN : hits / graded,
      weightedHitRate: graded === 0 ? Number.NaN : (hits + 0.5 * partials) / graded,
      meanDurationMs: graded === 0 ? Number.NaN : totalDuration / graded,
    });
  }
  out.sort((a, b) => a.algorithmId.localeCompare(b.algorithmId));
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function cloneRecord(r: EvaluationRecord): EvaluationRecord {
  return {
    ...r,
    detail: r.detail ? { ...r.detail } : undefined,
  };
}
