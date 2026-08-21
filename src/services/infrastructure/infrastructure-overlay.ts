/**
 * Infrastructure overlay data layer — converts the OutageSummary,
 * RadSummary, and BgpSummary types from grid-monitor.ts into overlay
 * descriptors a renderer (Cesium, MapLibre/DeckGL, or DOM SVG) can
 * draw without doing any logic of its own.
 *
 * Pure: no DOM, no fetch. The renderer-side wiring picks the rows up
 * via the loader and hands them to the canvas / banner.
 */

import { activeBgpEvents, isRadSummaryFresh } from './grid-monitor';
import type {
  OutageSummary,
  RadSummary,
  BgpSummary,
  Severity,
} from './grid-monitor';

// ─── Color ladder ────────────────────────────────────────────────────

export const SEVERITY_COLORS: Readonly<Record<Severity, string>> = {
  normal: '#22c55e',   // green
  elevated: '#facc15', // yellow
  high: '#fb923c',     // orange
  major: '#f87171',    // red
  extreme: '#dc2626',  // deep red
};

export const SEVERITY_OPACITIES: Readonly<Record<Severity, number>> = {
  normal: 0.18,
  elevated: 0.32,
  high: 0.42,
  major: 0.55,
  extreme: 0.7,
};

// ─── Outage overlay compatibility ───────────────────────────────────

/** Two-letter US state/territory code → centroid (lat, lon). Built so
 *  the choropleth/dot overlay can render even when no GeoJSON polygon
 *  asset is bundled. Centroids are well-known geographic centers. */
export const US_STATE_CENTROIDS: Readonly<Record<string, { lat: number; lon: number }>> = {
  AL: { lat: 32.806_671, lon: -86.791_13 },
  AK: { lat: 64.200_842, lon: -149.493_67 },
  AZ: { lat: 34.048_928, lon: -111.093_731 },
  AR: { lat: 34.969_704, lon: -92.373_123 },
  CA: { lat: 36.778_259, lon: -119.417_931 },
  CO: { lat: 39.550_051, lon: -105.782_067 },
  CT: { lat: 41.603_221, lon: -73.087_749 },
  DE: { lat: 38.910_833, lon: -75.527_67 },
  DC: { lat: 38.905_985, lon: -77.033_418 },
  FL: { lat: 27.664_827, lon: -81.515_754 },
  GA: { lat: 32.165_622, lon: -82.900_075 },
  HI: { lat: 19.898_682, lon: -155.665_857 },
  ID: { lat: 44.068_202, lon: -114.742_043 },
  IL: { lat: 40.633_125, lon: -89.398_528 },
  IN: { lat: 40.267_194, lon: -86.134_902 },
  IA: { lat: 41.878_003, lon: -93.097_702 },
  KS: { lat: 39.011_902, lon: -98.484_246 },
  KY: { lat: 37.839_333, lon: -84.270_02 },
  LA: { lat: 31.244_823, lon: -92.145_024 },
  ME: { lat: 45.253_783, lon: -69.445_469 },
  MD: { lat: 39.045_755, lon: -76.641_271 },
  MA: { lat: 42.407_211, lon: -71.382_438 },
  MI: { lat: 44.314_844, lon: -85.602_364 },
  MN: { lat: 46.729_553, lon: -94.6859 },
  MS: { lat: 32.354_668, lon: -89.398_528 },
  MO: { lat: 37.964_253, lon: -91.831_833 },
  MT: { lat: 46.879_682, lon: -110.362_566 },
  NE: { lat: 41.492_537, lon: -99.901_813 },
  NV: { lat: 38.802_61, lon: -116.419_389 },
  NH: { lat: 43.193_852, lon: -71.572_395 },
  NJ: { lat: 40.058_324, lon: -74.405_661 },
  NM: { lat: 34.519_94, lon: -105.870_09 },
  NY: { lat: 43.299_428, lon: -74.217_933 },
  NC: { lat: 35.759_573, lon: -79.0193 },
  ND: { lat: 47.551_493, lon: -101.002_012 },
  OH: { lat: 40.417_287, lon: -82.907_123 },
  OK: { lat: 35.467_56, lon: -97.516_428 },
  OR: { lat: 43.804_133, lon: -120.554_201 },
  PA: { lat: 41.203_322, lon: -77.194_525 },
  RI: { lat: 41.580_095, lon: -71.477_429 },
  SC: { lat: 33.836_082, lon: -81.163_727 },
  SD: { lat: 43.969_515, lon: -99.901_813 },
  TN: { lat: 35.517_491, lon: -86.580_447 },
  TX: { lat: 31.968_599, lon: -99.901_813 },
  UT: { lat: 39.320_981, lon: -111.093_731 },
  VT: { lat: 44.558_803, lon: -72.577_841 },
  VA: { lat: 37.431_573, lon: -78.656_894 },
  WA: { lat: 47.751_074, lon: -120.740_139 },
  WV: { lat: 38.597_626, lon: -80.454_903 },
  WI: { lat: 43.784_44, lon: -88.787_868 },
  WY: { lat: 43.075_968, lon: -107.290_284 },
  PR: { lat: 18.220_833, lon: -66.590_149 },
};

export interface OutageOverlayRow {
  state: string;
  lat: number;
  lon: number;
  customersAffected: number;
  countyCount: number;
  severity: Severity;
  fillColorHex: string;
  fillOpacity: number;
  /** Pixel radius for renderers that want a sized dot. Scales with
   *  severity 6 → 22 px. Choropleth renderers ignore this. */
  radiusPx: number;
  topCounty: string | null;
}

/**
 * ODIN context is scoped to one exact county and currently carries no
 * geometry. Promoting it to a state centroid would visually imply statewide
 * coverage, so the legacy state-overlay bridge intentionally emits nothing.
 */
export function outagesToStateOverlay(summary: OutageSummary | null): OutageOverlayRow[] {
  const rows: OutageOverlayRow[] = [];
  if (summary) rows.length = 0;
  return rows;
}

// ─── Radiation hotspots ──────────────────────────────────────────────

export interface RadHotspotRow {
  name: string;
  lat: number;
  lon: number;
  cpm: number;
  severity: Severity;
  pulseColorHex: string;
  /** Animation period (ms) — faster pulse = more severe. */
  pulsePeriodMs: number;
  state: string | null;
}

const PULSE_PERIODS: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 1800,
  high: 1200,
  major: 800,
  extreme: 500,
};

export function radiationToHotspots(summary: RadSummary | null, now = Date.now()): RadHotspotRow[] {
  if (!summary || !isRadSummaryFresh(summary, now)) return [];
  const out: RadHotspotRow[] = [];
  for (const s of summary.elevatedStations) {
    if (s.lat === null || s.lon === null || s.cpm === null) continue;
    if (!Number.isFinite(s.lat) || s.lat < -90 || s.lat > 90) continue;
    if (!Number.isFinite(s.lon) || s.lon < -180 || s.lon > 180) continue;
    if (!Number.isFinite(s.cpm) || s.cpm < 0) continue;
    if (s.severity === 'normal') continue;
    out.push({
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      cpm: s.cpm,
      severity: s.severity,
      pulseColorHex: SEVERITY_COLORS[s.severity],
      pulsePeriodMs: PULSE_PERIODS[s.severity],
      state: s.state,
    });
  }
  out.sort((a, b) => b.cpm - a.cpm);
  return out;
}

// ─── BGP banner ──────────────────────────────────────────────────────

export interface BgpBannerState {
  visible: boolean;
  severity: 'critical' | 'elevated' | 'none';
  message: string;
  /** Up to 3 short event descriptors for tooltip / detail view. */
  criticalEvents: readonly {
    prefix: string;
    expectedAsn: string | null;
    detectedAsns: string[];
    tags: string[];
  }[];
}

/**
 * Decide whether the BGP alert banner should be visible. Visible only
 * when at least one critical event exists OR (≥3 elevated events all
 * carrying a known-prefix tag). The message names the most-affected
 * tag (e.g. "Cloudflare DNS hijack — 2 events").
 */
export function bgpToBanner(summary: BgpSummary | null, now = Date.now()): BgpBannerState {
  const currentEvents = activeBgpEvents(summary, now);
  if (currentEvents.length === 0) {
    return { visible: false, severity: 'none', message: '', criticalEvents: [] };
  }
  const critical = currentEvents.filter((e) => e.severity === 'critical');
  const elevatedTagged = currentEvents.filter((e) => e.severity === 'elevated' && e.tags.length > 0);
  if (critical.length === 0 && elevatedTagged.length < 3) {
    return { visible: false, severity: 'none', message: '', criticalEvents: [] };
  }

  const sourceEvents = critical.length > 0 ? critical : elevatedTagged;
  const tagCounts = new Map<string, number>();
  for (const e of sourceEvents) {
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const tagLabel = topTag ? prettyTag(topTag[0]) : 'major prefix';

  const eventsForTooltip = sourceEvents.slice(0, 3).map((e) => ({
    prefix: e.prefixes[0] ?? '—',
    expectedAsn: e.expectedOriginAsn,
    detectedAsns: [...e.detectedOriginAsns],
    tags: [...e.tags],
  }));

  if (critical.length > 0) {
    return {
      visible: true,
      severity: 'critical',
      message: `BGP hijack on ${tagLabel} — ${critical.length} critical event${critical.length === 1 ? '' : 's'} active`,
      criticalEvents: eventsForTooltip,
    };
  }
  return {
    visible: true,
    severity: 'elevated',
    message: `Elevated BGP anomalies on ${tagLabel} — ${elevatedTagged.length} events`,
    criticalEvents: eventsForTooltip,
  };
}

function prettyTag(tag: string): string {
  switch (tag) {
    case 'google-dns': { return 'Google DNS';
    }
    case 'cloudflare-dns': { return 'Cloudflare DNS';
    }
    case 'quad9-dns': { return 'Quad9 DNS';
    }
    case 'opendns': { return 'OpenDNS';
    }
    case 'azure-cdn': { return 'Azure CDN';
    }
    case 'cloudfront': { return 'CloudFront';
    }
    case 'fastly': { return 'Fastly';
    }
    default: { return tag;
    }
  }
}
