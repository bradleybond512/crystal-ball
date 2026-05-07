/**
 * Sidecar tests for the /api/gdelt/events route.
 *
 * Two coverage layers:
 *   1. Pure unit tests for the inline sidecar parsers (kept duplicated
 *      from src/services/synthesis/gdelt-poller.ts for the .mjs runtime).
 *   2. Integration test that spins the sidecar on an ephemeral port,
 *      injects a cache via the test hook, and verifies GET returns the
 *      injected events.
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-gdelt-events';

import {
  __gdeltSetCacheForTests,
  createLocalApiServer,
  parseGdeltLastUpdateSidecar,
  pipelineGdeltCsvToCorpusSidecar,
} from '../local-api-server.mjs';

// ── Pure parser tests ──────────────────────────────────────────────────

function gdeltRow(overrides = {}) {
  const cols = Array.from({length: 61}).fill('');
  cols[0] = overrides.globalEventId ?? 'A';
  cols[1] = overrides.sqlDate ?? '20260505';
  cols[6] = overrides.actor1Name ?? '';
  cols[7] = overrides.actor1CountryCode ?? '';
  cols[16] = overrides.actor2Name ?? '';
  cols[26] = String(overrides.quadClass ?? 4);
  cols[30] = String(overrides.goldsteinScale ?? 0);
  cols[31] = String(overrides.numMentions ?? 0);
  cols[34] = '0';
  cols[53] = overrides.actionGeoFullName ?? '';
  cols[54] = overrides.actionGeoCountryCode ?? '';
  cols[56] = '0';
  cols[57] = '0';
  cols[60] = '';
  return cols.join('\t');
}

test('parseGdeltLastUpdateSidecar: extracts events URL', () => {
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- GDELT bulk feed is plain HTTP only
  const url = 'http://data.gdeltproject.org/gdeltv2/20260505000000.export.CSV.zip';
  const text = `12345 abcdef0123456789abcdef0123456789 ${url}`;
  const out = parseGdeltLastUpdateSidecar(text);
  assert.equal(out.url, url);
});

test('parseGdeltLastUpdateSidecar: returns null on empty input', () => {
  assert.equal(parseGdeltLastUpdateSidecar(''), null);
});

test('pipelineGdeltCsvToCorpusSidecar: filters QuadClass 3+4 with mentions ≥ 60', () => {
  const csv = [
    gdeltRow({ globalEventId: 'A', quadClass: 4, numMentions: 100 }),
    gdeltRow({ globalEventId: 'B', quadClass: 3, numMentions: 80 }),
    gdeltRow({ globalEventId: 'C', quadClass: 4, numMentions: 30 }),  // dropped
    gdeltRow({ globalEventId: 'D', quadClass: 1, numMentions: 100 }), // dropped
  ].join('\n');
  const out = pipelineGdeltCsvToCorpusSidecar(csv);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.id).sort(), ['gdelt-A', 'gdelt-B']);
});

test('pipelineGdeltCsvToCorpusSidecar: maps fields correctly', () => {
  const csv = gdeltRow({
    globalEventId: 'EID', quadClass: 4, numMentions: 250, goldsteinScale: -8,
    actor1Name: 'GOV', actor2Name: 'OPP',
    actionGeoFullName: 'Aleppo, Syria', actionGeoCountryCode: 'SY',
    sqlDate: '20260505',
  });
  const out = pipelineGdeltCsvToCorpusSidecar(csv);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'gdelt-EID');
  assert.equal(out[0].date, '2026-05-05');
  assert.equal(out[0].country, 'SY');
  assert.equal(out[0].location, 'Aleppo, Syria');
  assert.deepEqual(out[0].actors, ['GOV', 'OPP']);
  assert.equal(out[0].source, 'gdelt');
  assert.equal(out[0].intensity, 'critical');
  assert.equal(out[0].eventType, 'material-conflict');
});

test('pipelineGdeltCsvToCorpusSidecar: empty input → empty output', () => {
  assert.deepEqual(pipelineGdeltCsvToCorpusSidecar(''), []);
});

// ── Sidecar integration test ───────────────────────────────────────────

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

test('GET /api/gdelt/events returns injected cache without hitting network', async () => {
  __gdeltSetCacheForTests([
    { id: 'gdelt-X', date: '2026-05-05', location: 'Test', country: 'XX',
      eventType: 'material-conflict', actors: ['A'], intensity: 'high',
      summary: 'test event', source: 'gdelt' },
  ]);
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('GET', `${sidecar.base}/api/gdelt/events`);
    assert.equal(res.status, 200);
    assert.equal(res.body.available, true);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].id, 'gdelt-X');
    assert.equal(typeof res.body.asOf, 'number');
    assert.ok(res.body.asOf > 0);
  } finally {
    await sidecar.close();
  }
});

test('non-GET methods return 405', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/gdelt/events`);
    assert.equal(res.status, 405);
  } finally {
    await sidecar.close();
  }
});
