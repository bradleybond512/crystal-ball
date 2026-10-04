/** Hardening follow-up: the persisted forecast blob is validated, never cast. */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, String(value)); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
};

import { parsePersistedPrediction, parsePersistedPredictions } from '../forecast-calibration-load.ts';
import { _resetCalibrationForTests, getCalibrationStore } from '../forecast-calibration-adapter.ts';

const KEY = 'crystalball-forecast-calibration-v1';
const T0 = 1_790_000_000_000;

function good(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fc-1', sourceId: 'analyst-loop', domain: 'markets', claim: 'c', probability: 0.6,
    predictedAt: T0, resolveBy: T0 + 1000, status: 'pending', ...overrides,
  };
}

beforeEach(() => {
  memory.clear();
  _resetCalibrationForTests();
});

test('invalid entries are dropped instead of reaching the store', () => {
  memory.set(KEY, JSON.stringify([
    good(),
    good({ id: 'fc-p', probability: 1.5 }),
    good({ id: 'fc-n', probability: 'high' }),
    good({ id: 'fc-s', status: 'resolved_maybe' }),
    good({ id: 'fc-t', predictedAt: 'yesterday' }),
    good({ id: '' }),
    { id: 'fc-x' },
    'not a record',
    null,
  ]));
  assert.deepEqual(getCalibrationStore().all().map((r) => r.id), ['fc-1']);
});

test('only known fields survive, and nested shapes are checked', () => {
  const parsed = parsePersistedPrediction(good({
    __proto__polluted: true,
    extra: 'dropped',
    criteria: { kind: 'market_move', symbol: 'SPY' },
    resolutionProvenance: { resolverId: 'r', kind: 'proxy', evidence: [{ sourceIds: ['a'] }, 'junk'] },
    algorithmVersion: 'v1',
  }));
  assert.ok(parsed);
  assert.equal((parsed as Record<string, unknown>).extra, undefined);
  assert.equal(parsed.criteria?.kind, 'market_move');
  assert.equal(parsed.resolutionProvenance?.evidence.length, 1);
  const badNested = parsePersistedPrediction(good({ criteria: { kind: 'rm -rf' }, resolutionProvenance: { resolverId: 'r', kind: 'guess' } }));
  assert.equal(badNested?.criteria, undefined);
  assert.equal(badNested?.resolutionProvenance, undefined);
});

test('a corrupt or non-array blob loads as empty, and the cap keeps the newest', () => {
  memory.set(KEY, '{not json');
  assert.equal(getCalibrationStore().all().length, 0);
  _resetCalibrationForTests();
  memory.set(KEY, JSON.stringify({ records: [good()] }));
  assert.equal(getCalibrationStore().all().length, 0);
  const many = Array.from({ length: 5 }, (_, i) => good({ id: `fc-${i}`, predictedAt: T0 + i }));
  assert.deepEqual(parsePersistedPredictions(many, 3).map((r) => r.id), ['fc-2', 'fc-3', 'fc-4']);
});
