/**
 * Tests for financial mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - MarketCrashBridge.normalize() — drop tiers, edge cases
 *   - CreditDefaultBridge.normalize() — spread tiers, edge cases
 *   - CurrencyCrisisBridge.normalize() — devaluation tiers, edge cases
 *   - Null guard: missing or empty id returns null
 *   - Registry isolation via __resetMissionBridgeRegistry
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/financial-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MarketCrashBridge,
  CreditDefaultBridge,
  CurrencyCrisisBridge,
} from '../../../src/services/intelligence/mission-bridges/financial-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration ─────────────────────────────────────────────────────

test('importing financial-bridges registers MarketCrashBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('financial', 'market-crash'));
});

test('importing financial-bridges registers CreditDefaultBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('financial', 'credit-default'));
});

test('importing financial-bridges registers CurrencyCrisisBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('financial', 'currency-crisis'));
});

test('all financial bridges retrievable by domain', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('financial');
  assert.equal(bridges.length, 3);
});

// ── MarketCrashBridge — properties ────────────────────────────────────────

const crashBridge = new MarketCrashBridge();

test('MarketCrashBridge.domain is financial', () => {
  assert.equal(crashBridge.domain, 'financial');
});

test('MarketCrashBridge.feedId is market-crash', () => {
  assert.equal(crashBridge.feedId, 'market-crash');
});

// ── MarketCrashBridge — severity mapping ──────────────────────────────────

test('MarketCrashBridge: drop > 10% → severity 4', () => {
  const r = crashBridge.normalize({ id: 'mc1', dropPct: 11, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('MarketCrashBridge: drop exactly 10% → severity 3 (not > 10)', () => {
  const r = crashBridge.normalize({ id: 'mc2', dropPct: 10, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('MarketCrashBridge: drop > 5% and <= 10% → severity 3', () => {
  const r = crashBridge.normalize({ id: 'mc3', dropPct: 7.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('MarketCrashBridge: drop exactly 5% → severity 2 (not > 5)', () => {
  const r = crashBridge.normalize({ id: 'mc4', dropPct: 5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('MarketCrashBridge: drop > 2% and <= 5% → severity 2', () => {
  const r = crashBridge.normalize({ id: 'mc5', dropPct: 3, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('MarketCrashBridge: drop <= 2% → severity 1', () => {
  const r = crashBridge.normalize({ id: 'mc6', dropPct: 1.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('MarketCrashBridge: negative dropPct treated as absolute value', () => {
  const r = crashBridge.normalize({ id: 'mc7', dropPct: -12, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('MarketCrashBridge: uses index name in description fallback', () => {
  const r = crashBridge.normalize({ id: 'mc8', dropPct: 6, index: 'S&P 500', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('S&P 500'));
});

test('MarketCrashBridge: explicit description takes precedence', () => {
  const r = crashBridge.normalize({ id: 'mc9', dropPct: 8, description: 'Black Monday repeat', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Black Monday repeat');
});

test('MarketCrashBridge: missing id → null', () => {
  assert.equal(crashBridge.normalize({ dropPct: 15 }), null);
});

test('MarketCrashBridge: empty string id → null', () => {
  assert.equal(crashBridge.normalize({ id: '', dropPct: 15 }), null);
});

test('MarketCrashBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = crashBridge.normalize({ id: 'mc10', dropPct: 3 });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('MarketCrashBridge: raw payload preserved', () => {
  const raw = { id: 'mc11', dropPct: 5.5, index: 'NASDAQ', timestamp: 2000 };
  const r = crashBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── CreditDefaultBridge — properties ──────────────────────────────────────

const creditBridge = new CreditDefaultBridge();

test('CreditDefaultBridge.domain is financial', () => {
  assert.equal(creditBridge.domain, 'financial');
});

test('CreditDefaultBridge.feedId is credit-default', () => {
  assert.equal(creditBridge.feedId, 'credit-default');
});

// ── CreditDefaultBridge — severity mapping ────────────────────────────────

test('CreditDefaultBridge: spread > 500bps → severity 4', () => {
  const r = creditBridge.normalize({ id: 'cd1', spreadBps: 600, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CreditDefaultBridge: spread exactly 500bps → severity 3 (not > 500)', () => {
  const r = creditBridge.normalize({ id: 'cd2', spreadBps: 500, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CreditDefaultBridge: spread > 200bps and <= 500bps → severity 3', () => {
  const r = creditBridge.normalize({ id: 'cd3', spreadBps: 350, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CreditDefaultBridge: spread exactly 200bps → severity 2 (not > 200)', () => {
  const r = creditBridge.normalize({ id: 'cd4', spreadBps: 200, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('CreditDefaultBridge: spread > 100bps and <= 200bps → severity 2', () => {
  const r = creditBridge.normalize({ id: 'cd5', spreadBps: 150, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('CreditDefaultBridge: spread <= 100bps → severity 1', () => {
  const r = creditBridge.normalize({ id: 'cd6', spreadBps: 80, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('CreditDefaultBridge: uses entity name in description fallback', () => {
  const r = creditBridge.normalize({ id: 'cd7', spreadBps: 250, entity: 'Acme Corp', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Acme Corp'));
});

test('CreditDefaultBridge: explicit description takes precedence', () => {
  const r = creditBridge.normalize({ id: 'cd8', spreadBps: 600, description: 'Sovereign default imminent', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Sovereign default imminent');
});

test('CreditDefaultBridge: missing id → null', () => {
  assert.equal(creditBridge.normalize({ spreadBps: 300 }), null);
});

test('CreditDefaultBridge: empty string id → null', () => {
  assert.equal(creditBridge.normalize({ id: '', spreadBps: 300 }), null);
});

test('CreditDefaultBridge: raw payload preserved', () => {
  const raw = { id: 'cd9', spreadBps: 450, entity: 'Bank X', timestamp: 3000 };
  const r = creditBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── CurrencyCrisisBridge — properties ─────────────────────────────────────

const currencyBridge = new CurrencyCrisisBridge();

test('CurrencyCrisisBridge.domain is financial', () => {
  assert.equal(currencyBridge.domain, 'financial');
});

test('CurrencyCrisisBridge.feedId is currency-crisis', () => {
  assert.equal(currencyBridge.feedId, 'currency-crisis');
});

// ── CurrencyCrisisBridge — severity mapping ───────────────────────────────

test('CurrencyCrisisBridge: devaluation > 30% → severity 4', () => {
  const r = currencyBridge.normalize({ id: 'cc1', devaluationPct: 35, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CurrencyCrisisBridge: devaluation exactly 30% → severity 3 (not > 30)', () => {
  const r = currencyBridge.normalize({ id: 'cc2', devaluationPct: 30, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CurrencyCrisisBridge: devaluation > 15% and <= 30% → severity 3', () => {
  const r = currencyBridge.normalize({ id: 'cc3', devaluationPct: 20, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CurrencyCrisisBridge: devaluation exactly 15% → severity 2 (not > 15)', () => {
  const r = currencyBridge.normalize({ id: 'cc4', devaluationPct: 15, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('CurrencyCrisisBridge: devaluation > 5% and <= 15% → severity 2', () => {
  const r = currencyBridge.normalize({ id: 'cc5', devaluationPct: 10, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('CurrencyCrisisBridge: devaluation <= 5% → severity 1', () => {
  const r = currencyBridge.normalize({ id: 'cc6', devaluationPct: 3, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('CurrencyCrisisBridge: negative devaluationPct treated as absolute value', () => {
  const r = currencyBridge.normalize({ id: 'cc7', devaluationPct: -40, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CurrencyCrisisBridge: uses currency name in description fallback', () => {
  const r = currencyBridge.normalize({ id: 'cc8', devaluationPct: 20, currency: 'TRY', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('TRY'));
});

test('CurrencyCrisisBridge: explicit description takes precedence', () => {
  const r = currencyBridge.normalize({ id: 'cc9', devaluationPct: 35, description: 'Lira collapses overnight', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Lira collapses overnight');
});

test('CurrencyCrisisBridge: missing id → null', () => {
  assert.equal(currencyBridge.normalize({ devaluationPct: 20 }), null);
});

test('CurrencyCrisisBridge: empty string id → null', () => {
  assert.equal(currencyBridge.normalize({ id: '', devaluationPct: 20 }), null);
});

test('CurrencyCrisisBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = currencyBridge.normalize({ id: 'cc10', devaluationPct: 8 });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('CurrencyCrisisBridge: raw payload preserved', () => {
  const raw = { id: 'cc11', devaluationPct: 22, currency: 'ARS', timestamp: 4000 };
  const r = currencyBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── Registry isolation ────────────────────────────────────────────────────

test('resetting registry removes all financial bridges', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  assert.equal(reg.has('financial', 'market-crash'), false);
  assert.equal(reg.has('financial', 'credit-default'), false);
  assert.equal(reg.has('financial', 'currency-crisis'), false);
});
