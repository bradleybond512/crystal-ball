import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createClock, createSchedulerHarness, runSchedulingScenario, summarizeStarts } from './helpers/refresh-scheduler-clock.mjs';
import { measureRefreshScheduling } from '../scripts/measure-refresh-scheduling.mts';

async function fixture(t, options = {}) {
  const harness = await createSchedulerHarness(options); t.after(() => harness.dispose()); return harness;
}

test('clock handles bounded callback/microtask ordering and rejects unbounded advances', async () => {
  const clock = createClock({ maxCallbacks: 3 }), order = [];
  clock.setTimeout(() => { order.push('timer'); Promise.resolve().then(() => { order.push('microtask'); clock.setTimeout(() => order.push('nested'), 0); }); }, 10);
  await clock.advanceBy(10); assert.deepEqual(order, ['timer', 'microtask', 'nested']); assert.equal(clock.pending().length, 0);
  const recursive = () => clock.setTimeout(recursive, 0); clock.setTimeout(recursive, 0); await assert.rejects(clock.advanceBy(0), /callback budget/);
  await assert.rejects(clock.advanceBy(Infinity), /Bounded/); await assert.rejects(clock.advanceBy(-1), /Bounded/);
  const tiny = createClock({ maxTrace: 1 }); tiny.setTimeout(() => {}, 1); assert.throws(() => tiny.setTimeout(() => {}, 2), /trace budget/);
});

test('fixture restores all ambient descriptors even after an assertion or pending loader', async () => {
  const targets = [[globalThis, 'localStorage'], [globalThis, 'document'], [globalThis, 'navigator'], [globalThis, 'window'], [globalThis, 'CustomEvent'], [globalThis, 'setTimeout'], [globalThis, 'clearTimeout'], [globalThis, 'performance'], [globalThis, 'fetch'], [Date, 'now'], [Math, 'random'], [console, 'warn'], [console, 'error']];
  const before = targets.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key)); const h = await createSchedulerHarness({ randomValues: [0.5] });
  try { h.scheduler.scheduleRefresh('blocked', h.job('blocked', { blocked: true }), 1000); await h.clock.advanceBy(1000); assert.equal(h.active, 1); throw new Error('Synthetic assertion exit'); } catch (error) { assert.match(error.message, /Synthetic assertion/); } finally { assert.deepEqual(await h.dispose(), { pendingTimers: 0, active: 0 }); }
  targets.forEach(([object, key], index) => assert.deepEqual(Object.getOwnPropertyDescriptor(object, key), before[index]));
});

test('real scheduling preserves lower/mid/upper jitter bounds and the one-second floor', async t => {
  const h = await fixture(t, { randomValues: [0, 0.5, 1, 0] });
  h.scheduler.registerAll([9000, 10_000, 11_000].map((expected, index) => ({ name: `${expected}`, intervalMs: 10_000, fn: h.job(`${expected}`) })));
  h.scheduler.scheduleRefresh('floor', h.job('floor'), 10);
  assert.deepEqual(h.clock.pending().map(task => task.at), [1000, 9000, 10_000, 11_000]);
  await h.clock.advanceBy(11_000); assert.deepEqual(h.starts.filter(row => row.name !== 'floor').map(row => row.at), [9000, 10_000, 11_000]);
});

test('unchanged/rejected outcomes double capped backoff and successful completion resets it', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); let runs = 0;
  h.scheduler.scheduleRefresh('result', async () => { h.starts.push({ name: 'result', at: h.clock.elapsed }); runs++; if (runs === 2) throw new Error('fixture'); return runs <= 3 ? false : true; }, 1000);
  await h.clock.advanceBy(12_000); assert.deepEqual(h.starts.map(row => row.at), [1000, 3000, 7000, 11_000, 12_000]); assert.equal(h.messages.filter(row => row.level === 'error').length, 1);
});

test('loader duration adds to start gaps and condition/in-flight refusals invoke no loader', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); let enabled = false;
  h.scheduler.scheduleRefresh('slow', h.job('slow', { durationMs: 250 }), 1000, () => enabled);
  await h.clock.advanceBy(1000); assert.equal(h.starts.length, 0); enabled = true; h.ctx.inFlight.add('slow');
  await h.clock.advanceBy(1000); assert.equal(h.starts.length, 0); h.ctx.inFlight.delete('slow');
  await h.clock.advanceBy(3500); assert.deepEqual(h.starts.map(row => row.at), [3000, 4250, 5500]); assert.equal(h.maxActive, 1);
});

test('pending timers retain old policy and subsequent rearming samples strongest context plus Ghost', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); h.scheduler.scheduleRefresh('policy', h.job('policy'), 1000);
  await h.policy({ onBattery: true, silent: true, lowPower: true, ghost: true });
  assert.deepEqual(h.clock.pending().map(task => task.at), [1000]); await h.clock.advanceBy(1000);
  assert.deepEqual(h.clock.pending().map(task => task.at), [21_000]); await h.clock.advanceBy(20_000); assert.deepEqual(h.starts.map(row => row.at), [1000, 21_000]);
});

test('policy changes during a loader affect its completion-based next delay', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); h.scheduler.scheduleRefresh('running', h.job('running', { blocked: true }), 1000);
  await h.clock.advanceBy(1000); await h.policy({ onBattery: true }); await h.clock.advanceBy(500); h.release('running'); await h.clock.flushMicrotasks();
  assert.deepEqual(h.clock.pending().map(task => task.at), [3500]); assert.equal(h.ctx.inFlight.has('running'), false);
});

test('hidden callbacks pause even always-on jobs and use only the configured hidden multiplier', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); await h.policy({ alwaysOn: false }); h.hidden(true); h.scheduler.scheduleRefresh('hidden', h.job('hidden'), 1000);
  assert.deepEqual(h.clock.pending().map(task => task.at), [10_000]); await h.clock.advanceBy(10_000); assert.equal(h.starts.length, 0);
  await h.policy({ alwaysOn: true }); await h.clock.advanceBy(10_000); assert.equal(h.starts.length, 0); assert.deepEqual(h.clock.pending().map(task => task.at), [21_000]);
  await h.clock.advanceBy(1000); assert.equal(h.starts.length, 0);
});

test('recovery prioritizes base intervals, cancels stale timers and staggers six blocked admissions', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); h.hidden(true); await h.policy({ alwaysOn: false });
  h.scheduler.registerAll([8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000].map(intervalMs => ({ name: `${intervalMs}`, intervalMs, fn: h.job(`${intervalMs}`, { blocked: true }) })));
  await h.clock.advanceBy(10_000); const staleTimerIds = h.clock.pending().map(row => row.id); h.resume(); const origin = h.clock.elapsed;
  assert.ok(staleTimerIds.every(id => !h.clock.pending().some(task => task.id === id)));
  await h.clock.advanceBy(750); assert.deepEqual(h.starts.map(row => row.at - origin), [0, 150, 300, 450, 600, 750]); assert.deepEqual(h.starts.map(row => row.name), ['1000', '2000', '3000', '4000', '5000', '6000']); assert.equal(h.maxActive, 6);
  h.hidden(true); h.resume(); h.scheduler.flushStaleRefreshes(); await h.clock.advanceBy(0); assert.equal(h.starts.length, 6);
  h.release('1000', true); await h.clock.flushMicrotasks(); await h.clock.advanceBy(750); assert.equal(h.starts.at(-1).name, '7000'); assert.equal(h.maxActive, 6);
  h.release('2000'); await h.clock.flushMicrotasks(); await h.clock.advanceBy(750); assert.equal(h.starts.at(-1).name, '8000'); assert.equal(h.maxActive, 6);
});

test('resume freshness uses base intervals and destruction cancels queued work after caller teardown', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); h.hidden(true); await h.policy({ ghost: true, alwaysOn: false });
  h.scheduler.registerAll([{ name: 'stale', intervalMs: 1000, fn: h.job('stale', { blocked: true }) }, { name: 'fresh', intervalMs: 5000, fn: h.job('fresh') }]);
  await h.clock.advanceBy(2000); h.resume(); await h.clock.advanceBy(0); assert.deepEqual(h.starts.map(row => row.name), ['stale']);
  h.ctx.isDestroyed = true; h.scheduler.destroy(); h.release('stale'); await h.clock.flushMicrotasks(); assert.equal(h.clock.pending().length, 0); await h.clock.advanceBy(10_000); assert.equal(h.starts.length, 1);
});

test('steady-state traffic is not capped by the six recovery slots', async t => {
  const h = await fixture(t, { randomValues: [0.5] }); h.scheduler.registerAll(Array.from({ length: 8 }, (_, i) => ({ name: `same-${i}`, intervalMs: 1000, fn: h.job(`same-${i}`, { blocked: true }) })));
  await h.clock.advanceBy(1000); assert.equal(h.starts.length, 8); assert.equal(h.maxActive, 8);
});

test('measurement windows are half-open, replay deterministic and cleanup is included', async () => {
  assert.deepEqual(summarizeStarts([0, 149, 150, 999, 1000].map(at => ({ name: 'job', at }))).maxStartsInWindow, { '1': 1, '150': 2, '1000': 4 });
  const input = { seed: 867, horizonMs: 60_000, intervals: [1000, 3000], durationMs: 200, cohortSize: 2 };
  const first = await runSchedulingScenario(input), second = await runSchedulingScenario(input); assert.deepEqual(first, second); assert.deepEqual(first.cleanup, { pendingTimers: 0, active: 0 });
  const unobserved = await runSchedulingScenario({ horizonMs: 1000, intervals: [7_200_000], policy: { onBattery: true, ghost: true } });
  assert.deepEqual(unobserved.perJob['job-0-0'], { starts: 0, maximumStartGapMs: null, at: [] });
  assert.equal(summarizeStarts([{ name: 'single', at: 1 }]).perJob.single.maximumStartGapMs, null);
  await assert.rejects(runSchedulingScenario({ horizonMs: Infinity })); await assert.rejects(runSchedulingScenario({ cohortSize: 49 }));
});

test('measurement export and CLI report the same deterministic bounded scenarios', async () => {
  const expected = await measureRefreshScheduling({ seed: 7, horizonMs: 60_000 });
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/measure-refresh-scheduling.mts', '--seed', '7', '--horizon-ms', '60000'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(expected.windowConvention, 'half-open [start, start + width)'); assert.ok(expected.scenarios.every(row => row.cleanup.pendingTimers === 0));
  const invalid = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/measure-refresh-scheduling.mts', '--horizon-ms', 'Infinity'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30_000 }); assert.notEqual(invalid.status, 0);
});
