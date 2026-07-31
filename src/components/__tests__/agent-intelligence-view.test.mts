import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgentIntelligenceView,
  renderAgentIntelligenceHtml,
} from '../agent-intelligence-view.ts';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';

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

  assert.match(source, /buildAgentIntelligenceView\(report\.algorithms\)/);
  assert.match(source, /renderAgentIntelligenceHtml\(agentIntelligence\)/);
});
