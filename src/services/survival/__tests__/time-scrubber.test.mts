import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScrubber, seekTo, seekToNow, seekFraction, cursorFraction, nowFraction,
  zone, togglePlay, setSpeed, advance, shouldTick, type ScrubberState,
} from '../time-scrubber.ts';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function base(): ScrubberState {
  // 24h past window, 48h future window.
  return createScrubber(NOW, { pastSpanMs: 24 * HOUR, futureSpanMs: 48 * HOUR });
}

test('createScrubber anchors the window and parks the cursor on now, paused', () => {
  const s = base();
  assert.equal(s.startMs, NOW - 24 * HOUR);
  assert.equal(s.nowMs, NOW);
  assert.equal(s.endMs, NOW + 48 * HOUR);
  assert.equal(s.cursorMs, NOW);
  assert.equal(s.playing, false);
  assert.equal(s.speed, 1);
});

test('seekTo clamps within the window', () => {
  const s = base();
  assert.equal(seekTo(s, s.startMs - HOUR).cursorMs, s.startMs);
  assert.equal(seekTo(s, s.endMs + HOUR).cursorMs, s.endMs);
  assert.equal(seekTo(s, NOW - HOUR).cursorMs, NOW - HOUR);
});

test('zone reports past / now / future by cursor position', () => {
  const s = base();
  assert.equal(zone(seekTo(s, NOW - 5 * HOUR)), 'past');
  assert.equal(zone(seekTo(s, NOW + 5 * HOUR)), 'future');
  assert.equal(zone(seekTo(s, NOW)), 'now');
  // within tolerance still reads 'now'
  assert.equal(zone(seekTo(s, NOW + 30_000)), 'now');
  assert.equal(zone(seekTo(s, NOW + 90_000)), 'future');
});

test('cursorFraction / nowFraction map positions to 0..1', () => {
  const s = base(); // span = 72h; now sits at 24/72 = 1/3
  assert.ok(Math.abs(nowFraction(s) - 1 / 3) < 1e-9);
  assert.ok(Math.abs(cursorFraction(s) - 1 / 3) < 1e-9); // cursor parked on now
  assert.equal(cursorFraction(seekTo(s, s.startMs)), 0);
  assert.equal(cursorFraction(seekTo(s, s.endMs)), 1);
});

test('seekFraction is the inverse of cursorFraction', () => {
  const s = base();
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(cursorFraction(seekFraction(s, f)) - f) < 1e-9);
  }
  // out-of-range fraction is clamped
  assert.equal(cursorFraction(seekFraction(s, 2)), 1);
  assert.equal(cursorFraction(seekFraction(s, -1)), 0);
});

test('seekToNow parks on now and stops playback', () => {
  const played = { ...base(), playing: true, cursorMs: NOW - 10 * HOUR };
  const s = seekToNow(played);
  assert.equal(s.cursorMs, NOW);
  assert.equal(s.playing, false);
});

test('togglePlay flips playing; from the end it restarts at window start', () => {
  const s = base();
  assert.equal(togglePlay(s).playing, true);
  assert.equal(togglePlay(togglePlay(s)).playing, false);
  const atEnd = seekTo(s, s.endMs);
  const restarted = togglePlay(atEnd);
  assert.equal(restarted.playing, true);
  assert.equal(restarted.cursorMs, s.startMs);
});

test('setSpeed accepts positive finite speeds and ignores bad ones', () => {
  const s = base();
  assert.equal(setSpeed(s, 4).speed, 4);
  assert.equal(setSpeed(s, 0).speed, 1); // ignored → keeps prior
  assert.equal(setSpeed(s, -2).speed, 1);
  assert.equal(setSpeed(s, Number.NaN).speed, 1);
});

test('advance moves the cursor by wall*speed while playing; no-op when paused', () => {
  const paused = seekTo(base(), NOW);
  assert.equal(advance(paused, 1000).cursorMs, NOW); // paused → unchanged
  const playing = { ...paused, playing: true, speed: 60 }; // 60× speed
  const after = advance(playing, 1000); // 1s wall → 60s timeline
  assert.equal(after.cursorMs, NOW + 60_000);
});

test('advance stops (playing=false) and pins to end when it reaches the far future', () => {
  const s = { ...base(), playing: true, speed: 1e9, cursorMs: NOW };
  const after = advance(s, 1000);
  assert.equal(after.cursorMs, s.endMs);
  assert.equal(after.playing, false);
});

test('shouldTick gates on playing + visible + throttle interval', () => {
  const playing: ScrubberState = { ...base(), playing: true };
  const paused = base();
  // paused → never ticks
  assert.equal(shouldTick(paused, { visible: true, nowMs: NOW, lastTickMs: null, minIntervalMs: 100 }), false);
  // hidden → never ticks (idle-CPU discipline)
  assert.equal(shouldTick(playing, { visible: false, nowMs: NOW, lastTickMs: null, minIntervalMs: 100 }), false);
  // playing + visible + never ticked → ticks
  assert.equal(shouldTick(playing, { visible: true, nowMs: NOW, lastTickMs: null, minIntervalMs: 100 }), true);
  // within throttle window → no tick
  assert.equal(shouldTick(playing, { visible: true, nowMs: NOW, lastTickMs: NOW - 50, minIntervalMs: 100 }), false);
  // past throttle window → tick
  assert.equal(shouldTick(playing, { visible: true, nowMs: NOW, lastTickMs: NOW - 150, minIntervalMs: 100 }), true);
});

test('non-finite inputs never produce NaN state (speed / elapsed guards)', () => {
  // Infinity speed at creation → falls back to 1.
  const inf = createScrubber(NOW, { pastSpanMs: HOUR, futureSpanMs: HOUR, speed: Number.POSITIVE_INFINITY });
  assert.equal(inf.speed, 1);
  // NaN elapsed → no-op (cursor stays finite).
  const playing = { ...base(), playing: true };
  const after = advance(playing, Number.NaN);
  assert.equal(after.cursorMs, playing.cursorMs);
  assert.ok(Number.isFinite(after.cursorMs));
});

test('all operations are immutable (never mutate the input state)', () => {
  const s = base();
  const snapshot = { ...s };
  seekTo(s, NOW - HOUR); seekFraction(s, 0.9); togglePlay(s); advance({ ...s, playing: true }, 1000);
  assert.deepEqual(s, snapshot);
});

test('a degenerate zero-span window never divides by zero', () => {
  const z = createScrubber(NOW, { pastSpanMs: 0, futureSpanMs: 0 });
  assert.equal(cursorFraction(z), 0);
  assert.equal(nowFraction(z), 0);
  assert.equal(zone(z), 'now');
});
