import assert from 'node:assert/strict';
import test from 'node:test';

import './register-hook.mjs';
import { happyWindow } from './setup-dom.mts';

test('GDELT panel retries every 15 minutes and cancels the retry when destroyed', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const cleared = new Set<number>();
  let nextTimer = 1;
  let fetchCalls = 0;

  globalThis.setInterval = ((callback: () => void, delay?: number) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay: delay ?? 0 });
    return id;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: number) => {
    cleared.add(id);
    timers.delete(id);
  }) as typeof clearInterval;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new happyWindow.Response(JSON.stringify({ error: 'upstream unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response;
  }) as typeof fetch;

  let panel: { destroy(): void } | null = null;
  try {
    const { GdeltIntelPanel } = await import('../../src/components/GdeltIntelPanel.ts');
    panel = new GdeltIntelPanel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCalls, 1);

    const retryTimer = [...timers.entries()].find(([, timer]) => timer.delay === 15 * 60_000);
    assert.ok(retryTimer, 'the promised 15-minute retry must be scheduled');
    retryTimer[1].callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCalls, 2);

    const retryId = retryTimer[0];
    panel.destroy();
    panel = null;
    assert.ok(cleared.has(retryId), 'destroy must cancel the panel-owned retry');
  } finally {
    panel?.destroy();
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    happyWindow.close();
  }
});

test('GDELT retries do not overlap and destruction aborts the active request', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let intervalCallback: (() => void) | null = null;
  let fetchCalls = 0;
  let requestSignal: AbortSignal | undefined;

  globalThis.setInterval = ((callback: () => void) => {
    intervalCallback = callback;
    return 71;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls += 1;
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  try {
    const { GdeltIntelPanel } = await import('../../src/components/GdeltIntelPanel.ts');
    const panel = new GdeltIntelPanel();
    assert.equal(fetchCalls, 1);
    assert.ok(intervalCallback);
    intervalCallback();
    assert.equal(fetchCalls, 1, 'the interval must join an in-flight request instead of overlapping it');
    panel.destroy();
    assert.equal(requestSignal?.aborted, true, 'destroy must abort the panel-owned request');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    happyWindow.close();
  }
});
