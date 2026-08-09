import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://127.0.0.1/' });
(globalThis as unknown as { window: Window }).window = window;

const { arrivalProgress, coronaPhase } = await import('../arrival-choreography.ts');

test('arrival progress stays inside the drawable range', () => {
  assert.equal(arrivalProgress(900, 1_000, 2_000), 0);
  assert.equal(arrivalProgress(2_000, 1_000, 2_000), 0.5);
  assert.equal(arrivalProgress(4_000, 1_000, 2_000), 1);
});

test('corona phase is deterministic, bounded, and location-sensitive', () => {
  const first = coronaPhase(41.7075, -86.895);
  const repeated = coronaPhase(41.7075, -86.895);
  const nearby = coronaPhase(41.7085, -86.895);

  assert.equal(repeated, first);
  assert.ok(first >= 0 && first < Math.PI * 2);
  assert.notEqual(nearby, first);
});
