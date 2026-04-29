/**
 * Endpoint-specific fixtures for the fixture-backed panel smoke harness.
 *
 * Keyed by panel id. Each entry installs realistic-looking JSON
 * responses on the URL substrings the panel fetches, so the panel
 * mounts into a *rendered* state (not just `degraded`) and we prove
 * meaningful UI output for the most important panels.
 *
 * Plan: docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md P5.
 */

import { installFixture } from './fixture-store.mts';

export interface PanelFixtureBundle {
  /** Function that registers all fixtures for this panel via installFixture(). */
  install: () => void;
}

const NOW_S = Math.floor(Date.now() / 1000);
const NOW_MS = Date.now();

export const PANEL_FIXTURES: Record<string, PanelFixtureBundle> = {
  'national-debt': {
    install: () => {
      installFixture('/api/national-debt', {
        countries: [
          { code: 'JPN', name: 'Japan', debtPctGdp: 263.1, year: '2024' },
          { code: 'GRC', name: 'Greece', debtPctGdp: 168.8, year: '2024' },
          { code: 'ITA', name: 'Italy', debtPctGdp: 144.7, year: '2024' },
          { code: 'USA', name: 'United States', debtPctGdp: 123.0, year: '2024' },
        ],
        updatedAt: NOW_MS,
      });
    },
  },

  'fear-greed': {
    install: () => {
      installFixture('/api/fear-greed', {
        score: 47,
        classification: 'Neutral',
        history: [
          { value: 50, timestamp: '2026-04-22' },
          { value: 48, timestamp: '2026-04-23' },
          { value: 45, timestamp: '2026-04-24' },
          { value: 47, timestamp: '2026-04-25' },
          { value: 47, timestamp: '2026-04-26' },
        ],
        updatedAt: NOW_S,
      });
    },
  },

  'fuel-prices': {
    install: () => {
      installFixture('/api/fuel-prices', {
        regions: [
          { name: 'U.S. Average', gasolineUsd: 3.42, dieselUsd: 3.91, period: '2026-04-21' },
          { name: 'Midwest', gasolineUsd: 3.27, dieselUsd: 3.85, period: '2026-04-21' },
          { name: 'West Coast', gasolineUsd: 4.71, dieselUsd: 4.62, period: '2026-04-21' },
        ],
        keyMissing: false,
        updatedAt: NOW_MS,
      });
    },
  },

  'faa-weather-cams': {
    install: () => {
      installFixture('/api/faa-cameras', {
        cameras: [
          {
            id: 'KSEA-CAM-1',
            name: 'Seattle-Tacoma Approach',
            lat: 47.45,
            lon: -122.31,
            state: 'WA',
            category: 'urban',
            imageUrl: 'https://example.test/cam1.jpg',
            isOnline: true,
            lastUpdated: new Date(NOW_MS).toISOString(),
          },
          {
            id: 'PADQ-CAM-2',
            name: 'Kodiak Remote',
            lat: 57.75,
            lon: -152.49,
            state: 'AK',
            category: 'remote',
            imageUrl: 'https://example.test/cam2.jpg',
            isOnline: true,
            lastUpdated: new Date(NOW_MS).toISOString(),
          },
        ],
      });
    },
  },

  'gdelt-intel': {
    install: () => {
      installFixture('/api/gdelt-intel', {
        events: [
          {
            title: 'Diplomatic talks resume in Vienna',
            url: 'https://example.test/news/1',
            source: 'Reuters',
            tone: -1.2,
            country: 'United States',
            timestamp: NOW_MS,
          },
          {
            title: 'Energy markets steady after weekend',
            url: 'https://example.test/news/2',
            source: 'AP',
            tone: 0.4,
            country: 'United States',
            timestamp: NOW_MS - 3_600_000,
          },
          {
            title: 'Cyber advisory issued for critical infrastructure',
            url: 'https://example.test/news/3',
            source: 'CISA',
            tone: -3.5,
            country: 'United States',
            timestamp: NOW_MS - 7_200_000,
          },
        ],
        updatedAt: NOW_S,
      });
    },
  },

  'live-news': {
    install: () => {
      installFixture('/api/news', {
        items: [
          {
            id: 'n1',
            title: 'Markets close mixed on tech earnings',
            url: 'https://example.test/n1',
            source: 'Reuters',
            publishedAt: NOW_MS,
            summary: 'Major indices ended with modest gains.',
          },
          {
            id: 'n2',
            title: 'Severe weather watch for upper Midwest',
            url: 'https://example.test/n2',
            source: 'NWS',
            publishedAt: NOW_MS - 1_800_000,
            summary: 'Watch in effect through Wednesday afternoon.',
          },
        ],
        updatedAt: NOW_MS,
      });
    },
  },

  'service-status': {
    install: () => {
      installFixture('/api/service-status', {
        success: true,
        timestamp: new Date(NOW_MS).toISOString(),
        services: [
          { name: 'Cloudflare', status: 'operational', category: 'infrastructure' },
          { name: 'AWS us-east-1', status: 'operational', category: 'cloud' },
          { name: 'GitHub', status: 'operational', category: 'developer' },
        ],
        summary: { operational: 3, degraded: 0, outage: 0, unknown: 0 },
      });
    },
  },

  'internet-disruptions': {
    install: () => {
      // Panel actually fetches /api/comms-health (not /internet-disruptions).
      installFixture('/api/comms-health', {
        overall: 'normal',
        bgp: { hijacks: 0, leaks: 1, severity: 'normal' },
        ixp: { status: 'operational', degraded: [] },
        ddos: { l7: 'normal', l3: 'normal', cloudflareKeyMissing: false },
        cables: { degraded: [], normal: ['Atlantic-Crossing-1', 'TPE'] },
        updatedAt: new Date(NOW_MS).toISOString(),
      });
    },
  },

  'shortage-radar': {
    install: () => {
      // Shortage Radar reads in-memory commodity inputs from
      // panel.setRequests() rather than fetching, so an empty
      // fixture pass leaves the panel showing its built-in
      // 'no data' state. The harness mounts it via the smoke
      // factory which doesn't call setRequests — degraded is the
      // documented contract here, not rendered.
      // No fixtures.
    },
  },

  'nws-alerts': {
    install: () => {
      // NWSAlertsPanel doesn't fetch — alerts are pushed via update().
      // Like shortage-radar, the documented contract under the smoke
      // factory is degraded (loading banner). The fixture entry is
      // kept here for future integration tests that drive update()
      // directly. Listed in the SETRESQUEST_ONLY exception set.
    },
  },
};

export function listFixtureBackedPanelIds(): string[] {
  return Object.keys(PANEL_FIXTURES).sort();
}
