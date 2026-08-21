import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  outagesToStateOverlay,
  radiationToHotspots,
  bgpToBanner,
} from '../infrastructure-overlay.ts';
import type {
  OutageSummary,
  BgpSummary,
  BgpEvent,
  RadSummary,
  RadStation,
} from '../grid-monitor.ts';

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

function badge(): { observedAt: number; evaluatedAt: number; ageSeconds: number; isStale: boolean } {
  return { observedAt: NOW, evaluatedAt: NOW, ageSeconds: 0, isStale: false };
}

// ── outagesToStateOverlay ─────────────────────────────────────────────

test('outage overlay: exact-county ODIN context is not promoted to a state centroid', () => {
  const summary: OutageSummary = {
    source: 'ornl-odin',
    coverage: 'reported',
    completeness: 'reported',
    placeId: 'home',
    placeName: 'Home',
    countyFips: '18091',
    county: 'LaPorte',
    state: 'Indiana',
    reportedCustomersOut: 500_000,
    reportedCustomersRestored: null,
    reportCount: 1,
    reports: [{
      countyFips: '18091', county: 'LaPorte', state: 'Indiana', customersOut: 500_000,
      customersRestored: null, utility: 'Utility', utilityId: 'u1', retrievedAt: NOW,
      expiresAt: NOW + 30 * 60_000,
    }],
    providerState: 'ok',
    unknownReason: null,
    severity: 'high',
    badge: badge(),
  };
  assert.deepEqual(outagesToStateOverlay(summary), []);
});

test('outage overlay: null context returns an empty array', () => {
  assert.deepEqual(outagesToStateOverlay(null), []);
});

// ── radiationToHotspots ───────────────────────────────────────────────

function station(over: Partial<RadStation>): RadStation {
  return {
    name: 'X',
    state: null,
    lat: 0,
    lon: 0,
    cpm: 50,
    observedAt: NOW,
    severity: 'normal',
    ...over,
  };
}

function reportedRad(over: Omit<RadSummary, 'coverage' | 'error' | 'acceptedRows' | 'droppedRows'>): RadSummary {
  return {
    coverage: 'reported',
    error: null,
    acceptedRows: over.stationCount,
    droppedRows: 0,
    ...over,
  };
}

test('rad-overlay: only severity ≥ elevated stations are emitted', () => {
  const summary = reportedRad({
    stationCount: 3,
    elevatedStations: [
      station({ name: 'A', cpm: 150, severity: 'elevated', lat: 35, lon: -100 }),
      station({ name: 'B', cpm: 50, severity: 'normal', lat: 36, lon: -100 }),
      station({ name: 'C', cpm: 800, severity: 'major', lat: 37, lon: -100 }),
    ],
    maxCpm: 800,
    maxCpmStation: 'C',
    severity: 'major',
    badge: badge(),
  });
  const rows = radiationToHotspots(summary, NOW);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.name), ['C', 'A']);
});

test('rad-overlay: stations missing coordinates are dropped', () => {
  const summary = reportedRad({
    stationCount: 1,
    elevatedStations: [station({ name: 'no-coords', cpm: 200, severity: 'high', lat: null, lon: null })],
    maxCpm: 200,
    maxCpmStation: 'no-coords',
    severity: 'high',
    badge: badge(),
  });
  assert.deepEqual(radiationToHotspots(summary, NOW), []);
});

test('rad-overlay: pulse period speeds up with severity', () => {
  const summary = reportedRad({
    stationCount: 2,
    elevatedStations: [
      station({ name: 'low', cpm: 150, severity: 'elevated', lat: 0, lon: 0 }),
      station({ name: 'high', cpm: 1100, severity: 'extreme', lat: 1, lon: 1 }),
    ],
    maxCpm: 1100,
    maxCpmStation: 'high',
    severity: 'extreme',
    badge: badge(),
  });
  const [first, second] = radiationToHotspots(summary, NOW);
  assert.equal(first!.name, 'high');
  assert.ok(first!.pulsePeriodMs < second!.pulsePeriodMs);
});

test('rad-overlay: rejects out-of-range/nonfinite coordinates and negative/nonfinite CPM', () => {
  const summary = reportedRad({
    stationCount: 7,
    elevatedStations: [
      station({ name: 'valid-zero-axis', lat: 0, lon: 0, cpm: 150, severity: 'elevated' }),
      station({ name: 'latitude-high', lat: 91, lon: 0, cpm: 150, severity: 'elevated' }),
      station({ name: 'longitude-low', lat: 0, lon: -181, cpm: 150, severity: 'elevated' }),
      station({ name: 'nan-lat', lat: Number.NaN, lon: 0, cpm: 150, severity: 'elevated' }),
      station({ name: 'infinite-lon', lat: 0, lon: Number.POSITIVE_INFINITY, cpm: 150, severity: 'elevated' }),
      station({ name: 'negative-cpm', lat: 0, lon: 0, cpm: -1, severity: 'elevated' }),
      station({ name: 'infinite-cpm', lat: 0, lon: 0, cpm: Number.POSITIVE_INFINITY, severity: 'elevated' }),
    ],
    maxCpm: 150,
    maxCpmStation: 'valid-zero-axis',
    severity: 'elevated',
    badge: badge(),
  });
  assert.deepEqual(radiationToHotspots(summary, NOW).map((row) => row.name), ['valid-zero-axis']);
});

test('rad-overlay: unknown coverage never emits hotspots even if rows are present', () => {
  const summary: RadSummary = {
    ...reportedRad({
      stationCount: 1,
      elevatedStations: [station({ cpm: 500, severity: 'major' })],
      maxCpm: 500,
      maxCpmStation: 'X',
      severity: 'major',
      badge: badge(),
    }),
    coverage: 'unknown',
    error: 'malformed response',
  };
  assert.deepEqual(radiationToHotspots(summary, NOW), []);
});

test('rad-overlay: a once-fresh elevated reading stops emitting after evidence expiry', () => {
  const summary = reportedRad({
    stationCount: 1,
    elevatedStations: [station({ name: 'aged', cpm: 250, severity: 'high', lat: 41, lon: -87 })],
    maxCpm: 250,
    maxCpmStation: 'aged',
    severity: 'high',
    badge: badge(),
  });
  assert.equal(radiationToHotspots(summary, NOW).length, 1);
  assert.deepEqual(radiationToHotspots(summary, NOW + 6 * 60 * 60_000 + 1), []);
});

// ── bgpToBanner ───────────────────────────────────────────────────────

function event(over: Partial<BgpEvent>): BgpEvent {
  return {
    id: 'evt',
    startedAt: NOW,
    endedAt: null,
    prefixes: ['203.0.113.0/24'],
    expectedOriginAsn: '12345',
    detectedOriginAsns: ['67890'],
    involvedAsns: ['67890'],
    type: 'BGP_HIJACK',
    tags: [],
    severity: 'info',
    ...over,
  };
}

function reportedBgp(over: Omit<BgpSummary, 'coverage' | 'error' | 'acceptedRows' | 'droppedRows'>): BgpSummary {
  return {
    coverage: 'reported',
    error: null,
    acceptedRows: over.events.length,
    droppedRows: 0,
    ...over,
  };
}

test('banner: hidden when no events', () => {
  const r = bgpToBanner(reportedBgp({ events: [], criticalCount: 0, elevatedCount: 0, affectedAsnSet: [], badge: badge() }), NOW);
  assert.equal(r.visible, false);
});

test('banner: visible + critical when ≥1 critical event', () => {
  const ev = event({ severity: 'critical', tags: ['cloudflare-dns'], prefixes: ['1.1.1.0/24'] });
  const r = bgpToBanner(reportedBgp({ events: [ev], criticalCount: 1, elevatedCount: 0, affectedAsnSet: ['67890'], badge: badge() }), NOW);
  assert.equal(r.visible, true);
  assert.equal(r.severity, 'critical');
  assert.ok(r.message.includes('Cloudflare DNS'));
  assert.equal(r.criticalEvents.length, 1);
});

test('banner: hidden when only 1-2 elevated events with tags', () => {
  const ev = event({ severity: 'elevated', tags: ['fastly'] });
  const r = bgpToBanner(reportedBgp({ events: [ev, ev], criticalCount: 0, elevatedCount: 2, affectedAsnSet: [], badge: badge() }), NOW);
  assert.equal(r.visible, false);
});

test('banner: visible + elevated when ≥3 elevated events all tagged', () => {
  const ev = event({ severity: 'elevated', tags: ['fastly'] });
  const r = bgpToBanner(reportedBgp({ events: [ev, ev, ev], criticalCount: 0, elevatedCount: 3, affectedAsnSet: [], badge: badge() }), NOW);
  assert.equal(r.visible, true);
  assert.equal(r.severity, 'elevated');
  assert.ok(r.message.includes('Fastly'));
});

test('banner: criticalEvents tooltip is capped at 3 entries', () => {
  const ev = event({ severity: 'critical', tags: ['google-dns'] });
  const summary = reportedBgp({
    events: [ev, ev, ev, ev, ev],
    criticalCount: 5,
    elevatedCount: 0,
    affectedAsnSet: ['67890'],
    badge: badge(),
  });
  const r = bgpToBanner(summary, NOW);
  assert.equal(r.criticalEvents.length, 3);
});

test('banner: untagged elevated events don\'t count toward the ≥3 threshold', () => {
  const ev = event({ severity: 'elevated', tags: [] });
  const r = bgpToBanner(reportedBgp({ events: [ev, ev, ev, ev], criticalCount: 0, elevatedCount: 4, affectedAsnSet: [], badge: badge() }), NOW);
  assert.equal(r.visible, false);
});

test('banner: unknown BGP coverage never emits an alert banner', () => {
  const ev = event({ severity: 'critical', tags: ['google-dns'] });
  const summary: BgpSummary = {
    ...reportedBgp({ events: [ev], criticalCount: 1, elevatedCount: 0, affectedAsnSet: ['67890'], badge: badge() }),
    coverage: 'unknown',
    error: 'missing key',
  };
  assert.equal(bgpToBanner(summary, NOW).visible, false);
});

test('banner: an ended critical event is historical evidence, not an active alert', () => {
  const ended = event({
    severity: 'critical', tags: ['google-dns'], prefixes: ['8.8.8.0/24'],
    endedAt: NOW,
  });
  const summary = reportedBgp({
    events: [ended], criticalCount: 1, elevatedCount: 0,
    affectedAsnSet: ['67890'], badge: badge(),
  });
  assert.equal(bgpToBanner(summary, NOW).visible, false);
});

test('banner: a summary that aged past freshness cannot emit an active alert', () => {
  const active = event({
    severity: 'critical', tags: ['cloudflare-dns'], prefixes: ['1.1.1.0/24'],
  });
  const summary = reportedBgp({
    events: [active], criticalCount: 1, elevatedCount: 0,
    affectedAsnSet: ['67890'], badge: badge(),
  });
  assert.equal(bgpToBanner(summary, NOW).visible, true);
  assert.equal(bgpToBanner(summary, NOW + 60 * 60_000 + 1).visible, false);
});
