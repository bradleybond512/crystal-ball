import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFoundationTools } from '../tools/foundation.mjs';

function mockClient(overrides = {}) {
  return {
    get: async (route, params) => {
      const key = params ? `${route}?${JSON.stringify(params)}` : route;
      return overrides[key] || overrides[route] || { data: [], _mock: true };
    },
    getAll: async (routes) => {
      const map = new Map();
      for (const r of routes) map.set(r, overrides[r] || { data: [], _mock: true });
      return map;
    },
  };
}

describe('query_raw', () => {
  test('passes endpoint and params to sidecar client', async () => {
    const tools = makeFoundationTools(mockClient({
      '/api/acled-events': { events: [{ id: 1, country: 'Sudan' }] },
    }));
    const result = await tools.query_raw({ endpoint: '/api/acled-events' });
    assert.ok(result.data);
    assert.deepEqual(result.data, { events: [{ id: 1, country: 'Sudan' }] });
  });

  test('returns error when sidecar returns error', async () => {
    const tools = makeFoundationTools(mockClient({
      '/api/bad-route': { error: 'Not found' },
    }));
    const result = await tools.query_raw({ endpoint: '/api/bad-route' });
    assert.ok(result.warnings.length > 0);
  });
});

describe('chain_query', () => {
  test('executes steps sequentially and resolves $prev references', async () => {
    const calls = [];
    const client = {
      get: async (route, params) => {
        calls.push({ route, params });
        if (route === '/api/acled-events') return { events: [{ country: 'Sudan' }] };
        if (route === '/api/newsapi-headlines') return { articles: [{ title: 'Sudan news' }] };
        return {};
      },
    };
    const tools = makeFoundationTools(client);
    const result = await tools.chain_query({
      steps: [
        { endpoint: '/api/acled-events', params: {} },
        { endpoint: '/api/newsapi-headlines', params: { q: '$prev[0].events[0].country' } },
      ],
    });
    assert.equal(result.data.results.length, 2);
    assert.equal(result.data.resolved_params[1].q, 'Sudan');
  });
});

describe('compare_snapshots', () => {
  test('returns appeared, disappeared arrays', async () => {
    const client = {
      get: async (route, params) => {
        if (params?.date_from === '2026-04-01') return { events: [{ id: 1 }, { id: 2 }] };
        if (params?.date_from === '2026-04-07') return { events: [{ id: 2 }, { id: 3 }] };
        return {};
      },
    };
    const tools = makeFoundationTools(client);
    const result = await tools.compare_snapshots({
      endpoint: '/api/acled-events',
      before_params: { date_from: '2026-04-01' },
      after_params: { date_from: '2026-04-07' },
    });
    assert.ok(Array.isArray(result.data.appeared));
    assert.ok(Array.isArray(result.data.disappeared));
    assert.equal(result.data.appeared.length, 1); // id:3 appeared
    assert.equal(result.data.disappeared.length, 1); // id:1 disappeared
  });
});
