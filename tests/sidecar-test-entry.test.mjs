import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestFilePreflight } from './helpers/test-file-preflight.mjs';
import { deriveScriptIndex, mergeOverrides, OVERRIDES, selectScripts } from '../scripts/targeted-tests.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function wrapperFixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'cb-sidecar-entry-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const helpers = join(repo, 'tests/helpers');
  mkdirSync(helpers, { recursive: true });
  for (const file of ['run-isolated-mcp.mjs', 'test-file-preflight.mjs']) {
    copyFileSync(join(root, 'tests/helpers', file), join(helpers, file));
  }
  // The real fixture must never be created in a missing-file case. This stub
  // records that boundary without reading user configuration or starting tests.
  writeFileSync(join(helpers, 'mcp-runtime-fixture.mjs'), `
import { writeFileSync } from 'node:fs';
export function sourceFixture() {
  writeFileSync(new URL('../../fixture-created', import.meta.url), 'created');
  throw new Error('fixture boundary reached');
}
export function npmCli() { throw new Error('npm must not run in this scaffold'); }
`);
  for (const file of ['first.test.mjs', 'middle.test.mjs', 'last.test.mjs']) {
    writeFileSync(join(repo, file), `import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./test-executed', import.meta.url), 'executed');`);
  }
  return {
    repo,
    run(args) {
      return spawnSync(process.execPath, [join(helpers, 'run-isolated-mcp.mjs'), ...args], {
        cwd: repo,
        env: { PATH: dirname(process.execPath), HOME: repo, TMPDIR: repo },
        encoding: 'utf8',
        timeout: 10_000,
      });
    },
  };
}

for (const position of [0, 1, 2]) {
  test(`missing explicit test at position ${position + 1} rejects before fixture or tests`, (t) => {
    const fixture = wrapperFixture(t);
    const files = ['first.test.mjs', 'middle.test.mjs', 'last.test.mjs'];
    files[position] = `missing-${position}.test.mjs`;
    const result = fixture.run(['--test', ...files]);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing explicit test file/);
    assert.ok(result.stderr.includes(files[position]), 'diagnostic must identify the missing path');
    assert.equal(existsSync(join(fixture.repo, 'fixture-created')), false, 'fixture creation must not start');
    assert.equal(existsSync(join(fixture.repo, 'test-executed')), false, 'test execution must not start');
  });
}

test('preflight reports every missing file and rejects a directory as a test file', (t) => {
  const fixture = wrapperFixture(t);
  const args = ['--test', 'absent-first.test.mjs', 'tests', 'absent-last.test.mjs'];
  const result = fixture.run(args);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  for (const file of args.slice(1)) assert.ok(result.stderr.includes(file), `missing diagnostic: ${file}`);
  assert.equal(existsSync(join(fixture.repo, 'fixture-created')), false);
});

test('existing direct paths pass preflight and reach the fixture boundary', (t) => {
  const fixture = wrapperFixture(t);
  const result = fixture.run(['--test', 'first.test.mjs', 'middle.test.mjs', 'last.test.mjs']);
  assert.equal(result.error, undefined);
  assert.match(result.stderr, /fixture boundary reached/);
  assert.equal(existsSync(join(fixture.repo, 'fixture-created')), true);
  assert.equal(existsSync(join(fixture.repo, 'test-executed')), false);
});

for (const args of [['--npm-mcp-test'], ['--npm-script', 'test:fixture']]) {
  test(`${args[0]} retains its fixture routing`, (t) => {
    const fixture = wrapperFixture(t);
    const result = fixture.run(args);
    assert.equal(result.error, undefined);
    assert.match(result.stderr, /fixture boundary reached/);
    assert.equal(existsSync(join(fixture.repo, 'fixture-created')), true);
    assert.equal(existsSync(join(fixture.repo, 'test-executed')), false);
  });
}

test('checked-in sidecar command lists only existing explicit test files', () => {
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const tokens = scripts['test:sidecar'].split(/\s+/);
  assert.deepEqual(tokens.slice(0, 3), ['node', 'tests/helpers/run-isolated-mcp.mjs', '--test']);
  const files = tokens.slice(3);
  assert.ok(files.length > 0, 'sidecar suite must name tests');
  for (const file of files) {
    assert.match(file, /\.test\.(?:mjs|cjs)$/);
    assert.ok(existsSync(join(root, file)), `sidecar test is missing: ${file}`);
    assert.ok(statSync(join(root, file)).isFile(), `sidecar test is not a file: ${file}`);
  }
  assert.doesNotThrow(() => TestFilePreflight.assertExplicitTestFiles(tokens.slice(2), root));
});

test('changed entry helpers and USNI files select eligible behavioral suites', () => {
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const overrides = JSON.parse(readFileSync(join(root, 'scripts/targeted-tests-overrides.json'), 'utf8'));
  const index = deriveScriptIndex(scripts);
  const mapping = mergeOverrides(OVERRIDES, overrides);
  for (const file of ['tests/helpers/test-file-preflight.mjs', 'tests/helpers/run-isolated-mcp.mjs', 'tests/sidecar-test-entry.test.mjs']) {
    const selected = selectScripts([file], index, mapping);
    assert.ok(selected.scripts.includes('test:sidecar-entry'), `${file} must run entry regressions`);
    assert.deepEqual(selected.unmapped, []);
  }
  for (const file of ['api/usni-fleet.js', 'api/__tests__/usni-fleet.test.mjs']) {
    const selected = selectScripts([file], index, mapping);
    assert.ok(selected.scripts.includes('test:api'), `${file} must run API tests`);
    assert.deepEqual(selected.unmapped, []);
  }
});
