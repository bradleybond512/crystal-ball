import assert from 'node:assert/strict';
import test from 'node:test';

import { createMissionLedger, eventsByKind, firstEventOfKind } from '../mission-ledger.ts';
import type { MissionDomain, MissionEvent, MissionRecord } from '../mission-types.ts';

const NOW = 1_745_000_000_000;

function makeLedger() {
  return createMissionLedger({ now: () => NOW });
}

function openWeatherMission(ledger: ReturnType<typeof makeLedger>, overrides: Partial<MissionRecord> = {}): MissionRecord {
  return ledger.openMission({
    id: overrides.id ?? 'mission-tornado-1',
    domain: overrides.domain ?? 'weather_safety',
    description: overrides.description ?? 'Tornado warning near Home',
    createdAt: overrides.createdAt ?? NOW,
    factId: overrides.factId,
    placeId: overrides.placeId,
    originAlgorithmId: overrides.originAlgorithmId ?? 'weather-urgency',
  });
}

// ── openMission ────────────────────────────────────────────────────────

test('open: creates a mission with default active status', () => {
  const ledger = makeLedger();
  const m = openWeatherMission(ledger);
  assert.equal(m.status, 'active');
  assert.equal(m.events.length, 0);
});

test('open: throws on id collision', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  assert.throws(() => openWeatherMission(ledger), /already exists/i);
});

test('open: auto-generates id when empty string passed', () => {
  const ledger = makeLedger();
  const a = ledger.openMission({
    id: '', domain: 'weather_safety', description: 'auto', createdAt: NOW,
  });
  const b = ledger.openMission({
    id: '', domain: 'cyber_exposure', description: 'auto-2', createdAt: NOW,
  });
  assert.match(a.id, /^mission-\d+$/);
  assert.match(b.id, /^mission-\d+$/);
  assert.notEqual(a.id, b.id);
});

// ── recordEvent ────────────────────────────────────────────────────────

test('record: appends events with auto-id', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  const e = ledger.recordEvent('mission-tornado-1', {
    at: NOW,
    kind: 'weak_signal',
    label: 'Cell rotation observed on radar',
  });
  assert.match(e.id, /^me-\d+$/);
  assert.equal(ledger.get('mission-tornado-1')?.events.length, 1);
});

test('record: throws on unknown mission', () => {
  const ledger = makeLedger();
  assert.throws(
    () => ledger.recordEvent('does-not-exist', { at: NOW, kind: 'weak_signal', label: 'x' }),
    /not found/i,
  );
});

test('record: refuses events on resolved mission', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  ledger.resolveMission('mission-tornado-1', 'resolved_hit', 'Verified');
  assert.throws(
    () => ledger.recordEvent('mission-tornado-1', { at: NOW, kind: 'user_action_taken', label: 'x' }),
    /resolved/i,
  );
});

test('record: caller-supplied id passes through', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  const e = ledger.recordEvent('mission-tornado-1', {
    id: 'my-event-1', at: NOW, kind: 'app_watch', label: 'x',
  });
  assert.equal(e.id, 'my-event-1');
});

// ── resolveMission ─────────────────────────────────────────────────────

test('resolve: marks mission and stores reason + timestamp', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  const resolved = ledger.resolveMission(
    'mission-tornado-1',
    'resolved_hit',
    'Tornado touched down at 14:35',
    NOW + 60 * 1000,
  );
  assert.equal(resolved.status, 'resolved_hit');
  assert.equal(resolved.resolvedAt, NOW + 60 * 1000);
  assert.match(resolved.resolutionReason!, /touched down/);
});

test('resolve: refuses to re-resolve', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  ledger.resolveMission('mission-tornado-1', 'resolved_hit', 'x');
  assert.throws(
    () => ledger.resolveMission('mission-tornado-1', 'resolved_miss', 'y'),
    /already resolved/i,
  );
});

test('resolve: throws on unknown mission', () => {
  const ledger = makeLedger();
  assert.throws(
    () => ledger.resolveMission('nope', 'expired', 'x'),
    /not found/i,
  );
});

// ── all + snapshot ─────────────────────────────────────────────────────

test('all: ordered oldest-first by createdAt', () => {
  const ledger = makeLedger();
  ledger.openMission({ id: 'm-late', domain: 'weather_safety', description: 'late', createdAt: NOW + 60_000 });
  ledger.openMission({ id: 'm-early', domain: 'cyber_exposure', description: 'early', createdAt: NOW });
  const list = ledger.all();
  assert.equal(list[0]!.id, 'm-early');
  assert.equal(list[1]!.id, 'm-late');
});

test('snapshot: counts by domain + status', () => {
  const ledger = makeLedger();
  ledger.openMission({ id: 'a', domain: 'weather_safety', description: 'x', createdAt: NOW });
  ledger.openMission({ id: 'b', domain: 'weather_safety', description: 'x', createdAt: NOW });
  ledger.openMission({ id: 'c', domain: 'cyber_exposure', description: 'x', createdAt: NOW });
  ledger.resolveMission('a', 'resolved_hit', 'ok');
  const snap = ledger.snapshot();
  assert.equal(snap.countsByDomain.weather_safety, 2);
  assert.equal(snap.countsByDomain.cyber_exposure, 1);
  assert.equal(snap.countsByStatus.active, 2);
  assert.equal(snap.countsByStatus.resolved_hit, 1);
});

// ── Serialize / loadJson roundtrip ─────────────────────────────────────

test('serialize: roundtrip preserves missions + events', () => {
  const a = makeLedger();
  openWeatherMission(a);
  a.recordEvent('mission-tornado-1', { at: NOW, kind: 'weak_signal', label: 'rotation' });
  a.recordEvent('mission-tornado-1', { at: NOW + 1000, kind: 'app_watch', label: 'watching' });
  a.resolveMission('mission-tornado-1', 'resolved_hit', 'ok');

  const json = a.toJson();
  const b = createMissionLedger({ now: () => NOW });
  b.loadJson(json);

  const restored = b.get('mission-tornado-1');
  assert.ok(restored);
  assert.equal(restored!.events.length, 2);
  assert.equal(restored!.status, 'resolved_hit');
});

test('loadJson: bumps next event id past persisted ids', () => {
  const a = makeLedger();
  openWeatherMission(a);
  // Force a high-numbered event id in the persisted state.
  const persisted: MissionRecord[] = [{
    id: 'mission-tornado-1',
    domain: 'weather_safety',
    description: 'x',
    createdAt: NOW,
    status: 'active',
    events: [
      { id: 'me-99', at: NOW, kind: 'weak_signal', label: 'old' },
    ],
  }];
  const b = createMissionLedger({ now: () => NOW });
  b.loadJson(persisted);
  // New events must use ids past me-99.
  const next = b.recordEvent('mission-tornado-1', { at: NOW + 1, kind: 'app_watch', label: 'new' });
  assert.equal(next.id, 'me-100');
});

// ── Mission events: timeline → time-to-warn building blocks ──────────

test('events: time-to-warn raw signals are reachable via filter helpers', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  ledger.recordEvent('mission-tornado-1', { at: NOW, kind: 'weak_signal', label: 'rotation' });
  ledger.recordEvent('mission-tornado-1', { at: NOW + 60_000, kind: 'app_watch', label: 'watching' });
  ledger.recordEvent('mission-tornado-1', { at: NOW + 120_000, kind: 'user_notified', label: 'notified' });
  ledger.recordEvent('mission-tornado-1', { at: NOW + 600_000, kind: 'estimated_impact', label: '10 min' });
  ledger.recordEvent('mission-tornado-1', { at: NOW + 720_000, kind: 'actual_impact', label: 'impact' });

  const mission = ledger.get('mission-tornado-1')!;
  const weak = firstEventOfKind(mission, 'weak_signal');
  const impact = firstEventOfKind(mission, 'actual_impact');
  const notifications = eventsByKind(mission, 'user_notified');

  assert.equal(weak!.at, NOW);
  assert.equal(impact!.at, NOW + 720_000);
  assert.equal(notifications.length, 1);
});

// ── Domain coverage ───────────────────────────────────────────────────

test('domains: all 8 plan-listed domains accepted', () => {
  const ledger = makeLedger();
  const domains: MissionDomain[] = [
    'weather_safety', 'conflict_escalation', 'cyber_exposure',
    'food_commodity_shortage', 'energy_fuel_stress', 'travel_disruption',
    'market_portfolio_risk', 'local_infrastructure',
  ];
  for (const domain of domains) {
    ledger.openMission({
      id: `m-${domain}`,
      domain,
      description: `${domain} test`,
      createdAt: NOW,
    });
  }
  assert.equal(ledger.all().length, 8);
});

// ── JSON-serializable ─────────────────────────────────────────────────

test('serializable: every record JSON.stringify-able and JSON.parse-able', () => {
  const ledger = makeLedger();
  openWeatherMission(ledger);
  ledger.recordEvent('mission-tornado-1', {
    at: NOW,
    kind: 'weak_signal',
    label: 'rotation',
    detail: { polygonId: 'urn:test', radarSite: 'KIWX' },
    uncertaintyMs: 60_000,
  });
  const round = JSON.parse(JSON.stringify(ledger.toJson())) as MissionRecord[];
  assert.equal(round.length, 1);
  const event = round[0]!.events[0]! as MissionEvent;
  assert.equal(event.detail!.radarSite, 'KIWX');
});

// ── Determinism ──────────────────────────────────────────────────────

test('determinism: same operations → same snapshot', () => {
  function build() {
    const ledger = makeLedger();
    ledger.openMission({ id: 'm-1', domain: 'weather_safety', description: 'x', createdAt: NOW });
    ledger.recordEvent('m-1', { at: NOW, kind: 'weak_signal', label: 'rotation' });
    return ledger.snapshot();
  }
  assert.deepEqual(build(), build());
});
