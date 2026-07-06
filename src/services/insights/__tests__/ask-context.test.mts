/**
 * Tests for src/services/insights/ask-context.ts — the live-registry
 * adapter that feeds the pure ask-the-data `answer()` engine.
 *
 * The answer engine itself is covered by ask-the-data.test.mts; these
 * tests pin the adapter contract: registries are snapshotted into the
 * AskContext shape, and askLive() round-trips a question end-to-end
 * against the live singletons.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLiveAskContext, askLive } from '../ask-context.ts';
import {
  getFeatureHealthRegistry,
  getPanelHealthRegistry,
  resetDiagnosticsState,
} from '../../diagnostics/diagnostics-state.ts';
import { getMissionLedger, resetMissionState } from '../../ops/mission-state.ts';

const NOW = 1_750_000_000_000;

test('buildLiveAskContext snapshots features, panels, and missions', () => {
  resetDiagnosticsState();
  resetMissionState();

  getPanelHealthRegistry().register({ panelId: 'test-panel', label: 'Test Panel' });
  getPanelHealthRegistry().recordMount('test-panel');

  const ctx = buildLiveAskContext(() => NOW);
  // Features come pre-seeded from the default catalog.
  assert.ok(ctx.features.length > 0, 'default feature catalog should be present');
  assert.ok(ctx.panels.some((p) => p.panelId === 'test-panel'));
  assert.ok(Array.isArray(ctx.missions));
  assert.equal(ctx.generatedAt, NOW);
});

test('askLive answers a why-high-risk question from live registry state', () => {
  resetDiagnosticsState();
  resetMissionState();

  const features = getFeatureHealthRegistry();
  features.recordFailure('weather_warning', 'NWS feed unreachable', NOW);

  const packet = askLive('Why is risk high right now?');
  assert.equal(packet.intent, 'why_high_risk');
  assert.ok(packet.answer.length > 0);
  assert.ok(Array.isArray(packet.evidence));
});

test('askLive classifies watch-next questions and returns follow-ups', () => {
  resetDiagnosticsState();
  resetMissionState();

  const packet = askLive('What should I watch next?');
  assert.equal(packet.intent, 'what_to_watch');
  assert.ok(packet.followUps.length > 0);
});

test('buildLiveAskContext reflects mission ledger contents', () => {
  resetDiagnosticsState();
  resetMissionState();

  const ledger = getMissionLedger();
  const before = buildLiveAskContext(() => NOW).missions?.length ?? 0;
  ledger.openMission({
    id: 'm-ask-1',
    domain: 'weather_safety',
    description: 'test mission',
    createdAt: NOW,
  });
  const after = buildLiveAskContext(() => NOW).missions?.length ?? 0;
  assert.equal(after, before + 1);
});
