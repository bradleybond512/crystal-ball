/**
 * Coverage for causal-attribution.ts — verifies the deterministic
 * root-cause analyzer ranks candidates correctly across the plan's
 * causal categories.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attributeCauses,
  type AttributeCausesInput,
  type CausalOutcomeKind,
} from '../causal-attribution.ts';
import type { MissionRecord } from '../mission-types.ts';

const baseMission: MissionRecord = {
  id: 'm1',
  domain: 'weather_safety',
  description: 'Severe Thunderstorm near Home',
  createdAt: 1_700_000_000_000,
  status: 'active',
  events: [],
};

function input(overrides: Partial<AttributeCausesInput> = {}): AttributeCausesInput {
  return {
    mission: baseMission,
    outcomeKind: 'missed_warning' as CausalOutcomeKind,
    notificationTrace: {
      permissionGranted: true,
      dispatched: false,
      suppressed: false,
      dedupedAsDuplicate: false,
    },
    algorithmEvaluations: [],
    diagnosticEvents: [],
    configGaps: [],
    ...overrides,
  };
}

test('missing saved place is the top cause when other signals are silent', () => {
  const result = attributeCauses(input({ configGaps: ['No saved place set'] }));
  assert.equal(result.candidates[0]!.category, 'missing_configuration');
  assert.match(result.candidates[0]!.remediation ?? '', /saved place/i);
  assert.match(result.summary, /No saved place/);
});

test('notification permission denial outranks downstream causes for safety domain', () => {
  const result = attributeCauses(input({
    notificationTrace: {
      permissionGranted: false,
      dispatched: false,
      suppressed: false,
      dedupedAsDuplicate: false,
    },
  }));
  // user_permission has confidence 0.9, no other candidates.
  assert.equal(result.candidates[0]!.category, 'user_permission');
});

test('user_permission does NOT fire on non-safety outcomes (e.g., true_positive)', () => {
  const result = attributeCauses(input({
    outcomeKind: 'true_positive',
    notificationTrace: {
      permissionGranted: false,
      dispatched: true,
      suppressed: false,
      dedupedAsDuplicate: false,
    },
  }));
  assert.ok(!result.candidates.some((c) => c.category === 'user_permission'));
});

test('sidecar unreachable surfaces as sidecar_failure', () => {
  const result = attributeCauses(input({
    diagnosticEvents: [{
      kind: 'sidecar_unreachable',
      detail: 'EHOSTUNREACH on port 46123',
      at: baseMission.createdAt + 1_000,
    }],
  }));
  assert.ok(result.candidates.some((c) => c.category === 'sidecar_failure'));
});

test('quiet-hours suppression surfaces with the dispatcher reason', () => {
  const result = attributeCauses(input({
    notificationTrace: {
      permissionGranted: true,
      dispatched: false,
      suppressed: true,
      suppressionReason: 'Quiet hours active and bypass disabled',
      dedupedAsDuplicate: false,
    },
  }));
  const c = result.candidates.find((x) => x.category === 'notification_suppression')!;
  assert.ok(c);
  assert.match(c.reason, /Quiet hours/);
});

test('dedupe suppression is its own category', () => {
  const result = attributeCauses(input({
    notificationTrace: {
      permissionGranted: true,
      dispatched: false,
      suppressed: false,
      dedupedAsDuplicate: true,
    },
  }));
  assert.ok(result.candidates.some((c) => c.category === 'dedupe_suppression'));
});

test('algorithm miss surfaces as algorithm_threshold for missed_warning', () => {
  const result = attributeCauses(input({
    algorithmEvaluations: [{
      id: 'eval-1',
      algorithmId: 'weather-urgency',
      domain: 'weather_urgency',
      at: baseMission.createdAt + 1000,
      durationMs: 4,
      outcome: 'miss',
      outcomeAt: baseMission.createdAt + 60000,
      outcomeReason: 'Storm landed before warning issued',
    }],
  }));
  assert.ok(result.candidates.some((c) => c.category === 'algorithm_threshold'));
});

test('algorithm misses do NOT fire as causes when the outcome was true_positive', () => {
  const result = attributeCauses(input({
    outcomeKind: 'true_positive',
    algorithmEvaluations: [{
      id: 'eval-1',
      algorithmId: 'weather-urgency',
      domain: 'weather_urgency',
      at: baseMission.createdAt + 1000,
      durationMs: 4,
      outcome: 'miss',
    }],
  }));
  assert.ok(!result.candidates.some((c) => c.category === 'algorithm_threshold'));
});

test('insufficient_evidence is the fallback only when nothing else fires', () => {
  const result = attributeCauses(input({}));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.category, 'insufficient_evidence');
});

test('true_negative outcome records a no-fault candidate', () => {
  const result = attributeCauses(input({ outcomeKind: 'true_negative' }));
  assert.ok(result.candidates.some((c) => c.category === 'true_negative' && c.confidence === 1));
});

test('candidates are sorted by confidence descending', () => {
  const result = attributeCauses(input({
    configGaps: ['No saved place set'], // 0.95
    notificationTrace: {
      permissionGranted: false, // user_permission 0.9
      dispatched: false,
      suppressed: true,
      suppressionReason: 'Quiet hours',
      dedupedAsDuplicate: false,
    },
    diagnosticEvents: [{
      kind: 'source_stale',
      detail: 'NWS feed 90 min old',
      at: baseMission.createdAt + 1_000,
    }],
  }));
  const confidences = result.candidates.map((c) => c.confidence);
  for (let i = 1; i < confidences.length; i++) {
    assert.ok(confidences[i - 1]! >= confidences[i]!,
      `not sorted: ${confidences.join(' > ')}`);
  }
});

test('output is JSON-serializable + deterministic', () => {
  const i = input({ configGaps: ['No saved place set'] });
  const a = attributeCauses(i);
  const b = attributeCauses(i);
  assert.deepEqual(a, b);
  const round = JSON.parse(JSON.stringify(a));
  assert.deepEqual(round, a);
});
