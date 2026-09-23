import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const policyPath = path.join(repoRoot, 'scripts', 'bundle-budget-policy.mjs');

test('bundle budget policy resolves exact manifest chunk names independent of entry order', async () => {
  assert.equal(
    existsSync(policyPath),
    true,
    'bundle budget policy module should provide manifest-based chunk resolution',
  );

  const { resolveManifestChunkFile } = await import(pathToFileURL(policyPath).href);
  const manifest = {
    '_panels-security.js': { file: 'assets/panels-security-AAAA1111.js', name: 'panels-security' },
    '_panels.js': { file: 'assets/panels-BBBB2222.js', name: 'panels' },
    '_panels-analysis.js': { file: 'assets/panels-analysis-CCCC3333.js', name: 'panels-analysis' },
  };

  assert.equal(resolveManifestChunkFile(manifest, 'panels'), 'assets/panels-BBBB2222.js');
  assert.equal(
    resolveManifestChunkFile(Object.fromEntries(Object.entries(manifest).reverse()), 'panels'),
    'assets/panels-BBBB2222.js',
  );
});

test('bundle budget policy rejects missing and duplicate exact manifest names', async () => {
  assert.equal(existsSync(policyPath), true);
  const { resolveManifestChunkFile } = await import(pathToFileURL(policyPath).href);

  assert.throws(
    () => resolveManifestChunkFile({ other: { file: 'assets/panels-AAAA1111.js', name: 'other' } }, 'panels'),
    /exactly one manifest chunk named "panels"; found 0/,
  );
  assert.throws(
    () => resolveManifestChunkFile({
      first: { file: 'assets/one.js', name: 'panels' },
      second: { file: 'assets/two.js', name: 'panels' },
    }, 'panels'),
    /exactly one manifest chunk named "panels"; found 2/,
  );
});

test('bundle CLI rejects an eager preload regression while all other size caps still pass', { timeout: 30_000 }, () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'bundle-eager-budget-'));
  try {
    mkdirSync(path.join(fixture, 'scripts'));
    const assetsDir = path.join(fixture, 'dist', 'assets');
    mkdirSync(assetsDir, { recursive: true });
    copyFileSync(path.join(repoRoot, 'scripts', 'check-bundle-size.mjs'), path.join(fixture, 'scripts', 'check-bundle-size.mjs'));
    const entry = Buffer.from('export const ready = true;\n');
    const assets = new Map([['main-fixture.js', entry]]);
    for (let chunk = 1; chunk <= 4; chunk++) {
      const bytes = Buffer.alloc(800 * 1024);
      let state = chunk;
      for (let index = 0; index < bytes.length; index++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[index] = state & 255;
      }
      assets.set(`payload-${chunk}.js`, Buffer.from(`export default ${JSON.stringify(bytes.toString('base64'))};\n`));
    }
    const gzipSizes = [...assets.values()].map(value => gzipSync(value).length);
    assert.ok(gzipSizes[0] < 460 * 1024, 'entry must stay below its independent cap');
    assert.ok(gzipSizes.slice(1).every(size => size > 760 * 1024 && size < 900 * 1024), 'payloads must be near 800 KiB and below the 1200 KiB chunk cap');
    const total = gzipSizes.reduce((sum, size) => sum + size, 0);
    assert.ok(total < 6 * 1024 * 1024, 'all assets must stay below the total cap');
    assert.ok(total - gzipSizes[4] < 2.85 * 1024 * 1024, 'three preloads must fit the eager cap');
    assert.ok(total > 2.85 * 1024 * 1024, 'four preloads must exceed only the eager cap');
    for (const [name, content] of assets) writeFileSync(path.join(assetsDir, name), content);
    const hashes = () => [...assets.keys()].map(name => createHash('sha256').update(readFileSync(path.join(assetsDir, name))).digest('hex'));
    const initialHashes = hashes();
    const threePreloads = '<script type="module" src="/assets/main-fixture.js"></script>\n'
      + [1, 2, 3].map(chunk => `<link rel="modulepreload" href="/assets/payload-${chunk}.js">`).join('\n');
    const htmlPath = path.join(fixture, 'dist', 'index.html');
    writeFileSync(htmlPath, threePreloads);
    const check = () => spawnSync(process.execPath, ['scripts/check-bundle-size.mjs'], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const below = check();
    assert.ifError(below.error);
    assert.equal(below.status, 0, below.stdout + below.stderr);
    assert.match(below.stdout, /eager:.*\/ 2\.85 MB.*\(4 chunks,/);
    assert.match(below.stdout, /All bundle-size policies satisfied/);

    writeFileSync(htmlPath, threePreloads + '\n<link rel="modulepreload" href="/assets/payload-4.js">');
    assert.deepEqual(hashes(), initialHashes, 'preloading must not change any asset bytes');
    const above = check();
    assert.ifError(above.error);
    assert.equal(above.status, 1, `Only the eager path grew: ${above.stdout}${above.stderr}`);
    assert.match(above.stdout, /eager:.*\/ 2\.85 MB.*\(5 chunks,/);
    const violations = above.stderr.split('\n').filter(line => line.startsWith('  - '));
    assert.equal(violations.length, 1, above.stderr);
    assert.match(violations[0], /Eager startup JS .* > 2\.85 MB budget across 5 chunk\(s\)/);
    assert.deepEqual(hashes(), initialHashes, 'the checker must leave assets unchanged');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
