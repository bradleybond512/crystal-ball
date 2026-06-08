import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommandCenterSummary,
  buildSituationTimeline,
  rankSituations,
  buildSituationSummary,
  matchingRulesFor,
  projectWhatChanged,
  computeFeedHealth,
  suggestedActions,
  haversineKm,
  describePlaybookStep,
  type SavedPlaceLite,
  type SituationSummary,
} from '../command-center-summary.ts';
import type { Situation, AlertRule, Playbook } from '@/types/intelligence';
import type { WhatChangedReport } from '../what-changed.ts';

const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function sit(over: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    name: 'Test situation',
    status: 'active',
    severity: 'moderate',
    domain: 'earthquake',
    startedAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    observationIds: ['o1'],
    correlationIds: [],
    summary: 'A test situation',
    tags: [],
    confidence: 0.8,
    ...over,
  };
}

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    enabled: true,
    conditions: [{ field: 'domain', operator: 'equals', value: 'earthquake' }],
    conditionOperator: 'AND',
    actions: [{ type: 'notify' }],
    created: NOW - 24 * HOUR,
    triggerCount: 0,
    ...over,
  };
}

// ─── haversineKm ──────────────────────────────────────────────────────

test('haversine: same point → 0', () => {
  assert.ok(haversineKm(0, 0, 0, 0) < 1e-6);
});

test('haversine: ~111 km per degree of latitude', () => {
  assert.ok(Math.abs(haversineKm(0, 0, 1, 0) - 111.19) < 1);
});

// ─── rankSituations ───────────────────────────────────────────────────

test('rank: severity descending wins over recency', () => {
  const older = sit({ id: 'older', severity: 'critical', updatedAt: NOW - 6 * HOUR });
  const newer = sit({ id: 'newer', severity: 'low', updatedAt: NOW - HOUR });
  const ranked = rankSituations([newer, older]);
  assert.equal(ranked[0]!.id, 'older');
});

test('rank: same severity → updatedAt desc', () => {
  const a = sit({ id: 'a', severity: 'high', updatedAt: NOW - 2 * HOUR });
  const b = sit({ id: 'b', severity: 'high', updatedAt: NOW - HOUR });
  const ranked = rankSituations([a, b]);
  assert.equal(ranked[0]!.id, 'b');
});

test('rank: empty input → empty', () => {
  assert.deepEqual(rankSituations([]), []);
});

// ─── matchingRulesFor ─────────────────────────────────────────────────

test('rules: domain-equals match fires', () => {
  const matches = matchingRulesFor(sit({ domain: 'earthquake' }), [rule()]);
  assert.deepEqual(matches, ['Test rule']);
});

test('rules: keyword-contains match against situation tags / name', () => {
  const matches = matchingRulesFor(
    sit({ tags: ['near-home'], domain: 'weather' }),
    [rule({ conditions: [{ field: 'keyword', operator: 'contains', value: 'near-home' }] })],
  );
  assert.equal(matches.length, 1);
});

test('rules: disabled rules are skipped', () => {
  const matches = matchingRulesFor(sit({ domain: 'earthquake' }), [rule({ enabled: false })]);
  assert.deepEqual(matches, []);
});

test('rules: severity-equals match', () => {
  const matches = matchingRulesFor(
    sit({ severity: 'critical' }),
    [rule({ conditions: [{ field: 'severity', operator: 'equals', value: 'critical' }] })],
  );
  assert.equal(matches.length, 1);
});

// ─── buildSituationSummary ───────────────────────────────────────────

test('summary: derives nearest saved-place + domain icon', () => {
  const places: SavedPlaceLite[] = [
    { id: 'home', name: 'Home', lat: 35.7, lon: -120.3 },
    { id: 'work', name: 'Work', lat: 40, lon: -100 },
  ];
  const s = sit({ location: { lat: 35.71, lon: -120.32, radiusKm: 50 } });
  const summary = buildSituationSummary(s, places, []);
  assert.equal(summary.nearestPlace?.id, 'home');
  assert.ok(summary.nearestPlace!.distanceKm < 10);
  assert.equal(summary.domainIcon, '🌍');
});

test('summary: no location → no nearest place', () => {
  const summary = buildSituationSummary(sit({ location: undefined }), [
    { id: 'h', name: 'h', lat: 0, lon: 0 },
  ], []);
  assert.equal(summary.nearestPlace, null);
});

test('summary: unknown domain falls back to default icon', () => {
  const summary = buildSituationSummary(sit({ domain: 'totally-new-domain' }), [], []);
  assert.equal(summary.domainIcon, '🛰');
});

// ─── projectWhatChanged ───────────────────────────────────────────────

function changeReport(over: Partial<WhatChangedReport> = {}): WhatChangedReport {
  return {
    since: NOW - HOUR,
    until: NOW,
    newEventsByDomain: {},
    resolvedEventIds: [],
    severityEscalations: [],
    newCorrelationIds: [],
    totalNewEvents: 0,
    totalResolved: 0,
    ...over,
  };
}

test('what-changed: escalations get higher weight than new events', () => {
  const items = projectWhatChanged(changeReport({
    severityEscalations: [{ domain: 'earthquake', from: 3, to: 7 }],
    newEventsByDomain: { weather: ['w1', 'w2'] },
    totalNewEvents: 2,
  }), NOW);
  assert.equal(items[0]!.polarity, 'up');
  assert.match(items[0]!.label, /severity/);
});

test('what-changed: resolved events get a "down" polarity', () => {
  const items = projectWhatChanged(changeReport({ resolvedEventIds: ['x', 'y'], totalResolved: 2 }), NOW);
  const resolved = items.find((i) => i.id.startsWith('resolved-'));
  assert.ok(resolved);
  assert.equal(resolved!.polarity, 'down');
});

test('what-changed: empty report → single "no new events" flat item', () => {
  const items = projectWhatChanged(changeReport({}), NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.polarity, 'flat');
});

test('what-changed: null report → empty list', () => {
  assert.deepEqual(projectWhatChanged(null, NOW), []);
});

test('what-changed: limit caps result', () => {
  const items = projectWhatChanged(changeReport({
    severityEscalations: Array.from({ length: 10 }, (_, i) => ({ domain: `d${i}`, from: 1, to: 3 })),
  }), NOW, 3);
  assert.equal(items.length, 3);
});

// ─── computeFeedHealth ────────────────────────────────────────────────

test('feed health: fresh when ratio ≥ 0.85 + last update < 5min', () => {
  const h = computeFeedHealth({
    feedLastSeen: { a: NOW - 60_000, b: NOW - 30_000, c: NOW - 10_000 },
    healthyFeedIds: ['a', 'b', 'c'],
    now: NOW,
  });
  assert.equal(h.freshness, 'FRESH');
  assert.equal(h.healthy, 3);
});

test('feed health: degraded when ratio < 0.5', () => {
  const h = computeFeedHealth({
    feedLastSeen: { a: NOW - 60_000, b: NOW - 30_000, c: NOW - 10_000, d: NOW - 60_000 },
    healthyFeedIds: ['a'],
    now: NOW,
  });
  assert.equal(h.freshness, 'DEGRADED');
});

test('feed health: stale when last update > 5min but < 30min', () => {
  const h = computeFeedHealth({
    feedLastSeen: { a: NOW - 10 * 60_000, b: NOW - 12 * 60_000 },
    healthyFeedIds: ['a', 'b'],
    now: NOW,
  });
  assert.equal(h.freshness, 'STALE');
});

test('feed health: no feeds → degraded with explanatory headline', () => {
  const h = computeFeedHealth({ feedLastSeen: {}, healthyFeedIds: [], now: NOW });
  assert.equal(h.freshness, 'DEGRADED');
  assert.match(h.headline, /No feed sentinels/);
});

// ─── suggestedActions ────────────────────────────────────────────────

const playbook: Playbook = {
  id: 'pb-eq',
  name: 'Earthquake playbook',
  triggerDomains: ['earthquake'],
  triggerTags: [],
  triggerSeverity: ['HIGH', 'CRITICAL'],
  steps: [
    { order: 1, action: 'Notify oncall team', category: 'notify', automated: true, automationFn: 'pushNotify' },
    { order: 2, action: 'Capture ShakeMap screenshot', category: 'verify', automated: true, automationFn: 'captureShakemap' },
    { order: 3, action: 'Manually call on-site contact', category: 'act', automated: false },
  ],
};

test('actions: prefers automated playbook steps when playbook present', () => {
  const out = suggestedActions(playbook, null, []);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.source, 'playbook');
  assert.equal(out[0]!.automated, true);
});

test('actions: falls back to matching rules when no playbook', () => {
  const r = rule();
  const topSummary = buildSituationSummary(sit({ domain: 'earthquake' }), [], [r]);
  const out = suggestedActions(null, topSummary, [r]);
  assert.equal(out[0]!.source, 'rule');
  assert.equal(out[0]!.label, 'Test rule');
});

test('actions: no playbook, no rules → empty', () => {
  assert.deepEqual(suggestedActions(null, null, []), []);
});

test('describePlaybookStep: marks automated steps explicitly', () => {
  const desc = describePlaybookStep(playbook.steps[0]!);
  assert.match(desc, /\[auto\]/);
});

// ─── buildCommandCenterSummary (top-level) ───────────────────────────

test('builder: assembles all five sections deterministically', () => {
  const places: SavedPlaceLite[] = [{ id: 'h', name: 'Home', lat: 35.7, lon: -120.3 }];
  const summary = buildCommandCenterSummary({
    situations: [
      sit({ id: 'critical', severity: 'critical', domain: 'earthquake',
        location: { lat: 35.71, lon: -120.31, radiusKm: 50 } }),
      sit({ id: 'mod', severity: 'moderate', updatedAt: NOW - 2 * HOUR }),
    ],
    whatChangedReport: changeReport({
      severityEscalations: [{ domain: 'earthquake', from: 3, to: 7 }],
      totalNewEvents: 1,
      newEventsByDomain: { earthquake: ['e1'] },
    }),
    savedPlaces: places,
    alertRules: [rule()],
    topSituationPlaybook: playbook,
    feedLastSeen: { a: NOW - 60_000, b: NOW - 30_000 },
    healthyFeedIds: ['a', 'b'],
    now: NOW,
  });
  assert.equal(summary.topSituations[0]!.id, 'critical');
  assert.ok(summary.topSituations[0]!.nearestPlace);
  assert.ok(summary.whatChanged.length > 0);
  assert.equal(summary.feedHealth.freshness, 'FRESH');
  assert.equal(summary.suggestedActions[0]!.source, 'playbook');
});

test('builder: result is JSON-serializable', () => {
  const out = buildCommandCenterSummary({
    situations: [sit()],
    whatChangedReport: null,
    savedPlaces: [],
    alertRules: [],
    feedLastSeen: {},
    healthyFeedIds: [],
    now: NOW,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('builder: empty inputs produce a coherent empty-state summary', () => {
  const out = buildCommandCenterSummary({
    situations: [],
    whatChangedReport: null,
    savedPlaces: [],
    alertRules: [],
    feedLastSeen: {},
    healthyFeedIds: [],
    now: NOW,
  });
  assert.equal(out.topSituations.length, 0);
  assert.equal(out.whatChanged.length, 0);
  assert.equal(out.feedHealth.total, 0);
  assert.equal(out.suggestedActions.length, 0);
});

test('builder: never returns more than 3 top situations', () => {
  const many = Array.from({ length: 10 }, (_, i) => sit({ id: `s${i}`, severity: 'critical', updatedAt: NOW - i * 60_000 }));
  const out = buildCommandCenterSummary({
    situations: many,
    whatChangedReport: null,
    savedPlaces: [],
    alertRules: [],
    feedLastSeen: {},
    healthyFeedIds: [],
    now: NOW,
  });
  assert.equal(out.topSituations.length, 3);
});

function summ(over: Partial<SituationSummary> = {}): SituationSummary {
  return {
    id: 'sit-1',
    name: 'Test situation',
    severity: 'moderate',
    domain: 'earthquake',
    summary: 'A test situation',
    observationCount: 2,
    correlationCount: 1,
    startedAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    nearestPlace: null,
    matchingRules: [],
    domainIcon: '⚑',
    ...over,
  };
}

test('timeline: same start/update collapses to a single detected step', () => {
  const steps = buildSituationTimeline(summ({ startedAt: NOW, updatedAt: NOW }));
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.kind, 'detected');
  assert.equal(steps[0]!.at, NOW);
  assert.match(steps[0]!.detail, /2 signals · 1 correlation/);
});

test('timeline: distinct update produces detected + latest steps in order', () => {
  const steps = buildSituationTimeline(summ({ startedAt: NOW - HOUR, updatedAt: NOW }));
  assert.equal(steps.length, 2);
  assert.equal(steps[0]!.kind, 'detected');
  assert.equal(steps[0]!.at, NOW - HOUR);
  assert.equal(steps[1]!.kind, 'latest');
  assert.equal(steps[1]!.at, NOW);
  assert.match(steps[1]!.detail, /2 signals · 1 correlation/);
});

test('timeline: sub-minute update stays a single step', () => {
  const steps = buildSituationTimeline(summ({ startedAt: NOW, updatedAt: NOW + 30_000 }));
  assert.equal(steps.length, 1);
});

test('timeline: singular signal/correlation labels', () => {
  const steps = buildSituationTimeline(summ({ startedAt: NOW, updatedAt: NOW, observationCount: 1, correlationCount: 1 }));
  assert.match(steps[0]!.detail, /1 signal · 1 correlation/);
});
