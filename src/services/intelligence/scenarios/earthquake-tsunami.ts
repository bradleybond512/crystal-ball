/**
 * Scenario: M7.8 offshore earthquake → DART buoy anomaly → PTWC tsunami alert.
 *
 * Tests cross-domain situation handling: the seismic and ocean signals must
 * each create independent situations (different `domain` values), and the
 * downstream PTWC bulletin should land as its own CRITICAL alert.
 */
import type { ScenarioFixture } from '../scenario-replay';

const T0 = Date.parse('2026-05-12T11:23:00Z');

// Roughly the Tohoku source region — fixed for reproducibility.
const EPICENTER = { lat: 38.32, lon: 142.37, radiusKm: 35 };

export const EARTHQUAKE_TSUNAMI: ScenarioFixture = {
  id: 'earthquake-tsunami',
  name: 'Offshore quake + tsunami cascade',
  description:
    'USGS M7.8 offshore earthquake, followed within 8 minutes by an anomalous DART buoy reading and a Pacific Tsunami Warning Center bulletin. Verifies the cascade chain seismic → ocean → weather creates the right per-domain situations and CRITICAL alerts.',
  startTime: T0,
  events: [
    {
      id: 'usgs-m78-tohoku',
      sourceId: 'usgs-earthquake',
      domain: 'earthquake',
      offsetMs: 0,
      severity: 'CRITICAL',
      title: 'M7.8 earthquake — offshore Tohoku, Japan',
      location: EPICENTER,
      entityIds: ['JP'],
      tags: ['earthquake', 'magnitude-7', 'offshore', 'tsunami-risk'],
    },
    {
      id: 'dart-21413-anomaly',
      sourceId: 'noaa-dart',
      domain: 'ocean',
      offsetMs: 6 * 60 * 1000,
      severity: 'HIGH',
      title: 'DART buoy 21413 — anomalous deep-ocean pressure surge',
      location: { lat: 30.51, lon: 152.12, radiusKm: 1 },
      entityIds: ['DART-21413'],
      tags: ['dart', 'tsunami-precursor'],
    },
    {
      id: 'ptwc-tsunami-bulletin',
      sourceId: 'ptwc',
      domain: 'weather',
      offsetMs: 8 * 60 * 1000,
      severity: 'CRITICAL',
      title: 'PTWC Tsunami Warning — Pacific basin',
      location: { lat: 35, lon: 145, radiusKm: 2000 },
      entityIds: ['JP', 'US-HI'],
      tags: ['tsunami', 'warning', 'ptwc'],
    },
  ],
  expectedAlerts: [
    { domain: 'earthquake', severity: 'CRITICAL', titleContains: 'M7.8 earthquake' },
    { domain: 'ocean', severity: 'HIGH', titleContains: 'DART buoy' },
    { domain: 'weather', severity: 'CRITICAL', titleContains: 'Tsunami Warning' },
  ],
  expectedSituations: [
    { domain: 'earthquake', titleContains: 'M7.8 earthquake' },
    { domain: 'weather', titleContains: 'Tsunami Warning' },
  ],
};
