import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDiagnosticEventBus,
  getDefaultDiagnosticBus,
  resetDefaultDiagnosticBus,
} from '../diagnostic-events.ts';
import type { DiagnosticEvent } from '../diagnostic-events.ts';

const NOW = 1_745_000_000_000;

function makeBus(opts: { capacity?: number } = {}) {
  return createDiagnosticEventBus({ now: () => NOW, ...opts });
}

// ── Emit + query ────────────────────────────────────────────────────────

test('emit: assigns id + timestamp + persists event in ring', () => {
  const bus = makeBus();
  const e = bus.emit({
    severity: 'info',
    kind: 'service_started',
    serviceId: 'weather',
    message: 'NWS poller started',
  });
  assert.equal(e.id, 'de-1');
  assert.equal(e.at, NOW);
  assert.equal(bus.query().length, 1);
});

test('emit: monotonic ids per bus instance', () => {
  const bus = makeBus();
  const a = bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  const b = bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'y' });
  assert.equal(a.id, 'de-1');
  assert.equal(b.id, 'de-2');
});

test('emit: caller-supplied id and timestamp pass through', () => {
  const bus = makeBus();
  const e = bus.emit({
    id: 'custom-id',
    at: NOW + 1000,
    severity: 'warning',
    kind: 'service_stale',
    serviceId: 'cyber',
    message: 'KEV feed >12h old',
  });
  assert.equal(e.id, 'custom-id');
  assert.equal(e.at, NOW + 1000);
});

// ── Bounded ring ────────────────────────────────────────────────────────

test('ring: drops oldest events at capacity', () => {
  const bus = makeBus({ capacity: 3 });
  for (let i = 0; i < 5; i += 1) {
    bus.emit({ severity: 'info', kind: 'service_started', serviceId: `s-${i}`, message: 'x' });
  }
  const events = bus.query();
  assert.equal(events.length, 3);
  // Should hold last 3: s-2, s-3, s-4.
  assert.deepEqual(events.map((e) => e.serviceId), ['s-2', 's-3', 's-4']);
});

// ── Subscribe / unsubscribe ────────────────────────────────────────────

test('subscribe: receives every event', () => {
  const bus = makeBus();
  const received: DiagnosticEvent[] = [];
  bus.subscribe((e) => received.push(e));
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'a' });
  bus.emit({ severity: 'error', kind: 'service_failure', serviceId: 's', message: 'b' });
  assert.equal(received.length, 2);
});

test('subscribe: unsubscribe stops delivery', () => {
  const bus = makeBus();
  const received: DiagnosticEvent[] = [];
  const unsub = bus.subscribe((e) => received.push(e));
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'a' });
  unsub();
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'b' });
  assert.equal(received.length, 1);
});

test('subscribe: subscriber errors are caught and logged to dead-letter ring', () => {
  const bus = makeBus();
  bus.subscribe(() => { throw new Error('boom'); });
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  assert.equal(bus.counts().subscriberErrors, 1);
  const letters = bus.deadLetters();
  assert.equal(letters.length, 1);
  assert.equal(letters[0]!.error, 'boom');
});

test('subscribe: a throwing subscriber does not break delivery to others', () => {
  const bus = makeBus();
  const ok: DiagnosticEvent[] = [];
  bus.subscribe(() => { throw new Error('boom'); });
  bus.subscribe((e) => ok.push(e));
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  assert.equal(ok.length, 1);
});

// ── Filter ─────────────────────────────────────────────────────────────

test('query: filter by severity', () => {
  const bus = makeBus();
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'a' });
  bus.emit({ severity: 'critical', kind: 'service_failure', serviceId: 's', message: 'b' });
  bus.emit({ severity: 'warning', kind: 'service_stale', serviceId: 's', message: 'c' });
  const criticals = bus.query({ severity: ['critical'] });
  assert.equal(criticals.length, 1);
  assert.equal(criticals[0]!.message, 'b');
});

test('query: filter by kind', () => {
  const bus = makeBus();
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'a' });
  bus.emit({ severity: 'info', kind: 'panel_mounted', panelId: 'p1', message: 'b' });
  const panelEvents = bus.query({ kind: ['panel_mounted', 'panel_rendered'] });
  assert.equal(panelEvents.length, 1);
});

test('query: filter by featureId / panelId / serviceId / sourceId / providerId', () => {
  const bus = makeBus();
  bus.emit({ severity: 'info', kind: 'service_success', serviceId: 'a', message: 'a' });
  bus.emit({ severity: 'info', kind: 'service_success', serviceId: 'b', message: 'b' });
  bus.emit({ severity: 'info', kind: 'panel_mounted', panelId: 'p1', message: 'c' });
  bus.emit({ severity: 'info', kind: 'provider_success', providerId: 'nws', sourceId: 'weather', message: 'd' });

  assert.equal(bus.query({ serviceId: 'a' }).length, 1);
  assert.equal(bus.query({ panelId: 'p1' }).length, 1);
  assert.equal(bus.query({ providerId: 'nws' }).length, 1);
  assert.equal(bus.query({ sourceId: 'weather' }).length, 1);
});

test('query: filter by since timestamp', () => {
  const bus = createDiagnosticEventBus({ now: () => NOW });
  bus.emit({ at: NOW - 60_000, severity: 'info', kind: 'service_success', serviceId: 's', message: 'old' });
  bus.emit({ at: NOW, severity: 'info', kind: 'service_success', serviceId: 's', message: 'new' });
  const recent = bus.query({ since: NOW - 30_000 });
  assert.equal(recent.length, 1);
  assert.equal(recent[0]!.message, 'new');
});

// ── Counts ─────────────────────────────────────────────────────────────

test('counts: total + per-severity + per-kind', () => {
  const bus = makeBus();
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'a' });
  bus.emit({ severity: 'critical', kind: 'service_failure', serviceId: 's', message: 'b' });
  bus.emit({ severity: 'critical', kind: 'feature_degraded', featureId: 'f', message: 'c' });
  const counts = bus.counts();
  assert.equal(counts.totalEvents, 3);
  assert.equal(counts.bySeverity.info, 1);
  assert.equal(counts.bySeverity.critical, 2);
  assert.equal(counts.byKind.service_failure, 1);
  assert.equal(counts.byKind.feature_degraded, 1);
});

test('counts: cleared by clear()', () => {
  const bus = makeBus();
  bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'a' });
  bus.clear();
  assert.equal(bus.query().length, 0);
  assert.equal(bus.counts().totalEvents, 0);
  assert.equal(bus.counts().bySeverity.info, 0);
});

// ── Dead-letter capacity ──────────────────────────────────────────────

test('dead-letter ring: capped at 50', () => {
  const bus = makeBus();
  bus.subscribe(() => { throw new Error('persistent failure'); });
  for (let i = 0; i < 60; i += 1) {
    bus.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: `${i}` });
  }
  assert.equal(bus.deadLetters().length, 50);
  assert.equal(bus.counts().subscriberErrors, 60);
});

// ── Default singleton ──────────────────────────────────────────────────

test('default bus: same instance across calls', () => {
  resetDefaultDiagnosticBus();
  const a = getDefaultDiagnosticBus();
  const b = getDefaultDiagnosticBus();
  assert.equal(a, b);
});

test('default bus: reset between tests', () => {
  resetDefaultDiagnosticBus();
  const a = getDefaultDiagnosticBus();
  a.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  resetDefaultDiagnosticBus();
  const b = getDefaultDiagnosticBus();
  assert.notEqual(a, b);
  assert.equal(b.query().length, 0);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same emit calls produce same events', () => {
  const a = makeBus();
  const b = makeBus();
  const ea = a.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  const eb = b.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  assert.deepEqual(ea, eb);
});

// ── Plan-listed event kinds ────────────────────────────────────────────

test('plan kinds: all 15 DiagnosticEventKind values are accepted', () => {
  const bus = makeBus();
  const kinds = [
    'service_started', 'service_success', 'service_empty', 'service_failure',
    'service_stale', 'provider_success', 'provider_failure', 'panel_mounted',
    'panel_rendered', 'panel_error', 'notification_candidate',
    'notification_suppressed', 'notification_dispatched', 'feature_degraded',
    'feature_recovered',
  ] as const;
  for (const kind of kinds) {
    bus.emit({ severity: 'info', kind, message: kind });
  }
  assert.equal(bus.query().length, 15);
});
