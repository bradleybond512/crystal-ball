import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import newsapi from '../api/newsapi-headlines.js';
import newsdata from '../api/newsdata-feed.js';

const sidecar = readFileSync(new URL('../src-tauri/sidecar/local-api-server.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function localRoute(path, cache = new Map(), context = {}) {
  const start = sidecar.indexOf(path === '/api/news/headlines' ? '  // ── News headlines aggregator' : '  // ── NewsAPI.org headlines');
  const end = sidecar.indexOf(path === '/api/news/headlines' ? '  // ── GDELT Intelligence' : '  // ── USGS Volcano', start);
  const helpers = sidecar.slice(sidecar.indexOf('  // ── News provenance helpers'), sidecar.indexOf('  // ── NewsAPI.org headlines'));
  const run = new AsyncFunction('requestUrl', 'fetchWithTimeout', 'getCached', 'getCachedStale', 'setCached', 'context', 'json', 'CHROME_UA', helpers + sidecar.slice(start, end));
  return (url) => run(new URL(url), globalThis.fetch, (key) => cache.get(key)?.fresh ? cache.get(key).data : null, (key) => cache.get(key)?.data, (key, data) => cache.set(key, { data, fresh: true }), context, (body, status = 200, headers = {}) => Response.json(body, { status, headers }), 'test');
}
const fixtures = {
  newsapi: { articles: [{ title: 'Headline', url: 'https://example.com/a' }] },
  newsdata: { results: [{ title: 'Headline', link: 'https://example.com/a' }] },
};
for (const [provider, edge] of [['newsapi', newsapi], ['newsdata', newsdata]]) {
  const path = provider === 'newsapi' ? '/api/newsapi-headlines' : '/api/newsdata-feed';
  for (const runtime of ['edge', 'sidecar']) {
    test(`${runtime} ${provider} tracks acquisition separately from absent publication and retains legacy array`, async () => {
      process.env.NEWSAPI_KEY = 'fixture'; process.env.NEWSDATA_API_KEY = 'fixture';
      const old = globalThis.fetch; globalThis.fetch = async () => Response.json(fixtures[provider]);
      try {
        const route = runtime === 'edge' ? (url) => edge(new Request(url)) : localRoute(path);
        const response = await route(`https://local${path}?responseMode=tracked-v1`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.equal(body.format, 'tracked-v1'); assert.equal(body.acquisition.outcome, 'ok');
        assert.equal(body.acquisition.acceptedCount, 1); assert.ok(body.acquisition.acquiredAt > 0);
        assert.equal(body.items[0].provenance.publicationState, 'missing');
        assert.equal(body.items[0].provenance.publishedAt, null);
        const legacy = await route(`https://local${path}`);
        assert.equal(legacy.headers.get('cache-control'), runtime === 'edge' ? 'public, max-age=120, s-maxage=300' : null);
        assert.ok(Array.isArray(await legacy.json()));
        assert.equal((await route(`https://local${path}?responseMode=future`)).status, 400);
      } finally { globalThis.fetch = old; }
    });
    for (const [name, payload] of [['missing collection', {}], ['invalid rows', provider === 'newsapi' ? { articles: [null, {}] } : { results: [null, {}] }]]) {
      test(`${runtime} ${provider} rejects ${name} and does not cache malformed success`, async () => {
        const old = globalThis.fetch; let calls = 0;
        globalThis.fetch = async () => { calls++; return Response.json(payload); };
        try {
          const route = runtime === 'edge' ? (url) => edge(new Request(url)) : localRoute(path);
          for (let i = 0; i < 2; i++) {
            const response = await route(`https://local${path}?responseMode=tracked-v1`);
            assert.equal(response.status, 502); assert.equal(response.headers.get('cache-control'), 'no-store');
            const body = await response.json(); assert.equal(body.acquisition.outcome, 'malformed'); assert.equal(body.acquisition.acquiredAt, null);
          }
          assert.equal(calls, 2);
        } finally { globalThis.fetch = old; }
      });
    }
  }
}
test('GDELT distinguishes observation from publication and preserves acquisition through cache/failure', async () => {
  const old = globalThis.fetch; const cache = new Map();
  globalThis.fetch = async () => Response.json({ articles: [{ title: 'Headline', url: 'https://example.com/a', seendate: '20261029T120000Z' }] });
  try {
    const route = localRoute('/api/news/headlines', cache);
    const first = await (await route('https://local/api/news/headlines')).json();
    assert.equal(first.acquisition.outcome, 'ok'); assert.equal(first.articles[0].provenance.publishedAt, null);
    assert.equal(first.articles[0].provenance.observedAt, Date.parse('2026-10-29T12:00:00Z'));
    const cached = await (await route('https://local/api/news/headlines')).json();
    assert.equal(cached.acquisition.delivery, 'memory_cache'); assert.equal(cached.acquisition.acquiredAt, first.acquisition.acquiredAt);
    for (const value of cache.values()) value.fresh = false;
    globalThis.fetch = async () => new Response('', { status: 429 });
    const stale = await (await route('https://local/api/news/headlines')).json();
    assert.equal(stale.acquisition.outcome, 'rate_limited'); assert.equal(stale.acquisition.delivery, 'memory_cache');
    assert.equal(stale.acquisition.acquiredAt, first.acquisition.acquiredAt); assert.equal(stale.articles[0].provenance.acquiredAt, first.acquisition.acquiredAt);
  } finally { globalThis.fetch = old; }
});
for (const [provider, edge] of [['newsapi', newsapi], ['newsdata', newsdata]]) {
  const path = provider === 'newsapi' ? '/api/newsapi-headlines' : '/api/newsdata-feed';
  for (const runtime of ['edge', 'sidecar']) {
    for (const [outcome, status, makeResponse] of [
      ['denied', 403, () => new Response('secret should never escape', { status: 401 })],
      ['rate_limited', 429, () => new Response('', { status: 429 })],
      ['unavailable', 502, () => { throw new Error('secret fixture'); }],
      ['timeout', 504, () => { throw new DOMException('secret fixture', 'TimeoutError'); }],
      ['malformed', 502, () => new Response('<html>challenge</html>')],
    ]) {
      test(`${runtime} ${provider} reports ${outcome} without false acquisition or exception leaks`, async () => {
        const old = globalThis.fetch; globalThis.fetch = async () => makeResponse();
        try {
          const route = runtime === 'edge' ? (url) => edge(new Request(url)) : localRoute(path);
          const response = await route(`https://local${path}?responseMode=tracked-v1`);
          assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
          const body = await response.json();
          assert.equal(body.acquisition.outcome, outcome); assert.equal(body.acquisition.acquiredAt, null);
          assert.equal(body.acquisition.acceptedCount, 0); assert.ok(body.acquisition.attemptedAt > 0);
          assert.equal(JSON.stringify(body).includes('secret'), false);
        } finally { globalThis.fetch = old; }
      });
    }
    test(`${runtime} ${provider} distinguishes valid empty, invalid publication and missing configuration`, async () => {
      const old = globalThis.fetch;
      globalThis.fetch = async () => Response.json(provider === 'newsapi' ? { articles: [] } : { results: [] });
      try {
        let route = runtime === 'edge' ? (url) => edge(new Request(url)) : localRoute(path);
        const empty = await (await route(`https://local${path}?responseMode=tracked-v1`)).json();
        assert.equal(empty.acquisition.outcome, 'empty'); assert.equal(empty.acquisition.acceptedCount, 0);
        globalThis.fetch = async () => Response.json(provider === 'newsapi' ? { articles: [{ ...fixtures[provider].articles[0], publishedAt: 'invalid' }] } : { results: [{ ...fixtures[provider].results[0], pubDate: 'invalid' }] });
        route = runtime === 'edge' ? (url) => edge(new Request(url)) : localRoute(path);
        const invalidDate = await (await route(`https://local${path}?responseMode=tracked-v1`)).json();
        assert.equal(invalidDate.items[0].provenance.publicationState, 'invalid'); assert.equal(invalidDate.items[0].provenance.publishedAt, null);
        const key = provider === 'newsapi' ? 'NEWSAPI_KEY' : 'NEWSDATA_API_KEY'; const value = process.env[key]; delete process.env[key];
        try {
          const response = await route(`https://local${path}?responseMode=tracked-v1`); assert.equal(response.status, 503);
          const missing = await response.json(); assert.equal(missing.acquisition.outcome, 'unconfigured'); assert.equal(missing.acquisition.attemptedAt, null);
        } finally { process.env[key] = value; }
      } finally { globalThis.fetch = old; }
    });
  }
  test(`sidecar ${provider} versioned cache preserves acquisition and ignores legacy entries`, async () => {
    const old = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(fixtures[provider]); };
    const cache = new Map([[`${provider}:world news`, { fresh: true, data: [{ title: 'legacy' }] }]]);
    try {
      const route = localRoute(path, cache);
      const first = await (await route(`https://local${path}?responseMode=tracked-v1`)).json();
      const second = await (await route(`https://local${path}?responseMode=tracked-v1`)).json();
      assert.equal(calls, 1); assert.equal(second.acquisition.delivery, 'memory_cache');
      assert.equal(second.acquisition.acquiredAt, first.acquisition.acquiredAt);
      assert.equal(second.items[0].provenance.delivery, 'memory_cache'); assert.equal(second.acquisition.cacheStoredAt, first.acquisition.cacheStoredAt);
    } finally { globalThis.fetch = old; }
  });
}
test('GDELT malformed/empty failure never invents update time or pollutes cache', async () => {
  const old = globalThis.fetch; let calls = 0; const cache = new Map();
  globalThis.fetch = async () => { calls++; return Response.json({ articles: [null, {}] }); };
  try {
    const route = localRoute('/api/news/headlines', cache);
    for (let i = 0; i < 2; i++) {
      const response = await route('https://local/api/news/headlines?responseMode=tracked-v1');
      assert.equal(response.status, 502); assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json(); assert.equal(body.acquisition.outcome, 'malformed');
      assert.equal(body.updatedAt, 0); assert.equal(body.acquisition.acquiredAt, null);
    }
    assert.equal(calls, 2); assert.equal(cache.size, 0);
    globalThis.fetch = async () => Response.json({ articles: [] });
    const body = await (await route('https://local/api/news/headlines')).json();
    assert.equal(body.acquisition.outcome, 'empty'); assert.equal(body.acquisition.acceptedCount, 0);
  } finally { globalThis.fetch = old; }
});
test('GDELT backoff preserves the latest unavailable outcome without inventing another attempt', async () => {
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 503 }); };
  try {
    const route = localRoute('/api/news/headlines');
    const first = await (await route('https://local/api/news/headlines')).json();
    const next = await (await route('https://local/api/news/headlines')).json();
    assert.equal(first.acquisition.outcome, 'unavailable'); assert.equal(next.acquisition.outcome, 'unavailable');
    assert.equal(next.acquisition.attemptedAt, first.acquisition.attemptedAt); assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});

for (const [provider, edge] of [['newsapi', newsapi], ['newsdata', newsdata]]) {
  const path = provider === 'newsapi' ? '/api/newsapi-headlines' : '/api/newsdata-feed';
  for (const runtime of ['edge', 'sidecar']) {
    test(`${runtime} ${provider} rejects malformed URL rows without caching`, async () => {
      const old = globalThis.fetch; let calls = 0;
      const rows = ['http://', 'javascript:alert(1)'].map((link) => provider === 'newsapi' ? { title: 'Headline', url: link } : { title: 'Headline', link });
      globalThis.fetch = async () => { calls++; return Response.json(provider === 'newsapi' ? { articles: rows } : { results: rows }); };
      try {
        const route = runtime === 'edge' ? (url) => edge(new Request(url)) : localRoute(path);
        for (let i = 0; i < 2; i++) {
          const response = await route(`https://local${path}?responseMode=tracked-v1`);
          assert.equal(response.status, 502); assert.equal((await response.json()).acquisition.outcome, 'malformed');
        }
        assert.equal(calls, 2);
      } finally { globalThis.fetch = old; }
    });
  }
}

test('GDELT tracked fresh and cached responses use no-store while legacy headers and shape remain unchanged', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ articles: [{ title: 'Headline', url: 'https://example.com/a' }] });
  try {
    const tracked = localRoute('/api/news/headlines');
    for (let i = 0; i < 2; i++) {
      const response = await tracked('https://local/api/news/headlines?responseMode=tracked-v1');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json(); assert.ok(Array.isArray(body.articles));
      assert.equal(body.acquisition.delivery, i === 0 ? 'upstream' : 'memory_cache');
    }
    const legacy = localRoute('/api/news/headlines');
    for (let i = 0; i < 2; i++) {
      const response = await legacy('https://local/api/news/headlines');
      assert.equal(response.headers.get('cache-control'), null);
      const body = await response.json(); assert.ok(Array.isArray(body.articles));
      assert.ok(Array.isArray(body.topics)); assert.equal(typeof body.updatedAt, 'number');
      assert.equal(body.format, undefined);
    }
  } finally { globalThis.fetch = old; }
});
