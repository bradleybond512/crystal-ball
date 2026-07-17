import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSnapshot } from '../smoke-snapshot.ts';
import type { ParsedAq } from '../smoke-parse.ts';

const HOME: ParsedAq = {
  current: { usAqi: 156, pm25: 62 },
  hourly: Array.from({ length: 12 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 6, 16, 14 + i)).toISOString(),
    usAqi: i < 6 ? 150 - i * 10 : 80,
    pm25: null,
  })),
};

test('buildSnapshot composes current, windows, days, compass, activities', () => {
  const snap = buildSnapshot({
    place: { id: 'home', name: 'Home', lat: 41.6, lon: -86.7 },
    home: HOME,
    compassParsed: [
      { point: { direction: 'S', bearingDeg: 180, radiusMi: 60, lat: 40.7, lon: -86.7 },
        parsed: { current: { usAqi: null, pm25: null }, hourly: [{ time: 't', usAqi: 60, pm25: null }] } },
      { point: { direction: 'N', bearingDeg: 0, radiusMi: 60, lat: 42.5, lon: -86.7 }, parsed: null },
    ],
    doneChecklistIds: ['hvac-recirculate'],
    sensitiveGroup: false,
    now: Date.UTC(2026, 6, 16, 14),
  });
  assert.equal(snap.current.category, 'unhealthy');
  assert.ok(snap.safeWindows.length >= 1);       // the 80s tail
  assert.ok(snap.days.length >= 1);
  assert.equal(snap.compass[0]!.direction, 'S'); // cleaner ranks first
  assert.equal(snap.compass.at(-1)!.avgAqi6h, null);
  assert.equal(snap.activities.length, 6);
  assert.equal(snap.sources[0]!.id, 'smoke_forecast');
});

test('empty forecast → source not ok, honest detail', () => {
  const snap = buildSnapshot({
    place: { id: 'home', name: 'Home', lat: 41.6, lon: -86.7 },
    home: { current: { usAqi: null, pm25: null }, hourly: [] },
    compassParsed: [],
    doneChecklistIds: [],
    sensitiveGroup: false,
    now: 0,
  });
  assert.equal(snap.current.category, 'unknown');
  assert.equal(snap.sources[0]!.ok, false);
  assert.match(snap.sources[0]!.detail ?? '', /no forecast/i);
});

test('all-null forecast rows → source not ok (matches fetcher fail-closed rule)', () => {
  const snap = buildSnapshot({
    place: { id: 'home', name: 'Home', lat: 41.6, lon: -86.7 },
    home: { current: { usAqi: null, pm25: null }, hourly: [{ time: 't1', usAqi: null, pm25: null }, { time: 't2', usAqi: null, pm25: null }] },
    compassParsed: [],
    doneChecklistIds: [],
    sensitiveGroup: false,
    now: 0,
  });
  assert.equal(snap.sources[0]!.ok, false);
  assert.match(snap.sources[0]!.detail ?? '', /no forecast/i);
});
