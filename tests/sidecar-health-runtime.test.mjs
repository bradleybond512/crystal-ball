import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

// This test starts only synthetic stores and owned loopback listeners. The
// outer health-contract suite installs fake HOME/data and the network guard
// before importing any sidecar code.
assert.ok(process.env.CB_TEST_PORT_REGISTRY, 'Run through test:health-contract isolation.');
const {
  SidecarHealth,
  createLocalApiServer,
  EXPECTED_API_KEYS,
  _resetFeedTracker,
  recordFeedFailure,
  recordFeedSuccess,
} = await import('../src-tauri/sidecar/local-api-server.mjs');

const TOKEN = 'fixture-only-health-contract-token'; // secret-scan: allow -- synthetic credential for owned loopback health-contract fixtures

async function withServer(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'health-contract-'));
  const apiDir = path.join(root, 'api');
  mkdirSync(apiDir);
  const previousToken = process.env.LOCAL_API_TOKEN;
  process.env.LOCAL_API_TOKEN = TOKEN;
  const logs = [];
  const logger = Object.fromEntries(['log', 'warn', 'error'].map((method) => [method, (...args) => logs.push(args.join(' '))]));
  const app = await createLocalApiServer({ port: 0, dataDir: root, resourceDir: root, apiDir, logger });
  try {
    const { port } = await app.start();
    await run(`http://127.0.0.1:${port}`, logs);
  } finally {
    await app.close();
    _resetFeedTracker();
    if (previousToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = previousToken;
    rmSync(root, { recursive: true, force: true });
  }
}

test('the public projection never evaluates the inventory callback', () => {
  let reads = 0;
  for (const authenticated of [false, undefined, 'true']) {
    assert.deepEqual(SidecarHealth.project(authenticated, () => { reads += 1; throw new Error('private inventory'); }), { ok: true });
  }
  assert.equal(reads, 0);
});

test('production health returns exact minimal uncached liveness without a valid bearer', async () => {
  await withServer(async (base, logs) => {
    recordFeedFailure('private-feed-canary', 'private-error-canary');
    const project = SidecarHealth.project;
    let inventoryReads = 0;
    SidecarHealth.project = (authenticated, readDetails) => project(authenticated, () => {
      inventoryReads += 1;
      return readDetails();
    });
    try {
      for (const authorization of [undefined, 'Basic private-canary', 'Bearer wrong-canary', 'Bearer']) {
        const headers = { Origin: 'https://crystalball.app', ...(authorization ? { authorization } : {}) };
        const response = await fetch(`${base}/api/health`, { headers });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://crystalball.app');
        assert.deepEqual(await response.json(), { ok: true });
      }
      assert.equal(inventoryReads, 0, 'the production route must leave inventory unevaluated');
    } finally {
      SidecarHealth.project = project;
    }
    assert.equal(logs.join('\n').includes('private-feed-canary'), false);
    assert.equal(logs.join('\n').includes('wrong-canary'), false);
    assert.equal(logs.join('\n').includes(TOKEN), false);
  });
});

test('public health preserves the production Host guard and auth-free preflight', async () => {
  await withServer(async (base) => {
    const forbidden = await new Promise((resolve, reject) => {
      const request = http.get(`${base}/api/health`, { headers: { Host: 'evil.invalid' } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
    });
    assert.equal(forbidden, 403);
    const preflight = await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { Origin: 'https://crystalball.app' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://crystalball.app');
  });
});

test('production authenticated health keeps liveness true while reporting real degradation and recovery', async () => {
  const previousKeys = new Map(EXPECTED_API_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of EXPECTED_API_KEYS) delete process.env[key];
    await withServer(async (base) => {
      _resetFeedTracker();
      recordFeedFailure('fixture-feed', 'fixture-upstream-unavailable');
      const headers = { authorization: `Bearer ${TOKEN}` };
      const response = await fetch(`${base}/api/health`, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const degraded = await response.json();
      assert.equal(degraded.ok, true, 'ok is process liveness, independent of feed/key degradation');
      assert.equal(degraded.authenticated, true);
      assert.equal(degraded.degraded, true);
      assert.deepEqual(degraded.degradation, {
        feeds: { tracked: 1, failed: 1 },
        keys: { configured: 0, missing: EXPECTED_API_KEYS.length, total: EXPECTED_API_KEYS.length },
      });
      assert.equal(degraded.feeds[0].lastError, 'fixture-upstream-unavailable');
      for (const field of ['pid', 'port', 'uptime_ms', 'rss_mb', 'heap_mb', 'ais_vessels']) {
        assert.equal(typeof degraded[field], 'number', field);
      }
      assert.equal(degraded.keys_missing, undefined);

      recordFeedSuccess('fixture-feed');
      for (const key of EXPECTED_API_KEYS) process.env[key] = 'fixture-only-configured-key';
      const recovered = await (await fetch(`${base}/api/health`, { headers })).json();
      assert.equal(recovered.ok, true);
      assert.equal(recovered.degraded, false);
      assert.deepEqual(recovered.degradation, {
        feeds: { tracked: 1, failed: 0 },
        keys: { configured: EXPECTED_API_KEYS.length, missing: 0, total: EXPECTED_API_KEYS.length },
      });
    });
  } finally {
    for (const [key, value] of previousKeys) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
