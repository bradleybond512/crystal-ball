import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-ucdp-local-routes';
process.env.LOCAL_API_MODE = 'desktop-sidecar';
const originalProviderToken = process.env.UCDP_API_TOKEN;
execFileSync(process.execPath, ['scripts/build-sidecar-sebuf.mjs'], {
  cwd: path.resolve('.'),
  stdio: 'pipe',
});
const { createLocalApiServer } = await import('../local-api-server.mjs');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method: 'GET',
      path: target.pathname + target.search,
      headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function gedRow(id) {
  return {
    id,
    date_start: '2025-10-01', date_end: '2025-10-02',
    latitude: 0, longitude: 0, country: 'Ukraine', side_a: 'Side A', side_b: 'Side B',
    best: 2, low: 1, high: 3, type_of_violence: 1, source_original: null,
  };
}

test('desktop startup serves event and classification routes in at most nine combined upstream calls', async () => {
  const originalFetch = globalThis.fetch;
  process.env.UCDP_API_TOKEN = 'sidecar-provider-token';
  let upstreamCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    upstreamCalls++;
    assert.equal(new Headers(init?.headers).get('x-ucdp-access-token'), 'sidecar-provider-token');
    if (url.pathname.includes('/gedevents/')) {
      const page = Number(url.searchParams.get('page'));
      const length = page === 7 ? 921 : 1000;
      return Response.json({
        Result: Array.from({ length }, (_, index) => gedRow((page * 1000) + index + 1)),
        TotalCount: 7921, TotalPages: 8, NextPageUrl: null, PreviousPageUrl: null,
      });
    }
    if (url.pathname.includes('/organizedviolencecy/')) {
      return Response.json({
        Result: Array.from({ length: 196 }, (_, index) => ({
          country: `Country ${index + 1}`, country_id: index + 1, year: 2025,
          sb_exist: index % 2, ns_exist: 0, os_exist: 0,
        })),
        TotalCount: 196, TotalPages: 1, NextPageUrl: null, PreviousPageUrl: null,
      });
    }
    throw new Error('Unexpected upstream request');
  };
  const app = await createLocalApiServer({
    port: 0,
    apiDir: path.resolve('api'),
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  try {
    const events = await getJson(`http://127.0.0.1:${port}/api/conflict/v1/list-ucdp-events?page_size=100`);
    const classifications = await getJson(`http://127.0.0.1:${port}/api/ucdp-classifications`);
    assert.equal(events.status, 200);
    assert.equal(events.body.events.length, 100);
    assert.equal(events.body.pagination.totalCount, 7921);
    assert.equal(classifications.status, 200);
    assert.equal(classifications.body.totalCount, 196);
    assert.equal(upstreamCalls, 9);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (originalProviderToken === undefined) delete process.env.UCDP_API_TOKEN;
    else process.env.UCDP_API_TOKEN = originalProviderToken;
  }
});
