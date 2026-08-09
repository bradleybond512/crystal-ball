import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createStorage } from '../storage.mjs';
import { acquireLocalLock } from '../local-lock.mjs';
import {
  makeMonitorTools,
  monitorIntervalMs,
  startMonitorScheduler,
  writeMonitorJSONAtomic,
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

function createTools(baseDir, currentRef, {
  clock = { value: 1_785_000_000_000 },
  expectedIntervalMs,
  stoppedGraceMs,
  eventCooldownMs,
  maxEvents,
  recordWeeklyEvaluation,
  writeJSONAtomic,
} = {}) {
  return makeMonitorTools({
    storage: createStorage(baseDir),
    granular: {
      check_feed_health: async () => currentRef.value.feedHealth,
    },
    diagnostics: {
      get_algorithm_diagnostics: async () => currentRef.value.algorithmDiagnostics,
    },
    now: () => clock.value,
    recordWeeklyEvaluation,
    writeJSONAtomic,
    scheduleOptions: {
      expectedIntervalMs,
      stoppedGraceMs,
      eventCooldownMs,
      maxEvents,
    },
  });
}

test('monitor marks stale diagnostics red and hands fresh projections to weekly evaluation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture({ unsafe: false }) };
  const projection = { schemaVersion: 1, marker: 'public-projection' };
  current.value.algorithmDiagnostics.evaluationReportProjection = projection;
  const recorded = [];
  const tools = createTools(dir, current, {
    recordWeeklyEvaluation: (input) => recorded.push(input),
  });

  const fresh = await tools.run_monitor_cycle();
  assert.equal(fresh.snapshot.algorithmDiagnosticsStale, false);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].evaluationProjection, projection);
  assert.equal(recorded[0].diagnosticsStale, false);
  assert.equal(recorded[0].monitorState.generationId, recorded[0].monitorEvents.generationId);

  current.value.algorithmDiagnostics.stale = true;
  const stale = await tools.run_monitor_cycle();
  assert.equal(stale.snapshot.algorithmDiagnosticsStale, true);
  assert.ok(stale.findings.some((finding) => (
    finding.id === 'collection.algorithm-diagnostics-stale' && finding.severity === 'red'
  )));
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1].diagnosticsStale, true);
  rmSync(dir, { recursive: true });
});

test('monitor refuses weekly recording when the committed history generation mismatches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture({ unsafe: false }) };
  let reporterCalls = 0;
  const tools = createTools(dir, current, {
    recordWeeklyEvaluation() { reporterCalls += 1; },
    writeJSONAtomic(storage, path, value) {
      writeMonitorJSONAtomic(storage, path, path === 'monitor/history.json'
        ? value.map((row) => ({ ...row, generationId: 'mismatched-generation' }))
        : value);
    },
  });

  await assert.rejects(tools.run_monitor_cycle(), /committed monitor generation/i);
  assert.equal(reporterCalls, 0);
  rmSync(dir, { recursive: true });
});

test('weekly reporter failure preserves the committed monitor generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  const current = { value: fixture({ unsafe: false }) };
  const tools = createTools(dir, current, {
    recordWeeklyEvaluation() { throw new Error('simulated weekly report failure'); },
  });

  await assert.rejects(tools.run_monitor_cycle(), /simulated weekly report failure/);
  const state = storage.readJSON('monitor/state.json');
  const events = storage.readJSON('monitor/events.json');
  const history = storage.readJSON('monitor/history.json');
  assert.equal(state.generationId, events.generationId);
  assert.equal(history.at(-1).generationId, state.generationId);
  assert.equal(history.length, 1);
  rmSync(dir, { recursive: true });
});

test('monitor persists quarantine findings and deduplicates repeated alerts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture() };
  const tools = createTools(dir, current);

  const first = await tools.run_monitor_cycle();
  const second = await tools.run_monitor_cycle();
  const status = await tools.get_monitor_status();

  assert.deepEqual(first.newlyTriggered, ['algorithm.quarantined.warning-verification']);
  const storage = createStorage(dir);
  assert.equal(storage.readJSON('monitor/state.json').schemaVersion, 1);
  assert.equal(
    storage.readJSON('monitor/state.json').generationId,
    storage.readJSON('monitor/events.json').generationId,
  );
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

test('the LaunchAgent is the sole default scheduler owner', () => {
  assert.equal(monitorIntervalMs({}), 0);
  assert.equal(monitorIntervalMs({ CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES: '15' }), 900_000);
});

test('monitor persists the cadence supplied to an opt-in in-process scheduler', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture({ unsafe: false }) };
  const tools = createTools(dir, current, { expectedIntervalMs: 60_000 });
  await tools.run_monitor_cycle();
  assert.equal(
    createStorage(dir).readJSON('monitor/events.json').schedule.expectedIntervalMs,
    60_000,
  );
  rmSync(dir, { recursive: true });
});

test('monitor permits only one cycle owner for a shared storage directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture({ unsafe: false }) };
  let releaseFirst;
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  const release = new Promise((resolve) => { releaseFirst = resolve; });
  const first = makeMonitorTools({
    storage: createStorage(dir),
    granular: {
      check_feed_health: async () => {
        firstEntered();
        await release;
        return current.value.feedHealth;
      },
    },
    diagnostics: {
      get_algorithm_diagnostics: async () => current.value.algorithmDiagnostics,
    },
    now: () => 1_785_000_000_000,
  });
  const second = createTools(dir, current);

  const activeCycle = first.run_monitor_cycle();
  await entered;
  await assert.rejects(
    second.run_monitor_cycle(),
    /already running/i,
  );
  releaseFirst();
  await activeCycle;

  const history = createStorage(dir).readJSON('monitor/history.json');
  assert.equal(history.length, 1);
  rmSync(dir, { recursive: true });
});

test('monitor cleans up a failed lock initialization and closes its descriptor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const current = { value: fixture({ unsafe: false }) };
  let descriptorClosed = false;
  const tools = makeMonitorTools({
    storage: createStorage(dir),
    granular: {
      check_feed_health: async () => current.value.feedHealth,
    },
    diagnostics: {
      get_algorithm_diagnostics: async () => current.value.algorithmDiagnostics,
    },
    lockOptions: {
      closeSyncFn(descriptor) {
        descriptorClosed = true;
        closeSync(descriptor);
      },
      writeFileSyncFn() {
        throw new Error('simulated owner metadata failure');
      },
    },
  });

  await assert.rejects(tools.run_monitor_cycle(), /simulated owner metadata failure/);
  assert.equal(descriptorClosed, true);
  assert.equal(createStorage(dir).readJSON('monitor/cycle.lock'), null);
  await createTools(dir, current).run_monitor_cycle();
  rmSync(dir, { recursive: true });
});

test('monitor recovers an old malformed lock but preserves a recent initializing lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  const current = { value: fixture({ unsafe: false }) };
  mkdirSync(storage.resolve('monitor'), { recursive: true });
  writeFileSync(storage.resolve('monitor/cycle.lock'), '');

  await assert.rejects(createTools(dir, current).run_monitor_cycle(), /already running/i);
  const old = new Date(Date.now() - 60_000);
  utimesSync(storage.resolve('monitor/cycle.lock'), old, old);
  await createTools(dir, current).run_monitor_cycle();

  assert.equal(storage.readJSON('monitor/cycle.lock'), null);
  rmSync(dir, { recursive: true });
});

test('local lock is private, recovers dead owners, and fails closed for live or ambiguous owners', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-local-lock-'));
  const lockPath = join(dir, 'cycle.lock');
  const deadPid = 2_147_483_647;

  const release = acquireLocalLock(lockPath);
  assert.equal(statSync(lockPath).mode & 0o777, 0o600);
  assert.throws(() => acquireLocalLock(lockPath), /already running/i);
  release();

  writeFileSync(lockPath, JSON.stringify({ pid: deadPid, startedAt: Date.now() - 60_000 }));
  const releaseRecovered = acquireLocalLock(lockPath);
  releaseRecovered();

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  assert.throws(() => acquireLocalLock(lockPath), /already running/i);

  writeFileSync(lockPath, JSON.stringify({ pid: 0, startedAt: Date.now() }));
  assert.throws(() => acquireLocalLock(lockPath), /already running/i);
  rmSync(dir, { recursive: true });
});

test('monitor JSON replacement preserves the previous file when commit fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  mkdirSync(storage.resolve('monitor'), { recursive: true });
  writeFileSync(storage.resolve('monitor/state.json'), JSON.stringify({ generation: 'old' }), {
    flag: 'w',
  });

  assert.throws(() => writeMonitorJSONAtomic(
    storage,
    'monitor/state.json',
    { generation: 'new' },
    { renameSyncFn: () => { throw new Error('simulated commit failure'); } },
  ), /simulated commit failure/);
  assert.deepEqual(storage.readJSON('monitor/state.json'), { generation: 'old' });
  assert.deepEqual(readdirSync(storage.resolve('monitor')), ['state.json']);
  rmSync(dir, { recursive: true });
});

test('monitor generations fail closed during a partial commit and preserve transitions on recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };
  await createTools(dir, current, { clock, expectedIntervalMs: 60_000 }).run_monitor_cycle();

  clock.value += 60_000;
  current.value = fixture({ unsafe: true });
  const failing = makeMonitorTools({
    storage,
    granular: { check_feed_health: async () => current.value.feedHealth },
    diagnostics: { get_algorithm_diagnostics: async () => current.value.algorithmDiagnostics },
    now: () => clock.value,
    scheduleOptions: { expectedIntervalMs: 60_000 },
    writeJSONAtomic(targetStorage, path, data) {
      if (path === 'monitor/state.json') throw new Error('simulated state commit failure');
      writeMonitorJSONAtomic(targetStorage, path, data);
    },
  });
  await assert.rejects(failing.run_monitor_cycle(), /simulated state commit failure/);
  assert.notEqual(
    storage.readJSON('monitor/state.json').generationId,
    storage.readJSON('monitor/events.json').generationId,
  );
  assert.equal((await failing.get_monitor_status()).status, 'unknown');

  clock.value += 60_000;
  current.value = fixture({ unsafe: false });
  const recovered = await createTools(dir, current, {
    clock,
    expectedIntervalMs: 60_000,
  }).run_monitor_cycle();
  assert.deepEqual(
    recovered.events.filter((event) => event.subject === 'algorithm.quarantined.warning-verification')
      .map((event) => event.type),
    ['opened', 'resolved'],
  );
  assert.equal(
    storage.readJSON('monitor/state.json').generationId,
    storage.readJSON('monitor/events.json').generationId,
  );
  rmSync(dir, { recursive: true });
});

test('monitor status fails closed on a malformed matching-generation state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };
  const tools = createTools(dir, current, { clock, expectedIntervalMs: 60_000 });
  await tools.run_monitor_cycle();
  const state = storage.readJSON('monitor/state.json');
  storage.writeJSON('monitor/state.json', { ...state, lastRunAt: 'not-a-date' });
  const result = await tools.get_monitor_status();
  assert.equal(result.available, false);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.findings, []);
  rmSync(dir, { recursive: true });
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

test('monitor persists versioned schedule metadata and opened/resolved events across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };
  const options = {
    clock,
    expectedIntervalMs: 900_000,
    stoppedGraceMs: 1_200_000,
    eventCooldownMs: 3_600_000,
  };
  let tools = createTools(dir, current, options);

  const initial = await tools.run_monitor_cycle();
  assert.deepEqual(initial.schedule, {
    schemaVersion: 1,
    status: 'running',
    expectedIntervalMs: 900_000,
    stoppedGraceMs: 1_200_000,
    lastRunAt: clock.value,
    nextRunAt: clock.value + 900_000,
    stoppedAt: null,
  });

  clock.value += 300_000;
  current.value = fixture({ unsafe: true });
  const opened = await tools.run_monitor_cycle();
  assert.equal(opened.events.at(-1).type, 'opened');
  assert.equal(opened.events.at(-1).subject, 'algorithm.quarantined.warning-verification');
  assert.match(opened.events.at(-1).id, /^monitor-event-v1-[a-f0-9]{24}$/);

  tools = createTools(dir, current, options);
  clock.value += 300_000;
  const repeated = await tools.run_monitor_cycle();
  assert.equal(repeated.events.filter((event) => event.type === 'opened').length, 1);

  clock.value += 300_000;
  current.value = fixture({ unsafe: false });
  const resolved = await tools.run_monitor_cycle();
  assert.equal(resolved.events.at(-1).type, 'resolved');
  assert.equal(resolved.events.at(-1).subject, 'algorithm.quarantined.warning-verification');
  assert.equal(createStorage(dir).readJSON('monitor/events.json').schemaVersion, 1);
  rmSync(dir, { recursive: true });
});

test('monitor emits a materially escalated transition for a persistent finding severity increase', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  const clock = { value: 1_785_000_000_000 };
  storage.writeJSON('monitor/events.json', {
    schemaVersion: 1,
    generationId: 'monitor-generation-v1-1784999100000',
    schedule: {
      expectedIntervalMs: 900_000,
      stoppedGraceMs: 1_800_000,
      lastRunAt: clock.value - 900_000,
      nextRunAt: clock.value,
      stoppedAt: null,
    },
    activeFindings: {
      'collection.sidecar-unavailable': {
        severity: 'yellow',
        summary: 'Collection is degraded.',
      },
    },
    cooldowns: {},
    events: [],
  });
  const current = {
    value: {
      feedHealth: { data: { sidecar: { error: 'unreachable' }, feeds: [] } },
      algorithmDiagnostics: { available: true, diagnostics: { health: { algorithms: [] } } },
    },
  };

  const result = await createTools(dir, current, {
    clock,
    expectedIntervalMs: 900_000,
  }).run_monitor_cycle();

  assert.deepEqual(result.events.map((event) => ({
    type: event.type,
    subject: event.subject,
    fromSeverity: event.fromSeverity,
    toSeverity: event.toSeverity,
  })), [{
    type: 'materially_escalated',
    subject: 'collection.sidecar-unavailable',
    fromSeverity: 'yellow',
    toSeverity: 'red',
  }]);
  rmSync(dir, { recursive: true });
});

test('monitor reports missing schedule data as unknown and records one stopped/resumed pair after a missed window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };

  const unscheduled = createTools(dir, current, { clock });
  const neverRun = await unscheduled.get_monitor_status();
  assert.equal(neverRun.schedule.status, 'unknown');
  assert.deepEqual(neverRun.events, []);
  await unscheduled.run_monitor_cycle();
  assert.equal((await unscheduled.get_monitor_status()).schedule.status, 'unknown');

  const scheduled = createTools(dir, current, {
    clock,
    expectedIntervalMs: 900_000,
    stoppedGraceMs: 2_400_000,
  });
  await scheduled.run_monitor_cycle();
  clock.value += 2_399_999;
  assert.equal((await scheduled.get_monitor_status()).schedule.status, 'running');
  clock.value += 1;
  const stopped = await scheduled.get_monitor_status();
  assert.equal(stopped.schedule.status, 'stopped');
  assert.equal(stopped.schedule.stoppedAt, 1_785_002_400_000);

  clock.value += 60_000;
  const resumed = await scheduled.run_monitor_cycle();
  assert.deepEqual(resumed.events.slice(-2).map((event) => event.type), ['stopped', 'resumed']);

  const restarted = createTools(dir, current, {
    clock,
    expectedIntervalMs: 900_000,
    stoppedGraceMs: 2_400_000,
  });
  clock.value += 60_000;
  await restarted.run_monitor_cycle();
  const status = await restarted.get_monitor_status();
  assert.equal(status.schedule.status, 'running');
  assert.equal(status.events.filter((event) => event.type === 'stopped').length, 1);
  assert.equal(status.events.filter((event) => event.type === 'resumed').length, 1);
  rmSync(dir, { recursive: true });
});

test('monitor applies per-subject/type cooldowns across repeated finding transitions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };
  const options = {
    clock,
    expectedIntervalMs: 60_000,
    eventCooldownMs: 600_000,
    maxEvents: 20,
  };
  const tools = createTools(dir, current, options);
  await tools.run_monitor_cycle();

  for (let index = 0; index < 6; index += 1) {
    clock.value += 60_000;
    current.value = fixture({ unsafe: index % 2 === 0 });
    await tools.run_monitor_cycle();
  }
  let status = await tools.get_monitor_status();
  assert.equal(status.events.filter((event) => event.type === 'opened').length, 1);
  assert.ok(status.events.length <= 20);

  clock.value += 600_000;
  current.value = fixture({ unsafe: false });
  await tools.run_monitor_cycle();
  clock.value += 60_000;
  current.value = fixture({ unsafe: true });
  status = await tools.run_monitor_cycle();
  assert.equal(status.events.filter((event) => event.type === 'opened').length, 2);
  rmSync(dir, { recursive: true });
});

test('monitor bounds persisted event history while retaining current transition state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };
  const tools = createTools(dir, current, {
    clock,
    expectedIntervalMs: 60_000,
    eventCooldownMs: 0,
    maxEvents: 4,
  });
  await tools.run_monitor_cycle();

  for (let index = 0; index < 10; index += 1) {
    clock.value += 60_000;
    current.value = fixture({ unsafe: index % 2 === 0 });
    await tools.run_monitor_cycle();
  }

  const persisted = createStorage(dir).readJSON('monitor/events.json');
  assert.equal(persisted.events.length, 4);
  assert.deepEqual(Object.keys(persisted.activeFindings), []);
  rmSync(dir, { recursive: true });
});

test('monitor treats malformed or future-version event metadata as unknown until a successful cycle replaces it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-monitor-'));
  const storage = createStorage(dir);
  const clock = { value: 1_785_000_000_000 };
  const current = { value: fixture({ unsafe: false }) };
  await createTools(dir, current, { clock }).run_monitor_cycle();
  storage.writeJSON('monitor/events.json', {
    schemaVersion: 1,
    schedule: { lastRunAt: clock.value },
    activeFindings: {},
    cooldowns: {},
    events: [{ type: 'opened', subject: 'malformed-without-stable-fields' }],
  });
  const malformed = createTools(dir, current, { clock, expectedIntervalMs: 900_000 });
  assert.equal((await malformed.get_monitor_status()).schedule.status, 'unknown');
  assert.deepEqual((await malformed.get_monitor_status()).events, []);

  storage.writeJSON('monitor/events.json', {
    schemaVersion: 999,
    schedule: { lastRunAt: clock.value },
    events: [{ type: 'opened', subject: 'untrusted.future' }],
  });
  const tools = createTools(dir, current, { clock, expectedIntervalMs: 900_000 });

  const before = await tools.get_monitor_status();
  assert.equal(before.schedule.status, 'unknown');
  assert.deepEqual(before.events, []);

  clock.value += 900_000;
  const after = await tools.run_monitor_cycle();
  assert.equal(after.schedule.schemaVersion, 1);
  assert.equal(after.schedule.status, 'running');
  assert.equal(after.events.some((event) => event.subject === 'untrusted.future'), false);
  rmSync(dir, { recursive: true });
});
