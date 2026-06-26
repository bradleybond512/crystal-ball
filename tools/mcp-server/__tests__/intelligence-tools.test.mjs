import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeIntelligenceTools } from '../tools/intelligence.mjs';
import { createStorage } from '../storage.mjs';

function mockClient(overrides = {}) {
  return {
    get: async (route) => overrides[route] || { data: [], _mock: true },
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) map.set(r, overrides[r] || { data: [], _mock: true });
      return map;
    },
  };
}

describe('correlate tool', () => {
  test('returns correlations between two domains', async () => {
    const client = mockClient({
      '/api/acled-events': { events: [{ country: 'Ukraine', event_type: 'Battles' }] },
      '/api/threatfox-iocs': { iocs: [{ ioc: '1.2.3.4', ioc_type: 'ip:port' }] },
      '/api/cisa-kev': { kevs: [] },
    });
    const tmp = mkdtempSync(join(tmpdir(), 'cb-intel-'));
    const tools = makeIntelligenceTools(client, createStorage(tmp));
    const result = await tools.correlate({ domains: ['conflicts', 'cyber'] });
    assert.ok(result.data.correlations);
    assert.ok(Array.isArray(result.data.correlations));
    rmSync(tmp, { recursive: true });
  });
});

describe('trend tool', () => {
  let tmp;
  let storage;

  // trend() filters snapshots to a window relative to Date.now() ('7d' here), so
  // the fixtures must be dated relative to *now* — hardcoded calendar dates age
  // out of the window and silently fail later (this test was a time bomb).
  // parseFilenameDate parses YYYY-MM-DD-HHMM.json as UTC, so build from UTC parts.
  function histFile(daysAgo) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    return `sentinel/history/${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.json`;
  }

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-trend-'));
    storage = createStorage(tmp);
    // Oldest → newest, rising SPY price (420 → 425 → 430). All within the 7d window.
    storage.writeJSON(histFile(3), {
      markets: { quotes: [{ symbol: 'SPY', price: 420 }] },
      conflicts: { events: [{ country: 'Sudan' }, { country: 'Sudan' }] },
    });
    storage.writeJSON(histFile(2), {
      markets: { quotes: [{ symbol: 'SPY', price: 425 }] },
      conflicts: { events: [{ country: 'Sudan' }] },
    });
    storage.writeJSON(histFile(1), {
      markets: { quotes: [{ symbol: 'SPY', price: 430 }] },
      conflicts: { events: [{ country: 'Sudan' }, { country: 'Sudan' }, { country: 'Sudan' }] },
    });
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('computes trend from historical snapshots', async () => {
    const tools = makeIntelligenceTools(mockClient(), storage);
    const result = await tools.trend({ source: 'markets', metric: 'spy_price', window: '7d' });
    assert.ok(result.data.datapoints);
    assert.ok(result.data.direction);
    assert.equal(result.data.direction, 'rising');
    assert.ok(result.data.datapoints.length >= 2);
  });

  test('returns unknown direction with insufficient data', async () => {
    const emptyTmp = mkdtempSync(join(tmpdir(), 'cb-empty-'));
    const emptyStorage = createStorage(emptyTmp);
    const tools = makeIntelligenceTools(mockClient(), emptyStorage);
    const result = await tools.trend({ source: 'markets', metric: 'spy_price', window: '7d' });
    assert.equal(result.data.direction, 'unknown');
    rmSync(emptyTmp, { recursive: true });
  });
});

describe('anomaly_scan tool', () => {
  let tmp;
  let storage;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-anomaly-'));
    storage = createStorage(tmp);
    for (let i = 0; i < 5; i++) {
      storage.writeJSON(`sentinel/history/2026-04-${String(i + 5).padStart(2, '0')}-0800.json`, {
        markets: { quotes: [{ symbol: 'SPY', price: 420 + i }] },
      });
    }
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('returns anomalies array', async () => {
    const tools = makeIntelligenceTools(mockClient({
      '/api/market-quotes': { quotes: [{ symbol: 'SPY', price: 500 }] },
      '/api/crypto-quotes': {},
    }), storage);
    const result = await tools.anomaly_scan({});
    assert.ok(Array.isArray(result.data.anomalies));
  });

  test('returns empty with insufficient history', async () => {
    const emptyTmp = mkdtempSync(join(tmpdir(), 'cb-scanempty-'));
    const emptyStorage = createStorage(emptyTmp);
    const tools = makeIntelligenceTools(mockClient(), emptyStorage);
    const result = await tools.anomaly_scan({});
    assert.equal(result.data.anomalies.length, 0);
    rmSync(emptyTmp, { recursive: true });
  });
});
