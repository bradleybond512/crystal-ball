import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  episodeMarker,
  mergeActionDayEvents,
  decideActionDayNotifications,
  type ActionDayInput,
} from '../air-quality-callout-bridge.ts';
import type { IncomingEvent } from '@/services/personal/personal-impact';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

function input(over: Partial<ActionDayInput> = {}): ActionDayInput {
  return {
    placeId: 'home', placeName: 'La Porte', lat: 41.6, lon: -86.7,
    actionDay: true, peakAqi: 160, reportingArea: 'Northwest Indiana',
    source: 'airnow', at: NOW, ...over,
  };
}

// ── mergeActionDayEvents ──────────────────────────────────────────────────

test('mergeActionDayEvents: publishes one event per active action-day place', () => {
  const events = mergeActionDayEvents([], [input()], NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.eventId, 'airnow-actionday-home');
  assert.equal(events[0]!.domain, 'weather');
  assert.equal(events[0]!.location?.latitude, 41.6);
});

test('mergeActionDayEvents: withdraws cleared places, preserves non-airnow events', () => {
  const other: IncomingEvent = { eventId: 'smoke-home', description: 's', domain: 'weather', severity: 80, at: NOW };
  const withEvent = mergeActionDayEvents([other], [input()], NOW);
  assert.equal(withEvent.length, 2);
  // action day clears → the airnow event is withdrawn, the smoke event survives
  const cleared = mergeActionDayEvents(withEvent, [input({ actionDay: false })], NOW);
  assert.equal(cleared.filter((e) => e.eventId.startsWith('airnow-actionday-')).length, 0);
  assert.equal(cleared.some((e) => e.eventId === 'smoke-home'), true);
});

test('mergeActionDayEvents: fail-soft — a place absent from inputs keeps its event', () => {
  // home + work both have active action days
  const seeded = mergeActionDayEvents([], [input({ placeId: 'home' }), input({ placeId: 'work' })], NOW);
  assert.equal(seeded.length, 2);
  // next cycle only home is fetched (work's fetch failed → absent from inputs)
  const next = mergeActionDayEvents(seeded, [input({ placeId: 'home' })], NOW + 60_000);
  // work's event must survive rather than be withdrawn as if it had cleared
  assert.equal(next.some((e) => e.eventId === 'airnow-actionday-work'), true);
  assert.equal(next.some((e) => e.eventId === 'airnow-actionday-home'), true);
});

// ── episodeMarker ─────────────────────────────────────────────────────────

test('episodeMarker: encodes source + peak AQI for observability', () => {
  assert.equal(episodeMarker({ source: 'airnow', peakAqi: 160 }), 'airnow:160');
  assert.equal(episodeMarker({ source: 'enviroflash-cap', peakAqi: null }), 'enviroflash-cap:na');
});

// ── decideActionDayNotifications ──────────────────────────────────────────

test('fires a notification for a newly declared action day (edge deferred to delivery)', () => {
  const { toNotify, baseEdge } = decideActionDayNotifications([input()], {}, 0);
  assert.equal(toNotify.length, 1);
  assert.equal(toNotify[0]!.placeId, 'home');
  assert.equal(toNotify[0]!.severity, 'high');
  assert.equal(toNotify[0]!.marker, episodeMarker(input()));
  // the base edge does NOT yet mark home handled — the runtime commits that only
  // once the notification is actually delivered, so quiet-hours blocks retry.
  assert.equal('home' in baseEdge, false);
});

test('does not re-fire while the run is active (edge already present, any value)', () => {
  const edge = { home: 'airnow:120' };
  const { toNotify } = decideActionDayNotifications([input()], edge, 0);
  assert.equal(toNotify.length, 0);
});

test('re-fires only after the run lifts and is re-declared', () => {
  // delivered → edge present
  const active = { home: episodeMarker(input()) };
  // day 2, still active → no re-fire (run-based, not calendar-based)
  assert.equal(decideActionDayNotifications([input({ at: NOW + DAY_MS })], active, 0).toNotify.length, 0);
  // action day lifts → edge cleared
  const { baseEdge } = decideActionDayNotifications([input({ actionDay: false })], active, 0);
  assert.equal('home' in baseEdge, false);
  // a fresh declaration after the clear re-notifies
  assert.equal(decideActionDayNotifications([input({ at: NOW + 3 * DAY_MS })], baseEdge, 0).toNotify.length, 1);
});

test('UNIFIED dedupe: suppresses the native notification when smoke already alerted Unhealthy+', () => {
  // smokeRank 3 = smoke callout already delivered Unhealthy — don't double-notify.
  const { toNotify, baseEdge } = decideActionDayNotifications([input()], {}, 3);
  assert.equal(toNotify.length, 0);
  // but the run is still marked handled so it won't fire later either
  assert.equal(baseEdge.home, episodeMarker(input()));
});

test('clears the edge when an action day is withdrawn (so the next re-notifies)', () => {
  const edge = { home: 'stale-marker' };
  const { baseEdge } = decideActionDayNotifications([input({ actionDay: false })], edge, 0);
  assert.equal('home' in baseEdge, false);
});

test('critical severity for hazardous AQI, high otherwise', () => {
  assert.equal(decideActionDayNotifications([input({ peakAqi: 320 })], {}, 0).toNotify[0]!.severity, 'critical');
  assert.equal(decideActionDayNotifications([input({ peakAqi: 160 })], {}, 0).toNotify[0]!.severity, 'high');
});

test('fans out over multiple places independently', () => {
  const inputs = [input({ placeId: 'home' }), input({ placeId: 'work', placeName: 'Chicago', actionDay: false })];
  const { toNotify, baseEdge } = decideActionDayNotifications(inputs, {}, 0);
  assert.equal(toNotify.length, 1);
  assert.equal(toNotify[0]!.placeId, 'home');
  assert.equal('work' in baseEdge, false);
});
