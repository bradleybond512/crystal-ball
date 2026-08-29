import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-local-logistics-route';
const { createLocalApiServer } = await import('../local-api-server.mjs');

function httpJson(method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      method,
      path: parsed.pathname + parsed.search,
      headers: {
        authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
        ...(options.body === undefined ? {} : {
          'content-type': options.contentType ?? 'application/json',
          'content-length': String(Buffer.byteLength(options.body)),
        }),
        ...options.headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

function httpChunkedJson(url, chunks, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      method: 'POST',
      path: parsed.pathname,
      headers: {
        authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
        'content-type': 'application/json',
        ...headers,
      },
    }, (res) => {
      const responseChunks = [];
      res.on('data', (chunk) => responseChunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(responseChunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('desktop dynamic handler serves the same strict local-logistics v2 route', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('overpass-api.de')) {
      return Response.json({ elements: [
        { type: 'node', id: 1, lat: 0, lon: 0, tags: { amenity: 'fuel', name: 'Directory Fuel', opening_hours: '24/7' } },
      ] }, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('geocoding.geo.census.gov')) return Response.json({
      result: { geographies: { Counties: [{ GEOID: '17031' }] } },
    });
    if (String(url).includes('openenergyhub.ornl.gov')) return Response.json({
      total_count: 1,
      results: [{ communitydescriptor: '17031', county: 'Cook', state: 'Illinois', metersaffected: 9 }],
    });
    throw new Error(`unexpected upstream ${url}`);
  };
  const app = await createLocalApiServer({
    port: 0,
    apiDir: path.resolve('api'),
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  try {
    const response = await httpJson('GET', `http://127.0.0.1:${port}/api/local-logistics?lat=0&lon=0&categories=fuel`);
    assert.equal(response.status, 200);
    assert.equal(response.body.schemaVersion, 2);
    assert.equal(response.body.sites[0].name, 'Directory Fuel');
    assert.equal(response.body.observations[0].operational, 'unknown');
    assert.equal(response.body.providers[0].id, 'osm');

    const sessionBody = JSON.stringify({
      schemaVersion: 1, purpose: 'session-lifelines', latitude: 41.881_832, longitude: -87.623_177,
      radiusKm: 10, categories: ['fuel'], limitPerCategory: 3,
    });
    const session = await httpJson('POST', `http://127.0.0.1:${port}/api/local-logistics`, { body: sessionBody });
    assert.equal(session.status, 200);
    assert.equal(session.headers['cache-control'], 'private, no-store');
    assert.deepEqual(session.body.query, { radiusKm: 10, categories: ['fuel'] });
    assert.equal(session.body.areaConditions.length, 1);

    const oversized = await httpJson('POST', `http://127.0.0.1:${port}/api/local-logistics`, { body: 'x'.repeat(2049) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers['cache-control'], 'private, no-store');
    assert.deepEqual(oversized.body, { error: 'body_too_large' });

    const chunkedOversized = await httpChunkedJson(
      `http://127.0.0.1:${port}/api/local-logistics`,
      ['x'.repeat(1024), 'y'.repeat(1025)],
    );
    assert.equal(chunkedOversized.status, 413);
    assert.equal(chunkedOversized.headers['cache-control'], 'private, no-store');
    assert.deepEqual(chunkedOversized.body, { error: 'body_too_large' });

    const unauthorized = await httpJson('POST', `http://127.0.0.1:${port}/api/local-logistics`, {
      body: '9'.repeat(4096),
      headers: { authorization: '' },
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers['cache-control'], 'private, no-store');
    assert.deepEqual(unauthorized.body, { error: 'unauthorized' });

    const spoofedCounty = await httpJson('GET', `http://127.0.0.1:${port}/api/local-logistics?lat=41.6&lon=-86.72&categories=fuel&countyFips=06037`);
    assert.equal(spoofedCounty.status, 400, 'desktop parity route must not trust a caller-supplied county FIPS');
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});
