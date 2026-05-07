/**
 * Sidecar tests for /api/acled/events.
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-acled-events';

import {
  __acledSetCacheForTests,
  _acledMsUntilNext6UtcSidecar,
  createLocalApiServer,
  transformAcledRecordSidecar,
} from '../local-api-server.mjs';

// ── Pure transform tests ───────────────────────────────────────────────

test('transformAcledRecordSidecar: minimal valid record', () => {
  const ev = transformAcledRecordSidecar({
    event_id_cnty: 'IRQ1',
    event_date: '2026-04-30',
    event_type: 'Battles',
    sub_event_type: 'Armed clash',
    actor1: 'Group A',
    actor2: 'Group B',
    country: 'Iraq',
    location: 'Mosul',
    fatalities: 25,
  });
  assert.equal(ev.id, 'acled-IRQ1');
  assert.equal(ev.intensity, 'high');
  assert.equal(ev.eventType, 'Armed clash');
  assert.equal(ev.source, 'acled');
});

test('transformAcledRecordSidecar: returns null for missing event_id_cnty', () => {
  assert.equal(transformAcledRecordSidecar({}), null);
  assert.equal(transformAcledRecordSidecar({ event_id_cnty: '' }), null);
});

test('transformAcledRecordSidecar: handles string fatalities', () => {
  const ev = transformAcledRecordSidecar({
    event_id_cnty: 'X', event_date: '2026-04-30', fatalities: '60',
  });
  assert.equal(ev.intensity, 'critical');
});

test('transformAcledRecordSidecar: deduplicates identical actor1+actor2', () => {
  const ev = transformAcledRecordSidecar({
    event_id_cnty: 'X', event_date: '2026-04-30', actor1: 'X', actor2: 'X',
  });
  assert.deepEqual(ev.actors, ['X']);
});

test('transformAcledRecordSidecar: empty country falls back to Unknown', () => {
  const ev = transformAcledRecordSidecar({
    event_id_cnty: 'X', event_date: '2026-04-30',
  });
  assert.equal(ev.country, 'Unknown');
});

// ── _acledMsUntilNext6UtcSidecar ───────────────────────────────────────

test('msUntilNext6Utc: returns positive value', () => {
  const ms = _acledMsUntilNext6UtcSidecar();
  assert.ok(ms > 0);
  assert.ok(ms <= 24 * 60 * 60 * 1000);
});

test('msUntilNext6Utc: at exactly 06:00:00 UTC → next day (24h)', () => {
  const at6 = Date.UTC(2026, 4, 5, 6, 0, 0);
  const ms = _acledMsUntilNext6UtcSidecar(at6);
  assert.equal(ms, 24 * 60 * 60 * 1000);
});

test('msUntilNext6Utc: at 05:59 UTC → 1 minute', () => {
  const at0559 = Date.UTC(2026, 4, 5, 5, 59, 0);
  const ms = _acledMsUntilNext6UtcSidecar(at0559);
  assert.equal(ms, 60 * 1000);
});

// ── Sidecar integration tests ──────────────────────────────────────────

function httpJson(method, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest({
      hostname: u.hostname, port: u.port, method, path: u.pathname,
      headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
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
    req.end();
  });
}

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

test('GET /api/acled/events returns injected cache', async () => {
  __acledSetCacheForTests([{
    id: 'acled-IRQ1', date: '2026-04-30', location: 'Mosul, Iraq', country: 'Iraq',
    eventType: 'Armed clash', actors: ['A', 'B'], intensity: 'high',
    summary: 'test', source: 'acled',
  }]);
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('GET', `${sidecar.base}/api/acled/events`);
    assert.equal(res.status, 200);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].source, 'acled');
    assert.equal(res.body.available, true);
  } finally {
    await sidecar.close();
  }
});

test('non-GET methods return 405', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/acled/events`);
    assert.equal(res.status, 405);
  } finally {
    await sidecar.close();
  }
});
