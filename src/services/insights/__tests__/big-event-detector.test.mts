import assert from 'node:assert/strict';
import test from 'node:test';

import { detectBigEvent } from '../big-event-detector.ts';
import type { BigEventInput } from '../big-event-detector.ts';

function baseInput(overrides: Partial<BigEventInput> = {}): BigEventInput {
  return {
    id: 'evt-1',
    domain: 'weather',
    severityScore: 30,
    truthScore: 0.5,
    sourceCount: 1,
    hasOfficialSource: false,
    overlappingDomains: ['weather'],
    userExposure: 20,
    potentialImpact: 30,
    ...overrides,
  };
}

// ── Trigger: rapid severity jump ────────────────────────────────────────

test('trigger: rapid_severity_jump fires when delta ≥ default 25', () => {
  const r = detectBigEvent(baseInput({
    previousSeverityScore: 20,
    severityScore: 70,
  }));
  assert.ok(r.triggers.some((t) => t.kind === 'rapid_severity_jump'));
});

test('trigger: rapid_severity_jump does not fire on small jumps', () => {
  const r = detectBigEvent(baseInput({
    previousSeverityScore: 30,
    severityScore: 40,
  }));
  assert.ok(!r.triggers.some((t) => t.kind === 'rapid_severity_jump'));
});

test('trigger: rapid_severity_jump silent when no previous severity', () => {
  const r = detectBigEvent(baseInput({ severityScore: 90 }));
  assert.ok(!r.triggers.some((t) => t.kind === 'rapid_severity_jump'));
});

// ── Trigger: many sources converge ──────────────────────────────────────

test('trigger: many_sources_converge fires at default 4 sources', () => {
  const r = detectBigEvent(baseInput({ sourceCount: 5 }));
  assert.ok(r.triggers.some((t) => t.kind === 'many_sources_converge'));
});

test('trigger: many_sources_converge silent at 3 sources (default)', () => {
  const r = detectBigEvent(baseInput({ sourceCount: 3 }));
  assert.ok(!r.triggers.some((t) => t.kind === 'many_sources_converge'));
});

test('option: manySourcesThreshold is honored', () => {
  const r = detectBigEvent(baseInput({ sourceCount: 3 }), { manySourcesThreshold: 3 });
  assert.ok(r.triggers.some((t) => t.kind === 'many_sources_converge'));
});

// ── Trigger: official confirms weak ─────────────────────────────────────

test('trigger: official_confirms_weak fires when official source present + weak signal', () => {
  const r = detectBigEvent(baseInput({
    hasOfficialSource: true,
    truthScore: 0.4,
  }));
  assert.ok(r.triggers.some((t) => t.kind === 'official_confirms_weak'));
});

test('trigger: official_confirms_weak silent when truth is already high', () => {
  const r = detectBigEvent(baseInput({
    hasOfficialSource: true,
    truthScore: 0.85,
  }));
  assert.ok(!r.triggers.some((t) => t.kind === 'official_confirms_weak'));
});

// ── Trigger: high personal exposure ─────────────────────────────────────

test('trigger: high_personal_exposure fires at exposure ≥ 70', () => {
  const r = detectBigEvent(baseInput({ userExposure: 85 }));
  assert.ok(r.triggers.some((t) => t.kind === 'high_personal_exposure'));
});

test('trigger: high_personal_exposure also bumps tier when paired with severity', () => {
  const r = detectBigEvent(baseInput({
    severityScore: 60,
    truthScore: 0.7,
    userExposure: 90,
  }));
  // Severity 60 + high confidence + urgency=medium → elevated; bumped to critical by exposure.
  assert.equal(r.tier, 'critical');
});

// ── Trigger: multi-domain overlap ───────────────────────────────────────

test('trigger: multi_domain_overlap fires for ≥2 distinct domains', () => {
  const r = detectBigEvent(baseInput({ overlappingDomains: ['weather', 'infra'] }));
  assert.ok(r.triggers.some((t) => t.kind === 'multi_domain_overlap'));
});

test('trigger: multi_domain_overlap silent for single domain', () => {
  const r = detectBigEvent(baseInput({ overlappingDomains: ['weather'] }));
  assert.ok(!r.triggers.some((t) => t.kind === 'multi_domain_overlap'));
});

test('trigger: multi_domain_overlap dedupes the input array', () => {
  const r = detectBigEvent(baseInput({ overlappingDomains: ['weather', 'weather'] }));
  assert.ok(!r.triggers.some((t) => t.kind === 'multi_domain_overlap'));
});

// ── Triggers: confidence × impact pair ─────────────────────────────────

test('trigger: high_confidence_high_impact fires when both are high', () => {
  const r = detectBigEvent(baseInput({ truthScore: 0.85, potentialImpact: 80 }));
  assert.ok(r.triggers.some((t) => t.kind === 'high_confidence_high_impact'));
});

test('trigger: low_confidence_extreme_impact fires when truth is low + potential is extreme', () => {
  const r = detectBigEvent(baseInput({ truthScore: 0.3, potentialImpact: 90 }));
  assert.ok(r.triggers.some((t) => t.kind === 'low_confidence_extreme_impact'));
});

test('trigger: low/extreme-impact does not also fire high_conf path', () => {
  const r = detectBigEvent(baseInput({ truthScore: 0.3, potentialImpact: 90 }));
  assert.ok(!r.triggers.some((t) => t.kind === 'high_confidence_high_impact'));
});

// ── Trigger: forecast threshold crossed ─────────────────────────────────

test('trigger: forecast_threshold_crossed fires when flagged', () => {
  const r = detectBigEvent(baseInput({ forecastThresholdCrossed: true }));
  assert.ok(r.triggers.some((t) => t.kind === 'forecast_threshold_crossed'));
});

test('trigger: forecast_threshold_crossed bumps urgency to at least medium', () => {
  const r = detectBigEvent(baseInput({
    forecastThresholdCrossed: true,
    severityScore: 20, // low base severity
    truthScore: 0.7,
  }));
  // Forecast crossing pushes urgency to ≥70 → high; high conf + high urg → notify_now
  assert.equal(r.urgency, 'high');
});

// ── isBigEvent threshold ────────────────────────────────────────────────

test('isBigEvent: false when no triggers fire', () => {
  const r = detectBigEvent(baseInput());
  assert.equal(r.isBigEvent, false);
  assert.equal(r.triggers.length, 0);
});

test('isBigEvent: true when total score crosses default 40', () => {
  const r = detectBigEvent(baseInput({
    truthScore: 0.85,
    potentialImpact: 80,         // +35
    sourceCount: 5,              // +25
    severityScore: 75,
  }));
  assert.equal(r.isBigEvent, true);
  assert.ok(r.totalScore >= 40);
});

test('isBigEvent: false when total score below threshold', () => {
  // One trigger (multi-domain at 20 weight) is below the 40 default.
  const r = detectBigEvent(baseInput({
    overlappingDomains: ['weather', 'markets'],
  }));
  assert.equal(r.isBigEvent, false);
  assert.equal(r.totalScore, 20);
});

test('option: lower threshold flips a borderline result', () => {
  const r = detectBigEvent(baseInput({
    overlappingDomains: ['weather', 'markets'],
  }), { threshold: 15 });
  assert.equal(r.isBigEvent, true);
});

// ── Confidence/urgency integration ─────────────────────────────────────

test('integration: high conf + many sources + multi-domain → notify_now', () => {
  const r = detectBigEvent(baseInput({
    truthScore: 0.85,
    sourceCount: 5,
    severityScore: 70,
    overlappingDomains: ['weather', 'infra'],
  }));
  assert.equal(r.confidence, 'high');
  assert.equal(r.urgency, 'high');
  assert.equal(r.deliveryPriority, 'notify_now');
  assert.equal(r.isBigEvent, true);
});

test('integration: low conf + extreme impact → watch_window (plan section 8)', () => {
  const r = detectBigEvent(baseInput({
    truthScore: 0.3,
    potentialImpact: 90,
    severityScore: 20, // low — keeps urgency low to test the matrix bump
  }));
  // potentialImpactExtreme should push background → watch_window
  assert.equal(r.confidence, 'low');
  assert.equal(r.urgency, 'low');
  assert.equal(r.deliveryPriority, 'watch_window');
});

test('integration: high conf + low urg → digest (plan section 9)', () => {
  const r = detectBigEvent(baseInput({
    truthScore: 0.85,
    severityScore: 20,
    potentialImpact: 30,
  }));
  assert.equal(r.confidence, 'high');
  assert.equal(r.urgency, 'low');
  assert.equal(r.deliveryPriority, 'digest');
});

// ── Determinism ─────────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const inputs: BigEventInput = {
    id: 'evt-x',
    domain: 'weather',
    severityScore: 70,
    previousSeverityScore: 30,
    truthScore: 0.7,
    sourceCount: 5,
    hasOfficialSource: true,
    overlappingDomains: ['weather', 'infra'],
    userExposure: 80,
    potentialImpact: 75,
    forecastThresholdCrossed: true,
  };
  const a = detectBigEvent(inputs);
  const b = detectBigEvent(inputs);
  assert.deepEqual(a, b);
});

// ── Explanation ─────────────────────────────────────────────────────────

test('explanation: leads with the strongest trigger', () => {
  const r = detectBigEvent(baseInput({
    truthScore: 0.85,
    potentialImpact: 80,            // weight 35 — should win
    sourceCount: 5,                 // weight 25
    overlappingDomains: ['a', 'b'], // weight 20
  }));
  assert.match(r.explanation, /high.confidence/i);
});

test('explanation: not-big result still surfaces a reason', () => {
  const r = detectBigEvent(baseInput());
  assert.match(r.explanation, /below big-event threshold/i);
});
