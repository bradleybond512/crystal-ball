import assert from 'node:assert/strict';
import test from 'node:test';

const _events: Array<{ type: string; detail: unknown }> = [];
const _handlers = new Map<string, ((e: Event) => void)[]>();
(globalThis as unknown as Record<string, unknown>).document = {
  addEventListener: (type: string, cb: (e: Event) => void) => {
    const list = _handlers.get(type) ?? [];
    list.push(cb);
    _handlers.set(type, list);
  },
  dispatchEvent: (e: { type: string; detail: unknown }) => {
    _events.push(e);
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
  startActiveLearningQueue,
  getActiveLearningQueueService,
  resetServiceForTests,
} from '../active-learning-queue.ts';

test('startActiveLearningQueue does not throw', () => {
  assert.doesNotThrow(() => startActiveLearningQueue());
});

test('low-confidence hypotheses are enqueued on cb:analyst-hypotheses', () => {
  resetServiceForTests();
  const svc = getActiveLearningQueueService();
  const before = svc.getStats().total;
  const fakeEvent = {
    type: 'cb:analyst-hypotheses',
    detail: {
      timestamp: Date.now(),
      aiEnriched: false,
      hypotheses: [
        {
          id: 'h-low-1', kind: 'alert-burst', statement: 'uncertain event A',
          confidence: 0.4, risk: 'medium', evidence: [], timestamp: Date.now(),
        },
        {
          id: 'h-low-2', kind: 'anomaly-convergence', statement: 'uncertain event B',
          confidence: 0.2, risk: 'high', evidence: [], timestamp: Date.now(),
        },
      ],
    },
  };
  document.dispatchEvent(fakeEvent as unknown as CustomEvent);
  const after = svc.getStats().total;
  assert.ok(after > before, `queue grew from ${before} to ${after}`);
});

test('high-confidence hypotheses are not enqueued', () => {
  resetServiceForTests();
  const svc = getActiveLearningQueueService();
  const before = svc.getStats().total;
  const fakeEvent = {
    type: 'cb:analyst-hypotheses',
    detail: {
      timestamp: Date.now(),
      aiEnriched: false,
      hypotheses: [
        {
          id: 'h-high-1', kind: 'situation-escalation', statement: 'confident event',
          confidence: 0.85, risk: 'high', evidence: [], timestamp: Date.now(),
        },
        {
          id: 'h-high-2', kind: 'watchlist-convergence', statement: 'very confident event',
          confidence: 0.95, risk: 'critical', evidence: [], timestamp: Date.now(),
        },
      ],
    },
  };
  document.dispatchEvent(fakeEvent as unknown as CustomEvent);
  const after = svc.getStats().total;
  assert.strictEqual(after, before, 'no items should be enqueued for high-confidence hypotheses');
});
