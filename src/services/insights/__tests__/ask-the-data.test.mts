import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answer,
  classifyIntent,
  type AskContext,
} from '../ask-the-data.ts';
import type { FeatureHealth, PanelHealth } from '../../diagnostics/system-health-types.ts';
import type { AlgorithmHealth } from '../../algorithms/algorithm-health.ts';
import type { MissionRecord } from '../../ops/mission-types.ts';

const NOW = 1_745_000_000_000;

function feature(overrides: Partial<FeatureHealth> = {}): FeatureHealth {
  return {
    featureId: 'f',
    label: 'F',
    critical: false,
    status: 'healthy',
    reason: 'ok',
    userImpact: '',
    recommendedAction: '',
    confidenceMultiplier: 1,
    dependencies: { panels: [], services: [], sources: [], providers: [] },
    ...overrides,
  };
}

function panel(overrides: Partial<PanelHealth> = {}): PanelHealth {
  return {
    panelId: 'p',
    label: 'P',
    status: 'healthy',
    mounted: true,
    enabled: true,
    visible: true,
    dependencies: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<AskContext> = {}): AskContext {
  return {
    features: overrides.features ?? [],
    panels: overrides.panels ?? [],
    algorithms: overrides.algorithms,
    missions: overrides.missions,
    generatedAt: NOW,
  };
}

// ── Intent classification ──────────────────────────────────────────────

test('intent: why_high_risk', () => {
  assert.equal(classifyIntent('Why is risk high?'), 'why_high_risk');
  assert.equal(classifyIntent('What is driving this alert?'), 'why_high_risk');
});

test('intent: what_changed', () => {
  assert.equal(classifyIntent('What changed since yesterday?'), 'what_changed');
});

test('intent: who_disagrees', () => {
  assert.equal(classifyIntent('Which sources disagree?'), 'who_disagrees');
  assert.equal(classifyIntent('Are sources contradicting each other?'), 'who_disagrees');
});

test('intent: what_raises_confidence', () => {
  assert.equal(classifyIntent('What would raise confidence?'), 'what_raises_confidence');
});

test('intent: what_to_watch', () => {
  assert.equal(classifyIntent('What should I watch next?'), 'what_to_watch');
});

test('intent: late_warning', () => {
  assert.equal(classifyIntent('Did we warn late last time?'), 'late_warning');
  assert.equal(classifyIntent('Why didn\'t I get warned?'), 'late_warning');
});

test('intent: unknown for off-topic questions', () => {
  assert.equal(classifyIntent('What is the weather like in Paris?'), 'unknown');
});

// ── Answer packet ──────────────────────────────────────────────────────

test('why_high_risk: surfaces failing critical features as evidence', () => {
  const c = ctx({
    features: [
      feature({
        featureId: 'wx',
        label: 'Weather',
        critical: true,
        status: 'unsafe',
        reason: 'NWS provider failing',
        userImpact: 'Severe weather alerts may not reach you.',
      }),
      feature({ featureId: 'ok', label: 'OK', status: 'healthy' }),
    ],
  });
  const a = answer('Why is risk high?', c);
  assert.equal(a.intent, 'why_high_risk');
  assert.match(a.answer, /Weather \(unsafe\)/);
  assert.equal(a.evidence.length, 1);
  assert.equal(a.evidence[0]?.id, 'feature:wx');
});

test('why_high_risk with all-healthy features → calm answer', () => {
  const c = ctx({ features: [feature()] });
  const a = answer('Why is risk high?', c);
  assert.match(a.answer, /calm/);
  assert.equal(a.evidence.length, 0);
});

test('what_changed surfaces stale + failing panels', () => {
  const c = ctx({
    panels: [
      panel({ panelId: 'a', status: 'stale' }),
      panel({ panelId: 'b', status: 'healthy' }),
      panel({ panelId: 'c', status: 'failing', lastError: 'timeout' }),
    ],
  });
  const a = answer('What changed since yesterday?', c);
  assert.match(a.answer, /2 panels/);
  assert.equal(a.evidence.length, 2);
});

test('who_disagrees surfaces panels with lastError', () => {
  const c = ctx({
    panels: [
      panel({ panelId: 'a', lastError: 'NWS 500' }),
      panel({ panelId: 'b' }),
    ],
  });
  const a = answer('Which sources disagree?', c);
  assert.match(a.answer, /1 panel reporting/);
});

test('what_raises_confidence surfaces failing algorithms', () => {
  const algorithm: AlgorithmHealth = {
    algorithmId: 'truth',
    label: 'Truth scorer',
    domain: 'truth_score',
    criticality: 'high',
    status: 'failing',
    reason: 'hit rate below 70%',
    recommendedAdjustment: 'Tighten contradiction penalties',
  };
  const c = ctx({ algorithms: [algorithm] });
  const a = answer('What would raise confidence?', c);
  assert.match(a.answer, /1 algorithm/);
  assert.match(a.evidence[0]?.fact ?? '', /Tighten contradiction/);
});

test('what_to_watch surfaces drifting features', () => {
  const c = ctx({
    features: [
      feature({ featureId: 'wx', label: 'WX', status: 'stale', recommendedAction: 'Wait for next NWS poll' }),
      feature({ featureId: 'ok', label: 'OK', status: 'healthy' }),
    ],
  });
  const a = answer('What should I watch next?', c);
  assert.equal(a.evidence.length, 1);
  assert.match(a.evidence[0]?.fact ?? '', /NWS poll/);
});

test('late_warning surfaces resolved_miss missions', () => {
  const mission: MissionRecord = {
    id: 'm1',
    domain: 'weather_safety',
    description: 'Tornado warning',
    createdAt: NOW,
    status: 'resolved_miss',
    events: [],
  };
  const c = ctx({ missions: [mission] });
  const a = answer('Did we warn late last time?', c);
  assert.match(a.answer, /1 mission/);
  assert.equal(a.evidence[0]?.id, 'mission:m1');
});

test('late_warning detects after-event warnings even when status is hit', () => {
  const mission: MissionRecord = {
    id: 'm2',
    domain: 'weather_safety',
    description: 'Severe wind',
    createdAt: NOW,
    status: 'resolved_hit',
    events: [
      { id: 'e1', at: NOW, kind: 'actual_impact', label: '' },
      { id: 'e2', at: NOW + 60_000, kind: 'user_notified', label: '' },
    ],
  };
  const c = ctx({ missions: [mission] });
  const a = answer('Did we warn late last time?', c);
  assert.match(a.answer, /1 mission/);
});

test('unknown intent returns six follow-ups', () => {
  const a = answer('What is the moon phase?', ctx());
  assert.equal(a.intent, 'unknown');
  assert.equal(a.followUps.length, 6);
});

// ── JSON ───────────────────────────────────────────────────────────────

test('answer packet is JSON-serializable', () => {
  const a = answer('Why is risk high?', ctx({ features: [feature()] }));
  const parsed = JSON.parse(JSON.stringify(a)) as { intent: string };
  assert.equal(parsed.intent, 'why_high_risk');
});
