import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeSmokeEvent, settleEdge } from '../smoke-callout-bridge.ts';
import { buildSnapshot } from '../smoke-snapshot.ts';
import type { ParsedAq } from '../smoke-parse.ts';
import type { IncomingEvent } from '@/services/personal/personal-impact';

function snap(usAqi: number | null) {
  const home: ParsedAq = { current: { usAqi, pm25: null }, hourly: [{ time: '2026-07-17T02:00:00Z', usAqi: usAqi ?? 100, pm25: null }] };
  return buildSnapshot({
    place: { id: 'home', name: 'La Porte', lat: 41.6, lon: -86.7 },
    home,
    compassParsed: [],
    doneChecklistIds: [],
    sensitiveGroup: false,
    now: 0,
  });
}

const OTHER: IncomingEvent = { eventId: 'w1', description: 'Flood Warning', domain: 'weather', severity: 80, at: 0 };

test('publishes one smoke event above the floor, replacing any prior one', () => {
  const first = mergeSmokeEvent([OTHER], snap(160), 0, 1000);
  assert.equal(first.events.length, 2);
  const again = mergeSmokeEvent(first.events, snap(320), 0, 2000);
  assert.equal(again.events.length, 2, 'replaced, not stacked');
  const smoke = again.events.find((e) => e.eventId === 'smoke-home')!;
  assert.match(smoke.description, /Hazardous/);
  assert.equal(smoke.location?.latitude, 41.6);
});

test('withdraws the smoke event when conditions drop below the floor', () => {
  const active = mergeSmokeEvent([OTHER], snap(160), 0, 1000);
  const cleared = mergeSmokeEvent(active.events, snap(60), 0, 2000);
  assert.equal(cleared.events.length, 1);
  assert.equal(cleared.headlineSeverity, null);
});

test('no snapshot → other events untouched, smoke removed', () => {
  const seeded: IncomingEvent[] = [OTHER, { eventId: 'smoke-home', description: 'x', domain: 'weather', severity: 80, at: 0 }];
  const out = mergeSmokeEvent(seeded, undefined, 0, 1000);
  assert.deepEqual(out.events.map((e) => e.eventId), ['w1']);
});

test('edge policy: a live advisory ratchets the edge DOWN so the next episode notifies', () => {
  // Unhealthy episode delivered (edge 3), then air clears to good while the
  // incoming-smoke advisory keeps the headline non-null: the edge must fall
  // to 0 so the predicted episode's Unhealthy crossing notifies again
  // (independent-review finding #2 — advisory must not swallow it).
  assert.equal(settleEdge(0, 3), 0);
  // Steady state and worsening never move the edge via settle.
  assert.equal(settleEdge(3, 3), 3);
  assert.equal(settleEdge(2, 1), 1);
});
