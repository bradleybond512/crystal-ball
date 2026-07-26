import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

const configFile = path.resolve('vite.config.ts');
const configSource = readFileSync(configFile, 'utf8');
const indexSource = readFileSync(path.resolve('index.html'), 'utf8');

async function loadBuildConfig() {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    configFile,
  );
  assert.ok(loaded);
  return loaded.config;
}

test('vite config compiles the requested product variant', async () => {
  const previous = process.env.VITE_VARIANT;
  process.env.VITE_VARIANT = 'tech';

  try {
    const config = await loadBuildConfig();
    assert.equal(config.define?.__BUILD_VARIANT__, JSON.stringify('tech'));
  } finally {
    if (previous === undefined) delete process.env.VITE_VARIANT;
    else process.env.VITE_VARIANT = previous;
  }
});

test('vite config rejects unknown product variants', async () => {
  const previous = process.env.VITE_VARIANT;
  process.env.VITE_VARIANT = 'unknown';

  try {
    await assert.rejects(
      loadBuildConfig(),
      /Unsupported VITE_VARIANT/,
    );
  } finally {
    if (previous === undefined) delete process.env.VITE_VARIANT;
    else process.env.VITE_VARIANT = previous;
  }
});

test('PWA precache excludes generated vault frame sheets', () => {
  assert.match(configSource, /globIgnores:[^\n]*vault-\*-frames\*\.png/);
});

test('public metadata avoids hand-maintained panel and layer counts', () => {
  assert.doesNotMatch(indexSource, /\b\d+\s+(?:interactive\s+)?(?:panels|geospatial(?: 3D globe)? layers)\b/i);
});
