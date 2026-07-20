import assert from 'node:assert/strict';
import test from 'node:test';

import { computeSafeWindows, computeDaySummaries } from '../safe-windows.ts';
import type { AqiSample } from '../smoke-types.ts';

function hours(startIso: string, aqis: (number | null)[]): AqiSample[] {
  const start = new Date(startIso).getTime();
  return aqis.map((usAqi, i) => ({
    time: new Date(start + i * 3_600_000).toISOString(),
    usAqi,
    pm25: null,
  }));
}

test('finds contiguous safe windows below the threshold and the worst window', () => {
  // 6 hours: 80,90 (safe) | 160,170,150 (bad) | 95 (safe)
  const samples = hours('2026-07-17T06:00:00Z', [80, 90, 160, 170, 150, 95]);
  const { safeWindows, worstWindow } = computeSafeWindows(samples, 100);
  assert.equal(safeWindows.length, 2);
  assert.equal(safeWindows[0]!.peakAqi, 90);
  assert.equal(worstWindow?.peakAqi, 170);
});

test('all-bad day → no safe windows; all-good day → one window, no worst', () => {
  const bad = computeSafeWindows(hours('2026-07-17T00:00:00Z', [160, 180, 200]), 100);
  assert.equal(bad.safeWindows.length, 0);
  assert.equal(bad.worstWindow?.peakAqi, 200);
  const good = computeSafeWindows(hours('2026-07-17T00:00:00Z', [40, 50, 60]), 100);
  assert.equal(good.safeWindows.length, 1);
  assert.equal(good.worstWindow, null);
});

test('null samples break windows (no data ≠ safe)', () => {
  const { safeWindows } = computeSafeWindows(hours('2026-07-17T00:00:00Z', [40, null, 40]), 100);
  assert.equal(safeWindows.length, 2);
});

test('day summaries group by date with max + headline', () => {
  const samples = [
    ...hours('2026-07-17T20:00:00Z', [90, 120]),
    ...hours('2026-07-18T10:00:00Z', [170, 160]),
  ];
  const days = computeDaySummaries(samples);
  assert.equal(days.length, 2);
  assert.equal(days[1]!.maxAqi, 170);
  assert.equal(days[1]!.category, 'unhealthy');
  assert.match(days[1]!.headline, /unhealthy/i);
  assert.match(days[1]!.headline, /170/);
});
