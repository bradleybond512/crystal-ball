/**
 * Trust Budget — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 4.
 *
 * Pure deterministic per-domain ledger of trust earned and spent.
 * Trust isn't truth — it's the user's-side score the app keeps on
 * itself. The closed-loop layer (and the Safety Case in Layer 6)
 * read this to decide whether the user can rely on the app for
 * critical warnings right now.
 *
 * Trust DROPS when the app is overconfident, noisy, stale, blind,
 * late, wrong, or unclear. Trust IMPROVES when the app warns early,
 * explains clearly, resolves accurately, avoids false alarms,
 * acknowledges uncertainty, or gives useful action guidance.
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable for the diagnostics export bundle.
 *   - Deterministic — same event stream ⇒ same balance.
 *   - Pure: the ledger never mutates inputs and the API takes
 *     events explicitly so tests can replay deterministically.
 *   - Trust is NOT truth scoring. A high trust budget doesn't mean
 *     a fact is correct; it means the user's trust in the system
 *     is currently in good standing.
 */

import type { MissionDomain } from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export type TrustEventKind =
  // Negative (trust spent)
  | 'overconfident'
  | 'noisy'
  | 'stale_data'
  | 'blind_spot'
  | 'late_warning'
  | 'wrong_resolution'
  | 'unclear_explanation'
  // Positive (trust earned)
  | 'warned_early'
  | 'explained_clearly'
  | 'resolved_accurately'
  | 'avoided_false_alarm'
  | 'acknowledged_uncertainty'
  | 'useful_action';

export interface TrustEvent {
  domain: MissionDomain;
  kind: TrustEventKind;
  at: number;
  /** Optional reason text — surfaced in the per-domain summary. */
  reason?: string;
  /** Optional override for the kind's default magnitude. Use
   *  sparingly; the defaults are calibrated to keep the budget
   *  bounded. */
  weightOverride?: number;
}

export type TrustVerdict = 'positive' | 'neutral' | 'negative' | 'critical_debt';

export interface TrustDomainSummary {
  domain: MissionDomain;
  /** Net balance after all events. Bounded to [-100, +100]. */
  balance: number;
  /** Sum of positive event weights. */
  earned: number;
  /** Sum of negative event weights (positive number). */
  spent: number;
  verdict: TrustVerdict;
  /** Top-3 negative events by weight, used as the "why has trust
   *  dropped" surface. */
  topConcerns: readonly TrustEvent[];
  /** Top-3 positive events by weight, used as the "what's working"
   *  surface. */
  topStrengths: readonly TrustEvent[];
}

export interface TrustBudgetReport {
  generatedAt: number;
  byDomain: Record<MissionDomain, TrustDomainSummary>;
  /** Worst verdict seen across all domains. */
  worst: TrustVerdict;
  summary: string;
}

// ── Default weights ─────────────────────────────────────────────────────

/** Calibrated so a single high-impact event moves the budget by ~10
 *  on the [-100, +100] scale. The closed-loop layer can tune later
 *  via Trust Budget Tuning (Layer 6). */
const DEFAULT_WEIGHTS: Record<TrustEventKind, number> = {
  // Negative
  overconfident: -8,
  noisy: -5,
  stale_data: -6,
  blind_spot: -10,
  late_warning: -10,
  wrong_resolution: -12,
  unclear_explanation: -3,
  // Positive
  warned_early: +12,
  explained_clearly: +4,
  resolved_accurately: +8,
  avoided_false_alarm: +6,
  acknowledged_uncertainty: +3,
  useful_action: +5,
};

const POSITIVE_KINDS: ReadonlySet<TrustEventKind> = new Set([
  'warned_early',
  'explained_clearly',
  'resolved_accurately',
  'avoided_false_alarm',
  'acknowledged_uncertainty',
  'useful_action',
]);

const ALL_DOMAINS: readonly MissionDomain[] = [
  'weather_safety',
  'conflict_escalation',
  'cyber_exposure',
  'food_commodity_shortage',
  'energy_fuel_stress',
  'travel_disruption',
  'market_portfolio_risk',
  'local_infrastructure',
];

// ── Public API ──────────────────────────────────────────────────────────

export interface ComputeTrustBudgetInput {
  events: readonly TrustEvent[];
  generatedAt?: number;
}

export function computeTrustBudget(input: ComputeTrustBudgetInput): TrustBudgetReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const byDomain: Partial<Record<MissionDomain, TrustDomainSummary>> = {};

  for (const domain of ALL_DOMAINS) {
    byDomain[domain] = emptySummary(domain);
  }

  // We accumulate into mutable buckets here, then freeze into the
  // readonly shape in the second loop. A bit of cast gymnastics is
  // needed because TrustDomainSummary exposes the arrays as readonly.
  const concernBuckets = new Map<MissionDomain, TrustEvent[]>();
  const strengthBuckets = new Map<MissionDomain, TrustEvent[]>();
  for (const domain of ALL_DOMAINS) {
    concernBuckets.set(domain, []);
    strengthBuckets.set(domain, []);
  }

  for (const event of input.events) {
    const summary = byDomain[event.domain];
    if (!summary) continue;
    const weight = event.weightOverride ?? DEFAULT_WEIGHTS[event.kind];
    const writable = summary as {
      earned: number; spent: number; balance: number;
    };
    if (weight > 0) {
      writable.earned += weight;
      strengthBuckets.get(event.domain)!.push(event);
    } else if (weight < 0) {
      writable.spent += -weight;
      concernBuckets.get(event.domain)!.push(event);
    }
    writable.balance = clamp(writable.balance + weight, -100, 100);
  }

  for (const domain of ALL_DOMAINS) {
    const s = byDomain[domain]!;
    const writable = s as { verdict: TrustVerdict; topConcerns: readonly TrustEvent[]; topStrengths: readonly TrustEvent[] };
    writable.verdict = bucketVerdict(s.balance);
    writable.topConcerns = sortByWeight(concernBuckets.get(domain)!).slice(0, 3);
    writable.topStrengths = sortByWeight(strengthBuckets.get(domain)!).slice(0, 3);
  }

  const worst = ALL_DOMAINS.reduce<TrustVerdict>(
    (acc, d) => worseVerdict(acc, byDomain[d]!.verdict),
    'positive',
  );

  return {
    generatedAt,
    byDomain: byDomain as Record<MissionDomain, TrustDomainSummary>,
    worst,
    summary: buildSummary(byDomain as Record<MissionDomain, TrustDomainSummary>, worst),
  };
}

// ── Internal helpers ────────────────────────────────────────────────────

function emptySummary(domain: MissionDomain): TrustDomainSummary {
  return {
    domain,
    balance: 0,
    earned: 0,
    spent: 0,
    verdict: 'neutral',
    topConcerns: [],
    topStrengths: [],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function bucketVerdict(balance: number): TrustVerdict {
  if (balance >= 20) return 'positive';
  if (balance >= -10) return 'neutral';
  if (balance >= -40) return 'negative';
  return 'critical_debt';
}

function worseVerdict(a: TrustVerdict, b: TrustVerdict): TrustVerdict {
  const order: TrustVerdict[] = ['positive', 'neutral', 'negative', 'critical_debt'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function sortByWeight(events: readonly TrustEvent[]): TrustEvent[] {
  return [...events].sort((a, b) => {
    const wa = Math.abs(a.weightOverride ?? DEFAULT_WEIGHTS[a.kind]);
    const wb = Math.abs(b.weightOverride ?? DEFAULT_WEIGHTS[b.kind]);
    if (wb !== wa) return wb - wa;
    return a.at - b.at;
  });
}

function buildSummary(
  byDomain: Record<MissionDomain, TrustDomainSummary>,
  worst: TrustVerdict,
): string {
  if (worst === 'positive') return 'Trust budget healthy across all domains.';
  const struggling = ALL_DOMAINS
    .filter((d) => byDomain[d].verdict === 'negative' || byDomain[d].verdict === 'critical_debt')
    .map((d) => `${d} (${byDomain[d].balance})`)
    .join(', ');
  return struggling
    ? `Worst verdict: ${worst}. Domains in trust debt: ${struggling}.`
    : `Worst verdict: ${worst}.`;
}

// ── Convenience: trust kind classification ──────────────────────────────

export function isPositiveTrustEvent(kind: TrustEventKind): boolean {
  return POSITIVE_KINDS.has(kind);
}
