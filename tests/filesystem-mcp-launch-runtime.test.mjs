import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const own = new URL('../.github/tools/filesystem-mcp/', import.meta.url);

test('trusted runtime manifest requires exact version platform schema and digest identities', async () => {
  const { validateRuntimeManifest } = await import(new URL('launch-trust.mjs', own));
  const manifest = JSON.parse(readFileSync(new URL('runtime-manifest.json', own), 'utf8'));
  assert.doesNotThrow(() => validateRuntimeManifest(manifest));
  for (const mutation of [
    { schemaVersion: 2 }, { nodeVersion: '24.22.1' }, { packageVersion: 'latest' },
    { platform: 'linux' }, { arch: 'x64' }, { contentManifestSha256: '0' },
    { runtimeSha256: 'X'.repeat(64) }, { packageSha256: '' }, { lockSha256: null }, { override: '/untrusted' },
  ]) assert.throws(() => validateRuntimeManifest({ ...manifest, ...mutation }));
});

test('trusted content manifest and package lock identities are checked before launch planning', async () => {
  const { validateTrustedBytes } = await import(new URL('launch-trust.mjs', own));
  const runtime = JSON.parse(readFileSync(new URL('runtime-manifest.json', own), 'utf8'));
  const content = readFileSync(new URL('content-manifest.json', own));
  const pkg = readFileSync(new URL('package.json', own)), lock = readFileSync(new URL('package-lock.json', own));
  assert.doesNotThrow(() => validateTrustedBytes(runtime, content, pkg, lock));
  for (const values of [[Buffer.concat([content, Buffer.from(' ')]), pkg, lock],
    [content, Buffer.concat([pkg, Buffer.from(' ')]), lock],
    [content, pkg, Buffer.concat([lock, Buffer.from(' ')])]]) {
    assert.throws(() => validateTrustedBytes(runtime, ...values), /identity|digest|hash/i);
  }
});
