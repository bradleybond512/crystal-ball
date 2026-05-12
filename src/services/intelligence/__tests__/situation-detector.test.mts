import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MATCH_RADIUS_KM,
  MATCH_WINDOW_MS,
  buildAutoSummary,
  detect,
  findMatchingSituation,
  mapSeverity,
  maxSeverity,
  shouldAutoCreate,
} from '../situation-detector.ts';
import { __reset, getActive, getSituation } from '../situation-store.ts';
import type { ObservationEvent, Situation } from '@/types/intelligence';

const NOW = Date.parse('2026-05-11T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function observation(over: Partial<ObservationEvent> = {}): ObservationEvent {
  // Use `'location' in over` so callers can pass `location: undefined` to
  // simulate a locationless observation (??-coalescing would clobber it).
  const location = 'location' in over ? over.location : { lat: 41.6, lon: -86.7, radiusKm: 30 };
  return {
    id: over.id ?? 'obs-1',
    sourceId: over.sourceId ?? 'usgs-earthquake',
    domain: over.domain ?? 'natural',
    timestamp: over.timestamp ?? NOW,
    location,
    severity: over.severity ?? 'HIGH',
    title: over.title ?? 'M6.0 earthquake',
    raw: over.raw ?? {},
    entityIds: over.entityIds ?? [],
    tags: over.tags ?? ['earthquake'],
  };
}

function recordedDispatcher() {
  const calls: { name: string; detail: Situation }[] = [];
  return {
    fn: (name: string, detail: Situation) => calls.push({ name, detail }),
    calls,
  };
}

// ── Severity helpers ─────────────────────────────────────────────────────

test('mapSeverity: maps each uppercase ObservationSeverity to its lowercase scoring level', () => {
  assert.equal(mapSeverity('INFO'), 'info');
  assert.equal(mapSeverity('LOW'), 'low');
  assert.equal(mapSeverity('MEDIUM'), 'moderate');
  assert.equal(mapSeverity('HIGH'), 'high');
  assert.equal(mapSeverity('CRITICAL'), 'critical');
});

test('shouldAutoCreate: only HIGH / CRITICAL pass the auto-create gate', () => {
  assert.equal(shouldAutoCreate('CRITICAL'), true);
  assert.equal(shouldAutoCreate('HIGH'), true);
  assert.equal(shouldAutoCreate('MEDIUM'), false);
  assert.equal(shouldAutoCreate('LOW'), false);
  assert.equal(shouldAutoCreate('INFO'), false);
});

test('maxSeverity: keeps the stronger of two levels', () => {
  assert.equal(maxSeverity('low', 'high'), 'high');
  assert.equal(maxSeverity('critical', 'moderate'), 'critical');
  assert.equal(maxSeverity('info', 'info'), 'info');
});

// ── findMatchingSituation (pure) ─────────────────────────────────────────

test('findMatchingSituation: matches on domain + same location + within 2h window', () => {
  const sit: Situation = {
    id: 's-1', name: 'storm', status: 'active', severity: 'high',
    domain: 'natural', startedAt: NOW - 30 * 60 * 1000, updatedAt: NOW - 30 * 60 * 1000,
    observationIds: [], correlationIds: [], summary: '',
    location: { lat: 41.6, lon: -86.7, radiusKm: 80 }, tags: [], confidence: 0.7,
  };
  const hit = findMatchingSituation(observation(), [sit], NOW);
  assert.equal(hit?.id, 's-1');
});

test('findMatchingSituation: rejects situations beyond MATCH_RADIUS_KM', () => {
  const sit: Situation = {
    id: 's-far', name: 'far', status: 'active', severity: 'high',
    domain: 'natural', startedAt: NOW, updatedAt: NOW,
    observationIds: [], correlationIds: [], summary: '',
    location: { lat: -33, lon: 151, radiusKm: 50 }, tags: [], confidence: 0.7,
  };
  assert.equal(findMatchingSituation(observation(), [sit], NOW), null);
});

test('findMatchingSituation: rejects situations outside MATCH_WINDOW_MS', () => {
  const sit: Situation = {
    id: 's-stale', name: 'stale', status: 'active', severity: 'high',
    domain: 'natural', startedAt: NOW - 4 * HOUR, updatedAt: NOW - 4 * HOUR,
    observationIds: [], correlationIds: [], summary: '',
    location: { lat: 41.6, lon: -86.7, radiusKm: 80 }, tags: [], confidence: 0.7,
  };
  assert.equal(findMatchingSituation(observation(), [sit], NOW), null);
});

test('findMatchingSituation: rejects different-domain matches even at the same spot', () => {
  const sit: Situation = {
    id: 's-fin', name: 'fin', status: 'active', severity: 'high',
    domain: 'finance', startedAt: NOW, updatedAt: NOW,
    observationIds: [], correlationIds: [], summary: '',
    location: { lat: 41.6, lon: -86.7, radiusKm: 80 }, tags: [], confidence: 0.7,
  };
  assert.equal(findMatchingSituation(observation(), [sit], NOW), null);
});

test('findMatchingSituation: matches locationless events to locationless situations by domain + time', () => {
  const sit: Situation = {
    id: 's-cyber', name: 'cyber', status: 'active', severity: 'high',
    domain: 'cyber', startedAt: NOW, updatedAt: NOW,
    observationIds: [], correlationIds: [], summary: '',
    tags: [], confidence: 0.7,
  };
  const event = observation({ domain: 'cyber', location: undefined });
  assert.equal(findMatchingSituation(event, [sit], NOW)?.id, 's-cyber');
});

// ── buildAutoSummary ─────────────────────────────────────────────────────

test('buildAutoSummary: includes the event title, coords, and severity', () => {
  const summary = buildAutoSummary(observation());
  assert.match(summary, /M6\.0 earthquake/);
  assert.match(summary, /41\.60°.*-86\.70°/);
  assert.match(summary, /high severity/);
});

test('buildAutoSummary: omits the coords clause when the event has no location', () => {
  const summary = buildAutoSummary(observation({ location: undefined }));
  assert.match(summary, /M6\.0 earthquake/);
  assert.doesNotMatch(summary, /°/);
});

// ── detect — create path ─────────────────────────────────────────────────

test('detect: HIGH event creates a new Situation when no match exists', () => {
  __reset();
  const dispatcher = recordedDispatcher();
  const sit = detect(observation(), { now: NOW, dispatch: dispatcher.fn });
  assert.ok(sit);
  assert.equal(sit.status, 'active');
  assert.equal(sit.severity, 'high');
  assert.deepEqual(sit.observationIds, ['obs-1']);
  assert.equal(getActive().length, 1);
  assert.equal(dispatcher.calls.length, 1);
  assert.equal(dispatcher.calls[0]?.name, 'wm:situation-created');
});

test('detect: CRITICAL event maps to "critical" severity and seeds confidence', () => {
  __reset();
  const sit = detect(observation({ severity: 'CRITICAL', id: 'obs-c' }),
    { now: NOW, dispatch: null });
  assert.ok(sit);
  assert.equal(sit.severity, 'critical');
  assert.ok(sit.confidence > 0 && sit.confidence <= 1);
});

test('detect: MEDIUM event below the auto-create gate returns null', () => {
  __reset();
  const sit = detect(observation({ severity: 'MEDIUM' }), { now: NOW, dispatch: null });
  assert.equal(sit, null);
  assert.equal(getActive().length, 0);
});

test('detect: force option seeds even from MEDIUM observations', () => {
  __reset();
  const sit = detect(observation({ severity: 'MEDIUM' }),
    { now: NOW, dispatch: null, force: true });
  assert.ok(sit);
  assert.equal(sit.severity, 'moderate');
});

// ── detect — merge path ──────────────────────────────────────────────────

test('detect: second event near a previous situation merges (does not create)', () => {
  __reset();
  const first = detect(observation({ id: 'obs-1' }), { now: NOW, dispatch: null });
  assert.ok(first);
  const dispatcher = recordedDispatcher();
  const merged = detect(
    observation({ id: 'obs-2',
      // ~30km southwest of the first event — within 500km.
      location: { lat: 41.4, lon: -86.9, radiusKm: 20 },
      timestamp: NOW + 30 * 60 * 1000 }),
    { now: NOW + 30 * 60 * 1000, dispatch: dispatcher.fn },
  );
  assert.equal(merged?.id, first.id);
  assert.deepEqual(merged?.observationIds, ['obs-1', 'obs-2']);
  assert.equal(getActive().length, 1);
  assert.equal(dispatcher.calls[0]?.name, 'wm:situation-updated');
});

test('detect: events outside MATCH_RADIUS_KM create a second situation, not a merge', () => {
  __reset();
  detect(observation({ id: 'obs-a' }), { now: NOW, dispatch: null });
  const farEvent = observation({
    id: 'obs-b',
    // San Francisco — well beyond 500km from La Porte
    location: { lat: 37.77, lon: -122.42, radiusKm: 20 },
  });
  const second = detect(farEvent, { now: NOW, dispatch: null });
  assert.ok(second);
  assert.equal(getActive().length, 2);
});

test('detect: events outside MATCH_WINDOW_MS create a second situation', () => {
  __reset();
  detect(observation({ id: 'obs-a' }), { now: NOW, dispatch: null });
  const lateEvent = observation({ id: 'obs-b', timestamp: NOW + 3 * HOUR });
  const second = detect(lateEvent, { now: NOW + 3 * HOUR, dispatch: null });
  assert.ok(second);
  assert.equal(getActive().length, 2);
});

test('detect: merge takes the stronger severity', () => {
  __reset();
  const first = detect(observation({ id: 'obs-a', severity: 'HIGH' }),
    { now: NOW, dispatch: null });
  assert.equal(first?.severity, 'high');
  const merged = detect(observation({ id: 'obs-b', severity: 'CRITICAL' }),
    { now: NOW + 5 * 60 * 1000, dispatch: null });
  assert.equal(merged?.severity, 'critical');
});

test('detect: dispatch:null suppresses the DOM event entirely', () => {
  __reset();
  const dispatcher = recordedDispatcher();
  detect(observation(), { now: NOW, dispatch: null });
  assert.equal(dispatcher.calls.length, 0);
});

// ── Module-level constants ───────────────────────────────────────────────

test('MATCH_RADIUS_KM and MATCH_WINDOW_MS match the spec', () => {
  assert.equal(MATCH_RADIUS_KM, 500);
  assert.equal(MATCH_WINDOW_MS, 2 * HOUR);
});

test('detect: returns the situation from the store (single-source-of-truth)', () => {
  __reset();
  const sit = detect(observation(), { now: NOW, dispatch: null });
  assert.equal(sit?.id, getSituation(sit!.id)?.id);
});
