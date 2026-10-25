import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const sourceRoot = path.join(targetRoot, 'source');
  for (const dir of ['tools/mcp-server', 'src/config', 'config']) mkdirSync(path.join(sourceRoot, dir), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({ version: '2.7.2' }));
  writeFileSync(path.join(sourceRoot, 'tools/mcp-server/package.json'), JSON.stringify({ version: '0.3.0' }));
  writeFileSync(path.join(sourceRoot, 'tools/mcp-server/tool-catalog.mjs'), `export const TOOL_CATALOG = {
    fixture_read: { annotations: { readOnlyHint: true } },
    fixture_write: { annotations: { readOnlyHint: false } },
  };`);
  writeFileSync(path.join(sourceRoot, 'src/config/panels.ts'), `const FULL_PANELS = { full: {} };
    const TECH_PANELS = { tech: {} }; const FINANCE_PANELS = { finance: {} }; const HAPPY_PANELS = { happy: {} };`);
  writeFileSync(path.join(sourceRoot, 'config/release-features.json'), JSON.stringify({ schemaVersion: 1, features: [
    { id: 'fixture-desktop', component: 'desktop', minimumVersion: '2.7.2', sourcePaths: ['src/config/panels.ts'] },
    { id: 'fixture-companion', component: 'companion', minimumVersion: null, sourcePaths: ['tools/mcp-server/tool-catalog.mjs'] },
  ] }));
  const bundleRoot = path.join(targetRoot, 'aarch64-apple-darwin', 'release', 'bundle');
  const dmgPath = path.join(bundleRoot, 'dmg', 'Tech.Monitor_2.7.2_aarch64.dmg');
  mkdirSync(path.dirname(dmgPath), { recursive: true });
  writeFileSync(dmgPath, 'measured bytes');
  const sha256 = createHash('sha256').update('measured bytes').digest('hex');
  const options = { targetRoot, repoRoot: sourceRoot, version: '2.7.2', variant: 'tech', tag: 'v2.7.2-tech', commitSha: 'abc', platform: 'macOS-ARM64', builtAfter: 123 };
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
  const { deriveReleaseCapabilities } = await import('../scripts/release-capabilities.mjs');
  assert.deepEqual(JSON.parse(JSON.stringify(result)).capabilities,
    await deriveReleaseCapabilities({ repoRoot: sourceRoot, version: '2.7.2', commitSha: 'abc', variant: 'tech' }));
  assert.equal(result.capabilities.components.desktop.variant, 'tech');
  assert.equal(result.capabilities.sourceCommit, 'abc');
  assert.deepEqual(result.capabilities.components.companion.toolCounts, { total: 2, read: 1, analystAdditional: 1 });
  assert.equal(result.capabilities.components.companion.bundled, false);
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
const baseManifest = {
  version: '2.25.148', variant: 'full', tag: 'v2.25.148', commitSha: 'abc',
  generatedAt: '2026-10-19T00:00:00.000Z',
  assets: [{ name: 'Crystal Ball_2.25.148_amd64.AppImage', sha256: 'a'.repeat(64), size: 1 }],
};
const secondManifest = { ...baseManifest, assets: [{ name: 'Crystal Ball_2.25.148_amd64.deb', sha256: 'b'.repeat(64), size: 2 }] };
const capabilities = {
  schemaVersion: 1, sourceCommit: 'abc', sourceCatalogs: { panels: { full: 409, tech: 35, finance: 31, happy: 10 } },
  components: { companion: { bundled: false, version: '0.3.0', toolCounts: { total: 61, read: 53, analystAdditional: 8 } } },
};

test('combine retains capabilities across JSON roundtrip and accepts legacy manifests', () => {
  const manifests = [structuredClone({ ...baseManifest, capabilities }), JSON.parse(JSON.stringify({ ...secondManifest, capabilities }))];
  assert.deepEqual(JSON.parse(JSON.stringify(combineReleaseManifests(manifests))).capabilities, capabilities);
  assert.equal(Object.hasOwn(combineReleaseManifests([baseManifest, secondManifest]), 'capabilities'), false);
});

test('capabilities do not bypass release asset or variant identity checks', () => {
  assert.throws(() => combineReleaseManifests([{ ...baseManifest, capabilities, assets: [] }]), /requires a tag and release assets/);
  assert.throws(() => combineReleaseManifests([{ ...baseManifest, capabilities, variant: 'tech' }]), /identity|tag/);
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
  await copyFile(new URL('../scripts/release-metadata.mjs', import.meta.url), path.join(dir, 'release-metadata.mjs'));
  for (const absent of ['release-capabilities.mjs', 'check-desktop-identity.mjs', 'node_modules', 'config', 'tools']) {
    assert.equal(existsSync(path.join(dir, absent)), false);
  }
  const module = await import(pathToFileURL(standalone).href);
  assert.deepEqual(module.combineReleaseManifests([{ ...baseManifest, capabilities }]).capabilities, capabilities);
  assert.deepEqual(module.verifyDownloadedAssets({ assets: [] }, []), []);
  const isolated = module.combineReleaseManifests([{ ...baseManifest, capabilities }]);
  assert.deepEqual(JSON.parse(JSON.stringify(isolated)).capabilities, capabilities);
  assert.deepEqual(module.verifyDownloadedAssets(isolated, ['/tmp/' + baseManifest.assets[0].name]), []);
  assert.throws(() => module.combineReleaseManifests([{ ...baseManifest, capabilities, tag: 'v2.25.148-tech' }]), /identity|tag/);
  assert.throws(() => module.combineReleaseManifests([{ ...techManifest(), capabilities, assets: techManifest().assets.map(asset => ({ ...asset, nativeIdentity: { ...asset.nativeIdentity, version: '2.7.1' } })) }]), /identity/);
  assert.throws(() => module.combineReleaseManifests([{ ...baseManifest, capabilities, assets: [] }]), /requires a tag and release assets/);
});
