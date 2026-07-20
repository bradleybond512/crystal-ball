import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertsToPolygonDescriptors,
  describeAlert,
  trackToDescriptor,
  stormsToBillboards,
} from '../weather-hazard-globe-helpers.ts';
import type { NwsHazardAlert, NhcStorm, HurricaneTrack } from '@/services/weather/nws-hazards';

const NOW = 1_745_000_000_000;

function alert(partial: Partial<NwsHazardAlert>): NwsHazardAlert {
  return {
    id: 'a1',
    event: 'Tornado Warning',
    severity: 'Extreme',
    certainty: 'Observed',
    urgency: 'Immediate',
    headline: '',
    areaDesc: '',
    sent: '',
    expires: '',
    category: 'tornado',
    ...partial,
  };
}

// ── alertsToPolygonDescriptors ───────────────────────────────────────

test('alertsToPolygonDescriptors: Polygon → one descriptor per ring', () => {
  const a = alert({
    id: 'a1',
    geometry: {
      kind: 'Polygon',
      rings: [[[-97, 35], [-96, 35], [-96, 36], [-97, 36], [-97, 35]]],
    },
  });
  const out = alertsToPolygonDescriptors([a], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.alertId, 'a1');
  assert.equal(out[0]!.color, '#dc2626'); // tornado red
  assert.equal(out[0]!.rings[0]!.length, 10); // 5 vertices × 2
});

test('alertsToPolygonDescriptors: MultiPolygon → one descriptor per ring across all polygons', () => {
  const a = alert({
    id: 'a2',
    category: 'flood',
    event: 'Flash Flood Warning',
    geometry: {
      kind: 'MultiPolygon',
      polygons: [
        [[[-97, 35], [-96, 35], [-96, 36], [-97, 36], [-97, 35]]],
        [[[-90, 30], [-89, 30], [-89, 31], [-90, 31], [-90, 30]]],
      ],
    },
  });
  const out = alertsToPolygonDescriptors([a], NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.color, '#2563eb'); // flood blue
});

test('alertsToPolygonDescriptors: skips alerts with no geometry / Point geometry', () => {
  const noGeom = alert({ id: 'noGeom' });
  const pointGeom = alert({ id: 'point', geometry: { kind: 'Point', lng: -90, lat: 30 } });
  const out = alertsToPolygonDescriptors([noGeom, pointGeom], NOW);
  assert.equal(out.length, 0);
});

test('alertsToPolygonDescriptors: skips degenerate rings (< 3 vertices)', () => {
  const a = alert({
    id: 'short',
    geometry: { kind: 'Polygon', rings: [[[-97, 35], [-96, 35]]] },
  });
  assert.equal(alertsToPolygonDescriptors([a], NOW).length, 0);
});

// ── describeAlert ────────────────────────────────────────────────────

test('describeAlert: includes event, areaDesc, expires-in', () => {
  const a = alert({
    event: 'Tornado Warning',
    areaDesc: 'Cook County',
    headline: 'Take cover now.',
    expires: new Date(NOW + 30 * 60_000).toISOString(),
  });
  const desc = describeAlert(a, NOW);
  assert.match(desc, /Tornado Warning/);
  assert.match(desc, /Cook County/);
  assert.match(desc, /Take cover/);
  assert.match(desc, /Expires in 30m/);
});

test('describeAlert: omits headline when very long (would dominate the popup)', () => {
  const a = alert({ headline: 'x'.repeat(300), areaDesc: 'X' });
  const desc = describeAlert(a, NOW);
  assert.ok(!desc.includes('xxxx'.repeat(50)));
});

test('describeAlert: handles missing expires gracefully', () => {
  const a = alert({ expires: '' });
  const desc = describeAlert(a, NOW);
  assert.ok(!desc.includes('Expires'));
});

// ── trackToDescriptor ────────────────────────────────────────────────

test('trackToDescriptor: flattens points + cone', () => {
  const track: HurricaneTrack = {
    stormId: 'AL062026',
    forecastPoints: [
      { lat: 26, lng: -77, advisoryHour: 0 },
      { lat: 28, lng: -78, advisoryHour: 12 },
    ],
    uncertaintyCone: [
      [-79, 25], [-79, 28], [-77, 28], [-77, 25], [-79, 25],
    ],
  };
  const desc = trackToDescriptor(track, undefined);
  assert.deepEqual(desc.trackPolyline, [-77, 26, -78, 28]);
  assert.equal(desc.uncertaintyCone?.length, 10);
});

test('trackToDescriptor: storm name carried over when provided', () => {
  const track: HurricaneTrack = { stormId: 'x', forecastPoints: [], uncertaintyCone: null };
  const storm: NhcStorm = {
    id: 'x', name: 'Frances', classification: 'HU', category: 'HU3', basin: 'AL',
    position: { lat: 0, lng: 0 }, intensityMph: 115, advisoryNumber: '5',
  };
  const desc = trackToDescriptor(track, storm);
  assert.equal(desc.name, 'Frances');
  assert.equal(desc.category, 'HU3');
});

test('trackToDescriptor: degenerate cone (< 3 vertices) → null', () => {
  const track: HurricaneTrack = {
    stormId: 'x',
    forecastPoints: [],
    uncertaintyCone: [[-79, 25], [-79, 28]],
  };
  assert.equal(trackToDescriptor(track, undefined).uncertaintyCone, null);
});

// ── stormsToBillboards ───────────────────────────────────────────────

test('stormsToBillboards: per-storm descriptor with category color + description', () => {
  const storms: NhcStorm[] = [
    {
      id: 'AL06', name: 'Frances', classification: 'HU', category: 'HU4', basin: 'AL',
      position: { lat: 25, lng: -78 }, intensityMph: 140, pressureMb: 925, advisoryNumber: '15',
      movement: { headingDeg: 290, speedMph: 12 },
    },
  ];
  const out = stormsToBillboards(storms);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.color, '#ff453a'); // CAT 4
  assert.match(out[0]!.description, /Frances/);
  assert.match(out[0]!.description, /CAT 4/);
  assert.match(out[0]!.description, /140 mph/);
  assert.match(out[0]!.description, /Advisory #15/);
});

test('stormsToBillboards: omits movement / pressure when missing', () => {
  const storms: NhcStorm[] = [
    { id: 'x', name: 'Mild', classification: 'TD', category: 'TD', basin: 'AL', position: { lat: 0, lng: 0 }, intensityMph: 30, advisoryNumber: '1' },
  ];
  const desc = stormsToBillboards(storms)[0]!.description;
  assert.ok(!desc.includes('Moving'));
  assert.ok(!desc.includes('mb'));
});
