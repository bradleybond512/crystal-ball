// R4-LOW-008: /api/local-evidence/* routes on a real sidecar bound to an ephemeral
// port with a temporary data directory. Covers the auth gate, methods, body
// caps, per-entry validation, 503 when the store is down, export headers and
// the traffic-recorder skip.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-evidence-routes';

import { createLocalApiServer } from '../local-api-server.mjs';

const T0 = 1_790_000_000_000;
const AUTH = { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };

async function startSidecar() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'evidence-routes-'));
  const app = await createLocalApiServer({
    port: 0,
    apiDir: undefined,
    dataDir,
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function post(base, route, body, headers = AUTH) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function statusOf(pending) {
  const response = await pending;
  return response.status;
}

async function jsonOf(pending) {
  const response = await pending;
  return response.json();
}

function outcome(id, overrides = {}) {
  return {
    kind: 'alert-outcome',
    payload: { id, domain: 'weather', predictedSeverity: 'high', actualOutcome: 'dismissed', recordedAt: T0, ...overrides },
  };
}

test('evidence routes require the bearer token', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await fetch(`${sidecar.base}/api/local-evidence/summary`);
    assert.equal(res.status, 401);
    const write = await post(sidecar.base, '/api/local-evidence/append', { entries: [outcome('oc-1')] }, {});
    assert.equal(write.status, 401);
    assert.equal(sidecar.app.context.evidenceStore.summary().total, 0);
  } finally {
    await sidecar.close();
  }
});

test('append, missing, records, summary and export work end to end', async () => {
  const sidecar = await startSidecar();
  try {
    const appended = await post(sidecar.base, '/api/local-evidence/append', {
      entries: [outcome('oc-1', { notes: 'free text never stored' }), outcome('oc-2'), { kind: 'nope', payload: {} }],
    });
    assert.equal(appended.status, 200);
    assert.equal(appended.headers.get('cache-control'), 'no-store');
    const result = await appended.json();
    assert.equal(result.appended, 2);
    assert.deepEqual(result.results.map((r) => r.status), ['appended', 'appended', 'rejected']);

    const records = await jsonOf(fetch(`${sidecar.base}/api/local-evidence/records?kind=alert-outcome&limit=1`, { headers: AUTH }));
    assert.deepEqual(records.entries.map((e) => e.recordId), ['oc-2']);
    assert.ok(records.nextBeforeSeq > 0);
    const older = await jsonOf(fetch(`${sidecar.base}/api/local-evidence/records?kind=alert-outcome&before_seq=${records.nextBeforeSeq}`, { headers: AUTH }));
    assert.deepEqual(older.entries.map((e) => e.recordId), ['oc-1']);
    assert.equal(older.entries[0].payload.notes, undefined);

    const missing = await jsonOf(post(sidecar.base, '/api/local-evidence/missing', {
      entries: [
        { kind: 'alert-outcome', id: 'oc-1', digest: older.entries[0].digest },
        { kind: 'alert-outcome', id: 'oc-3', digest: older.entries[0].digest },
      ],
    }));
    assert.deepEqual(missing, { missing: [1] });

    const summary = await jsonOf(fetch(`${sidecar.base}/api/local-evidence/summary`, { headers: AUTH }));
    assert.equal(summary.total, 2);
    assert.equal(summary.byKind['alert-outcome'], 2);
    assert.equal(summary.chain.ok, true);

    const exported = await fetch(`${sidecar.base}/api/local-evidence/export`, { headers: AUTH });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /^application\/x-ndjson/);
    assert.equal(exported.headers.get('cache-control'), 'no-store');
    const exportText = await exported.text();
    const lines = exportText.trimEnd().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).type, 'crystal-ball-evidence-export');
  } finally {
    await sidecar.close();
  }
});

test('bad input maps to 400, 405 and 413 without writing', async () => {
  const sidecar = await startSidecar();
  try {
    assert.equal(await statusOf(post(sidecar.base, '/api/local-evidence/append', '{not json')), 400);
    assert.equal(await statusOf(post(sidecar.base, '/api/local-evidence/append', { entries: [] })), 400);
    assert.equal(await statusOf(post(sidecar.base, '/api/local-evidence/missing', { entries: 'x' })), 400);
    assert.equal(await statusOf(fetch(`${sidecar.base}/api/local-evidence/records?kind=nope`, { headers: AUTH })), 400);
    assert.equal(await statusOf(fetch(`${sidecar.base}/api/local-evidence/append`, { headers: AUTH })), 405);
    assert.equal(await statusOf(post(sidecar.base, '/api/local-evidence/summary', {})), 405);
    assert.equal(await statusOf(fetch(`${sidecar.base}/api/local-evidence/other`, { headers: AUTH })), 404);
    const huge = { entries: [outcome('oc-big', { domain: 'x'.repeat(1024 * 1024) })] };
    assert.equal(await statusOf(post(sidecar.base, '/api/local-evidence/append', huge)), 413);
    assert.equal(sidecar.app.context.evidenceStore.summary().total, 0);
  } finally {
    await sidecar.close();
  }
});

test('routes answer 503 when the store failed to open', async () => {
  const sidecar = await startSidecar();
  const store = sidecar.app.context.evidenceStore;
  try {
    sidecar.app.context.evidenceStore = null;
    assert.equal(await statusOf(fetch(`${sidecar.base}/api/local-evidence/summary`, { headers: AUTH })), 503);
    assert.equal(await statusOf(post(sidecar.base, '/api/local-evidence/append', { entries: [outcome('oc-1')] })), 503);
  } finally {
    sidecar.app.context.evidenceStore = store;
    await sidecar.close();
  }
});

test('evidence requests are not written to the traffic log', async () => {
  const sidecar = await startSidecar();
  try {
    await post(sidecar.base, '/api/local-evidence/append', { entries: [outcome('oc-1')] });
    await fetch(`${sidecar.base}/api/local-evidence/summary`, { headers: AUTH });
    await fetch(`${sidecar.base}/api/service-status`, { headers: AUTH });
    const log = await jsonOf(fetch(`${sidecar.base}/api/local-traffic-log`, { headers: AUTH }));
    const paths = log.entries.map((entry) => entry.path);
    assert.ok(paths.includes('/api/service-status'), 'control: ordinary routes are recorded');
    assert.equal(paths.some((p) => p.startsWith('/api/local-evidence/')), false);
  } finally {
    await sidecar.close();
  }
});
