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
  /** Function that registers all fixtures for this panel via installFixture().
   *  Use for self-fetch panels whose constructor calls fetch(). */
  install: () => void;
  /** Optional direct-update path for data-loader-driven panels: the
   *  test mounts the panel, then calls this with the panel instance
   *  to push fixture data via update() / setData() / similar. Use
   *  when the panel's constructor doesn't fetch and waits for the
   *  data loader. The function is async because some panels expose
   *  async update methods. */
  directUpdate?: (panel: unknown) => Promise<void> | void;
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
    install: () => { /* fed via update() — see directUpdate */ },
    directUpdate: async (panel) => {
      const p = panel as { update: (alerts: unknown[]) => void };
      p.update([
        {
          id: 'NWS.IND.123',
          event: 'Severe Thunderstorm Watch',
          severity: 'Severe',
          urgency: 'Expected',
          areaDesc: 'La Porte; St. Joseph',
          headline: 'Severe Thunderstorm Watch in effect',
          onset: new Date(NOW_MS).toISOString(),
        },
      ]);
    },
  },

  // ── Data-loader-driven panels: directUpdate drives panel.update(...) ──

  'gdacs-alerts': {
    install: () => { /* fed via update() */ },
    directUpdate: async (panel) => {
      const p = panel as { update: (events: unknown[]) => void };
      p.update([
        {
          id: 'gdacs-EQ-1234',
          eventType: 'EQ',
          name: 'Magnitude 6.2 earthquake — northern Honshu',
          alertLevel: 'Orange',
          country: 'Japan',
          coordinates: [141.5, 38.5],
          fromDate: new Date(NOW_MS - 3_600_000),
        },
      ]);
    },
  },

  'earthquakes': {
    install: () => { /* fed via update() */ },
    directUpdate: async (panel) => {
      const p = panel as { update: (quakes: unknown[]) => void };
      p.update([
        {
          id: 'us7000abcd',
          magnitude: 5.4,
          place: '120 km E of Tokyo, Japan',
          lat: 35.7,
          lon: 141.2,
          depthKm: 35,
          time: new Date(NOW_MS - 1_800_000).toISOString(),
          tsunami: false,
        },
      ]);
    },
  },

  'air-quality': {
    install: () => { /* fed via update() */ },
    directUpdate: async (panel) => {
      const p = panel as { update: (readings: unknown[]) => void };
      p.update([
        {
          city: 'La Porte',
          country: 'US',
          aqi: 47,
          aqiLevel: 'good',
          pm25: 11.4,
          pm10: 18.2,
          o3: null,
          measuredAt: new Date(NOW_MS).toISOString(),
        },
        {
          city: 'Chicago',
          country: 'US',
          aqi: 72,
          aqiLevel: 'moderate',
          pm25: 24.6,
          pm10: 31.0,
          o3: null,
          measuredAt: new Date(NOW_MS).toISOString(),
        },
      ]);
    },
  },

  'space-weather': {
    install: () => { /* fed via update() */ },
    directUpdate: async (panel) => {
      const p = panel as { update: (data: unknown) => void };
      p.update({
        kpIndex: 3,
        kpClass: 'unsettled',
        solarWindSpeed: 410,
        solarWindDensity: 5.2,
        bz: -1.5,
        xrayClass: 'B5.2',
        // Include at least one alert so the panel doesn't render the
        // 'No active alerts' sub-banner (which uses .panel-empty and
        // would trip the smoke classifier).
        alertMessages: [
          {
            id: 'sw-watch-1',
            message: 'G1 (Minor) Geomagnetic Storm Watch',
            issuedAt: new Date(NOW_MS - 30 * 60 * 1000),
            severity: 'watch',
          },
        ],
        donkiEvents: [],
        fetchedAt: new Date(NOW_MS),
      });
    },
  },

  'humanitarian-crisis': {
    install: () => { /* fed via update() */ },
    directUpdate: async (panel) => {
      const p = panel as { update: (crises: unknown[]) => void };
      p.update([
        {
          id: 'unhcr-1',
          country: 'Sudan',
          countryCode: 'SD',
          crisisType: 'displacement',
          severity: 'critical',
          title: 'Internally displaced population from ongoing conflict',
          url: 'https://example.test/r/1',
          updatedAt: new Date(NOW_MS - 86_400_000),
        },
      ]);
    },
  },
};

export function listFixtureBackedPanelIds(): string[] {
  return Object.keys(PANEL_FIXTURES).sort();
}
