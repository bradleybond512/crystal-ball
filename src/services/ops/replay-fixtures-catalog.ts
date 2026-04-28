/**
 * Replay fixtures catalog — gap #8 / PR F from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * The closed-loop replay-fixtures engine produces ReplayFixture objects
 * from mission records. This file ships a small starter catalog of
 * historical "missed/late" cases so the harness can prove regressions
 * before they ship.
 *
 * Pure deterministic: no fetch, no globals at import time. Each
 * fixture is a synthetic-but-realistic mission trace that tests
 * the fact: "Crystal Ball would warn earlier next time."
 *
 * Plan invariants:
 *   - Every fixture has a clear failure mode (late_warning,
 *     silent_signal, unconfirmed, low_follow_through).
 *   - Every fixture has expected pivots so the replay harness can
 *     verify the assertion "warning fired ≥ N min before impact".
 *   - All timestamps are absolute ms epoch — fixtures are stable
 *     across machines.
 */

import type { MissionRecord } from './mission-types';
import { detectNearMisses } from './near-miss';
import { buildReplayFixtures, type ReplayFixture } from './replay-fixtures';

// Anchor at a real-feeling timestamp. Apr 28 2026 13:00 UTC.
// Don't tie this to runtime — fixtures must be reproducible.
const ANCHOR = 1_777_640_400_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── Severe-wind near-miss (gameplan section "Phase 5") ──────────────────

/** A historical-style severe-wind warning that fired AFTER impact at
 *  a saved place. The replay harness should prove the urgency-ladder
 *  + polygon-matcher fixes catch this earlier. */
export const LATE_SEVERE_WIND_FIXTURE: MissionRecord = {
  id: 'fixture-late-severe-wind-2025',
  domain: 'weather_safety',
  description: 'Severe Thunderstorm Warning near Home (LATE)',
  createdAt: ANCHOR - 2 * HOUR,
  status: 'resolved_miss',
  events: [
    {
      id: 'evt-1',
      at: ANCHOR - 90 * MIN,
      kind: 'weak_signal',
      label: 'Mesoscale convective outlook flagged',
      detail: { outlookProbability: 0.55, source: 'SPC' },
    },
    {
      id: 'evt-2',
      at: ANCHOR - 35 * MIN,
      kind: 'app_watch',
      label: 'App started watching the storm cluster',
    },
    {
      id: 'evt-3',
      at: ANCHOR + 5 * MIN,
      kind: 'actual_impact',
      label: 'Severe wind impact at Home (70 mph gust observed)',
      detail: { gustMph: 70, distanceFromHomeKm: 0 },
    },
    {
      id: 'evt-4',
      at: ANCHOR + 18 * MIN,
      kind: 'user_notified',
      label: 'NWS Severe Thunderstorm Warning dispatched (LATE)',
    },
  ],
};

// ── Tornado polygon overlap miss ────────────────────────────────────────

/** Polygon matching skipped because saved place had no UGC zone
 *  fallback. Demonstrates the "silent_signal" near-miss path. */
export const SILENT_TORNADO_POLYGON_FIXTURE: MissionRecord = {
  id: 'fixture-silent-tornado-polygon-2025',
  domain: 'weather_safety',
  description: 'Tornado Warning polygon overlapped Home but no notification fired',
  createdAt: ANCHOR - 3 * HOUR,
  status: 'resolved_miss',
  events: [
    {
      id: 'evt-1',
      at: ANCHOR - 45 * MIN,
      kind: 'weak_signal',
      label: 'Tornado Warning polygon issued by NWS',
      detail: { polygonArea: 'overlapping Home', source: 'NWS' },
    },
    {
      id: 'evt-2',
      at: ANCHOR - 15 * MIN,
      kind: 'actual_impact',
      label: 'Tornado tracked within 2 km of Home',
    },
    {
      id: 'evt-3',
      at: ANCHOR - 5 * MIN,
      kind: 'near_miss',
      label: 'User found warning via Twitter — app never delivered.',
      detail: { externalSource: 'twitter', missMode: 'silent_signal' },
    },
  ],
};

// ── Fuel shortage early-warning (energy domain) ─────────────────────────

/** Diesel inventory + crack spread were both flagging weeks before
 *  retail prices spiked. This fixture proves the shortage scorer +
 *  notification ladder fire on time. */
export const FUEL_STRESS_LATE_FIXTURE: MissionRecord = {
  id: 'fixture-fuel-stress-late-2025',
  domain: 'energy_fuel_stress',
  description: 'Diesel stress signal fired late vs retail price spike',
  createdAt: ANCHOR - 14 * 24 * HOUR,
  status: 'resolved_miss',
  events: [
    {
      id: 'evt-1',
      at: ANCHOR - 14 * 24 * HOUR,
      kind: 'weak_signal',
      label: 'Distillate inventory below 5-yr range',
    },
    {
      id: 'evt-2',
      at: ANCHOR - 10 * 24 * HOUR,
      kind: 'weak_signal',
      label: 'Crack spread widened past 90th percentile',
    },
    {
      id: 'evt-3',
      at: ANCHOR - 2 * 24 * HOUR,
      kind: 'actual_impact',
      label: 'Retail diesel +18% week-over-week (price spike)',
    },
    {
      id: 'evt-4',
      at: ANCHOR - 1 * 24 * HOUR,
      kind: 'user_notified',
      label: 'Shortage radar elevated diesel to ELEVATED (1d after impact)',
    },
  ],
};

// ── Quiet-hours suppression bug ─────────────────────────────────────────

/** Severe weather warning suppressed by quiet hours when the user had
 *  bypass disabled. Fixture exists so the safety-bypass logic stays
 *  pinned ("never miss what matters"). */
export const QUIET_HOURS_SUPPRESSION_FIXTURE: MissionRecord = {
  id: 'fixture-quiet-hours-suppression-2025',
  domain: 'weather_safety',
  description: 'Tornado Warning suppressed by quiet hours (bypass off)',
  createdAt: ANCHOR - 4 * HOUR,
  status: 'resolved_miss',
  events: [
    {
      id: 'evt-1',
      at: ANCHOR - 90 * MIN,
      kind: 'weak_signal',
      label: 'Tornado watch issued',
    },
    {
      id: 'evt-2',
      at: ANCHOR - 50 * MIN,
      kind: 'app_watch',
      label: 'App started watching tornado cluster',
    },
    {
      id: 'evt-3',
      at: ANCHOR - 30 * MIN,
      kind: 'official_confirmed',
      label: 'NWS Tornado Warning issued — polygon matches Home',
    },
    {
      id: 'evt-4',
      at: ANCHOR - 28 * MIN,
      kind: 'near_miss',
      label: 'Notification suppressed by quiet hours; bypass disabled',
      detail: { suppressionReason: 'quiet-hours-no-bypass' },
    },
    {
      id: 'evt-5',
      at: ANCHOR - 8 * MIN,
      kind: 'actual_impact',
      label: 'Tornado track passes 1.5 km north of Home',
    },
  ],
};

// ── ADS-B data outage (low_follow_through proxy) ────────────────────────

/** Backend aggregate failed silently for 6 hours — user discovered
 *  via external source. */
export const ADSB_OUTAGE_FIXTURE: MissionRecord = {
  id: 'fixture-adsb-outage-2025',
  domain: 'travel_disruption',
  description: 'ADS-B aggregate stale — flight stats reported but never refreshed',
  createdAt: ANCHOR - 8 * HOUR,
  status: 'resolved_miss',
  events: [
    {
      id: 'evt-1',
      at: ANCHOR - 8 * HOUR,
      kind: 'app_watch',
      label: 'ADS-B aggregate watching SFO inbound traffic',
    },
    {
      id: 'evt-2',
      at: ANCHOR - 6 * HOUR,
      kind: 'weak_signal',
      label: 'Flight count dropped 80% (provider outage)',
    },
    {
      id: 'evt-3',
      at: ANCHOR - 1 * HOUR,
      kind: 'near_miss',
      label: 'User noticed via external flight-tracker; app showed stale aggregate',
      detail: { missMode: 'silent_signal' },
    },
  ],
};

// ── Catalog ─────────────────────────────────────────────────────────────

export const REPLAY_FIXTURE_MISSIONS: readonly MissionRecord[] = [
  LATE_SEVERE_WIND_FIXTURE,
  SILENT_TORNADO_POLYGON_FIXTURE,
  FUEL_STRESS_LATE_FIXTURE,
  QUIET_HOURS_SUPPRESSION_FIXTURE,
  ADSB_OUTAGE_FIXTURE,
];

/** Build the full ReplayFixture[] for the harness. Combines the
 *  catalog missions with the existing buildReplayFixtures + near-miss
 *  detector so every fixture carries the right expectations. */
export function buildCatalogReplayFixtures(now?: number): ReplayFixture[] {
  const generatedAt = now ?? ANCHOR;
  const nearMisses = detectNearMisses(REPLAY_FIXTURE_MISSIONS, { now: () => generatedAt });
  return buildReplayFixtures({
    generatedAt,
    missions: REPLAY_FIXTURE_MISSIONS,
    nearMisses,
  });
}
