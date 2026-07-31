#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_INDEX } from './tool-registry.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const target = join(root, 'docs', '_index.json');
const generated = `${JSON.stringify(TOOL_INDEX, null, 2)}\n`;
const check = process.argv.includes('--check');

if (check) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== generated) {
    console.error('MCP documentation index is stale. Run npm run docs:generate.');
    process.exitCode = 1;
  }
} else {
  await writeFile(target, generated);
  console.log(`Generated ${target}`);
}
