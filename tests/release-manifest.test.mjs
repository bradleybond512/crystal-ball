import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineReleaseManifests,
  isReleaseArtifactName,
  verifyDownloadedAssets,
} from '../scripts/release-manifest.mjs';

test('release manifest only accepts versioned distributable filenames', () => {
  assert.equal(isReleaseArtifactName('Crystal Ball_2.7.2_aarch64.dmg', '2.7.2'), true);
  assert.equal(isReleaseArtifactName('Crystal Ball.app', '2.7.2'), false);
  assert.equal(isReleaseArtifactName('notes.txt', '2.7.2'), false);
});

test('release manifest combine rejects duplicate asset names across platforms', () => {
  assert.throws(
 () => combineReleaseManifests([
 {
 version: '2.7.2',
 variant: 'full',
 tag: 'v2.7.2',
 commitSha: 'abc',
 generatedAt: '2026-03-17T00:00:00.000Z',
 assets: [{ name: 'Crystal Ball_2.7.2_aarch64.dmg', sha256: '1', size: 1 }],
 },
 {
 version: '2.7.2',
 variant: 'full',
 tag: 'v2.7.2',
 commitSha: 'abc',
 generatedAt: '2026-03-17T00:00:00.000Z',
 assets: [{ name: 'Crystal Ball_2.7.2_aarch64.dmg', sha256: '2', size: 2 }],
 },
 ]),
 /Duplicate asset names/,
  );
});

test('release manifest verification reports missing and unexpected assets', () => {
  assert.deepEqual(
 verifyDownloadedAssets(
 {
 assets: [{ name: 'Crystal Ball_2.7.2_aarch64.dmg' }],
 },
 ['/tmp/Crystal Ball_2.7.2_aarch64.dmg', '/tmp/unexpected.txt'],
 ),
 ['Unexpected release asset: unexpected.txt'],
  );
});

test('release manifest verification treats dot-vs-space app names as equivalent', () => {
  assert.deepEqual(
 verifyDownloadedAssets(
 {
 assets: [{ name: 'Crystal Ball_2.7.3_x64.dmg' }],
 },
 ['/tmp/Crystal.Ball_2.7.3_x64.dmg'],
 ),
 [],
  );
});

const baseManifest = {
  version: '2.25.148', variant: 'full', tag: 'v2.25.148', commitSha: 'abc',
  generatedAt: '2026-10-19T00:00:00.000Z', assets: [],
};
const capabilities = {
  schemaVersion: 1, sourceCommit: 'abc', sourceCatalogs: { panels: { full: 409, tech: 35, finance: 31, happy: 10 } },
  components: { companion: { bundled: false, version: '0.3.0', toolCounts: { total: 61, read: 53, analystAdditional: 8 } } },
};

test('combine retains capabilities across JSON roundtrip and accepts legacy manifests', () => {
  const manifests = [structuredClone({ ...baseManifest, capabilities }), JSON.parse(JSON.stringify({ ...baseManifest, capabilities }))];
  assert.deepEqual(JSON.parse(JSON.stringify(combineReleaseManifests(manifests))).capabilities, capabilities);
  assert.equal(Object.hasOwn(combineReleaseManifests([baseManifest, baseManifest]), 'capabilities'), false);
});

test('combine rejects conflicting or partially absent capability metadata in either order', () => {
  const withCapabilities = { ...baseManifest, capabilities };
  const changed = structuredClone(withCapabilities);
  changed.capabilities.components.companion.toolCounts.total += 1;
  for (const pair of [[withCapabilities, changed], [withCapabilities, baseManifest], [baseManifest, withCapabilities]]) {
    assert.throws(() => combineReleaseManifests(pair), /capabilit.*mismatch|mismatch.*capabilit/i);
  }
});

test('combine and verify remain usable without the derivation module or npm dependencies', async (t) => {
  const { mkdtemp, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'release-no-deps-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const standalone = path.join(dir, 'release-manifest.mjs');
  await copyFile(new URL('../scripts/release-manifest.mjs', import.meta.url), standalone);
  const module = await import(pathToFileURL(standalone).href);
  assert.deepEqual(module.combineReleaseManifests([{ ...baseManifest, capabilities }]).capabilities, capabilities);
  assert.deepEqual(module.verifyDownloadedAssets({ assets: [] }, []), []);
});
