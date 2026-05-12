/**
 * Sidecar tests for:
 *   POST /api/shortage/state    — renderer pushes summary entries
 *   GET  /api/shortage/overview — UI-ready sorted rows (commodity name,
 *                                  riskScore, riskLevel, topDriver, trend)
 *   GET  /api/shortage/:commodity — full detail still resolves and is not
 *                                    captured by the new overview route
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-shortage-overview';

import { createLocalApiServer } from '../local-api-server.mjs';

async function startSidecar() {
  const app = await createLocalApiServer({
    port: 0,
    apiDir: undefined,
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return { base: `http://127.0.0.1:${port}`, async close() { await app.close(); } };
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = httpRequest({
      hostname: u.hostname, port: u.port, method,
      path: u.pathname + u.search, headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeEntry(commodity, riskScore, riskLevel, drivers = ['driver-1'], trend = 'stable') {
  return {
    commodity,
    riskScore,
    riskLevel,
    primaryDrivers: drivers,
    timeToImpact: '30d',
    trend,
    forecast: { drivers: [], dataGaps: [], confidence: 'medium' },
  };
}

test('GET /api/shortage/overview returns [] when renderer has not pushed state yet', async () => {
  const sc = await startSidecar();
  try {
    const res = await httpJson('GET', `${sc.base}/api/shortage/overview`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  } finally { await sc.close(); }
});

test('GET /api/shortage/overview returns rows sorted by riskScore desc after POST', async () => {
  const sc = await startSidecar();
  try {
    const post = await httpJson('POST', `${sc.base}/api/shortage/state`, {
      entries: [
        makeEntry('wheat', 25, 'LOW'),
        makeEntry('corn', 92, 'CRITICAL', ['drought']),
        makeEntry('diesel', 75, 'CRITICAL', ['hormuz']),
      ],
      updatedAt: Date.now(),
      ttlMs: 60 * 60 * 1000,
    });
    assert.equal(post.status, 200);
    const res = await httpJson('GET', `${sc.base}/api/shortage/overview`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 3);
    assert.deepEqual(res.body.map((r) => r.commodity), ['corn', 'diesel', 'wheat']);
  } finally { await sc.close(); }
});

test('GET /api/shortage/overview rows have name/riskScore/riskLevel/topDriver/trend shape', async () => {
  const sc = await startSidecar();
  try {
    await httpJson('POST', `${sc.base}/api/shortage/state`, {
      entries: [makeEntry('corn', 92, 'CRITICAL', ['drought'], 'deteriorating')],
      updatedAt: Date.now(),
      ttlMs: 60 * 60 * 1000,
    });
    const res = await httpJson('GET', `${sc.base}/api/shortage/overview`);
    assert.equal(res.body[0].commodity, 'corn');
    assert.equal(res.body[0].riskScore, 92);
    assert.equal(res.body[0].riskLevel, 'CRITICAL');
    assert.equal(res.body[0].topDriver, 'drought');
    assert.equal(res.body[0].trend, 'deteriorating');
  } finally { await sc.close(); }
});

test('GET /api/shortage/overview uses "—" when primaryDrivers is empty', async () => {
  const sc = await startSidecar();
  try {
    await httpJson('POST', `${sc.base}/api/shortage/state`, {
      entries: [makeEntry('wheat', 50, 'HIGH', [])],
      updatedAt: Date.now(),
      ttlMs: 60 * 60 * 1000,
    });
    const res = await httpJson('GET', `${sc.base}/api/shortage/overview`);
    assert.equal(res.body[0].topDriver, '—');
  } finally { await sc.close(); }
});

test('GET /api/shortage/overview returns [] when state is past its TTL', async () => {
  const sc = await startSidecar();
  try {
    await httpJson('POST', `${sc.base}/api/shortage/state`, {
      entries: [makeEntry('corn', 92, 'CRITICAL', ['drought'])],
      updatedAt: Date.now() - 60_000, // pushed 60s ago
      ttlMs: 1000,                   // but TTL is 1s — so it's stale
    });
    const res = await httpJson('GET', `${sc.base}/api/shortage/overview`);
    assert.deepEqual(res.body, []);
  } finally { await sc.close(); }
});

test('GET /api/shortage/:commodity still returns detail (overview did not capture it)', async () => {
  const sc = await startSidecar();
  try {
    await httpJson('POST', `${sc.base}/api/shortage/state`, {
      entries: [makeEntry('corn', 92, 'CRITICAL', ['drought'])],
      updatedAt: Date.now(),
      ttlMs: 60 * 60 * 1000,
    });
    const res = await httpJson('GET', `${sc.base}/api/shortage/corn`);
    assert.equal(res.status, 200);
    assert.equal(res.body.commodity, 'corn');
    assert.equal(res.body.riskLevel, 'CRITICAL');
    assert.equal(res.body.available, true);
  } finally { await sc.close(); }
});

test('GET /api/shortage/overview rounds non-integer scores', async () => {
  const sc = await startSidecar();
  try {
    await httpJson('POST', `${sc.base}/api/shortage/state`, {
      entries: [makeEntry('corn', 73.7, 'CRITICAL', ['drought'])],
      updatedAt: Date.now(),
      ttlMs: 60 * 60 * 1000,
    });
    const res = await httpJson('GET', `${sc.base}/api/shortage/overview`);
    assert.equal(res.body[0].riskScore, 74);
  } finally { await sc.close(); }
});
