import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-local-logistics-route';
const { createLocalApiServer } = await import('../local-api-server.mjs');

function httpJson(method, url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      method,
      path: parsed.pathname + parsed.search,
      headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
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

    const rejected = await httpJson('POST', `http://127.0.0.1:${port}/api/local-logistics?lat=0&lon=0&categories=fuel`);
    assert.equal(rejected.status, 405);

    const spoofedCounty = await httpJson('GET', `http://127.0.0.1:${port}/api/local-logistics?lat=41.6&lon=-86.72&categories=fuel&countyFips=06037`);
    assert.equal(spoofedCounty.status, 400, 'desktop parity route must not trust a caller-supplied county FIPS');
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});
