/**
 * Model Governance Layer — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 6.
 *
 * Pure deterministic store of algorithm-version promotion records.
 * Every time an algorithm version flips from shadow-mode → production
 * (or rolls back), this layer captures the evidence that justified
 * the move so future audits can answer: "why is this model trusted?"
 *
 * Governance records carry:
 *   - algorithm id + version
 *   - status (shadow / production / rolled_back / deprecated)
 *   - promotedAt + promotedBy
 *   - evidence summary (sample size, hit rate, safety regressions)
 *   - replay/shadow-mode result references
 *   - explicit rollbackVersion (the version we'd revert to)
 *   - known limitations + safety notes (markdown-friendly)
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable.
 *   - Append-only history per algorithm — promotions and rollbacks
 *     are events, never overwrites.
 *   - Safety-critical promotions REQUIRE policy approval (the caller
 *     plumbs the Policy Engine verdict in; the store refuses
 *     promotions without an `allow_auto` or `require_pr_review`
 *     verdict that has been actioned).
 *   - Every production version has an explicit rollback target —
 *     promote() refuses to record without one.
 *
 * The store NEVER tunes algorithms. It only records justification.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type GovernanceStatus = 'shadow' | 'production' | 'rolled_back' | 'deprecated';

/** A pre-evaluated PolicyEngine verdict the caller actioned. We
 *  redeclare the shape locally so this module stays
 *  governance-only and doesn't pull in the engine. */
export interface PolicyApprovalRef {
  verdict: 'allow_auto' | 'require_pr_review' | 'require_user_approval';
  /** Stable id of the rule that fired. */
  ruleId: string;
  /** ms timestamp the verdict was made. */
  at: number;
  /** Required only for require_pr_review — PR url + reviewers. */
  prRef?: { url: string; reviewers: readonly string[] };
}

export interface EvidenceSummary {
  /** Number of graded outcomes considered. */
  sampleCount: number;
  /** Weighted hit rate at promotion time. */
  hitRate: number;
  /** Replay-fixture pass rate at promotion time. */
  replayPassRate: number;
  /** Whether shadow-mode produced no safety regressions. */
  shadowSafetyClean: boolean;
  /** Free-text additional notes. */
  notes?: string;
}

export interface GovernanceRecord {
  /** Stable record id (auto-generated when not provided). */
  id: string;
  algorithmId: string;
  version: string;
  status: GovernanceStatus;
  /** ms timestamp the record was created. */
  recordedAt: number;
  /** Free-form actor — typically a Claude/Codex session id, but
   *  human reviewers can also be recorded. */
  promotedBy: string;
  evidence: EvidenceSummary;
  /** PolicyEngine approval that gated the promotion. */
  policyApproval: PolicyApprovalRef;
  /** Required for production status — the explicit version to
   *  revert to if this version regresses. */
  rollbackVersion?: string;
  /** Known limitations the reviewer wants future audits to see. */
  knownLimitations?: readonly string[];
  /** Safety notes (e.g. "do not use during quiet hours bypass"). */
  safetyNotes?: readonly string[];
}

export interface ModelGovernanceStore {
  /** Record a new promotion or status change. Append-only. */
  record: (input: Omit<GovernanceRecord, 'id' | 'recordedAt'> & { id?: string; recordedAt?: number }) => GovernanceRecord;
  /** Get a single record by id. */
  get: (id: string) => GovernanceRecord | undefined;
  /** Get all records, oldest-first. */
  all: () => GovernanceRecord[];
  /** Get the full version history for one algorithm. */
  historyFor: (algorithmId: string) => GovernanceRecord[];
  /** Resolve the currently-production version of an algorithm, if
   *  any (= the most recent record with status='production' that
   *  hasn't been superseded by a rolled_back/deprecated event for
   *  that same version). */
  currentProduction: (algorithmId: string) => GovernanceRecord | undefined;
  /** Snapshot for the diagnostics export bundle. */
  toJson: () => GovernanceRecord[];
}

// ── Configuration ───────────────────────────────────────────────────────

/** Algorithms whose promotions ALWAYS require pr_review verdicts.
 *  Mirrors the safety_auto_deny rule in policy-engine.ts. */
const SAFETY_CRITICAL_ALGORITHMS: ReadonlySet<string> = new Set([
  'nws-polygon-match',
  'weather-urgency',
  'personal-storm-mode',
]);

// ── Implementation ──────────────────────────────────────────────────────

export interface ModelGovernanceOptions {
  now?: () => number;
}

export function createModelGovernance(options: ModelGovernanceOptions = {}): ModelGovernanceStore {
  const now = options.now ?? (() => Date.now());
  const records: GovernanceRecord[] = [];
  let nextId = 1;

  return {
    record(input) {
      const id = input.id ?? `gov-${nextId++}`;
      const recordedAt = input.recordedAt ?? now();

      // Production status requires an explicit rollback target —
      // there must always be a known-good version we can revert to.
      if (input.status === 'production' && !input.rollbackVersion) {
        throw new Error(
          `production promotion of ${input.algorithmId}@${input.version} requires rollbackVersion`,
        );
      }

      // Safety-critical promotions REQUIRE pr_review approval.
      if (SAFETY_CRITICAL_ALGORITHMS.has(input.algorithmId) && input.status === 'production' && (input.policyApproval.verdict !== 'require_pr_review' || !input.policyApproval.prRef)) {
          throw new Error(
            `safety-critical promotion of ${input.algorithmId} requires require_pr_review verdict + prRef`,
          );
        }

      // Production promotions need plausible evidence: ≥30 samples,
      // hit rate ≥0.7, replay pass rate ≥0.8, shadow clean.
      if (input.status === 'production') {
        const e = input.evidence;
        if (e.sampleCount < 30 || e.hitRate < 0.7 || e.replayPassRate < 0.8 || !e.shadowSafetyClean) {
          throw new Error(
            `production promotion of ${input.algorithmId} fails evidence floor: samples=${e.sampleCount} hit=${e.hitRate} replay=${e.replayPassRate} shadowClean=${e.shadowSafetyClean}`,
          );
        }
      }

      const record: GovernanceRecord = {
        id,
        recordedAt,
        algorithmId: input.algorithmId,
        version: input.version,
        status: input.status,
        promotedBy: input.promotedBy,
        evidence: input.evidence,
        policyApproval: input.policyApproval,
        rollbackVersion: input.rollbackVersion,
        knownLimitations: input.knownLimitations,
        safetyNotes: input.safetyNotes,
      };
      records.push(record);
      return record;
    },

    get(id) {
      return records.find((r) => r.id === id);
    },

    all() {
      return [...records].sort((a, b) => a.recordedAt - b.recordedAt);
    },

    historyFor(algorithmId) {
      return records
        .filter((r) => r.algorithmId === algorithmId)
        .sort((a, b) => a.recordedAt - b.recordedAt);
    },

    currentProduction(algorithmId) {
      const history = records
        .filter((r) => r.algorithmId === algorithmId)
        .sort((a, b) => b.recordedAt - a.recordedAt);
      // Walk newest → oldest. The first 'production' entry whose
      // version hasn't been rolled back / deprecated wins.
      const supersededVersions = new Set<string>();
      for (const r of history) {
        if (r.status === 'rolled_back' || r.status === 'deprecated') {
          supersededVersions.add(r.version);
        } else if (r.status === 'production' && !supersededVersions.has(r.version)) {
          return r;
        }
      }
      return undefined;
    },

    toJson() {
      return [...records].sort((a, b) => a.recordedAt - b.recordedAt);
    },
  };
}
