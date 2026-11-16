import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compareWithBaseline,
  findUnreachable,
  readBaseline,
} from '../scripts/check-unreachable.mjs';

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unreachable-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

test('follows static, dynamic, alias and side-effect imports from the HTML entry', () => {
  const root = fixture({
    'index.html': '<script type="module" src="/src/entry.ts"></script>',
    'src/entry.ts': "import './side-effect';\nimport { a } from './a';\nvoid import('@/lazy');\nexport { a };",
    'src/side-effect.ts': 'export {};',
    'src/a.ts': "export { b as a } from './dir';",
    'src/dir/index.ts': 'export const b = 1;',
    'src/lazy.ts': 'export const lazy = 1;',
    'src/orphan.ts': 'export const orphan = 1;',
  });
  assert.deepEqual(findUnreachable(root).unreachable, ['src/orphan.ts']);
});

test('a type-only import does not make a module reachable', () => {
  const root = fixture({
    'index.html': '<script type="module" src="/src/entry.ts"></script>',
    'src/entry.ts': "import type { Shape } from './types-only';\nexport type { Other } from './reexported-type';\nexport const x: Shape | null = null;",
    'src/types-only.ts': 'export interface Shape { a: number }\nexport function neverCalled() {}',
    'src/reexported-type.ts': 'export interface Other { b: number }',
  });
  assert.deepEqual(findUnreachable(root).unreachable, ['src/reexported-type.ts', 'src/types-only.ts']);
});

test('workers are entry points; tests, generated code and declarations are ignored', () => {
  const root = fixture({
    'index.html': '<script type="module" src="/src/entry.ts"></script>',
    'src/entry.ts': 'export {};',
    'src/workers/job.worker.ts': "import './worker-dep';",
    'src/workers/worker-dep.ts': 'export {};',
    'src/__tests__/thing.test.mts': 'export {};',
    'src/generated/client.ts': 'export {};',
    'src/env.d.ts': 'export {};',
  });
  const result = findUnreachable(root);
  assert.deepEqual(result.unreachable, []);
  assert.deepEqual(result.entries, ['src/entry.ts', 'src/workers/job.worker.ts', 'src/workers/worker-dep.ts']);
});

test('no entry points means no verdict, not "everything is unreachable"', () => {
  const root = fixture({ 'src/a.ts': 'export {};' });
  assert.deepEqual(findUnreachable(root).entries, []);
});

test('compareWithBaseline flags new unreachable files and stale baseline entries', () => {
  assert.deepEqual(compareWithBaseline(['a', 'c'], ['a', 'b']), {
    newlyUnreachable: ['c'],
    staleBaseline: ['b'],
  });
});

test('the repository matches its unreachable-source baseline', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const { entries, unreachable } = findUnreachable(root);
  assert.ok(entries.includes('src/entry.ts'), 'expected src/entry.ts to be an entry point');
  assert.deepEqual(compareWithBaseline(unreachable, readBaseline(root)), {
    newlyUnreachable: [],
    staleBaseline: [],
  });
});
