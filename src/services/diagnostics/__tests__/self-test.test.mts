import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runSelfTests,
  standardSelfTestDefinitions,
  type ProbeOutcome,
  type SelfTestDefinition,
} from '../self-test.ts';

const NOW = 1_745_000_000_000;

function fakeClock(start: number = NOW) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

// ── Aggregate status / counts ──────────────────────────────────────────

test('all-pass run aggregates to pass', async () => {
  const clock = fakeClock();
  const defs: SelfTestDefinition[] = [
    { id: 'a', label: 'A', probe: () => ({ status: 'pass', reason: 'ok' }) },
    { id: 'b', label: 'B', probe: () => ({ status: 'pass', reason: 'ok' }) },
  ];
  const report = await runSelfTests(defs, { now: clock.now });
  assert.equal(report.status, 'pass');
  assert.equal(report.counts.pass, 2);
  assert.match(report.summary, /All 2 self-tests passed/);
});

test('mixed run aggregates to fail when any fail', async () => {
  const defs: SelfTestDefinition[] = [
    { id: 'a', label: 'A', probe: () => ({ status: 'pass', reason: 'ok' }) },
    { id: 'b', label: 'B', probe: () => ({ status: 'warn', reason: 'meh' }) },
    { id: 'c', label: 'C', probe: () => ({ status: 'fail', reason: 'broken' }) },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.status, 'fail');
  assert.equal(report.counts.fail, 1);
  assert.equal(report.counts.warn, 1);
  assert.equal(report.counts.pass, 1);
});

test('warn-only run aggregates to warn', async () => {
  const defs: SelfTestDefinition[] = [
    { id: 'a', label: 'A', probe: () => ({ status: 'pass', reason: 'ok' }) },
    { id: 'b', label: 'B', probe: () => ({ status: 'warn', reason: 'meh' }) },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.status, 'warn');
});

test('all-skipped run reports skipped (does not falsely claim pass)', async () => {
  const defs: SelfTestDefinition[] = [
    { id: 'a', label: 'A', probe: () => ({ status: 'pass', reason: 'ok' }), skipReason: 'no-adapter' },
    { id: 'b', label: 'B', probe: () => ({ status: 'pass', reason: 'ok' }), skipReason: 'no-adapter' },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.status, 'skipped');
  assert.equal(report.counts.skipped, 2);
});

// ── Skip behavior ──────────────────────────────────────────────────────

test('skipReason short-circuits the probe', async () => {
  let called = false;
  const defs: SelfTestDefinition[] = [
    {
      id: 'a',
      label: 'A',
      probe: () => {
        called = true;
        return { status: 'pass', reason: 'ok' };
      },
      skipReason: 'web build only',
    },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(called, false);
  assert.equal(report.results[0]?.status, 'skipped');
  assert.equal(report.results[0]?.reason, 'web build only');
});

// ── Async probes + thrown errors ───────────────────────────────────────

test('async probe is awaited', async () => {
  const defs: SelfTestDefinition[] = [
    {
      id: 'async',
      label: 'Async',
      probe: async (): Promise<ProbeOutcome> => {
        await Promise.resolve();
        return { status: 'pass', reason: 'awaited ok' };
      },
    },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.results[0]?.status, 'pass');
  assert.equal(report.results[0]?.reason, 'awaited ok');
});

test('thrown error is recorded as fail with the error message', async () => {
  const defs: SelfTestDefinition[] = [
    {
      id: 'boom',
      label: 'Boom',
      probe: () => {
        throw new Error('NWS unreachable');
      },
    },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.status, 'fail');
  assert.equal(report.results[0]?.status, 'fail');
  assert.equal(report.results[0]?.reason, 'NWS unreachable');
});

test('timeout fires when probe exceeds timeoutMs', async () => {
  const defs: SelfTestDefinition[] = [
    {
      id: 'slow',
      label: 'Slow',
      timeoutMs: 30,
      probe: () =>
        new Promise<ProbeOutcome>((resolve) => {
          setTimeout(() => resolve({ status: 'pass', reason: 'eventually' }), 200);
        }),
    },
  ];
  const report = await runSelfTests(defs);
  assert.equal(report.status, 'fail');
  assert.match(report.results[0]?.reason ?? '', /timed out/);
});

// ── Result shape + JSON ────────────────────────────────────────────────

test('result includes durationMs and at', async () => {
  let t = NOW;
  const now = () => t;
  const defs: SelfTestDefinition[] = [
    {
      id: 'a',
      label: 'A',
      probe: () => {
        t += 7;
        return { status: 'pass', reason: 'ok' };
      },
    },
  ];
  const report = await runSelfTests(defs, { now });
  const r = report.results[0]!;
  assert.equal(r.at, NOW);
  assert.equal(r.durationMs, 7);
});

test('report is JSON-serializable', async () => {
  const defs: SelfTestDefinition[] = [
    { id: 'a', label: 'A', probe: () => ({ status: 'pass', reason: 'ok' }) },
  ];
  const report = await runSelfTests(defs, { now: () => NOW });
  const json = JSON.stringify(report);
  const parsed = JSON.parse(json) as { status: string; counts: { pass: number } };
  assert.equal(parsed.status, 'pass');
  assert.equal(parsed.counts.pass, 1);
});

// ── Standard probe builders ────────────────────────────────────────────

test('standardSelfTestDefinitions: empty adapters → all skipped', async () => {
  const defs = standardSelfTestDefinitions({});
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.results.length, 9);
  assert.equal(report.counts.skipped, 9);
  assert.equal(report.status, 'skipped');
});

test('standardSelfTestDefinitions: ALL adapters wired → 0 skipped (the regression guard)', async () => {
  // Mirrors what SystemDiagnosticPanel now passes. If a future edit drops an
  // adapter, that probe silently reverts to `skipped` (green-when-broken) — this
  // asserts every one of the 9 probes actually runs.
  const defs = standardSelfTestDefinitions({
    fetchSidecarDiag: () => Promise.resolve({ ok: true }),
    checkNotificationPermission: () => Promise.resolve('granted'),
    countSavedPlaces: () => 1,
    runNwsPolygonFixture: () => Promise.resolve({ ok: true }),
    countProviderRegistry: () => 12,
    isStorageAvailable: () => ({ indexedDb: true, localStorage: true }),
    probeDataSources: () => Promise.resolve({ healthy: 3, degraded: 0, failing: 0 }),
    countRecentRendererErrors: () => 0,
    countMountedPanels: () => ({ mounted: 5, total: 5 }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  assert.equal(report.results.length, 9);
  assert.equal(report.counts.skipped, 0);
});

test('standardSelfTestDefinitions: notification denied is fail with remediation', async () => {
  const defs = standardSelfTestDefinitions({
    checkNotificationPermission: () => Promise.resolve('denied'),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'notification_permission')!;
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /System Settings/);
});

test('standardSelfTestDefinitions: notification default is warn', async () => {
  const defs = standardSelfTestDefinitions({
    checkNotificationPermission: () => Promise.resolve('default'),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'notification_permission')!;
  assert.equal(r.status, 'warn');
});

test('standardSelfTestDefinitions: notification granted is pass', async () => {
  const defs = standardSelfTestDefinitions({
    checkNotificationPermission: () => Promise.resolve('granted'),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'notification_permission')!;
  assert.equal(r.status, 'pass');
});

test('standardSelfTestDefinitions: empty saved places is fail', async () => {
  const defs = standardSelfTestDefinitions({ countSavedPlaces: () => 0 });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'saved_places')!;
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /Settings/);
});

test('standardSelfTestDefinitions: at least one saved place is pass', async () => {
  const defs = standardSelfTestDefinitions({ countSavedPlaces: () => 2 });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'saved_places')!;
  assert.equal(r.status, 'pass');
  assert.match(r.reason, /2 saved places/);
});

test('standardSelfTestDefinitions: storage indexedDB unavailable is warn', async () => {
  const defs = standardSelfTestDefinitions({
    isStorageAvailable: () => ({ indexedDb: false, localStorage: true }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'storage_available')!;
  assert.equal(r.status, 'warn');
});

test('standardSelfTestDefinitions: storage neither available is fail', async () => {
  const defs = standardSelfTestDefinitions({
    isStorageAvailable: () => ({ indexedDb: false, localStorage: false }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'storage_available')!;
  assert.equal(r.status, 'fail');
});

test('standardSelfTestDefinitions: data sources with failing → fail status', async () => {
  const defs = standardSelfTestDefinitions({
    probeDataSources: () => Promise.resolve({ healthy: 5, degraded: 2, failing: 1 }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'data_source_probes')!;
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /1 data source failing/);
});

test('standardSelfTestDefinitions: data sources with degraded only → warn', async () => {
  const defs = standardSelfTestDefinitions({
    probeDataSources: () => Promise.resolve({ healthy: 5, degraded: 2, failing: 0 }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'data_source_probes')!;
  assert.equal(r.status, 'warn');
});

test('standardSelfTestDefinitions: 5+ renderer errors → fail', async () => {
  const defs = standardSelfTestDefinitions({
    countRecentRendererErrors: () => 7,
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'recent_renderer_errors')!;
  assert.equal(r.status, 'fail');
});

test('standardSelfTestDefinitions: 1-4 renderer errors → warn', async () => {
  const defs = standardSelfTestDefinitions({
    countRecentRendererErrors: () => 2,
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'recent_renderer_errors')!;
  assert.equal(r.status, 'warn');
});

test('standardSelfTestDefinitions: zero panels mounted with non-empty registry → fail', async () => {
  const defs = standardSelfTestDefinitions({
    countMountedPanels: () => ({ mounted: 0, total: 12 }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'panel_registry_mounted')!;
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /0 of 12/);
});

test('standardSelfTestDefinitions: empty registry is warn (not yet mounted vs failed mount)', async () => {
  const defs = standardSelfTestDefinitions({
    countMountedPanels: () => ({ mounted: 0, total: 0 }),
  });
  const report = await runSelfTests(defs, { now: () => NOW });
  const r = report.results.find((x) => x.id === 'panel_registry_mounted')!;
  assert.equal(r.status, 'warn');
});
