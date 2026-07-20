import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  getRecurringLoops,
  registerRecurringLoop,
  resetRecurringLoopsForTests,
} from '../recurring-loops';

// Poll a condition until it holds or the deadline passes. Used instead of a
// fixed sleep so real-timer tests stay deterministic under CPU/event-loop
// contention (e.g. when the whole test suite runs in parallel).
async function waitFor(cond: () => boolean, timeoutMs = 2000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, stepMs));
  }
}

beforeEach(() => {
  resetRecurringLoopsForTests();
});

// Make sure no stray timers keep node:test alive past suite end.
after(() => {
  resetRecurringLoopsForTests();
  setImmediate(() => process.exit(0));
});

describe('registerRecurringLoop', () => {
  it('registers a loop with the given name', () => {
    const handle = registerRecurringLoop('test-loop', () => {}, 60_000);
    const loops = getRecurringLoops();
    assert.equal(loops.length, 1);
    assert.equal(loops[0]?.name, 'test-loop');
    assert.equal(loops[0]?.intervalMs, 60_000);
    assert.equal(loops[0]?.paused, false);
    handle.cancel();
  });

  it('re-registering the same name cancels the previous loop', () => {
    let firstFnCalls = 0;
    let secondFnCalls = 0;
    const first = registerRecurringLoop('dup', () => firstFnCalls++, 60_000);
    const second = registerRecurringLoop('dup', () => secondFnCalls++, 60_000);
    // Should still be exactly one loop with this name.
    const loops = getRecurringLoops().filter((l) => l.name === 'dup');
    assert.equal(loops.length, 1);
    first.cancel(); // no-op since first was already cancelled
    second.cancel();
  });

  it('runImmediately fires the function synchronously on register', () => {
    let calls = 0;
    const handle = registerRecurringLoop('imm', () => calls++, 60_000, { runImmediately: true });
    assert.equal(calls, 1);
    handle.cancel();
  });

  it('catches errors thrown by the loop body so the timer survives', async () => {
    let calls = 0;
    const handle = registerRecurringLoop('throws', () => {
      calls++;
      throw new Error('boom');
    }, 10);
    // Poll until the loop has ticked twice despite throwing every time.
    // A condition-based wait (not a fixed sleep) keeps this deterministic
    // under event-loop contention: a real timer can't always deliver two
    // 10ms ticks inside a fixed 35ms window when the machine is loaded.
    // A timer that *died* on the first throw would never reach 2 and we'd
    // fail on the deadline — which is the regression we actually guard.
    await waitFor(() => calls >= 2);
    handle.cancel();
    assert.ok(calls >= 2, `expected >=2 calls, got ${calls}`);
  });

  it('cancel removes the loop from the registry', () => {
    const handle = registerRecurringLoop('to-cancel', () => {}, 60_000);
    assert.equal(getRecurringLoops().length, 1);
    handle.cancel();
    assert.equal(getRecurringLoops().length, 0);
  });

  it('records tickCount and lastTickAt as the loop runs', async () => {
    const handle = registerRecurringLoop('tick-counter', () => {}, 10);
    // Condition-based wait — see note on the throwing-loop test above.
    await waitFor(() => handle.inspect().tickCount >= 2);
    const reg = handle.inspect();
    handle.cancel();
    assert.ok(reg.tickCount >= 2, `expected >=2 ticks, got ${reg.tickCount}`);
    assert.ok(typeof reg.lastTickAt === 'number');
  });

  it('exposes priority and paused state', () => {
    const handle = registerRecurringLoop('prio', () => {}, 60_000, { priority: 'low' });
    const reg = handle.inspect();
    assert.equal(reg.priority, 'low');
    assert.equal(reg.paused, false); // document.visibilityState is 'visible' by default
    handle.cancel();
  });
});

describe('getRecurringLoops', () => {
  it('returns loops sorted by name', () => {
    const a = registerRecurringLoop('zebra', () => {}, 60_000);
    const b = registerRecurringLoop('alpha', () => {}, 60_000);
    const c = registerRecurringLoop('mike', () => {}, 60_000);
    const loops = getRecurringLoops();
    assert.deepEqual(loops.map((l) => l.name), ['alpha', 'mike', 'zebra']);
    a.cancel(); b.cancel(); c.cancel();
  });

  it('returns a copy — caller mutations do not affect the registry', () => {
    const handle = registerRecurringLoop('immutable', () => {}, 60_000);
    const snapshot = getRecurringLoops();
    (snapshot as { length: number }).length = 0;
    assert.equal(getRecurringLoops().length, 1);
    handle.cancel();
  });
});
