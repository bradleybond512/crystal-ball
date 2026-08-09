import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildEvidencePacket,
  verifyEvidencePacket,
  writeEvidencePacket,
} from '../evidence-packet.mjs';

const input = {
  generatedAt: '2026-07-31T12:00:00.000Z',
  query: { tool: 'get_sitrep', permissionCode: 'read_external' },
  result: {
    summary: 'Direct observations available.',
    sources: ['/api/nws-alerts'],
    timestamp: '2026-07-31T11:59:00.000Z',
    healthy: true,
    secret: 'must disappear',
  },
  capabilities: { missing: ['military'] },
  algorithms: { versions: { forecast: 'v4' }, quarantined: ['unsafe-demo'] },
};

test('Evidence Packet v1 is deterministic, redacted, and integrity protected', () => {
  const first = buildEvidencePacket(input);
  const second = buildEvidencePacket(input);
  assert.deepEqual(first, second);
  assert.equal(first.schema, 'crystalball.evidence-packet');
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.integrity.algorithm, 'sha256');
  assert.match(first.integrity.digest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes('must disappear'), false);
  assert.deepEqual(first.provenance.directSources, ['/api/nws-alerts']);
  assert.deepEqual(first.capabilities.missing, ['military']);
  assert.deepEqual(first.safeguards.quarantinedAlgorithms, ['unsafe-demo']);
  assert.equal(first.query.permission.code, 'read_external');
  assert.equal(verifyEvidencePacket(first), true);
  assert.equal(verifyEvidencePacket({
    ...first,
    observation: { ...first.observation, summary: 'tampered' },
  }), false);
});

test('Evidence Packet v1 rejects malformed and oversized inputs', () => {
  assert.throws(() => buildEvidencePacket(null), /object/i);
  assert.throws(() => buildEvidencePacket({ generatedAt: 'not-a-date', result: {} }), /generatedAt/i);
  assert.throws(() => buildEvidencePacket({
    generatedAt: '2026-07-31T12:00:00.000Z',
    result: { summary: 'x'.repeat(1_100_000) },
  }), /size/i);
});

test('Evidence Packet output is atomic and owner-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crystalball-evidence-'));
  const target = join(directory, 'packet.json');
  const packet = buildEvidencePacket(input);
  await writeEvidencePacket(target, packet);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), packet);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
});
