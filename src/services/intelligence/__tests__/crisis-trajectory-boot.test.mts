import assert from 'node:assert/strict';
import test from 'node:test';

const _handlers = new Map<string, ((e: Event) => void)[]>();
(globalThis as unknown as Record<string, unknown>).document = {
  addEventListener: (type: string, cb: (e: Event) => void) => {
    const list = _handlers.get(type) ?? [];
    list.push(cb);
    _handlers.set(type, list);
  },
  dispatchEvent: (e: { type: string; detail: unknown }) => {
    const handlers = _handlers.get(e.type) ?? [];
    for (const h of handlers) h(e as unknown as Event);
  },
};
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};
(globalThis as unknown as Record<string, unknown>).performance = { now: () => 0 };
(globalThis as unknown as Record<string, unknown>).window = {
  __TAURI_INTERNALS__: undefined,
  Notification: undefined,
};

import {
  startCrisisTrajectory,
  getLatestTrajectory,
} from '../crisis-trajectory.ts';

test('getLatestTrajectory returns null before start', () => {
  assert.strictEqual(getLatestTrajectory(), null);
});

test('startCrisisTrajectory does not throw', () => {
  assert.doesNotThrow(() => startCrisisTrajectory());
});

test('dispatching cb:analyst-hypotheses causes getLatestTrajectory to become non-null', () => {
  const fakeEvent = {
    type: 'cb:analyst-hypotheses',
    detail: {
      timestamp: Date.now(),
      aiEnriched: false,
      hypotheses: [{
        id: 'h1',
        kind: 'alert-burst',
        statement: 'test alert burst',
        confidence: 0.75,
        risk: 'high',
        evidence: [],
        timestamp: Date.now(),
      }],
    },
  };
  document.dispatchEvent(fakeEvent as unknown as CustomEvent);
  assert.ok(getLatestTrajectory() !== null, 'getLatestTrajectory returns a value after snapshot');
});
