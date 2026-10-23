import assert from 'node:assert/strict';
import test from 'node:test';
import { createPwaManifestPaths } from '../src/config/pwa-manifest.ts';
import { validatePwaOutput } from '../scripts/check-pwa-output.mjs';

function html(base: string): string {
  return `<link rel="manifest" href="${base}manifest.webmanifest">
    <script type="module" src="${base}assets/index-test.js"></script>
    <noscript><h1>Crystal Ball needs JavaScript</h1><p>Enable JavaScript and reload this page.</p>
    <p>No live information is shown while JavaScript is disabled.</p></noscript>`;
}

for (const base of ['/', '/crystal-ball/']) {
  test(`output inspector accepts manifest and HTML paths at ${base}`, () => {
    assert.deepEqual(validatePwaOutput(createPwaManifestPaths(base), html(base), base), []);
  });
}

test('output inspector rejects each old root-bound manifest field in a subpath build', () => {
  const base = '/crystal-ball/';
  for (const key of ['start_url', 'scope', 'icons'] as const) {
    const manifest = { ...createPwaManifestPaths(base), [key]: createPwaManifestPaths('/')[key] };
    assert.equal(validatePwaOutput(manifest, html(base), base).length, 1, key);
  }
});

test('output inspector compares icon values independently of JSON property order', () => {
  const base = '/crystal-ball/';
  const manifest = createPwaManifestPaths(base);
  manifest.icons = manifest.icons.map(({ src, sizes, type, purpose }) => ({ purpose, type, sizes, src }));
  // JSON serialization omits undefined purpose on ordinary icons, just as Vite does.
  assert.deepEqual(validatePwaOutput(JSON.parse(JSON.stringify(manifest)), html(base), base), []);
});

test('output inspector rejects wrong manifest/module links and missing noscript content', () => {
  const base = '/crystal-ball/';
  const manifest = createPwaManifestPaths(base);
  assert.deepEqual(validatePwaOutput(manifest, html('/'), base), [
    'HTML manifest link does not match deployment base',
    'HTML module entry does not match deployment base',
  ]);
  assert.deepEqual(validatePwaOutput(manifest, html(base).replace(/<noscript>[\s\S]*<\/noscript>/, ''), base), [
    'HTML lacks the static JavaScript-disabled explanation',
  ]);
});
