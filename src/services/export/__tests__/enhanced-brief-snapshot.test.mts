/**
 * Pure-helper tests for src/services/export/enhanced-brief-snapshot.ts
 *
 * The collector itself is impure (singleton reads + fetch), but the two
 * exported pure helpers (mapHealthStatusToFeedStatus, topScenarioSeverity)
 * are the points where the renderer's enum and the upstream enums meet —
 * exactly where contract drift bites — so they get focused tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapHealthStatusToFeedStatus,
  topScenarioSeverity,
} from '../enhanced-brief-mappers.ts';

// ── HealthStatus → FeedStatus ────────────────────────────────────────

test('mapHealthStatusToFeedStatus: healthy → green', () => {
  assert.equal(mapHealthStatusToFeedStatus('healthy'), 'green');
});

test('mapHealthStatusToFeedStatus: degraded/stale/unknown → yellow', () => {
  assert.equal(mapHealthStatusToFeedStatus('degraded'), 'yellow');
  assert.equal(mapHealthStatusToFeedStatus('stale'),    'yellow');
  assert.equal(mapHealthStatusToFeedStatus('unknown'),  'yellow');
});

test('mapHealthStatusToFeedStatus: failing/blind/unsafe → red', () => {
  assert.equal(mapHealthStatusToFeedStatus('failing'), 'red');
  assert.equal(mapHealthStatusToFeedStatus('blind'),   'red');
  // Unsafe is the safety-critical signal — should always surface as red,
  // never yellow, since the renderer sorts red-first.
  assert.equal(mapHealthStatusToFeedStatus('unsafe'),  'red');
});

// ── ScenarioSeverity → ThreatSeverity ────────────────────────────────

test('topScenarioSeverity: catastrophic → critical', () => {
  assert.equal(topScenarioSeverity('catastrophic'), 'critical');
});

test('topScenarioSeverity: severe → high', () => {
  assert.equal(topScenarioSeverity('severe'), 'high');
});

test('topScenarioSeverity: moderate/minor/positive map cleanly', () => {
  assert.equal(topScenarioSeverity('moderate'), 'medium');
  assert.equal(topScenarioSeverity('minor'),    'low');
  assert.equal(topScenarioSeverity('positive'), 'info');
});

test('topScenarioSeverity: undefined / unknown → "medium" safe default', () => {
  // Safer to default an unknown signal to medium than to drop it or
  // call it "info" — an unmapped severity is more likely a real signal
  // we haven't categorized than a benign one.
  assert.equal(topScenarioSeverity(undefined), 'medium');
  assert.equal(topScenarioSeverity('not-a-real-severity'), 'medium');
});
