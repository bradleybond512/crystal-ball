import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.LOCAL_API_TOKEN ??= 'test-token-webcam-health';

import { deriveWebcamSourceHealth } from '../local-api-server.mjs';

const KEYED = new Set(['WINDY', 'NPS']);
const NOW = 1_750_000_000;

const bySource = (health, src) => health.find((h) => h.source === src);

const SIDECAR_PATH = fileURLToPath(new URL('../local-api-server.mjs', import.meta.url));

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForSidecar(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // The process may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sidecar did not start on port ${port}`);
}

async function waitForPortFile(portFile) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const port = Number(await readFile(portFile, 'utf8'));
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // The sidecar writes the file after it has successfully bound.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sidecar did not publish a port to ${portFile}`);
}

// Fixtures mirror what the real /api/webcams aggregator now produces: successful
// sources resolve to a feed array, failed sources REJECT (the mapper throws), with
// the same messages the aggregator throws ("missing key (HTTP 503)" / "HTTP 429" / …).
const targets = [
  { source: 'FAA', path: '/api/faa-cameras', shape: 'cameras-bare' },
  { source: 'WINDY', path: '/api/webcams/windy', shape: 'feeds' },
  { source: 'NPS', path: '/api/webcams/nps', shape: 'feeds' },
  { source: 'USGS_VOLCANO', path: '/api/webcams/volcano', shape: 'feeds' },
  { source: 'USGS_STREAM', path: '/api/webcams/streamgauge', shape: 'feeds' },
  { source: 'ALERTWILDFIRE', path: '/api/webcams/fire', shape: 'feeds' },
  { source: 'NOAA_COASTAL', path: '/api/webcams/coastal', shape: 'feeds' },
];

const settled = [
  { status: 'fulfilled', value: [{ id: 'faa1' }, { id: 'faa2' }] },
  // missing WINDY key → /api/webcams/windy returns 503 {requiresKey:true}; aggregator throws this.
  { status: 'rejected', reason: new Error('missing key (HTTP 503)') },
  // keyed source answering a bare 403 → still a key problem.
  { status: 'rejected', reason: new Error('HTTP 403') },
  // NON-keyed source with a 401 must be 'down', NOT 'missing_key' (the needsKey guard).
  { status: 'rejected', reason: new Error('HTTP 401 unauthorized') },
  { status: 'rejected', reason: new Error('HTTP 429') },
  { status: 'fulfilled', value: [] },
  { status: 'rejected', reason: new Error('HTTP 500') },
];

const health = deriveWebcamSourceHealth(targets, settled, KEYED, NOW);

test('FAA fulfilled[2] → ok, count 2', () => {
  const h = bySource(health, 'FAA');
  assert.equal(h.status, 'ok');
  assert.equal(h.count, 2);
  assert.equal(h.needsKey, false);
  assert.equal(h.lastChecked, NOW);
});

test('WINDY missing-key 503 → missing_key (the production path that drives the CTA)', () => {
  const h = bySource(health, 'WINDY');
  assert.equal(h.status, 'missing_key');
  assert.equal(h.needsKey, true);
  assert.match(h.error, /missing key/i);
});

test('keyed source bare 403 → missing_key', () => {
  assert.equal(bySource(health, 'NPS').status, 'missing_key');
});

test('non-keyed source 401 → down, NOT missing_key (needsKey guard)', () => {
  const h = bySource(health, 'USGS_VOLCANO');
  assert.equal(h.status, 'down');
  assert.equal(h.needsKey, false);
});

test('429 → rate_limited', () => {
  assert.equal(bySource(health, 'USGS_STREAM').status, 'rate_limited');
});

test('fulfilled[] → empty', () => {
  assert.equal(bySource(health, 'ALERTWILDFIRE').status, 'empty');
});

test('non-keyed 5xx → down', () => {
  assert.equal(bySource(health, 'NOAA_COASTAL').status, 'down');
});

test('one row per source (no duplicate source rows)', () => {
  const sources = health.map((h) => h.source);
  assert.equal(new Set(sources).size, sources.length);
});

// DOT511 exposes two subroutes — health must collapse to a single row.
test('duplicate DOT511 subroutes merge: feeds win, counts sum', () => {
  const dotTargets = [
    { source: 'DOT511', path: '/api/dot-traffic-cams', shape: 'cameras' },
    { source: 'DOT511', path: '/api/webcams/dot-extended', shape: 'feeds' },
  ];
  const dotSettled = [
    { status: 'fulfilled', value: [{ id: 'd1' }, { id: 'd2' }] },
    { status: 'rejected', reason: new Error('HTTP 500') },
  ];
  const merged = deriveWebcamSourceHealth(dotTargets, dotSettled, KEYED, NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'DOT511');
  assert.equal(merged[0].status, 'ok'); // any-feeds wins over a failed sibling
  assert.equal(merged[0].count, 2);
});

test('duplicate DOT511 both failing merge to the most actionable failure', () => {
  const dotTargets = [
    { source: 'DOT511', path: '/api/dot-traffic-cams', shape: 'cameras' },
    { source: 'DOT511', path: '/api/webcams/dot-extended', shape: 'feeds' },
  ];
  const dotSettled = [
    { status: 'fulfilled', value: [] }, // empty
    { status: 'rejected', reason: new Error('HTTP 500') }, // down
  ];
  const merged = deriveWebcamSourceHealth(dotTargets, dotSettled, KEYED, NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'down'); // down is more actionable than empty
});

test('master aggregator self-calls use LOCAL_API_PORT', async (t) => {
  const port = await findFreePort();
  const token = 'webcam-self-port-token';
  const dataDir = await mkdtemp(path.join(tmpdir(), 'crystalball-webcam-port-'));
  const child = spawn(process.execPath, [SIDECAR_PATH], {
    env: {
      ...process.env,
      CB_SIDECAR_FILE_LOG: '0',
      LOCAL_API_CLOUD_FALLBACK: 'false',
      LOCAL_API_DATA_DIR: dataDir,
      LOCAL_API_PORT: String(port),
      LOCAL_API_RESOURCE_DIR: process.cwd(),
      LOCAL_API_TOKEN: token,
      WINDY_WEBCAMS_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForSidecar(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/webcams?source=WINDY`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.sourceHealth?.[0]?.status, 'missing_key');
  assert.equal(body.sourceHealth?.[0]?.error, 'missing key (HTTP 503)');
});

test('master aggregator self-calls stay on the bound port after a collision', async (t) => {
  let leakedAuthorization;
  const occupiedServer = http.createServer((request, response) => {
    leakedAuthorization = request.headers.authorization;
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
  });
  await new Promise((resolve, reject) => {
    occupiedServer.once('error', reject);
    occupiedServer.listen(0, '127.0.0.1', resolve);
  });
  const address = occupiedServer.address();
  const requestedPort = typeof address === 'object' && address ? address.port : 0;
  const token = 'webcam-collision-token';
  const dataDir = await mkdtemp(path.join(tmpdir(), 'crystalball-webcam-collision-'));
  const portFile = path.join(dataDir, 'sidecar.port');
  const child = spawn(process.execPath, [SIDECAR_PATH], {
    env: {
      ...process.env,
      CB_SIDECAR_FILE_LOG: '0',
      LOCAL_API_CLOUD_FALLBACK: 'false',
      LOCAL_API_DATA_DIR: dataDir,
      LOCAL_API_PORT: String(requestedPort),
      LOCAL_API_PORT_FILE: portFile,
      LOCAL_API_RESOURCE_DIR: process.cwd(),
      LOCAL_API_TOKEN: token,
      WINDY_WEBCAMS_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve, reject) => occupiedServer.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  const boundPort = await waitForPortFile(portFile);
  assert.notEqual(boundPort, requestedPort);
  await waitForSidecar(boundPort);
  const response = await fetch(`http://127.0.0.1:${boundPort}/api/webcams?source=WINDY`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.sourceHealth?.[0]?.error, 'missing key (HTTP 503)');
  assert.equal(leakedAuthorization, undefined);
});
