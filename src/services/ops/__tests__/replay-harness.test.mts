import assert from 'node:assert/strict';
import test from 'node:test';

import { runReplay } from '../replay-harness.ts';
import { buildCatalogReplayFixtures } from '../replay-fixtures-catalog.ts';
import type { ReplayFixture } from '../replay-fixtures.ts';
import type { MissionRecord } from '../mission-types.ts';

const NOW = 1_777_640_400_000;
const MIN = 60 * 1000;

function fixture(mission: MissionRecord, expectations: ReplayFixture['expectations']): ReplayFixture {
  return {
    schemaVersion: 1,
    fixtureId: `fx-${mission.id}`,
    generatedAt: NOW,
    mission,
    rationale: 'test',
    pivots: {},
    expectations,
  };
}

// ── warning_before_impact ──────────────────────────────────────────────

test('warning_before_impact: lead time meets threshold → pass', () => {
  const m: MissionRecord = {
    id: 'm1',
    domain: 'weather_safety',
    description: 'sev wind',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      { id: 'e1', at: NOW, kind: 'user_notified', label: '' },
      { id: 'e2', at: NOW + 30 * MIN, kind: 'actual_impact', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'wbi', description: 'd', check: { kind: 'warning_before_impact', minLeadTimeMs: 5 * MIN } }])],
  });
  assert.equal(r.verdict, 'pass');
  assert.equal(r.results[0]?.results[0]?.outcome, 'pass');
});

test('warning_before_impact: warning AFTER impact → fail with explicit reason', () => {
  const m: MissionRecord = {
    id: 'm2',
    domain: 'weather_safety',
    description: 'late warning',
    createdAt: NOW,
    status: 'resolved_miss',
    events: [
      { id: 'e1', at: NOW, kind: 'actual_impact', label: '' },
      { id: 'e2', at: NOW + 10 * MIN, kind: 'user_notified', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'wbi', description: 'd', check: { kind: 'warning_before_impact', minLeadTimeMs: 5 * MIN } }])],
  });
  assert.equal(r.verdict, 'fail');
  assert.match(r.results[0]?.results[0]?.reason ?? '', /AFTER impact/);
});

test('warning_before_impact: no impact event → inapplicable', () => {
  const m: MissionRecord = {
    id: 'm3',
    domain: 'weather_safety',
    description: 'no impact',
    createdAt: NOW,
    status: 'active',
    events: [{ id: 'e1', at: NOW, kind: 'user_notified', label: '' }],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'wbi', description: 'd', check: { kind: 'warning_before_impact', minLeadTimeMs: 5 * MIN } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'inapplicable');
});

test('warning_before_impact: impact recorded but no warning → fail', () => {
  const m: MissionRecord = {
    id: 'm4',
    domain: 'weather_safety',
    description: 'silent',
    createdAt: NOW,
    status: 'resolved_miss',
    events: [{ id: 'e1', at: NOW, kind: 'actual_impact', label: '' }],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'wbi', description: 'd', check: { kind: 'warning_before_impact', minLeadTimeMs: 5 * MIN } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'fail');
  assert.match(r.results[0]?.results[0]?.reason ?? '', /no user_notified/);
});

// ── no_silent_signal ───────────────────────────────────────────────────

test('no_silent_signal: weak signal followed by user_notified → pass', () => {
  const m: MissionRecord = {
    id: 'm5',
    domain: 'weather_safety',
    description: 'escalated',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      { id: 'e1', at: NOW, kind: 'weak_signal', label: '' },
      { id: 'e2', at: NOW + 5 * MIN, kind: 'user_notified', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'nss', description: 'd', check: { kind: 'no_silent_signal' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'pass');
});

test('no_silent_signal: weak signal with no follower → fail', () => {
  const m: MissionRecord = {
    id: 'm6',
    domain: 'weather_safety',
    description: 'silent',
    createdAt: NOW,
    status: 'resolved_miss',
    events: [{ id: 'e1', at: NOW, kind: 'weak_signal', label: '' }],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'nss', description: 'd', check: { kind: 'no_silent_signal' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'fail');
});

test('no_silent_signal: no weak_signal events → inapplicable', () => {
  const m: MissionRecord = {
    id: 'm7',
    domain: 'weather_safety',
    description: 'no signals',
    createdAt: NOW,
    status: 'active',
    events: [],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'nss', description: 'd', check: { kind: 'no_silent_signal' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'inapplicable');
});

// ── requires_confirmation ──────────────────────────────────────────────

test('requires_confirmation: notified after confirmed → pass', () => {
  const m: MissionRecord = {
    id: 'm8',
    domain: 'weather_safety',
    description: 'confirmed',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      { id: 'e1', at: NOW, kind: 'app_watch', label: '' },
      { id: 'e2', at: NOW + MIN, kind: 'official_confirmed', label: '' },
      { id: 'e3', at: NOW + 2 * MIN, kind: 'user_notified', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'rc', description: 'd', check: { kind: 'requires_confirmation' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'pass');
});

test('requires_confirmation: notified without confirmation → fail', () => {
  const m: MissionRecord = {
    id: 'm9',
    domain: 'weather_safety',
    description: 'unconfirmed',
    createdAt: NOW,
    status: 'resolved_miss',
    events: [
      { id: 'e1', at: NOW, kind: 'app_watch', label: '' },
      { id: 'e2', at: NOW + 2 * MIN, kind: 'user_notified', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'rc', description: 'd', check: { kind: 'requires_confirmation' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'fail');
});

// ── user_action_observed ───────────────────────────────────────────────

test('user_action_observed: ack follows notify → pass', () => {
  const m: MissionRecord = {
    id: 'm10',
    domain: 'weather_safety',
    description: 'ack',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      { id: 'e1', at: NOW, kind: 'user_notified', label: '' },
      { id: 'e2', at: NOW + MIN, kind: 'user_acknowledged', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'uao', description: 'd', check: { kind: 'user_action_observed' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'pass');
});

test('user_action_observed: notify but no ack → fail', () => {
  const m: MissionRecord = {
    id: 'm11',
    domain: 'weather_safety',
    description: 'no ack',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [{ id: 'e1', at: NOW, kind: 'user_notified', label: '' }],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'uao', description: 'd', check: { kind: 'user_action_observed' } }])],
  });
  assert.equal(r.results[0]?.results[0]?.outcome, 'fail');
});

// ── Catalog integration ────────────────────────────────────────────────

test('catalog fixtures all run cleanly through the harness', () => {
  const fixtures = buildCatalogReplayFixtures();
  const r = runReplay({ generatedAt: NOW, fixtures });
  assert.equal(r.results.length, fixtures.length);
  // Catalog fixtures are misses by design — verdict will be 'fail',
  // but every fixture must have a defined outcome.
  for (const fr of r.results) {
    assert.ok(['pass', 'fail', 'inapplicable'].includes(fr.outcome));
  }
});

test('aggregate summary describes verdict correctly', () => {
  const m: MissionRecord = {
    id: 'm-pass',
    domain: 'weather_safety',
    description: 'pass',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      { id: 'e1', at: NOW, kind: 'user_notified', label: '' },
      { id: 'e2', at: NOW + 30 * MIN, kind: 'actual_impact', label: '' },
    ],
  };
  const r = runReplay({
    generatedAt: NOW,
    fixtures: [fixture(m, [{ id: 'wbi', description: 'd', check: { kind: 'warning_before_impact', minLeadTimeMs: 5 * MIN } }])],
  });
  assert.match(r.summary, /All 1 fixtures pass/);
});

// ── JSON ───────────────────────────────────────────────────────────────

test('report is JSON-serializable', () => {
  const fixtures = buildCatalogReplayFixtures();
  const r = runReplay({ generatedAt: NOW, fixtures });
  const parsed = JSON.parse(JSON.stringify(r)) as { verdict: string };
  assert.ok(['pass', 'fail', 'inapplicable'].includes(parsed.verdict));
});
