/**
 * Scenario: CISA KEV cluster + BGP route anomaly + infrastructure alert.
 *
 * Three independent inputs that, together, are characteristic of an in-
 * progress cyber incident. The replay verifies that each lands as the
 * expected CRITICAL/HIGH alert and that a `cyber` situation is created
 * off the KEV burst (highest-severity event of the three).
 */
import type { ScenarioFixture } from '../scenario-replay';

const T0 = Date.parse('2026-05-12T14:30:00Z');

export const CYBER_INCIDENT: ScenarioFixture = {
  id: 'cyber-incident',
  name: 'Cyber incident cluster',
  description:
    'Three new CISA KEV criticals land in a 30-minute window, a major BGP route flap is observed for a Tier-1 provider, and an infrastructure alert correlates the two. Verifies the cyber + infrastructure cross-domain situation chain.',
  startTime: T0,
  events: [
    {
      id: 'cisa-kev-cve-2026-13371',
      sourceId: 'cisa-kev',
      domain: 'cyber',
      offsetMs: 0,
      severity: 'CRITICAL',
      title: 'CISA KEV: CVE-2026-13371 added — actively exploited',
      entityIds: ['CVE-2026-13371'],
      tags: ['kev', 'cve', 'critical'],
    },
    {
      id: 'cisa-kev-cve-2026-13388',
      sourceId: 'cisa-kev',
      domain: 'cyber',
      offsetMs: 12 * 60 * 1000,
      severity: 'CRITICAL',
      title: 'CISA KEV: CVE-2026-13388 added — actively exploited',
      entityIds: ['CVE-2026-13388'],
      tags: ['kev', 'cve', 'critical'],
    },
    {
      id: 'cisa-kev-cve-2026-13402',
      sourceId: 'cisa-kev',
      domain: 'cyber',
      offsetMs: 25 * 60 * 1000,
      severity: 'CRITICAL',
      title: 'CISA KEV: CVE-2026-13402 added — actively exploited',
      entityIds: ['CVE-2026-13402'],
      tags: ['kev', 'cve', 'critical'],
    },
    {
      id: 'bgp-route-flap-as7018',
      sourceId: 'ripe-stat',
      domain: 'infrastructure',
      offsetMs: 18 * 60 * 1000,
      severity: 'HIGH',
      title: 'BGP route flap detected for AS7018 — abnormal withdrawal volume',
      entityIds: ['AS7018'],
      tags: ['bgp', 'route-flap', 'tier1'],
    },
    {
      id: 'infra-alert-kev-bgp',
      sourceId: 'infrastructure-alert-bridge',
      domain: 'infrastructure',
      offsetMs: 30 * 60 * 1000,
      severity: 'HIGH',
      title: 'Infrastructure alert: cyber-KEV burst + BGP anomaly correlated',
      entityIds: ['CVE-2026-13371', 'AS7018'],
      tags: ['compound', 'cyber-infra'],
    },
  ],
  expectedAlerts: [
    { domain: 'cyber', severity: 'CRITICAL', titleContains: 'CVE-2026-13371' },
    { domain: 'cyber', severity: 'CRITICAL', titleContains: 'CVE-2026-13388' },
    { domain: 'cyber', severity: 'CRITICAL', titleContains: 'CVE-2026-13402' },
    { domain: 'infrastructure', severity: 'HIGH', titleContains: 'BGP route flap' },
    { domain: 'infrastructure', severity: 'HIGH', titleContains: 'cyber-KEV burst' },
  ],
  expectedSituations: [
    { domain: 'cyber', titleContains: 'CVE-2026-13371' },
    { domain: 'infrastructure', titleContains: 'BGP route flap' },
  ],
};
