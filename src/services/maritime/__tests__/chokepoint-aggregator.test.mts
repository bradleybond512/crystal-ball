import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateChokepointStatus,
  aggregateSingleChokepointStatus,
  acledToIncidents,
  aisDisruptionsToIncidents,
  aisPositionsToVesselReports,
  buildMonitorInput,
  gdacsToIncidents,
  isMilitaryShipType,
} from '../chokepoint-aggregator.ts';
import type { GDACSEvent } from '@/services/gdacs';
import type { AisDisruptionEvent } from '@/types';

const NOW = 1_745_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function gdacs(over: Partial<GDACSEvent> = {}): GDACSEvent {
  return {
    id: 'g1',
    eventType: 'TC',
    name: 'Tropical Cyclone',
    description: 'description',
    alertLevel: 'Orange',
    country: 'XX',
    coordinates: [56.5, 26.6],
    fromDate: new Date(NOW - HOUR_MS),
    severity: 'severe',
    url: 'http://example',
    ...over,
  } as GDACSEvent;
}

// ── GDACS adapter ────────────────────────────────────────────────────────────

test('gdacsToIncidents maps Red/Orange/Green to critical/high/low', () => {
  const out = gdacsToIncidents([
    gdacs({ id: 'g-red', alertLevel: 'Red' }),
    gdacs({ id: 'g-orange', alertLevel: 'Orange' }),
    gdacs({ id: 'g-green', alertLevel: 'Green' }),
  ]);
  assert.equal(out.find((i) => i.id.includes('g-red'))!.severity, 'critical');
  assert.equal(out.find((i) => i.id.includes('g-orange'))!.severity, 'high');
  assert.equal(out.find((i) => i.id.includes('g-green'))!.severity, 'low');
});

test('gdacsToIncidents preserves [lon, lat] geojson order correctly', () => {
  const [out] = gdacsToIncidents([gdacs({ coordinates: [56.5, 26.6] })]);
  assert.equal(out!.lon, 56.5);
  assert.equal(out!.lat, 26.6);
});

test('gdacsToIncidents drops events with non-finite coordinates', () => {
  const out = gdacsToIncidents([
    gdacs({ id: 'good' }),
    gdacs({ id: 'bad', coordinates: [Number.NaN, Number.NaN] }),
  ]);
  assert.equal(out.length, 1);
  assert.match(out[0]!.id, /good/);
});

// ── ACLED adapter ────────────────────────────────────────────────────────────

test('acledToIncidents grades by fatalities', () => {
  const rows = [
    { event_id_cnty: 'a1', latitude: 26.6, longitude: 56.5, event_date: '2026-04-15', fatalities: 0 },
    { event_id_cnty: 'a2', latitude: 26.6, longitude: 56.5, event_date: '2026-04-15', fatalities: 3 },
    { event_id_cnty: 'a3', latitude: 26.6, longitude: 56.5, event_date: '2026-04-15', fatalities: 10 },
    { event_id_cnty: 'a4', latitude: 26.6, longitude: 56.5, event_date: '2026-04-15', fatalities: 50 },
  ];
  const out = acledToIncidents(rows);
  assert.equal(out.find((i) => i.id.includes('a1'))!.severity, 'low');
  assert.equal(out.find((i) => i.id.includes('a2'))!.severity, 'medium');
  assert.equal(out.find((i) => i.id.includes('a3'))!.severity, 'high');
  assert.equal(out.find((i) => i.id.includes('a4'))!.severity, 'critical');
});

test('acledToIncidents handles string-typed latitude/longitude', () => {
  const out = acledToIncidents([
    { event_id_cnty: 'x', latitude: '26.6', longitude: '56.5', event_date: '2026-04-15' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.lat, 26.6);
  assert.equal(out[0]!.lon, 56.5);
});

test('acledToIncidents drops rows with bad date', () => {
  const out = acledToIncidents([
    { event_id_cnty: 'x', latitude: 26.6, longitude: 56.5, event_date: 'not-a-date' },
  ]);
  assert.equal(out.length, 0);
});

// ── AIS disruption adapter ───────────────────────────────────────────────────

test('aisDisruptionsToIncidents tags source as ais_disruption', () => {
  const d: AisDisruptionEvent = {
    id: 'd1', name: 'Hormuz congestion', type: 'chokepoint_congestion',
    lat: 26.6, lon: 56.5, severity: 'high', changePct: 35, windowHours: 12,
    description: 'queue pressure',
  };
  const out = aisDisruptionsToIncidents([d], NOW);
  assert.equal(out[0]!.source, 'ais_disruption');
  assert.equal(out[0]!.severity, 'high');
});

// ── AIS position adapter ─────────────────────────────────────────────────────

test('aisPositionsToVesselReports flags ship-type 35/55 as military', () => {
  const out = aisPositionsToVesselReports([
    { mmsi: '111', name: 'A', lat: 26.6, lon: 56.5, shipType: 35 },
    { mmsi: '222', name: 'B', lat: 26.6, lon: 56.5, shipType: 55 },
    { mmsi: '333', name: 'C', lat: 26.6, lon: 56.5, shipType: 70 },
    { mmsi: '444', name: 'D', lat: 26.6, lon: 56.5 },
  ]);
  assert.equal(out.find((v) => v.mmsi === '111')!.isMilitary, true);
  assert.equal(out.find((v) => v.mmsi === '222')!.isMilitary, true);
  assert.equal(out.find((v) => v.mmsi === '333')!.isMilitary, false);
  assert.equal(out.find((v) => v.mmsi === '444')!.isMilitary, false);
});

test('isMilitaryShipType: 35/55 yes, others no, undefined no', () => {
  assert.equal(isMilitaryShipType(35), true);
  assert.equal(isMilitaryShipType(55), true);
  assert.equal(isMilitaryShipType(70), false);
  assert.equal(isMilitaryShipType(undefined), false);
});

// ── Composer ─────────────────────────────────────────────────────────────────

test('aggregateChokepointStatus returns 6 statuses from mixed inputs', () => {
  const result = aggregateChokepointStatus({
    gdacs: [gdacs({ coordinates: [56.5, 26.6], alertLevel: 'Orange' })],
    acled: [{ event_id_cnty: 'a', latitude: 32.3, longitude: 30.5, event_date: '2026-04-15', fatalities: 2 }],
    aisDisruptions: [{
      id: 'd', name: 'Bab congestion', type: 'chokepoint_congestion',
      lat: 12.6, lon: 43.4, severity: 'elevated', changePct: 25, windowHours: 12,
      description: 'queue',
    }],
    aisPositions: [
      { mmsi: '1', name: 'V1', lat: 26.6, lon: 56.5 },
      { mmsi: '2', name: 'V2', lat: 1.5, lon: 104.0, shipType: 35 },
    ],
    now: NOW,
  });
  assert.equal(result.length, 6);
  const hormuz = result.find((r) => r.id === 'hormuz')!;
  assert.equal(hormuz.vesselCount24h, 1);
  const malacca = result.find((r) => r.id === 'malacca')!;
  assert.equal(malacca.militaryVesselCount, 1);
});

test('aggregateSingleChokepointStatus returns just that chokepoint', () => {
  const status = aggregateSingleChokepointStatus('panama', {
    aisPositions: [{ mmsi: '1', name: 'V1', lat: 9.1, lon: -79.7 }],
    now: NOW,
  });
  assert.equal(status.id, 'panama');
  assert.equal(status.vesselCount24h, 1);
});

test('buildMonitorInput merges incidents from all 3 sources', () => {
  const out = buildMonitorInput({
    gdacs: [gdacs({})],
    acled: [{ event_id_cnty: 'a', latitude: 26.6, longitude: 56.5, event_date: '2026-04-15' }],
    aisDisruptions: [{
      id: 'd', name: 'Hormuz congestion', type: 'chokepoint_congestion',
      lat: 26.6, lon: 56.5, severity: 'low', changePct: 10, windowHours: 6,
      description: 'd',
    }],
    now: NOW,
  });
  const sources = new Set(out.incidents.map((i) => i.source));
  assert.ok(sources.has('gdacs'));
  assert.ok(sources.has('acled'));
  assert.ok(sources.has('ais_disruption'));
});
