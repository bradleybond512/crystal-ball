import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHOKEPOINTS,
  CHOKEPOINT_IDS,
  haversineKm,
  monitorChokepoints,
  monitorSingleChokepoint,
} from '../chokepoint-monitor.ts';
import type {
  ChokepointIncident,
  ChokepointVesselReport,
  MonitorInput,
} from '../chokepoint-monitor.ts';

const NOW = 1_745_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function vessel(
  mmsi: string,
  lat: number,
  lon: number,
  observedAt = NOW,
  isMilitary = false,
): ChokepointVesselReport {
  return { mmsi, lat, lon, observedAt, isMilitary };
}

function incident(
  id: string,
  lat: number,
  lon: number,
  occurredAt: number,
  severity: ChokepointIncident['severity'],
  source: ChokepointIncident['source'] = 'gdacs',
): ChokepointIncident {
  return { id, source, lat, lon, occurredAt, severity };
}

function input(over: Partial<MonitorInput> = {}): MonitorInput {
  return { vessels: [], incidents: [], now: NOW, ...over };
}

// ── Config sanity ────────────────────────────────────────────────────────────

test('CHOKEPOINTS exposes all six chokepoints with required fields', () => {
  const ids = CHOKEPOINT_IDS;
  assert.equal(ids.length, 6);
  for (const id of ids) {
    const cfg = CHOKEPOINTS[id];
    assert.ok(cfg, `missing config for ${id}`);
    assert.equal(cfg.id, id);
    assert.ok(cfg.name.length > 0);
    assert.ok(cfg.primaryCommodities.length > 0);
    assert.ok(Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon));
  }
});

test('Hormuz commodity exposure includes oil + LNG', () => {
  const cfg = CHOKEPOINTS.hormuz;
  assert.ok(cfg.primaryCommodities.includes('crude_oil'));
  assert.ok(cfg.primaryCommodities.includes('lng'));
});

test('Bosphorus is tagged for Black Sea exports', () => {
  assert.match(CHOKEPOINTS.bosphorus.globalTradePctNote, /Black Sea/);
});

// ── Geo helper ───────────────────────────────────────────────────────────────

test('haversineKm: zero distance for identical points', () => {
  assert.equal(haversineKm(26.6, 56.5, 26.6, 56.5), 0);
});

test('haversineKm: Hormuz to Bab-el-Mandeb is roughly 2000-2200 km', () => {
  const d = haversineKm(26.6, 56.5, 12.6, 43.4);
  assert.ok(d > 1900 && d < 2200, `got ${d}`);
});

// ── Vessel counting ──────────────────────────────────────────────────────────

test('vessels within 50km are counted, deduplicated by mmsi', () => {
  const status = monitorSingleChokepoint('hormuz', input({
    vessels: [
      vessel('A', 26.6, 56.5),
      vessel('A', 26.61, 56.51, NOW - HOUR_MS), // duplicate mmsi
      vessel('B', 26.7, 56.6),
      vessel('C', 30.0, 60.0), // far away — should be excluded
    ],
  }));
  assert.equal(status.vesselCount24h, 2);
});

test('vessels older than 24h are excluded', () => {
  const status = monitorSingleChokepoint('hormuz', input({
    vessels: [
      vessel('A', 26.6, 56.5, NOW - 25 * HOUR_MS),
      vessel('B', 26.6, 56.5, NOW - 23 * HOUR_MS),
    ],
  }));
  assert.equal(status.vesselCount24h, 1);
});

test('military vessel count is separate from transit count', () => {
  const status = monitorSingleChokepoint('hormuz', input({
    vessels: [
      vessel('A', 26.6, 56.5, NOW, false),
      vessel('B', 26.7, 56.6, NOW, true),
      vessel('C', 26.65, 56.55, NOW, true),
    ],
  }));
  assert.equal(status.vesselCount24h, 3);
  assert.equal(status.militaryVesselCount, 2);
});

// ── Incident scoring ─────────────────────────────────────────────────────────

test('incidents within 100km in last 7d are counted', () => {
  const status = monitorSingleChokepoint('suez', input({
    incidents: [
      incident('i1', 30.5, 32.3, NOW - DAY_MS, 'medium', 'gdacs'),
      incident('i2', 30.6, 32.4, NOW - 3 * DAY_MS, 'high', 'acled'),
      incident('i3', 30.5, 32.3, NOW - 8 * DAY_MS, 'high'), // outside 7d window
      incident('i4', 50.0, 30.0, NOW - DAY_MS, 'high'), // far away
    ],
  }));
  assert.equal(status.incidentCount7d, 2);
});

test('lastIncident is the most recent one within window', () => {
  const status = monitorSingleChokepoint('hormuz', input({
    incidents: [
      incident('old', 26.6, 56.5, NOW - 5 * DAY_MS, 'medium'),
      incident('new', 26.6, 56.5, NOW - 1 * DAY_MS, 'low'),
    ],
  }));
  assert.equal(status.lastIncident?.id, 'new');
});

test('no incidents → green threat level + closureRisk 0', () => {
  const status = monitorSingleChokepoint('panama', input({}));
  assert.equal(status.threatLevel, 'green');
  assert.equal(status.closureRisk, 0);
  assert.equal(status.lastIncident, null);
});

test('one fresh critical incident pushes threat level past green', () => {
  const status = monitorSingleChokepoint('bab-el-mandeb', input({
    incidents: [incident('houthi', 12.6, 43.4, NOW - 6 * HOUR_MS, 'critical', 'acled')],
  }));
  assert.notEqual(status.threatLevel, 'green');
  assert.ok(status.closureRisk >= 16);
});

test('multiple critical incidents → red threat level', () => {
  const incidents: ChokepointIncident[] = [];
  for (let i = 0; i < 5; i++) {
    incidents.push(incident(`c${i}`, 12.65, 43.4, NOW - (i + 1) * HOUR_MS, 'critical', 'acled'));
  }
  const status = monitorSingleChokepoint('bab-el-mandeb', input({ incidents }));
  assert.equal(status.threatLevel, 'red');
  assert.ok(status.closureRisk >= 71);
});

test('older incidents contribute less than fresh ones (recency decay)', () => {
  const fresh = monitorSingleChokepoint('hormuz', input({
    incidents: [incident('a', 26.6, 56.5, NOW - 6 * HOUR_MS, 'high', 'gdacs')],
  }));
  const stale = monitorSingleChokepoint('hormuz', input({
    incidents: [incident('a', 26.6, 56.5, NOW - 6 * DAY_MS, 'high', 'gdacs')],
  }));
  assert.ok(fresh.closureRisk > stale.closureRisk,
    `fresh=${fresh.closureRisk} stale=${stale.closureRisk}`);
});

test('military density adds to closure risk', () => {
  const noMil = monitorSingleChokepoint('hormuz', input({
    incidents: [incident('a', 26.6, 56.5, NOW - HOUR_MS, 'medium')],
  }));
  const withMil = monitorSingleChokepoint('hormuz', input({
    incidents: [incident('a', 26.6, 56.5, NOW - HOUR_MS, 'medium')],
    vessels: [
      vessel('m1', 26.6, 56.5, NOW, true),
      vessel('m2', 26.62, 56.51, NOW, true),
      vessel('m3', 26.65, 56.49, NOW, true),
    ],
  }));
  assert.ok(withMil.closureRisk > noMil.closureRisk);
});

test('closureRisk is clamped to 0..100', () => {
  const incidents: ChokepointIncident[] = [];
  for (let i = 0; i < 50; i++) {
    incidents.push(incident(`c${i}`, 26.6, 56.5, NOW - HOUR_MS, 'critical', 'acled'));
  }
  const vessels = Array.from({ length: 20 }, (_, i) =>
    vessel(`m${i}`, 26.6, 56.5, NOW, true));
  const status = monitorSingleChokepoint('hormuz', input({ incidents, vessels }));
  assert.ok(status.closureRisk <= 100);
  assert.ok(status.closureRisk >= 0);
});

test('drivers list mentions incident count and military presence', () => {
  const status = monitorSingleChokepoint('hormuz', input({
    incidents: [
      incident('a', 26.6, 56.5, NOW - HOUR_MS, 'high'),
      incident('b', 26.6, 56.5, NOW - 2 * HOUR_MS, 'medium'),
    ],
    vessels: [vessel('m', 26.6, 56.5, NOW, true)],
  }));
  assert.ok(status.drivers.some((d) => /incident/i.test(d)));
  assert.ok(status.drivers.some((d) => /military/i.test(d)));
});

test('source weight: ACLED > GDACS > AIS disruption for same severity', () => {
  function s(source: ChokepointIncident['source']): number {
    return monitorSingleChokepoint('hormuz', input({
      incidents: [incident('x', 26.6, 56.5, NOW - HOUR_MS, 'medium', source)],
    })).closureRisk;
  }
  assert.ok(s('acled') >= s('gdacs'));
  assert.ok(s('gdacs') >= s('ais_disruption'));
});

// ── Aggregate ────────────────────────────────────────────────────────────────

test('monitorChokepoints returns 6 statuses in stable id order', () => {
  const all = monitorChokepoints(input({}));
  assert.equal(all.length, 6);
  const ids = all.map((s) => s.id);
  assert.deepEqual(ids, CHOKEPOINT_IDS);
});

test('monitorChokepoints isolates inputs per chokepoint', () => {
  const all = monitorChokepoints(input({
    incidents: [incident('hormuz-only', 26.6, 56.5, NOW - HOUR_MS, 'high')],
  }));
  const hormuz = all.find((s) => s.id === 'hormuz')!;
  const suez = all.find((s) => s.id === 'suez')!;
  assert.ok(hormuz.incidentCount7d > 0);
  assert.equal(suez.incidentCount7d, 0);
});

test('threat level thresholds are monotonic', () => {
  const order = { green: 0, yellow: 1, orange: 2, red: 3 } as const;
  function levelAt(weighted: number) {
    const incidents: ChokepointIncident[] = [];
    for (let i = 0; i < weighted; i++) {
      incidents.push(incident(`c${i}`, 26.6, 56.5, NOW - HOUR_MS, 'medium', 'gdacs'));
    }
    return monitorSingleChokepoint('hormuz', input({ incidents })).threatLevel;
  }
  const a = order[levelAt(0)];
  const b = order[levelAt(2)];
  const c = order[levelAt(5)];
  const d = order[levelAt(10)];
  assert.ok(a <= b);
  assert.ok(b <= c);
  assert.ok(c <= d);
});

test('future-dated incidents are excluded', () => {
  const status = monitorSingleChokepoint('hormuz', input({
    incidents: [incident('future', 26.6, 56.5, NOW + DAY_MS, 'critical')],
  }));
  assert.equal(status.incidentCount7d, 0);
});

test('input.now defaults to current time when omitted', () => {
  const status = monitorSingleChokepoint('hormuz', { vessels: [], incidents: [] });
  assert.ok(Number.isFinite(status.closureRisk));
});
