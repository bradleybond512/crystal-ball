import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimeOffset, scrubberCursorLabel, scrubberZoneLabel,
  scrubberTicks, scrubberThumbFraction, playButtonLabel,
} from '../scrubber-view.ts';
import { createScrubber, seekTo, togglePlay, type ScrubberState } from '../time-scrubber.ts';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function base(): ScrubberState {
  return createScrubber(NOW, { pastSpanMs: 24 * HOUR, futureSpanMs: 48 * HOUR });
}

test('formatTimeOffset: within a minute reads "now"', () => {
  assert.equal(formatTimeOffset(0), 'now');
  assert.equal(formatTimeOffset(30_000), 'now');
  assert.equal(formatTimeOffset(-30_000), 'now');
});

test('formatTimeOffset: minutes / hours / days with signed prefix', () => {
  assert.equal(formatTimeOffset(45 * 60_000), '+45m');
  assert.equal(formatTimeOffset(-6 * HOUR), '−6h');
  assert.equal(formatTimeOffset(2 * 24 * HOUR), '+2d');
  assert.equal(formatTimeOffset(-3 * 24 * HOUR), '−3d');
});

test('formatTimeOffset: non-finite → "now" (never NaN label)', () => {
  assert.equal(formatTimeOffset(Number.NaN), 'now');
  assert.equal(formatTimeOffset(Number.POSITIVE_INFINITY), 'now');
});

test('scrubberCursorLabel reflects the cursor offset from now', () => {
  const s = base();
  assert.equal(scrubberCursorLabel(s), 'now'); // parked on now
  assert.equal(scrubberCursorLabel(seekTo(s, NOW - 6 * HOUR)), '−6h');
  assert.equal(scrubberCursorLabel(seekTo(s, NOW + 24 * HOUR)), '+1d');
});

test('scrubberZoneLabel maps zone → Replay / Now / Projected', () => {
  const s = base();
  assert.equal(scrubberZoneLabel(seekTo(s, NOW - 5 * HOUR)), 'Replay');
  assert.equal(scrubberZoneLabel(seekTo(s, NOW)), 'Now');
  assert.equal(scrubberZoneLabel(seekTo(s, NOW + 5 * HOUR)), 'Projected');
});

test('scrubberThumbFraction equals the cursor fraction (0..1)', () => {
  const s = base();
  assert.ok(Math.abs(scrubberThumbFraction(s) - 1 / 3) < 1e-9); // now at 24/72
  assert.equal(scrubberThumbFraction(seekTo(s, s.startMs)), 0);
  assert.equal(scrubberThumbFraction(seekTo(s, s.endMs)), 1);
});

test('playButtonLabel flips with the playing flag', () => {
  const s = base();
  assert.equal(playButtonLabel(s), '▶');
  assert.equal(playButtonLabel(togglePlay(s)), '⏸');
});

test('scrubberTicks returns `count` ticks spanning 0..1 endpoints', () => {
  const ticks = scrubberTicks(base(), 5);
  assert.equal(ticks.length, 5);
  assert.equal(ticks[0]!.fraction, 0);
  assert.equal(ticks[4]!.fraction, 1);
  // Endpoints carry the window edges.
  assert.equal(ticks[0]!.label, '−1d');   // 24h past
  assert.equal(ticks[4]!.label, '+2d');   // 48h future
});

test('scrubberTicks clamps to at least 2 ticks (endpoints)', () => {
  assert.equal(scrubberTicks(base(), 1).length, 2);
  assert.equal(scrubberTicks(base(), 0).length, 2);
});

test('exactly one tick is flagged isNow (the one nearest the now anchor)', () => {
  const ticks = scrubberTicks(base(), 7);
  const nows = ticks.filter((t) => t.isNow);
  assert.equal(nows.length, 1);
  assert.equal(nows[0]!.label, 'now');
});

test('tick fractions are strictly increasing', () => {
  const ticks = scrubberTicks(base(), 6);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i]!.fraction > ticks[i - 1]!.fraction);
});

test('scrubberTicks with a non-finite count falls back to 2 ticks', () => {
  assert.equal(scrubberTicks(base(), Number.NaN).length, 2);
  assert.equal(scrubberTicks(base(), Number.POSITIVE_INFINITY).length, 2);
  // and still flags exactly one isNow.
  assert.equal(scrubberTicks(base(), Number.NaN).filter((t) => t.isNow).length, 1);
});

test('a zero-span window still yields safe ticks (no NaN)', () => {
  const z = createScrubber(NOW, { pastSpanMs: 0, futureSpanMs: 0 });
  const ticks = scrubberTicks(z, 3);
  assert.equal(ticks.length, 3);
  for (const t of ticks) assert.ok(Number.isFinite(t.fraction));
});
