/**
 * Tests for the pure helpers behind ShortageRadarPanel: the unwired-state
 * detector, the notification ladder gate, and the localStorage-backed
 * prev-risk-level persistence. The panel class itself depends on the DOM
 * so we don't exercise it directly here.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUnwired,
  shouldFireCritical,
  loadPrevRiskLevels,
  savePrevRiskLevels,
  PREV_LEVELS_LS_KEY,
} from '../shortage-radar-helpers.ts';
import type {
  ShortageSummaryEntry,
  FullSetCommodity,
  RiskLevel,
} from '@/services/shortage/shortage-fullset';

function entry(overrides: Partial<ShortageSummaryEntry>): ShortageSummaryEntry {
  const forecast = {
    commodity: 'wheat',
    domain: 'food' as const,
    region: 'global',
    horizonDays: 60,
    riskScore: 0,
    confidence: 'low' as const,
    drivers: [],
    confirmingIndicators: [],
    invalidatingIndicators: [],
    dataGaps: [],
    lastUpdated: '2026-05-12T00:00:00Z',
    ...(overrides.forecast ?? {}),
  };
  return {
    commodity: 'wheat',
    riskScore: 0,
    riskLevel: 'LOW',
    primaryDrivers: [],
    timeToImpact: '≤60 days',
    trend: 'stable',
    ...overrides,
    forecast,
  } as ShortageSummaryEntry;
}

// ── isUnwired ─────────────────────────────────────────────────────────────

test('isUnwired: score 0 + zero drivers + 3+ gaps → true', () => {
  const e = entry({
    riskScore: 0,
    primaryDrivers: [],
    forecast: {
      commodity: 'wheat', domain: 'food', region: 'global', horizonDays: 60,
      riskScore: 0, confidence: 'low', drivers: [],
      confirmingIndicators: [], invalidatingIndicators: [],
      dataGaps: ['rainfall', 'soil', 'price'], lastUpdated: '',
    },
  });
  assert.equal(isUnwired(e), true);
});

test('isUnwired: nonzero riskScore → false even with many gaps', () => {
  const e = entry({
    riskScore: 10,
    primaryDrivers: [],
    forecast: {
      commodity: 'wheat', domain: 'food', region: 'global', horizonDays: 60,
      riskScore: 10, confidence: 'low', drivers: [],
      confirmingIndicators: [], invalidatingIndicators: [],
      dataGaps: ['a', 'b', 'c', 'd'], lastUpdated: '',
    },
  });
  assert.equal(isUnwired(e), false);
});

test('isUnwired: drivers present → false', () => {
  const e = entry({
    riskScore: 0,
    primaryDrivers: ['some driver'],
    forecast: {
      commodity: 'wheat', domain: 'food', region: 'global', horizonDays: 60,
      riskScore: 0, confidence: 'low', drivers: [],
      confirmingIndicators: [], invalidatingIndicators: [],
      dataGaps: ['a', 'b', 'c'], lastUpdated: '',
    },
  });
  assert.equal(isUnwired(e), false);
});

test('isUnwired: 0 score + 0 drivers + only 2 gaps → false (model ran partial)', () => {
  const e = entry({
    riskScore: 0,
    primaryDrivers: [],
    forecast: {
      commodity: 'wheat', domain: 'food', region: 'global', horizonDays: 60,
      riskScore: 0, confidence: 'low', drivers: [],
      confirmingIndicators: [], invalidatingIndicators: [],
      dataGaps: ['a', 'b'], lastUpdated: '',
    },
  });
  assert.equal(isUnwired(e), false);
});

// ── shouldFireCritical ────────────────────────────────────────────────────

test('shouldFireCritical: HIGH → CRITICAL fires', () => {
  assert.equal(shouldFireCritical('HIGH', 'CRITICAL'), true);
});

test('shouldFireCritical: CRITICAL → CRITICAL does NOT fire (already critical)', () => {
  assert.equal(shouldFireCritical('CRITICAL', 'CRITICAL'), false);
});

test('shouldFireCritical: undefined prev (fresh install) + CRITICAL fires', () => {
  assert.equal(shouldFireCritical(undefined, 'CRITICAL'), true);
});

test('shouldFireCritical: stays silent below CRITICAL', () => {
  assert.equal(shouldFireCritical('LOW', 'HIGH'), false);
  assert.equal(shouldFireCritical('LOW', 'MODERATE'), false);
  assert.equal(shouldFireCritical('LOW', 'LOW'), false);
});

// ── load/savePrevRiskLevels (in-memory Storage stub) ──────────────────────

function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: () => null,
    get length() { return map.size; },
  } as Storage;
}

test('loadPrevRiskLevels: empty storage returns empty map', () => {
  const m = loadPrevRiskLevels(makeStorageStub());
  assert.equal(m.size, 0);
});

test('save → load round-trips a map of three commodities', () => {
  const s = makeStorageStub();
  const original = new Map<FullSetCommodity, RiskLevel>([
    ['wheat', 'CRITICAL'],
    ['diesel', 'HIGH'],
    ['rice', 'LOW'],
  ]);
  savePrevRiskLevels(s, original);
  const loaded = loadPrevRiskLevels(s);
  assert.equal(loaded.size, 3);
  assert.equal(loaded.get('wheat'), 'CRITICAL');
  assert.equal(loaded.get('diesel'), 'HIGH');
  assert.equal(loaded.get('rice'), 'LOW');
});

test('loadPrevRiskLevels: ignores unknown commodity keys (forward compat)', () => {
  const s = makeStorageStub();
  s.setItem(PREV_LEVELS_LS_KEY, JSON.stringify({ wheat: 'HIGH', invented_commodity: 'CRITICAL' }));
  const m = loadPrevRiskLevels(s);
  assert.equal(m.size, 1);
  assert.equal(m.get('wheat'), 'HIGH');
});

test('loadPrevRiskLevels: ignores garbage level strings', () => {
  const s = makeStorageStub();
  s.setItem(PREV_LEVELS_LS_KEY, JSON.stringify({ wheat: 'NONSENSE', corn: 'HIGH' }));
  const m = loadPrevRiskLevels(s);
  assert.equal(m.size, 1);
  assert.equal(m.get('corn'), 'HIGH');
});

test('loadPrevRiskLevels: corrupt JSON returns empty map without throwing', () => {
  const s = makeStorageStub();
  s.setItem(PREV_LEVELS_LS_KEY, '{ not valid json');
  const m = loadPrevRiskLevels(s);
  assert.equal(m.size, 0);
});

test('loadPrevRiskLevels: missing storage returns empty map', () => {
  const m = loadPrevRiskLevels(undefined);
  assert.equal(m.size, 0);
});

test('savePrevRiskLevels: missing storage is a no-op (does not throw)', () => {
  const map = new Map<FullSetCommodity, RiskLevel>([['wheat', 'HIGH']]);
  assert.doesNotThrow(() => savePrevRiskLevels(undefined, map));
});
