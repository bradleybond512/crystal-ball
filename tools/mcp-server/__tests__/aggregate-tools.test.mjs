import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAggregateTools } from '../tools/aggregate.mjs';

function mockClient(overrides = {}) {
  return {
    checkHealth: async () => true,
    get: async (route) => {
      if (overrides[route]) return overrides[route];
      return { data: [], _mock: true };
    },
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) {
        map.set(r, overrides[r] || { data: [], _mock: true });
      }
      return map;
    },
  };
}

test('get_sitrep returns structured response with summary', async () => {
  const tools = makeAggregateTools(mockClient({
    '/api/market-quotes': { quotes: [{ symbol: 'SPY', price: 425 }] },
    '/api/acled-events': { events: [{ event_type: 'Battles', country: 'Ukraine' }] },
    '/api/nws-alerts': [],
    '/api/service-status': { status: 'ok' },
  }));
  const result = await tools.get_sitrep();
  assert.ok(result.summary, 'should have summary');
  assert.ok(result.timestamp, 'should have timestamp');
  assert.equal(result.healthy, true);
  assert.ok(Array.isArray(result.sources), 'should list sources');
});

test('get_sitrep handles partial failures gracefully', async () => {
  const tools = makeAggregateTools(mockClient({
    '/api/market-quotes': { error: 'timeout' },
    '/api/acled-events': { events: [{ event_type: 'Battles' }] },
    '/api/nws-alerts': [],
    '/api/service-status': { status: 'ok' },
  }));
  const result = await tools.get_sitrep();
  assert.ok(result.summary);
  assert.ok(result.warnings.length > 0, 'should have warnings for failed sources');
});

test('get_market_overview returns market data', async () => {
  const tools = makeAggregateTools(mockClient({
    '/api/market-quotes': { quotes: [{ symbol: 'SPY', price: 425 }] },
    '/api/crypto-quotes': { prices: [{ id: 'bitcoin', price: 65000 }] },
    '/api/btc-etf-flows': { flows: [] },
    '/api/macro-signals': { signals: {} },
    '/api/fear-greed': { value: 45, label: 'Fear' },
    '/api/wsb-sentiment': { trending: [] },
  }));
  const result = await tools.get_market_overview();
  assert.ok(result.summary);
  assert.ok(result.data.indices || result.data.quotes);
  assert.equal(result.healthy, true);
});

test('unhealthy client returns error in summary', async () => {
  const tools = makeAggregateTools({
    checkHealth: async () => false,
    get: async () => ({ error: 'not running', healthy: false }),
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) map.set(r, { error: 'not running', healthy: false });
      return map;
    },
  });
  const result = await tools.get_sitrep();
  assert.ok(result.warnings.length > 0);
});
