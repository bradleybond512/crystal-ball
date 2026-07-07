/**
 * Tests for cognition/idle-scheduler.ts
 *
 * Pure module — no real timers/DOM needed. Every dependency is injected.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleIdleWork } from '../idle-scheduler.ts';
import type { IdleDeadlineLike } from '../idle-scheduler.ts';

test('scheduleIdleWork: uses requestIdleCallback when provided and visible', () => {
  let called = false;
  let capturedTimeout: number | undefined;
  const ric = (cb: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }): number => {
    capturedTimeout = options?.timeout;
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  };

  scheduleIdleWork(() => { called = true; }, {
    requestIdleCallbackFn: ric,
    isVisible: () => true,
  });

  assert.equal(called, true, 'task should run via requestIdleCallback');
  assert.equal(capturedTimeout, 10_000, 'default timeout should be 10s');
});

test('scheduleIdleWork: respects a custom timeoutMs', () => {
  let capturedTimeout: number | undefined;
  const ric = (cb: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }): number => {
    capturedTimeout = options?.timeout;
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  };

  scheduleIdleWork(() => {}, { requestIdleCallbackFn: ric, isVisible: () => true, timeoutMs: 2_000 });
  assert.equal(capturedTimeout, 2_000);
});

test('scheduleIdleWork: skips entirely when the page is hidden', () => {
  let ricCalled = false;
  let taskCalled = false;
  const ric = (cb: (deadline: IdleDeadlineLike) => void): number => {
    ricCalled = true;
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  };

  scheduleIdleWork(() => { taskCalled = true; }, {
    requestIdleCallbackFn: ric,
    isVisible: () => false,
  });

  assert.equal(ricCalled, false, 'requestIdleCallback should never be reached while hidden');
  assert.equal(taskCalled, false, 'task should not run while hidden');
});

test('scheduleIdleWork: falls back to setTimeout(0) when no requestIdleCallback is available', () => {
  let taskCalled = false;
  let capturedDelay: number | undefined;
  let unrefCalled = false;
  const fakeTimer = { unref: () => { unrefCalled = true; } };
  const setTimeoutFn = (cb: () => void, ms: number): unknown => {
    capturedDelay = ms;
    cb();
    return fakeTimer;
  };

  scheduleIdleWork(() => { taskCalled = true; }, {
    requestIdleCallbackFn: undefined,
    isVisible: () => true,
    setTimeoutFn,
  });

  assert.equal(taskCalled, true, 'task should still run via the fallback');
  assert.equal(capturedDelay, 0, 'fallback should use a 0ms delay');
  assert.equal(unrefCalled, true, 'fallback timer should be unref-ed when possible');
});

test('scheduleIdleWork: fallback tolerates a timer with no unref (browser setTimeout)', () => {
  let taskCalled = false;
  const setTimeoutFn = (cb: () => void): unknown => {
    cb();
    return 42; // browser setTimeout returns a number — no .unref
  };

  assert.doesNotThrow(() => {
    scheduleIdleWork(() => { taskCalled = true; }, {
      requestIdleCallbackFn: undefined,
      isVisible: () => true,
      setTimeoutFn,
    });
  });
  assert.equal(taskCalled, true);
});

test('scheduleIdleWork: default isVisible is true when no document is present (Node)', () => {
  let called = false;
  const ric = (cb: (deadline: IdleDeadlineLike) => void): number => {
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  };
  // No isVisible override — exercises the real default in a Node test runner
  // (no globalThis.document), which must resolve to "visible" rather than
  // silently swallowing all cognition work.
  scheduleIdleWork(() => { called = true; }, { requestIdleCallbackFn: ric });
  assert.equal(called, true);
});
