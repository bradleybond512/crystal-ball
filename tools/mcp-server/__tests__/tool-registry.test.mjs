import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  TOOL_CATALOG,
  TOOL_INDEX,
  createToolConfig,
  catalogSummary,
} from '../tool-registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');

test('tool catalog exactly matches registered MCP tools and generated help index', async () => {
  const indexSource = await readFile(join(serverRoot, 'index.mjs'), 'utf8');
  const registered = [...indexSource.matchAll(/registerTool\('([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  const catalogued = Object.keys(TOOL_CATALOG).sort();
  const documented = Object.values(TOOL_INDEX.categories)
    .flatMap((category) => Object.keys(category.tools))
    .sort();

  assert.deepEqual(catalogued, registered);
  assert.deepEqual(documented, registered);
});

test('every tool declares complete MCP safety annotations', () => {
  for (const [name, metadata] of Object.entries(TOOL_CATALOG)) {
    assert.equal(typeof metadata.annotations.readOnlyHint, 'boolean', name);
    assert.equal(typeof metadata.annotations.destructiveHint, 'boolean', name);
    assert.equal(typeof metadata.annotations.idempotentHint, 'boolean', name);
    assert.equal(typeof metadata.annotations.openWorldHint, 'boolean', name);
  }
});

test('createToolConfig adds annotations and a structured output schema', () => {
  const config = createToolConfig('get_sitrep', {
    description: 'test',
    inputSchema: {},
  });

  assert.equal(config.annotations.readOnlyHint, true);
  assert.equal(config.annotations.destructiveHint, false);
  assert.ok(config.outputSchema.result);
});

test('catalog summary reflects the canonical registry', () => {
  assert.match(catalogSummary(), /^61 tools across 9 categories$/);
});

test('checked-in help index is generated from the canonical registry', async () => {
  const stored = JSON.parse(await readFile(join(serverRoot, 'docs', '_index.json'), 'utf8'));
  assert.deepEqual(stored, TOOL_INDEX);
});

test('package metadata and executable match the server contract', async () => {
  const packageJson = JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8'));
  const indexSource = await readFile(join(serverRoot, 'index.mjs'), 'utf8');
  const indexStat = await stat(join(serverRoot, 'index.mjs'));
  const monitorStat = await stat(join(serverRoot, 'monitor-once.mjs'));
  const cliStat = await stat(join(serverRoot, 'cli.mjs'));

  assert.equal(packageJson.description, `Crystal Ball MCP server — ${catalogSummary()}`);
  assert.equal(packageJson.version, '0.3.0');
  assert.equal(packageJson.bin['crystalball-monitor'], './monitor-once.mjs');
  assert.equal(packageJson.bin['crystalball-monitor-install'], './install-monitor.mjs');
  assert.equal(packageJson.bin.crystalball, './cli.mjs');
  assert.ok(packageJson.files.includes('local-lock.mjs'));
  assert.ok(packageJson.files.includes('weekly-evaluation-report.mjs'));
  assert.match(indexSource, /^#!\/usr\/bin\/env node/);
  assert.ok(indexStat.mode & 0o111);
  assert.ok(monitorStat.mode & 0o111);
  assert.ok(cliStat.mode & 0o111);
});
