/**
 * Coverage for playbook-engine.ts — verifies every mission domain
 * has a playbook, action ranking respects urgency × confidence,
 * and JSON-serializable / deterministic invariants hold.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlaybook,
  listSupportedDomains,
  type PlaybookSituation,
} from '../playbook-engine.ts';

function situation(overrides: Partial<PlaybookSituation> = {}): PlaybookSituation {
  return {
    missionId: 'm-test',
    domain: 'weather_safety',
    severity: 70,
    confidence: 0.8,
    summary: 'Severe Thunderstorm near Home',
    affected: [{ id: 'home', label: 'Home', reason: 'Inside the polygon' }],
    ...overrides,
  };
}

test('every mission domain has a playbook template (no undefined)', () => {
  const domains = listSupportedDomains();
  for (const domain of domains) {
    const pb = buildPlaybook(situation({ domain }));
    assert.ok(pb.actions.length > 0, `${domain} has no actions`);
    assert.ok(pb.monitor.length > 0);
    assert.ok(pb.invalidatingIndicators.length > 0);
    assert.ok(pb.escalation.length > 0);
  }
});

test('actions are ordered: now → soon → watch', () => {
  const pb = buildPlaybook(situation());
  const order = pb.actions.map((a) => a.urgency);
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1]!;
    const cur = order[i]!;
    const prevRank = prev === 'now' ? 3 : prev === 'soon' ? 2 : 1;
    const curRank = cur === 'now' ? 3 : cur === 'soon' ? 2 : 1;
    assert.ok(prevRank >= curRank, `urgency ordering violated: ${order.join(' → ')}`);
  }
});

test('high severity + high confidence → headline is a "now" action', () => {
  const pb = buildPlaybook(situation({ severity: 95, confidence: 0.95 }));
  assert.equal(pb.actions[0]!.urgency, 'now');
  assert.ok(pb.actions[0]!.confidence >= 0.85);
});

test('low confidence pushes confidence scaling down without changing urgency', () => {
  const pb = buildPlaybook(situation({ confidence: 0.3, severity: 30 }));
  assert.equal(pb.actions[0]!.urgency, 'now');
  assert.ok(pb.actions[0]!.confidence < 0.6);
});

test('hazardHint is woven into the action reason', () => {
  const pb = buildPlaybook(situation({ hazardHint: 'tornado' }));
  assert.match(pb.actions[0]!.reason, /tornado/);
});

test('cyber playbook surfaces patch + isolate as top actions', () => {
  const pb = buildPlaybook(situation({
    domain: 'cyber_exposure',
    summary: 'CVE-2026-9999 actively exploited on Acme EdgeRouter',
  }));
  const ids = pb.actions.slice(0, 2).map((a) => a.id);
  assert.ok(ids.includes('patch') || ids.includes('isolate'));
});

test('weather playbook escalation lists tornado emergency', () => {
  const pb = buildPlaybook(situation());
  const triggers = pb.escalation.map((e) => e.trigger);
  assert.ok(triggers.some((t) => /Tornado/i.test(t)));
});

test('affected list passes through unchanged', () => {
  const affected = [
    { id: 'home', label: 'Home', reason: 'Inside polygon' },
    { id: 'office', label: 'Office', reason: 'Adjacent county' },
  ];
  const pb = buildPlaybook(situation({ affected }));
  assert.deepEqual(pb.affected, affected);
});

test('output is JSON-serializable + deterministic', () => {
  const a = buildPlaybook(situation());
  const b = buildPlaybook(situation());
  assert.deepEqual(a, b);
  const round = JSON.parse(JSON.stringify(a));
  assert.equal(JSON.stringify(round), JSON.stringify(a));
});

test('listSupportedDomains returns 8 mission domains', () => {
  const domains = listSupportedDomains();
  assert.equal(domains.length, 8);
});
