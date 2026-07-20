import assert from 'node:assert/strict';
import test from 'node:test';

import { linearSlope, volatility, computeMomentum, type TimeSample } from '../momentum.ts';

const NOW = 1_745_000_000_000;
const DAY = 86_400_000;

function ramp(perDay: number, days: number, start = 0): TimeSample[] {
  const out: TimeSample[] = [];
  for (let i = 0; i < days; i += 1) out.push({ t: NOW + i * DAY, v: start + perDay * i });
  return out;
}

test('linearSlope recovers a clean per-day slope', () => {
  const s = linearSlope(ramp(5, 6, 100)); // +5/day
  assert.ok(Math.abs(s.perDay - 5) < 1e-6, `perDay ${s.perDay}`);
  assert.ok(s.rSquared > 0.999, 'clean ramp is near-perfectly linear');
  assert.equal(s.n, 6);
});

test('linearSlope is zero/degenerate with <2 samples', () => {
  assert.equal(linearSlope([{ t: NOW, v: 1 }]).perDay, 0);
  assert.equal(linearSlope([]).perDay, 0);
});

test('a fast spike scores higher momentum than a slow climb of equal total move', () => {
  // Both rise 20 points total: fast over 2 days, slow over 20 days.
  const fast = computeMomentum(ramp(10, 3, 50), { riseScalePerDay: 10 });
  const slow = computeMomentum(ramp(1, 21, 50), { riseScalePerDay: 10 });
  assert.ok(fast.momentumScore > slow.momentumScore, `${fast.momentumScore} !> ${slow.momentumScore}`);
  assert.equal(fast.direction, 'surging');
  assert.equal(slow.direction, 'rising');
});

test('flat series reads flat with ~0 momentum', () => {
  const m = computeMomentum([
    { t: NOW, v: 50 }, { t: NOW + DAY, v: 50 }, { t: NOW + 2 * DAY, v: 50 },
  ], { riseScalePerDay: 10 });
  assert.equal(m.direction, 'flat');
  assert.ok(m.momentumScore < 1);
});

test('falling series is detected', () => {
  const m = computeMomentum(ramp(-3, 6, 100), { riseScalePerDay: 10 });
  assert.equal(m.direction, 'falling');
  assert.ok(m.slopePerDay < 0);
});

test('volatility is zero for a perfectly steady ramp and positive for a jagged series', () => {
  assert.ok(volatility(ramp(5, 6, 0)) < 1e-9, 'steady ramp has constant deltas → 0 volatility');
  const jagged = [
    { t: NOW, v: 0 }, { t: NOW + DAY, v: 10 }, { t: NOW + 2 * DAY, v: 0 }, { t: NOW + 3 * DAY, v: 10 },
  ];
  assert.ok(volatility(jagged) > 1, 'alternating series is volatile');
});

test('confidence rises with sample count and linearity', () => {
  const few = computeMomentum(ramp(5, 2, 0), { minSamples: 6 });
  const many = computeMomentum(ramp(5, 6, 0), { minSamples: 6 });
  assert.ok(many.confidence > few.confidence);
  assert.ok(many.confidence <= 1 && few.confidence >= 0);
});

test('momentum is order-independent (samples sorted internally)', () => {
  const asc = computeMomentum(ramp(4, 6, 0));
  const desc = computeMomentum([...ramp(4, 6, 0)].reverse());
  assert.ok(Math.abs(asc.slopePerDay - desc.slopePerDay) < 1e-6);
});
