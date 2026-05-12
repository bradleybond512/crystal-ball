/**
 * Scenario: ACLED event at a major port + supply-chain stress + commodity risk.
 *
 * Tests the three-domain (conflict / supply-chain / commodity) chain that
 * fires when a chokepoint port becomes inoperable. Each step lands as a
 * HIGH-or-better alert and each domain seeds its own situation.
 */
import type { ScenarioFixture } from '../scenario-replay';

const T0 = Date.parse('2026-05-12T08:00:00Z');

const PORT = { lat: 26.6, lon: 56.4, radiusKm: 25 };

export const PORT_CLOSURE_SHORTAGE: ScenarioFixture = {
  id: 'port-closure-shortage',
  name: 'Chokepoint port closure cascade',
  description:
    'An ACLED violent-event marker lands at a Hormuz-area port, the supply-chain stress score spikes within 90 minutes, and a commodity (Brent) risk re-rate follows. Verifies that the three domains all produce alerts and that conflict → supply-chain → commodity creates the right situation per domain.',
  startTime: T0,
  events: [
    {
      id: 'acled-bandar-abbas-strike',
      sourceId: 'acled',
      domain: 'conflict',
      offsetMs: 0,
      severity: 'CRITICAL',
      title: 'ACLED: explosion at Bandar Abbas port terminal',
      location: PORT,
      entityIds: ['IR', 'BANDAR-ABBAS'],
      tags: ['acled', 'explosion', 'chokepoint'],
    },
    {
      id: 'supply-chain-stress-hormuz',
      sourceId: 'supply-chain-tracker',
      domain: 'supply-chain',
      offsetMs: 95 * 60 * 1000,
      severity: 'HIGH',
      title: 'Hormuz transit stress score elevated — vessel diversions detected',
      location: { lat: 26.5, lon: 56.5, radiusKm: 80 },
      entityIds: ['HORMUZ'],
      tags: ['stress', 'diversion', 'hormuz'],
    },
    {
      id: 'commodity-brent-rerate',
      sourceId: 'shortage-engine',
      domain: 'commodity',
      offsetMs: 180 * 60 * 1000,
      severity: 'HIGH',
      title: 'Brent crude shortage risk re-rated to HIGH — Hormuz transit at risk',
      entityIds: ['BRENT'],
      tags: ['commodity', 'oil', 'shortage-risk'],
    },
  ],
  expectedAlerts: [
    { domain: 'conflict', severity: 'CRITICAL', titleContains: 'Bandar Abbas' },
    { domain: 'supply-chain', severity: 'HIGH', titleContains: 'Hormuz transit stress' },
    { domain: 'commodity', severity: 'HIGH', titleContains: 'Brent crude shortage' },
  ],
  expectedSituations: [
    { domain: 'conflict', titleContains: 'Bandar Abbas' },
    { domain: 'supply-chain', titleContains: 'Hormuz transit stress' },
    { domain: 'commodity', titleContains: 'Brent crude shortage' },
  ],
};
