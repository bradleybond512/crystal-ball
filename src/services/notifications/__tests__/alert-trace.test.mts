import assert from 'node:assert/strict';
import test from 'node:test';
import {
  traceAlert,
  STAGE_ORDER,
  ALERT_TRACE_SCHEMA_VERSION,
  type AlertTraceStage,
  type AlertTraceStageName,
} from '../alert-trace.ts';
import type { ObservationEvent } from '@/types/intelligence';
import type { NotificationSettings } from '../notification-settings-service.ts';
import type { SavedPlace } from '@/services/saved-places';

// ── Fixtures ─────────────────────────────────────────────────────────────

function baseSettings(): NotificationSettings {
  return {
    version: 1,
    global: {
      masterMute: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      dailySummaryEnabled: false,
    },
    domains: {
      earthquakes: { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      wildfire:    { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      aviation:    { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      maritime:    { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      biosurveillance: { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      space_weather: { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      infrastructure: { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      geopolitical: { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      weather:     { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      cyber:       { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
      supply:      { enabled: true, threshold: 'medium', channel: 'both', quietHoursEnabled: false },
    },
  };
}

function eventNear(lat: number, lon: number, overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'evt-test-1',
    sourceId: 'usgs-earthquake',
    domain: 'seismic',
    timestamp: 1_715_000_000_000,
    location: { lat, lon },
    severity: 'MEDIUM',
    title: 'M5.2 earthquake near Tokyo',
    raw: {},
    entityIds: [],
    tags: ['earthquake'],
    ...overrides,
  };
}

function place(lat: number, lon: number, name = 'Home'): SavedPlace {
  return {
    id: `place-${name}`,
    name,
    lat,
    lon,
    radiusKm: 50,
    tags: ['home'],
    priority: 10,
    notes: '',
    offlinePinned: false,
    primary: true,
    source: 'manual',
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function findStage(stages: AlertTraceStage[], name: AlertTraceStageName): AlertTraceStage {
  const s = stages.find((x) => x.name === name);
  assert.ok(s, `expected stage "${name}"`);
  return s!;
}

const NOW = 1_715_000_120_000; // 2 minutes after the fixture event

// ── 1. Schema + stage order ─────────────────────────────────────────────

test('STAGE_ORDER lists all six stages in pipeline order', () => {
  assert.deepEqual(STAGE_ORDER, [
    'source-receipt',
    'normalization',
    'relevance-scoring',
    'quiet-hours',
    'threshold-check',
    'delivery',
  ]);
});

test('SCHEMA_VERSION is exposed for future migration', () => {
  assert.equal(ALERT_TRACE_SCHEMA_VERSION, 1);
});

// ── 2. Happy path ───────────────────────────────────────────────────────

test('happy-path event in a covered domain delivers via in_app + native', () => {
  const trace = traceAlert(eventNear(35.68, 139.69), baseSettings(), [place(35.68, 139.69)], { nowMs: NOW });
  assert.equal(trace.outcome, 'delivered');
  assert.deepEqual(trace.channels, ['in_app', 'native']);
  for (const s of trace.stages) assert.notEqual(s.status, 'fail', `stage ${s.name} should not fail`);
});

// ── 3. Source receipt ───────────────────────────────────────────────────

test('source-receipt fails when event is missing sourceId', () => {
  const evt = eventNear(35, 139, { sourceId: '' });
  const trace = traceAlert(evt, baseSettings(), [], { nowMs: NOW });
  assert.equal(findStage(trace.stages, 'source-receipt').status, 'fail');
  assert.equal(trace.outcome, 'not-evaluated');
});

test('source-receipt records sourceId in value field for valid events', () => {
  const trace = traceAlert(eventNear(0, 0), baseSettings(), [], { nowMs: NOW });
  assert.equal(findStage(trace.stages, 'source-receipt').value, 'usgs-earthquake');
});

// ── 4. Normalization ────────────────────────────────────────────────────

test('normalization passes when event domain maps to a settings row', () => {
  const trace = traceAlert(eventNear(0, 0), baseSettings(), [], { nowMs: NOW });
  const s = findStage(trace.stages, 'normalization');
  assert.equal(s.status, 'pass');
  assert.equal(typeof s.value, 'string');
  assert.ok((s.value as string).includes('earthquakes'));
});

test('normalization fails when event domain is unknown', () => {
  const evt = eventNear(0, 0, { domain: 'mystery-domain' });
  const trace = traceAlert(evt, baseSettings(), [], { nowMs: NOW });
  assert.equal(findStage(trace.stages, 'normalization').status, 'fail');
});

test('normalization maps obs severity UPPERCASE → notification severity lowercase', () => {
  const evt = eventNear(0, 0, { severity: 'CRITICAL' });
  const trace = traceAlert(evt, baseSettings(), [], { nowMs: NOW });
  assert.ok((findStage(trace.stages, 'normalization').value as string).includes('critical'));
});

// ── 5. Relevance scoring ────────────────────────────────────────────────

test('relevance-scoring awards 50 proximity points for events within 50km', () => {
  const trace = traceAlert(eventNear(35.68, 139.69), baseSettings(), [place(35.68, 139.69)], { nowMs: NOW });
  const s = findStage(trace.stages, 'relevance-scoring');
  assert.equal(s.status, 'pass');
  assert.ok((s.value as number) >= 50);
});

test('relevance-scoring awards 0 proximity when no saved-place is provided', () => {
  const trace = traceAlert(eventNear(0, 0), baseSettings(), [], { nowMs: NOW });
  const s = findStage(trace.stages, 'relevance-scoring');
  // No proximity, no location → score is just severity + recency
  assert.ok((s.value as number) < 50);
});

test('relevance-scoring caps at 100', () => {
  const evt = eventNear(0, 0, { severity: 'CRITICAL' });
  const trace = traceAlert(evt, baseSettings(), [place(0, 0)], { nowMs: NOW });
  assert.ok((findStage(trace.stages, 'relevance-scoring').value as number) <= 100);
});

// ── 6. Quiet hours ──────────────────────────────────────────────────────

test('quiet-hours passes when quietHoursEnabled is false', () => {
  const s = baseSettings();
  s.domains.earthquakes.quietHoursEnabled = false;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW, hourOverride: 3 });
  assert.equal(findStage(trace.stages, 'quiet-hours').status, 'pass');
});

test('quiet-hours fails when inside window and severity is below critical', () => {
  const s = baseSettings();
  s.domains.earthquakes.quietHoursEnabled = true;
  // 03:00 is inside default 22:00–07:00 window
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW, hourOverride: 3, minuteOverride: 0 });
  assert.equal(findStage(trace.stages, 'quiet-hours').status, 'fail');
  assert.equal(trace.outcome, 'suppressed');
});

test('quiet-hours: critical severity always bypasses the window', () => {
  const s = baseSettings();
  s.domains.earthquakes.quietHoursEnabled = true;
  const evt = eventNear(0, 0, { severity: 'CRITICAL' });
  const trace = traceAlert(evt, s, [], { nowMs: NOW, hourOverride: 3 });
  assert.equal(findStage(trace.stages, 'quiet-hours').status, 'pass');
  assert.equal(trace.outcome, 'delivered');
});

test('quiet-hours: boundary at 07:00 (window end) is OUTSIDE quiet window', () => {
  const s = baseSettings();
  s.domains.earthquakes.quietHoursEnabled = true;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW, hourOverride: 7, minuteOverride: 0 });
  assert.equal(findStage(trace.stages, 'quiet-hours').status, 'pass');
});

test('quiet-hours: boundary at 22:00 (window start) is INSIDE quiet window', () => {
  const s = baseSettings();
  s.domains.earthquakes.quietHoursEnabled = true;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW, hourOverride: 22, minuteOverride: 0 });
  assert.equal(findStage(trace.stages, 'quiet-hours').status, 'fail');
});

// ── 7. Threshold check ──────────────────────────────────────────────────

test('threshold-check passes when severity equals configured threshold', () => {
  const trace = traceAlert(eventNear(0, 0), baseSettings(), [], { nowMs: NOW });
  // MEDIUM event, medium threshold
  assert.equal(findStage(trace.stages, 'threshold-check').status, 'pass');
});

test('threshold-check fails when severity is below threshold', () => {
  const s = baseSettings();
  s.domains.earthquakes.threshold = 'high';
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  // MEDIUM event vs high threshold
  assert.equal(findStage(trace.stages, 'threshold-check').status, 'fail');
  assert.equal(trace.outcome, 'suppressed');
});

test('threshold-check fails when master mute is on', () => {
  const s = baseSettings();
  s.global.masterMute = true;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.equal(findStage(trace.stages, 'threshold-check').status, 'fail');
  assert.equal(trace.outcome, 'suppressed');
});

test('threshold-check fails when domain is disabled', () => {
  const s = baseSettings();
  s.domains.earthquakes.enabled = false;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.equal(findStage(trace.stages, 'threshold-check').status, 'fail');
});

// ── 8. Delivery channels ────────────────────────────────────────────────

test('delivery returns in_app + native when channel is "both"', () => {
  const s = baseSettings();
  s.domains.earthquakes.channel = 'both';
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.deepEqual(trace.channels, ['in_app', 'native']);
});

test('delivery returns only in_app when channel is "in_app"', () => {
  const s = baseSettings();
  s.domains.earthquakes.channel = 'in_app';
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.deepEqual(trace.channels, ['in_app']);
});

test('delivery returns only native when channel is "native"', () => {
  const s = baseSettings();
  s.domains.earthquakes.channel = 'native';
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.deepEqual(trace.channels, ['native']);
});

test('delivery is skipped (no channels) when any earlier stage failed', () => {
  const s = baseSettings();
  s.global.masterMute = true;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.equal(findStage(trace.stages, 'delivery').status, 'skip');
  assert.deepEqual(trace.channels, []);
});

// ── 9. Summary banner ───────────────────────────────────────────────────

test('summary banner reports "Delivered via …" when outcome is delivered', () => {
  const trace = traceAlert(eventNear(0, 0), baseSettings(), [], { nowMs: NOW });
  assert.ok(trace.summary.startsWith('Delivered via'));
});

test('summary banner names the blocker stage when suppressed', () => {
  const s = baseSettings();
  s.domains.earthquakes.enabled = false;
  const trace = traceAlert(eventNear(0, 0), s, [], { nowMs: NOW });
  assert.ok(trace.summary.includes('threshold-check'));
});

test('every stage appears once in the order defined by STAGE_ORDER', () => {
  const trace = traceAlert(eventNear(0, 0), baseSettings(), [], { nowMs: NOW });
  const names = trace.stages.map((s) => s.name);
  assert.deepEqual(names, STAGE_ORDER);
});
