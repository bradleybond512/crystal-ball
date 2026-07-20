import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExportBundle,
  exportBundleToJson,
  exportBundleToMarkdown,
  redactDetail,
  redactString,
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

  assert.equal(bundle.schemaVersion, 2);
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

test('redactString: scrubs the OS username from home-directory paths', () => {
  // The raw log/breadcrumb appendix is the main carrier of these.
  assert.match(redactString('at file:///Users/bradleybond/Developer/app.ts:5'), /\/Users\/\[redacted\]\/Developer/);
  assert.match(redactString('error in /home/alice/src/x.js'), /\/home\/\[redacted\]\/src/);
  assert.match(redactString('C:\\Users\\Bob\\app\\main.js'), /C:\\Users\\\[redacted\]\\app/);
  // A non-home path is left intact.
  assert.equal(redactString('/usr/local/bin/node'), '/usr/local/bin/node');
});

test('redactString: scrubs credentials, tokens, and URL query secrets', () => {
  assert.match(redactString('Authorization: Bearer abcd1234efgh5678'), /Bearer \[redacted\]/);
  assert.match(redactString('key sk-ABCDEFGHIJKLMNOP123'), /\[redacted\]/);
  assert.match(redactString('GET /api/x?token=supersecretvalue&z=1'), /token=\[redacted\]/);
  assert.match(redactString('contact me@example.com'), /\[redacted\]/);
});

test('redactDetail: lat/lng coordinates are coarsened to ~10 km grid', () => {
  const out = redactDetail({ lat: 41.6082345, lng: -86.7228876 });
  assert.deepEqual(out, { lat: 41.6, lng: -86.7 });
});

test('redactDetail: camelCase compound coordinate keys are blurred', () => {
  const out = redactDetail({
    savedPlaceLat: 41.8827,
    savedPlaceLng: -87.6233,
    homeLat: 41.5,
    homeLon: -87.1,
    label: 'Chicago',
  }) as Record<string, unknown>;
  assert.equal(out.savedPlaceLat, 41.9);
  assert.equal(out.savedPlaceLng, -87.6);
  assert.equal(out.homeLat, 41.5);
  assert.equal(out.homeLon, -87.1);
  assert.equal(out.label, 'Chicago');
});

test('redactDetail: GeoJSON coordinates arrays are blurred element-wise', () => {
  // Point: [lng, lat]
  const point = redactDetail({ coordinates: [-87.6233456, 41.8827123] }) as Record<string, unknown>;
  assert.deepEqual(point.coordinates, [-87.6, 41.9]);

  // LineString: [[lng, lat], ...]
  const line = redactDetail({
    coordinates: [[-87.6233, 41.8827], [-86.9999, 41.4444]],
  }) as Record<string, unknown>;
  assert.deepEqual(line.coordinates, [[-87.6, 41.9], [-87.0, 41.4]]);
});

test('redactDetail: position/gps/geo keys with numbers are blurred', () => {
  const out = redactDetail({ gps: 41.8827123, geo: -87.6233456, position: 12.3456 }) as Record<string, unknown>;
  assert.equal(out.gps, 41.9);
  assert.equal(out.geo, -87.6);
  assert.equal(out.position, 12.3);
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
  assert.equal(parsed.schemaVersion, 2);
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

// ── Strategic-section redaction ────────────────────────────────────────
// PR198 bug-smash item 2: the strategic sections (failurePrediction,
// qualityDebt, trustBudget, improvementPlan, scenarioCoverage) used
// to pass through unredacted. These tests embed sensitive data inside
// each section and assert it's scrubbed.

test('strategic redaction: emails, bearer tokens, and API keys in qualityDebt', () => {
  const dirtyDebt = [
    {
      id: 'panel-smoke:weather:silent',
      category: 'untested_domains',
      severity: 'medium',
      ownerArea: 'diagnostics',
      summary: 'Contact bradley_bond@me.com about this',
      impact: 'Reach Bradley at +1 (555) 123-4567',
      recommendedFix: 'Use Bearer abc123def456ghi789jkl012mno345 to debug',
      // Fake key string, intentionally crafted to NOT match the
      // repo secret-scan provider pattern. The redactor key-name match
      // (`apiKey`) is what's under test here.
      apiKey: 'FAKE-TEST-KEY-VALUE-FOR-REDACTION-CHECK',
      evidence: { detail: 'logs at /var/log/crystalball mention 1234567890abcdef1234567890abcdef' },
      detectedAt: NOW,
      lastSeenAt: NOW,
    },
  ];
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
    qualityDebt: dirtyDebt as never,
  });
  const json = exportBundleToJson(bundle);
  // No email, no phone, no bearer token, no long hex blob, no API key value.
  assert.doesNotMatch(json, /bradley_bond@me\.com/);
  assert.doesNotMatch(json, /555[\s.\-)]?\s*123[\s.\-]?4567/);
  assert.doesNotMatch(json, /Bearer\s+abc123def456ghi789jkl012mno345/);
  assert.doesNotMatch(json, /FAKE-TEST-KEY-VALUE-FOR-REDACTION-CHECK/);
  assert.doesNotMatch(json, /1234567890abcdef1234567890abcdef/);
  // Round-trips
  assert.doesNotThrow(() => JSON.parse(json));
});

test('strategic redaction: lat/lng inside failurePrediction are coarsened', () => {
  const dirtyPrediction = {
    generatedAt: NOW,
    predictions: [
      {
        capabilityId: 'storm-mode',
        riskTier: 'high',
        reasons: [
          { kind: 'missing_signal', text: 'tornado polygon intersects 41.6105234, -86.7234567' },
        ],
        recommendations: [
          { kind: 'hint', text: 'Verify saved place at lat 41.6105234' },
        ],
        latitude: 41.6105234,
        longitude: -86.7234567,
      },
    ],
  };
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
    failurePrediction: dirtyPrediction as never,
  });
  // Numeric lat/lng keys → coarsened to 1 decimal (~10 km grid).
  const pred = bundle.failurePrediction as unknown as typeof dirtyPrediction;
  assert.equal(pred.predictions[0]?.latitude, 41.6);
  assert.equal(pred.predictions[0]?.longitude, -86.7);
  // String free text containing exact coordinates stays as-is for
  // numeric reading — but no email/phone/bearer/long-hex leaks.
  const json = exportBundleToJson(bundle);
  assert.doesNotMatch(json, /\bBearer\s+[A-Za-z0-9]+/);
});

test('strategic redaction: improvementPlan handoff outline scrubs free text', () => {
  const dirtyPlan = {
    generatedAt: NOW,
    rankings: [],
    handoffOutline:
      'Send results to ops@example.com. Auth: Bearer abcdef0123456789abcdef0123456789. Phone +1-555-987-6543.',
  };
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
    improvementPlan: dirtyPlan as never,
  });
  const plan = bundle.improvementPlan as unknown as typeof dirtyPlan;
  assert.doesNotMatch(plan.handoffOutline, /ops@example\.com/);
  assert.doesNotMatch(plan.handoffOutline, /Bearer\s+abcdef0123456789abcdef0123456789/);
  assert.doesNotMatch(plan.handoffOutline, /555[\s.\-)]?\s*987[\s.\-]?6543/);
});

test('strategic redaction: trustBudget free-text concerns scrubbed', () => {
  const dirtyBudget = {
    generatedAt: NOW,
    perDomain: [],
    topConcerns: ['operator user@host.com leaked Bearer aaaaaaaabbbbbbbbccccccccdddddddd'],
  };
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
    trustBudget: dirtyBudget as never,
  });
  const budget = bundle.trustBudget as unknown as typeof dirtyBudget;
  assert.doesNotMatch(budget.topConcerns[0] ?? '', /user@host\.com/);
  assert.doesNotMatch(budget.topConcerns[0] ?? '', /Bearer\s+aaaaaaaabbbbbbbbccccccccdddddddd/);
});

test('strategic redaction: bundle still JSON round-trips after scrubbing', () => {
  const bundle = buildExportBundle({
    now: () => NOW,
    app: { variant: 'full', version: '2.10.20', runtime: 'desktop' },
    systemHealth: makeSystemHealth(),
    notifications: { summary: emptyNotifSummary(), entries: [] },
    events: { snapshot: [] },
    qualityDebt: [
      {
        id: 'foo',
        category: 'noisy_algorithms',
        severity: 'low',
        ownerArea: 'algorithms',
        summary: 'tone-check email lookup@example.com',
        evidence: { detail: 'plain text' },
        detectedAt: NOW,
        lastSeenAt: NOW,
      },
    ] as never,
    failurePrediction: { generatedAt: NOW, predictions: [] } as never,
  });
  const json = exportBundleToJson(bundle);
  const parsed = JSON.parse(json) as { schemaVersion: number; qualityDebt?: { summary: string }[] };
  assert.equal(parsed.schemaVersion, 2);
  assert.doesNotMatch(parsed.qualityDebt?.[0]?.summary ?? '', /lookup@example\.com/);
});
