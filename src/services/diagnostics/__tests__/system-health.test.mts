import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateFromRegistries,
  aggregateSystemHealth,
  contextFromSnapshots,
} from '../system-health.ts';
import { createFeatureHealthRegistry } from '../feature-health-registry.ts';
import type {
  FeatureHealth,
  HealthStatus,
  NotificationTraceSummary,
  PanelHealth,
  ProviderHealthRecord,
  SidecarHealth,
  SourceDiagnostic,
} from '../system-health-types.ts';

const NOW = 1_745_000_000_000;

// ── Fixture helpers ─────────────────────────────────────────────────────

function feature(overrides: Partial<FeatureHealth> = {}): FeatureHealth {
  return {
    featureId: 'weather_warning',
    label: 'Weather warnings',
    critical: true,
    status: 'healthy',
    reason: 'All dependencies healthy.',
    userImpact: '',
    recommendedAction: '',
    confidenceMultiplier: 1,
    dependencies: { panels: [], services: [], sources: [], providers: [] },
    ...overrides,
  };
}

function panel(overrides: Partial<PanelHealth> = {}): PanelHealth {
  return {
    panelId: 'nws-alerts',
    status: 'healthy',
    mounted: true,
    enabled: true,
    visible: true,
    dependencies: [],
    ...overrides,
  };
}

function source(overrides: Partial<SourceDiagnostic> = {}): SourceDiagnostic {
  return {
    sourceId: 'weather',
    status: 'healthy',
    providers: ['nws-alerts'],
    reason: 'OK',
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderHealthRecord> = {}): ProviderHealthRecord {
  return {
    providerId: 'nws-alerts',
    status: 'healthy',
    successRate: 1,
    ...overrides,
  };
}

function notifications(
  overrides: Partial<NotificationTraceSummary> = {},
): NotificationTraceSummary {
  return {
    generatedAt: NOW,
    candidates: 0,
    dispatched: 0,
    suppressedByReason: {},
    unsafeSuppressions: [],
    ...overrides,
  };
}

function sidecar(overrides: Partial<SidecarHealth> = {}): SidecarHealth {
  return {
    status: 'healthy',
    authenticated: true,
    reason: 'OK',
    ...overrides,
  };
}

// ── Status calculator ──────────────────────────────────────────────────

test('aggregate: all healthy → status healthy with cheerful summary', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [feature()],
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  assert.equal(report.status, 'healthy');
  assert.match(report.summary, /All features and providers/);
  assert.equal(report.recommendations.length, 0);
});

test('critical feature unsafe → system unsafe + recommendation surfaced first', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [
      feature({
        status: 'unsafe',
        userImpact: 'Severe weather alerts may not reach you.',
        recommendedAction: 'Open Settings → Locations.',
      }),
    ],
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  assert.equal(report.status, 'unsafe');
  assert.match(report.summary, /Critical/);
  assert.match(report.summary, /Weather warnings/);
  assert.equal(report.recommendations[0], 'Weather warnings: Open Settings → Locations.');
});

test('critical feature failing → system unsafe (escalation)', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [
      feature({
        status: 'failing',
        userImpact: 'x',
        recommendedAction: 'y',
      }),
    ],
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  assert.equal(report.status, 'unsafe');
});

test('non-critical feature failing without sidecar issue → system failing', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [
      feature({
        featureId: 'flights',
        label: 'Flights',
        critical: false,
        status: 'failing',
        userImpact: 'live aircraft positions may be missing',
        recommendedAction: 'Re-auth ADS-B providers',
      }),
    ],
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  assert.equal(report.status, 'failing');
  assert.match(report.recommendations[0] ?? '', /Re-auth ADS-B/);
});

test('sidecar failing trumps feature degradation → system failing', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [feature()], // healthy
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar({ status: 'failing', reason: 'sidecar exited' }),
  });
  assert.equal(report.status, 'failing');
  assert.match(
    report.recommendations.find((r) => r.startsWith('Sidecar:')) ?? '',
    /sidecar exited/,
  );
});

test('unsafe notification suppressions degrade an otherwise-healthy system', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [feature()],
    sources: [source()],
    providers: [provider()],
    notifications: notifications({
      unsafeSuppressions: [
        { candidateId: 'wx-1', reason: 'quiet-hours-no-bypass', at: NOW - 1000 },
      ],
    }),
    sidecar: sidecar(),
  });
  assert.equal(report.status, 'degraded');
  assert.match(
    report.recommendations.find((r) => r.startsWith('Notifications:')) ?? '',
    /unsafe suppressions/,
  );
});

// ── Worst-status-wins for non-critical features ─────────────────────────

test('worst-status-wins: stale feature + degraded source → degraded', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [
      feature({
        featureId: 'shortage_forecasts',
        label: 'Shortage forecasts',
        critical: false,
        status: 'stale',
        userImpact: 'a',
        recommendedAction: 'b',
      }),
    ],
    sources: [source({ status: 'degraded', reason: 'partial' })],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  // stale is more severe than degraded in the severity table
  assert.equal(report.status, 'stale');
});

// ── Recommendation ordering ────────────────────────────────────────────

test('recommendations: critical features come before non-critical, no duplicates', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [
      feature({
        featureId: 'flights',
        label: 'Flights',
        critical: false,
        status: 'failing',
        userImpact: 'a',
        recommendedAction: 'do A',
      }),
      feature({
        featureId: 'weather_warning',
        label: 'Weather warnings',
        critical: true,
        status: 'unsafe',
        userImpact: 'b',
        recommendedAction: 'do B',
      }),
    ],
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  assert.equal(report.recommendations[0], 'Weather warnings: do B');
  assert.equal(report.recommendations[1], 'Flights: do A');
});

// ── Context builder + end-to-end with registry ─────────────────────────

test('contextFromSnapshots builds the right id → status maps', () => {
  const ctx = contextFromSnapshots({
    panels: [panel({ panelId: 'a', status: 'failing' })],
    sources: [source({ sourceId: 'weather', status: 'stale' })],
    providers: [provider({ providerId: 'nws-alerts', status: 'degraded' })],
  });
  assert.equal(ctx.panelStatuses?.get('a'), 'failing');
  assert.equal(ctx.sourceStatuses?.get('weather'), 'stale');
  assert.equal(ctx.providerStatuses?.get('nws-alerts'), 'degraded');
});

test('aggregateFromRegistries: end-to-end weather warning unsafe path', () => {
  const features = createFeatureHealthRegistry({ now: () => NOW });
  features.register({
    featureId: 'weather_warning',
    label: 'Weather warnings',
    critical: true,
    dependencies: {
      panels: ['nws-alerts'],
      services: [],
      sources: ['weather'],
      providers: ['nws-alerts'],
    },
    userImpactWhenDegraded: 'Severe weather alerts may not reach you.',
    recommendedActionWhenDegraded: 'Restart Crystal Ball.',
  });
  features.recordSuccess('weather_warning');

  const panels: PanelHealth[] = [panel({ panelId: 'nws-alerts', status: 'failing' })];
  const sources: SourceDiagnostic[] = [source({ sourceId: 'weather' })];
  const providers: ProviderHealthRecord[] = [provider({ providerId: 'nws-alerts' })];

  const report = aggregateFromRegistries({
    features,
    panels,
    sources,
    providers,
    notifications: notifications(),
    sidecar: sidecar(),
    generatedAt: NOW,
  });
  assert.equal(report.status, 'unsafe');
  assert.equal(report.features[0]?.featureId, 'weather_warning');
  assert.equal(report.features[0]?.status, 'unsafe');
});

// ── Determinism / serializability ──────────────────────────────────────

test('output is JSON-serializable', () => {
  const report = aggregateSystemHealth({
    generatedAt: NOW,
    panels: [panel()],
    features: [feature()],
    sources: [source()],
    providers: [provider()],
    notifications: notifications(),
    sidecar: sidecar(),
  });
  const json = JSON.stringify(report);
  const parsed = JSON.parse(json) as { status: HealthStatus };
  assert.equal(parsed.status, 'healthy');
});
