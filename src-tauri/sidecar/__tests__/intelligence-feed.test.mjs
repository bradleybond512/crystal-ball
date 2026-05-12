/**
 * Sidecar tests for:
 *   POST/GET /api/intelligence/what-changed
 *   GET      /api/intelligence/feed
 *
 * Tests cover: what-changed sanitization, feed aggregation across all three
 * source types, domain/type/since/limit filtering, and sort order.
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-intelligence-feed';

import { createLocalApiServer } from '../local-api-server.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────

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

const NOW = 1_745_000_000_000;

function makeObs(overrides = {}) {
  return {
    id: 'eq:001',
    sourceId: 'usgs',
    domain: 'seismic',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'M5.2 near LA',
    entityIds: [],
    tags: ['earthquake'],
    ...overrides,
  };
}

function makeCorr(overrides = {}) {
  return {
    type: 'multi-hazard',
    severity: 'high',
    domains: ['seismic', 'nuclear'],
    description: 'Quake + nuclear-plant watch correlation',
    triggeredAt: new Date(NOW - 5000).toISOString(),
    components: [{ domain: 'seismic', source: 'usgs', description: 'M5.2' }],
    ...overrides,
  };
}

function makeChange(overrides = {}) {
  return {
    id: 'iran-risk',
    kind: 'score_rose',
    text: 'Iran escalation risk rose from 48 → 71',
    magnitude: 23,
    polarity: 'worse',
    category: 'geopolitical',
    weight: 1,
    recordedAt: NOW - 10_000,
    ...overrides,
  };
}

// ── /api/intelligence/what-changed ────────────────────────────────────────

test('what-changed: GET returns empty when nothing posted', async () => {
  const { base, close } = await startSidecar();
  try {
    const { status, body } = await httpJson('GET', `${base}/api/intelligence/what-changed`);
    assert.equal(status, 200);
    assert.deepEqual(body.lines, []);
    assert.equal(body.available, false);
  } finally { await close(); }
});

test('what-changed: POST stores and GET returns lines', async () => {
  const { base, close } = await startSidecar();
  try {
    const line = makeChange();
    const post = await httpJson('POST', `${base}/api/intelligence/what-changed`, [line]);
    assert.equal(post.status, 200);
    assert.equal(post.body.count, 1);

    const { body } = await httpJson('GET', `${base}/api/intelligence/what-changed`);
    assert.equal(body.available, true);
    assert.equal(body.lines.length, 1);
    assert.equal(body.lines[0].id, 'iran-risk');
    assert.equal(body.lines[0].kind, 'score_rose');
    assert.equal(body.lines[0].polarity, 'worse');
  } finally { await close(); }
});

test('what-changed: rejects non-array body', async () => {
  const { base, close } = await startSidecar();
  try {
    const { status } = await httpJson('POST', `${base}/api/intelligence/what-changed`, { lines: [] });
    assert.equal(status, 400);
  } finally { await close(); }
});

test('what-changed: drops lines with invalid kind', async () => {
  const { base, close } = await startSidecar();
  try {
    const good = makeChange({ id: 'a', kind: 'score_rose' });
    const bad  = makeChange({ id: 'b', kind: 'exploded' });
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [good, bad]);
    const { body } = await httpJson('GET', `${base}/api/intelligence/what-changed`);
    assert.equal(body.lines.length, 1);
    assert.equal(body.lines[0].id, 'a');
  } finally { await close(); }
});

test('what-changed: drops lines with invalid polarity', async () => {
  const { base, close } = await startSidecar();
  try {
    const bad = makeChange({ polarity: 'sideways' });
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [bad]);
    const { body } = await httpJson('GET', `${base}/api/intelligence/what-changed`);
    assert.equal(body.lines.length, 0);
  } finally { await close(); }
});

test('what-changed: truncates text to 500 chars', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [makeChange({ text: 'X'.repeat(2000) })]);
    const { body } = await httpJson('GET', `${base}/api/intelligence/what-changed`);
    assert.equal(body.lines[0].text.length, 500);
  } finally { await close(); }
});

test('what-changed: PUT/DELETE returns 405', async () => {
  const { base, close } = await startSidecar();
  try {
    const { status } = await httpJson('DELETE', `${base}/api/intelligence/what-changed`);
    assert.equal(status, 405);
  } finally { await close(); }
});

// ── /api/intelligence/feed — empty ────────────────────────────────────────

test('feed: returns empty items array when no data posted', async () => {
  const { base, close } = await startSidecar();
  try {
    const { status, body } = await httpJson('GET', `${base}/api/intelligence/feed`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    assert.equal(body.items.length, 0);
    assert.equal(body.total, 0);
    assert.ok(typeof body.generated === 'number');
  } finally { await close(); }
});

// ── /api/intelligence/feed — aggregation ──────────────────────────────────

test('feed: aggregates observations + correlations + changes in timestamp order', async () => {
  const { base, close } = await startSidecar();
  try {
    // Post observations (newest)
    await httpJson('POST', `${base}/api/intelligence/observations`, [
      makeObs({ id: 'eq:newest', timestamp: NOW }),
      makeObs({ id: 'eq:older',  timestamp: NOW - 20_000 }),
    ]);
    // Post correlations
    await httpJson('POST', `${base}/api/synthesis/correlations`, {
      events: [makeCorr({ triggeredAt: new Date(NOW - 5000).toISOString() })],
      highestSeverity: 'high',
      asOf: NOW,
    });
    // Post what-changed
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [
      makeChange({ recordedAt: NOW - 10_000 }),
    ]);

    const { body } = await httpJson('GET', `${base}/api/intelligence/feed`);
    assert.ok(body.items.length >= 4);

    // Verify newest-first order
    for (let i = 1; i < body.items.length; i++) {
      assert.ok(body.items[i - 1].timestamp >= body.items[i].timestamp,
        `item ${i - 1} (${body.items[i - 1].timestamp}) should be >= item ${i} (${body.items[i].timestamp})`);
    }

    const types = new Set(body.items.map((x) => x.type));
    assert.ok(types.has('observation'), 'should include observations');
    assert.ok(types.has('correlation'), 'should include correlations');
    assert.ok(types.has('change'), 'should include changes');
  } finally { await close(); }
});

// ── /api/intelligence/feed — type filter ──────────────────────────────────

test('feed: type=observation returns only observations', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/observations`, [makeObs()]);
    await httpJson('POST', `${base}/api/synthesis/correlations`, {
      events: [makeCorr()], highestSeverity: 'high', asOf: NOW,
    });
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [makeChange()]);

    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?type=observation`);
    assert.ok(body.items.length >= 1);
    assert.ok(body.items.every((i) => i.type === 'observation'));
  } finally { await close(); }
});

test('feed: type=correlation returns only correlations', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/observations`, [makeObs()]);
    await httpJson('POST', `${base}/api/synthesis/correlations`, {
      events: [makeCorr()], highestSeverity: 'high', asOf: NOW,
    });

    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?type=correlation`);
    assert.ok(body.items.every((i) => i.type === 'correlation'));
  } finally { await close(); }
});

test('feed: type=change returns only what-changed lines', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/observations`, [makeObs()]);
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [makeChange()]);

    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?type=change`);
    assert.ok(body.items.every((i) => i.type === 'change'));
  } finally { await close(); }
});

// ── /api/intelligence/feed — domain filter ────────────────────────────────

test('feed: domain filter excludes other domains', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/observations`, [
      makeObs({ id: 'eq:1', domain: 'seismic' }),
      makeObs({ id: 'avi:1', domain: 'aviation' }),
    ]);

    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?domain=seismic`);
    assert.ok(body.items.length >= 1);
    assert.ok(body.items.every((i) => i.domain === 'seismic'));
  } finally { await close(); }
});

// ── /api/intelligence/feed — since filter ─────────────────────────────────

test('feed: since filter excludes older events', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/observations`, [
      makeObs({ id: 'new', timestamp: NOW }),
      makeObs({ id: 'old', timestamp: NOW - 60_000 }),
    ]);

    const cutoff = NOW - 30_000;
    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?since=${cutoff}`);
    assert.ok(body.items.every((i) => i.timestamp >= cutoff));
    const ids = body.items.map((i) => i.id);
    assert.ok(ids.some((id) => id.includes('new')));
    assert.ok(!ids.some((id) => id.includes('old')));
  } finally { await close(); }
});

// ── /api/intelligence/feed — limit ────────────────────────────────────────

test('feed: limit=2 returns at most 2 items', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/observations`, [
      makeObs({ id: 'a', timestamp: NOW }),
      makeObs({ id: 'b', timestamp: NOW - 1000 }),
      makeObs({ id: 'c', timestamp: NOW - 2000 }),
    ]);

    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?limit=2`);
    assert.equal(body.items.length, 2);
    assert.ok(body.total >= 3);
  } finally { await close(); }
});

test('feed: POST returns 405', async () => {
  const { base, close } = await startSidecar();
  try {
    const { status } = await httpJson('POST', `${base}/api/intelligence/feed`, []);
    assert.equal(status, 405);
  } finally { await close(); }
});

// ── /api/intelligence/feed — severity mapping for changes ─────────────────

test('feed: change polarity worse maps to HIGH severity', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [
      makeChange({ polarity: 'worse' }),
    ]);
    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?type=change`);
    assert.ok(body.items.length >= 1);
    assert.equal(body.items[0].severity, 'HIGH');
  } finally { await close(); }
});

test('feed: change polarity better maps to LOW severity', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [
      makeChange({ polarity: 'better', kind: 'cleared' }),
    ]);
    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?type=change`);
    assert.ok(body.items.length >= 1);
    assert.equal(body.items[0].severity, 'LOW');
  } finally { await close(); }
});

test('feed: change polarity neutral maps to INFO severity', async () => {
  const { base, close } = await startSidecar();
  try {
    await httpJson('POST', `${base}/api/intelligence/what-changed`, [
      makeChange({ polarity: 'neutral', kind: 'meta_changed' }),
    ]);
    const { body } = await httpJson('GET', `${base}/api/intelligence/feed?type=change`);
    assert.ok(body.items.length >= 1);
    assert.equal(body.items[0].severity, 'INFO');
  } finally { await close(); }
});
