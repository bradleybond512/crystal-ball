import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveScriptIndex, mergeOverrides, OVERRIDES, selectScripts } from '../scripts/targeted-tests.mjs';
import { runFixedSuite } from './helpers/mcp-suite-entry.mjs';

test('health contract and consumers run in owned offline fixtures with genuine inner TAP results', { timeout: 360_000 }, async (t) => {
  const results = await runFixedSuite('health-contract', t);
  assert.equal(results.length, 2);
});

test('health source and inner regression files select the eligible health contract suite', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  const declared = JSON.parse(readFileSync(new URL('../scripts/targeted-tests-overrides.json', import.meta.url), 'utf8'));
  const mapping = mergeOverrides(OVERRIDES, declared);
  const index = deriveScriptIndex(scripts);
  for (const file of [
    'src-tauri/sidecar/local-api-server.mjs',
    'tools/mcp-server/sidecar-client.mjs',
    'scripts/checkup.mjs', 'scripts/smoke.mts', 'scripts/sidecar-health-contract.mjs',
    'src/components/FeedHealthPanel.ts',
    'src/services/diagnostics/live-diagnostics-snapshot.ts',
    'tests/sidecar-health-runtime.test.mjs',
    'tests/components/feed-health-auth.test.mts',
    'scripts/sidecar-health-consumers.test.mjs',
  ]) {
    const selected = selectScripts([file], index, mapping);
    assert.ok(selected.scripts.includes('test:health-contract'), `${file} must execute health regressions`);
    assert.deepEqual(selected.unmapped, []);
  }
});
