import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreExplanation, type ExplanationInput } from '../explanation-qa.ts';
import { scoreEffectiveness } from '../effectiveness.ts';
import { detectNearMisses } from '../near-miss.ts';
import { buildReplayFixtures } from '../replay-fixtures.ts';
import {
  evaluateCapabilities,
  defaultCapabilityCatalog,
  type CapabilityDefinition,
} from '../capability-readiness.ts';
import type { MissionEvent, MissionRecord } from '../mission-types.ts';

const NOW = 1_745_000_000_000;

function event(at: number, kind: MissionEvent['kind'], label = ''): MissionEvent {
  return { id: `${kind}-${at}`, at, kind, label };
}

function weatherMission(events: MissionEvent[], status: MissionRecord['status'] = 'resolved_hit'): MissionRecord {
  return { id: 'wx-1', domain: 'weather_safety', description: 'Tornado', createdAt: NOW, status, events };
}

// ── Explanation QA ─────────────────────────────────────────────────────

function fullExplanation(): ExplanationInput {
  return {
    headline: 'Tornado warning at home',
    reason: 'Polygon overlaps Home; NWS confirms; radar core moving toward saved place.',
    sources: ['NWS', 'radar'],
    places: ['Home'],
    whatChanged: 'wind tag increased to 70 mph',
    uncertainty: 'radar source 8 min stale',
    recommendedAction: 'shelter immediately',
    confidence: 0.9,
  };
}

test('explanation: full input scores grade A', () => {
  const r = scoreExplanation(fullExplanation());
  assert.equal(r.grade, 'A');
  assert.equal(r.score, 1);
  assert.deepEqual(r.fixes, []);
});

test('explanation: missing recommended action drops below A', () => {
  const input = { ...fullExplanation(), recommendedAction: undefined };
  const r = scoreExplanation(input);
  assert.notEqual(r.grade, 'A');
  assert.ok(r.fixes.some((f) => f.includes('what to do')));
});

test('explanation: barebones input drops to F', () => {
  const r = scoreExplanation({
    headline: '',
    reason: '',
    sources: [],
    places: [],
  });
  assert.equal(r.grade, 'F');
  assert.ok(r.fixes.length >= 7);
});

test('explanation: single source passes cites_sources but fails multi_source', () => {
  const r = scoreExplanation({ ...fullExplanation(), sources: ['NWS'] });
  const single = r.results.find((c) => c.id === 'cites_sources');
  const multi = r.results.find((c) => c.id === 'multi_source');
  assert.equal(single?.passed, true);
  assert.equal(multi?.passed, false);
});

// ── Effectiveness ──────────────────────────────────────────────────────

test('effectiveness: hits + user follow-through gives high score', () => {
  const m1 = weatherMission([
    event(NOW, 'user_notified'),
    event(NOW + 10 * 60_000, 'user_acknowledged'),
    event(NOW + 60 * 60_000, 'actual_impact'),
  ]);
  const m2 = { ...m1, id: 'wx-2' };
  const m3 = { ...m1, id: 'wx-3' };
  const report = scoreEffectiveness([m1, m2, m3], { generatedAt: NOW });
  const s = report.scores[0]!;
  assert.equal(s.hits, 3);
  assert.equal(s.misses, 0);
  assert.equal(s.hitRate, 1);
  assert.equal(s.userFollowThroughRate, 1);
  // 0.6*1 + 0.2*1 + 0.2*1 = 1.0
  assert.equal(s.effectiveness, 1);
  assert.equal(s.grade, 'A');
});

test('effectiveness: misses drop the grade and recommendation surfaces', () => {
  const hits = [weatherMission([event(NOW, 'user_notified'), event(NOW + 10 * 60_000, 'actual_impact')], 'resolved_hit')];
  const misses = [
    weatherMission([event(NOW, 'user_notified')], 'resolved_miss'),
    { ...weatherMission([event(NOW, 'user_notified')], 'resolved_miss'), id: 'wx-3' },
  ];
  const report = scoreEffectiveness([...hits, ...misses], { generatedAt: NOW });
  const s = report.scores[0]!;
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 2);
  assert.ok(s.grade === 'D' || s.grade === 'F');
  assert.match(report.recommendations[0] ?? '', /more misses than hits|effectiveness below/);
});

test('effectiveness: empty input yields N/A', () => {
  const report = scoreEffectiveness([], { generatedAt: NOW });
  assert.equal(report.scores.length, 0);
  assert.match(report.summary, /No mission/);
});

// ── Near-miss ──────────────────────────────────────────────────────────

test('near-miss: late_warning fires when warning is after impact', () => {
  const m = weatherMission(
    [
      event(NOW, 'weak_signal'),
      event(NOW + 60 * 60_000, 'actual_impact'),
      event(NOW + 70 * 60_000, 'user_notified'),
    ],
    'resolved_hit',
  );
  const reports = detectNearMisses([m], { now: () => NOW });
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.kind, 'late_warning');
});

test('near-miss: silent_signal fires when weak_signal but no warning', () => {
  const m = weatherMission([event(NOW, 'weak_signal')], 'resolved_miss');
  const reports = detectNearMisses([m], { now: () => NOW });
  assert.equal(reports[0]?.kind, 'silent_signal');
});

test('near-miss: explicit near_miss event wins', () => {
  const m = weatherMission(
    [
      event(NOW, 'weak_signal'),
      event(NOW + 60_000, 'user_notified'),
      event(NOW + 120_000, 'near_miss', 'user found via Twitter'),
    ],
    'resolved_hit',
  );
  const reports = detectNearMisses([m], { now: () => NOW });
  assert.equal(reports[0]?.kind, 'external_discovery');
});

test('near-miss: low_follow_through fires when warning sent but user never ack', () => {
  const m = weatherMission(
    [event(NOW, 'user_notified')],
    'resolved_hit',
  );
  const reports = detectNearMisses([m], { now: () => NOW });
  assert.equal(reports[0]?.kind, 'low_follow_through');
});

test('near-miss: clean mission with hit and ack produces no near-miss', () => {
  const m = weatherMission(
    [
      event(NOW, 'weak_signal'),
      event(NOW + 60_000, 'user_notified'),
      event(NOW + 120_000, 'user_acknowledged'),
      event(NOW + 60 * 60_000, 'actual_impact'),
    ],
    'resolved_hit',
  );
  const reports = detectNearMisses([m], { now: () => NOW });
  assert.equal(reports.length, 0);
});

// ── Replay fixtures ────────────────────────────────────────────────────

test('replay: resolved_miss with impact builds a warning_before_impact fixture', () => {
  const m = weatherMission(
    [event(NOW, 'weak_signal'), event(NOW + 60 * 60_000, 'actual_impact')],
    'resolved_miss',
  );
  const fixtures = buildReplayFixtures({ generatedAt: NOW, missions: [m] });
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0]?.fixtureId, 'fixture-wx-1-resolved_miss');
  assert.equal(fixtures[0]?.expectations[0]?.check.kind, 'warning_before_impact');
});

test('replay: clean hit with thin lead time builds a regression fixture', () => {
  const m = weatherMission(
    [
      event(NOW, 'user_notified'),
      event(NOW + 5 * 60_000, 'actual_impact'),
    ],
    'resolved_hit',
  );
  const fixtures = buildReplayFixtures({ generatedAt: NOW, missions: [m] });
  assert.equal(fixtures.length, 1);
  assert.match(fixtures[0]?.rationale ?? '', /thin lead time/);
});

test('replay: hits with comfortable lead time are skipped', () => {
  const m = weatherMission(
    [
      event(NOW, 'user_notified'),
      event(NOW + 60 * 60_000, 'actual_impact'),
    ],
    'resolved_hit',
  );
  const fixtures = buildReplayFixtures({ generatedAt: NOW, missions: [m] });
  assert.equal(fixtures.length, 0);
});

test('replay: pre-computed near-miss kind drives the expectation kind', () => {
  const m = weatherMission([event(NOW, 'weak_signal')], 'resolved_miss');
  const nearMisses = [
    {
      missionId: 'wx-1',
      domain: 'weather_safety' as const,
      kind: 'silent_signal' as const,
      description: 'silent',
      detectedAt: NOW,
      remediation: 'audit',
    },
  ];
  const fixtures = buildReplayFixtures({ generatedAt: NOW, missions: [m], nearMisses });
  assert.equal(fixtures[0]?.expectations[0]?.check.kind, 'no_silent_signal');
  assert.equal(fixtures[0]?.nearMissKind, 'silent_signal');
});

// ── Capability readiness ───────────────────────────────────────────────

function fakeCapability(satisfied: (boolean | undefined)[]): CapabilityDefinition {
  return {
    capabilityId: 'cap-1',
    label: 'Test capability',
    domain: 'weather_safety',
    checkpoints: satisfied.map((s, i) => ({
      id: `cp-${i}`,
      label: `Checkpoint ${i}`,
      satisfied: s,
      required: i < 2, // first two are required
      reason: s === true ? 'ok' : s === false ? 'missing' : 'not measured',
      remediation: s === false ? `fix ${i}` : undefined,
    })),
  };
}

test('capability: all satisfied → ready', () => {
  const report = evaluateCapabilities({
    generatedAt: NOW,
    capabilities: [fakeCapability([true, true, true])],
  });
  assert.equal(report.capabilities[0]?.level, 'ready');
  assert.equal(report.capabilities[0]?.score, 1);
});

test('capability: required missing → not_ready', () => {
  const report = evaluateCapabilities({
    generatedAt: NOW,
    capabilities: [fakeCapability([true, false, true])],
  });
  assert.equal(report.capabilities[0]?.level, 'not_ready');
  assert.match(report.recommendations[0] ?? '', /fix 1/);
});

test('capability: optional missing only → partial', () => {
  const report = evaluateCapabilities({
    generatedAt: NOW,
    capabilities: [fakeCapability([true, true, false])],
  });
  assert.equal(report.capabilities[0]?.level, 'partial');
});

test('capability: nothing measured → unknown', () => {
  const report = evaluateCapabilities({
    generatedAt: NOW,
    capabilities: [fakeCapability([undefined, undefined, undefined])],
  });
  assert.equal(report.capabilities[0]?.level, 'unknown');
});

test('defaultCapabilityCatalog: ships 4 capabilities tied to the gameplan', () => {
  const catalog = defaultCapabilityCatalog();
  const ids = catalog.map((c) => c.capabilityId);
  assert.ok(ids.includes('why_didnt_i_get_warned'));
  assert.ok(ids.includes('storm_mode_engagement'));
  assert.ok(ids.includes('time_to_warn_metrics'));
  assert.ok(ids.includes('closed_loop_self_improvement'));
});
