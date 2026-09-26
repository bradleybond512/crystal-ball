import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bridge from '../intel-channels-bridge.ts';
import { parseStormReportPayload, toStormReportBatch, type StormReport } from '../spc-outlook.ts';

const FETCHED_AT = Date.parse('2026-09-25T12:00:00Z');

function report(overrides: Partial<StormReport> = {}): StormReport {
  return {
    id: 'lsr-0-35.220--97.440',
    type: 'tornado',
    magnitude: '0',
    location: 'Norman',
    county: 'Cleveland',
    state: 'OK',
    lat: 35.22,
    lon: -97.44,
    reportedAt: new Date('2026-09-25T11:30:00Z'),
    remarks: 'Brief tornado report',
    severity: 'critical',
    ...overrides,
  };
}

function feature(valid: string, coordinates = [-97.44, 35.22]) {
  return {
    type: 'Feature',
    properties: {
      type: 'T', magnitude: 0, city: 'Norman', county: 'Cleveland', state: 'OK',
      valid, remark: 'Brief tornado report',
    },
    geometry: { type: 'Point', coordinates },
  };
}

test('LSR alert IDs survive raw row reordering while outcome IDs stay unchanged', () => {
  const features = [feature('2026-09-25T11:30:00Z'), feature('2026-09-25T11:45:00Z')];
  const original = parseStormReportPayload({ type: 'FeatureCollection', features }, FETCHED_AT);
  const reordered = parseStormReportPayload({ type: 'FeatureCollection', features: [...features].reverse() }, FETCHED_AT);
  assert.notEqual(original.items[0]!.id, reordered.items[0]!.id);
  assert.equal(toStormReportBatch(original).reports[0]!.id, 'lsr-0-35.220--97.440');
  const before = original.items.map((item) => bridge.stormReportToAlert(item));
  const after = reordered.items.map((item) => bridge.stormReportToAlert(item));
  assert.deepEqual(before, after);
  assert.equal(new Set(before.map((alert) => alert!.id)).size, 2);
});

test('same title and locality at different report times remain separate alerts', () => {
  const first = bridge.stormReportToAlert(report());
  const second = bridge.stormReportToAlert(report({ reportedAt: new Date('2026-09-25T11:45:00Z') }));
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.title, second.title);
  assert.notEqual(first.id, second.id);
});

test('delayed reports keep their event time and identity without invented freshness', () => {
  const delayed = report({ reportedAt: new Date('2000-01-01T00:00:00Z'), remarks: '' });
  const alert = bridge.stormReportToAlert(delayed);
  assert.ok(alert);
  assert.equal(alert.timestamp, delayed.reportedAt.getTime());
  assert.equal(alert.body, delayed.location);
  assert.equal(bridge.stormReportToAlert({ ...delayed, id: 'later-fetch-row' })!.id, alert.id);
});

test('exact coordinates and undisplayed report content distinguish reports', () => {
  const base = report({ remarks: 'a'.repeat(301) });
  const original = bridge.stormReportToAlert(base)!;
  for (const change of [
    { lat: base.lat + 0.00001 }, { lon: base.lon + 0.00001 },
    { type: 'hail' as const }, { magnitude: '1' }, { location: 'Moore' },
    { county: 'Other' }, { state: 'TX' }, { remarks: `${'a'.repeat(300)}b` },
  ]) {
    assert.notEqual(bridge.stormReportToAlert({ ...base, ...change })!.id, original.id);
  }
  assert.equal(bridge.stormReportToAlert({ ...base, id: 'row-position-changed' })!.id, original.id);
});

test('valid zero coordinates and a zero magnitude keep source chronology and presentation', () => {
  const alert = bridge.stormReportToAlert(report({ lat: 0, lon: 0 }));
  assert.ok(alert);
  assert.deepEqual(alert.location, { lat: 0, lon: 0 });
  assert.equal(alert.timestamp, Date.parse('2026-09-25T11:30:00Z'));
  assert.equal(alert.title, 'TORNADO 0 — Cleveland, OK');
  assert.equal(alert.source, 'spc');
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.body, 'Brief tornado report');
  assert.equal(alert.relevanceScore, 85);
  assert.equal(alert.acknowledged, false);
  assert.equal(alert.pinned, false);
});

test('malformed identity inputs are skipped without blocking neighboring valid reports', () => {
  const malformed = [
    { reportedAt: new Date(NaN) }, { lat: NaN }, { lon: Infinity },
    { lat: 90.01 }, { lat: -90.01 }, { lon: 180.01 }, { lon: -180.01 },
    { type: 'constructor' }, { type: undefined }, { remarks: undefined },
    { severity: 'unknown' }, { severity: undefined }, { magnitude: 0 },
    { reportedAt: '2026-09-25T11:30:00Z' },
  ];
  for (const change of malformed) {
    assert.equal(bridge.stormReportToAlert({ ...report(), ...change } as StormReport), null);
  }
  const alerts = [report({ lat: NaN }), report()].map(bridge.stormReportToAlert).filter(Boolean);
  assert.equal(alerts.length, 1);
});

test('oversized identity content is rejected instead of truncated to a shared ID', () => {
  for (const key of ['magnitude', 'location', 'county', 'state', 'remarks'] as const) {
    assert.equal(bridge.stormReportToAlert(report({ [key]: 'x'.repeat(20_000) })), null);
  }
});

test('low severity reports keep their existing exclusion and do not create alerts', () => {
  assert.equal(bridge.stormReportToAlert(report({ severity: 'low', type: 'other' })), null);
});
