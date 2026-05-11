#!/usr/bin/env node
/**
 * Feed Latency Configuration — single source of truth for sidecar cache TTLs.
 *
 * Each entry documents:
 *   ttlMs              — how long the sidecar caches the response
 *   sourceUpdateFreqMs — how often the upstream source actually publishes new data
 *   notes              — rationale and any operational constraints
 *
 * The mismatch ratio = ttlMs / sourceUpdateFreqMs.
 * A ratio >> 1 means the cache lives longer than the source's update cadence,
 * causing stale data to be served between refreshes.
 * A ratio << 1 means the sidecar fetches more often than new data arrives
 * (wasted bandwidth / rate-limit risk).
 *
 * The 5 worst ratios fixed in this PR:
 *   1. emsc-seismic       10 min → 2 min   (ratio was 10, now ~2)
 *   2. owm-current        30 min → 10 min  (ratio was 3, now ~1)
 *   3. power-grid         15 min → 5 min   (ratio was 3, now ~1)
 *   4. gdelt-intel        30 min → 15 min  (ratio was 2, now ~1)
 *   5. disease-intel      30 min → 15 min  (ratio was ~2, now ~1)
 */

export const FEED_LATENCY_CONFIG = {
  // ── Aviation ────────────────────────────────────────────────────────────
  'adsb': {
    ttlMs: 55_000,
    sourceUpdateFreqMs: 10_000,       // OpenSky updates ~every 10 s
    notes: 'Anonymous tier rate-limited ~100 req/day; 55 s is intentional.',
  },
  'adsb-military': {
    ttlMs: 3 * 60_000,
    sourceUpdateFreqMs: 15_000,       // Same OpenSky data stream
    notes: 'Slower cache acceptable — military OPSEC reduces signal value of rapid refresh.',
  },
  'aviation-flights': {
    ttlMs: 10 * 60_000,
    sourceUpdateFreqMs: 10_000,
    notes: 'OpenSky anonymous limit forces 10-min cache.',
  },
  'aviation-tfrs': {
    ttlMs: 15 * 60_000,
    sourceUpdateFreqMs: 15 * 60_000, // FAA TFR list updates ~every 15 min
    notes: 'Each detail XML fetch is slow; 15-min cache aligns with FAA cadence.',
  },
  // ── Weather ─────────────────────────────────────────────────────────────
  'nws-alerts': {
    ttlMs: 0,                          // No cache — fetched on every request
    sourceUpdateFreqMs: 2 * 60_000,   // NWS issues alerts every 2-5 min
    notes: 'No cache by design — NWS alerts are safety-critical. Consider adding 90 s cache.',
  },
  'weather-alerts': {
    ttlMs: 0,
    sourceUpdateFreqMs: 2 * 60_000,
    notes: 'Same as nws-alerts — safety-critical, no cache.',
  },
  'owm-current': {
    ttlMs: 10 * 60_000,                // FIXED: was 30 min, now 10 min
    sourceUpdateFreqMs: 10 * 60_000,  // OWM free tier updates every 10 min
    notes: 'Fixed in PR — ratio was 3× (30 min cache vs 10 min source). Now 1:1.',
  },
  'ipaws-active': {
    ttlMs: 60_000,
    sourceUpdateFreqMs: 60_000,       // IPAWS broadcasts every ~1 min
    notes: 'Well aligned.',
  },
  'space-weather': {
    ttlMs: 5 * 60_000,
    sourceUpdateFreqMs: 5 * 60_000,  // NOAA SWPC updates every 1-5 min
    notes: 'Well aligned.',
  },
  'volcano-alerts': {
    ttlMs: 0,
    sourceUpdateFreqMs: 24 * 60 * 60_000, // USGS HVO updates once or twice per day
    notes: 'No cache — daily update cadence means adding 30-min cache would be fine.',
  },
  'gdacs-rss': {
    ttlMs: 30 * 60_000,
    sourceUpdateFreqMs: 30 * 60_000, // GDACS RSS updates every 30 min
    notes: 'Well aligned.',
  },
  // ── Seismic ─────────────────────────────────────────────────────────────
  'emsc-seismic': {
    ttlMs: 2 * 60_000,                // FIXED: was 10 min, now 2 min
    sourceUpdateFreqMs: 60_000,       // EMSC publishes new quakes every 1-2 min
    notes: 'Fixed in PR — ratio was 10× (10 min cache vs 1 min source). Now 2:1.',
  },
  // ── Infrastructure ───────────────────────────────────────────────────────
  'power-grid': {
    ttlMs: 5 * 60_000,                // FIXED: was 15 min, now 5 min
    sourceUpdateFreqMs: 5 * 60_000,  // EIA grid data refreshes every 5 min
    notes: 'Fixed in PR — ratio was 3× (15 min vs 5 min). Now 1:1.',
  },
  'grid-alerts': {
    ttlMs: 15 * 60_000,
    sourceUpdateFreqMs: 5 * 60_000,
    notes: 'Still slightly long; future fix candidate.',
  },
  'infrastructure-bgp': {
    ttlMs: 10 * 60_000,
    sourceUpdateFreqMs: 5 * 60_000,  // BGP events propagate in minutes
    notes: 'Moderate mismatch; acceptable given polling cost.',
  },
  // ── Intelligence & news ──────────────────────────────────────────────────
  'gdelt-intel': {
    ttlMs: 15 * 60_000,               // FIXED: was 30 min, now 15 min
    sourceUpdateFreqMs: 15 * 60_000, // GDELT updates every 15 min
    notes: 'Fixed in PR — ratio was 2× (30 min vs 15 min). Now 1:1. Rate-limit still applies.',
  },
  'isw-reports': {
    ttlMs: 30 * 60_000,
    sourceUpdateFreqMs: 24 * 60 * 60_000, // ISW publishes 1-2× per day
    notes: 'Well aligned — could even cache 2h.',
  },
  'reliefweb-crises': {
    ttlMs: 2 * 60 * 60_000,
    sourceUpdateFreqMs: 60 * 60_000, // ReliefWeb updates every few hours
    notes: 'Slightly long but acceptable.',
  },
  'bellingcat': {
    ttlMs: 30 * 60_000,
    sourceUpdateFreqMs: 4 * 60 * 60_000, // Bellingcat publishes every few hours
    notes: 'Conservative — could cache longer.',
  },
  'promed': {
    ttlMs: 15 * 60_000,
    sourceUpdateFreqMs: 60 * 60_000, // ProMED publishes irregularly, ~hourly bursts
    notes: 'Slightly aggressive; acceptable overhead.',
  },
  'disease-intel': {
    ttlMs: 15 * 60_000,               // FIXED: was 30 min, now 15 min
    sourceUpdateFreqMs: 60 * 60_000, // WHO DON + ProMED update hourly
    notes: 'Fixed in PR — WHO DON rarely posts faster than hourly; 15 min is conservative.',
  },
  // ── Security ─────────────────────────────────────────────────────────────
  'cisa-kev': {
    ttlMs: 24 * 60 * 60_000,
    sourceUpdateFreqMs: 24 * 60 * 60_000, // CISA KEV updated daily
    notes: 'Well aligned.',
  },
  'nvd-cve': {
    ttlMs: 2 * 60 * 60_000,
    sourceUpdateFreqMs: 60 * 60_000, // NVD hourly data feed
    notes: 'Slightly long; acceptable.',
  },
  'greynoise-scanners': {
    ttlMs: 15 * 60_000,
    sourceUpdateFreqMs: 15 * 60_000,
    notes: 'Well aligned.',
  },
  'otx-pulses': {
    ttlMs: 30 * 60_000,
    sourceUpdateFreqMs: 60 * 60_000, // AlienVault OTX pulses: hourly batches
    notes: 'Conservative — acceptable.',
  },
  // ── Finance ──────────────────────────────────────────────────────────────
  'edgar-filings': {
    ttlMs: 2 * 60 * 60_000,
    sourceUpdateFreqMs: 4 * 60 * 60_000, // SEC EDGAR queues filings ~every 4h
    notes: 'Fine.',
  },
  'fear-greed': {
    ttlMs: 60 * 60_000,
    sourceUpdateFreqMs: 24 * 60 * 60_000, // CNN Fear & Greed updates daily
    notes: 'Conservative — acceptable.',
  },
  // ── Webcams & cameras ────────────────────────────────────────────────────
  'faa-cameras': {
    ttlMs: 15 * 60_000,
    sourceUpdateFreqMs: 30 * 60_000, // FAA weather cams update every 30 min
    notes: 'Slightly aggressive but fine.',
  },
  // ── Wildfire ─────────────────────────────────────────────────────────────
  'nasa-firms': {
    ttlMs: 0,
    sourceUpdateFreqMs: 3 * 60 * 60_000, // VIIRS satellite pass every 3h
    notes: 'No cache — expensive multi-region fetch; 30-min cache would help.',
  },
  'wildfire-perimeters': {
    ttlMs: 0,
    sourceUpdateFreqMs: 60 * 60_000, // NIFC updates perimeters hourly
    notes: 'No cache — ArcGIS REST call; 15-min cache would reduce load.',
  },
};

/**
 * Returns feeds sorted by mismatch ratio (ttlMs / sourceUpdateFreqMs),
 * highest ratio first. Feeds with ttlMs=0 are placed last (no cache).
 * @returns {Array<{feedId: string, ratio: number, ttlMs: number, sourceUpdateFreqMs: number, notes: string}>}
 */
export function getMismatchedFeeds() {
  return Object.entries(FEED_LATENCY_CONFIG)
    .filter(([, c]) => c.ttlMs > 0 && c.sourceUpdateFreqMs > 0)
    .map(([feedId, c]) => ({
      feedId,
      ratio: c.ttlMs / c.sourceUpdateFreqMs,
      ttlMs: c.ttlMs,
      sourceUpdateFreqMs: c.sourceUpdateFreqMs,
      notes: c.notes,
    }))
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * Returns feeds with no cache (ttlMs === 0).
 * These are either safety-critical or expensive multi-call routes.
 */
export function getUncachedFeeds() {
  return Object.entries(FEED_LATENCY_CONFIG)
    .filter(([, c]) => c.ttlMs === 0)
    .map(([feedId, c]) => ({ feedId, ...c }));
}
