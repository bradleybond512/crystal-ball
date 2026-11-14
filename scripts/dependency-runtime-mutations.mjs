import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertHostedLinux, runtimeMutations, runtimeRepo, tapCounts } from '../tests/helpers/dependency-runtime-fixture.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

test('actual dependency runtime mutation controls', { timeout: 180_000 }, async (t) => {
  assertHostedLinux();
  const graph = process.env.CB_DEPENDENCY_GRAPH;
  const mutations = runtimeMutations(graph);
  const relative = `tests/dependency-runtime/${graph}.test.mjs`;
  const file = path.join(runtimeRepo, relative);
  const git = (args) => {
    const result = spawnSync('/usr/bin/git', args, { cwd: runtimeRepo, encoding: 'utf8', timeout: 10_000, maxBuffer: 512 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(git(['status', '--short']), '', 'mutation proof requires a clean checkout');
  const original = readFileSync(file);
  const checksum = digest(original);
  const run = () => {
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', relative], {
      cwd: runtimeRepo, env: process.env, encoding: 'utf8', timeout: 35_000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...result, counts: tapCounts(result.stdout) };
  };
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  assert.equal(baseline.counts.fail, 0);
  t.diagnostic(`baseline ${JSON.stringify(baseline.counts)} sha256=${checksum}`);
  for (const mutation of mutations) {
    await t.test(mutation.id, () => {
      const source = original.toString('utf8');
      assert.equal(source.split(mutation.before).length, 2, 'mutation must match exactly once');
      try {
        writeFileSync(file, source.replace(mutation.before, mutation.after));
        const diff = git(['diff', '--', relative]);
        assert.ok(diff.includes(mutation.before) && diff.includes(mutation.after), 'mutation diff must confirm applied fixture change');
        t.diagnostic(diff);
        const red = run();
        t.diagnostic(`mutated ${mutation.id} ${JSON.stringify(red.counts)}\n${red.stdout}${red.stderr}`);
        assert.equal(red.status, 1);
        assert.ok(red.counts.fail > 0, 'changed observation must fail an actual runtime assertion');
        assert.match(red.stdout, /ERR_ASSERTION/);
      } finally {
        writeFileSync(file, original);
        assert.equal(digest(readFileSync(file)), checksum);
        assert.equal(git(['status', '--short']), '', 'mutation restoration must leave a clean checkout');
      }
    });
  }
  const restored = run();
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.deepEqual(restored.counts, baseline.counts);
  t.diagnostic(`restored ${JSON.stringify(restored.counts)} sha256=${checksum}; clean checkout`);
});
