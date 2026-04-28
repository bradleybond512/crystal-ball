/**
 * Operational Playbook Engine — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 8.
 *
 * Pure deterministic engine that produces a domain-specific
 * actionable playbook for an active risk. Every playbook answers
 * five questions:
 *   1. What to do now (ranked actions)
 *   2. What to monitor
 *   3. Who/what is affected
 *   4. What would invalidate the concern
 *   5. When to escalate
 *
 * Playbooks are domain-keyed (weather_safety, cyber_exposure, etc.)
 * and actions are ranked by urgency × confidence. The engine never
 * fabricates claims — every action references the situation that
 * produced it.
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable.
 *   - Deterministic — same inputs ⇒ same playbook ordering.
 *   - Domain-specific. The catalog enforces a playbook for every
 *     mission domain so a future caller can't ask for one and get
 *     undefined.
 *   - Each playbook lists invalidating indicators so the user
 *     knows when to stand down.
 */

import type { MissionDomain } from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export type ActionUrgency = 'now' | 'soon' | 'watch';

export interface PlaybookAction {
  id: string;
  /** Imperative, plan-readable. */
  text: string;
  urgency: ActionUrgency;
  /** 0..1 confidence the action is appropriate given the situation. */
  confidence: number;
  /** Why this action is on the list (which signals justified it). */
  reason: string;
}

export interface PlaybookEntity {
  /** Stable id (place id, asset id, ticker, etc.). */
  id: string;
  label: string;
  /** Why this entity is affected. */
  reason: string;
}

export interface PlaybookEscalation {
  trigger: string;
  /** What to do when the trigger fires. */
  action: string;
}

export interface OperationalPlaybook {
  missionId: string;
  domain: MissionDomain;
  /** Highest-urgency action — UI uses this as the headline. */
  headline: string;
  /** What to do, ranked. */
  actions: readonly PlaybookAction[];
  /** What to monitor (signals/sources/metrics). */
  monitor: readonly string[];
  /** Who/what is affected. */
  affected: readonly PlaybookEntity[];
  /** What would invalidate the concern (stand-down indicators). */
  invalidatingIndicators: readonly string[];
  /** Escalation triggers. */
  escalation: readonly PlaybookEscalation[];
}

// ── Inputs ──────────────────────────────────────────────────────────────

export interface PlaybookSituation {
  missionId: string;
  domain: MissionDomain;
  /** 0–100 severity from the upstream domain. */
  severity: number;
  /** 0–1 confidence the situation is real (truth-score output). */
  confidence: number;
  /** Plain-English summary the catalog reads to extract context. */
  summary: string;
  /** Affected entities to surface in `affected[]`. */
  affected: readonly PlaybookEntity[];
  /** Optional hazard hint that specializes the playbook
   *  (e.g. "tornado", "ransomware", "blackout"). */
  hazardHint?: string;
}

// ── Domain catalogs ─────────────────────────────────────────────────────
//
// Each domain has a builder that composes a playbook from the static
// catalog plus the situation-specific affected list. The catalogs
// stay declarative — adding a new hazard just means extending the
// catalog table.

interface PlaybookTemplate {
  baseActions: readonly Omit<PlaybookAction, 'confidence' | 'reason'>[];
  monitor: readonly string[];
  invalidatingIndicators: readonly string[];
  escalation: readonly PlaybookEscalation[];
}

const WEATHER_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'shelter', text: 'Move to an interior room on the lowest floor', urgency: 'now' },
    { id: 'charge', text: 'Charge phones / portable batteries while power is on', urgency: 'soon' },
    { id: 'water', text: 'Fill containers with water and identify a flashlight', urgency: 'soon' },
    { id: 'monitor', text: 'Keep weather-radio or NWS site open for storm-track updates', urgency: 'watch' },
  ],
  monitor: ['NWS active alerts', 'storm motion / arrival window', 'local power-grid status'],
  invalidatingIndicators: [
    'Alert downgraded by NWS',
    'Storm track diverged outside saved-place buffer',
    'Alert expires without reissue',
  ],
  escalation: [
    { trigger: 'Tornado emergency declared', action: 'Take shelter immediately and stay put until all-clear' },
    { trigger: 'Power outage in your area', action: 'Activate the fuel-stress / outage playbook' },
  ],
};

const CYBER_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'patch', text: 'Apply vendor patch on affected assets ASAP', urgency: 'now' },
    { id: 'isolate', text: 'Isolate affected hosts from sensitive networks', urgency: 'now' },
    { id: 'rotate', text: 'Rotate credentials that may have been exposed', urgency: 'soon' },
    { id: 'logs', text: 'Pull last 7 days of logs for indicators of compromise', urgency: 'watch' },
  ],
  monitor: ['CISA KEV catalog', 'vendor advisory page', 'NVD CVE updates'],
  invalidatingIndicators: [
    'Vendor confirms the asset is not affected',
    'Patch applied + post-patch validation passed',
    'CISA removes from KEV',
  ],
  escalation: [
    { trigger: 'Active exploitation observed in your environment', action: 'Engage incident response immediately' },
    { trigger: 'Lateral movement detected', action: 'Initiate full-network isolation' },
  ],
};

const ENERGY_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'fuel-up', text: 'Top off fuel tanks while supplies are still local', urgency: 'now' },
    { id: 'budget', text: 'Track regional retail prices for next 72h', urgency: 'soon' },
    { id: 'spare', text: 'Identify a backup fuel station within 50 km', urgency: 'watch' },
  ],
  monitor: ['EIA stocks', 'GasBuddy / 511 reports', 'pipeline status'],
  invalidatingIndicators: [
    'Refinery returns to full output',
    'Pipeline reopens',
    'Regional retail price drops back into baseline range',
  ],
  escalation: [
    { trigger: 'Multi-state shortage advisory', action: 'Activate the supply-chain playbook' },
  ],
};

const FOOD_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'pantry', text: 'Top off shelf-stable staples before retail prices rise', urgency: 'soon' },
    { id: 'monitor-prices', text: 'Track retail price trend for affected commodity', urgency: 'watch' },
  ],
  monitor: ['USDA crop conditions', 'futures price band', 'regional retail tracking'],
  invalidatingIndicators: [
    'USDA improves crop-condition rating',
    'Major exporter resumes shipments',
    'Futures retreat to baseline',
  ],
  escalation: [
    { trigger: 'Multi-region crop failure', action: 'Activate the food-stress playbook' },
  ],
};

const MARKET_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'review', text: 'Review portfolio exposure to the affected sector', urgency: 'now' },
    { id: 'cash', text: 'Confirm liquidity for the next 30 days', urgency: 'soon' },
    { id: 'alerts', text: 'Set price alerts on watchlist tickers', urgency: 'watch' },
  ],
  monitor: ['SPX / VIX / sector ETFs', 'fed funds futures', 'corporate-credit spreads'],
  invalidatingIndicators: ['VIX retreats below 20', 'Sector ETF reclaims pre-shock level', 'Yield curve normalizes'],
  escalation: [{ trigger: 'Halt-trading event', action: 'Activate the market-shock playbook' }],
};

const TRAVEL_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'reroute', text: 'Plan an alternate route around the disruption', urgency: 'now' },
    { id: 'flexibility', text: 'Confirm refundable / rebookable options on tickets', urgency: 'soon' },
    { id: 'comms', text: 'Notify hosts / contacts of possible delay', urgency: 'watch' },
  ],
  monitor: ['airport / port status feeds', 'state DOT 511 reports', 'carrier advisory pages'],
  invalidatingIndicators: ['Airport reopens', 'Carrier resumes scheduled service', 'Port status returns to "open"'],
  escalation: [{ trigger: 'Disruption extends > 24h', action: 'Switch to alternate transport mode' }],
};

const CONFLICT_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'monitor', text: 'Follow at least 2 independent sources covering the region', urgency: 'now' },
    { id: 'travel-check', text: 'Re-evaluate any travel plans into / through the region', urgency: 'soon' },
    { id: 'family-comm', text: 'Confirm communication channels with family in-country', urgency: 'watch' },
  ],
  monitor: ['ACLED + GDELT signals', 'State Department advisory level', 'official combatant statements'],
  invalidatingIndicators: ['ACLED event count drops to baseline', 'State Dept advisory level reduces', 'Ceasefire announced and held'],
  escalation: [{ trigger: 'NATO Article 4/5 invocation', action: 'Activate the war-mode playbook' }],
};

const INFRA_TEMPLATE: PlaybookTemplate = {
  baseActions: [
    { id: 'water', text: 'Fill bathtub + containers if a boil-water or outage advisory is active', urgency: 'now' },
    { id: 'alt-comm', text: 'Identify alternate comms (mobile data, neighbor, radio)', urgency: 'soon' },
    { id: 'utility', text: 'Bookmark utility outage map', urgency: 'watch' },
  ],
  monitor: ['utility outage map', 'EAS / NWS reports', 'neighbor reports'],
  invalidatingIndicators: ['Utility reports outage cleared', 'Boil-water advisory lifted', 'Power restored'],
  escalation: [{ trigger: 'Multi-day outage', action: 'Activate the local-resilience playbook' }],
};

const TEMPLATES: Record<MissionDomain, PlaybookTemplate> = {
  weather_safety: WEATHER_TEMPLATE,
  cyber_exposure: CYBER_TEMPLATE,
  energy_fuel_stress: ENERGY_TEMPLATE,
  food_commodity_shortage: FOOD_TEMPLATE,
  market_portfolio_risk: MARKET_TEMPLATE,
  travel_disruption: TRAVEL_TEMPLATE,
  conflict_escalation: CONFLICT_TEMPLATE,
  local_infrastructure: INFRA_TEMPLATE,
};

// ── Implementation ──────────────────────────────────────────────────────

export function buildPlaybook(situation: PlaybookSituation): OperationalPlaybook {
  const template = TEMPLATES[situation.domain];

  const actions: PlaybookAction[] = template.baseActions.map((base) => ({
    ...base,
    confidence: scaleConfidence(base.urgency, situation.confidence, situation.severity),
    reason: deriveReason(base.urgency, situation),
  }));

  // Sort by urgency (now > soon > watch) then confidence desc.
  actions.sort((a, b) => urgencyOrder(b.urgency) - urgencyOrder(a.urgency) || b.confidence - a.confidence);

  const headline = actions[0]?.text ?? 'No actions queued';

  return {
    missionId: situation.missionId,
    domain: situation.domain,
    headline,
    actions,
    monitor: template.monitor,
    affected: situation.affected,
    invalidatingIndicators: template.invalidatingIndicators,
    escalation: template.escalation,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function urgencyOrder(u: ActionUrgency): number {
  if (u === 'now') return 3;
  if (u === 'soon') return 2;
  return 1;
}

function scaleConfidence(
  urgency: ActionUrgency,
  situationConfidence: number,
  severity: number,
): number {
  // Use both confidence and severity; an urgent action on a
  // 90/100 severity situation with 0.95 confidence should pin near 1.0.
  const severityScore = Math.min(1, severity / 100);
  const baseline = situationConfidence * 0.7 + severityScore * 0.3;
  if (urgency === 'now') return Math.min(1, baseline + 0.1);
  if (urgency === 'soon') return baseline;
  return Math.max(0.1, baseline - 0.1);
}

function deriveReason(urgency: ActionUrgency, situation: PlaybookSituation): string {
  const hazard = situation.hazardHint ? ` (${situation.hazardHint})` : '';
  if (urgency === 'now') {
    return `Severity ${situation.severity}/100 + confidence ${(situation.confidence * 100).toFixed(0)}% from "${situation.summary}"${hazard}`;
  }
  if (urgency === 'soon') {
    return `Recommended given the situation: ${situation.summary}${hazard}`;
  }
  return `Monitor as ${situation.summary} evolves${hazard}`;
}

// ── Coverage helper ─────────────────────────────────────────────────────

export function listSupportedDomains(): readonly MissionDomain[] {
  return Object.keys(TEMPLATES) as MissionDomain[];
}
