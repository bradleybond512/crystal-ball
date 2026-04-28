import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeTimeToWarn,
  summarizeTimeToWarn,
  DEFAULT_DOMAIN_TARGETS_MS,
} from '../time-to-warn.ts';
import type { MissionEvent, MissionRecord } from '../mission-types.ts';

const NOW = 1_745_000_000_000;

function event(at: number, kind: MissionEvent['kind'], label: string): MissionEvent {
  return { id: `${kind}-${at}`, at, kind, label };
}

function weatherMission(events: MissionEvent[], status: MissionRecord['status'] = 'resolved_hit'): MissionRecord {
  return {
    id: 'wx-1',
    domain: 'weather_safety',
    description: 'Tornado warning near Home',
    createdAt: NOW,
    status,
    events,
  };
}

// ── On-target: 45 min lead time ────────────────────────────────────────

test('on_target: 45 min lead time meets the weather target', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'mesoscale convective outlook'),
    event(NOW + 5 * 60_000, 'user_notified', 'Tornado Warning issued'),
    event(NOW + 50 * 60_000, 'actual_impact', 'Storm impacted Home'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'on_target');
  assert.equal(r.leadTimeMs, 45 * 60_000);
  assert.equal(r.signalLagMs, 5 * 60_000);
  assert.match(r.reason, /meets the/);
});

test('on_target: well-beyond target lead time still on_target', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 5 * 60_000, 'user_notified', 'warned'),
    event(NOW + 2 * 60 * 60_000, 'actual_impact', 'impacted'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'on_target');
});

// ── Too late ───────────────────────────────────────────────────────────

test('too_late: warning fired but lead time below target', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 30 * 60_000, 'user_notified', 'warned'),
    event(NOW + 35 * 60_000, 'actual_impact', 'impacted'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'too_late');
  assert.equal(r.leadTimeMs, 5 * 60_000);
  assert.match(r.reason, /below the/);
});

// ── After event ────────────────────────────────────────────────────────

test('after_event: warning fired AFTER the impact', () => {
  const m = weatherMission([
    event(NOW, 'actual_impact', 'impacted'),
    event(NOW + 10 * 60_000, 'user_notified', 'warned (late)'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'after_event');
  assert.equal(r.leadTimeMs, -10 * 60_000);
});

// ── No warning at all ──────────────────────────────────────────────────

test('no_warning: impact event with no user_notified', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 60 * 60_000, 'actual_impact', 'impacted'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'no_warning');
  assert.equal(r.firstWarningAt, undefined);
  assert.equal(r.leadTimeMs, undefined);
});

// ── Pending / unknown ──────────────────────────────────────────────────

test('pending: active mission with no impact yet', () => {
  const m = weatherMission([event(NOW, 'weak_signal', 'sig')], 'active');
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'pending');
});

test('unknown: resolved_hit but no impact event', () => {
  const m = weatherMission([event(NOW, 'user_notified', 'warned')], 'resolved_hit');
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'unknown');
});

// ── User action tracking ───────────────────────────────────────────────

test('userActed: true when user_acknowledged event present', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 10 * 60_000, 'user_notified', 'warned'),
    event(NOW + 11 * 60_000, 'user_acknowledged', 'tap'),
    event(NOW + 50 * 60_000, 'actual_impact', 'impacted'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.userActed, true);
});

test('userActed: true when user_action_taken (downstream) present', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 10 * 60_000, 'user_notified', 'warned'),
    event(NOW + 12 * 60_000, 'user_action_taken', 'sheltered'),
    event(NOW + 50 * 60_000, 'actual_impact', 'impacted'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.userActed, true);
});

test('userActed: false when no user events', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 10 * 60_000, 'user_notified', 'warned'),
    event(NOW + 50 * 60_000, 'actual_impact', 'impacted'),
  ]);
  const r = computeTimeToWarn(m);
  assert.equal(r.userActed, false);
});

// ── Domain-specific targets ────────────────────────────────────────────

test('cyber: 8h target met → on_target', () => {
  const m: MissionRecord = {
    id: 'cy-1',
    domain: 'cyber_exposure',
    description: 'Active CVE campaign',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      event(NOW, 'weak_signal', 'sig'),
      event(NOW + 30 * 60_000, 'user_notified', 'warned'),
      event(NOW + 9 * 60 * 60_000, 'actual_impact', 'impact'),
    ],
  };
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'on_target');
});

test('shortage: 10 day lead time below 30 day target → too_late', () => {
  const m: MissionRecord = {
    id: 'sh-1',
    domain: 'food_commodity_shortage',
    description: 'Wheat shortage',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      event(NOW, 'weak_signal', 'sig'),
      event(NOW + 60_000, 'user_notified', 'warned'),
      event(NOW + 10 * 24 * 60 * 60_000, 'actual_impact', 'impact'),
    ],
  };
  const r = computeTimeToWarn(m);
  assert.equal(r.rating, 'too_late');
  assert.match(r.reason, /30 d target/);
});

test('options.domainTargetsMs override default targets', () => {
  const m = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 5 * 60_000, 'user_notified', 'warned'),
    event(NOW + 10 * 60_000, 'actual_impact', 'impact'),
  ]);
  // Stricter target makes 5 min lead time too_late.
  const r = computeTimeToWarn(m, {
    domainTargetsMs: { weather_safety: 60 * 60_000 },
  });
  assert.equal(r.rating, 'too_late');
});

// ── DEFAULT_DOMAIN_TARGETS_MS ──────────────────────────────────────────

test('DEFAULT_DOMAIN_TARGETS_MS covers all 8 mission domains', () => {
  const expected: (keyof typeof DEFAULT_DOMAIN_TARGETS_MS)[] = [
    'weather_safety',
    'conflict_escalation',
    'cyber_exposure',
    'food_commodity_shortage',
    'energy_fuel_stress',
    'travel_disruption',
    'market_portfolio_risk',
    'local_infrastructure',
  ];
  for (const d of expected) {
    assert.ok(DEFAULT_DOMAIN_TARGETS_MS[d] > 0, `${d} should have a positive target`);
  }
});

// ── Roll-up ────────────────────────────────────────────────────────────

test('summarizeTimeToWarn: per-domain medians and on-target rate', () => {
  const m1 = weatherMission([
    event(NOW, 'weak_signal', 'sig'),
    event(NOW + 5 * 60_000, 'user_notified', 'warned'),
    event(NOW + 50 * 60_000, 'actual_impact', 'impact'),
  ]);
  const m2: MissionRecord = { ...m1, id: 'wx-2' };
  const m3: MissionRecord = {
    ...m1,
    id: 'wx-3',
    events: [
      event(NOW, 'weak_signal', 'sig'),
      event(NOW + 30 * 60_000, 'user_notified', 'warned'),
      event(NOW + 35 * 60_000, 'actual_impact', 'impact'), // too_late
    ],
  };
  const cy: MissionRecord = {
    id: 'cy-1',
    domain: 'cyber_exposure',
    description: 'cve',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      event(NOW, 'weak_signal', 'sig'),
      event(NOW + 60_000, 'user_notified', 'warned'),
      event(NOW + 60 * 60 * 1000, 'actual_impact', 'impact'),
    ],
  };
  const metrics = [m1, m2, m3, cy].map((m) => computeTimeToWarn(m));
  const summary = summarizeTimeToWarn(metrics);
  // Two domains
  assert.equal(summary.length, 2);
  const wx = summary.find((s) => s.domain === 'weather_safety')!;
  assert.equal(wx.total, 3);
  assert.equal(wx.evaluable, 3);
  // Two on-target + one too_late → onTargetRate = 2/3
  assert.equal(wx.ratingCounts.on_target, 2);
  assert.equal(wx.ratingCounts.too_late, 1);
  assert.ok(Math.abs(wx.onTargetRate - 2 / 3) < 1e-9);
  // Median lead time: lead times are [45 min, 45 min, 5 min] sorted = [5, 45, 45], median = 45
  assert.equal(wx.medianLeadTimeMs, 45 * 60_000);
});

test('summarizeTimeToWarn: empty input returns empty array', () => {
  assert.deepEqual(summarizeTimeToWarn([]), []);
});
