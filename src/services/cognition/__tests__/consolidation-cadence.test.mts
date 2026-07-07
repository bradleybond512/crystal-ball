import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldRunConsolidation,
  CONSOLIDATION_INTERVAL_MS,
  runConsolidationTick,
} from '../consolidation-cadence.ts';
import type { ConsolidationTickOptions } from '../consolidation-cadence.ts';
import type { ConsolidationReport } from '../consolidation.ts';

test('runs when never run', () => assert.equal(shouldRunConsolidation(null, 0), true));
test('waits within interval', () => assert.equal(shouldRunConsolidation(1_000_000, 1_060_000), false));
test('runs after interval', () => assert.equal(shouldRunConsolidation(0, CONSOLIDATION_INTERVAL_MS + 1), true));

// ── runConsolidationTick (PR 14: idle-scheduled invocation) ────────────────────

function makeStubStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    _store: store,
  };
}

const stubReport: ConsolidationReport = {
  episodesProcessed: 0, clustersFound: 0, schemasDistilled: 0,
  schemasRegistered: 0, schemasRetired: 0, schemasEvicted: 0, ranAt: 0,
};

test('runConsolidationTick: skips entirely in Ghost Mode', () => {
  let ran = false;
  const opts: ConsolidationTickOptions = {
    isGhostModeFn: () => true,
    storage: makeStubStorage(),
    runConsolidationFn: async () => { ran = true; return stubReport; },
  };
  runConsolidationTick(opts);
  assert.equal(ran, false);
});

test('runConsolidationTick: skips when the consolidation kill-switch is off', () => {
  let ran = false;
  const opts: ConsolidationTickOptions = {
    isGhostModeFn: () => false,
    isCognitionEnabledFn: () => false,
    storage: makeStubStorage(),
    runConsolidationFn: async () => { ran = true; return stubReport; },
  };
  runConsolidationTick(opts);
  assert.equal(ran, false);
});

test('runConsolidationTick: skips when not yet due', () => {
  let ran = false;
  const now = 1_000_000;
  const opts: ConsolidationTickOptions = {
    isGhostModeFn: () => false,
    isCognitionEnabledFn: () => true,
    now: () => now,
    storage: makeStubStorage({ 'cb:consolidation-last': String(now - 1000) }),
    runConsolidationFn: async () => { ran = true; return stubReport; },
  };
  runConsolidationTick(opts);
  assert.equal(ran, false);
});

test('runConsolidationTick: schedules the run via scheduleIdleWork (idle-time, visible)', () => {
  let ran = false;
  let recorded: ConsolidationReport | null = null;
  const storage = makeStubStorage();
  const opts: ConsolidationTickOptions = {
    isGhostModeFn: () => false,
    isCognitionEnabledFn: () => true,
    now: () => CONSOLIDATION_INTERVAL_MS + 1,
    storage,
    runConsolidationFn: async () => { ran = true; return stubReport; },
    recordReportFn: (report) => { recorded = report; },
    idleOpts: {
      isVisible: () => true,
      requestIdleCallbackFn: (cb) => { cb({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    },
  };

  runConsolidationTick(opts);

  return new Promise<void>((resolve) => {
    setImmediate(() => {
      assert.equal(ran, true, 'runConsolidationFn should have run via the idle callback');
      assert.deepEqual(recorded, stubReport);
      assert.ok(storage.getItem('cb:consolidation-last') !== null, 'last-run timestamp should be persisted');
      resolve();
    });
  });
});

test('runConsolidationTick: idle work is skipped while the page is hidden (due tick, no run)', () => {
  let ran = false;
  const opts: ConsolidationTickOptions = {
    isGhostModeFn: () => false,
    isCognitionEnabledFn: () => true,
    now: () => CONSOLIDATION_INTERVAL_MS + 1,
    storage: makeStubStorage(),
    runConsolidationFn: async () => { ran = true; return stubReport; },
    idleOpts: { isVisible: () => false },
  };
  runConsolidationTick(opts);
  assert.equal(ran, false, 'hidden tab should skip this tick entirely');
});

test('runConsolidationTick: never throws even if runConsolidationFn rejects', () => {
  const storage = makeStubStorage();
  const opts: ConsolidationTickOptions = {
    isGhostModeFn: () => false,
    isCognitionEnabledFn: () => true,
    now: () => CONSOLIDATION_INTERVAL_MS + 1,
    storage,
    runConsolidationFn: async () => { throw new Error('boom'); },
    idleOpts: {
      isVisible: () => true,
      requestIdleCallbackFn: (cb) => { cb({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    },
  };
  assert.doesNotThrow(() => runConsolidationTick(opts));
});
