import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stepScrubber } from '../scrubber-loop.ts';
import { createScrubber, togglePlay, type ScrubberState, type TickGate } from '../time-scrubber.ts';

const NOW = 1_784_000_000_000;
function playing(): ScrubberState {
  return togglePlay(createScrubber(NOW, { pastSpanMs: 60_000, futureSpanMs: 60_000, speed: 1 }));
}
function gate(over: Partial<TickGate> = {}): TickGate {
  return { visible: true, nowMs: NOW, lastTickMs: null, minIntervalMs: 100, ...over };
}

test('stepScrubber: paused board never ticks (zero CPU)', () => {
  const paused = createScrubber(NOW, { pastSpanMs: 60_000, futureSpanMs: 60_000 });
  const r = stepScrubber(paused, gate({ lastTickMs: NOW - 10_000 }));
  assert.equal(r.ticked, false);
  assert.equal(r.state, paused); // unchanged reference
  assert.equal(r.nextLastTickMs, NOW - 10_000); // carries the gate value through
});

test('stepScrubber: hidden board never ticks even while playing', () => {
  const r = stepScrubber(playing(), gate({ visible: false, lastTickMs: NOW - 10_000 }));
  assert.equal(r.ticked, false);
});

test('stepScrubber: throttled — no tick until minIntervalMs elapses', () => {
  const g = gate({ lastTickMs: NOW - 50, nowMs: NOW, minIntervalMs: 100 }); // only 50ms since last
  const r = stepScrubber(playing(), g);
  assert.equal(r.ticked, false);
  assert.equal(r.nextLastTickMs, NOW - 50);
});

test('stepScrubber: first tick (lastTickMs null) advances zero, records now', () => {
  const s = playing();
  const r = stepScrubber(s, gate({ lastTickMs: null, nowMs: NOW }));
  assert.equal(r.ticked, true);
  assert.equal(r.state.cursorMs, s.cursorMs); // no jump on the first frame
  assert.equal(r.nextLastTickMs, NOW);
});

test('stepScrubber: subsequent tick advances by the real wall delta × speed', () => {
  const s = { ...playing(), cursorMs: NOW }; // parked at now
  const r = stepScrubber(s, gate({ lastTickMs: NOW, nowMs: NOW + 250, minIntervalMs: 100 }));
  assert.equal(r.ticked, true);
  assert.equal(r.state.cursorMs, NOW + 250); // speed 1 → +250ms
  assert.equal(r.nextLastTickMs, NOW + 250);
});

test('stepScrubber: 2× speed advances twice as fast', () => {
  const base = createScrubber(NOW, { pastSpanMs: 60_000, futureSpanMs: 60_000, speed: 2 });
  const s = { ...togglePlay(base), cursorMs: NOW };
  const r = stepScrubber(s, gate({ lastTickMs: NOW, nowMs: NOW + 200, minIntervalMs: 100 }));
  assert.equal(r.state.cursorMs, NOW + 400);
});

test('stepScrubber: reaching the end stops playback', () => {
  const s = { ...playing(), cursorMs: NOW + 59_900 }; // near endMs (NOW+60000)
  const r = stepScrubber(s, gate({ lastTickMs: NOW, nowMs: NOW + 1_000, minIntervalMs: 100 }));
  assert.equal(r.state.cursorMs, s.endMs);
  assert.equal(r.state.playing, false);
  assert.equal(r.ticked, true);
});

test('stepScrubber: negative/backward clock delta clamps to no advance', () => {
  const s = { ...playing(), cursorMs: NOW };
  const r = stepScrubber(s, gate({ lastTickMs: NOW + 500, nowMs: NOW, minIntervalMs: 0 }));
  // gate still passes (minInterval 0, playing, visible) but delta is negative → clamped to 0
  assert.equal(r.state.cursorMs, NOW);
});
