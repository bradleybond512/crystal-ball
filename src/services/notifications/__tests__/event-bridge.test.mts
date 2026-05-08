import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeAllToEvents,
  bridgeNhcStormsToEvents,
  bridgeNifcPerimetersToEvents,
  bridgeNwsAlertsToEvents,
  bridgeSeismicRowsToEvents,
  bridgeSpaceWxToEvents,
} from '../event-bridge.ts';
import type { NwsHazardAlert, NhcStorm } from '../../weather/nws-hazards.ts';
import type { ActiveFirePerimeter } from '../../wildfires/fire-intel-service.ts';
import type { SpaceWxStatus } from '../../spaceweather/swpc-monitor.ts';

// ── NWS alerts ──────────────────────────────────────────────────────────

function alert(overrides: Partial<NwsHazardAlert> = {}): NwsHazardAlert {
  return {
    id: 'alert-1',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    certainty: 'Observed',
    urgency: 'Immediate',
    headline: 'Damaging winds',
    areaDesc: 'La Porte, IN',
    sent: '2026-05-08T12:00:00Z',
    expires: '2026-05-08T13:00:00Z',
    category: 'thunderstorm',
    ...overrides,
  };
}

test('bridgeNwsAlertsToEvents: keeps Severe + Immediate', () => {
  const events = bridgeNwsAlertsToEvents([alert()]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'cap');
  assert.equal(events[0]?.severity, 'Severe');
  assert.equal(events[0]?.alertId, 'alert-1');
});

test('bridgeNwsAlertsToEvents: keeps Extreme + Immediate (tornado)', () => {
  const events = bridgeNwsAlertsToEvents([alert({
    severity: 'Extreme',
    event: 'Tornado Warning',
    headline: 'Tornado Warning issued',
  })]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, 'Tornado Warning');
});

test('bridgeNwsAlertsToEvents: drops Moderate', () => {
  assert.equal(bridgeNwsAlertsToEvents([alert({ severity: 'Moderate' })]).length, 0);
});

test('bridgeNwsAlertsToEvents: drops non-Immediate', () => {
  assert.equal(bridgeNwsAlertsToEvents([alert({ urgency: 'Expected' })]).length, 0);
});

test('bridgeNwsAlertsToEvents: empty input → empty output', () => {
  assert.deepEqual(bridgeNwsAlertsToEvents([]), []);
});

// ── NHC storms ──────────────────────────────────────────────────────────

function storm(overrides: Partial<NhcStorm> = {}): NhcStorm {
  return {
    id: 'AL01',
    name: 'Ida',
    classification: 'HU',
    category: 'HU3',
    basin: 'AL',
    position: { lat: 24, lng: -80 },
    intensityMph: 120,
    advisoryNumber: '12',
    ...overrides,
  };
}

test('bridgeNhcStormsToEvents: HU3 → Cat 3 hurricane event', () => {
  const events = bridgeNhcStormsToEvents([storm()]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.nhcStorm?.category, 3);
  assert.equal(events[0]?.nhcStorm?.name, 'Ida');
});

test('bridgeNhcStormsToEvents: HU5 → Cat 5', () => {
  const events = bridgeNhcStormsToEvents([storm({ category: 'HU5' })]);
  assert.equal(events[0]?.nhcStorm?.category, 5);
});

test('bridgeNhcStormsToEvents: HU2 below threshold', () => {
  assert.equal(bridgeNhcStormsToEvents([storm({ category: 'HU2' })]).length, 0);
});

test('bridgeNhcStormsToEvents: tropical storm dropped', () => {
  assert.equal(bridgeNhcStormsToEvents([storm({ category: 'TS' })]).length, 0);
});

// ── NIFC perimeters ─────────────────────────────────────────────────────

function perimeter(overrides: Partial<ActiveFirePerimeter> = {}): ActiveFirePerimeter {
  return {
    irwinId: 'irwin-1',
    name: 'Park Fire',
    acres: 50_000,
    containmentPct: 5,
    state: 'CA',
    lat: 39.5,
    lon: -121.5,
    geometry: null,
    updatedAt: null,
    ...overrides,
  };
}

test('bridgeNifcPerimetersToEvents: large + uncontained passes', () => {
  const events = bridgeNifcPerimetersToEvents([perimeter()]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.nifc?.acres, 50_000);
  assert.equal(events[0]?.nifc?.containment, 5);
});

test('bridgeNifcPerimetersToEvents: small fire dropped', () => {
  assert.equal(bridgeNifcPerimetersToEvents([perimeter({ acres: 5_000 })]).length, 0);
});

test('bridgeNifcPerimetersToEvents: mostly contained dropped', () => {
  assert.equal(bridgeNifcPerimetersToEvents([perimeter({ containmentPct: 50 })]).length, 0);
});

test('bridgeNifcPerimetersToEvents: missing acres drops', () => {
  assert.equal(bridgeNifcPerimetersToEvents([perimeter({ acres: null })]).length, 0);
});

test('bridgeNifcPerimetersToEvents: missing containment drops', () => {
  assert.equal(bridgeNifcPerimetersToEvents([perimeter({ containmentPct: null })]).length, 0);
});

// ── SWPC space weather ──────────────────────────────────────────────────

function spaceWx(overrides: Partial<SpaceWxStatus> = {}): SpaceWxStatus {
  return {
    xray: null,
    geomag: null,
    gpsDisruption: 'none',
    hfRadioBlackout: false,
    earthwardCmes: [],
    asOf: '2026-05-08T12:00:00Z',
    ...overrides,
  };
}

test('bridgeSpaceWxToEvents: Kp 7 → geomag event', () => {
  const events = bridgeSpaceWxToEvents(spaceWx({
    geomag: { kp: 7, level: 'G3', auroraVisibilityLatN: 55, observedAt: '2026-05-08T11:00:00Z', kpMax24h: 7 },
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'geomagnetic');
  if (events[0]?.kind === 'geomagnetic') assert.equal(events[0].kpIndex, 7);
});

test('bridgeSpaceWxToEvents: Kp 6 below threshold', () => {
  const events = bridgeSpaceWxToEvents(spaceWx({
    geomag: { kp: 6, level: 'G2', auroraVisibilityLatN: 60, observedAt: 'x', kpMax24h: 6 },
  }));
  assert.equal(events.length, 0);
});

test('bridgeSpaceWxToEvents: X-class flare → solar_flare event', () => {
  const events = bridgeSpaceWxToEvents(spaceWx({
    xray: {
      peakFlux: 2.5e-4, currentFlux: 1e-4, peakClass: 'X', peakLabel: 'X2.5',
      peakAt: '2026-05-08T11:30:00Z', xClassActive: true, sampleCount: 360,
    },
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'solar_flare');
  if (events[0]?.kind === 'solar_flare') assert.equal(events[0].peakLabel, 'X2.5');
});

test('bridgeSpaceWxToEvents: Kp 9 + X-flare → 2 events', () => {
  const events = bridgeSpaceWxToEvents(spaceWx({
    geomag: { kp: 9, level: 'G5', auroraVisibilityLatN: 45, observedAt: 'x', kpMax24h: 9 },
    xray: {
      peakFlux: 1e-3, currentFlux: 5e-4, peakClass: 'X', peakLabel: 'X10.0',
      peakAt: 'y', xClassActive: true, sampleCount: 12,
    },
  }));
  assert.equal(events.length, 2);
  // Geomag first per the bridge ordering
  assert.equal(events[0]?.kind, 'geomagnetic');
  assert.equal(events[1]?.kind, 'solar_flare');
});

test('bridgeSpaceWxToEvents: M-class flare alone does not fire', () => {
  const events = bridgeSpaceWxToEvents(spaceWx({
    xray: {
      peakFlux: 5e-5, currentFlux: 1e-5, peakClass: 'M', peakLabel: 'M5.0',
      peakAt: 'x', xClassActive: false, sampleCount: 60,
    },
  }));
  assert.equal(events.length, 0);
});

// ── Seismic passthrough ─────────────────────────────────────────────────

test('bridgeSeismicRowsToEvents: keeps M5+', () => {
  const events = bridgeSeismicRowsToEvents([
    { magnitude: 6.2, place: 'Anchorage', eventId: 'us1' },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.magnitude, 6.2);
  assert.equal(events[0]?.eventId, 'us1');
});

test('bridgeSeismicRowsToEvents: drops M<4.5', () => {
  assert.equal(bridgeSeismicRowsToEvents([{ magnitude: 3.8 }]).length, 0);
});

test('bridgeSeismicRowsToEvents: drops non-finite magnitude', () => {
  assert.equal(bridgeSeismicRowsToEvents([{ magnitude: Number.NaN }]).length, 0);
});

// ── Aggregator ──────────────────────────────────────────────────────────

test('bridgeAllToEvents: combines every source', () => {
  const events = bridgeAllToEvents({
    seismicRows: [{ magnitude: 7.0, place: 'X' }],
    spaceWeather: spaceWx({
      geomag: { kp: 7, level: 'G3', auroraVisibilityLatN: 55, observedAt: 'x', kpMax24h: 7 },
    }),
    nwsAlerts: [alert()],
    nhcStorms: [storm()],
    nifcPerimeters: [perimeter()],
  });
  // One per source kind
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes('seismic'));
  assert.ok(kinds.includes('geomagnetic'));
  assert.ok(kinds.includes('cap'));
  assert.ok(kinds.includes('hurricane'));
  assert.ok(kinds.includes('wildfire'));
});

test('bridgeAllToEvents: empty input → empty output', () => {
  assert.deepEqual(bridgeAllToEvents({}), []);
});

test('bridgeAllToEvents: null spaceWeather treated as missing', () => {
  const events = bridgeAllToEvents({ spaceWeather: null });
  assert.deepEqual(events, []);
});
