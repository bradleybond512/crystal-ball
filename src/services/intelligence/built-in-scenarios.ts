/**
 * Built-in backtest scenarios — Phase 4 fixture library.
 *
 * Four synthetic-but-realistic historical scenarios with known outcomes.
 * Used by the BacktestPanel as a default battery and by callers that
 * need a stable reference set before designing custom scenarios.
 *
 * Raw payload shapes match what the built-in drivers in
 * `built-in-drivers.ts` actually read (magnitude, windSpeedMph, etc.)
 * so the backtest produces meaningful baseline accuracy against the
 * production scoring pipeline.
 */

import type { ObservationEvent } from './observation-adapters';
import type { BacktestScenario } from './backtest-engine';

const BASE_TIMESTAMP = 1_745_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function obs(
  id: string,
  domain: string,
  title: string,
  severity: ObservationEvent['severity'],
  raw: Record<string, unknown>,
  offsetHours = 0,
): ObservationEvent {
  return {
    id,
    sourceId: `${domain}-fixture`,
    domain,
    timestamp: BASE_TIMESTAMP + offsetHours * HOUR_MS,
    severity,
    title,
    raw,
    entityIds: [],
    tags: [],
  };
}

// ── 1. Pacific earthquake cluster ─────────────────────────────────────

const pacificEarthquakeCluster: BacktestScenario = {
  id: 'pacific-earthquake-cluster',
  name: 'Pacific earthquake cluster',
  description:
    '5 earthquakes ranging M4.5–M7.2 over a 6-hour window. Tests whether magnitude-based driver scoring correctly assigns severity bands across the full magnitude range.',
  observations: [
    obs('quake-1', 'earthquake', 'M4.5 — offshore Oregon', 'LOW',
      { magnitude: 4.5, properties: { mag: 4.5 } }, 0),
    obs('quake-2', 'earthquake', 'M5.5 — Hokkaido', 'MEDIUM',
      { magnitude: 5.5, properties: { mag: 5.5 } }, 1),
    obs('quake-3', 'earthquake', 'M5.8 — Kuril Islands', 'MEDIUM',
      { magnitude: 5.8, properties: { mag: 5.8 } }, 2),
    obs('quake-4', 'earthquake', 'M6.8 — Vanuatu', 'HIGH',
      { magnitude: 6.8, properties: { mag: 6.8 } }, 3),
    obs('quake-5', 'earthquake', 'M7.2 — Tonga trench', 'CRITICAL',
      { magnitude: 7.2, properties: { mag: 7.2 } }, 5),
  ],
  knownOutcomes: [
    { observationId: 'quake-1', actualSeverity: 'low', wasActedOn: false },
    { observationId: 'quake-2', actualSeverity: 'medium', wasActedOn: true },
    { observationId: 'quake-3', actualSeverity: 'medium', wasActedOn: true },
    { observationId: 'quake-4', actualSeverity: 'high', wasActedOn: true },
    { observationId: 'quake-5', actualSeverity: 'critical', wasActedOn: true },
  ],
};

// ── 2. Weather escalation ─────────────────────────────────────────────

const weatherEscalation: BacktestScenario = {
  id: 'weather-escalation',
  name: 'Weather escalation ladder',
  description:
    '4-stage weather progression: advisory → warning → watch → emergency over 8 hours. Tests that increasing wind speed crosses severity bands without missing intermediate levels.',
  observations: [
    obs('wx-1', 'weather', 'Wind advisory — 25 mph sustained', 'LOW',
      { windSpeedMph: 25, properties: { windSpeedMph: 25 } }, 0),
    obs('wx-2', 'weather', 'Wind warning — 45 mph sustained', 'MEDIUM',
      { windSpeedMph: 45, properties: { windSpeedMph: 45 } }, 2),
    obs('wx-3', 'weather', 'High wind watch — 70 mph gusts', 'HIGH',
      { windSpeedMph: 70, properties: { windSpeedMph: 70 } }, 4),
    obs('wx-4', 'weather', 'Hurricane-force emergency — 95 mph sustained', 'CRITICAL',
      { windSpeedMph: 95, properties: { windSpeedMph: 95 } }, 6),
  ],
  knownOutcomes: [
    { observationId: 'wx-1', actualSeverity: 'low', wasActedOn: false },
    { observationId: 'wx-2', actualSeverity: 'medium', wasActedOn: true },
    { observationId: 'wx-3', actualSeverity: 'high', wasActedOn: true },
    { observationId: 'wx-4', actualSeverity: 'critical', wasActedOn: true },
  ],
};

// ── 3. Maritime incident ──────────────────────────────────────────────

const maritimeIncident: BacktestScenario = {
  id: 'maritime-incident',
  name: 'Maritime incident',
  description:
    '3 maritime observations of escalating severity: normal transit, an AIS gap, and a confirmed distress beacon. Tests that vessel-count-only drivers don\'t inflate routine transits and that downstream chokepoint signals push beacon events to critical.',
  observations: [
    obs('mar-1', 'maritime', 'Routine cargo transit — Singapore strait', 'LOW',
      {
        vesselCount: 3,
        affectedVessels: 3,
        cargoValueUsdM: 12,
        chokepointProximityKm: 25,
      }, 0),
    obs('mar-2', 'maritime', 'AIS coverage gap — 7 vessels affected', 'MEDIUM',
      {
        vesselCount: 7,
        affectedVessels: 7,
        cargoValueUsdM: 80,
        chokepointProximityKm: 5,
      }, 1),
    obs('mar-3', 'maritime', 'Emergency beacon — tanker in Bab-el-Mandeb', 'CRITICAL',
      {
        vesselCount: 18,
        affectedVessels: 18,
        cargoValueUsdM: 320,
        chokepointProximityKm: 0,
      }, 2),
  ],
  knownOutcomes: [
    { observationId: 'mar-1', actualSeverity: 'low', wasActedOn: false },
    { observationId: 'mar-2', actualSeverity: 'medium', wasActedOn: true },
    { observationId: 'mar-3', actualSeverity: 'critical', wasActedOn: true },
  ],
};

// ── 4. Mixed-domain noise ─────────────────────────────────────────────

const mixedDomainNoise: BacktestScenario = {
  id: 'mixed-domain-noise',
  name: 'Mixed-domain noise',
  description:
    '6 medium-severity observations across 4 domains, all dismissed by the user. Tests that driver scoring stays in the low/medium band for moderate inputs and does not over-inflate routine background noise into actionable alerts.',
  observations: [
    obs('mix-1', 'earthquake', 'M4.2 — Aleutians', 'MEDIUM',
      { magnitude: 4.2, properties: { mag: 4.2 } }, 0),
    obs('mix-2', 'weather', 'Gusty winds — 30 mph', 'MEDIUM',
      { windSpeedMph: 30, properties: { windSpeedMph: 30 } }, 1),
    obs('mix-3', 'space-weather', 'Kp 4 — minor storm', 'MEDIUM',
      { kpIndex: 4, kp: 4 }, 2),
    obs('mix-4', 'wildfire', '50-acre containment burn', 'MEDIUM',
      { acres: 50, containmentPercent: 80 }, 3),
    obs('mix-5', 'earthquake', 'M4.4 — Greece', 'MEDIUM',
      { magnitude: 4.4, properties: { mag: 4.4 } }, 4),
    obs('mix-6', 'weather', '35 mph gusts inland', 'MEDIUM',
      { windSpeedMph: 35, properties: { windSpeedMph: 35 } }, 5),
  ],
  knownOutcomes: [
    { observationId: 'mix-1', actualSeverity: 'medium', wasActedOn: false },
    { observationId: 'mix-2', actualSeverity: 'medium', wasActedOn: false },
    { observationId: 'mix-3', actualSeverity: 'medium', wasActedOn: false },
    { observationId: 'mix-4', actualSeverity: 'medium', wasActedOn: false },
    { observationId: 'mix-5', actualSeverity: 'medium', wasActedOn: false },
    { observationId: 'mix-6', actualSeverity: 'medium', wasActedOn: false },
  ],
};

// ── Exports ───────────────────────────────────────────────────────────

export const BUILT_IN_BACKTEST_SCENARIOS: readonly BacktestScenario[] = [
  pacificEarthquakeCluster,
  weatherEscalation,
  maritimeIncident,
  mixedDomainNoise,
];

export function getBuiltInScenarios(): BacktestScenario[] {
  // Defensive copy so callers can mutate without polluting the
  // module-level fixtures.
  return BUILT_IN_BACKTEST_SCENARIOS.map((s) => ({
    ...s,
    observations: s.observations.map((o) => ({ ...o, raw: { ...(o.raw as Record<string, unknown>) }, entityIds: [...o.entityIds], tags: [...o.tags] })),
    knownOutcomes: s.knownOutcomes.map((k) => ({ ...k })),
  }));
}

export function getBuiltInScenario(id: string): BacktestScenario | undefined {
  return getBuiltInScenarios().find((s) => s.id === id);
}
