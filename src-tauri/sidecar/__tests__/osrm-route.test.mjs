import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-osrm-route';
const { createLocalApiServer } = await import('../local-api-server.mjs');

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      method: 'GET',
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

test('desktop dynamic route table serves the strict OSRM graph proxy', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (url, options) => {
    calledUrl = String(url);
    assert.equal(options.maxResponseBytes, 32 * 1024 * 1024);
    return Response.json({
      code: 'Ok',
      routes: [{
        distance: 15_200,
        duration: 1260,
        geometry: { type: 'LineString', coordinates: [[-86.7, 41.6], [-86.8, 41.7]] },
        legs: [{
          distance: 15_200,
          duration: 1260,
          steps: [{ maneuver: { type: 'depart' }, name: 'Main St', distance: 1000, duration: 120 }],
        }],
      }],
    });
  };
  const app = await createLocalApiServer({
    port: 0,
    apiDir: path.resolve('api'),
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  try {
    const coords = encodeURIComponent('-86.7,41.6;-86.8,41.7');
    const response = await httpJson(`http://127.0.0.1:${port}/api/osrm-route?coords=${coords}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.code, 'Ok');
    assert.equal(response.body.routes[0].geometry.type, 'LineString');
    assert.equal(
      calledUrl,
      'https://router.project-osrm.org/route/v1/driving/-86.7,41.6;-86.8,41.7?overview=full&geometries=geojson&steps=true',
    );

    const rejected = await httpJson(`http://127.0.0.1:${port}/api/osrm-route?coords=${coords}&profile=walking`);
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test('desktop OSRM route rejects a streamed body above its cap', async () => {
  const originalFetch = globalThis.fetch;
  const chunk = new Uint8Array(1024 * 1024);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.maxResponseBytes, 32 * 1024 * 1024);
    let sent = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (sent >= 33) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    }), { status: 200 });
  };
  const app = await createLocalApiServer({
    port: 0,
    apiDir: path.resolve('api'),
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  try {
    const coords = encodeURIComponent('-86.7,41.6;-86.8,41.7');
    const response = await httpJson(`http://127.0.0.1:${port}/api/osrm-route?coords=${coords}`);
    assert.equal(response.status, 502);
    assert.deepEqual(response.body, { error: 'Routing provider returned unusable data' });
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});
