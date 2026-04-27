import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyConfidence,
  classifyUrgency,
  deliveryPriorityFor,
  tierFor,
  priorityAtLeast,
  explainPriority,
} from '../confidence-urgency-matrix.ts';

// ── Numeric → categorical ────────────────────────────────────────────────

test('classifyConfidence: thresholds align with truth-score labels', () => {
  assert.equal(classifyConfidence(0.95), 'high');
  assert.equal(classifyConfidence(0.65), 'high');
  assert.equal(classifyConfidence(0.5), 'medium');
  assert.equal(classifyConfidence(0.45), 'medium');
  assert.equal(classifyConfidence(0.3), 'low');
  assert.equal(classifyConfidence(0), 'low');
});

test('classifyConfidence: NaN defaults to low', () => {
  assert.equal(classifyConfidence(Number.NaN), 'low');
});

test('classifyConfidence: very large numbers map to high (no upper clamp needed)', () => {
  assert.equal(classifyConfidence(1.5), 'high');
});

test('classifyUrgency: 70+ high, 40-69 medium, <40 low', () => {
  assert.equal(classifyUrgency(95), 'high');
  assert.equal(classifyUrgency(70), 'high');
  assert.equal(classifyUrgency(60), 'medium');
  assert.equal(classifyUrgency(40), 'medium');
  assert.equal(classifyUrgency(20), 'low');
  assert.equal(classifyUrgency(0), 'low');
});

// ── The four matrix corners ──────────────────────────────────────────────

test('matrix corner: high conf + high urg → notify_now', () => {
  assert.equal(deliveryPriorityFor('high', 'high'), 'notify_now');
});

test('matrix corner: low conf + high urg → watch_window', () => {
  assert.equal(deliveryPriorityFor('low', 'high'), 'watch_window');
});

test('matrix corner: high conf + low urg → digest', () => {
  assert.equal(deliveryPriorityFor('high', 'low'), 'digest');
});

test('matrix corner: low conf + low urg → background', () => {
  assert.equal(deliveryPriorityFor('low', 'low'), 'background');
});

// ── Medium row ─────────────────────────────────────────────────────────

test('matrix: medium conf splits the difference', () => {
  assert.equal(deliveryPriorityFor('medium', 'high'), 'watch_window');
  assert.equal(deliveryPriorityFor('medium', 'medium'), 'digest');
  assert.equal(deliveryPriorityFor('medium', 'low'), 'background');
});

test('matrix: high conf + medium urg → notify_now (not digest)', () => {
  // High confidence with even moderate urgency is too valuable to bury
  // in the digest.
  assert.equal(deliveryPriorityFor('high', 'medium'), 'notify_now');
});

test('matrix: low conf + medium urg → background', () => {
  assert.equal(deliveryPriorityFor('low', 'medium'), 'background');
});

// ── Modifier options ─────────────────────────────────────────────────

test('option: extreme potential impact pushes low/low to watch_window', () => {
  // Plan section 8: low confidence but extreme possible impact is exactly
  // the case that should NOT stay in background.
  assert.equal(
    deliveryPriorityFor('low', 'low', { potentialImpactExtreme: true }),
    'watch_window',
  );
});

test('option: unchanged-since-last downgrades one rung', () => {
  // Plan invariant: never notify repeatedly for the same unchanged
  // situation. notify_now → watch_window.
  assert.equal(
    deliveryPriorityFor('high', 'high', { unchangedSinceLastDelivery: true }),
    'watch_window',
  );
  // digest → background.
  assert.equal(
    deliveryPriorityFor('high', 'low', { unchangedSinceLastDelivery: true }),
    'background',
  );
  // background can't go lower.
  assert.equal(
    deliveryPriorityFor('low', 'low', { unchangedSinceLastDelivery: true }),
    'background',
  );
});

// ── priorityAtLeast ──────────────────────────────────────────────────────

test('priorityAtLeast: ladder ordering', () => {
  assert.equal(priorityAtLeast('notify_now', 'digest'), true);
  assert.equal(priorityAtLeast('digest', 'notify_now'), false);
  assert.equal(priorityAtLeast('background', 'background'), true);
  assert.equal(priorityAtLeast('critical_persistent', 'notify_now'), true);
});

// ── tierFor ──────────────────────────────────────────────────────────────

test('tierFor: base tier from severity + confidence + urgency', () => {
  assert.equal(
    tierFor({ confidence: 'high', urgency: 'high', severityScore: 95 }),
    'emergency',
  );
  assert.equal(
    tierFor({ confidence: 'high', urgency: 'high', severityScore: 80 }),
    'critical',
  );
  assert.equal(
    tierFor({ confidence: 'high', urgency: 'medium', severityScore: 65 }),
    'elevated',
  );
  assert.equal(
    tierFor({ confidence: 'medium', urgency: 'medium', severityScore: 40 }),
    'watch',
  );
  assert.equal(
    tierFor({ confidence: 'low', urgency: 'low', severityScore: 10 }),
    'fyi',
  );
});

test('tierFor: high personal exposure bumps tier one rung', () => {
  const baseInputs = {
    confidence: 'medium' as const,
    urgency: 'medium' as const,
    severityScore: 50,
  };
  const baseline = tierFor(baseInputs);
  const bumped = tierFor({ ...baseInputs, highPersonalExposure: true });
  // Watch → Elevated
  assert.equal(baseline, 'watch');
  assert.equal(bumped, 'elevated');
});

test('tierFor: emergency requires high severity AND high urgency AND non-low confidence', () => {
  // High severity but low urgency shouldn't be Emergency.
  assert.notEqual(
    tierFor({ confidence: 'high', urgency: 'low', severityScore: 95 }),
    'emergency',
  );
  // Low confidence even with extreme severity should not be Emergency
  // (matches plan section 8: low-confidence-extreme-impact is watch
  // window territory, not auto-Emergency).
  assert.notEqual(
    tierFor({ confidence: 'low', urgency: 'high', severityScore: 95 }),
    'emergency',
  );
});

// ── explainPriority ─────────────────────────────────────────────────────

test('explainPriority: all priorities produce a non-empty line', () => {
  for (const c of ['low', 'medium', 'high'] as const) {
    for (const u of ['low', 'medium', 'high'] as const) {
      const p = deliveryPriorityFor(c, u);
      const line = explainPriority(c, u, p);
      assert.ok(line.length > 10, `priority ${p} → empty line`);
    }
  }
});

test('explainPriority: critical_persistent line mentions "persistent"', () => {
  const line = explainPriority('high', 'high', 'critical_persistent');
  assert.match(line, /persistent/i);
});
