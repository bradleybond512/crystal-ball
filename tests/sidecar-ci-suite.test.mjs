import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runFixedSuite, SUITE_STAGES } from './helpers/mcp-suite-entry.mjs';
import {
  assertSidecarInventory, assertSidecarSmokeWiring, discoverSidecarTests, sidecarSmokeGroups,
} from './helpers/sidecar-ci-inventory.mjs';

test('the remaining sidecar suite executes both isolated stages with complete positive inner TAP', { timeout: 330_000 }, async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  const workflow = readFileSync(new URL('../.github/workflows/smoke.yml', import.meta.url), 'utf8');
  assertSidecarSmokeWiring(scripts, workflow);
  assertSidecarInventory(discoverSidecarTests(root), sidecarSmokeGroups(scripts, SUITE_STAGES['sidecar-remaining']));
  const results = await runFixedSuite('sidecar-remaining', t);
  assert.equal(results.length, 2);
  for (const [index, result] of results.entries()) {
    assert.equal(result.suite, 'sidecar-remaining');
    assert.equal(result.stage, index + 1);
    assert.deepEqual(result.args, SUITE_STAGES['sidecar-remaining'][index]);
  }
});
