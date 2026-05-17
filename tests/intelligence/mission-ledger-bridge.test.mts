/**
 * Tests for MissionLedgerBridge — the closed-loop wiring between
 * mission-state transitions and the intelligence OutcomeLedger.
 *
 * Each test builds a fresh mission ledger + outcome ledger via the
 * injectable constructor so order is irrelevant and the upstream
 * singletons are never touched.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  MissionLedgerBridge,
  __internals,
  __resetMissionLedgerBridgeSingleton,
  getMissionLedgerBridge,
  type BridgedEntry,
} from '../../src/services/intelligence/mission-ledger-bridge.ts';
import { OutcomeLedger } from '../../src/services/intelligence/outcome-ledger.ts';
import { createMissionLedger } from '../../src/services/ops/mission-ledger.ts';
import type {
  MissionEventKind,
  MissionLedger,
  MissionStatus,
} from '../../src/services/ops/mission-types.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

interface TestRig {
  bridge: MissionLedgerBridge;
  mission: MissionLedger;
  outcome: OutcomeLedger;
}

function freshRig(): TestRig {
  __storage.clear();
  const mission = createMissionLedger({ now: () => NOW });
  const outcome = new OutcomeLedger({ clock: () => NOW });
  const bridge = new MissionLedgerBridge({
    missionLedger: mission,
    outcomeLedger: outcome,
    clock: () => NOW,
  });
  return { bridge, mission, outcome };
}

function openWeatherMission(rig: TestRig, id = 'm-weather'): void {
  rig.mission.openMission({
    id,
    domain: 'weather_safety',
    description: 'Severe thunderstorm near home',
    createdAt: NOW,
  });
}

function addEvent(
  rig: TestRig,
  missionId: string,
  kind: MissionEventKind,
  label = `evt-${kind}`,
): void {
  rig.mission.recordEvent(missionId, { at: NOW, kind, label });
}

// ── connect / disconnect / lifecycle ─────────────────────────────────

test('bridge is disconnected by default', () => {
  const rig = freshRig();
  assert.equal(rig.bridge.isConnected(), false);
});

test('connect() starts the polling timer and disconnect() stops it', () => {
  const rig = freshRig();
  rig.bridge.connect();
  assert.equal(rig.bridge.isConnected(), true);
  rig.bridge.disconnect();
  assert.equal(rig.bridge.isConnected(), false);
});

test('connect() is idempotent — second call is a no-op', () => {
  const rig = freshRig();
  rig.bridge.connect();
  rig.bridge.connect();
  assert.equal(rig.bridge.isConnected(), true);
  rig.bridge.disconnect();
});

// ── poll(): empty state ──────────────────────────────────────────────

test('poll() with no missions emits nothing', () => {
  const rig = freshRig();
  const fresh = rig.bridge.poll();
  assert.equal(fresh.length, 0);
  assert.equal(rig.outcome.list().length, 0);
});

test('poll() with an active no-event mission emits nothing', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  const fresh = rig.bridge.poll();
  assert.equal(fresh.length, 0);
});

// ── event-driven OutcomeRecord emission ──────────────────────────────

test('user_acknowledged event → acted-on outcome', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  const fresh = rig.bridge.poll();
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]!.outcome.actualOutcome, 'acted-on');
  assert.equal(fresh[0]!.trigger, 'event');
});

test('user_action_taken event → acted-on outcome', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_action_taken');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'acted-on');
});

test('official_confirmed event → confirmed-real outcome', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'official_confirmed');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'confirmed-real');
});

test('near_miss event → marked-false-positive outcome', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'near_miss');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'marked-false-positive');
});

test('pre-resolution event kinds (weak_signal / app_watch) do NOT emit', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'weak_signal');
  addEvent(rig, 'm-weather', 'app_watch');
  addEvent(rig, 'm-weather', 'estimated_impact');
  assert.equal(rig.bridge.poll().length, 0);
});

test('mixed events emit one entry per actionable event', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'weak_signal');          // noise
  addEvent(rig, 'm-weather', 'user_acknowledged');     // acted-on
  addEvent(rig, 'm-weather', 'official_confirmed');    // confirmed-real
  const fresh = rig.bridge.poll();
  assert.equal(fresh.length, 2);
  const actions = fresh.map((f) => f.outcome.actualOutcome).sort();
  assert.deepEqual(actions, ['acted-on', 'confirmed-real']);
});

// ── status-transition emission ───────────────────────────────────────

test('resolved_hit without prior user action → confirmed-real', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  rig.mission.resolveMission('m-weather', 'resolved_hit', 'storm impacted home');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'confirmed-real');
  assert.equal(entry!.trigger, 'status');
});

test('resolved_hit AFTER user_action_taken → acted-on', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_action_taken');
  rig.mission.resolveMission('m-weather', 'resolved_hit', 'storm impacted home');
  const fresh = rig.bridge.poll();
  const statusEntry = fresh.find((e) => e.trigger === 'status');
  assert.ok(statusEntry);
  assert.equal(statusEntry!.outcome.actualOutcome, 'acted-on');
});

test('resolved_miss → marked-false-positive', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  rig.mission.resolveMission('m-weather', 'resolved_miss', 'false alarm');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'marked-false-positive');
});

test('expired → dismissed', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  rig.mission.resolveMission('m-weather', 'expired', 'window closed');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'dismissed');
});

test('cancelled → dismissed', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  rig.mission.resolveMission('m-weather', 'cancelled', 'user dismissed');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.actualOutcome, 'dismissed');
});

test('terminal-status flip emits a single status entry, not on every poll', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  rig.mission.resolveMission('m-weather', 'resolved_miss', 'false alarm');
  assert.equal(rig.bridge.poll().length, 1);
  // Second poll with no further changes is a no-op
  assert.equal(rig.bridge.poll().length, 0);
});

// ── Domain mapping + outcome shape ──────────────────────────────────

test('MissionDomain → outcome ledger domain string is mapped', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.domain, 'weather');
});

test('Every MissionDomain has an entry in DOMAIN_MAP', () => {
  const expected: string[] = [
    'weather_safety', 'conflict_escalation', 'cyber_exposure',
    'food_commodity_shortage', 'energy_fuel_stress', 'travel_disruption',
    'market_portfolio_risk', 'local_infrastructure',
  ];
  for (const key of expected) {
    assert.ok(
      (__internals.DOMAIN_MAP as Record<string, string>)[key],
      `missing mapping for ${key}`,
    );
  }
});

test('inferSeverity respects explanationScore bands', () => {
  const baseMission = {
    id: 'm',
    domain: 'weather_safety' as const,
    description: 'x',
    createdAt: NOW,
    status: 'active' as MissionStatus,
    events: [],
  };
  const tier = (score: number | undefined): string =>
    __internals.inferSeverity({ ...baseMission, explanationScore: score });
  assert.equal(tier(undefined), 'medium');
  assert.equal(tier(0.9), 'critical');
  assert.equal(tier(0.7), 'high');
  assert.equal(tier(0.5), 'medium');
  assert.equal(tier(0.2), 'low');
});

test('emitted OutcomeRecord carries the mission factId as alertId + situationId', () => {
  const rig = freshRig();
  rig.mission.openMission({
    id: 'm-evac',
    domain: 'travel_disruption',
    description: 'route disruption',
    factId: 'fact-evac-7',
    createdAt: NOW,
  });
  addEvent(rig, 'm-evac', 'user_action_taken');
  const [entry] = rig.bridge.poll();
  assert.equal(entry!.outcome.alertId, 'fact-evac-7');
  assert.equal(entry!.outcome.situationId, 'fact-evac-7');
});

// ── Cursor / dedupe behavior ────────────────────────────────────────

test('processed events are not re-emitted on subsequent polls', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  assert.equal(rig.bridge.poll().length, 1);
  assert.equal(rig.bridge.poll().length, 0);
});

test('new events added between polls are emitted on the next poll', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  addEvent(rig, 'm-weather', 'official_confirmed');
  const fresh = rig.bridge.poll();
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]!.outcome.actualOutcome, 'confirmed-real');
});

// ── Reads + stats ───────────────────────────────────────────────────

test('getRecent returns the last N entries in reverse chronological order', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  addEvent(rig, 'm-weather', 'official_confirmed');
  rig.bridge.poll();
  const recent = rig.bridge.getRecent(2);
  assert.equal(recent.length, 2);
  // Newest first
  assert.equal(recent[0]!.outcome.actualOutcome, 'confirmed-real');
});

test('getRecent(0) returns empty', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  assert.deepEqual(rig.bridge.getRecent(0), []);
});

test('stats() counts totals + per-action breakdown', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.mission.openMission({
    id: 'm-cyber',
    domain: 'cyber_exposure',
    description: 'incident',
    createdAt: NOW,
  });
  rig.mission.resolveMission('m-cyber', 'resolved_miss', 'false alarm');
  rig.bridge.poll();
  const s = rig.bridge.stats();
  assert.equal(s.totalRecorded, 2);
  assert.equal(s.byAction['acted-on'], 1);
  assert.equal(s.byAction['marked-false-positive'], 1);
  assert.ok(s.lastRecordedAt);
});

test('stats() todayRecorded counts entries from the past 24 h', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  const s = rig.bridge.stats();
  assert.equal(s.todayRecorded, 1);
});

test('stats() zero state has empty action buckets', () => {
  const rig = freshRig();
  const s = rig.bridge.stats();
  assert.equal(s.totalRecorded, 0);
  assert.equal(s.todayRecorded, 0);
  assert.equal(s.byAction['acted-on'], 0);
  assert.equal(s.lastRecordedAt, null);
});

// ── Subscribe ───────────────────────────────────────────────────────

test('subscribe fires on every emitted entry', () => {
  const rig = freshRig();
  const seen: BridgedEntry[] = [];
  rig.bridge.subscribe((e) => seen.push(e));
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  assert.equal(seen.length, 1);
});

test('subscribe returns unsubscribe — stops further dispatch', () => {
  const rig = freshRig();
  let calls = 0;
  const off = rig.bridge.subscribe(() => { calls += 1; });
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  off();
  addEvent(rig, 'm-weather', 'official_confirmed');
  rig.bridge.poll();
  assert.equal(calls, 1);
});

test('listener exceptions are isolated', () => {
  const rig = freshRig();
  let second = false;
  rig.bridge.subscribe(() => { throw new Error('boom'); });
  rig.bridge.subscribe(() => { second = true; });
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  assert.equal(second, true);
});

// ── Persistence ─────────────────────────────────────────────────────

test('cursor persists across bridge instances — previously-processed events are not replayed', () => {
  __storage.clear();
  const mission = createMissionLedger({ now: () => NOW });
  const outcome1 = new OutcomeLedger({ clock: () => NOW });
  const a = new MissionLedgerBridge({ missionLedger: mission, outcomeLedger: outcome1, clock: () => NOW });
  mission.openMission({ id: 'm1', domain: 'weather_safety', description: 'x', createdAt: NOW });
  mission.recordEvent('m1', { at: NOW, kind: 'user_acknowledged', label: 'ack' });
  assert.equal(a.poll().length, 1);

  // Fresh bridge backed by the same mission + a different outcome
  // ledger; cursor hydrates from localStorage so no replay.
  const outcome2 = new OutcomeLedger({ clock: () => NOW });
  const b = new MissionLedgerBridge({ missionLedger: mission, outcomeLedger: outcome2, clock: () => NOW });
  assert.equal(b.poll().length, 0);
});

test('corrupt persisted cursor payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-mission-ledger-bridge', 'not-json');
  const rig = freshRig();
  assert.doesNotThrow(() => rig.bridge.poll());
});

// ── Singleton + writes to outcome ledger ─────────────────────────────

test('getMissionLedgerBridge returns a stable singleton', () => {
  __resetMissionLedgerBridgeSingleton();
  const a = getMissionLedgerBridge();
  const b = getMissionLedgerBridge();
  assert.equal(a, b);
});

test('emitted entries land on the injected outcome ledger', () => {
  const rig = freshRig();
  openWeatherMission(rig);
  addEvent(rig, 'm-weather', 'user_acknowledged');
  rig.bridge.poll();
  const records = rig.outcome.list();
  assert.equal(records.length, 1);
  assert.equal(records[0]!.actualOutcome, 'acted-on');
  assert.equal(records[0]!.domain, 'weather');
});

// Teardown — kept at the bottom so the file finishes cleanly.
test('teardown', () => {
  __resetMissionLedgerBridgeSingleton();
  __storage.clear();
  assert.ok(true);
});
