import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  combineReleaseManifests,
  isReleaseArtifactName,
  verifyDownloadedAssets,
  assertManifestIdentity,
  collectReleaseArtifacts,
} from '../scripts/release-manifest.mjs';

test('release manifest only accepts versioned distributable filenames', () => {
  assert.equal(isReleaseArtifactName('Crystal Ball_2.7.2_aarch64.dmg', '2.7.2'), true);
  assert.equal(isReleaseArtifactName('Crystal Ball.app', '2.7.2'), false);
  assert.equal(isReleaseArtifactName('notes.txt', '2.7.2'), false);
});

function techManifest() {
  return {
    version: '2.7.2', variant: 'tech', tag: 'v2.7.2-tech', commitSha: 'abc',
    assets: [{
      name: 'Tech.Monitor_2.7.2_aarch64.dmg', sha256: 'a'.repeat(64), size: 1,
      nativeIdentity: { productName: 'Tech Monitor', identifier: 'com.bradleybond.crystalball.tech', version: '2.7.2' },
    }],
  };
}

test('manifest identity requires tag suffix, artifact product and measured native ID/version to agree', () => {
  assert.equal(assertManifestIdentity(techManifest()).identifier, 'com.bradleybond.crystalball.tech');
  const mutations = [
    manifest => { manifest.tag = 'v2.7.2-finance'; },
    manifest => { manifest.tag = ''; },
    manifest => { delete manifest.variant; },
    manifest => { manifest.assets[0].name = 'Crystal Ball_2.7.2_aarch64.dmg'; },
    manifest => { manifest.assets[0].name = 'CrystalBall_2.7.2_aarch64.dmg'; },
    manifest => { manifest.assets[0].nativeIdentity.identifier = 'com.bradleybond.crystalball'; },
    manifest => { manifest.assets[0].nativeIdentity.version = '2.7.1'; },
    manifest => { delete manifest.assets[0].nativeIdentity; },
  ];
  for (const mutate of mutations) {
    const manifest = techManifest();
    mutate(manifest);
    assert.throws(() => assertManifestIdentity(manifest), /identity|requires a tag/);
    assert.throws(() => combineReleaseManifests([manifest]), /identity|requires a tag/);
  }
});

test('macOS collection binds the measured mounted payload to the collected artifact bytes', async t => {
  const targetRoot = mkdtempSync(path.join(os.tmpdir(), 'release-identity-test-'));
  t.after(() => rmSync(targetRoot, { recursive: true, force: true }));
  const bundleRoot = path.join(targetRoot, 'aarch64-apple-darwin', 'release', 'bundle');
  const dmgPath = path.join(bundleRoot, 'dmg', 'Tech.Monitor_2.7.2_aarch64.dmg');
  mkdirSync(path.dirname(dmgPath), { recursive: true });
  writeFileSync(dmgPath, 'measured bytes');
  const sha256 = createHash('sha256').update('measured bytes').digest('hex');
  const options = { targetRoot, version: '2.7.2', variant: 'tech', tag: 'v2.7.2-tech', commitSha: 'abc', platform: 'macOS-ARM64', builtAfter: 123 };
  let called = 0;
  const verifyNativeBundle = observed => {
    called++;
    assert.equal(observed.bundleRoot, bundleRoot);
    assert.equal(observed.variant, 'tech');
    assert.equal(observed.includeDmg, true);
    assert.equal(observed.builtAfter, 123);
    return { dmgs: [{ path: dmgPath, sha256, nativeIdentity: techManifest().assets[0].nativeIdentity }] };
  };
  const result = await collectReleaseArtifacts({ ...options, verifyNativeBundle });
  assert.equal(called, 1);
  assert.equal(result.assets[0].sha256, sha256);
  assert.equal(result.assets[0].nativeIdentity.identifier, 'com.bradleybond.crystalball.tech');
  writeFileSync(dmgPath, 'replacement bytes');
  await assert.rejects(collectReleaseArtifacts({ ...options, verifyNativeBundle }), /changed after native identity/);
  await assert.rejects(collectReleaseArtifacts({ ...options, verifyNativeBundle: () => ({ dmgs: [] }) }), /Unverified macOS/);
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

test('tech and finance asset download normalization preserves each variant identity', () => {
  for (const productName of ['Tech Monitor', 'Finance Monitor']) {
    assert.deepEqual(verifyDownloadedAssets(
      { assets: [{ name: productName + '_2.7.3_x64.dmg' }] },
      ['/tmp/' + productName.replaceAll(' ', '.') + '_2.7.3_x64.dmg'],
    ), []);
  }
});
