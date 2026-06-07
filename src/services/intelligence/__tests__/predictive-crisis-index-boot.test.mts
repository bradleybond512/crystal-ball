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
  startPredictiveCrisisIndex,
  getLatestPCI,
} from '../predictive-crisis-index.ts';

test('getLatestPCI returns null before any snapshot', () => {
  assert.strictEqual(getLatestPCI(), null);
});

test('startPredictiveCrisisIndex is a function and does not throw', () => {
  assert.strictEqual(typeof startPredictiveCrisisIndex, 'function');
  assert.doesNotThrow(() => startPredictiveCrisisIndex());
});

test('emits cb:pci-updated when cb:analyst-hypotheses fires', () => {
  const before = _events.length;
  const fakeEvent = {
    type: 'cb:analyst-hypotheses',
    detail: {
      timestamp: Date.now(),
      aiEnriched: false,
      hypotheses: [{
        id: 'h1', kind: 'alert-burst', statement: 'test alert burst',
        confidence: 0.75, risk: 'high', evidence: [], timestamp: Date.now(),
      }],
    },
  };
  document.dispatchEvent(fakeEvent as unknown as CustomEvent);
  const pciEvents = _events.slice(before).filter(e => e.type === 'cb:pci-updated');
  assert.ok(pciEvents.length > 0, 'cb:pci-updated was dispatched');
  assert.ok(getLatestPCI() !== null, 'getLatestPCI returns a value after snapshot');
});
