import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
