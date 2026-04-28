import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExportBundle,
  exportBundleToJson,
  exportBundleToMarkdown,
  redactDetail,
  type SelfTestReportShape,
} from '../export-bundle.ts';
import { createDiagnosticEventBus } from '../diagnostic-events.ts';
import { createNotificationTraceRegistry } from '../notification-trace.ts';
import type {
  FeatureHealth,
  NotificationTraceSummary,
  PanelHealth,
  ProviderHealthRecord,
  SidecarHealth,
  SourceDiagnostic,
  SystemHealthReport,
} from '../system-health-types.ts';

const NOW = 1_745_000_000_000;

function makeSystemHealth(overrides: Partial<SystemHealthReport> = {}): SystemHealthReport {
  return {
    generatedAt: NOW,
    status: 'healthy',
    summary: 'All features and providers reporting healthy.',
    features: [],
    panels: [],
    sources: [],
    providers: [],
    notifications: emptyNotifSummary(),
    sidecar: { status: 'healthy', authenticated: true, reason: 'OK' },
    recommendations: [],
    ...overrides,
  };
}

function emptyNotifSummary(): NotificationTraceSummary {
  return {
    generatedAt: NOW,
    candidates: 0,
    dispatched: 0,
    suppressedByReason: {},
    unsafeSuppressions: [],
  };
}

function feature(overrides: Partial<FeatureHealth> = {}): FeatureHealth {
  return {
    featureId: 'weather_warning',
    label: 'Weather warnings',
    critical: true,
    status: 'healthy',
    reason: 'All deps healthy.',
    userImpact: '',
    recommendedAction: '',
    confidenceMultiplier: 1,
    dependencies: { panels: [], services: [], sources: [], providers: [] },
    ...overrides,
  };
}

function panel(): PanelHealth {
  return {
    panelId: 'nws-alerts',
    status: 'healthy',
    mounted: true,
    enabled: true,
    visible: true,
    dependencies: [],
  };
}

function source(): SourceDiagnostic {
  return {
    sourceId: 'weather',
    status: 'healthy',
    providers: ['nws-alerts'],
    reason: 'OK',
  };
}

function provider(): ProviderHealthRecord {
  return { providerId: 'nws-alerts', status: 'healthy', successRate: 1 };
}

function sidecar(): SidecarHealth {
  return { status: 'healthy', authenticated: true, reason: 'OK' };
}

// ── Basic shape ────────────────────────────────────────────────────────

test('buildExportBundle: assembles all sections', () => {
  const events = createDiagnosticEventBus({ now: () => NOW });
  events.emit({ severity: 'info', kind: 'service_started', serviceId: 'weather', message: 'started' });
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  reg.register({
    candidateId: 'wx-1',
    domain: 'weather',
    urgency: 'critical',
    confidence: 0.9,
    safetyCritical: true,
    createdAt: NOW,
  });
  reg.dispatch('wx-1', 'critical');

  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    env: { locale: 'en-US', timezone: 'America/Indiana/Indianapolis', isMacOs: true },
    systemHealth: makeSystemHealth(),
    notifications: { registry: reg },
    events,
  });

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.generatedAt, NOW);
  assert.equal(bundle.app.variant, 'full');
  assert.equal(bundle.env.locale, 'en-US');
  assert.equal(bundle.systemHealth.status, 'healthy');
  assert.equal(bundle.notificationSummary.candidates, 1);
  assert.equal(bundle.notificationSummary.dispatched, 1);
  assert.equal(bundle.notificationTraces.length, 1);
  assert.equal(bundle.recentEvents.length, 1);
});

test('buildExportBundle: snapshot path also works', () => {
  const events = [
    {
      id: 'de-1',
      at: NOW,
      severity: 'info' as const,
      kind: 'service_started' as const,
      serviceId: 'weather',
      message: 'started',
    },
  ];
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'web', version: '2.10.20', runtime: 'web' },
    systemHealth: makeSystemHealth(),
    notifications: {
      summary: { ...emptyNotifSummary(), candidates: 5, dispatched: 3 },
      entries: [],
    },
    events: { snapshot: events },
  });
  assert.equal(bundle.notificationSummary.candidates, 5);
  assert.equal(bundle.recentEvents.length, 1);
});

// ── Redaction ──────────────────────────────────────────────────────────

test('redactDetail: api keys, tokens, and emails are stripped from detail objects', () => {
  const out = redactDetail({
    apiKey: 'sk-abc123',
    nested: { authToken: 'secret', message: 'reach me at user@example.com' },
    safe: 'visible',
  });
  const obj = out as Record<string, unknown>;
  assert.equal(obj.apiKey, '[redacted]');
  const nested = obj.nested as Record<string, unknown>;
  assert.equal(nested.authToken, '[redacted]');
  assert.match(String(nested.message), /\[redacted\]/);
  assert.equal(obj.safe, 'visible');
});

test('redactDetail: lat/lng coordinates are coarsened to ~10 km grid', () => {
  const out = redactDetail({ lat: 41.6082345, lng: -86.7228876 });
  assert.deepEqual(out, { lat: 41.6, lng: -86.7 });
});

test('redactDetail: long hex strings are scrubbed (likely token leaks)', () => {
  const out = redactDetail({ raw: 'abcdef0123456789abcdef0123456789' });
  assert.equal((out as Record<string, unknown>).raw, '[redacted]');
});

test('redactDetail: bearer tokens in arbitrary strings are scrubbed', () => {
  const out = redactDetail({ msg: 'Authorization: Bearer eyJabcDEF.123-_=/+abc' });
  assert.match(String((out as Record<string, unknown>).msg), /Bearer \[redacted\]/);
});

test('buildExportBundle: redacts free-text strings inside system health', () => {
  const sh = makeSystemHealth({
    summary: 'Reach me at user@example.com if any features fail.',
    features: [
      feature({
        status: 'failing',
        userImpact: 'Email user@example.com if alerts stop',
        recommendedAction: 'Bearer eyJabcdef.x.y has expired',
      }),
    ],
    panels: [panel()],
    sources: [source()],
    providers: [provider()],
    sidecar: sidecar(),
  });
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: sh,
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
  });
  assert.match(bundle.systemHealth.summary, /\[redacted\]/);
  assert.match(bundle.systemHealth.features[0]?.userImpact ?? '', /\[redacted\]/);
  assert.match(bundle.systemHealth.features[0]?.recommendedAction ?? '', /Bearer \[redacted\]/);
});

// ── Truncation ─────────────────────────────────────────────────────────

test('caps notification traces and emits a truncation note', () => {
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  for (let i = 0; i < 100; i += 1) {
    reg.register({
      candidateId: `wx-${i}`,
      domain: 'weather',
      urgency: 'normal',
      confidence: 0.5,
      createdAt: NOW + i,
    });
  }
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { registry: reg },
    events: { snapshot: [] },
    caps: { maxNotificationTraces: 10 },
  });
  assert.equal(bundle.notificationTraces.length, 10);
  const note = bundle.truncations.find((n) => n.field === 'notificationTraces');
  assert.ok(note);
  assert.equal(note?.originalCount, 100);
  assert.equal(note?.keptCount, 10);
});

test('caps recent events with truncation note', () => {
  const events = createDiagnosticEventBus({ now: () => NOW, capacity: 1000 });
  for (let i = 0; i < 500; i += 1) {
    events.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  }
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events,
    caps: { maxRecentEvents: 25 },
  });
  assert.equal(bundle.recentEvents.length, 25);
  const note = bundle.truncations.find((n) => n.field === 'recentEvents');
  assert.equal(note?.originalCount, 500);
});

test('byte cap drops notification traces first, then events', () => {
  const events = createDiagnosticEventBus({ now: () => NOW, capacity: 1000 });
  for (let i = 0; i < 500; i += 1) {
    events.emit({ severity: 'info', kind: 'service_started', serviceId: 's', message: 'x' });
  }
  const reg = createNotificationTraceRegistry({ now: () => NOW });
  for (let i = 0; i < 50; i += 1) {
    reg.register({
      candidateId: `wx-${i}`,
      domain: 'weather',
      urgency: 'normal',
      confidence: 0.5,
      createdAt: NOW + i,
    });
  }
  // Tiny cap forces both lists to drop.
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { registry: reg },
    events,
    caps: { maxBundleBytes: 1024 },
  });
  // Both should be truncated.
  assert.equal(bundle.notificationTraces.length, 0);
  assert.equal(bundle.recentEvents.length, 0);
  const fields = bundle.truncations.map((n) => n.field);
  assert.ok(fields.includes('notificationTraces'));
});

// ── Self-test pass-through ─────────────────────────────────────────────

test('embeds the optional self-test report', () => {
  const selfTest: SelfTestReportShape = {
    generatedAt: NOW,
    status: 'pass',
    results: [
      { id: 'a', label: 'A', status: 'pass', reason: 'ok', durationMs: 5, at: NOW },
    ],
    counts: { pass: 1, fail: 0, warn: 0, skipped: 0 },
    totalDurationMs: 5,
    summary: 'All 1 self-tests passed.',
  };
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
    selfTest,
  });
  assert.equal(bundle.selfTest?.status, 'pass');
  assert.equal(bundle.selfTest?.results[0]?.id, 'a');
});

// ── Serialization helpers ──────────────────────────────────────────────

test('exportBundleToJson: round-trips identity', () => {
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
  });
  const json = exportBundleToJson(bundle);
  const parsed = JSON.parse(json) as { schemaVersion: number };
  assert.equal(parsed.schemaVersion, 1);
});

test('exportBundleToMarkdown: produces a fenced JSON code block', () => {
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
  });
  const md = exportBundleToMarkdown(bundle);
  assert.match(md, /Crystal Ball diagnostics bundle/);
  assert.match(md, /```json/);
  assert.match(md, /```\n$/);
});
