import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  outagesToStateOverlay,
  radiationToHotspots,
  bgpToBanner,
  US_STATE_CENTROIDS,
  SEVERITY_COLORS,
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

test('overlay: only non-normal states are emitted', () => {
  const summary: OutageSummary = {
    nationalCustomersAffected: 1_200_000,
    countyCount: 3,
    topCounties: [],
    byState: [
      { state: 'TX', customersAffected: 1_000_000, countyCount: 2, topCounty: 'Harris', severity: 'major' },
      { state: 'CA', customersAffected: 200_000, countyCount: 1, topCounty: 'LA', severity: 'elevated' },
      { state: 'WA', customersAffected: 5, countyCount: 1, topCounty: 'King', severity: 'normal' },
    ],
    severity: 'major',
    badge: badge(),
  };
  const rows = outagesToStateOverlay(summary);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.state), ['TX', 'CA']);
});

test('overlay: rows sorted by descending customersAffected', () => {
  const summary: OutageSummary = {
    nationalCustomersAffected: 0,
    countyCount: 0,
    topCounties: [],
    byState: [
      { state: 'CA', customersAffected: 100_000, countyCount: 1, topCounty: null, severity: 'elevated' },
      { state: 'TX', customersAffected: 500_000, countyCount: 1, topCounty: null, severity: 'high' },
      { state: 'NY', customersAffected: 200_000, countyCount: 1, topCounty: null, severity: 'elevated' },
    ],
    severity: 'high',
    badge: badge(),
  };
  const rows = outagesToStateOverlay(summary);
  assert.deepEqual(rows.map((r) => r.state), ['TX', 'NY', 'CA']);
});

test('overlay: each row carries fillColor + opacity + radiusPx from severity', () => {
  const summary: OutageSummary = {
    nationalCustomersAffected: 0,
    countyCount: 0,
    topCounties: [],
    byState: [
      { state: 'TX', customersAffected: 1, countyCount: 1, topCounty: null, severity: 'extreme' },
    ],
    severity: 'extreme',
    badge: badge(),
  };
  const [tx] = outagesToStateOverlay(summary);
  assert.ok(tx);
  assert.equal(tx!.fillColorHex, SEVERITY_COLORS.extreme);
  assert.ok(tx!.fillOpacity > 0.5);
  assert.equal(tx!.radiusPx, 22);
});

test('overlay: state row attaches the centroid lat/lon', () => {
  const summary: OutageSummary = {
    nationalCustomersAffected: 0,
    countyCount: 0,
    topCounties: [],
    byState: [
      { state: 'CA', customersAffected: 1, countyCount: 1, topCounty: null, severity: 'high' },
    ],
    severity: 'high',
    badge: badge(),
  };
  const [ca] = outagesToStateOverlay(summary);
  const expected = US_STATE_CENTROIDS.CA!;
  assert.equal(ca!.lat, expected.lat);
  assert.equal(ca!.lon, expected.lon);
});

test('overlay: state with full English name resolves via normalizeStateName', () => {
  const summary: OutageSummary = {
    nationalCustomersAffected: 0,
    countyCount: 0,
    topCounties: [],
    byState: [
      { state: 'New York', customersAffected: 1, countyCount: 1, topCounty: null, severity: 'high' },
    ],
    severity: 'high',
    badge: badge(),
  };
  const rows = outagesToStateOverlay(summary);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.lat, US_STATE_CENTROIDS.NY!.lat);
});

test('overlay: unknown state code is silently dropped', () => {
  const summary: OutageSummary = {
    nationalCustomersAffected: 0,
    countyCount: 0,
    topCounties: [],
    byState: [
      { state: 'ZZ', customersAffected: 1, countyCount: 1, topCounty: null, severity: 'high' },
    ],
    severity: 'high',
    badge: badge(),
  };
  assert.deepEqual(outagesToStateOverlay(summary), []);
});

test('overlay: null summary returns an empty array', () => {
  assert.deepEqual(outagesToStateOverlay(null), []);
});

test('overlay: 50 states + DC + PR are covered', () => {
  assert.equal(Object.keys(US_STATE_CENTROIDS).length, 52);
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

test('rad-overlay: only severity ≥ elevated stations are emitted', () => {
  const summary: RadSummary = {
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
  };
  const rows = radiationToHotspots(summary);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.name), ['C', 'A']);
});

test('rad-overlay: stations missing coordinates are dropped', () => {
  const summary: RadSummary = {
    stationCount: 1,
    elevatedStations: [station({ name: 'no-coords', cpm: 200, severity: 'high', lat: null, lon: null })],
    maxCpm: 200,
    maxCpmStation: 'no-coords',
    severity: 'high',
    badge: badge(),
  };
  assert.deepEqual(radiationToHotspots(summary), []);
});

test('rad-overlay: pulse period speeds up with severity', () => {
  const summary: RadSummary = {
    stationCount: 2,
    elevatedStations: [
      station({ name: 'low', cpm: 150, severity: 'elevated', lat: 0, lon: 0 }),
      station({ name: 'high', cpm: 1100, severity: 'extreme', lat: 1, lon: 1 }),
    ],
    maxCpm: 1100,
    maxCpmStation: 'high',
    severity: 'extreme',
    badge: badge(),
  };
  const [first, second] = radiationToHotspots(summary);
  assert.equal(first!.name, 'high');
  assert.ok(first!.pulsePeriodMs < second!.pulsePeriodMs);
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

test('banner: hidden when no events', () => {
  const r = bgpToBanner({ events: [], criticalCount: 0, elevatedCount: 0, affectedAsnSet: [], badge: badge() });
  assert.equal(r.visible, false);
});

test('banner: visible + critical when ≥1 critical event', () => {
  const ev = event({ severity: 'critical', tags: ['cloudflare-dns'], prefixes: ['1.1.1.0/24'] });
  const r = bgpToBanner({ events: [ev], criticalCount: 1, elevatedCount: 0, affectedAsnSet: ['67890'], badge: badge() });
  assert.equal(r.visible, true);
  assert.equal(r.severity, 'critical');
  assert.ok(r.message.includes('Cloudflare DNS'));
  assert.equal(r.criticalEvents.length, 1);
});

test('banner: hidden when only 1-2 elevated events with tags', () => {
  const ev = event({ severity: 'elevated', tags: ['fastly'] });
  const r = bgpToBanner({ events: [ev, ev], criticalCount: 0, elevatedCount: 2, affectedAsnSet: [], badge: badge() });
  assert.equal(r.visible, false);
});

test('banner: visible + elevated when ≥3 elevated events all tagged', () => {
  const ev = event({ severity: 'elevated', tags: ['fastly'] });
  const r = bgpToBanner({ events: [ev, ev, ev], criticalCount: 0, elevatedCount: 3, affectedAsnSet: [], badge: badge() });
  assert.equal(r.visible, true);
  assert.equal(r.severity, 'elevated');
  assert.ok(r.message.includes('Fastly'));
});

test('banner: criticalEvents tooltip is capped at 3 entries', () => {
  const ev = event({ severity: 'critical', tags: ['google-dns'] });
  const summary: BgpSummary = {
    events: [ev, ev, ev, ev, ev],
    criticalCount: 5,
    elevatedCount: 0,
    affectedAsnSet: ['67890'],
    badge: badge(),
  };
  const r = bgpToBanner(summary);
  assert.equal(r.criticalEvents.length, 3);
});

test('banner: untagged elevated events don\'t count toward the ≥3 threshold', () => {
  const ev = event({ severity: 'elevated', tags: [] });
  const r = bgpToBanner({ events: [ev, ev, ev, ev], criticalCount: 0, elevatedCount: 4, affectedAsnSet: [], badge: badge() });
  assert.equal(r.visible, false);
});
