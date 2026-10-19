import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runFixedSuite, SUITE_STAGES } from './helpers/mcp-suite-entry.mjs';
import { deriveScriptIndex, mergeOverrides, OVERRIDES, selectScripts } from '../scripts/targeted-tests.mjs';

test('port publication executes isolated behavioral and wiring tests with complete positive inner TAP', { timeout: 330_000 }, async (t) => {
  const results = await runFixedSuite('port-publication', t);
  assert.equal(results.length, 2);
  for (const [index, result] of results.entries()) {
    assert.equal(result.suite, 'port-publication');
    assert.equal(result.stage, index + 1);
    assert.deepEqual(result.args, SUITE_STAGES['port-publication'][index]);
    assert.ok(result.counts.pass > 0);
  }
});

test('publication has a fixed eligible suite, unconditional smoke step and additive source mappings', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['test:port-publication'], 'node --test tests/sidecar-port-publication-suite.test.mjs');
  assert.deepEqual(SUITE_STAGES['port-publication'], [
    ['--test', 'tests/sidecar-port-publication.test.mjs', 'tests/sidecar-supervisor-boundary.test.mjs'],
    ['--import', 'tsx', '--test', 'src/services/diagnostics/__tests__/local-engine-status.test.mts'],
  ]);
  const workflow = readFileSync(new URL('../.github/workflows/smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^      - run: npm run test:port-publication$/m);
  const overrides = JSON.parse(readFileSync(new URL('../scripts/targeted-tests-overrides.json', import.meta.url), 'utf8'));
  const index = deriveScriptIndex(scripts);
  for (const file of [
    'src-tauri/src/main.rs', 'src-tauri/src/sidecar_publication.rs',
    'src-tauri/sidecar/local-api-server.mjs', 'src/services/diagnostics/local-engine-status.ts',
    'tests/sidecar-port-publication.test.mjs', 'tests/sidecar-supervisor-boundary.test.mjs',
    'tests/helpers/mcp-suite-entry.mjs',
  ]) {
    const selected = selectScripts([file], index, mergeOverrides(OVERRIDES, overrides));
    assert.ok(selected.scripts.includes('test:port-publication'), `${file} must run publication regressions`);
    assert.deepEqual(selected.unmapped, []);
  }
});
