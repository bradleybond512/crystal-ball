/**
 * Quality Debt Tracker — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 9.
 *
 * Pure deterministic registry of "intelligence quality debt" — the
 * same idea as engineering tech debt, but for what the intelligence
 * layer is missing or doing badly. Items track severity, owner
 * area, impact, recommended fix, and (when known) the evidence that
 * created the debt entry.
 *
 * Debt categories (from the plan):
 *   - missing_sources           (no provider for a domain we claim)
 *   - ungraded_predictions      (predictions piled up without outcomes)
 *   - stale_baselines           (per-domain baseline ratings haven't refreshed)
 *   - untested_domains          (no replay fixtures or scenarios for a domain)
 *   - noisy_algorithms          (high false-positive rate)
 *   - weak_replay_coverage      (replay catalog covers < N% of mission cases)
 *   - missing_mission_bridges   (a domain has algorithms but no mission ledger feed)
 *   - unresolved_near_misses    (near-miss flagged > N days ago without action)
 *   - unknown_algorithm_health  (algorithms in 'unknown' status from sample-size starvation)
 *   - insufficient_provider_redundancy (single-source for a critical domain)
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable.
 *   - Append-only — debt is recorded with evidence; resolution is a
 *     separate event so the audit trail is preserved.
 *   - Sorted by safety/reliability impact (severity × ownerArea
 *     weight) so the highest-leverage items surface first.
 *   - Cannot mark a debt resolved without evidence.
 *   - Designed to feed the agent handoff bundle (Layer 8 of the
 *     next-level doc): the registry's snapshot is one of the
 *     bundles' inputs.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type DebtCategory =
  | 'missing_sources'
  | 'ungraded_predictions'
  | 'stale_baselines'
  | 'untested_domains'
  | 'noisy_algorithms'
  | 'weak_replay_coverage'
  | 'missing_mission_bridges'
  | 'unresolved_near_misses'
  | 'unknown_algorithm_health'
  | 'insufficient_provider_redundancy';

export type DebtSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Owning service area — these correspond to the directory layout
 *  in `src/services/`. The closed-loop layer routes debt items by
 *  area so the right service team (or agent) can pick them up. */
export type DebtOwnerArea =
  | 'algorithms'
  | 'providers'
  | 'ops'
  | 'diagnostics'
  | 'replay'
  | 'mission_ledger'
  | 'unknown';

export type DebtStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved';

export interface DebtEvidence {
  /** Stable id of the source that produced the debt observation
   *  ("algorithm-health", "provider-redundancy", "near-miss"). */
  sourceId: string;
  /** Compact JSON-serializable evidence detail. */
  detail: Record<string, unknown>;
  at: number;
}

export interface DebtItem {
  id: string;
  category: DebtCategory;
  severity: DebtSeverity;
  ownerArea: DebtOwnerArea;
  /** Free-text impact description ("Weather warnings can fail
   *  silently when NWS goes silent"). */
  impact: string;
  /** Concrete remediation. */
  recommendedFix: string;
  evidence: DebtEvidence;
  status: DebtStatus;
  /** Fields populated only when status === 'resolved'. */
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionEvidence?: DebtEvidence;
  /** ms timestamp the debt was first recorded. */
  recordedAt: number;
}

export interface QualityDebtRegistry {
  /** Record a new debt item. Throws on id collision. */
  record: (input: Omit<DebtItem, 'id' | 'status' | 'recordedAt'> & { id?: string; recordedAt?: number }) => DebtItem;
  /** Acknowledge an item — moves status open → acknowledged. */
  acknowledge: (id: string) => DebtItem;
  /** Mark in_progress (e.g. an agent picked it up). */
  startWork: (id: string) => DebtItem;
  /** Resolve with evidence. Throws when evidence is missing. */
  resolve: (id: string, resolvedBy: string, evidence: DebtEvidence) => DebtItem;
  /** Get one item by id. */
  get: (id: string) => DebtItem | undefined;
  /** Open + acknowledged + in_progress items, sorted by impact desc. */
  active: () => DebtItem[];
  /** Every item, oldest first by recordedAt. */
  all: () => DebtItem[];
  toJson: () => DebtItem[];
}

// ── Implementation ──────────────────────────────────────────────────────

export interface QualityDebtOptions {
  now?: () => number;
}

const SEVERITY_WEIGHT: Record<DebtSeverity, number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 12,
};

const OWNER_AREA_WEIGHT: Record<DebtOwnerArea, number> = {
  algorithms: 1.5,
  providers: 1.4,
  mission_ledger: 1.3,
  ops: 1.2,
  replay: 1.1,
  diagnostics: 1,
  unknown: 0.8,
};

function impactScore(item: DebtItem): number {
  return SEVERITY_WEIGHT[item.severity] * OWNER_AREA_WEIGHT[item.ownerArea];
}

export function createQualityDebtRegistry(options: QualityDebtOptions = {}): QualityDebtRegistry {
  const now = options.now ?? (() => Date.now());
  const items = new Map<string, DebtItem>();
  let nextId = 1;

  function getOrThrow(id: string): DebtItem {
    const item = items.get(id);
    if (!item) throw new Error(`Quality debt item "${id}" not found`);
    return item;
  }

  return {
    record(input) {
      const id = input.id ?? `debt-${nextId++}`;
      if (items.has(id)) throw new Error(`Quality debt item "${id}" already recorded`);
      const recordedAt = input.recordedAt ?? now();
      const item: DebtItem = {
        id,
        category: input.category,
        severity: input.severity,
        ownerArea: input.ownerArea,
        impact: input.impact,
        recommendedFix: input.recommendedFix,
        evidence: input.evidence,
        status: 'open',
        recordedAt,
      };
      items.set(id, item);
      return item;
    },

    acknowledge(id) {
      const item = getOrThrow(id);
      if (item.status === 'resolved') throw new Error(`Item "${id}" is already resolved`);
      const next: DebtItem = { ...item, status: 'acknowledged' };
      items.set(id, next);
      return next;
    },

    startWork(id) {
      const item = getOrThrow(id);
      if (item.status === 'resolved') throw new Error(`Item "${id}" is already resolved`);
      const next: DebtItem = { ...item, status: 'in_progress' };
      items.set(id, next);
      return next;
    },

    resolve(id, resolvedBy, evidence) {
      const item = getOrThrow(id);
      if (!evidence?.sourceId) {
        throw new Error(`Cannot resolve "${id}" without evidence`);
      }
      const next: DebtItem = {
        ...item,
        status: 'resolved',
        resolvedAt: now(),
        resolvedBy,
        resolutionEvidence: evidence,
      };
      items.set(id, next);
      return next;
    },

    get(id) {
      return items.get(id);
    },

    active() {
      return [...items.values()]
        .filter((i) => i.status !== 'resolved')
        .sort((a, b) => impactScore(b) - impactScore(a));
    },

    all() {
      return [...items.values()].sort((a, b) => a.recordedAt - b.recordedAt);
    },

    toJson() {
      return this.all();
    },
  };
}

// ── Helpers (used by callers building debt items) ───────────────────────

/** Compute the impact score (severity × owner-area weight) for a
 *  given category — useful for sorting debt items in the diagnostic
 *  surface without instantiating the registry. */
export function debtImpactScore(item: Pick<DebtItem, 'severity' | 'ownerArea'>): number {
  return SEVERITY_WEIGHT[item.severity] * OWNER_AREA_WEIGHT[item.ownerArea];
}
