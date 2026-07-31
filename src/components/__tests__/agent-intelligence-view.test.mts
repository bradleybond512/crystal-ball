import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgentIntelligenceView,
  nextAgentMonitorPollDelayMs,
  renderAgentIntelligenceHtml,
} from '../agent-intelligence-view.ts';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import {
  markAgentMonitorProjectionUnavailable,
  parseAgentMonitorProjection,
} from '../../services/agent-monitor-projection.ts';

function algorithm(overrides: Partial<AlgorithmHealth>): AlgorithmHealth {
  return {
    algorithmId: 'example',
    label: 'Example',
    domain: 'forecast_calibration',
    criticality: 'medium',
    status: 'healthy',
    reason: 'within floor',
    recommendedAdjustment: '',
    ...overrides,
  };
}

test('unsafe derived output activates quarantine without claiming direct feeds are disabled', () => {
  const view = buildAgentIntelligenceView([
    algorithm({
      algorithmId: 'warning-verification',
      label: 'Warning verification',
      criticality: 'safety',
      status: 'unsafe',
      reason: 'below release floor',
    }),
    algorithm({
      algorithmId: 'direct-weather-feed',
      label: 'Direct weather feed',
      status: 'healthy',
    }),
  ]);

  assert.equal(view.state, 'protection-active');
  assert.deepEqual(view.quarantinedAlgorithmIds, ['warning-verification']);
  assert.match(view.summary, /derived algorithm is blocked/i);
  assert.match(view.directSourcePolicy, /not disabled/i);
  assert.doesNotMatch(view.summary, /all clear/i);
});

test('missing safety evidence is presented as uncertainty instead of healthy', () => {
  const view = buildAgentIntelligenceView([
    algorithm({
      algorithmId: 'warning-verification',
      criticality: 'safety',
      status: 'unknown',
      reason: 'insufficient evidence',
    }),
  ]);

  assert.equal(view.state, 'evidence-building');
  assert.match(view.summary, /evidence/i);
});

test('a failing non-safety algorithm is not presented as protected', () => {
  const view = buildAgentIntelligenceView([
    algorithm({
      algorithmId: 'forecast-calibration',
      criticality: 'medium',
      status: 'failing',
      reason: 'below release floor',
    }),
  ]);

  assert.notEqual(view.state, 'protected');
  assert.doesNotMatch(view.label, /safeguards ready/i);
  assert.match(view.summary, /failing/i);
});

test('a degraded algorithm is not presented as protected', () => {
  const view = buildAgentIntelligenceView([
    algorithm({ status: 'degraded', reason: 'latency above release floor' }),
  ]);

  assert.notEqual(view.state, 'protected');
  assert.doesNotMatch(view.label, /safeguards ready/i);
});

test('unknown non-safety evidence is not presented as protected', () => {
  const view = buildAgentIntelligenceView([
    algorithm({ status: 'unknown', reason: 'insufficient evidence' }),
  ]);

  assert.notEqual(view.state, 'protected');
  assert.doesNotMatch(view.label, /safeguards ready/i);
});

test('an empty algorithm registry is not presented as protected', () => {
  const view = buildAgentIntelligenceView([]);

  assert.notEqual(view.state, 'protected');
  assert.doesNotMatch(view.label, /safeguards ready/i);
});

test('agent explanation describes the local data path and operational limits', () => {
  const view = buildAgentIntelligenceView([
    algorithm({ algorithmId: 'forecast', status: 'healthy' }),
  ]);
  const html = renderAgentIntelligenceHtml(view);

  assert.equal(view.flow.length, 4);
  assert.match(html, /Direct sources/);
  assert.match(html, /Local sidecar/);
  assert.match(html, /MCP safety layer/);
  assert.match(html, /Claude and Codex/);
  assert.match(html, /Crystal Ball must be open/i);
  assert.match(html, /15 minutes/i);
  assert.doesNotMatch(html, /token|api key|secret/i);
});

test('algorithm diagnostics panel renders the agent intelligence explanation', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(join(here, '..', 'AlgorithmDiagnosticPanel.ts'), 'utf8');

  assert.match(source, /buildAgentIntelligenceView\(report\.algorithms, this\.monitorProjection\)/);
  assert.match(source, /renderAgentIntelligenceHtml\(agentIntelligence\)/);
});

test('monitor projection adds operational status while preserving algorithm quarantine fallback', () => {
  const view = buildAgentIntelligenceView([
    algorithm({ algorithmId: 'local-safety', criticality: 'safety', status: 'unsafe' }),
  ], {
    schemaVersion: 1,
    generatedAt: 2_000,
    state: 'degraded',
    lastRunAt: 1_000,
    nextRunAt: 3_000,
    compatibility: { status: 'compatible', stateSchemaVersion: 1, supportedSchemaVersion: 1 },
    findings: [{ id: 'drift.feed.weather', severity: 'yellow' }],
    events: [{ id: 'event-1', type: 'resolved', at: 1_500, findingId: 'drift.feed.markets' }],
    recovered: ['drift.feed.markets'],
    quarantine: { activeCount: 1, algorithmIds: ['warning-verification'] },
    capabilities: {
      liveCollection: true,
      algorithmDiagnostics: true,
      feeds: { ready: 1, degraded: 1, unavailable: 0, unknown: 0, total: 2 },
    },
  });
  const html = renderAgentIntelligenceHtml(view);

  assert.equal(view.state, 'protection-active');
  assert.match(html, /Monitor degraded/i);
  assert.match(html, /Last run/i);
  assert.match(html, /Next run/i);
  assert.match(html, /drift\.feed\.weather/);
  assert.match(html, /Recovered/i);
  assert.match(html, /warning-verification/);
  assert.match(html, /Compatibility: compatible/i);
  assert.match(html, /data-agent-monitor-refresh/);
});

test('unavailable monitor projection keeps the algorithm-health view truthful', () => {
  const view = buildAgentIntelligenceView([algorithm({ status: 'healthy' })], {
    schemaVersion: 1,
    generatedAt: 2_000,
    state: 'unavailable',
    lastRunAt: null,
    nextRunAt: null,
    compatibility: { status: 'unknown', stateSchemaVersion: null, supportedSchemaVersion: 1 },
    findings: [],
    events: [],
    recovered: [],
    quarantine: { activeCount: 0, algorithmIds: [] },
    capabilities: {
      liveCollection: null,
      algorithmDiagnostics: null,
      feeds: { ready: 0, degraded: 0, unavailable: 0, unknown: 0, total: 0 },
    },
  });
  const html = renderAgentIntelligenceHtml(view);

  assert.equal(view.state, 'protected');
  assert.match(view.label, /safeguards ready/i);
  assert.match(html, /Monitor unavailable/i);
  assert.doesNotMatch(html, /all clear/i);
});

test('monitor polling uses bounded backoff and a calm success cadence', () => {
  assert.equal(nextAgentMonitorPollDelayMs(0), 60_000);
  assert.equal(nextAgentMonitorPollDelayMs(1), 15_000);
  assert.equal(nextAgentMonitorPollDelayMs(2), 30_000);
  assert.equal(nextAgentMonitorPollDelayMs(20), 300_000);
});

test('monitor projection parser rejects malformed and future responses', () => {
  assert.equal(parseAgentMonitorProjection({ schemaVersion: 2, state: 'live' }), null);
  assert.equal(parseAgentMonitorProjection({ schemaVersion: 1, state: 'healthy' }), null);
  assert.equal(parseAgentMonitorProjection({ schemaVersion: 1, state: 'live' }), null);
});

test('monitor projection accepts real route-shaped finding IDs and disconnects old live state', () => {
  const live = {
    schemaVersion: 1 as const,
    generatedAt: 2_000,
    state: 'live' as const,
    lastRunAt: 1_000,
    nextRunAt: 3_000,
    compatibility: { status: 'compatible' as const, stateSchemaVersion: 1, supportedSchemaVersion: 1 },
    findings: [{ id: 'drift.feed./api/nws-alerts', severity: 'yellow' as const }],
    events: [],
    recovered: [],
    quarantine: { activeCount: 0, algorithmIds: [] },
    capabilities: {
      liveCollection: true,
      algorithmDiagnostics: true,
      feeds: { ready: 1, degraded: 0, unavailable: 0, unknown: 0, total: 1 },
    },
  };
  assert.ok(parseAgentMonitorProjection(live));
  const disconnected = markAgentMonitorProjectionUnavailable(live, 4_000);
  assert.equal(disconnected.state, 'unavailable');
  assert.equal(disconnected.generatedAt, 4_000);
  assert.equal(disconnected.lastRunAt, 1_000);
});

test('algorithm diagnostics panel polls read-only status, offers refresh, and tears down lifecycle work', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(join(here, '..', 'AlgorithmDiagnosticPanel.ts'), 'utf8');

  assert.match(source, /fetchAgentMonitorProjection/);
  assert.match(source, /data-agent-monitor-refresh/);
  assert.match(source, /clearTimeout\(this\.monitorPollTimer\)/);
  assert.match(source, /this\.monitorAbortController\?\.abort\(\)/);
  assert.match(source, /markAgentMonitorProjectionUnavailable/);
  assert.doesNotMatch(source, /run_monitor_cycle|run-monitor-cycle/);
});
