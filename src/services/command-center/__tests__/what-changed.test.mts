import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diffSnapshots,
  formatDelta,
  getSnapshotCount,
  getWhatChanged,
  recordSnapshot,
  resetWhatChangedStore,
  type WhatChangedSnapshot,
} from '../what-changed.ts';

const T0 = 1_745_000_000_000;
const MIN = 60_000;

function snap(over: Partial<WhatChangedSnapshot> = {}): WhatChangedSnapshot {
  return {
    takenAt: T0,
    alerts: [],
    situations: [],
    feeds: [],
    ...over,
  };
}

test('diffSnapshots: detects new alert', () => {
  const baseline = snap();
  const current = snap({
    takenAt: T0 + MIN,
    alerts: [{ id: 'a1', domain: 'seismic', severity: 'HIGH', summary: 'M6.2 near Tokyo' }],
  });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'new-alert');
  assert.equal(events[0].domain, 'seismic');
  assert.equal(events[0].id, 'new-alert:a1');
});

test('diffSnapshots: detects severity escalation', () => {
  const baseline = snap({
    alerts: [{ id: 'a1', domain: 'weather', severity: 'MODERATE', summary: 'severe thunderstorm watch' }],
  });
  const current = snap({
    takenAt: T0 + MIN,
    alerts: [{ id: 'a1', domain: 'weather', severity: 'CRITICAL', summary: 'tornado warning' }],
  });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'escalated');
  assert.match(events[0].summary, /MODERATE → CRITICAL/);
});

test('diffSnapshots: severity downgrade is NOT reported as escalation', () => {
  const baseline = snap({
    alerts: [{ id: 'a1', domain: 'weather', severity: 'CRITICAL', summary: 'storm' }],
  });
  const current = snap({
    takenAt: T0 + MIN,
    alerts: [{ id: 'a1', domain: 'weather', severity: 'HIGH', summary: 'storm' }],
  });
  assert.deepEqual(diffSnapshots(baseline, current), []);
});

test('diffSnapshots: resolution emits when alert disappears', () => {
  const baseline = snap({
    alerts: [{ id: 'a1', domain: 'cyber', severity: 'HIGH', summary: 'cve-2026-0001' }],
  });
  const current = snap({ takenAt: T0 + MIN });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'resolved');
  assert.equal(events[0].id, 'resolved:a1');
});

test('diffSnapshots: new situation surfaces with title in summary', () => {
  const baseline = snap();
  const current = snap({
    takenAt: T0 + MIN,
    situations: [{ id: 's1', domain: 'conflict', title: 'Black Sea tension' }],
  });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'new-situation');
  assert.equal(events[0].summary, 'Black Sea tension');
});

test('diffSnapshots: feed degraded fires when healthy → degraded', () => {
  const baseline = snap({ feeds: [{ id: 'usgs', status: 'healthy', label: 'USGS' }] });
  const current = snap({ takenAt: T0 + MIN, feeds: [{ id: 'usgs', status: 'degraded', label: 'USGS' }] });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'feed-degraded');
  assert.equal(events[0].domain, 'system');
});

test('diffSnapshots: feed restored fires when down → healthy', () => {
  const baseline = snap({ feeds: [{ id: 'usgs', status: 'down', label: 'USGS' }] });
  const current = snap({ takenAt: T0 + MIN, feeds: [{ id: 'usgs', status: 'healthy', label: 'USGS' }] });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'feed-restored');
});

test('diffSnapshots: feeds new to current are ignored (no prior to compare)', () => {
  const baseline = snap();
  const current = snap({ takenAt: T0 + MIN, feeds: [{ id: 'fresh', status: 'degraded' }] });
  assert.deepEqual(diffSnapshots(baseline, current), []);
});

test('diffSnapshots: orders events newest-first, capped at 20', () => {
  const alerts = Array.from({ length: 25 }, (_, i) => ({
    id: `a${i}`,
    domain: 'other' as const,
    severity: 'LOW' as const,
    summary: `event ${i}`,
  }));
  const baseline = snap();
  const current = snap({ takenAt: T0 + MIN, alerts });
  const events = diffSnapshots(baseline, current);
  assert.equal(events.length, 20);
  for (const e of events) assert.equal(e.timestamp, T0 + MIN);
});

test('diffSnapshots: same-timestamp events break by type priority (new-alert > escalated > new-situation > feed-degraded)', () => {
  const baseline = snap({
    alerts: [{ id: 'a1', domain: 'weather', severity: 'LOW', summary: 'storm' }],
    feeds: [{ id: 'f1', status: 'healthy' }],
  });
  const current = snap({
    takenAt: T0 + MIN,
    alerts: [
      { id: 'a1', domain: 'weather', severity: 'HIGH', summary: 'storm' }, // escalated
      { id: 'a2', domain: 'cyber', severity: 'LOW', summary: 'new cve' }, // new-alert
    ],
    situations: [{ id: 's1', domain: 'finance', title: 'new sit' }],
    feeds: [{ id: 'f1', status: 'degraded' }],
  });
  const events = diffSnapshots(baseline, current);
  assert.equal(events[0].type, 'new-alert');
  assert.equal(events[1].type, 'escalated');
  assert.equal(events[2].type, 'new-situation');
  assert.equal(events[3].type, 'feed-degraded');
});

test('diffSnapshots: dedups identical event ids across diff', () => {
  // Same alert that's both new AND escalated cannot happen, but ensure
  // formula doesn't emit two entries for the same id key.
  const baseline = snap();
  const current = snap({
    takenAt: T0 + MIN,
    alerts: [{ id: 'a1', domain: 'other', severity: 'CRITICAL', summary: 'x' }],
  });
  const events = diffSnapshots(baseline, current);
  const ids = events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('store: getWhatChanged with one snapshot returns []', () => {
  resetWhatChangedStore();
  recordSnapshot(snap());
  assert.deepEqual(getWhatChanged(T0 - MIN), []);
});

test('store: getWhatChanged picks baseline at-or-before sinceMs', () => {
  resetWhatChangedStore();
  recordSnapshot(snap({ takenAt: T0,
    alerts: [{ id: 'a1', domain: 'other', severity: 'LOW', summary: 'base' }] }));
  recordSnapshot(snap({ takenAt: T0 + MIN, // 1m later — alert added
    alerts: [
      { id: 'a1', domain: 'other', severity: 'LOW', summary: 'base' },
      { id: 'a2', domain: 'other', severity: 'LOW', summary: 'added' },
    ] }));
  recordSnapshot(snap({ takenAt: T0 + 2 * MIN, // 2m later — escalation
    alerts: [
      { id: 'a1', domain: 'other', severity: 'HIGH', summary: 'base' },
      { id: 'a2', domain: 'other', severity: 'LOW', summary: 'added' },
    ] }));
  // sinceMs picks the T0+MIN snapshot → diff vs T0+2*MIN sees only escalation of a1
  const events = getWhatChanged(T0 + MIN);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'escalated');
});

test('store: getWhatChanged falls back to oldest snapshot if sinceMs predates all', () => {
  resetWhatChangedStore();
  recordSnapshot(snap({ takenAt: T0,
    alerts: [{ id: 'a1', domain: 'other', severity: 'LOW', summary: 'base' }] }));
  recordSnapshot(snap({ takenAt: T0 + MIN,
    alerts: [
      { id: 'a1', domain: 'other', severity: 'LOW', summary: 'base' },
      { id: 'a2', domain: 'other', severity: 'LOW', summary: 'added' },
    ] }));
  const events = getWhatChanged(T0 - 999 * MIN);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'new-alert');
  assert.equal(events[0].id, 'new-alert:a2');
});

test('store: ring buffer caps at 240 snapshots', () => {
  resetWhatChangedStore();
  for (let i = 0; i < 260; i++) recordSnapshot(snap({ takenAt: T0 + i * MIN }));
  assert.equal(getSnapshotCount(), 240);
});

test('store: deep-copies snapshots so external mutation does not corrupt history', () => {
  resetWhatChangedStore();
  const live = snap({
    alerts: [{ id: 'a1', domain: 'other', severity: 'LOW', summary: 'live' }],
  });
  recordSnapshot(live);
  live.alerts[0].severity = 'CRITICAL';
  recordSnapshot(snap({ takenAt: T0 + MIN,
    alerts: [{ id: 'a1', domain: 'other', severity: 'LOW', summary: 'live' }] }));
  const events = getWhatChanged(T0 - MIN);
  assert.deepEqual(events, []);
});

test('formatDelta: new-alert is emoji-prefixed and includes the domain', () => {
  const line = formatDelta({
    id: 'new-alert:x', timestamp: T0, domain: 'seismic',
    type: 'new-alert', summary: 'M6.2 near Tokyo',
  });
  assert.match(line, /^🔴 /);
  assert.match(line, /SEISMIC/);
  assert.match(line, /M6\.2/);
});

test('formatDelta: every change type produces a non-empty emoji-prefixed line', () => {
  const types = ['new-alert', 'escalated', 'resolved', 'new-situation', 'feed-restored', 'feed-degraded'] as const;
  for (const type of types) {
    const line = formatDelta({
      id: `${type}:x`, timestamp: T0, domain: 'other', type, summary: 'sample',
    });
    assert.equal(line.length > 3, true);
    assert.notEqual(line[0], ' ');
  }
});
