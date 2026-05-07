/**
 * Sidecar tests for /api/attack/groups + parseAttackBundleSidecar.
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-attack-groups';

import {
  __attackSetStateForTests,
  createLocalApiServer,
  parseAttackBundleSidecar,
} from '../local-api-server.mjs';

// ── parseAttackBundleSidecar ───────────────────────────────────────────

test('parseAttackBundleSidecar: rejects non-bundle', () => {
  assert.deepEqual(parseAttackBundleSidecar(null), []);
  assert.deepEqual(parseAttackBundleSidecar({}), []);
  assert.deepEqual(parseAttackBundleSidecar({ type: 'object', objects: [] }), []);
});

test('parseAttackBundleSidecar: extracts intrusion-set with G-code', () => {
  const bundle = {
    type: 'bundle',
    objects: [
      {
        type: 'intrusion-set',
        id: 'is-1',
        name: 'APT28',
        aliases: ['Sofacy', 'Fancy Bear', 'APT28'],
        external_references: [
          { source_name: 'mitre-attack', external_id: 'G0007' },
        ],
        x_mitre_attributed_to: 'Russia',
      },
    ],
  };
  const groups = parseAttackBundleSidecar(bundle);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'G0007');
  assert.equal(groups[0].name, 'APT28');
  assert.equal(groups[0].country, 'Russia');
  // Aliases dedupe + filter out the canonical name
  assert.deepEqual(groups[0].aliases.sort(), ['Fancy Bear', 'Sofacy']);
});

test('parseAttackBundleSidecar: skips revoked groups', () => {
  const bundle = {
    type: 'bundle',
    objects: [
      {
        type: 'intrusion-set', revoked: true,
        external_references: [{ source_name: 'mitre-attack', external_id: 'G0001' }],
      },
    ],
  };
  assert.equal(parseAttackBundleSidecar(bundle).length, 0);
});

test('parseAttackBundleSidecar: skips non-intrusion-set objects', () => {
  const bundle = {
    type: 'bundle',
    objects: [
      { type: 'attack-pattern', external_references: [{ source_name: 'mitre-attack', external_id: 'T1234' }] },
      { type: 'intrusion-set', external_references: [{ source_name: 'mitre-attack', external_id: 'G0099' }] },
    ],
  };
  assert.equal(parseAttackBundleSidecar(bundle).length, 1);
});

test('parseAttackBundleSidecar: skips intrusion-sets without G-code', () => {
  const bundle = {
    type: 'bundle',
    objects: [
      { type: 'intrusion-set', external_references: [] }, // no refs
      { type: 'intrusion-set', external_references: [{ source_name: 'other', external_id: 'X1' }] }, // wrong source
      { type: 'intrusion-set', external_references: [{ source_name: 'mitre-attack', external_id: 'T0001' }] }, // not G-code
    ],
  };
  assert.equal(parseAttackBundleSidecar(bundle).length, 0);
});

test('parseAttackBundleSidecar: missing x_mitre_attributed_to → Unknown', () => {
  const bundle = {
    type: 'bundle',
    objects: [
      {
        type: 'intrusion-set', name: 'X',
        external_references: [{ source_name: 'mitre-attack', external_id: 'G0001' }],
      },
    ],
  };
  const groups = parseAttackBundleSidecar(bundle);
  assert.equal(groups[0].country, 'Unknown');
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

test('GET /api/attack/groups returns injected state', async () => {
  __attackSetStateForTests([
    { id: 'G0007', name: 'APT28', aliases: ['Fancy Bear'], country: 'Russia',
      targetSectors: [], recentTechniques: [], activityScore: 0 },
  ]);
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('GET', `${sidecar.base}/api/attack/groups`);
    assert.equal(res.status, 200);
    assert.equal(res.body.groups.length, 1);
    assert.equal(res.body.groups[0].id, 'G0007');
    assert.equal(res.body.groupCount, 1);
    assert.equal(res.body.available, true);
    assert.equal(typeof res.body.lastFetchedAt, 'number');
  } finally {
    await sidecar.close();
  }
});

test('non-GET methods return 405', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/attack/groups`);
    assert.equal(res.status, 405);
  } finally {
    await sidecar.close();
  }
});
