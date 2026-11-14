import './helpers/loopback-only.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertHostedLinux, graphRequire, ownedRuntimeFixture, runtimeMutations, tapCounts, websocketExchange } from './helpers/dependency-runtime-fixture.mjs';

test('native contracts refuse local and self-hosted execution before dependency imports', () => {
  const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
  assert.doesNotThrow(() => assertHostedLinux(hosted, 'linux'));
  for (const [env, platform] of [[{}, 'linux'], [hosted, 'darwin'], [{ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux']]) {
    assert.throws(() => assertHostedLinux(env, platform), /disposable hosted Linux/);
  }
  const result = spawnSync(process.execPath, ['--test', 'tests/dependency-runtime/cb-control.test.mjs'], {
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /disposable hosted Linux/);
  assert.doesNotMatch(result.stdout + result.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);
});

test('owned fixture removes inherited credentials and restores environment and files', () => {
  const saved = { ...process.env };
  const callbacks = [];
  process.env.CB_CONTROL_DIR = '/unowned/fixture-do-not-open';
  process.env.OPENAI_API_KEY = 'dummy-fixture-do-not-inherit';
  process.env.NODE_OPTIONS = '--trace-warnings';
  try {
    const fixture = ownedRuntimeFixture({ after: (fn) => callbacks.push(fn) });
    assert.equal(process.env.HOME, fixture.home);
    assert.equal(process.env.CB_CONTROL_DIR, join(fixture.root, 'cb-control'));
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    writeFileSync(join(fixture.home, 'fixture-owned'), 'temporary');
    callbacks[0]();
    assert.equal(existsSync(fixture.root), false);
    assert.equal(process.env.CB_CONTROL_DIR, '/unowned/fixture-do-not-open');
  } finally {
    for (const fn of callbacks) fn();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('graph loader rejects ambient dependency fallback and lock-version mismatch', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cb-runtime-require-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/package.json'), '{"dependencies":{"ws":"1.0.0"}}');
  writeFileSync(join(root, 'scripts/package-lock.json'), '{"packages":{"node_modules/ws":{"version":"1.0.0"}}}');
  const putPackage = (dir, version) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ws', version, main: 'index.cjs' }));
    writeFileSync(join(dir, 'index.cjs'), 'module.exports = "owned fixture dependency";');
  };
  putPackage(join(root, 'node_modules/ws'), '1.0.0');
  assert.throws(() => graphRequire('scripts', root)('ws'), /installed graph/);
  putPackage(join(root, 'scripts/node_modules/ws'), '2.0.0');
  assert.throws(() => graphRequire('scripts', root)('ws'), /lockfile version/);
  putPackage(join(root, 'scripts/node_modules/ws'), '1.0.0');
  assert.equal(graphRequire('scripts', root)('ws'), 'owned fixture dependency');
  assert.throws(() => graphRequire('../scripts', root), /Unknown runtime graph/);
  assert.throws(() => graphRequire('constructor', root), /Unknown runtime graph/);
  assert.throws(() => graphRequire('__proto__', root), /Unknown runtime graph/);
  const escaping = join(root, 'escaping');
  mkdirSync(join(escaping, 'scripts'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) {
    writeFileSync(join(escaping, 'scripts', file), readFileSync(join(root, 'scripts', file)));
  }
  putPackage(join(escaping, 'node_modules/ws'), '1.0.0');
  putPackage(join(escaping, 'scripts/node_modules/ws'), '1.0.0');
  writeFileSync(join(escaping, 'scripts/node_modules/ws/package.json'), JSON.stringify({ name: 'ws', version: '1.0.0', main: '../../../node_modules/ws/index.cjs' }));
  assert.throws(() => graphRequire('scripts', escaping)('ws'), /escaped its installed graph/);
});

test('common websocket helper completes a real owned exchange using the root graph', { timeout: 6000 }, async (t) => {
  const ws = await import('ws');
  assert.equal(await websocketExchange(t, ws, 'root-helper-fixture'), 'root-helper-fixture');
});

test('mutation oracle rejects empty, skipped, cancelled and truncated execution', () => {
  assert.deepEqual(tapCounts('# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'), { tests: 2, pass: 2, fail: 0 });
  for (const text of ['', '# pass 2\n# fail 0\n', '# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n', '# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n']) {
    assert.throws(() => tapCounts(text), /complete positive TAP/);
  }
  for (const field of ['cancelled', 'skipped', 'todo']) {
    const text = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
    assert.throws(() => tapCounts(text.replace(`# ${field} 0`, `# ${field} 1`)), /complete positive TAP/);
  }
});

test('actual runtime entrypoints retain loopback guard and are absent from broad npm aliases', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts;
  assert.equal(scripts['test:dependency-runtime-contracts'], 'node --test tests/dependency-runtime-contracts.test.mjs');
  for (const command of Object.values(scripts)) assert.doesNotMatch(command, /tests\/dependency-runtime\/(?:scripts|cb-control)\.test\.mjs/);
  for (const file of ['scripts', 'cb-control']) {
    const source = readFileSync(new URL(`./dependency-runtime/${file}.test.mjs`, import.meta.url), 'utf8');
    assert.match(source, /import '\.\.\/helpers\/loopback-only\.mjs'/);
    assert.match(source, /ownedRuntimeFixture\(t\)/);
    assert.match(source, new RegExp(`graphRequire\\('${file}'\\)`));
  }
});

test('hosted mutations change each dependency observation exactly once', () => {
  for (const graph of ['scripts', 'cb-control']) {
    const source = readFileSync(new URL(`./dependency-runtime/${graph}.test.mjs`, import.meta.url), 'utf8');
    const mutations = runtimeMutations(graph);
    assert.equal(mutations.length, graph === 'scripts' ? 2 : 3);
    for (const mutation of mutations) {
      assert.equal(source.split(mutation.before).length, 2);
      assert.notEqual(mutation.after, mutation.before);
      assert.equal(source.includes(mutation.after), false);
      assert.doesNotMatch(mutation.before, /assert\./);
    }
  }
  assert.throws(() => runtimeMutations('../scripts'), /Unknown runtime mutation graph/);
});
