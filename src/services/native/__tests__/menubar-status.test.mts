import assert from 'node:assert/strict';
import test from 'node:test';

// Stub the browser environment because `unified-alerts.ts` instantiates
// its singleton store at module load (touches localStorage + window).
const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;
(globalThis as unknown as { window: unknown }).window = globalThis;
class StubCE<T = unknown> {
  detail: T | undefined;
  type: string;
  constructor(type: string, init?: { detail?: T }) { this.type = type; this.detail = init?.detail; }
}
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = StubCE;
(globalThis as unknown as { document: { dispatchEvent: () => boolean } }).document = {
  dispatchEvent: () => true,
};

const { computeThreatLevel } = await import('../menubar-status.ts');
const { computeDockBadgeCount } = await import('../dock-badge.ts');

function alert(overrides: Partial<{ severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; acknowledged: boolean }>) {
  return {
    id: 'x',
    source: 'situation',
    severity: overrides.severity ?? 'medium',
    title: '',
    body: '',
    timestamp: 0,
    relevanceScore: 0,
    acknowledged: overrides.acknowledged ?? false,
    pinned: false,
  } as Parameters<typeof computeThreatLevel>[0][number];
}

test('threat level is red when any unacked critical alert exists', () => {
  const level = computeThreatLevel([
    alert({ severity: 'critical' }),
    alert({ severity: 'low' }),
  ]);
  assert.equal(level, 'red');
});

test('threat level is yellow when only high (no critical) is unacked', () => {
  const level = computeThreatLevel([
    alert({ severity: 'high' }),
    alert({ severity: 'medium' }),
  ]);
  assert.equal(level, 'yellow');
});

test('threat level is green when everything is acked or low/medium', () => {
  const level = computeThreatLevel([
    alert({ severity: 'critical', acknowledged: true }),
    alert({ severity: 'medium' }),
    alert({ severity: 'info' }),
  ]);
  assert.equal(level, 'green');
});

test('threat level is green on empty input', () => {
  assert.equal(computeThreatLevel([]), 'green');
});

test('computeDockBadgeCount floors and clamps to non-negative', () => {
  assert.equal(computeDockBadgeCount(0), 0);
  assert.equal(computeDockBadgeCount(5), 5);
  assert.equal(computeDockBadgeCount(3.9), 3);
  assert.equal(computeDockBadgeCount(-2), 0);
});
