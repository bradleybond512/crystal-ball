import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { runFixedSuite, SUITE_STAGES } from './helpers/mcp-suite-entry.mjs';
import { deriveScriptIndex, mergeOverrides, OVERRIDES, selectScripts } from '../scripts/targeted-tests.mjs';

const EXPECTED_STAGES = [
  ['--test', 'api/_cors.test.mjs', 'api/_api-key.test.mjs', 'api/youtube/embed.test.mjs', 'api/og-story.test.mjs', 'api/story-retirement.test.mjs', 'scripts/ais-relay-cors.test.cjs', 'tests/csp-allowlist.test.mjs', 'tests/key-compare-hardening.test.mjs', 'api/grid-outages.test.mjs', 'api/local-logistics.test.mjs', 'api/usgs-water-proxy.test.mjs'],
  ['--import', 'tsx', '--test', 'src/services/__tests__/runtime-fetch-fallback.test.mts', 'src/services/__tests__/fetch-attribution.test.mts', 'src/services/__tests__/story-share.test.mts', 'tests/server-cors-retirement.test.mts'],
  ['--import', 'tsx', '--import', './tests/panels/register-hook.mjs', '--test', 'src/components/__tests__/story-modal-sharing.test.mts', 'src/components/__tests__/retired-domain-panels.test.mts'],
  ['--test', 'src-tauri/sidecar/local-api-server.test.mjs', 'src-tauri/sidecar/sidecar-cors.test.mjs', 'src-tauri/sidecar/__tests__/intel-expansion-cluster3.test.mjs'],
];

const WIRED_FILES = [
  'api/_api-key.js',
  'api/_api-key.test.mjs',
  'api/_cors.js',
  'api/_cors.test.mjs',
  'api/fwdstart.js',
  'api/grid-outages.test.mjs',
  'api/local-logistics.test.mjs',
  'api/og-story.js',
  'api/og-story.test.mjs',
  'api/story-retirement.test.mjs',
  'api/story.js',
  'api/usgs-water-proxy.test.mjs',
  'api/youtube/embed.js',
  'api/youtube/embed.test.mjs',
  'index.html',
  'middleware.ts',
  'package.json',
  'scripts/ais-relay-cors.test.cjs',
  'scripts/ais-relay.cjs',
  'server/cors.ts',
  'server/crystalball/news/v1/_shared.ts',
  'src-tauri/sidecar/__tests__/intel-expansion-cluster3.test.mjs',
  'src-tauri/sidecar/local-api-server.mjs',
  'src-tauri/sidecar/local-api-server.test.mjs',
  'src-tauri/sidecar/sidecar-cors.test.mjs',
  'src-tauri/tauri.conf.json',
  'src/components/LiveNewsPanel.ts',
  'src/components/ServiceStatusPanel.ts',
  'src/components/StoryModal.ts',
  'src/components/__tests__/retired-domain-panels.test.mts',
  'src/components/__tests__/story-modal-sharing.test.mts',
  'src/main.ts',
  'src/services/__tests__/fetch-attribution.test.mts',
  'src/services/__tests__/runtime-fetch-fallback.test.mts',
  'src/services/__tests__/story-share.test.mts',
  'src/services/happy-share-renderer.ts',
  'src/services/runtime-config.ts',
  'src/services/runtime.ts',
  'src/services/settings-constants.ts',
  'src/services/story-renderer.ts',
  'src/services/story-share.ts',
  'tests/csp-allowlist.test.mjs',
  'tests/key-compare-hardening.test.mjs',
  'tests/panels/stubs/i18n-stub.mjs',
  'tests/server-cors-retirement.test.mts',
  'tools/littlesnitch/crystal-ball.lsrules',
  'vite.config.ts',
  'tests/retired-domain-suite.test.mjs',
  'tests/helpers/mcp-suite-entry.mjs',
  'tests/mcp-suite-entry.test.mjs',
  'scripts/targeted-tests-overrides.json',
];

test('domain retirement executes all four fixed isolated groups with genuine positive inner TAP', { timeout: 660_000 }, async (t) => {
  assert.deepEqual(SUITE_STAGES['domain-retirement'], EXPECTED_STAGES);
  for (const args of EXPECTED_STAGES) {
    for (const file of args.slice(args.indexOf('--test') + 1)) {
      assert.ok(statSync(new URL(`../${file}`, import.meta.url)).isFile(), `missing promised test file: ${file}`);
    }
  }
  const results = await runFixedSuite('domain-retirement', t);
  assert.equal(results.length, 4, 'all four inner stages must execute');
  for (const [index, result] of results.entries()) {
    assert.equal(result.suite, 'domain-retirement');
    assert.equal(result.stage, index + 1);
    assert.deepEqual(result.args, EXPECTED_STAGES[index]);
    assert.ok(result.counts.pass > 0);
  }
});

test('every domain-retirement change selects its eligible fixed behavioral suite', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['test:domain-retirement'], 'node --test tests/retired-domain-suite.test.mjs');
  const overrides = JSON.parse(readFileSync(new URL('../scripts/targeted-tests-overrides.json', import.meta.url), 'utf8'));
  const index = deriveScriptIndex(scripts);
  const mapping = mergeOverrides(OVERRIDES, overrides);
  for (const file of WIRED_FILES) {
    const selected = selectScripts([file], index, mapping);
    assert.ok(selected.scripts.includes('test:domain-retirement'), `${file} must run the fixed retirement groups`);
    assert.deepEqual(selected.unmapped, []);
  }
});
