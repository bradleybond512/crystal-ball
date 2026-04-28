/**
 * Mission types — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 1
 * (lines 430-438).
 *
 * Pure type module: no runtime, no DOM. PR 2 (time-to-warn), PR 3
 * (explanation QA), PR 4-N (effectiveness, near-miss, replay) read
 * and write these shapes.
 *
 * Plan invariant: every mission record is JSON-serializable so the
 * audit trail (plan section 7) and replay harness (section 9) can
 * reload them without parsing.
 */

// ── Mission domain ──────────────────────────────────────────────────────

/** Plan section 1, lines 50-59: separate effectiveness scores per
 *  mission. The closed-loop ops layer aggregates events into these
 *  buckets so the user can answer "is the weather mission working?"
 *  independently of "is the markets mission working?". */
export type MissionDomain =
  | 'weather_safety'
  | 'conflict_escalation'
  | 'cyber_exposure'
  | 'food_commodity_shortage'
  | 'energy_fuel_stress'
  | 'travel_disruption'
  | 'market_portfolio_risk'
  | 'local_infrastructure';

// ── Mission event taxonomy ──────────────────────────────────────────────

/** Plan section 2, lines 76-85: every mission record traces an event
 *  through these phases. Each MissionEvent carries one of these
 *  kinds. */
export type MissionEventKind =
  | 'weak_signal'           // first detectable signal in our data
  | 'app_watch'             // app started watching the situation
  | 'user_notified'         // notification dispatched to the user
  | 'official_confirmed'    // an authoritative source confirmed it
  | 'estimated_impact'      // expected impact time per current model
  | 'actual_impact'         // ground truth — when impact actually arrived
  | 'user_acknowledged'     // user took an explicit action (acknowledge / dismiss / open)
  | 'user_action_taken'     // user did something downstream (charged phone, sheltered, …)
  | 'forecast_resolved'     // hit / miss / expired resolution
  | 'near_miss';            // event found late or by external user (plan section 5)

// ── Mission status ──────────────────────────────────────────────────────

export type MissionStatus =
  | 'active'        // ongoing
  | 'resolved_hit'  // forecast was correct
  | 'resolved_miss' // forecast was wrong (false positive or false negative)
  | 'expired'       // window closed without resolution
  | 'cancelled';    // user dismissed / source retracted

// ── Mission event ──────────────────────────────────────────────────────

export interface MissionEvent {
  /** Stable id, monotonic per ledger instance. */
  id: string;
  /** ms timestamp the event occurred (or was estimated to). */
  at: number;
  kind: MissionEventKind;
  /** Free-text label — mirrors the plan's worked examples
   *  ("Tornado Warning issued", "Storm impacted Home"). */
  label: string;
  /** Optional structured detail — JSON-serializable. */
  detail?: Record<string, unknown>;
  /** Optional ms estimate of measurement uncertainty. The
   *  time-to-warn calculator uses this when building error bars. */
  uncertaintyMs?: number;
}

// ── Mission record ─────────────────────────────────────────────────────

export interface MissionRecord {
  /** Stable id, ideally tied to the underlying alert / situation. */
  id: string;
  domain: MissionDomain;
  /** Free-text description ("Severe Thunderstorm Warning near Home"). */
  description: string;
  /** ms timestamp when the mission was opened. */
  createdAt: number;
  status: MissionStatus;
  /** Ordered list of events in the mission. PR 2 derives time-to-warn
   *  metrics from this. */
  events: readonly MissionEvent[];
  /** Optional fact / situation / alert id this mission corresponds to. */
  factId?: string;
  /** Optional saved-place id when the mission is tied to a specific
   *  user location. */
  placeId?: string;
  /** Optional algorithm id that originated the mission (joins with
   *  the algorithm registry). */
  originAlgorithmId?: string;
  /** Optional explanation completeness score (0-1) populated by
   *  PR 3 (Explanation QA). */
  explanationScore?: number;
  /** ms timestamp when the mission was resolved. */
  resolvedAt?: number;
  /** Free-text resolution reason. */
  resolutionReason?: string;
}

// ── Aggregate views (consumed by later PRs) ────────────────────────────

export interface MissionLedgerSnapshot {
  generatedAt: number;
  /** All missions, oldest first. */
  missions: readonly MissionRecord[];
  /** Domain-keyed counts for the diagnostic surface. */
  countsByDomain: Record<MissionDomain, number>;
  /** Status-keyed counts (active / hit / miss / expired / cancelled). */
  countsByStatus: Record<MissionStatus, number>;
}
