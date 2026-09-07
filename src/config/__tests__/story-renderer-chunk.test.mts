import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

const loaded = await loadConfigFromFile(
  { command: 'build', mode: 'production' },
  path.resolve('vite.config.ts'),
);
assert.ok(loaded);
const output = loaded.config.build?.rollupOptions?.output;
assert.ok(output && !Array.isArray(output));
const manualChunks = output.manualChunks;
assert.equal(typeof manualChunks, 'function');
const chunkFor = (id: string) => (manualChunks as (id: string) => string | undefined)(id);

test('manual chunks gives the story renderer its own stable chunk name', () => {
  assert.equal(chunkFor('/repo/src/services/story-renderer.ts'), 'story-renderer');
});

test('story renderer chunk assignment excludes similarly named modules', () => {
  for (const id of [
    '/repo/src/services/story-renderer-helper.ts',
    '/repo/src/services/other-story-renderer.ts',
    '/repo/src/services/story-renderer.ts.backup',
    '/repo/src/components/story-renderer.ts',
    '/repo/src/services/story-data.ts',
    '/repo/src/services/i18n.ts',
  ]) {
    assert.equal(chunkFor(id), undefined, id);
  }
});

test('existing vendor and panel chunk assignments remain intact', () => {
  for (const [id, name] of [
    ['/repo/node_modules/i18next/dist/esm/i18next.js', 'i18n'],
    ['/repo/node_modules/maplibre-gl/dist/maplibre-gl.js', 'maplibre'],
    ['/repo/src/components/SystemDiagnosticPanel.ts', 'panels-diagnostic'],
    ['/repo/src/components/ForecastPanel.ts', 'panels-analysis'],
    ['/repo/src/components/CyberThreatIntelPanel.ts', 'panels-security'],
    ['/repo/src/components/MarketPanel.ts', 'panels-markets'],
  ]) {
    assert.equal(chunkFor(id!), name, id);
  }
});
