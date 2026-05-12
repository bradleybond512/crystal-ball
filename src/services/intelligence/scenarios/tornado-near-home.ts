/**
 * Scenario: NWS tornado warning within 50 km of a saved place.
 *
 * Mirrors the 2024 La Porte IN tornado event the user's profile references.
 * The detector should auto-create a `weather` situation off the CRITICAL
 * tornado warning; the SPC mesoscale and severe wind observations corroborate
 * but stay at HIGH severity.
 */
import type { ScenarioFixture } from '../scenario-replay';

// Anchored timestamp — fixed so replays are bit-for-bit reproducible.
const T0 = Date.parse('2026-05-12T19:00:00Z');

const TORNADO_CENTER = { lat: 41.61, lon: -86.72, radiusKm: 8 };

export const TORNADO_NEAR_HOME: ScenarioFixture = {
  id: 'tornado-near-home',
  name: 'Tornado near saved place',
  description:
    'NWS tornado warning + SPC mesoscale discussion + severe wind report converging within 50 km of a saved place. Verifies the high-severity weather alert auto-creates a situation and that the supporting observations correlate to the same domain.',
  startTime: T0,
  events: [
    {
      id: 'spc-md-0312',
      sourceId: 'spc-mesoscale',
      domain: 'weather',
      offsetMs: 0,
      severity: 'MEDIUM',
      title: 'SPC Mesoscale Discussion #312 — supercell potential, northern IN',
      location: { lat: 41.5, lon: -86.5, radiusKm: 60 },
      entityIds: ['US-IN'],
      tags: ['mesoscale', 'supercell-potential'],
    },
    {
      id: 'nws-tor-warn-laporte',
      sourceId: 'nws-cap-feed',
      domain: 'weather',
      offsetMs: 35 * 60 * 1000,
      severity: 'CRITICAL',
      title: 'NWS Tornado Warning — La Porte County IN',
      location: TORNADO_CENTER,
      entityIds: ['US-IN', 'LAPORTE-IN'],
      tags: ['tornado', 'warning', 'cap'],
    },
    {
      id: 'lsr-severe-wind-laporte',
      sourceId: 'nws-lsr',
      domain: 'weather',
      offsetMs: 47 * 60 * 1000,
      severity: 'HIGH',
      title: 'Severe wind report 78 mph near La Porte airport',
      location: { lat: 41.57, lon: -86.74, radiusKm: 3 },
      entityIds: ['US-IN', 'LAPORTE-IN'],
      tags: ['severe-wind', 'lsr'],
    },
  ],
  expectedAlerts: [
    { domain: 'weather', severity: 'CRITICAL', titleContains: 'Tornado Warning' },
    { domain: 'weather', severity: 'HIGH', titleContains: 'severe wind' },
  ],
  expectedSituations: [
    { domain: 'weather', titleContains: 'Tornado Warning' },
  ],
};
