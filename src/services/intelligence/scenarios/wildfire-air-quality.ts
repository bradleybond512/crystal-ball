/**
 * Scenario: NIFC active wildfire + PurpleAir PM2.5 spike + NWS red-flag warning.
 *
 * Verifies the cross-domain wildfire / air-quality / weather chain — three
 * domains, three situations, all anchored on roughly the same incident
 * footprint.
 */
import type { ScenarioFixture } from '../scenario-replay';

const T0 = Date.parse('2026-05-12T17:00:00Z');

const FIRE_CENTER = { lat: 39.55, lon: -120.42, radiusKm: 12 };

export const WILDFIRE_AIR_QUALITY: ScenarioFixture = {
  id: 'wildfire-air-quality',
  name: 'Wildfire + air quality cascade',
  description:
    'NIFC marks a wildfire active, PurpleAir sensors downwind report PM2.5 above 150 within 90 minutes, and an NWS red-flag warning lands shortly after. Exercises the three-domain (wildfire / air-quality / weather) cascade with overlapping footprints.',
  startTime: T0,
  events: [
    {
      id: 'nifc-fire-bear-creek',
      sourceId: 'nifc-active-fires',
      domain: 'wildfire',
      offsetMs: 0,
      severity: 'HIGH',
      title: 'NIFC: Bear Creek fire — 4500 ac active, 0% contained',
      location: FIRE_CENTER,
      entityIds: ['US-CA', 'BEAR-CREEK-FIRE'],
      tags: ['wildfire', 'nifc', 'uncontained'],
    },
    {
      id: 'purpleair-pm25-spike-152',
      sourceId: 'purpleair',
      domain: 'air-quality',
      offsetMs: 95 * 60 * 1000,
      severity: 'HIGH',
      title: 'PurpleAir: PM2.5 152 µg/m³ — unhealthy, downwind of Bear Creek',
      location: { lat: 39.6, lon: -120.2, radiusKm: 25 },
      entityIds: ['US-CA'],
      tags: ['pm25', 'unhealthy', 'wildfire-smoke'],
    },
    {
      id: 'nws-red-flag-norcal',
      sourceId: 'nws-cap-feed',
      domain: 'weather',
      offsetMs: 120 * 60 * 1000,
      severity: 'HIGH',
      title: 'NWS Red Flag Warning — Northern California',
      location: { lat: 39.6, lon: -120.4, radiusKm: 120 },
      entityIds: ['US-CA'],
      tags: ['red-flag', 'fire-weather'],
    },
  ],
  expectedAlerts: [
    { domain: 'wildfire', severity: 'HIGH', titleContains: 'Bear Creek fire' },
    { domain: 'air-quality', severity: 'HIGH', titleContains: 'PM2.5 152' },
    { domain: 'weather', severity: 'HIGH', titleContains: 'Red Flag Warning' },
  ],
  expectedSituations: [
    { domain: 'wildfire', titleContains: 'Bear Creek fire' },
    { domain: 'air-quality', titleContains: 'PM2.5 152' },
    { domain: 'weather', titleContains: 'Red Flag Warning' },
  ],
};
