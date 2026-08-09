import assert from 'node:assert/strict';
import test from 'node:test';

import { detectDegradations } from '../degradation-alerts.ts';
import type { SystemHealthReport } from '../system-health-types.ts';

function baseReport(overrides: Partial<SystemHealthReport> = {}): SystemHealthReport {
  return {
    generatedAt: 1000,
    status: 'healthy',
    summary: 'All good',
    features: [],
    panels: [],
    sources: [],
    providers: [],
    notifications: {
      generatedAt: 1000,
      candidates: 0,
      dispatched: 0,
      suppressedByReason: {},
      unsafeSuppressions: [],
    },
    sidecar: {
      status: 'healthy',
      authenticated: true,
      reason: 'ok',
    },
    recommendations: [],
    ...overrides,
  };
}

// ── Rule 1: feature healthy → degraded ────────────────────────────────

test('rule 1: feature healthy → degraded emits alert', () => {
  const prev = baseReport({
    features: [{ featureId: 'weather', label: 'Weather', critical: false, status: 'healthy', reason: '', userImpact: '', recommendedAction: '', confidenceMultiplier: 1 }],
  });
  const curr = baseReport({
    features: [{ featureId: 'weather', label: 'Weather', critical: false, status: 'degraded', reason: 'provider slow', userImpact: '', recommendedAction: '', confidenceMultiplier: 0.8 }],
  });
  const alerts = detectDegradations(prev, curr);
  assert.ok(alerts.some(a => a.subjectId === 'weather' && a.toStatus === 'degraded'), 'must alert on weather degradation');
});

test('rule 1: feature → unsafe emits alert with safetyCritical=true', () => {
  const prev = baseReport({
    features: [{ featureId: 'nws', label: 'NWS', critical: true, status: 'healthy', reason: '', userImpact: '', recommendedAction: '', confidenceMultiplier: 1 }],
  });
  const curr = baseReport({
    features: [{ featureId: 'nws', label: 'NWS', critical: true, status: 'unsafe', reason: 'no data', userImpact: '', recommendedAction: '', confidenceMultiplier: 0 }],
  });
  const alerts = detectDegradations(prev, curr);
  const alert = alerts.find(a => a.subjectId === 'nws');
  assert.ok(alert, 'must alert on unsafe transition');
  assert.ok(alert.safetyCritical, 'unsafe transition must be safetyCritical');
});

// ── Rule 2: panel → stale / failing ────────────────────────────────────

test('rule 2: panel → stale emits alert', () => {
  const prev = baseReport({
    panels: [{ panelId: 'weather-panel', status: 'healthy', mounted: true, enabled: true, visible: true, dependencies: [] }],
  });
  const curr = baseReport({
    panels: [{ panelId: 'weather-panel', status: 'stale', mounted: true, enabled: true, visible: true, dependencies: [] }],
  });
  const alerts = detectDegradations(prev, curr);
  assert.ok(alerts.some(a => a.subjectId === 'weather-panel' && a.toStatus === 'stale'), 'must alert on panel stale');
});

test('rule 2: panel → failing emits alert', () => {
  const prev = baseReport({
    panels: [{ panelId: 'news-panel', status: 'healthy', mounted: true, enabled: true, visible: true, dependencies: [] }],
  });
  const curr = baseReport({
    panels: [{ panelId: 'news-panel', status: 'failing', mounted: true, enabled: true, visible: true, dependencies: [] }],
  });
  const alerts = detectDegradations(prev, curr);
  assert.ok(alerts.some(a => a.subjectId === 'news-panel' && a.toStatus === 'failing'), 'must alert on panel failing');
});

test('rule 2: hidden or unmounted panel failures do not emit alerts', () => {
  const prev = baseReport({
    panels: [
      { panelId: 'hidden-panel', status: 'healthy', mounted: true, enabled: true, visible: false, dependencies: [] },
      { panelId: 'unmounted-panel', status: 'healthy', mounted: false, enabled: true, visible: true, dependencies: [] },
    ],
  });
  const curr = baseReport({
    panels: [
      { panelId: 'hidden-panel', status: 'failing', mounted: true, enabled: true, visible: false, dependencies: [] },
      { panelId: 'unmounted-panel', status: 'failing', mounted: false, enabled: true, visible: true, dependencies: [] },
    ],
  });
  assert.deepEqual(detectDegradations(prev, curr), []);
});

// ── Rule 3: unsafeSuppressions count increasing ─────────────────────────

test('rule 3: unsafeSuppressions increasing emits notification_pipeline alert', () => {
  const prev = baseReport({
    notifications: {
      generatedAt: 1000,
      candidates: 5,
      dispatched: 5,
      suppressedByReason: {},
      unsafeSuppressions: [],
    },
  });
  const curr = baseReport({
    notifications: {
      generatedAt: 2000,
      candidates: 6,
      dispatched: 5,
      suppressedByReason: {},
      unsafeSuppressions: [{ candidateId: 'c1', reason: 'quiet-hours', at: 2000 }],
    },
  });
  const alerts = detectDegradations(prev, curr);
  assert.ok(alerts.some(a => a.kind === 'notification_pipeline'), 'must alert on unsafe suppression increase');
});

// ── Rule 4: recovery emits nothing ─────────────────────────────────────

test('rule 4: recovery degraded → healthy emits nothing', () => {
  const prev = baseReport({
    features: [{ featureId: 'weather', label: 'Weather', critical: false, status: 'degraded', reason: '', userImpact: '', recommendedAction: '', confidenceMultiplier: 0.8 }],
  });
  const curr = baseReport({
    features: [{ featureId: 'weather', label: 'Weather', critical: false, status: 'healthy', reason: '', userImpact: '', recommendedAction: '', confidenceMultiplier: 1 }],
  });
  const alerts = detectDegradations(prev, curr);
  assert.equal(alerts.length, 0, 'recovery must not alert');
});

// ── Rule 5: prev null → no alerts ──────────────────────────────────────

test('rule 5: prev null emits nothing (first run baseline)', () => {
  const curr = baseReport({
    features: [{ featureId: 'weather', label: 'Weather', critical: false, status: 'unsafe', reason: '', userImpact: '', recommendedAction: '', confidenceMultiplier: 0 }],
  });
  const alerts = detectDegradations(null, curr);
  assert.equal(alerts.length, 0, 'first run must not alert');
});
