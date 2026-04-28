/**
 * Scenario Library — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 5.
 *
 * Curated library of crisis and edge-case scenarios that become
 * permanent regression tests. Each scenario is a deterministic,
 * JSON-serializable bundle of:
 *   - mission domain
 *   - input fixtures (alert, place, provider state, etc.)
 *   - expected mission events (warning_before_impact, etc.)
 *   - expected ground truth (true_positive / true_negative / etc.)
 *
 * Scenarios feed the existing replay harness (`replay-fixtures.ts`)
 * and surface as a regression suite the closed-loop layer runs
 * against every algorithm-version promotion.
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable.
 *   - No private user data — all fixtures are synthetic.
 *   - Every scenario maps to at least one ReplayExpectation kind.
 *   - Adding a scenario is purely declarative (push an object onto
 *     the catalog, no runtime side effects).
 */

import type { MissionDomain, MissionEventKind } from '@/services/ops/mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export type ScenarioCategory =
  | 'tornado_at_night'
  | 'flash_flood_saved_place'
  | 'cyber_zero_day'
  | 'port_closure'
  | 'refinery_fire'
  | 'regional_blackout'
  | 'conflict_escalation'
  | 'market_shock'
  | 'food_shortage_escalation'
  | 'provider_outage_during_hazard';

export type ReplayExpectationKind =
  | 'warning_before_impact'
  | 'no_silent_signal'
  | 'requires_confirmation'
  | 'user_action_observed'
  | 'no_false_alarm';

export interface ScenarioReplayExpectation {
  kind: ReplayExpectationKind;
  /** Free-text rationale ("tornado warnings must fire ≥3 minutes
   *  before impact for safety_critical lead time"). */
  rationale: string;
  /** Mission events that MUST appear before the deadline. */
  requiredEvents?: readonly MissionEventKind[];
  /** Window (ms) before estimated_impact / actual_impact in which
   *  the required events must land. */
  withinMs?: number;
  /** When set, the scenario expects user_acknowledged within this ms. */
  userActionWithinMs?: number;
}

export interface ScenarioFixture {
  id: string;
  category: ScenarioCategory;
  domain: MissionDomain;
  /** Plain-English description for the diagnostic surface. */
  description: string;
  /** Stable seeded synthetic data. Shape is intentionally
   *  domain-loose so each scenario can carry whatever the domain's
   *  test harness needs (alerts, places, provider snapshots). */
  inputs: Record<string, unknown>;
  /** Expected ground-truth outcome. */
  expectedOutcome: 'true_positive' | 'true_negative' | 'late_warning' | 'noisy_warning' | 'silent_signal';
  expectations: readonly ScenarioReplayExpectation[];
}

// ── Catalog ─────────────────────────────────────────────────────────────

/** The starter library specified in the plan. Each entry is
 *  deliberately minimal-but-complete so the replay harness can pull
 *  it without a separate fixture registry. */
const CATALOG: readonly ScenarioFixture[] = [
  {
    id: 'tornado-at-night',
    category: 'tornado_at_night',
    domain: 'weather_safety',
    description: 'Tornado warning issued at 02:30 local time within saved-place polygon',
    inputs: {
      alert: {
        id: 'urn:scenario:tornado-night',
        event: 'Tornado Warning',
        severity: 'extreme',
        polygonRing: [
          [-87, 41.5], [-86.5, 41.5], [-86.5, 41.8], [-87, 41.8], [-87, 41.5],
        ],
        sentIso: '2026-01-01T07:30:00Z',
        expiresIso: '2026-01-01T08:00:00Z',
      },
      place: { id: 'home', label: 'Home', lat: 41.61, lon: -86.722 },
      quietHoursActive: true,
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'warning_before_impact',
        rationale: 'Tornado warnings must reach the user even during quiet hours — bypass-eligible hazard',
        requiredEvents: ['app_watch', 'user_notified'],
        withinMs: 60_000,
      },
    ],
  },
  {
    id: 'flash-flood-saved-place',
    category: 'flash_flood_saved_place',
    domain: 'weather_safety',
    description: 'Flash Flood Warning polygon fully envelopes the saved place',
    inputs: {
      alert: {
        id: 'urn:scenario:flash-flood',
        event: 'Flash Flood Warning',
        severity: 'severe',
        polygonRing: [
          [-87, 41.4], [-86.5, 41.4], [-86.5, 41.85], [-87, 41.85], [-87, 41.4],
        ],
        sentIso: '2026-01-01T15:00:00Z',
        expiresIso: '2026-01-01T17:00:00Z',
      },
      place: { id: 'home', label: 'Home', lat: 41.61, lon: -86.722 },
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'warning_before_impact',
        rationale: 'Flash floods leave minutes of lead time — the warning must be persistent',
        requiredEvents: ['app_watch', 'user_notified'],
      },
    ],
  },
  {
    id: 'cyber-zero-day',
    category: 'cyber_zero_day',
    domain: 'cyber_exposure',
    description: 'CISA KEV adds a new actively-exploited CVE affecting watchlist asset',
    inputs: {
      kevAdvisory: {
        cveID: 'CVE-2026-9999',
        vendor: 'Acme Networks',
        product: 'EdgeRouter',
        dateAddedIso: '2026-04-28T12:00:00Z',
      },
      watchlistAsset: { kind: 'product', name: 'Acme EdgeRouter' },
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'requires_confirmation',
        rationale: 'CVE additions need a confirming source (NVD/vendor) before nudging the user to patch',
      },
    ],
  },
  {
    id: 'port-closure',
    category: 'port_closure',
    domain: 'travel_disruption',
    description: 'Port of Long Beach closure ripples into supply-chain alert + shortage forecast',
    inputs: {
      portStatus: { portId: 'USLGB', status: 'closed', sinceIso: '2026-04-28T06:00:00Z' },
    },
    expectedOutcome: 'late_warning',
    expectations: [
      {
        kind: 'no_silent_signal',
        rationale: 'A closed major port should always generate a watch event even when downstream signals lag',
      },
    ],
  },
  {
    id: 'refinery-fire',
    category: 'refinery_fire',
    domain: 'energy_fuel_stress',
    description: 'Refinery fire reduces regional gasoline / diesel capacity',
    inputs: {
      facility: { id: 'refinery-LA-01', kind: 'refinery', region: 'PADD-5' },
      eventKind: 'fire',
      capacityLossPct: 35,
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'warning_before_impact',
        rationale: 'Capacity loss should trigger a fuel-stress mission within a few hours',
        requiredEvents: ['app_watch', 'user_notified'],
        withinMs: 6 * 60 * 60 * 1000,
      },
    ],
  },
  {
    id: 'regional-blackout',
    category: 'regional_blackout',
    domain: 'local_infrastructure',
    description: 'Regional power outage covering the saved place',
    inputs: {
      outage: { utilityId: 'NIPSCO', affectedCounties: ['LaPorte'], sinceIso: '2026-04-28T18:00:00Z' },
      place: { id: 'home', label: 'Home', lat: 41.61, lon: -86.722 },
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'warning_before_impact',
        requiredEvents: ['app_watch', 'user_notified'],
        rationale: 'Local infrastructure failures must surface in real time',
      },
    ],
  },
  {
    id: 'conflict-escalation',
    category: 'conflict_escalation',
    domain: 'conflict_escalation',
    description: 'ACLED + GDELT both register multiple high-fatality events within a 24h window',
    inputs: {
      acledEventCount: 12,
      gdeltToneSeries: [-2.1, -3.4, -4.8, -5.9],
      timeframeHours: 24,
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'requires_confirmation',
        rationale: 'Conflict-escalation alerts need cross-source agreement before notifying',
      },
    ],
  },
  {
    id: 'market-shock',
    category: 'market_shock',
    domain: 'market_portfolio_risk',
    description: 'S&P 500 drops 4% in one day with elevated VIX',
    inputs: {
      spxChangePct: -4.1,
      vix: 32,
      btcChangePct: -2.3,
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'warning_before_impact',
        rationale: 'Market shocks need to fire while the market is still open',
        requiredEvents: ['user_notified'],
        withinMs: 30 * 60 * 1000,
      },
    ],
  },
  {
    id: 'food-shortage-escalation',
    category: 'food_shortage_escalation',
    domain: 'food_commodity_shortage',
    description: 'Wheat futures + USDA crop conditions both signal supply stress',
    inputs: {
      wheatFuturesChangePct: 8.4,
      usdaCropConditionGoodPct: 38,
      laninaActive: true,
    },
    expectedOutcome: 'true_positive',
    expectations: [
      {
        kind: 'no_false_alarm',
        rationale: 'Single-source price spikes alone should NOT fire a shortage alert without crop-condition confirmation',
      },
    ],
  },
  {
    id: 'provider-outage-during-hazard',
    category: 'provider_outage_during_hazard',
    domain: 'weather_safety',
    description: 'NWS endpoint becomes silent for >30 min while a saved-place severe alert is active',
    inputs: {
      providerSilentSince: '2026-04-28T12:00:00Z',
      activeMissionDomain: 'weather_safety',
      cachedAlertActive: true,
    },
    expectedOutcome: 'late_warning',
    expectations: [
      {
        kind: 'no_silent_signal',
        rationale: 'When the primary provider goes silent during a known hazard, a degraded warning must still surface',
      },
    ],
  },
];

// ── Public API ──────────────────────────────────────────────────────────

export function listScenarios(): readonly ScenarioFixture[] {
  return CATALOG;
}

export function getScenario(id: string): ScenarioFixture | undefined {
  return CATALOG.find((s) => s.id === id);
}

export function listByDomain(domain: MissionDomain): readonly ScenarioFixture[] {
  return CATALOG.filter((s) => s.domain === domain);
}

export function listByCategory(category: ScenarioCategory): readonly ScenarioFixture[] {
  return CATALOG.filter((s) => s.category === category);
}

/** Audit summary — used by the diagnostics export bundle to confirm
 *  scenario coverage across the eight mission domains. */
export interface ScenarioCoverage {
  totalScenarios: number;
  byDomain: Record<MissionDomain, number>;
  byCategory: Record<ScenarioCategory, number>;
}

export function summarizeScenarioCoverage(): ScenarioCoverage {
  const byDomain: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const s of CATALOG) {
    byDomain[s.domain] = (byDomain[s.domain] ?? 0) + 1;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  }
  return {
    totalScenarios: CATALOG.length,
    byDomain: byDomain as Record<MissionDomain, number>,
    byCategory: byCategory as Record<ScenarioCategory, number>,
  };
}
