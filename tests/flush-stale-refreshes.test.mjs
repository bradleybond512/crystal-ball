/**
 * Unit tests for RefreshScheduler.flushStaleRefreshes().
 *
 * Runs via `tsx --test`, which lets us import the real TypeScript class
 * instead of trying to eval its body as plain JS (earlier tests parsed TS
 * annotations as plain JS and choked on `Missing initializer in const
 * declaration`).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RefreshScheduler } from '../src/app/refresh-scheduler.ts';

function createFakeTimers(startMs = 1_000_000) {
  const tasks = new Map();
  let now = startMs;
  let nextId = 1;

  const sortedTasks = (target) =>
    Array.from(tasks.entries())
      .filter(([, task]) => task.at <= target)
      .sort((a, b) => (a[1].at - b[1].at) || (a[0] - b[0]));

  return {
    get now() { return now; },
    setTimeout(fn, delay = 0) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { at: now + Math.max(0, delay), fn });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    advanceBy(ms) {
      const target = now + Math.max(0, ms);
      // Drain due tasks, then jump the clock forward. Tasks scheduled while
      // draining (e.g. drainFlushQueue's self-recursion) also run if they're
      // due by `target`.
      while (true) {
        const due = sortedTasks(target);
        if (!due.length) break;
        const [id, task] = due[0];
        tasks.delete(id);
        now = task.at;
        task.fn();
      }
      now = target;
    },
    runAll() {
      while (tasks.size > 0) {
        const [[id, task]] = Array.from(tasks.entries()).sort(
          (a, b) => (a[1].at - b[1].at) || (a[0] - b[0]),
        );
        tasks.delete(id);
        now = task.at;
        task.fn();
      }
    },
    has(id) { return tasks.has(id); },
  };
}

describe('RefreshScheduler.flushStaleRefreshes', () => {
  let scheduler;
  let timers;
  let originalSetTimeout;
  let originalClearTimeout;
  let originalDateNow;

  beforeEach(() => {
    timers = createFakeTimers();
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    originalDateNow = Date.now;
    globalThis.setTimeout = timers.setTimeout.bind(timers);
    globalThis.clearTimeout = timers.clearTimeout.bind(timers);
    Date.now = () => timers.now;
    scheduler = new RefreshScheduler({ isDestroyed: false, inFlight: new Set() });
  });

  afterEach(() => {
    timers.runAll();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  });

  function seed(name, intervalMs, run) {
    scheduler['refreshRunners'].set(name, {
      run: run ?? (async () => {}),
      intervalMs,
    });
    scheduler['refreshTimeoutIds'].set(name, timers.setTimeout(() => {}, 999_999));
  }

  it('re-triggers services hidden longer than their interval', () => {
    const flushed = [];
    seed('fast-service', 60_000, async () => { flushed.push('fast-service'); });
    seed('medium-service', 300_000, async () => { flushed.push('medium-service'); });
    seed('slow-service', 1_800_000, async () => { flushed.push('slow-service'); });

    scheduler.setHiddenSince(timers.now - 600_000); // 10 min hidden
    scheduler.flushStaleRefreshes();
    timers.runAll();

    assert.ok(flushed.includes('fast-service'), 'fast-service (1m interval) should flush after 10m hidden');
    assert.ok(flushed.includes('medium-service'), 'medium-service (5m interval) should flush after 10m hidden');
    assert.ok(!flushed.includes('slow-service'), 'slow-service (30m interval) should NOT flush after 10m hidden');
    assert.equal(scheduler.getHiddenSince(), 0, 'hiddenSince must be reset to 0');
  });

  it('does nothing when hiddenSince is 0', () => {
    let called = false;
    seed('service', 60_000, async () => { called = true; });

    scheduler.setHiddenSince(0);
    scheduler.flushStaleRefreshes();
    timers.runAll();
    assert.equal(called, false, 'No services should flush when hiddenSince is 0');
  });

  it('skips services hidden for less than their interval', () => {
    let called = false;
    seed('service', 300_000, async () => { called = true; });
    const originalId = scheduler['refreshTimeoutIds'].get('service');

    scheduler.setHiddenSince(timers.now - 30_000); // 30s hidden, 5m interval
    scheduler.flushStaleRefreshes();
    timers.runAll();

    assert.equal(called, false, '30s hidden < 5m interval — should NOT flush');
    assert.equal(scheduler.getHiddenSince(), 0, 'hiddenSince must still be reset even if no services flushed');
    assert.equal(scheduler['refreshTimeoutIds'].get('service'), originalId,
      'Non-stale service timeout should be untouched');
  });

  it('staggers re-triggered services by FLUSH_STAGGER_MS', () => {
    const timestamps = [];
    const start = timers.now;
    const stagger = RefreshScheduler.FLUSH_STAGGER_MS;

    for (const name of ['svc-a', 'svc-b', 'svc-c']) {
      seed(name, 60_000, async () => { timestamps.push(timers.now - start); });
    }

    scheduler.setHiddenSince(timers.now - 600_000);
    scheduler.flushStaleRefreshes();
    timers.runAll();

    assert.equal(timestamps.length, 3, 'All 3 services should fire');
    assert.deepEqual(timestamps, [0, stagger, stagger * 2],
      `Services should fire in ${stagger}ms steps starting at 0`);
  });

  it('replaces timeout IDs in refreshTimeoutIds after flush', () => {
    seed('svc', 60_000);
    const originalId = scheduler['refreshTimeoutIds'].get('svc');

    scheduler.setHiddenSince(timers.now - 600_000);
    scheduler.flushStaleRefreshes();

    const newId = scheduler['refreshTimeoutIds'].get('svc');
    assert.ok(newId !== undefined, 'refreshTimeoutIds should still have an entry for the service');
    assert.notEqual(newId, originalId, 'Timeout ID should be replaced with a new one');
    assert.equal(timers.has(originalId), false, 'Original timeout should be cleared');
  });

  it('does not touch timeout IDs for non-stale services', () => {
    seed('fresh', 1_800_000);
    const originalId = scheduler['refreshTimeoutIds'].get('fresh');

    scheduler.setHiddenSince(timers.now - 60_000); // 1min hidden, 30min interval
    scheduler.flushStaleRefreshes();

    assert.equal(scheduler['refreshTimeoutIds'].get('fresh'), originalId,
      'Non-stale service timeout should be untouched');
  });

  it('tolerates runners that return non-Promise values', () => {
    let called = false;
    scheduler['refreshRunners'].set('sync-service', {
      // Intentionally not-a-Promise — exercises the Promise.resolve() guard.
      run: () => { called = true; },
      intervalMs: 60_000,
    });
    scheduler['refreshTimeoutIds'].set('sync-service', timers.setTimeout(() => {}, 999_999));

    scheduler.setHiddenSince(timers.now - 600_000);
    scheduler.flushStaleRefreshes();
    timers.runAll();

    assert.equal(called, true, 'Synchronous runner should still be invoked');
  });

  it('preserves the active queue and concurrency bound across repeated resumes', async () => {
    const started = [];
    const releases = [];
    let active = 0;
    let maxActive = 0;

    for (let index = 0; index < 8; index += 1) {
      const name = `svc-${index}`;
      seed(name, 60_000, () => new Promise((resolve) => {
        started.push(name);
        active += 1;
        maxActive = Math.max(maxActive, active);
        releases.push(() => {
          active -= 1;
          resolve();
        });
      }));
    }

    scheduler.setHiddenSince(timers.now - 600_000);
    scheduler.flushStaleRefreshes();
    timers.advanceBy(RefreshScheduler.FLUSH_STAGGER_MS * 5);
    assert.equal(active, RefreshScheduler.MAX_CONCURRENT_FLUSHES);

    scheduler.setHiddenSince(timers.now - 60_000);
    scheduler.flushStaleRefreshes();
    timers.advanceBy(RefreshScheduler.FLUSH_STAGGER_MS * 5);

    assert.equal(maxActive, RefreshScheduler.MAX_CONCURRENT_FLUSHES,
      'a second resume must not reset the active concurrency count');
    assert.equal(new Set(started).size, started.length,
      'services already active or queued must not be scheduled twice');

    while (releases.length > 0) {
      releases.shift()();
    }
    await Promise.resolve();
    timers.runAll();
    await Promise.resolve();

    assert.equal(new Set(started).size, 8, 'the original queue must survive the second resume');
    assert.equal(started.length, 8, 'each due service should run once per catch-up cycle');
  });

  it('evaluates due services from each resume period without replacing queued work', async () => {
    let releaseFast;
    const started = [];
    seed('fast', 60_000, () => new Promise((resolve) => {
      started.push('fast');
      releaseFast = resolve;
    }));
    seed('slow', 300_000, async () => { started.push('slow'); });

    scheduler.setHiddenSince(timers.now - 60_000);
    scheduler.flushStaleRefreshes();
    timers.advanceBy(0);
    assert.deepEqual(started, ['fast']);

    scheduler.setHiddenSince(timers.now - 300_000);
    scheduler.flushStaleRefreshes();
    timers.runAll();
    assert.deepEqual(started, ['fast', 'slow'],
      'the second resume should add newly-due work without duplicating active work');

    releaseFast();
    await Promise.resolve();
  });
});
