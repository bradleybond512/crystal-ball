import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const bracesPath = require.resolve('braces');
const braces = require(bracesPath);
const bounded = (body) => {
  const result = spawnSync(process.execPath, ['--stack-size=512', '-e', `const assert = require('node:assert/strict'); const braces = require(${JSON.stringify(bracesPath)}); ${body}`], { timeout: 3000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
};

test('braces rejects excessive parsed nesting before stack exhaustion', () => {
  bounded(`for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      assert.throws(() => braces[method](open.repeat(3000) + 'a,b' + close.repeat(3000)), /exceeds max depth/);
    }
  }`);
});

test('braces bounds supplied ASTs and cyclic expansion parents', () => {
  bounded(`for (const method of ['compile', 'expand', 'stringify']) {
    let ast = {type: 'text', value: 'a'};
    for (let i = 0; i < 3000; i++) ast = {type: 'brace', nodes: [ast]};
    assert.throws(() => braces[method]({type: 'root', nodes: [ast]}), /exceeds max depth/);
    const cycle = {type: 'root', nodes: []}; cycle.nodes.push(cycle);
    assert.throws(() => braces[method](cycle), /exceeds max depth/);
  }
  const ast = {type: 'paren', nodes: [{type: 'text', value: 'a'}]}; ast.parent = ast;
  assert.throws(() => braces.expand(ast), /parent chain contains a cycle/);`);
});

test('braces preserves ordinary globs and permits only lower depth limits', () => {
  assert.deepEqual(braces.expand('src/{app,lib}/file{1..2}.ts'), ['src/app/file1.ts', 'src/app/file2.ts', 'src/lib/file1.ts', 'src/lib/file2.ts']);
  assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'a,b' + '}'.repeat(100)));
  assert.throws(() => braces.parse('{{a,b},c}', { maxDepth: 1 }), /exceeds max depth/);
  assert.doesNotThrow(() => braces.parse('{{a,b},c}', { maxDepth: 2 }));
  for (const maxDepth of [101, Infinity, NaN, 10000]) {
    assert.throws(() => braces.parse('{'.repeat(101) + 'a,b' + '}'.repeat(101), { maxDepth }), /exceeds max depth/);
  }
});

test('micromatch uses the reviewed local braces source', () => {
  const micromatchRequire = createRequire(require.resolve('micromatch'));
  assert.equal(realpathSync(micromatchRequire.resolve('braces')), realpathSync(fileURLToPath(new URL('../vendor/braces/index.js', import.meta.url))));
  const micromatch = require('micromatch');
  assert.deepEqual(micromatch(['src/app/file1.ts', 'src/lib/file2.ts', 'src/other/file3.ts'], 'src/{app,lib}/file{1..2}.ts'), ['src/app/file1.ts', 'src/lib/file2.ts']);
});
