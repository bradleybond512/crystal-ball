/**
 * Sidecar tests for /api/otx/pulses.
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-otx-pulses';

import {
  __otxSetStateForTests,
  createLocalApiServer,
  ingestOtxPulsesSidecar,
} from '../local-api-server.mjs';

// ── ingestOtxPulsesSidecar ─────────────────────────────────────────────

test('ingest: dedupes by id, fresh wins', () => {
  const prior = { pulses: [{ id: 'a', name: 'old', modified: '2026-04-01T00:00:00Z' }], cursor: null };
  const next = ingestOtxPulsesSidecar(prior, [{ id: 'a', name: 'new', modified: '2026-05-01T00:00:00Z' }]);
  assert.equal(next.pulses.length, 1);
  assert.equal(next.pulses[0].name, 'new');
});

test('ingest: sorts newest-first', () => {
  const next = ingestOtxPulsesSidecar({ pulses: [], cursor: null }, [
    { id: 'old', modified: '2026-04-01T00:00:00Z' },
    { id: 'new', modified: '2026-05-01T00:00:00Z' },
  ]);
  assert.equal(next.pulses[0].id, 'new');
});

test('ingest: caps at default 200', () => {
  const fresh = Array.from({ length: 250 }, (_, i) => ({ id: `id-${i}`, modified: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` }));
  const next = ingestOtxPulsesSidecar({ pulses: [], cursor: null }, fresh);
  assert.equal(next.pulses.length, 200);
});

test('ingest: cursor set to max modified', () => {
  const next = ingestOtxPulsesSidecar({ pulses: [], cursor: null }, [
    { id: 'a', modified: '2026-05-05T00:00:00Z' },
    { id: 'b', modified: '2026-04-01T00:00:00Z' },
  ]);
  assert.equal(next.cursor, '2026-05-05T00:00:00Z');
});

test('ingest: ignores entries with empty id', () => {
  const next = ingestOtxPulsesSidecar({ pulses: [], cursor: null }, [
    { id: '', modified: '2026-05-05T00:00:00Z' },
    { id: 'a', modified: '2026-04-01T00:00:00Z' },
  ]);
  assert.equal(next.pulses.length, 1);
  assert.equal(next.pulses[0].id, 'a');
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
    port: 0, apiDir: undefined, remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return { base: `http://127.0.0.1:${port}`, async close() { await app.close(); } };
}

test('GET /api/otx/pulses returns injected state', async () => {
  __otxSetStateForTests([
    { id: 'pulse-1', name: 'APT28 fresh tooling', modified: '2026-05-01T00:00:00Z' },
  ], '2026-05-01T00:00:00Z');
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('GET', `${sidecar.base}/api/otx/pulses`);
    assert.equal(res.status, 200);
    assert.equal(res.body.pulses.length, 1);
    assert.equal(res.body.pulses[0].id, 'pulse-1');
    assert.equal(res.body.cursor, '2026-05-01T00:00:00Z');
    assert.equal(res.body.available, true);
  } finally {
    await sidecar.close();
  }
});

test('non-GET methods return 405', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/otx/pulses`);
    assert.equal(res.status, 405);
  } finally {
    await sidecar.close();
  }
});
