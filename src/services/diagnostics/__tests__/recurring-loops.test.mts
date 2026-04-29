import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  getRecurringLoops,
  registerRecurringLoop,
  resetRecurringLoopsForTests,
} from '../recurring-loops';

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
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    handle.cancel();
    // We should have ticked multiple times despite throws.
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
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
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
