import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createStorage } from '../storage.mjs';
import {
  makeMonitorTools,
  startMonitorScheduler,
} from '../tools/monitor.mjs';

function fixture({ brier = 0.2, coverage = 0.8, total = 100, unsafe = true, feed = 'ok' } = {}) {
  return {
    feedHealth: {
      data: {
        sidecar: { pid: 123 },
        feeds: [{ route: '/api/nws-alerts', status: feed, error: feed === 'ok' ? null : 'timeout' }],
      },
    },
    algorithmDiagnostics: {
      available: true,
      diagnostics: {
        health: {
          algorithms: unsafe
            ? [{ algorithmId: 'warning-verification', criticality: 'safety', status: 'unsafe' }]
            : [{ algorithmId: 'warning-verification', criticality: 'safety', status: 'healthy' }],
        },
        forecastCalibration: {
          summary: { total, resolved: Math.round(total * coverage) },
          resolutionQuality: { summary: { resolutionCoverage: coverage } },
          evaluation: {
            overall: {
              brier: { status: 'ok', value: brier, sampleSize: 50 },
              exclusions: { proxyLabels: 2, invalidProbabilities: 0, trainingWindowOverlap: 0 },
            },
            lossAttribution: {
              byAlgorithmVersion: [{
                key: 'warning-verification@1.0.0',
                shareOfBrierLoss: 0.4,
              }],
            },
          },
        },
      },
    },
  };
}

function createTools(baseDir, currentRef) {
  return makeMonitorTools({
    storage: createStorage(baseDir),
    granular: {
      check_feed_health: async () => currentRef.value.feedHealth,
    },
    diagnostics: {
      get_algorithm_diagnostics: async () => currentRef.value.algorithmDiagnostics,
    },
    now: () => 1_785_000_000_000,
  });
}

test('monitor persists quarantine findings and deduplicates repeated alerts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture() };
  const tools = createTools(dir, current);

  const first = await tools.run_monitor_cycle();
  const second = await tools.run_monitor_cycle();
  const status = await tools.get_monitor_status();

  assert.deepEqual(first.newlyTriggered, ['algorithm.quarantined.warning-verification']);
  assert.deepEqual(second.newlyTriggered, []);
  assert.equal(status.available, true);
  assert.equal(status.findings[0].severity, 'red');
  rmSync(dir, { recursive: true });
});

test('monitor detects calibration, coverage, volume, and feed drift then records recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture({ unsafe: false }) };
  const tools = createTools(dir, current);
  await tools.run_monitor_cycle();

  current.value = fixture({
    brier: 0.31,
    coverage: 0.55,
    total: 40,
    unsafe: false,
    feed: 'error',
  });
  const degraded = await tools.run_monitor_cycle();

  assert.ok(degraded.findings.some((finding) => finding.id === 'drift.calibration.brier'));
  assert.ok(degraded.findings.some((finding) => finding.id === 'drift.resolution.coverage'));
  assert.ok(degraded.findings.some((finding) => finding.id === 'drift.prediction.volume'));
  assert.ok(degraded.findings.some((finding) => finding.id === 'drift.feed./api/nws-alerts'));

  current.value = fixture({ unsafe: false });
  const recovered = await tools.run_monitor_cycle();
  assert.ok(recovered.recovered.includes('drift.feed./api/nws-alerts'));
  rmSync(dir, { recursive: true });
});

test('monitor scheduler is opt-in and unrefs its timer', () => {
  let unrefCalled = false;
  let scheduledMs = null;
  const fakeSetInterval = (_fn, ms) => {
    scheduledMs = ms;
    return { unref() { unrefCalled = true; } };
  };

  assert.equal(startMonitorScheduler(async () => {}, { intervalMs: 0, setIntervalFn: fakeSetInterval }), null);
  const timer = startMonitorScheduler(async () => {}, { intervalMs: 60_000, setIntervalFn: fakeSetInterval });

  assert.ok(timer);
  assert.equal(scheduledMs, 60_000);
  assert.equal(unrefCalled, true);
});

test('monitor fails closed when live collection and diagnostics are unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = {
    value: {
      feedHealth: {
        data: {
          sidecar: { error: 'unreachable' },
          feeds: [{ route: '/api/nws-alerts', status: 'error', error: 'unreachable' }],
        },
      },
      algorithmDiagnostics: { available: false },
    },
  };
  const tools = createTools(dir, current);

  const result = await tools.run_monitor_cycle();

  assert.equal(result.status, 'red');
  assert.ok(result.findings.some((finding) => finding.id === 'collection.sidecar-unavailable'));
  assert.ok(result.findings.some((finding) => finding.id === 'collection.algorithm-diagnostics-unavailable'));
  rmSync(dir, { recursive: true });
});
